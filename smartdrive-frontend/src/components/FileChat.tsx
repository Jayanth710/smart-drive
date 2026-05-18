"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
    IconSend, IconLoader2, IconUser, IconSparkles, IconAlertTriangle,
    IconShieldCheck, IconCircleDashed, IconCircleX, IconPlayerStop,
    IconCopy, IconCheck, IconRefresh, IconLock,
} from "@tabler/icons-react";
import { postSSE, Source, Confidence, StreamEvent } from "@/lib/chatStream";
import { ChatMarkdown } from "./ChatMarkdown";

type Turn = {
    role: "user" | "assistant";
    content: string;
    sources?: Source[];
    confidence?: Confidence;
    refused?: boolean;
    rewritten_query?: string;
    streaming?: boolean;
};

type Props = { fileId: string; fileName: string; ready: boolean };

function ConfidencePill({ value }: { value: Confidence }) {
    if (value === "high") return (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <IconShieldCheck size={10} /> High
        </span>
    );
    if (value === "medium") return (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <IconCircleDashed size={10} /> Medium
        </span>
    );
    if (value === "low") return (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-orange-500/15 text-orange-700 dark:text-orange-300">
            <IconCircleDashed size={10} /> Low
        </span>
    );
    return (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
            <IconCircleX size={10} /> Not in file
        </span>
    );
}

function CopyButton({ text }: { text: string }) {
    const [done, setDone] = useState(false);
    return (
        <button
            onClick={async () => {
                try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* clipboard might be unavailable */ }
            }}
            title="Copy answer"
            className="text-muted-foreground hover:text-foreground transition"
        >
            {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
    );
}

export function FileChat({ fileId, fileName, ready }: Props) {
    const storageKey = `chat-history:file:${fileId}`;
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [preparing, setPreparing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [redactions, setRedactions] = useState<number>(0);
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const cancelRef = useRef<(() => void) | null>(null);
    const streamingBufferRef = useRef<string>("");
    const hydratedRef = useRef(false);

    // Restore history on mount / file change.
    useEffect(() => {
        cancelRef.current?.();
        streamingBufferRef.current = "";
        setInput("");
        setError(null);
        setPreparing(false);
        hydratedRef.current = false;
        try {
            const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
            const parsed: Turn[] = raw ? JSON.parse(raw) : [];
            // Drop any stale "streaming" flags from prior sessions.
            setTurns(parsed.map((t) => ({ ...t, streaming: false })));
        } catch {
            setTurns([]);
        }
        hydratedRef.current = true;
    }, [fileId, storageKey]);

    // Persist (but never persist an in-flight streaming turn).
    useEffect(() => {
        if (!hydratedRef.current) return;
        try {
            const safe = turns.filter((t) => !t.streaming);
            window.localStorage.setItem(storageKey, JSON.stringify(safe.slice(-30)));
        } catch { /* quota or private-mode */ }
    }, [turns, storageKey]);

    // Cancel any in-flight stream when the user leaves this view entirely.
    useEffect(() => () => cancelRef.current?.(), []);

    useEffect(() => {
        const node = scrollerRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [turns, busy, preparing]);

    // Auto-grow textarea.
    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = Math.min(160, ta.scrollHeight) + "px";
    }, [input]);

    const patchLastAssistant = (patch: Partial<Turn>) => {
        setTurns((prev) => {
            const out = [...prev];
            for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].role === "assistant") {
                    out[i] = { ...out[i], ...patch };
                    break;
                }
            }
            return out;
        });
    };

    const stop = () => {
        cancelRef.current?.();
        cancelRef.current = null;
        patchLastAssistant({ streaming: false });
        setBusy(false);
        setPreparing(false);
    };

    const runChat = useCallback((msg: string, historyForRequest: Turn[]) => {
        setError(null);
        setBusy(true);
        const isFirstTurn = historyForRequest.length === 0;
        if (isFirstTurn) setPreparing(true);

        streamingBufferRef.current = "";
        setTurns((prev) => [
            ...prev,
            { role: "user", content: msg },
            { role: "assistant", content: "", streaming: true },
        ]);

        cancelRef.current = postSSE(
            `/file/${fileId}/chat-stream`,
            { message: msg, history: historyForRequest.map(({ role, content }) => ({ role, content })) },
            {
                onEvent: (event: StreamEvent) => {
                    switch (event.type) {
                        case "ready":
                            setPreparing(false);
                            if (typeof event.redactions === "number" && event.redactions > 0) {
                                setRedactions(event.redactions);
                            }
                            break;
                        case "prep":
                            patchLastAssistant({ rewritten_query: event.rewritten_query });
                            setPreparing(false);
                            break;
                        case "no_sources": patchLastAssistant({ content: "" }); break;
                        case "delta":
                            streamingBufferRef.current += event.text;
                            patchLastAssistant({ content: streamingBufferRef.current });
                            break;
                        case "done":
                            streamingBufferRef.current = "";
                            patchLastAssistant({
                                content: event.answer, sources: event.sources, confidence: event.confidence,
                                refused: event.refused, rewritten_query: event.rewritten_query, streaming: false,
                            });
                            setBusy(false);
                            break;
                        case "error":
                            patchLastAssistant({
                                content: "Stream failed. Please retry.", streaming: false, refused: true, confidence: "none",
                            });
                            setBusy(false);
                            break;
                    }
                },
                onError: (err) => {
                    setError(err.message || "Stream failed.");
                    patchLastAssistant({ streaming: false });
                    setBusy(false);
                    setPreparing(false);
                },
            },
        );
    }, [fileId]);

    const send = () => {
        const msg = input.trim();
        if (!msg || busy || !ready) return;
        setInput("");
        runChat(msg, turns);
    };

    const regenerate = () => {
        if (busy) return;
        // Find the last user message and the assistant turn that follows it.
        const lastUserIdx = (() => {
            for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "user") return i;
            return -1;
        })();
        if (lastUserIdx === -1) return;
        const lastUserMsg = turns[lastUserIdx].content;
        const truncated = turns.slice(0, lastUserIdx);
        setTurns(truncated);
        runChat(lastUserMsg, truncated);
    };

    const clearChat = () => {
        cancelRef.current?.();
        setTurns([]);
        try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    };

    if (!ready) {
        return (
            <div className="rounded-lg border p-6 text-sm text-muted-foreground text-center">
                <IconAlertTriangle size={20} className="mx-auto mb-2 text-amber-500" />
                Chat is available once extraction completes.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {(turns.length > 0 || redactions > 0) && (
                <div className="flex items-center justify-between gap-2 -mb-1">
                    <div className="flex items-center gap-2">
                        {redactions > 0 && (
                            <span
                                className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"
                                title="Personal info (emails, phone numbers, API keys) was stripped before embeddings to protect privacy."
                            >
                                <IconLock size={10} /> {redactions} PII span{redactions === 1 ? "" : "s"} redacted
                            </span>
                        )}
                    </div>
                    {turns.length > 0 && (
                        <button
                            onClick={clearChat}
                            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        >
                            Clear chat
                        </button>
                    )}
                </div>
            )}

            <div
                ref={scrollerRef}
                className="rounded-lg border bg-muted/20 px-3 py-3 min-h-[200px] max-h-[55vh] sm:max-h-[40vh] overflow-y-auto space-y-3"
            >
                {turns.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-8 text-sm text-muted-foreground">
                        <IconSparkles size={20} className="mb-2 opacity-70" />
                        Ask anything about <span className="font-medium text-foreground">&ldquo;{fileName}&rdquo;</span>.
                        <div className="text-xs mt-1 opacity-70">
                            Answers cite the file&apos;s own content. The first message may take a few extra seconds while we prepare the index.
                        </div>
                        <div className="text-[11px] mt-3 opacity-70 max-w-sm">
                            Try: <em>&ldquo;Summarize the key points.&rdquo;</em> · <em>&ldquo;What dates are mentioned?&rdquo;</em> · <em>&ldquo;Find any totals or amounts.&rdquo;</em>
                        </div>
                    </div>
                ) : (
                    turns.map((t, i) => (
                        <div key={i} className="flex gap-2">
                            <div className="shrink-0 mt-0.5 text-muted-foreground">
                                {t.role === "user" ? <IconUser size={14} /> : <IconSparkles size={14} />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                        {t.role === "user" ? "You" : "Assistant"}
                                    </div>
                                    {t.role === "assistant" && t.confidence && <ConfidencePill value={t.confidence} />}
                                    {t.role === "assistant" && t.streaming && (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                            <IconLoader2 size={10} className="animate-spin" />
                                            {preparing ? "preparing index…" : "streaming…"}
                                        </span>
                                    )}
                                    {/* Per-message actions */}
                                    {t.role === "assistant" && !t.streaming && t.content && (
                                        <div className="ml-auto flex items-center gap-2">
                                            <CopyButton text={t.content} />
                                            {i === turns.length - 1 && (
                                                <button
                                                    onClick={regenerate}
                                                    disabled={busy}
                                                    title="Regenerate answer"
                                                    className="text-muted-foreground hover:text-foreground disabled:opacity-50 transition"
                                                >
                                                    <IconRefresh size={12} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {t.role === "assistant" && t.rewritten_query && (
                                    <div className="text-[10px] text-muted-foreground italic mt-0.5">
                                        Searched as: <span className="text-foreground/70">&ldquo;{t.rewritten_query}&rdquo;</span>
                                    </div>
                                )}
                                <div className={`mt-0.5 break-words ${t.refused ? "text-muted-foreground" : ""}`}>
                                    {t.role === "assistant" ? (
                                        t.content
                                            ? <ChatMarkdown>{t.content}</ChatMarkdown>
                                            : <span className="text-sm">{t.streaming ? "…" : ""}</span>
                                    ) : (
                                        <span className="text-sm whitespace-pre-wrap">{t.content}</span>
                                    )}
                                </div>
                                {t.role === "assistant" && t.sources && t.sources.length > 0 && (
                                    <details className="mt-1.5 text-xs text-muted-foreground">
                                        <summary className="cursor-pointer hover:text-foreground">
                                            {t.sources.length} source{t.sources.length === 1 ? "" : "s"}
                                            {t.refused ? " (top retrievals — none crossed threshold)" : ""}
                                        </summary>
                                        <div className="mt-1.5 space-y-1.5 pl-2 border-l-2 border-violet-500/40">
                                            {t.sources.map((s, sidx) => (
                                                <div key={`${s.chunk_index}-${sidx}`} className="text-[11px] italic line-clamp-3">
                                                    <span className="not-italic font-medium text-foreground/80 mr-1">
                                                        [Chunk {sidx + 1}]
                                                        {s.has_table ? " · table" : ""}
                                                    </span>
                                                    &ldquo;{s.chunk_text}&rdquo;
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {error && (
                <div className="text-xs text-red-600/90 flex items-start gap-1.5">
                    <IconAlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
                </div>
            )}

            <div className="flex gap-2 items-end">
                <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                    }}
                    placeholder="Ask a question · Enter to send, Shift+Enter for newline"
                    disabled={busy}
                    className="flex-1 text-base sm:text-sm px-3 py-2 min-h-10 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-60 resize-none"
                />
                {busy ? (
                    <Button size="sm" variant="secondary" onClick={stop} className="h-10" title="Stop generating">
                        <IconPlayerStop size={14} />
                    </Button>
                ) : (
                    <Button size="sm" onClick={send} disabled={!input.trim()} className="h-10">
                        <IconSend size={14} />
                    </Button>
                )}
            </div>
        </div>
    );
}
