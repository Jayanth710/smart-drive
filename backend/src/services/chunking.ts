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

const CHARS_PER_TOKEN = 4;

export type ChildChunk = {
    index: number;
    text: string;
    parent_text: string;
    parent_index: number;
    has_table: boolean;
    tokens: number;
};

type Block = {
    kind: "heading" | "code" | "table" | "paragraph" | "list";
    text: string;
    atomic: boolean;
    sticky: boolean;
};

const tokens = (s: string): number => Math.max(1, Math.ceil(s.length / CHARS_PER_TOKEN));

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
            blocks.push({ kind: "heading", text: line.trim(), atomic: false, sticky: true });
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

const splitBySentences = (text: string, maxChars: number): string[] => {
    if (text.length <= maxChars) return [text];
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z(\"'])/);
    const out: string[] = [];
    let buf: string[] = [];
    let buflen = 0;
    for (const s of sentences) {
        if (buflen + s.length + 1 > maxChars && buf.length > 0) {
            out.push(buf.join(" "));
            buf = [s]; buflen = s.length;
        } else {
            buf.push(s); buflen += s.length + 1;
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

type Section = { blocks: Block[]; has_table: boolean };

const groupIntoSections = (blocks: Block[]): Section[] => {
    const out: Section[] = [];
    let cur: Section = { blocks: [], has_table: false };
    for (const b of blocks) {
        if (b.kind === "heading") {
            const level = (b.text.match(/^(#+)/)?.[1].length ?? 1);
            if (level <= 2 && cur.blocks.length > 0) {
                out.push(cur);
                cur = { blocks: [], has_table: false };
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
    let cur: Section = { blocks: [], has_table: false };
    let curLen = 0;
    for (const b of section.blocks) {
        const pieces: Block[] = b.atomic
            ? splitAtomicByLines(b.text, parentTargetChars).map((t) => ({ ...b, text: t }))
            : splitBySentences(b.text, parentTargetChars).map((t) => ({ ...b, text: t }));
        for (const piece of pieces) {
            if (curLen + piece.text.length + 2 > parentTargetChars && cur.blocks.length > 0) {
                out.push(cur);
                cur = { blocks: [], has_table: false };
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
        });
        const tail = body.length > overlapChars ? body.slice(-overlapChars) : body;
        cur = tail ? [tail] : [];
        curLen = tail.length;
        curHasTable = false;
    };

    for (const block of parent.blocks) {
        const pieces = block.atomic
            ? splitAtomicByLines(block.text, childTargetChars)
            : splitBySentences(block.text, childTargetChars);
        for (const piece of pieces) {
            if (curLen + piece.length + 2 > childTargetChars && cur.length > 0) flush();
            cur.push(piece);
            curLen += piece.length + 2;
            if (block.kind === "table") curHasTable = true;
        }
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
    const clean = (text ?? "").trim();
    if (!clean) return [];
    const parentTargetTokens = opts.parentTargetTokens ?? 1500;
    const childTargetTokens = opts.childTargetTokens ?? 400;
    const overlapTokens = opts.overlapTokens ?? 60;

    const parentTargetChars = parentTargetTokens * CHARS_PER_TOKEN;
    const childTargetChars = childTargetTokens * CHARS_PER_TOKEN;
    const overlapChars = overlapTokens * CHARS_PER_TOKEN;

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
