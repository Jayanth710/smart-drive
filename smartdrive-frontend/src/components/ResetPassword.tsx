"use client";
import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import apiClient from "@/lib/api";
import { toast } from "react-toastify";
import axios from "axios";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import Link from "next/link";
import { IconArrowLeft, IconLoader2 } from "@tabler/icons-react";

const ResetPasswordPage = () => {
    const searchParams = useSearchParams();
    const token = searchParams.get("token");
    const [passwordData, setPasswordData] = useState({ password: "", re_password: "" });
    const [submitting, setSubmitting] = useState(false);
    const router = useRouter();

    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPasswordData({ ...passwordData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) {
            toast.error("This reset link is invalid.");
            return;
        }
        if (passwordData.password !== passwordData.re_password) {
            toast.error("Passwords don't match.");
            return;
        }
        setSubmitting(true);
        try {
            const res = await apiClient.post("/api/reset-password", {
                password: passwordData.password,
                token,
            });
            if (res.status === 200) {
                toast.success("Password updated. Please sign in.");
                router.push("/");
            }
        } catch (err) {
            if (axios.isAxiosError(err) && err.response) {
                toast.error(err.response.data?.message ?? "Could not reset password.");
            } else {
                toast.error("Something went wrong. Try again.");
            }
        } finally {
            setSubmitting(false);
            setPasswordData({ password: "", re_password: "" });
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Pick something strong — you&apos;ll use it to sign in.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-1.5">
                    <Label htmlFor="password">New password</Label>
                    <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        name="password"
                        value={passwordData.password}
                        onChange={onChange}
                        required
                    />
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="re_password">Confirm new password</Label>
                    <Input
                        id="re_password"
                        type="password"
                        placeholder="••••••••"
                        name="re_password"
                        value={passwordData.re_password}
                        onChange={onChange}
                        required
                    />
                </div>
                <button
                    type="submit"
                    disabled={submitting}
                    className="group/btn relative flex h-10 w-full items-center justify-center rounded-md bg-gradient-to-br from-black to-neutral-600 font-medium text-white shadow-[0px_1px_0px_0px_#ffffff40_inset,0px_-1px_0px_0px_#ffffff40_inset] dark:bg-zinc-800 dark:from-zinc-900 dark:to-zinc-900 dark:shadow-[0px_1px_0px_0px_#27272a_inset,0px_-1px_0px_0px_#27272a_inset] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                    {submitting ? (
                        <><IconLoader2 size={16} className="mr-2 animate-spin" /> Updating…</>
                    ) : <>Update password &rarr;</>}
                </button>
            </form>

            <Link href="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
                <IconArrowLeft size={14} className="mr-1.5" /> Back to sign in
            </Link>
        </div>
    );
};

export default ResetPasswordPage;
