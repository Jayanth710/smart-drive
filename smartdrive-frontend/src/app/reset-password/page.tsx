"use client"
import ResetPasswordPage from '@/components/ResetPassword'
import React, { Suspense } from 'react'

const page = () => {
    return (
        <Suspense fallback={<div className="text-center p-4">Loading...</div>}>
            <ResetPasswordPage />
        </Suspense>
    )
}

export default page
