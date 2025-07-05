"use client";
import React, { useState } from 'react';
import apiClient from '@/lib/api';
import { toast } from 'react-toastify';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { useRouter } from 'next/navigation';

const ForgotPasswordForm = () => {
    const [email, setEmail] = useState('');
    const router = useRouter()

    const onChangeHandler = async (e: React.ChangeEvent<HTMLInputElement>) => {
        setEmail(e.target.value)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            await apiClient.post('/api/forgot-password', { email });
            toast.success('If an account with that email exists, a password reset link has been sent.')
            router.push('/')
        } catch (err) {
            toast.error('If an account with that email exists, a password reset link has been sent.')
            console.log(err)

        } finally {
            setEmail('');
        }
    };

    return (
        <form className="p-6 md:p-8" method='post' onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
                <div className="flex flex-col items-center text-center">
                    <h1 className="text-2xl font-bold">Welcome to Smart Drive</h1>
                    <p className="text-balance text-muted-foreground">
                        Enter your Smart Drive account email to get reset Link
                    </p>
                    <div className="grid gap-2 w-1/4 mt-15 mb-4">
                        <Label htmlFor="email" className='text-2xl font-bold'>Email</Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="m@example.com"
                            onChange={onChangeHandler}
                            name="email"
                            value={email}
                            required
                        />
                    </div>
                    <button
                        className="group/btn relative block h-10 w-1/4 rounded-md bg-gradient-to-br from-black to-neutral-600 font-medium text-white shadow-[0px_1px_0px_0px_#ffffff40_inset,0px_-1px_0px_0px_#ffffff40_inset] dark:bg-zinc-800 dark:from-zinc-900 dark:to-zinc-900 dark:shadow-[0px_1px_0px_0px_#27272a_inset,0px_-1px_0px_0px_#27272a_inset] cursor-pointer"
                        type="submit"
                        onClick={(e) => handleSubmit(e)}
                    >
                        Get Reset Link &rarr;
                    </button>
                </div>
            </div>
        </form>
    );
};

export default ForgotPasswordForm;