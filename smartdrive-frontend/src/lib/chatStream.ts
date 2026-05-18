/**
 * SSE consumer for the chat-stream endpoints.
 *
 * We use `fetch` with `ReadableStream` (not EventSource) because EventSource
 * only supports GET — our chat endpoints take POST bodies. The SSE wire format
 * is the same either way: `event: <name>\ndata: <json>\n\n`.
 */

export type Source = {
    chunk_index: number;
    chunk_text: string;
    parent_text?: string;
    has_table?: boolean;
    score: number;
    rerank_score?: number;
};

export type Confidence = "high" | "medium" | "low" | "none";

export type StreamEvent =
    | { type: "ready"; prepared_now?: boolean; redactions?: number }
    | { type: "prep"; rewritten_query?: string }
    | { type: "no_sources" }
    | { type: "delta"; text: string }
    | {
        type: "done";
        answer: string;
        sources: Source[];
        confidence: Confidence;
        refused: boolean;
        out_of_scope: boolean;
        rewritten_query?: string;
    }
    | { type: "error"; message: string };

type Callbacks = {
    onEvent: (event: StreamEvent) => void;
    onError?: (err: Error) => void;
};

const readCsrfCookie = (): string | undefined => {
    if (typeof document === "undefined") return undefined;
    const m = document.cookie.match(/(?:^|; )csrfToken=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : undefined;
};

/**
 * POST to an SSE endpoint and surface events to the caller. Returns a cancel
 * function so callers can abort mid-stream (e.g. user clicked Stop).
 */
export const postSSE = (
    url: string,
    body: unknown,
    callbacks: Callbacks,
): (() => void) => {
    const controller = new AbortController();
    (async () => {
        try {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
            };
            const csrf = readCsrfCookie();
            if (csrf) headers["X-CSRF-Token"] = csrf;

            const res = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) {
                let msg = `HTTP ${res.status}`;
                try { msg = (await res.json()).message ?? msg; } catch { /* ignore */ }
                callbacks.onError?.(new Error(msg));
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // SSE frames are separated by blank lines.
                let sepIdx;
                while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
                    const frame = buffer.slice(0, sepIdx);
                    buffer = buffer.slice(sepIdx + 2);

                    let event = "message";
                    const dataLines: string[] = [];
                    for (const line of frame.split("\n")) {
                        if (line.startsWith("event:")) event = line.slice(6).trim();
                        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
                    }
                    if (dataLines.length === 0) continue;
                    try {
                        const parsed = JSON.parse(dataLines.join("\n"));
                        // The pipeline already embeds `type` inside the data object;
                        // fall back to the SSE event name if missing.
                        const ev: StreamEvent = { type: event, ...parsed } as StreamEvent;
                        callbacks.onEvent(ev);
                    } catch (e) {
                        callbacks.onError?.(new Error(`Bad SSE payload: ${e}`));
                    }
                }
            }
        } catch (err) {
            if ((err as Error).name === "AbortError") return;
            callbacks.onError?.(err as Error);
        }
    })();
    return () => controller.abort();
};
