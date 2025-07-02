"use client"
import { useAuth } from '@/context/AuthContext'
import apiClient from '@/lib/api'
import React, { useState } from 'react'
import { toast } from 'react-toastify'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { IconPencil } from "@tabler/icons-react";

const UserProfile = () => {
    const { data, user } = useAuth()
    const [editingField, setEditingField] = useState<string | null>(null)
    const [formData, setFormData] = useState({
        firstName: data?.firstName || '',
        lastName: data?.lastName || '',
        email: data?.email || '',
        phone: data?.phone || '',
    })

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        })
    }

    const handleSave = async (field: string) => {
        try {
            const response = await apiClient.put(`/api/user/edit`, {
                [field]: formData[field as keyof typeof formData],
            })
            if (response.status === 200) {
                console.log("Profile updated successfully")
                toast.success("Profile updated successfully")
                await user()
                setEditingField(null)
            }
        } catch (error) {
            toast.error("Error updating profile")
            console.error(error)
        }
    }

    return (
        <div className='w-full h-full flex flex-col ml-10 mt-10'>
            <div className="">
                Welcome, <h2 className='text-2xl font-bold'>{data?.firstName} {data?.lastName}</h2>
            </div>
            <div className="mt-10 w-full max-w-full">
                <h3 className='text-xl font-bold mb-4'>User Profile</h3>
            </div>
            {/* FIRST NAME */}

            <div className="grid grid-cols-3 items-center gap-4 border-b py-2">
                {/* Label */}
                <div>
                    <label className="block text-sm font-medium dark:text-neutral-300">
                        First Name
                    </label>
                </div>

                {/* Value or Input */}
                <div>
                    {editingField === 'firstName' ? (
                        <Input
                            name="firstName"
                            value={formData.firstName}
                            onChange={handleChange}
                            placeholder={data?.firstName}
                        />
                    ) : (
                        <span className="text-md">{data?.firstName}</span>
                    )}
                </div>

                {/* Edit / Save / Cancel */}
                <div className="flex">
                    {editingField === 'firstName' ? (
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleSave('firstName')}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>Cancel</Button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setEditingField('firstName')}
                            className="text-gray-500 hover:text-gray-800 dark:hover:text-white"
                        >
                            <IconPencil className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>


            {/* LAST NAME */}
            <div className="grid grid-cols-3 items-center gap-3 border-b py-2">
                {/* Label */}
                <div>
                    <label className="block text-sm font-medium dark:text-neutral-300">
                        Last Name
                    </label>
                </div>

                {/* Value or Input */}
                <div>
                    {editingField === 'lastName' ? (
                        <Input
                            name="lastName"
                            value={formData.lastName}
                            onChange={handleChange}
                            placeholder={data?.lastName}
                        />
                    ) : (
                        <span className="text-md">{data?.lastName}</span>
                    )}
                </div>

                {/* Edit / Save / Cancel */}
                <div className="flex">
                    {editingField === 'lastName' ? (
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleSave('lastName')}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>Cancel</Button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setEditingField('lastName')}
                            className="text-gray-500 hover:text-gray-800 dark:hover:text-white"
                        >
                            <IconPencil className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* EMAIL (usually read-only) */}
            <div className="grid grid-cols-3 items-center gap-4 border-b py-2">
                {/* Label */}
                <div>
                    <label className="block text-sm font-medium dark:text-neutral-300">
                        Email
                    </label>
                </div>

                {/* Value or Input */}
                <div>
                    {editingField === 'email' ? (
                        <Input
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            placeholder={data?.email}
                        />
                    ) : (
                        <span className="text-md">{data?.email}</span>
                    )}
                </div>
            </div>

            {/* PHONE */}
            <div className="grid grid-cols-3 items-center gap-4 border-b py-2">
                {/* Label */}
                <div>
                    <label className="block text-sm font-medium dark:text-neutral-300">
                        Phone
                    </label>
                </div>

                {/* Value or Input */}
                <div>
                    {editingField === 'phone' ? (
                        <Input
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            placeholder={data?.phone}
                        />
                    ) : (
                        <span className="text-md">{data?.phone}</span>
                    )}
                </div>

                {/* Edit / Save / Cancel */}
                <div className="flex">
                    {editingField === 'phone' ? (
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleSave('phone')}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>Cancel</Button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setEditingField('phone')}
                            className="text-gray-500 hover:text-gray-800 dark:hover:text-white"
                        >
                            <IconPencil className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

export default UserProfile
