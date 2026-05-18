"use client";
import React, { Dispatch, SetStateAction, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "./ui/input";
import axios from "axios";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Button } from "./ui/button";
import apiClient from "@/lib/api";
import { IconBrandGoogle, IconBrandApple, IconLoader2 } from "@tabler/icons-react";

type Props = {
    setIsLogin: Dispatch<SetStateAction<boolean>>;
};

interface SignUpFormData {
    firstname: string;
    lastname: string;
    email: string;
    password: string;
    re_password: string;
    phone: string;
}

const initial: SignUpFormData = {
    firstname: "", lastname: "", email: "", password: "", re_password: "", phone: "",
};

function SignUp({ setIsLogin }: Props) {
    const [data, setData] = useState<SignUpFormData>(initial);
    const [submitting, setSubmitting] = useState(false);
    const router = useRouter();

    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setData({ ...data, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (data.password !== data.re_password) {
            toast.error("Passwords don't match.");
            return;
        }
        setSubmitting(true);
        try {
            const res = await apiClient.post("/api/register", {
                firstname: data.firstname,
                lastname: data.lastname,
                email: data.email,
                password: data.password,
                phone: data.phone,
            });
            if (res.status === 201) {
                toast.success("Account created — please sign in.");
                setData(initial);
                setIsLogin(true);
                router.push("/");
            }
        } catch (err) {
            if (axios.isAxiosError(err) && err.response) {
                toast.error(err.response.data?.message ?? "Could not create account.");
            } else {
                toast.error("Something went wrong. Try again.");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const onComingSoon = () => toast.info("Coming soon.");

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Free to start. Upload your first file in under a minute.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                        <Label htmlFor="firstname">First name</Label>
                        <Input id="firstname" name="firstname" placeholder="Ada" value={data.firstname} onChange={onChange} required />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="lastname">Last name</Label>
                        <Input id="lastname" name="lastname" placeholder="Lovelace" value={data.lastname} onChange={onChange} required />
                    </div>
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" placeholder="you@example.com" value={data.email} onChange={onChange} required />
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="phone">Phone (optional)</Label>
                    <Input id="phone" name="phone" type="tel" placeholder="+1 555 010 1234" value={data.phone} onChange={onChange} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                        <Label htmlFor="password">Password</Label>
                        <Input id="password" name="password" type="password" placeholder="••••••••" value={data.password} onChange={onChange} required />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="re_password">Confirm</Label>
                        <Input id="re_password" name="re_password" type="password" placeholder="••••••••" value={data.re_password} onChange={onChange} required />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={submitting}
                    className="group/btn relative mt-2 flex h-10 w-full items-center justify-center rounded-md bg-gradient-to-br from-black to-neutral-600 font-medium text-white shadow-[0px_1px_0px_0px_#ffffff40_inset,0px_-1px_0px_0px_#ffffff40_inset] dark:bg-zinc-800 dark:from-zinc-900 dark:to-zinc-900 dark:shadow-[0px_1px_0px_0px_#27272a_inset,0px_-1px_0px_0px_#27272a_inset] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                    {submitting ? (
                        <><IconLoader2 size={16} className="mr-2 animate-spin" /> Creating account…</>
                    ) : <>Create account &rarr;</>}
                </button>
            </form>

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                    <span className="bg-background px-2 text-muted-foreground">or sign up with</span>
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
                Already have an account?{" "}
                <button onClick={() => setIsLogin(true)} className="font-medium text-foreground hover:underline">
                    Sign in
                </button>
            </p>

            <p className="text-center text-[11px] text-muted-foreground">
                By creating an account, you agree to our <a href="#" className="underline">Terms</a> and{" "}
                <a href="#" className="underline">Privacy Policy</a>.
            </p>
        </div>
    );
}

export default SignUp;
