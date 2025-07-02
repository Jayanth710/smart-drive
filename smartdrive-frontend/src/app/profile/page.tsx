"use client"
import SideBar from '@/components/SideBar'
import UserProfile from '@/components/UserProfile'
import React, { ReactNode } from 'react'


const page = () => {
    return (
        <div>
            <SideBar>
                <UserProfile />
            </SideBar>
        </div>
    )
}

export default page
