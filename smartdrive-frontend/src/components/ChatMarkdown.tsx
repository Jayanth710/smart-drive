"use client";
import React from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared markdown renderer for chat assistant messages.
 *
 * Compact, theme-aware styling — no @tailwindcss/typography dep required.
 * `[Chunk N]` citations pass through as plain text so they stay visible.
 */
const components: Components = {
    p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    ul: ({ children }) => <ul className="list-disc list-outside pl-5 mb-2 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-outside pl-5 mb-2 space-y-1">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    h1: ({ children }) => <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>,
    h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1">{children}</h2>,
    h3: ({ children }) => <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>,
    blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-violet-500/50 pl-3 italic text-muted-foreground my-2">
            {children}
        </blockquote>
    ),
    code: ({ inline, className, children }: React.ComponentPropsWithoutRef<"code"> & { inline?: boolean }) => {
        if (inline) {
            return <code className={`px-1 py-0.5 rounded bg-muted text-[12px] font-mono ${className ?? ""}`}>{children}</code>;
        }
        return (
            <pre className="my-2 rounded-md bg-muted p-3 text-[12px] font-mono overflow-x-auto">
                <code className={className}>{children}</code>
            </pre>
        );
    },
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">
            {children}
        </a>
    ),
    table: ({ children }) => (
        <div className="my-2 overflow-x-auto">
            <table className="w-full text-xs border-collapse">{children}</table>
        </div>
    ),
    th: ({ children }) => <th className="text-left font-semibold border border-border px-2 py-1 bg-muted/40">{children}</th>,
    td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
    hr: () => <hr className="my-3 border-border" />,
};

export function ChatMarkdown({ children }: { children: string }) {
    return (
        <div className="text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {children}
            </ReactMarkdown>
        </div>
    );
}
