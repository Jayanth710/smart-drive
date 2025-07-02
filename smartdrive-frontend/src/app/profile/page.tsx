"use client"
import SideBar from '@/components/SideBar'
import UserProfile from '@/components/UserProfile'
import React from 'react'


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
