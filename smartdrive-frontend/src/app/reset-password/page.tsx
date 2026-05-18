"use client";
import ResetPasswordPage from "@/components/ResetPassword";
import { AuthShell } from "@/components/AuthShell";
import React, { Suspense } from "react";

const Page = () => (
    <AuthShell>
        <Suspense fallback={<div className="text-center text-sm text-muted-foreground">Loading…</div>}>
            <ResetPasswordPage />
        </Suspense>
    </AuthShell>
);

export default Page;
