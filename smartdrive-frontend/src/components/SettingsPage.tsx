"use client"
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { useRouter } from 'next/navigation';
import React, { useState } from 'react'
import { toast } from 'react-toastify';

const SettingsPage = () => {
    const { logout } = useAuth()
    const [editingField, setEditingField] = useState<string | null>(null)

    const [isDeleting, setIsDeleting] = useState(false);

    const router = useRouter()
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
    });

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setPasswordData((prev) => ({ ...prev, [name]: value }));
    };

    const handleSubmitPassword = async () => {

        try {
            if (passwordData.newPassword !== passwordData.confirmPassword) {
                toast("Password and re-password do not match.")
                setPasswordData({
                    currentPassword: '',
                    newPassword: '',
                    confirmPassword: '',
                });
                return
            }

            const payload = {
                currentPassword: passwordData.currentPassword,
                newPassword: passwordData.newPassword,
            };

            const res = await apiClient.post('/api/user/changepassword', payload)

            if (res.status === 200) {
                console.log('Password Changed Successfully')
                toast.success('Password Changed Successfully')

            }
        } catch (error) {
            console.log('Error changing password', error);
            toast.error('Error changing password')
        }
        setPasswordData({
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
        });
        setEditingField(null);
    };

    const handleDeleteAccount = async () => {
        setIsDeleting(true);
        try {
            const res = await apiClient.delete("/api/user/delete");
            if (res.status === 200) {
                toast.success('Account Deleted')
            }
            router.push("/");
        } catch (err) {
            console.error("Account deletion failed", err);
            toast.error("Account deletion failed")
        } finally {
            setIsDeleting(false);
        }
    };

    const handleLogout = async () => {
        logout()
        toast.success('User Logged Out.')
        router.push("/")
    }



    return (
        <div className="p-10 space-y-4">
            <h2 className="text-xl font-semibold">Account Settings</h2>

            <div className="grid grid-cols-3 items-center gap-4 border-b py-2 mt-15 mb-10">
                {/* Label */}
                <div>
                    <label className="block text-sm font-medium dark:text-neutral-300">
                        Password
                    </label>
                </div>

                {/* Value or Input */}
                <div>
                    {editingField === 'changepassword' ? (
                        <div className="flex flex-col gap-2">
                            <input
                                type="password"
                                name="currentPassword"
                                className="border rounded p-2"
                                placeholder="Current password"
                                value={passwordData.currentPassword}
                                onChange={handlePasswordChange}
                            />
                            <input
                                type="password"
                                name="newPassword"
                                className="border rounded p-2"
                                placeholder="New password"
                                value={passwordData.newPassword}
                                onChange={handlePasswordChange}
                            />
                            <input
                                type="password"
                                name="confirmPassword"
                                className="border rounded p-2"
                                placeholder="Confirm new password"
                                value={passwordData.confirmPassword}
                                onChange={handlePasswordChange}
                            />
                        </div>
                    ) : (
                        <span>••••••••</span>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 mt-2">
                    {editingField === 'changepassword' ? (
                        <>
                            <Button size="sm" onClick={handleSubmitPassword}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>
                                Cancel
                            </Button>
                        </>
                    ) : (
                        <Button size="sm" className='cursor-pointer' onClick={() => setEditingField('changepassword')}>
                            Change Password
                        </Button>
                    )}
                </div>
            </div>

            <Button size='sm' className='flex mt-10 mb-10 cursor-pointer' onClick={handleLogout}>Log Out</Button>

            <Dialog>
                <DialogTrigger asChild>
                    <Button variant="destructive" className='cursor-pointer'>Delete Account</Button>
                </DialogTrigger>

                <DialogContent>
                    <DialogTitle >Delete Account</DialogTitle>
                    <DialogDescription>
                        Are you sure you want to delete your account? This action cannot be undone.
                    </DialogDescription>

                    <div className="flex justify-end gap-2 mt-10">
                        <DialogClose asChild>
                            <Button variant="outline" className='cursor-pointer'>Cancel</Button>
                        </DialogClose>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteAccount}
                            disabled={isDeleting}
                            className='cursor-pointer'
                        >
                            {isDeleting ? "Deleting..." : "Confirm Delete"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default SettingsPage;
