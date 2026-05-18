"use client";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import { AuthShell } from "@/components/AuthShell";
import React, { Suspense } from "react";

const Page = () => (
    <Suspense fallback={null}>
        <AuthShell>
            <ForgotPasswordForm />
        </AuthShell>
    </Suspense>
);

export default Page;
