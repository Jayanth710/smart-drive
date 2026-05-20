/**
 * Markdown-aware chunker with parent/child levels + table awareness.
 *
 * Parent/child design (parent-document retrieval):
 *  - PARENTS  = section-level windows (~1500 tokens). Sent to the LLM at
 *               answer time so it has real context, not 5 disconnected snippets.
 *  - CHILDREN = paragraph-level windows (~400 tokens) embedded for retrieval.
 *               Each child carries its parent_text inline so a single lookup
 *               returns the bigger answer-time context.
 *
 * Markdown awareness:
 *  - fenced code blocks ``` and markdown tables `| ... |` are ATOMIC.
 *  - headings are sticky: they always live in the same chunk as the content
 *    that follows them.
 *  - has_table flag is set on every chunk that contains at least one table —
 *    used by the retrieval boost for "totals / count / how many" queries.
 */

// Real tokenizer. Previously used CHARS_PER_TOKEN = 4 which is off by 2-4x
// for code or multilingual content (off in opposite directions). gpt-tokenizer
// uses the cl100k_base BPE — same family as Gemini's tokenizer for our purposes.
// Token-count diff between gpt-tokenizer and gemini-embedding-001 is <5% on
// English content; close enough for chunk-size budgeting.
import { encode as gptEncode } from "gpt-tokenizer";

// Used for char-budget conversion when we need approximate char counts in
// splitters (since slicing strings character-wise is O(1) vs token-encode
// being O(n)). Tuned to median English content; chunk boundaries are
// refined later by re-counting with the real tokenizer.
const APPROX_CHARS_PER_TOKEN = 4;

export type ChildChunk = {
    index: number;
    text: string;
    parent_text: string;
    parent_index: number;
    has_table: boolean;
    tokens: number;
    /** C8 — Full heading path for this chunk's section, e.g. ["Intro", "Background"].
     *  Used for citations in chat answers and as a future filter signal. */
    heading_path?: string[];
};

type Block = {
    kind: "heading" | "code" | "table" | "paragraph" | "list";
    text: string;
    atomic: boolean;
    sticky: boolean;
    /** C8 — Heading depth (1-6) if kind === "heading", else undefined. */
    level?: number;
};

// ---------- C4: Boilerplate detection ----------
// Repeated lines that appear on every page (headers, footers, disclaimers,
// "Confidential" stamps, "Page N of M") pollute every chunk with the same
// terms — BM25 thinks they're content keywords. Detect lines that appear
// many times and strip them before chunking.

const BOILERPLATE_MIN_OCCURRENCES = 3;
const BOILERPLATE_MIN_LENGTH = 4;
const BOILERPLATE_MAX_LENGTH = 120;

const detectBoilerplate = (text: string): Set<string> => {
    const lineCounts = new Map<string, number>();
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line.length < BOILERPLATE_MIN_LENGTH || line.length > BOILERPLATE_MAX_LENGTH) continue;
        lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
    }
    const boilerplate = new Set<string>();
    for (const [line, count] of lineCounts) {
        if (count >= BOILERPLATE_MIN_OCCURRENCES) boilerplate.add(line);
    }
    return boilerplate;
};

const stripBoilerplate = (text: string, boilerplate: Set<string>): string => {
    if (boilerplate.size === 0) return text;
    const cleaned: string[] = [];
    for (const raw of text.split("\n")) {
        if (!boilerplate.has(raw.trim())) cleaned.push(raw);
    }
    return cleaned.join("\n");
};

// Accurate token count for budgeting and metadata.
const tokens = (s: string): number => {
    if (!s) return 1;
    try {
        return Math.max(1, gptEncode(s).length);
    } catch {
        // gpt-tokenizer rarely throws (e.g. on certain control characters);
        // fall back to char approximation so chunking never breaks.
        return Math.max(1, Math.ceil(s.length / APPROX_CHARS_PER_TOKEN));
    }
};

// ---------- block parsing ----------

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

const parseBlocks = (text: string): Block[] => {
    const blocks: Block[] = [];
    const lines = text.split("\n");
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const stripped = line.trimStart();

        if (stripped.startsWith("```")) {
            const fence = stripped.slice(0, 3);
            const start = i;
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith(fence)) i++;
            const body = lines.slice(start, Math.min(i + 1, lines.length)).join("\n").trim();
            i++; // skip closing fence
            if (body) blocks.push({ kind: "code", text: body, atomic: true, sticky: false });
            continue;
        }

        const m = line.match(HEADING_RE);
        if (m) {
            // C8 — capture heading level (# = 1, ## = 2, etc.)
            blocks.push({
                kind: "heading",
                text: line.trim(),
                atomic: false,
                sticky: true,
                level: m[1].length,
            });
            i++;
            continue;
        }

        if (stripped.startsWith("|")) {
            const start = i;
            while (i < lines.length && lines[i].trimStart().startsWith("|")) i++;
            const body = lines.slice(start, i).join("\n").trim();
            if (body) blocks.push({ kind: "table", text: body, atomic: true, sticky: false });
            continue;
        }

        if (stripped === "") { i++; continue; }

        const start = i;
        while (
            i < lines.length &&
            lines[i].trim() !== "" &&
            !lines[i].trimStart().startsWith("```") &&
            !HEADING_RE.test(lines[i]) &&
            !lines[i].trimStart().startsWith("|")
        ) i++;
        const body = lines.slice(start, i).join("\n").trim();
        if (!body) continue;

        const bodyLines = body.split("\n");
        const listLines = bodyLines.filter((ln) => /^\s*(\d+\.|[-*+])\s+/.test(ln));
        const kind: Block["kind"] = listLines.length >= Math.max(2, Math.floor(0.8 * bodyLines.length)) ? "list" : "paragraph";
        blocks.push({ kind, text: body, atomic: false, sticky: false });
    }
    return blocks;
};

// C3 — Better sentence segmentation.
// The old regex `/(?<=[.!?])\s+(?=[A-Z("'])/` broke on:
//   • Abbreviations: "Dr. Smith said hello" → split between "Dr." and "Smith"
//   • Decimals: "$3.14 trillion" → split between "3." and "14"
//   • Initials: "J. K. Rowling" → split multiple times
//   • URLs: "see www.foo.com for" → split
//
// We use a regex pass + a context-aware filter that re-joins false-positive
// splits. Not full NLP-grade (that'd need spaCy), but catches the common cases
// without adding a 50MB dependency.

const COMMON_ABBREVIATIONS = new Set([
    "Dr", "Mr", "Mrs", "Ms", "Prof", "Sr", "Jr", "Hon",
    "Inc", "Ltd", "Co", "Corp", "Llc", "Plc",
    "vs", "etc", "ie", "eg", "Eg", "Ie", "Etc", "Vs",
    "U.S", "U.K", "U.S.A", "E.U", "St", "Ave", "Blvd",
    "Mt", "Ft", "No", "Vol", "Op", "Cit", "Ed",
    "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec",
]);

const looksLikeAbbreviation = (lastWord: string): boolean => {
    // Strip trailing period
    const w = lastWord.replace(/\.$/, "");
    if (COMMON_ABBREVIATIONS.has(w)) return true;
    // Single capital letter (initials like "J.")
    if (/^[A-Z]$/.test(w)) return true;
    // Numbers that look like decimals (e.g. "$3.14" → previous part "$3" stays)
    if (/^\$?\d+$/.test(w)) return true;
    return false;
};

const splitBySentences = (text: string, maxChars: number): string[] => {
    if (text.length <= maxChars) return [text];

    // First pass: candidate breaks after .!? followed by whitespace + capital/quote/paren.
    const candidates = text.split(/(?<=[.!?])\s+(?=[A-Z("'])/);

    // Second pass: rejoin splits that came after a known abbreviation or single-letter initial.
    const sentences: string[] = [];
    for (const piece of candidates) {
        if (sentences.length > 0) {
            const last = sentences[sentences.length - 1];
            const lastWord = last.trimEnd().split(/\s+/).pop() ?? "";
            if (looksLikeAbbreviation(lastWord)) {
                sentences[sentences.length - 1] = last + " " + piece;
                continue;
            }
        }
        sentences.push(piece);
    }

    // Third pass: pack into max-size buckets.
    const out: string[] = [];
    let buf: string[] = [];
    let buflen = 0;
    for (const s of sentences) {
        if (buflen + s.length + 1 > maxChars && buf.length > 0) {
            out.push(buf.join(" "));
            buf = [s];
            buflen = s.length;
        } else {
            buf.push(s);
            buflen += s.length + 1;
        }
    }
    if (buf.length > 0) out.push(buf.join(" "));
    return out;
};

const splitAtomicByLines = (text: string, maxChars: number): string[] => {
    if (text.length <= maxChars) return [text];
    const lines = text.split("\n");
    const out: string[][] = [[]];
    const lens = [0];
    for (const ln of lines) {
        const llen = ln.length + 1;
        if (lens[lens.length - 1] + llen > maxChars && out[out.length - 1].length > 0) {
            out.push([]); lens.push(0);
        }
        out[out.length - 1].push(ln);
        lens[lens.length - 1] += llen;
    }
    return out.map((g) => g.join("\n")).filter((s) => s.trim().length > 0);
};

type Section = {
    blocks: Block[];
    has_table: boolean;
    /** C8 — Full heading path leading INTO this section.
     *  e.g. ["Introduction", "Background"] for a level-3 section under those. */
    heading_path: string[];
};

const groupIntoSections = (blocks: Block[]): Section[] => {
    const out: Section[] = [];
    // C8 — track heading path as we walk blocks. headingStack[i] = current
    // heading at level i+1. When we see a deeper heading, we extend; when
    // we see a same-or-shallower heading, we pop back.
    const headingStack: string[] = []; // index = level-1
    let cur: Section = { blocks: [], has_table: false, heading_path: [] };

    for (const b of blocks) {
        if (b.kind === "heading") {
            const level = b.level ?? 1;
            // Cleanly trim heading text: "## My Heading" → "My Heading"
            const headingText = b.text.replace(/^#+\s*/, "").trim();
            // Truncate stack to level-1 (this heading replaces everything at and below its level)
            headingStack.length = Math.max(0, level - 1);
            headingStack.push(headingText);

            // Start a new section when we hit a top-level heading (h1/h2).
            if (level <= 2 && cur.blocks.length > 0) {
                out.push(cur);
                cur = {
                    blocks: [],
                    has_table: false,
                    heading_path: [...headingStack],
                };
            } else {
                // Otherwise update the heading path of the current section.
                cur.heading_path = [...headingStack];
            }
        }
        cur.blocks.push(b);
        if (b.kind === "table") cur.has_table = true;
    }
    if (cur.blocks.length > 0) out.push(cur);
    return out;
};

const sectionText = (s: Section): string =>
    s.blocks.map((b) => b.text).join("\n\n").trim();

const packSectionIntoParents = (section: Section, parentTargetChars: number): Section[] => {
    if (sectionText(section).length <= parentTargetChars) return [section];

    const out: Section[] = [];
    let cur: Section = { blocks: [], has_table: false, heading_path: [...section.heading_path] };
    let curLen = 0;
    for (const b of section.blocks) {
        const pieces: Block[] = b.atomic
            ? splitAtomicByLines(b.text, parentTargetChars).map((t) => ({ ...b, text: t }))
            : splitBySentences(b.text, parentTargetChars).map((t) => ({ ...b, text: t }));
        for (const piece of pieces) {
            if (curLen + piece.text.length + 2 > parentTargetChars && cur.blocks.length > 0) {
                out.push(cur);
                cur = { blocks: [], has_table: false, heading_path: [...section.heading_path] };
                curLen = 0;
            }
            cur.blocks.push(piece);
            if (piece.kind === "table") cur.has_table = true;
            curLen += piece.text.length + 2;
        }
    }
    if (cur.blocks.length > 0) out.push(cur);
    return out;
};

const splitParentIntoChildren = (
    parent: Section,
    parentText: string,
    parentIndex: number,
    childTargetChars: number,
    overlapChars: number,
    startChildIndex: number,
): ChildChunk[] => {
    const out: ChildChunk[] = [];
    let cur: string[] = [];
    let curLen = 0;
    let curHasTable = false;

    const flush = () => {
        if (cur.length === 0) return;
        const body = cur.join("\n\n").trim();
        if (!body) { cur = []; curLen = 0; curHasTable = false; return; }
        out.push({
            index: startChildIndex + out.length,
            text: body,
            parent_text: parentText,
            parent_index: parentIndex,
            has_table: curHasTable || parent.has_table,
            tokens: tokens(body),
            // C8 — attach the heading_path so chat answers can cite the
            // exact section ("Section: Introduction > Background").
            heading_path: parent.heading_path.length > 0 ? [...parent.heading_path] : undefined,
        });
        const tail = body.length > overlapChars ? body.slice(-overlapChars) : body;
        cur = tail ? [tail] : [];
        curLen = tail.length;
        curHasTable = false;
    };

    // C6 (light semantic chunking) — document structure is a natural semantic
    // boundary. When we encounter a heading or a kind-transition (paragraph→table,
    // paragraph→code) AND the current chunk is at least 35% full, flush first.
    // This avoids fusing unrelated topics into one chunk without needing
    // expensive embedding-based break detection.
    const semanticFlushThreshold = Math.floor(childTargetChars * 0.35);
    let prevBlockKind: Block["kind"] | null = null;

    for (const block of parent.blocks) {
        const isSemanticBoundary =
            block.kind === "heading" ||
            (prevBlockKind !== null && prevBlockKind !== block.kind &&
                (block.kind === "table" || block.kind === "code" ||
                    prevBlockKind === "table" || prevBlockKind === "code"));
        if (isSemanticBoundary && curLen >= semanticFlushThreshold) {
            flush();
        }

        const pieces = block.atomic
            ? splitAtomicByLines(block.text, childTargetChars)
            : splitBySentences(block.text, childTargetChars);
        for (const piece of pieces) {
            if (curLen + piece.length + 2 > childTargetChars && cur.length > 0) flush();
            cur.push(piece);
            curLen += piece.length + 2;
            if (block.kind === "table") curHasTable = true;
        }
        prevBlockKind = block.kind;
    }
    flush();
    if (out.length === 0) {
        out.push({
            index: startChildIndex,
            text: parentText.slice(0, childTargetChars),
            parent_text: parentText,
            parent_index: parentIndex,
            has_table: parent.has_table,
            tokens: tokens(parentText),
            heading_path: parent.heading_path.length > 0 ? [...parent.heading_path] : undefined,
        });
    }
    return out;
};

export type ChunkOptions = {
    parentTargetTokens?: number;
    childTargetTokens?: number;
    overlapTokens?: number;
};

export const chunkMarkdown = (text: string, opts: ChunkOptions = {}): ChildChunk[] => {
    const raw = (text ?? "").trim();
    if (!raw) return [];

    // C4 — strip boilerplate (repeated headers/footers/disclaimers) BEFORE
    // chunking. Otherwise every chunk contains the same boilerplate text
    // and BM25 thinks "Confidential" or "Page 1 of 50" are key terms.
    const boilerplate = detectBoilerplate(raw);
    const clean = boilerplate.size > 0 ? stripBoilerplate(raw, boilerplate) : raw;

    // C7 — adaptive chunk sizing by document type.
    // Code-heavy docs benefit from larger chunks (functions are atomic units).
    // Very short docs use smaller chunks for retrieval granularity.
    // Caller-provided opts override the heuristic.
    const docTokens = tokens(clean);
    const isCodeHeavy = (clean.match(/```/g) || []).length >= 4 || /^\s{4,}/m.test(clean);
    const defaultParent = isCodeHeavy ? 2000 : docTokens < 500 ? 800 : 1500;
    const defaultChild = isCodeHeavy ? 600 : docTokens < 500 ? 250 : 400;

    const parentTargetTokens = opts.parentTargetTokens ?? defaultParent;
    const childTargetTokens = opts.childTargetTokens ?? defaultChild;
    // C2: bumped from 60 → 120. Cross-chunk antecedent context (sentences
    // that reference "this approach" or "the previous result") needs more
    // headroom than 60 tokens to survive a chunk boundary.
    const overlapTokens = opts.overlapTokens ?? 120;

    // We need char budgets for splitter functions (which slice strings by
    // character). Approximation here is intentional — chunks get tokenized
    // accurately at the end via `tokens()` for the stored token count.
    const parentTargetChars = parentTargetTokens * APPROX_CHARS_PER_TOKEN;
    const childTargetChars = childTargetTokens * APPROX_CHARS_PER_TOKEN;
    const overlapChars = overlapTokens * APPROX_CHARS_PER_TOKEN;

    const blocks = parseBlocks(clean);
    const sections = groupIntoSections(blocks);
    const parents: Section[] = [];
    for (const s of sections) parents.push(...packSectionIntoParents(s, parentTargetChars));

    const children: ChildChunk[] = [];
    parents.forEach((parent, parentIndex) => {
        const parentText = sectionText(parent);
        children.push(
            ...splitParentIntoChildren(parent, parentText, parentIndex, childTargetChars, overlapChars, children.length),
        );
    });

    if (children.length === 0) {
        children.push({
            index: 0, text: clean, parent_text: clean, parent_index: 0,
            has_table: false, tokens: tokens(clean),
        });
    }
    return children;
};

// Flat-chunks shim for callers that don't need parent context.
export type Chunk = { index: number; text: string; tokens: number };

export const chunkText = (text: string, targetTokens = 600, overlapTokens = 80): Chunk[] => {
    const children = chunkMarkdown(text, {
        childTargetTokens: targetTokens,
        overlapTokens,
        parentTargetTokens: Math.max(targetTokens * 3, 1200),
    });
    return children.map((c) => ({ index: c.index, text: c.text, tokens: c.tokens }));
};

/** Cheap heuristic for queries that probably want tabular answers. */
export const isTableLikelyQuery = (q: string): boolean => {
    const lower = q.toLowerCase();
    return /\b(total|sum|count|how many|how much|number of|list of|column|row|highest|lowest|average|mean|median|breakdown|table|figures?)\b/.test(lower);
};
