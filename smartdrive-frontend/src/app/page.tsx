"use client";
import { Suspense, useState } from "react";
import LogIn from "../components/LogIn";
import SignUp from "../components/SignUp";
import { AuthShell } from "@/components/AuthShell";

function HomeInner() {
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

export default function Home() {
    return (
        <Suspense fallback={null}>
            <HomeInner />
        </Suspense>
    );
}
