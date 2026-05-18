"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
    IconCloudUpload, IconSparkles, IconLoader2, IconSend, IconUser,
    IconAlertTriangle, IconX, IconShieldCheck, IconCircleDashed, IconCircleX,
    IconFileText, IconPlayerStop, IconCopy, IconCheck, IconRefresh, IconLock,
} from "@tabler/icons-react";
import { postSSE, Source, Confidence, StreamEvent } from "@/lib/chatStream";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Turn = {
    role: "user" | "assistant";
    content: string;
    sources?: Source[];
    confidence?: Confidence;
    refused?: boolean;
    rewritten_query?: string;
    streaming?: boolean;
};

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
                try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* clipboard unavailable */ }
            }}
            title="Copy answer"
            className="text-muted-foreground hover:text-foreground transition"
        >
            {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
    );
}

export default function QuickChatPage() {
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [filename, setFilename] = useState<string>("");
    const [chunkCount, setChunkCount] = useState<number>(0);
    const [redactions, setRedactions] = useState<number>(0);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);

    const [textViewerOpen, setTextViewerOpen] = useState(false);
    const [extractedText, setExtractedText] = useState<string | null>(null);
    const [extractedTruncated, setExtractedTruncated] = useState(false);
    const [extractedLoading, setExtractedLoading] = useState(false);

    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const streamingBufferRef = useRef<string>("");
    const cancelRef = useRef<(() => void) | null>(null);

    // Cleanup on unmount + tab close.
    useEffect(() => {
        if (!sessionId) return;
        const onUnload = () => {
            try {
                navigator.sendBeacon?.(`/chat-session/${sessionId}`, new Blob([JSON.stringify({})], { type: "application/json" }));
            } catch { /* ignore */ }
        };
        window.addEventListener("beforeunload", onUnload);
        return () => {
            window.removeEventListener("beforeunload", onUnload);
            cancelRef.current?.();
            apiClient.delete(`/chat-session/${sessionId}`).catch(() => undefined);
        };
    }, [sessionId]);

    useEffect(() => {
        const node = scrollerRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [turns, busy]);

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
                if (out[i].role === "assistant") { out[i] = { ...out[i], ...patch }; break; }
            }
            return out;
        });
    };

    const handleUpload = async (file: File) => {
        setUploadError(null);
        setUploading(true);
        try {
            const form = new FormData();
            form.append("file", file);
            const res = await apiClient.post("/chat-session/upload", form, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            const data = res.data as { session_id: string; filename: string; chunk_count: number; redactions?: number };
            setSessionId(data.session_id);
            setFilename(data.filename);
            setChunkCount(data.chunk_count);
            setRedactions(data.redactions ?? 0);
            setTurns([]);
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            setUploadError(e?.response?.data?.message ?? "Could not process the file.");
        } finally {
            setUploading(false);
        }
    };

    const runChat = useCallback((msg: string, historyForRequest: Turn[]) => {
        if (!sessionId) return;
        setChatError(null);
        setBusy(true);

        streamingBufferRef.current = "";
        setTurns((prev) => [
            ...prev,
            { role: "user", content: msg },
            { role: "assistant", content: "", streaming: true },
        ]);

        cancelRef.current = postSSE(
            `/chat-session/${sessionId}/chat-stream`,
            { message: msg, history: historyForRequest.map(({ role, content }) => ({ role, content })) },
            {
                onEvent: (event: StreamEvent) => {
                    switch (event.type) {
                        case "prep": patchLastAssistant({ rewritten_query: event.rewritten_query }); break;
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
                                content: "Stream failed. Please retry.",
                                streaming: false, refused: true, confidence: "none",
                            });
                            setBusy(false);
                            break;
                    }
                },
                onError: (err) => {
                    if (err.message.toLowerCase().includes("404") || err.message.toLowerCase().includes("not found")) {
                        setChatError("Session expired. Please upload the file again.");
                        setSessionId(null);
                    } else {
                        setChatError(err.message || "Something went wrong.");
                    }
                    patchLastAssistant({ streaming: false });
                    setBusy(false);
                },
            },
        );
    }, [sessionId]);

    const send = () => {
        const msg = input.trim();
        if (!msg || busy) return;
        setInput("");
        runChat(msg, turns);
    };

    const stop = () => {
        cancelRef.current?.();
        cancelRef.current = null;
        patchLastAssistant({ streaming: false });
        setBusy(false);
    };

    const regenerate = () => {
        if (busy) return;
        let lastUserIdx = -1;
        for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i].role === "user") { lastUserIdx = i; break; }
        }
        if (lastUserIdx === -1) return;
        const lastUserMsg = turns[lastUserIdx].content;
        const truncated = turns.slice(0, lastUserIdx);
        setTurns(truncated);
        runChat(lastUserMsg, truncated);
    };

    const openTextViewer = async () => {
        if (!sessionId) return;
        setTextViewerOpen(true);
        if (extractedText !== null) return;
        setExtractedLoading(true);
        try {
            const res = await apiClient.get(`/chat-session/${sessionId}/text`);
            setExtractedText(res.data?.text ?? "");
            setExtractedTruncated(Boolean(res.data?.truncated));
        } catch {
            setExtractedText("Could not load extracted text.");
        } finally {
            setExtractedLoading(false);
        }
    };

    const startOver = () => {
        cancelRef.current?.();
        if (sessionId) {
            apiClient.delete(`/chat-session/${sessionId}`).catch(() => undefined);
        }
        setSessionId(null);
        setFilename("");
        setChunkCount(0);
        setRedactions(0);
        setTurns([]);
        setInput("");
        setChatError(null);
        setExtractedText(null);
        setExtractedTruncated(false);
        setTextViewerOpen(false);
    };

    return (
        <div className="flex flex-col h-full max-w-3xl mx-auto p-2">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                    <h1 className="text-xl font-semibold flex items-center gap-2">
                        <IconSparkles size={18} className="text-violet-500" />
                        Quick chat
                    </h1>
                    <p className="text-xs text-muted-foreground">
                        Drop in a one-off file. Nothing is saved — we delete the session when you leave.
                    </p>
                </div>
                {sessionId && (
                    <Button size="sm" variant="ghost" onClick={startOver}>
                        <IconX size={14} className="mr-1.5" /> End & start over
                    </Button>
                )}
            </div>

            {!sessionId ? (
                <UploadCard onPick={handleUpload} uploading={uploading} error={uploadError} />
            ) : (
                <div className="flex items-center gap-2 mb-3 rounded-lg border bg-muted/30 px-3 py-2">
                    <IconFileText size={16} className="text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                        <button
                            onClick={openTextViewer}
                            title="View the extracted text the AI sees"
                            className="text-sm font-medium truncate text-left hover:underline underline-offset-2 block w-full"
                        >
                            {filename}
                        </button>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                            <span>{chunkCount} chunk{chunkCount === 1 ? "" : "s"} indexed in memory</span>
                            <span>·</span>
                            <span>auto-deletes after 30 min idle</span>
                            {redactions > 0 && (
                                <>
                                    <span>·</span>
                                    <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-300" title="Personal info (emails, phone numbers, API keys) was stripped from the embeddings.">
                                        <IconLock size={10} /> {redactions} PII span{redactions === 1 ? "" : "s"} redacted
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <Dialog open={textViewerOpen} onOpenChange={setTextViewerOpen}>
                <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col">
                    <DialogTitle className="truncate">{filename}</DialogTitle>
                    <DialogDescription className="text-xs">
                        Extracted text · what the AI sees when answering your questions.
                    </DialogDescription>
                    <div className="mt-3 flex-1 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono">
                        {extractedLoading ? "Loading…" : (extractedText ?? "")}
                        {extractedTruncated && (
                            <div className="mt-2 text-[11px] italic text-muted-foreground">
                                (truncated for display)
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {sessionId && (
                <>
                    <div
                        ref={scrollerRef}
                        className="flex-1 rounded-lg border bg-muted/10 px-3 py-3 min-h-[300px] overflow-y-auto space-y-3"
                    >
                        {turns.length === 0 ? (
                            <div className="flex flex-col items-center justify-center text-center h-full text-sm text-muted-foreground">
                                <IconSparkles size={24} className="mb-2 opacity-70" />
                                Ask anything about <span className="font-medium text-foreground">&ldquo;{filename}&rdquo;</span>.
                                <div className="text-xs mt-1 opacity-70">Every claim is cited. Nothing is stored.</div>
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
                                                    <IconLoader2 size={10} className="animate-spin" /> streaming…
                                                </span>
                                            )}
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

                    {chatError && (
                        <div className="mt-2 text-xs text-red-600/90 flex items-start gap-1.5">
                            <IconAlertTriangle size={12} className="mt-0.5 shrink-0" /> {chatError}
                        </div>
                    )}

                    <div className="mt-3 flex gap-2 items-end">
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
                            className="flex-1 text-sm px-3 py-2 min-h-10 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-60 resize-none"
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
                </>
            )}
        </div>
    );
}

function UploadCard({
    onPick, uploading, error,
}: {
    onPick: (f: File) => void; uploading: boolean; error: string | null;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [dragOver, setDragOver] = useState(false);

    return (
        <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f && !uploading) onPick(f);
            }}
            className={`rounded-2xl border-2 border-dashed p-10 text-center transition ${
                dragOver ? "border-violet-500 bg-violet-500/[0.04]" : "border-border"
            }`}
        >
            <div className="mx-auto mb-3 inline-flex items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 via-fuchsia-500/20 to-cyan-400/20 p-4">
                <IconCloudUpload size={28} className="text-foreground/80" />
            </div>
            <div className="font-medium">Drop a file here, or pick one</div>
            <p className="text-sm text-muted-foreground mt-1">
                PDF, DOCX, TXT, or MD — up to 20 MB. Nothing is uploaded to your drive.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
                <Button size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
                    {uploading ? (
                        <><IconLoader2 size={14} className="mr-1.5 animate-spin" /> Processing…</>
                    ) : "Choose file"}
                </Button>
                <input
                    ref={inputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.txt,.md,.markdown,.log,.csv,.json,.html,.htm,.xml,.yml,.yaml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f && !uploading) onPick(f);
                        if (e.target) e.target.value = "";
                    }}
                />
            </div>
            {error && (
                <div className="mt-4 text-sm text-red-600/90 flex items-center justify-center gap-1.5">
                    <IconAlertTriangle size={14} /> {error}
                </div>
            )}
        </div>
    );
}
