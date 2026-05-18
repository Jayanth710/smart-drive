"use client";
import { useRouter } from "next/navigation";
import React, { Dispatch, SetStateAction, useState } from "react";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import axios from "axios";
import apiClient from "@/lib/api";
import { toast } from "react-toastify";
import { IconBrandGoogle, IconBrandApple, IconLoader2 } from "@tabler/icons-react";

type LogInProps = {
    setIsLogin: Dispatch<SetStateAction<boolean>>;
};

const LogIn: React.FC<LogInProps> = ({ setIsLogin }) => {
    const [data, setData] = useState({ email: "", password: "" });
    const [submitting, setSubmitting] = useState(false);
    const router = useRouter();

    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setData({ ...data, [e.target.name]: e.target.value });
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!data.email || !data.password) {
            toast.error("Please enter your email and password.");
            return;
        }
        setSubmitting(true);
        try {
            const res = await apiClient.post("/api/login", data);
            if (res.status === 200) {
                await apiClient.get("/api/user");
                toast.success("Welcome back!");
                router.push("/dashboard");
            }
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                toast.info("No account found — please sign up.");
                setIsLogin(false);
            } else if (axios.isAxiosError(error) && error.response?.status === 401) {
                toast.error("Incorrect password.");
            } else {
                toast.error("Could not sign you in.");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const onComingSoon = () => toast.info("Coming soon.");

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
                <p className="text-sm text-muted-foreground mt-1">Sign in to your SmartDrive account.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
                <div className="grid gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        name="email"
                        value={data.email}
                        onChange={onChange}
                        required
                    />
                </div>
                <div className="grid gap-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="password">Password</Label>
                        <a href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                            Forgot password?
                        </a>
                    </div>
                    <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        name="password"
                        value={data.password}
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
                        <><IconLoader2 size={16} className="mr-2 animate-spin" /> Signing in…</>
                    ) : <>Sign in &rarr;</>}
                </button>
            </form>

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                    <span className="bg-background px-2 text-muted-foreground">or continue with</span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" type="button" onClick={onComingSoon} className="h-9">
                    <IconBrandGoogle size={16} className="mr-2" /> Google
                </Button>
                <Button variant="outline" type="button" onClick={onComingSoon} className="h-9">
                    <IconBrandApple size={16} className="mr-2" /> Apple
                </Button>
            </div>

            <p className="text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <button onClick={() => setIsLogin(false)} className="font-medium text-foreground hover:underline">
                    Sign up
                </button>
            </p>
        </div>
    );
};

export default LogIn;
