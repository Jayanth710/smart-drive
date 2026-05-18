"use client";
import React, { useEffect, useState } from "react";
import { IconBulb, IconX } from "@tabler/icons-react";

type Props = {
    id: string;
    title: string;
    body: React.ReactNode;
};

export function OnboardingTip({ id, title, body }: Props) {
    const storageKey = `onboard-tip:${id}`;
    const [show, setShow] = useState(false);

    useEffect(() => {
        try {
            const seen = window.localStorage.getItem(storageKey);
            if (!seen) setShow(true);
        } catch {
            // private mode / no storage — skip the tip
        }
    }, [storageKey]);

    const dismiss = () => {
        setShow(false);
        try { window.localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
    };

    if (!show) return null;

    return (
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 rounded-xl border border-violet-300/60 bg-violet-50/70 px-4 py-3 text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100">
            <div className="flex items-start gap-3 flex-1 min-w-0">
                <IconBulb size={18} className="mt-0.5 shrink-0" />
                <div className="flex-1 text-sm min-w-0">
                    <div className="font-medium">{title}</div>
                    <div className="text-xs opacity-80 mt-0.5">{body}</div>
                </div>
            </div>
            <button
                onClick={dismiss}
                title="Got it"
                className="self-end sm:self-auto p-1 rounded hover:bg-violet-200/50 dark:hover:bg-violet-500/20"
            >
                <IconX size={14} />
            </button>
        </div>
    );
}
