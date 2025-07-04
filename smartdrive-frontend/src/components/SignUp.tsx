"use client";
import React, { Dispatch, SetStateAction, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";
import {
    IconBrandApple,
    IconBrandGithub,
    IconBrandGoogle,
} from "@tabler/icons-react";
// import { useRouter } from "next/navigation";
import axios from "axios";
import Link from "next/link";

type LogInProps = {
    className?: string
    setIsLogin: Dispatch<SetStateAction<boolean>>
    [key: string]: unknown
}

interface SignUpFormData {
    firstname: string;
    lastname: string;
    email: string;
    password: string;
    re_password: string;
    phone: string;
}


const PORT = 4000
const URL = `http://localhost:${PORT}`
function SignUp({ setIsLogin }: LogInProps) {
    // const [loading, setLoading] = useState(false);
    // const [error, setError] = useState("");
    const [data, setData] = useState<SignUpFormData>({
        firstname: "",
        lastname: "",
        email: "",
        password: "",
        re_password: "",
        phone: ""
    })
    // const router = useRouter()

    const onChangeHandler = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setData({
            ...data,
            [event.target.name]: event.target.value,

        })
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        // setLoading(true);
        // setError("");

        try {
            // Send login data to the backend
            if (data.password !== data.re_password) {
                // setError("Password and re-password do not match.")
                alert("Password and re-password do not match.")
                return
            }

            const payload = {
                firstname: data.firstname,
                lastname: data.lastname,
                email: data.email,
                password: data.password,
                phone: data.phone,
            };

            const response = await axios.post(`${URL}/api/register`, payload);
            console.log(response.data);
            if (response.status === 201) {
                setIsLogin(true)
            }

            setData({
                firstname: "",
                lastname: "",
                email: "",
                password: "",
                re_password: "",
                phone: ""
            });
        } catch (err: unknown) {
            if (axios.isAxiosError(err) && err.response?.status === 404) {
                setIsLogin(false)
            }
            // setError("Login failed. Please check your credentials.");
        } finally {
            // setLoading(false);
        }
    };
    return (
        <div className="shadow-2xl mx-auto w-full max-w-md rounded-none bg-white p-4 md:rounded-2xl md:p-6 dark:bg-black">
            <h2 className="text-xl font-bold text-neutral-800 dark:text-neutral-200">
                Welcome to DocuMind
            </h2>
            <p className="mt-1 max-w-sm text-sm text-neutral-600 dark:text-neutral-300">
                Sign Up to DocuMind if you can because we don&apos;t have a login flow
                yet
            </p>

            <form className="my-6" onSubmit={handleSubmit}>
                <div className="mb-4 flex flex-col space-y-2 md:flex-row md:space-y-0 md:space-x-2">
                    <LabelInputContainer>
                        <Label htmlFor="firstname">First name</Label>
                        <Input id="firstname" placeholder="Tyler" type="text" name="firstname" onChange={onChangeHandler} value={data.firstname} />
                    </LabelInputContainer>
                    <LabelInputContainer>
                        <Label htmlFor="lastname">Last name</Label>
                        <Input id="lastname" placeholder="Durden" type="text" name="lastname" onChange={onChangeHandler} value={data.lastname} />

                    </LabelInputContainer>
                </div>
                <LabelInputContainer className="mb-4">
                    <Label htmlFor="email">Email Address</Label>
                    <Input id="email" placeholder="projectmayhem@fc.com" type="email" name="email" onChange={onChangeHandler} value={data.email} />
                </LabelInputContainer>
                <LabelInputContainer className="mb-4">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" placeholder="••••••••" type="password" name="password" onChange={onChangeHandler} value={data.password} />

                </LabelInputContainer>
                <LabelInputContainer className="mb-4">
                    <Label htmlFor="repassword">Re-enter password</Label>
                    <Input
                        id="repassword"
                        placeholder="••••••••"
                        type="password"
                        name="re_password"
                        onChange={onChangeHandler}
                        value={data.re_password}
                    />
                </LabelInputContainer>
                <LabelInputContainer className="mb-4">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                        id="phone"
                        placeholder="+1234567890"
                        type="string"
                        name="phone"
                        onChange={onChangeHandler}
                        value={data.phone}
                    />
                </LabelInputContainer>

                <button
                    className="group/btn relative block h-10 w-full rounded-md bg-gradient-to-br from-black to-neutral-600 font-medium text-white shadow-[0px_1px_0px_0px_#ffffff40_inset,0px_-1px_0px_0px_#ffffff40_inset] dark:bg-zinc-800 dark:from-zinc-900 dark:to-zinc-900 dark:shadow-[0px_1px_0px_0px_#27272a_inset,0px_-1px_0px_0px_#27272a_inset]"
                    type="submit"
                >
                    Sign up &rarr;
                    <BottomGradient />
                </button>

                <div className="my-8 h-[1px] w-full bg-gradient-to-r from-transparent via-neutral-300 to-transparent dark:via-neutral-700" />

                <div className="grid grid-cols-3 gap-4">
                    <button
                        className="group/btn shadow-input relative flex h-10 w-full items-center justify-start space-x-2 rounded-md bg-gray-50 px-4 font-medium text-black dark:bg-zinc-900 dark:shadow-[0px_0px_1px_1px_#262626] cursor-pointer"
                        type="submit"
                    >
                        <IconBrandGithub className="h-4 w-4 text-neutral-800 dark:text-neutral-300" />
                        <span className="text-sm text-neutral-700 dark:text-neutral-300">
                            GitHub
                        </span>
                        <BottomGradient />
                    </button>
                    <button
                        className="group/btn shadow-input relative flex h-10 w-full items-center justify-start space-x-2 rounded-md bg-gray-50 px-4 font-medium text-black dark:bg-zinc-900 dark:shadow-[0px_0px_1px_1px_#262626] cursor-pointer"
                        type="submit"
                    >
                        <IconBrandGoogle className="h-4 w-4 text-neutral-800 dark:text-neutral-300" />
                        <span className="text-sm text-neutral-700 dark:text-neutral-300">
                            Google
                        </span>
                        <BottomGradient />
                    </button>
                    <button
                        className="group/btn shadow-input relative flex h-10 w-full items-center justify-start space-x-2 rounded-md bg-gray-50 px-4 font-medium text-black dark:bg-zinc-900 dark:shadow-[0px_0px_1px_1px_#262626] cursor-pointer"
                        type="submit"
                    >
                        <IconBrandApple className="h-4 w-4 text-neutral-800 dark:text-neutral-300" />
                        <span className="text-sm text-neutral-700 dark:text-neutral-300">
                            Apple
                        </span>
                        <BottomGradient />
                    </button>
                </div>
            </form>
            <div className="text-center text-sm text-black dark:text-white" onClick={() => setIsLogin(true)}>
                Already have an account?{" "}
                <Link href="/" className="underline underline-offset-4">
                    Log In
                </Link>
            </div>
        </div>
    );
}

const BottomGradient = () => {
    return (
        <>
            <span className="absolute inset-x-0 -bottom-px block h-px w-full bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-0 transition duration-500 group-hover/btn:opacity-100" />
            <span className="absolute inset-x-10 -bottom-px mx-auto block h-px w-1/2 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-0 blur-sm transition duration-500 group-hover/btn:opacity-100" />
        </>
    );
};

const LabelInputContainer = ({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) => {
    return (
        <div className={cn("flex w-full flex-col space-y-2", className)}>
            {children}
        </div>
    );
};

export default SignUp;
