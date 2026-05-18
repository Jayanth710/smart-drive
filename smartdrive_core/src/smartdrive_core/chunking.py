"""Markdown-aware, token-aware chunking.

Strategy:
  1. Parse the document into atomic blocks: fenced code, markdown tables,
     headings, paragraphs, lists.
  2. Code/tables are NEVER split — they're either kept whole or, if too big,
     split internally with the same overlap policy as prose.
  3. Headings (#, ##, ###) "stick" to the following block so a heading is
     always packed together with its content.
  4. Pack blocks greedily into chunks that fit `target_tokens`, then take a
     `overlap_tokens` tail of the previous chunk as the start of the next so
     context isn't truncated at the boundary.

All sizing uses a real tokenizer (tiktoken cl100k_base) instead of char/4.
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Callable, Iterable

from .tokenizer import count_tokens, truncate_to_tokens

logger = logging.getLogger(__name__)


@dataclass
class Chunk:
    index: int
    text: str
    char_start: int = 0
    char_end: int = 0
    token_count: int = 0


@dataclass
class _Block:
    kind: str  # "heading" | "code" | "table" | "paragraph" | "list"
    text: str
    atomic: bool = False  # True = never split internally (code/tables)
    sticks_to_next: bool = False  # True for headings
    tokens: int = field(default=0)

    def __post_init__(self):
        if self.tokens == 0:
            self.tokens = count_tokens(self.text)


# ---------- markdown parsing ----------

_FENCED_CODE_RE = re.compile(r"^( *)```(.*?)$", re.MULTILINE)
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)


def _parse_blocks(text: str) -> list[_Block]:
    """Walk the markdown source and emit atomic blocks in order.

    We hand-roll this instead of pulling in a full markdown parser — we only
    need the structural distinctions that matter for chunking, and we don't
    want to depend on the exact behaviour of any one library.
    """
    blocks: list[_Block] = []
    lines = text.splitlines(keepends=False)
    i = 0
    n = len(lines)

    def flush_paragraph(buf: list[str]) -> None:
        body = "\n".join(buf).strip()
        if body:
            blocks.append(_Block(kind="paragraph", text=body))

    while i < n:
        line = lines[i]
        stripped = line.lstrip()

        # Fenced code: gather lines until matching fence.
        if stripped.startswith("```"):
            fence = stripped[:3]
            start = i
            i += 1
            while i < n and not lines[i].lstrip().startswith(fence):
                i += 1
            end = min(i, n - 1)
            i += 1  # skip closing fence (if present)
            body = "\n".join(lines[start : end + 1]).strip()
            if body:
                blocks.append(_Block(kind="code", text=body, atomic=True))
            continue

        # Heading: stays sticky with the next non-empty block.
        m = _HEADING_RE.match(line)
        if m:
            blocks.append(_Block(kind="heading", text=line.strip(), sticks_to_next=True))
            i += 1
            continue

        # Table: consecutive lines starting with `|` (and a separator row).
        if stripped.startswith("|"):
            start = i
            while i < n and lines[i].lstrip().startswith("|"):
                i += 1
            body = "\n".join(lines[start:i]).strip()
            if body:
                blocks.append(_Block(kind="table", text=body, atomic=True))
            continue

        # Blank line: paragraph break.
        if stripped == "":
            i += 1
            continue

        # List vs paragraph: read until blank line; lists are still split-able.
        start = i
        while i < n and lines[i].strip() != "" and not lines[i].lstrip().startswith("```"):
            # Stop if we hit a heading or table inside (rare but safer).
            if _HEADING_RE.match(lines[i]) or lines[i].lstrip().startswith("|"):
                break
            i += 1
        body = "\n".join(lines[start:i]).strip()
        if not body:
            continue
        # Distinguish list from paragraph cheaply: if 80%+ of lines start with a
        # bullet-like prefix, call it a list.
        list_lines = [ln for ln in body.splitlines() if re.match(r"^\s*(\d+\.|[-*+])\s+", ln)]
        kind = "list" if len(list_lines) >= max(2, int(0.8 * len(body.splitlines()))) else "paragraph"
        blocks.append(_Block(kind=kind, text=body))

    return blocks


# ---------- splitting big blocks ----------

_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\"'])")


def _split_paragraph_by_tokens(text: str, max_tokens: int) -> list[str]:
    """Greedy sentence-aware split when a single block is bigger than the chunk budget."""
    sentences = _SENT_SPLIT_RE.split(text)
    out: list[str] = []
    buf: list[str] = []
    buf_tokens = 0
    for s in sentences:
        st = count_tokens(s)
        if buf_tokens + st > max_tokens and buf:
            out.append(" ".join(buf))
            buf = [s]
            buf_tokens = st
        else:
            buf.append(s)
            buf_tokens += st
    if buf:
        out.append(" ".join(buf))
    # Final safety: truncate any remaining over-budget sentence.
    return [truncate_to_tokens(p, max_tokens) for p in out if p.strip()]


def _split_code_or_table(text: str, max_tokens: int) -> list[str]:
    """Atomic blocks that exceed the budget: split by line, preserving prefix structure."""
    lines = text.splitlines()
    out: list[list[str]] = [[]]
    out_tokens = [0]
    for ln in lines:
        lt = count_tokens(ln + "\n")
        if out_tokens[-1] + lt > max_tokens and out[-1]:
            out.append([])
            out_tokens.append(0)
        out[-1].append(ln)
        out_tokens[-1] += lt
    return ["\n".join(g) for g in out if g]


# ---------- main chunker ----------

def _tail_for_overlap(text: str, overlap_tokens: int) -> str:
    """Return a token-bounded suffix of text for use as the next chunk's lead-in."""
    if overlap_tokens <= 0 or not text:
        return ""
    # Walk back sentence boundaries until we have ~overlap_tokens worth of tail.
    sentences = _SENT_SPLIT_RE.split(text)
    out: list[str] = []
    total = 0
    for s in reversed(sentences):
        st = count_tokens(s)
        if total + st > overlap_tokens and out:
            break
        out.insert(0, s)
        total += st
    return " ".join(out).strip()


def chunk_text(text: str, target_tokens: int = 600, overlap_tokens: int = 80) -> list[Chunk]:
    """Markdown-aware chunking with real-token sizing and sentence-grained overlap.

    target_tokens defaults to 600 (well under the embedding model's 2048 limit
    so we leave headroom for the overlap and small surrounding context).
    """
    text = (text or "").strip()
    if not text:
        return []

    blocks = _parse_blocks(text)
    if not blocks:
        return []

    # Expand oversized blocks so packing only sees pieces that fit.
    expanded: list[_Block] = []
    for b in blocks:
        if b.tokens <= target_tokens:
            expanded.append(b)
            continue
        pieces: Iterable[str]
        if b.atomic:
            pieces = _split_code_or_table(b.text, target_tokens)
            for p in pieces:
                expanded.append(_Block(kind=b.kind, text=p, atomic=True))
        else:
            pieces = _split_paragraph_by_tokens(b.text, target_tokens)
            for p in pieces:
                expanded.append(_Block(kind=b.kind, text=p))

    # Greedy pack into chunks with overlap and heading-stickiness.
    chunks: list[Chunk] = []
    cur_text: list[str] = []
    cur_tokens = 0
    last_heading: _Block | None = None

    def flush():
        nonlocal cur_text, cur_tokens
        body = "\n\n".join(t for t in cur_text if t).strip()
        if not body:
            cur_text = []
            cur_tokens = 0
            return
        chunks.append(Chunk(index=len(chunks), text=body, token_count=count_tokens(body)))
        tail = _tail_for_overlap(body, overlap_tokens)
        cur_text = [tail] if tail else []
        cur_tokens = count_tokens(tail) if tail else 0

    i = 0
    while i < len(expanded):
        b = expanded[i]

        # Stash headings as a sticky prefix.
        if b.sticks_to_next:
            last_heading = b
            i += 1
            continue

        # Prepend the most recent heading so it lives in the same chunk as its content.
        prefix_text = last_heading.text + "\n\n" if last_heading else ""
        prefix_tokens = last_heading.tokens + 2 if last_heading else 0
        last_heading = None  # consumed

        # If the next packed unit overflows, flush first.
        unit_tokens = prefix_tokens + b.tokens
        if cur_tokens + unit_tokens > target_tokens and cur_text:
            flush()

        if prefix_text:
            cur_text.append(prefix_text.rstrip())
            cur_tokens += prefix_tokens
        cur_text.append(b.text)
        cur_tokens += b.tokens
        i += 1

    flush()

    if not chunks:
        chunks.append(Chunk(index=0, text=text, token_count=count_tokens(text)))

    logger.info(
        f"chunk_text: produced {len(chunks)} chunks "
        f"(avg {sum(c.token_count for c in chunks) // max(1, len(chunks))} tokens) "
        f"from {len(text)} chars of markdown"
    )
    return chunks


# ---------- optional: semantic chunking ----------

def chunk_text_semantic(
    text: str,
    embed_fn: Callable[[list[str]], list[list[float] | None]],
    target_tokens: int = 600,
    sim_threshold: float = 0.65,
) -> list[Chunk]:
    """Topic-aware chunking driven by embedding similarity between sentences.

    1. Split text into sentences.
    2. Embed each.
    3. Detect topic shifts where cosine similarity to the running centroid
       drops below `sim_threshold`.
    4. Cut a new chunk at each shift, packing until we approach target_tokens.

    Use sparingly — this calls the embedding API at sentence granularity. Best
    for long-form prose where structural chunking would split topics.
    """
    text = (text or "").strip()
    if not text:
        return []

    sentences = [s.strip() for s in _SENT_SPLIT_RE.split(text) if s.strip()]
    if not sentences:
        return []

    vectors = embed_fn(sentences)
    valid = [(s, v) for s, v in zip(sentences, vectors) if v]
    if not valid:
        return chunk_text(text, target_tokens=target_tokens)

    def cosine(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        na = sum(x * x for x in a) ** 0.5
        nb = sum(y * y for y in b) ** 0.5
        return dot / (na * nb + 1e-9)

    chunks: list[Chunk] = []
    cur_sents: list[str] = []
    cur_vecs: list[list[float]] = []
    cur_tokens = 0

    def flush():
        nonlocal cur_sents, cur_vecs, cur_tokens
        if not cur_sents:
            return
        body = " ".join(cur_sents)
        chunks.append(Chunk(index=len(chunks), text=body, token_count=count_tokens(body)))
        cur_sents, cur_vecs, cur_tokens = [], [], 0

    for s, v in valid:
        st = count_tokens(s)
        if cur_vecs:
            centroid = [sum(d) / len(cur_vecs) for d in zip(*cur_vecs)]
            sim = cosine(centroid, v)
            if (sim < sim_threshold and cur_tokens > target_tokens // 3) or cur_tokens + st > target_tokens:
                flush()
        cur_sents.append(s)
        cur_vecs.append(v)
        cur_tokens += st

    flush()
    return chunks or chunk_text(text, target_tokens=target_tokens)
