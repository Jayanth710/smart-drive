"use client";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import { AuthShell } from "@/components/AuthShell";
import React from "react";

const Page = () => (
    <AuthShell>
        <ForgotPasswordForm />
    </AuthShell>
);

export default Page;
