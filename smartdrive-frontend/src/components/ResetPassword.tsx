"use client";
import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { toast } from 'react-toastify';
import axios from 'axios';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

const ResetPasswordPage = () => {
    const searchParams = useSearchParams();
    const [passwordData, setPasswordData] = useState({
        password: "",
        re_password: "",
    })
    const router = useRouter()
    const token = searchParams.get('token');
    // ... state for password, confirmPassword, message, error ...

    const onChangeHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
        setPasswordData({
            ...passwordData,
            [event.target.name]: event.target.value,

        })
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            if (passwordData.password !== passwordData.re_password) {
                toast.error("Password and re-password do not match.")
                return
            }

            const payload = {
                password: passwordData.password,
                token: token,
            };

            const response = await apiClient.post(`/api/reset-password`, payload);
            console.log(response.data.message)
            if (response.status === 200) {
                console.log('Password updated succesfull')
                toast.success(`Password updation was succesfull.`)
                router.push('/')
            }

        } catch (err: unknown) {
            if (axios.isAxiosError(err) && err.response) {
                console.error("Backend Error:", err.response.data.message);
                toast.error(`Backend Error: ${err.response.data.message}`)
            }
            else {
                toast.error("An unexpected error occurred. Please try again.");
                console.error(err);

            }
        }
        finally {
            setPasswordData({
                password: "",
                re_password: ""
            });
        }
    };

    // ... component JSX ...
    return (
        <form className="p-6 md:p-8" method='post' onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
                <div className="flex flex-col items-center text-center">
                    <h1 className="text-2xl font-bold">Welcome to Smart Drive</h1>
                    <p className="text-balance text-muted-foreground">
                        Enter your Smart Drive account email to get reset Link
                    </p>
                    <div className="grid gap-2 w-1/4 mt-15 mb-4">
                        <LabelInputContainer className="mb-4">
                            <Label htmlFor="password">Password</Label>
                            <Input id="password" placeholder="••••••••" type="password" name="password" onChange={onChangeHandler} value={passwordData.password} />

                        </LabelInputContainer>
                        <LabelInputContainer className="mb-4">
                            <Label htmlFor="repassword">Re-enter password</Label>
                            <Input
                                id="repassword"
                                placeholder="••••••••"
                                type="password"
                                name="re_password"
                                onChange={onChangeHandler}
                                value={passwordData.re_password}
                            />
                        </LabelInputContainer>
                    </div>
                    <button
                        className="group/btn relative block h-10 w-1/4 rounded-md bg-gradient-to-br from-black to-neutral-600 font-medium text-white shadow-[0px_1px_0px_0px_#ffffff40_inset,0px_-1px_0px_0px_#ffffff40_inset] dark:bg-zinc-800 dark:from-zinc-900 dark:to-zinc-900 dark:shadow-[0px_1px_0px_0px_#27272a_inset,0px_-1px_0px_0px_#27272a_inset] cursor-pointer"
                        type="submit"
                        onClick={(e) => handleSubmit(e)}
                    >
                        Reset Password &rarr;
                    </button>
                </div>
            </div>
        </form>
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

export default ResetPasswordPage;