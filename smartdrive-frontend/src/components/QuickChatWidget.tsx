"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconSparkles } from "@tabler/icons-react";

/**
 * Floating bottom-right shortcut to the ephemeral chat page.
 *
 * Hides itself when the user is already on `/quick-chat` so it doesn't
 * compete with the page's own UI.
 */
export function QuickChatWidget() {
    const pathname = usePathname();
    if (pathname?.startsWith("/quick-chat")) return null;

    return (
        <Link
            href="/quick-chat"
            aria-label="Chat with a file without saving it"
            className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 hover:from-violet-700 hover:to-fuchsia-600 transition"
        >
            <IconSparkles size={16} />
            Chat with a file
            <span className="text-[10px] uppercase tracking-wider opacity-80 px-1.5 py-0.5 rounded bg-white/15">
                no save
            </span>
        </Link>
    );
}
