"use client";
import React, { useState } from "react";
import apiClient from "@/lib/api";
import { toast } from "react-toastify";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import Link from "next/link";
import { IconArrowLeft, IconLoader2 } from "@tabler/icons-react";

const ForgotPasswordForm = () => {
    const [email, setEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        setSubmitting(true);
        try {
            await apiClient.post("/api/forgot-password", { email });
        } catch (err) {
            // Backend returns the same response for hits and misses to prevent enumeration.
            console.error(err);
        } finally {
            setSubmitting(false);
            setSent(true);
            toast.success("If an account exists, we just sent a reset link.");
        }
    };

    if (sent) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        If <span className="font-medium text-foreground">{email}</span> matches an account, a password
                        reset link is on its way. It expires in 15 minutes.
                    </p>
                </div>
                <Link href="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
                    <IconArrowLeft size={14} className="mr-1.5" /> Back to sign in
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Enter the email on your account and we&apos;ll send you a reset link.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>
                <button
                    type="submit"
                    disabled={submitting}
                    className="group/btn relative flex h-10 w-full items-center justify-center rounded-md bg-gradient-to-br from-black to-neutral-600 font-medium text-white shadow-[0px_1px_0px_0px_#ffffff40_inset,0px_-1px_0px_0px_#ffffff40_inset] dark:bg-zinc-800 dark:from-zinc-900 dark:to-zinc-900 dark:shadow-[0px_1px_0px_0px_#27272a_inset,0px_-1px_0px_0px_#27272a_inset] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                    {submitting ? (
                        <><IconLoader2 size={16} className="mr-2 animate-spin" /> Sending…</>
                    ) : <>Send reset link &rarr;</>}
                </button>
            </form>

            <Link href="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
                <IconArrowLeft size={14} className="mr-1.5" /> Back to sign in
            </Link>
        </div>
    );
};

export default ForgotPasswordForm;
