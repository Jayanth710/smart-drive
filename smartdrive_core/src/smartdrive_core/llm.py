"""LLM helpers (Gemini): summarisation, captioning, embeddings.

Every external call is wrapped in `with_retry` for transient errors and is
token-aware via `tokenizer.truncate_to_tokens` / `count_tokens`. For documents
larger than ~`MAP_REDUCE_TOKEN_THRESHOLD`, summarisation switches to
map-reduce: chunk → summarise chunks → summarise the summaries.
"""

import json
import json_repair
import logging
import os

from google import genai
from google.genai import types
from PIL import Image
from dotenv import load_dotenv

from .chunking import chunk_text
from .retry import with_retry
from .schema import DOC_SUMMARY_SCHEMA
from .tokenizer import count_tokens, truncate_to_tokens

logger = logging.getLogger(__name__)

load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY", ""))

# ---- limits ----
# Gemini embedding-001 accepts up to 2048 tokens per item. We leave headroom.
EMBED_MAX_TOKENS = 1900
# Above this many input tokens we switch summarisation to map-reduce so we
# don't lose mid-document content to attention bias.
MAP_REDUCE_TOKEN_THRESHOLD = 12_000


# ============================================================================
# Embeddings
# ============================================================================

def _embed_raw(texts: list[str]) -> list[list[float] | None]:
    """One Gemini batched embedding call. Inputs are pre-truncated."""
    result = client.models.embed_content(
        model=os.getenv("EMBEDDING_MODEL", "gemini-embedding-001"),
        contents=texts,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT",
            output_dimensionality=768,
        ),
    )
    vectors: list[list[float] | None] = [e.values for e in result.embeddings]
    while len(vectors) < len(texts):
        vectors.append(None)
    return vectors


def get_embeddings_batch(texts: list[str]) -> list[list[float] | None]:
    """Embed many texts in a single API call.

    - Filters empty inputs.
    - Truncates each text to the embedding model's max input window.
    - Retries on transient errors with exponential backoff.
    - Returns aligned list (None for failed/skipped items).
    """
    if not texts:
        return []
    prepared = [truncate_to_tokens(t, EMBED_MAX_TOKENS) for t in texts if isinstance(t, str) and t.strip()]
    if not prepared:
        return []
    try:
        return with_retry(_embed_raw, prepared, label="embed_batch")
    except Exception as e:
        logger.error(f"get_embeddings_batch failed for {len(prepared)} items: {e}", exc_info=True)
        return [None] * len(prepared)


def get_embedding(text):
    out = get_embeddings_batch([text])
    return out[0] if out else None


# ============================================================================
# Summarisation
# ============================================================================

def _gemini_json(prompt: str, *, schema=None, max_tokens: int = 4096) -> dict | None:
    """Single Gemini call returning a parsed dict (schema-enforced if provided)."""
    config_args = {
        "temperature": 0.2,
        "max_output_tokens": max_tokens,
    }
    if schema is not None:
        config_args["response_mime_type"] = "application/json"
        config_args["response_schema"] = schema

    response = with_retry(
        client.models.generate_content,
        model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
        contents=prompt,
        config=types.GenerateContentConfig(**config_args),
        label="gemini_json",
    )
    parsed = getattr(response, "parsed", None)
    if parsed:
        return parsed
    raw = getattr(response, "text", None)
    if not raw:
        return None
    try:
        return json_repair.loads(raw)
    except Exception as e:
        logger.error(f"_gemini_json: could not parse model output: {e}")
        return None


def _gemini_text(prompt: str, *, max_tokens: int = 2048) -> str | None:
    response = with_retry(
        client.models.generate_content,
        model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=max_tokens),
        label="gemini_text",
    )
    return getattr(response, "text", None)


_DOC_PROMPT = """You are an expert Data Analyst.

Task:
Analyze the provided content and extract insights strictly according to the JSON schema.

**Field Guidelines:**
1. 'executive_overview': A concise 2-5 sentence summary of the main points.
2. 'key_insights': A list of 3-5 bullet points highlighting key insights.
3. 'index_json':
   - 'relevant_dates': Normalize to YYYY-MM-DD where possible.
   - 'entities': People, Companies, and Key Stakeholders. Use canonical names
     (e.g., "Apple Inc." not "Apple", "AAPL"; "International Business Machines"
     not "IBM"). Deduplicate variants of the same entity.
   - 'document_ids': Invoice #s, PO #s, or Reference IDs.
   - 'technical_topics': Tech stack, products, or domain jargon.
   - 'key_numbers': Notable numeric facts WITH a label. Examples:
     "Q3 2024 revenue: $4.2M", "Headcount: 250", "Conversion rate: 12%".
     Only include if the doc has concrete figures. Empty array otherwise.

Write the executive_overview and key_insights in the SAME LANGUAGE as the
input content. If content is in French, summary is in French.

--- Begin Content ---
{content}
--- End Content ---
"""

# S3 — Per-doctype prompts. Specialized prompts preserve the most important
# content for each domain. Picked at the orchestrator level based on a cheap
# heuristic over the first 2KB of content.

_FINANCIAL_PROMPT = """You are a financial analyst summarising the provided document.

Pay SPECIAL attention to:
- Revenue, earnings, growth percentages, margins
- Time periods (quarters, fiscal years, comparison periods)
- Companies, investors, board members
- Risks, guidance, forward-looking statements

Same JSON schema as before, but PRESERVE EXACT NUMBERS in 'key_insights' and
'key_numbers'. Don't paraphrase "$4.2M" as "around four million" — keep "$4.2M".

Write in the source document's language.

--- Begin Content ---
{content}
--- End Content ---
"""

_LEGAL_PROMPT = """You are a legal analyst summarising the provided document.

Pay SPECIAL attention to:
- Parties to the agreement
- Effective dates, expiration, renewal terms
- Obligations, restrictions, warranties
- Governing law, jurisdiction
- Termination conditions

Same JSON schema as before. Preserve exact clause references and dates.
DO NOT add legal opinions or interpretations — only summarise what's stated.

Write in the source document's language.

--- Begin Content ---
{content}
--- End Content ---
"""

_CODE_PROMPT = """You are a senior software engineer summarising the provided code/technical content.

Pay SPECIAL attention to:
- Public APIs, function signatures, class names
- Technology stack, frameworks, dependencies
- Configuration options, environment variables
- Architectural decisions
- Known limitations or TODOs

Same JSON schema as before. Use 'technical_topics' aggressively — every
library, language, or pattern goes there.

--- Begin Content ---
{content}
--- End Content ---
"""

# S9 — language detection. Very simple character-based heuristic that catches
# the common non-English cases without adding a 50MB language-detection lib.
# Goal isn't to identify the language precisely — it's to know "is this NOT
# English" so we can pass that signal to the LLM (which then summarizes in-language).
def _detect_language(text: str) -> str:
    sample = text[:2000]
    if not sample:
        return "en"
    # Latin-only sample is probably English/European
    non_ascii = sum(1 for c in sample if ord(c) > 127)
    ratio = non_ascii / max(1, len(sample))
    # Check specific common scripts
    if any(0x0590 <= ord(c) <= 0x05FF for c in sample[:500]): return "he"
    if any(0x0600 <= ord(c) <= 0x06FF for c in sample[:500]): return "ar"
    if any(0x4E00 <= ord(c) <= 0x9FFF for c in sample[:500]): return "zh"
    if any(0x3040 <= ord(c) <= 0x309F for c in sample[:500]): return "ja"
    if any(0xAC00 <= ord(c) <= 0xD7AF for c in sample[:500]): return "ko"
    if any(0x0900 <= ord(c) <= 0x097F for c in sample[:500]): return "hi"
    if any(0x0400 <= ord(c) <= 0x04FF for c in sample[:500]): return "ru"
    if ratio > 0.10:
        return "non-en"  # Generic non-English with extended Latin (FR/ES/DE/etc)
    return "en"


# S3 — doc-type classifier. Pattern-based, super-cheap. The first 2KB usually
# contains enough signal to route correctly. Misclassification falls back to
# the generic prompt, so the cost of a wrong guess is minimal.
def _detect_doc_type(text: str) -> str:
    sample = text[:2000].lower()
    # Code: lots of code fences or indented blocks with code-y characters.
    if sample.count("```") >= 3 or sample.count("function ") >= 3 or sample.count("def ") >= 3:
        return "code"
    # Legal: characteristic phrases.
    legal_markers = ("hereby agree", "whereas", "this agreement", "parties hereto", "governing law", "in witness whereof")
    if sum(1 for m in legal_markers if m in sample) >= 2:
        return "legal"
    # Financial: revenue/margin language + dollar amounts.
    financial_markers = ("revenue", "earnings", "fiscal", "quarter", "ebitda", "gross margin", "$")
    if sum(1 for m in financial_markers if m in sample) >= 3:
        return "financial"
    return "generic"


def _select_prompt(text: str) -> tuple[str, str]:
    """Returns (doc_type, prompt_template). Doc-type returned so callers can
    log/store the classification."""
    dtype = _detect_doc_type(text)
    if dtype == "financial":
        return dtype, _FINANCIAL_PROMPT
    if dtype == "legal":
        return dtype, _LEGAL_PROMPT
    if dtype == "code":
        return dtype, _CODE_PROMPT
    return dtype, _DOC_PROMPT

_MERGE_PROMPT = """You are an expert Data Analyst consolidating partial summaries of a long document.

You'll receive several JSON objects, each summarising a different region of the same document.
Merge them into one final JSON object that follows the same schema. Rules:

- 'executive_overview': write a fresh 2-5 sentence overview covering the whole document, not a concatenation.
- 'key_insights': 3-5 bullets covering the most important points across all regions; deduplicate.
- 'index_json' arrays: take the union, deduplicate while preserving meaningful order. Drop duplicates that differ only by case/whitespace.

--- Partial Summaries (JSON list) ---
{content}
--- End Partial Summaries ---
"""


def _empty_index() -> dict:
    return {"relevant_dates": [], "entities": [], "document_ids": [], "technical_topics": []}


def _format_summary(data: dict) -> tuple[str, dict]:
    overview = data.get("executive_overview", "No overview generated.")
    insights = data.get("key_insights", []) or []
    user_summary = f"{overview}\n\n" + "\n".join([f"- {i}" for i in insights])
    index_json = data.get("index_json", {}) or _empty_index()
    return user_summary, index_json


# S1 — Quality check on LLM output. Catches the cases where Gemini returns
# the schema but with garbage values (echoing the prompt, returning a question
# instead of an answer, length too short to be useful).
def _summary_is_bad(data: dict) -> tuple[bool, str]:
    if not data:
        return True, "empty"
    overview = (data.get("executive_overview") or "").strip()
    if len(overview) < 30:
        return True, f"overview_too_short ({len(overview)} chars)"
    # Models sometimes return a question back to the user instead of summarizing.
    if overview.endswith("?") and len(overview) < 80:
        return True, "overview_looks_like_question"
    insights = data.get("key_insights") or []
    if not isinstance(insights, list) or len(insights) == 0:
        return True, "no_insights"
    # Models occasionally echo the prompt's bullet structure as a stub.
    if all((isinstance(i, str) and len(i.strip()) < 10) for i in insights):
        return True, "insights_too_short"
    return False, ""


# S2 — Cost cap on map-reduce. A 500-page textbook → ~150 chunks → 150 LLM
# calls = $$$. Cap at MAX_MAP_CHUNKS and flag the user that the summary
# only covers the first portion. Better than silent runaway cost.
MAX_MAP_CHUNKS = 30


def _build_fallback_summary_from_partials(partials: list[dict]) -> tuple[str, dict]:
    """When the reduce step fails, return SOMETHING useful instead of
    just the first partial. Concatenate overviews with section markers,
    take the union of structured fields. Loud about being a fallback.
    """
    overviews: list[str] = []
    all_insights: list[str] = []
    merged_index = _empty_index()
    for i, p in enumerate(partials):
        ov = (p.get("executive_overview") or "").strip()
        if ov:
            overviews.append(f"[Section {i + 1}] {ov}")
        insights = p.get("key_insights") or []
        for ins in insights:
            if isinstance(ins, str) and ins.strip():
                all_insights.append(ins.strip())
        idx = p.get("index_json") or {}
        for key in ("relevant_dates", "entities", "document_ids", "technical_topics"):
            vals = idx.get(key) or []
            if isinstance(vals, list):
                merged_index[key].extend(v for v in vals if isinstance(v, str))

    # Dedupe structured fields (case-insensitive, preserve order).
    for key in merged_index:
        seen = set()
        deduped = []
        for v in merged_index[key]:
            k = v.lower().strip()
            if k and k not in seen:
                seen.add(k)
                deduped.append(v)
        merged_index[key] = deduped

    # S4 — canonicalize entities so "Apple", "Apple Inc.", "AAPL" collapse to one.
    # Cheap dedupe for short lists, LLM call only for 5-80 entities.
    if "entities" in merged_index and len(merged_index["entities"]) >= 5:
        merged_index["entities"] = canonicalize_entities(merged_index["entities"])

    fallback_overview = (
        "(Auto-assembled from partial summaries — reduce step degraded.)\n\n"
        + "\n\n".join(overviews)
    )
    return _format_summary({
        "executive_overview": fallback_overview,
        "key_insights": all_insights[:8],  # cap to keep summary readable
        "index_json": merged_index,
    })


def LLM_doc_summarize(text: str) -> tuple[str | None, dict | None]:
    """Summarise a document. Returns (summary, index_json) or (None, None).

    Pipeline:
      1. Detect doc type (financial / legal / code / generic) → choose prompt
      2. Detect language → flow through to model in chosen prompt
      3. Single-pass for docs ≤ MAP_REDUCE_TOKEN_THRESHOLD
      4. Map-reduce for larger docs, capped at MAX_MAP_CHUNKS chunks
      5. Quality-check the output; one retry if bad
      6. Reduce-step fallback: assemble partials with section markers
    """
    if not text or not text.strip():
        logger.warning("LLM_doc_summarize received empty text. Skipping API call.")
        return None, None

    total = count_tokens(text)

    # S3 — pick a prompt by doc type
    doc_type, prompt_template = _select_prompt(text)
    # S9 — detect language (for logging; the prompt itself instructs the
    # model to write in source language)
    lang = _detect_language(text)
    logger.info(f"LLM_doc_summarize: doc_type={doc_type} lang={lang} tokens={total}")

    # ----- Single-pass path -----
    if total <= MAP_REDUCE_TOKEN_THRESHOLD:
        for attempt in (1, 2):
            try:
                data = _gemini_json(prompt_template.format(content=text), schema=DOC_SUMMARY_SCHEMA)
            except Exception as e:
                logger.error(f"LLM_doc_summarize single-pass attempt {attempt} failed: {e}", exc_info=True)
                continue
            if not data:
                continue
            is_bad, reason = _summary_is_bad(data)
            if not is_bad:
                return _format_summary(data)
            logger.warning(f"summary quality check failed (attempt {attempt}): {reason} — retrying" if attempt == 1 else f"summary quality check failed twice: {reason} — accepting anyway")
            if attempt == 2:
                return _format_summary(data)
        return None, None

    # ----- Map-reduce path -----
    logger.info(f"LLM_doc_summarize: doc has {total} tokens > {MAP_REDUCE_TOKEN_THRESHOLD}, using map-reduce")
    map_chunks = chunk_text(text, target_tokens=4000, overlap_tokens=200)

    # S2: cost cap. Truncate to first MAX_MAP_CHUNKS chunks and flag in summary.
    truncated = len(map_chunks) > MAX_MAP_CHUNKS
    if truncated:
        logger.warning(
            f"map-reduce: doc has {len(map_chunks)} chunks, capping at {MAX_MAP_CHUNKS} "
            f"to control cost. Summary will only cover the first portion."
        )
        map_chunks = map_chunks[:MAX_MAP_CHUNKS]

    partials: list[dict] = []
    for c in map_chunks:
        try:
            part = _gemini_json(prompt_template.format(content=c.text), schema=DOC_SUMMARY_SCHEMA)
            if part:
                # Quality-check each partial too. Skip garbage partials.
                is_bad, reason = _summary_is_bad(part)
                if not is_bad:
                    partials.append(part)
                else:
                    logger.warning(f"map-reduce chunk {c.index} produced bad summary ({reason}) — skipping")
        except Exception as e:
            logger.warning(f"map-reduce chunk {c.index} failed (skipped): {e}")
    if not partials:
        return None, None

    # ----- Reduce step -----
    serialized = json.dumps(partials, ensure_ascii=False)
    serialized = truncate_to_tokens(serialized, MAP_REDUCE_TOKEN_THRESHOLD)
    try:
        merged = _gemini_json(_MERGE_PROMPT.format(content=serialized), schema=DOC_SUMMARY_SCHEMA)
    except Exception as e:
        logger.error(f"LLM_doc_summarize reduce step failed: {e}", exc_info=True)
        merged = None

    if merged:
        is_bad, reason = _summary_is_bad(merged)
        if not is_bad:
            result = _format_summary(merged)
            if truncated:
                summary, idx = result
                summary = f"⚠️ Summary covers first {MAX_MAP_CHUNKS} sections of {len(map_chunks)}-section doc.\n\n{summary}"
                return summary, idx
            return result
        logger.warning(f"reduce-step summary failed quality check ({reason}) — falling back to assembled partials")

    # S3: reduce failed or produced garbage. Don't silently return partials[0]
    # (which was the first 10% of the doc). Assemble all partials properly.
    logger.warning(f"Using assembled-partials fallback ({len(partials)} partials)")
    return _build_fallback_summary_from_partials(partials)


# ============================================================================
# S2 — Per-insight embeddings
# ============================================================================
# Currently we embed the joined summary as one vector. Per-insight embedding
# means embedding each key_insight separately so retrieval can match specific
# facts (e.g. "Q3 revenue was $4.2M") instead of fuzzy-averaging across all
# insights in one vector. The caller (chat-prep / save_doc) decides whether
# to use the per-insight vectors as additional Weaviate rows.

def embed_insights(index_json: dict, insights: list[str]) -> list[tuple[str, list[float]]]:
    """Return [(insight_text, embedding), ...] for each non-empty insight.
    Caller can store these as separate Weaviate rows for fine-grained
    retrieval. Falls back to empty list if embedding fails."""
    if not insights:
        return []
    # Add domain context to short insights so embeddings have more signal.
    entities = (index_json or {}).get("entities") or []
    domain_hint = " (entities: " + ", ".join(entities[:3]) + ")" if entities else ""
    enriched = [f"{i.strip()}{domain_hint}" for i in insights if isinstance(i, str) and i.strip()]
    if not enriched:
        return []
    try:
        vectors = get_embeddings_batch(enriched)
        out: list[tuple[str, list[float]]] = []
        for original, vec in zip(insights, vectors):
            if vec and isinstance(original, str) and original.strip():
                out.append((original.strip(), vec))
        return out
    except Exception as e:
        logger.warning(f"embed_insights failed: {e}")
        return []


# ============================================================================
# S4 — Entity canonicalization
# ============================================================================
# Apple/Apple Inc/AAPL all currently stored as distinct entities. This step
# uses a tiny LLM call to canonicalize a list of entity strings into one
# representative form per real entity. Bounded cost (single call) and only
# runs when entity list is long enough to be worth it.

_CANON_PROMPT = """Group these entity strings by which ones refer to the SAME real-world entity.
For each group, pick the most canonical form (full official name preferred).

Output JSON: {"groups": [{"canonical": "Apple Inc.", "variants": ["Apple", "AAPL", "Apple Inc"]}, ...]}

Entity strings (one per line):
{content}
"""

_CANON_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "groups": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "canonical": {"type": "STRING"},
                    "variants": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["canonical", "variants"],
            },
        },
    },
    "required": ["groups"],
}


def canonicalize_entities(entities: list[str]) -> list[str]:
    """Return entities deduplicated by canonical form. Skips the LLM call
    when the list is too small to benefit (< 5 entities) or too large to
    fit comfortably (> 80 entities)."""
    if not entities:
        return []
    cleaned = [e.strip() for e in entities if isinstance(e, str) and e.strip()]
    if len(cleaned) < 5 or len(cleaned) > 80:
        # Just dedupe case-insensitively for small lists; skip LLM.
        seen = set()
        out = []
        for e in cleaned:
            k = e.lower()
            if k not in seen:
                seen.add(k)
                out.append(e)
        return out
    try:
        content = "\n".join(cleaned)
        result = _gemini_json(_CANON_PROMPT.format(content=content), schema=_CANON_SCHEMA, max_tokens=2048)
        if not result or not isinstance(result.get("groups"), list):
            return cleaned
        return [g["canonical"] for g in result["groups"] if g.get("canonical")]
    except Exception as e:
        logger.warning(f"canonicalize_entities failed (returning raw list): {e}")
        return cleaned


# ============================================================================
# S10 — Multi-level summaries
# ============================================================================
# Three abstraction levels generated from one LLM call. Useful for different
# UI surfaces (file card shows short, file drawer shows medium, deep view
# shows detailed). Saves the cost of re-summarizing.

_MULTI_LEVEL_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "short": {"type": "STRING", "description": "1-sentence gist, ≤ 200 chars"},
        "medium": {"type": "STRING", "description": "2-3 sentences, ≤ 600 chars"},
        "detailed": {"type": "STRING", "description": "4-6 sentences with concrete details, ≤ 1500 chars"},
    },
    "required": ["short", "medium", "detailed"],
}

_MULTI_LEVEL_PROMPT = """Summarize this content at three different levels of detail.
Write in the source content's language. Be concrete — use specific names, numbers, dates.

--- Content ---
{content}
--- End ---
"""


def LLM_multi_level_summary(text: str) -> dict | None:
    """Returns {'short', 'medium', 'detailed'} or None on failure.
    One LLM call. Cheaper than calling LLM_doc_summarize 3 times.
    """
    if not text or not text.strip():
        return None
    # Cap input to keep the prompt small.
    truncated = truncate_to_tokens(text, 6000)
    try:
        return _gemini_json(_MULTI_LEVEL_PROMPT.format(content=truncated), schema=_MULTI_LEVEL_SCHEMA, max_tokens=1024)
    except Exception as e:
        logger.warning(f"LLM_multi_level_summary failed: {e}")
        return None


def LLM_doc_summarizer(text: str):
    """Legacy 3-tuple version kept for older callers."""
    if not text or not text.strip():
        logger.warning("LLM_doc_summarizer received empty text. Skipping API call.")
        return "No content extracted from document.", _empty_index(), []
    summary, index_json = LLM_doc_summarize(text)
    if not summary:
        return "Error generating summary.", _empty_index(), None
    embedding = get_embedding(f"{summary}\n\nKeywords: {json.dumps(index_json or {}, ensure_ascii=False)}")
    return summary, index_json, embedding


_MEDIA_PROMPT = """The following is a transcript from a dialogue, podcast, monologue, speech, or lecture.

Provide a concise summary covering:
1. The main topics discussed.
2. Key points, arguments, or conclusions by each speaker.
3. Action items or unresolved questions.
4. The overall conclusion or call to action.

Output ONLY the summary paragraph — no preamble. Don't refer to speakers as "Speaker 1" unless necessary.

**Transcript:**
{content}
"""

_MEDIA_MERGE_PROMPT = """You're consolidating partial summaries of a long transcript into one summary.

Output ONE well-structured paragraph (not a list) covering the whole transcript:
- main topics discussed
- key points / arguments / conclusions
- action items / unresolved questions
- overall conclusion or call to action

Deduplicate and drop minor repetition. Output ONLY the paragraph.

--- Partial Summaries ---
{content}
--- End ---
"""


def LLM_media_summarizer(text: str) -> tuple[str | None, None]:
    """Summarise an audio/video transcript. Map-reduces for very long content."""
    if not text or not text.strip():
        return None, None
    total = count_tokens(text)
    try:
        if total <= MAP_REDUCE_TOKEN_THRESHOLD:
            summary = _gemini_text(_MEDIA_PROMPT.format(content=text))
            return summary, None
        logger.info(f"LLM_media_summarizer: transcript {total} tokens > threshold, using map-reduce")
        partials: list[str] = []
        for c in chunk_text(text, target_tokens=4000, overlap_tokens=200):
            try:
                p = _gemini_text(_MEDIA_PROMPT.format(content=c.text))
                if p:
                    partials.append(p)
            except Exception as e:
                logger.warning(f"media map-reduce chunk {c.index} failed: {e}")
        if not partials:
            return None, None
        merged = _gemini_text(_MEDIA_MERGE_PROMPT.format(content="\n\n---\n\n".join(partials)))
        return (merged or partials[0]), None
    except Exception as e:
        logger.error(f"LLM_media_summarizer failed: {e}", exc_info=True)
        return None, None


_IMAGE_PROMPT = """The following text was extracted from an image using OCR and may contain errors or be out of order.

First, mentally reconstruct it into a clean coherent document.
Then output ONLY a concise summary paragraph — no preamble, no reconstructed text.

**Raw OCR Text:**
{content}
"""


def LLM_image_summarizer(text: str) -> tuple[str | None, None]:
    if not text or not text.strip():
        return None, None
    try:
        return _gemini_text(_IMAGE_PROMPT.format(content=text)), None
    except Exception as e:
        logger.error(f"LLM_image_summarizer failed: {e}", exc_info=True)
        return None, None


_CAPTION_PROMPT = """Provide a comprehensive, detailed description of the following image. Cover:

* **Main Subject(s):** Who/what is the focus. Appearance, clothing, actions.
* **Setting & Background:** Where it's taking place. Environment, time of day, landmarks.
* **Composition & Mood:** Composition, lighting, overall mood.
* **Other Details:** Notable objects, animals, text, or details.

Output a single well-structured concise paragraph."""


def LLM_caption_generator(image_path: str) -> tuple[str | None, None]:
    try:
        with Image.open(image_path) as img:
            response = with_retry(
                client.models.generate_content,
                model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
                contents=[_CAPTION_PROMPT, img],
                label="gemini_caption",
            )
        return getattr(response, "text", None), None
    except Exception as e:
        logger.error(f"LLM_caption_generator failed: {e}", exc_info=True)
        return None, None
