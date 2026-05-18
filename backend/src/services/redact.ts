/**
 * PII redaction applied to text BEFORE it's sent to the embedding API.
 *
 * Why: modern embedding models can be partially inverted — vectors leak some
 * of their input. We don't want SSNs, API keys, or credit card numbers to be
 * recoverable from stored vectors. So we strip them from the *embedding* input
 * while keeping the original `chunk_text` intact for retrieval display + the
 * LLM answer prompt. The model still sees real values when forming an answer;
 * what we change is what gets stored as a numeric vector.
 *
 * Trade-off: redaction reduces semantic recall for queries that literally
 * match the redacted patterns (e.g. searching for an exact phone number).
 * The user can still find those via the BM25 side of the hybrid search.
 */

export type Redaction = { kind: string; count: number };

export type RedactResult = {
    redactedText: string;
    redactions: Redaction[];
    totalRedactions: number;
};

// Each rule replaces matches with a token like `[REDACTED:EMAIL]` so the
// embedding still has a semantic anchor ("there's an email here") without
// memorising the actual address.
type Rule = { kind: string; re: RegExp; replacement: string; validate?: (m: string) => boolean };

const luhn = (digits: string): boolean => {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = digits.charCodeAt(i) - 48;
        if (n < 0 || n > 9) return false;
        if (alt) {
            n *= 2;
            if (n > 9) n -= 9;
        }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
};

const RULES: Rule[] = [
    // Email
    { kind: "EMAIL", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[REDACTED:EMAIL]" },

    // US SSN (xxx-xx-xxxx). Limited validation: avoid 000/666/9xx areas.
    {
        kind: "SSN",
        re: /\b(?!000|666|9\d\d)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g,
        replacement: "[REDACTED:SSN]",
    },

    // Credit card (13–19 digits, with Luhn check to cut false positives).
    {
        kind: "CREDIT_CARD",
        re: /\b(?:\d[ -]*?){13,19}\b/g,
        replacement: "[REDACTED:CREDIT_CARD]",
        validate: (m) => {
            const digits = m.replace(/\D/g, "");
            return digits.length >= 13 && digits.length <= 19 && luhn(digits);
        },
    },

    // International phone (E.164-ish) + common US formats.
    {
        kind: "PHONE",
        re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){1,3}\d{3,4}[\s.-]?\d{3,4}\b/g,
        replacement: "[REDACTED:PHONE]",
        validate: (m) => {
            const digits = m.replace(/\D/g, "");
            return digits.length >= 10 && digits.length <= 15;
        },
    },

    // API keys — common prefixes
    { kind: "API_KEY", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED:API_KEY]" },
    { kind: "API_KEY", re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED:AWS_ACCESS_KEY]" },
    { kind: "API_KEY", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, replacement: "[REDACTED:GITHUB_TOKEN]" },
    { kind: "API_KEY", re: /\bxox[abps]-[A-Za-z0-9-]{10,}\b/g, replacement: "[REDACTED:SLACK_TOKEN]" },

    // JWT (header.payload.signature, base64url)
    { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: "[REDACTED:JWT]" },

    // IPv4 (skip 0.0.0.0 / 127.x / 10.x / 192.168.x / 172.16-31.x — those are uninteresting)
    {
        kind: "IPV4",
        re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
        replacement: "[REDACTED:IP]",
        validate: (m) => {
            const parts = m.split(".").map((p) => parseInt(p, 10));
            if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
            // Skip private/loopback/multicast to reduce noise.
            const [a, b] = parts;
            if (a === 0 || a === 127) return false;
            if (a === 10) return false;
            if (a === 192 && b === 168) return false;
            if (a === 172 && b >= 16 && b <= 31) return false;
            if (a >= 224) return false;
            return true;
        },
    },
];

export const redactPII = (text: string): RedactResult => {
    if (!text) return { redactedText: text, redactions: [], totalRedactions: 0 };
    let working = text;
    const counts: Record<string, number> = {};
    for (const rule of RULES) {
        working = working.replace(rule.re, (m) => {
            if (rule.validate && !rule.validate(m)) return m;
            counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
            return rule.replacement;
        });
    }
    const redactions: Redaction[] = Object.entries(counts).map(([kind, count]) => ({ kind, count }));
    const totalRedactions = redactions.reduce((s, r) => s + r.count, 0);
    return { redactedText: working, redactions, totalRedactions };
};

/** Batched variant: returns aligned `redactedText[]`. Other metadata is summed. */
export const redactBatch = (texts: string[]): { redactedTexts: string[]; totalRedactions: number } => {
    let total = 0;
    const redactedTexts = texts.map((t) => {
        const r = redactPII(t);
        total += r.totalRedactions;
        return r.redactedText;
    });
    return { redactedTexts, totalRedactions: total };
};
