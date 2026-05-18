"use client";
import { useState } from "react";
import LogIn from "../components/LogIn";
import SignUp from "../components/SignUp";
import { AuthShell } from "@/components/AuthShell";

export default function Home() {
    const [isLogin, setIsLogin] = useState(true);
    return (
        <AuthShell>
            {isLogin ? (
                <LogIn setIsLogin={setIsLogin} />
            ) : (
                <SignUp setIsLogin={setIsLogin} />
            )}
        </AuthShell>
    );
}
