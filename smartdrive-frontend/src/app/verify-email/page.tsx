"use client";
import { AuthShell } from "@/components/AuthShell";
import apiClient from "@/lib/api";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";
import { IconLoader2, IconCheck, IconAlertTriangle } from "@tabler/icons-react";

type Status = "loading" | "ok" | "error";

function VerifyEmailContent() {
    const params = useSearchParams();
    const token = params.get("token");
    const [status, setStatus] = useState<Status>("loading");
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!token) {
            setStatus("error");
            setMessage("This verification link is missing its token.");
            return;
        }
        (async () => {
            try {
                await apiClient.post("/api/verify-email", { token });
                setStatus("ok");
                setMessage("Your email is verified. You can now sign in.");
            } catch (err) {
                setStatus("error");
                const m = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
                setMessage(m ?? "Verification link is invalid or has expired.");
            }
        })();
    }, [token]);

    return (
        <div className="space-y-6">
            {status === "loading" && (
                <div className="flex items-center gap-2 text-muted-foreground">
                    <IconLoader2 size={18} className="animate-spin" /> Verifying…
                </div>
            )}
            {status === "ok" && (
                <>
                    <div className="flex items-center gap-2 text-emerald-600">
                        <IconCheck size={20} /> <span className="font-semibold">Email verified</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{message}</p>
                    <Link href="/" className="text-sm underline">Go to sign in →</Link>
                </>
            )}
            {status === "error" && (
                <>
                    <div className="flex items-center gap-2 text-red-600">
                        <IconAlertTriangle size={20} /> <span className="font-semibold">Verification failed</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{message}</p>
                    <Link href="/" className="text-sm underline">Back to sign in</Link>
                </>
            )}
        </div>
    );
}

export default function Page() {
    return (
        <AuthShell>
            <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
                <VerifyEmailContent />
            </Suspense>
        </AuthShell>
    );
}
