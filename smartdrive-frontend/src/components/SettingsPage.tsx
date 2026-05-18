"use client";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "react-toastify";
import { IconAlertTriangle, IconLogout, IconLock, IconTrash, IconDatabase } from "@tabler/icons-react";

const SettingsPage = () => {
    const { logout } = useAuth();
    const router = useRouter();
    const [editingPassword, setEditingPassword] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [passwordData, setPasswordData] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
    });

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setPasswordData((prev) => ({ ...prev, [name]: value }));
    };

    const resetPasswordForm = () => {
        setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
    };

    const handleSubmitPassword = async () => {
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            toast.error("Passwords do not match.");
            return;
        }
        try {
            const res = await apiClient.post("/api/user/changepassword", {
                currentPassword: passwordData.currentPassword,
                newPassword: passwordData.newPassword,
            });
            if (res.status === 200) {
                toast.success("Password updated.");
                resetPasswordForm();
                setEditingPassword(false);
            }
        } catch (error) {
            console.error("Error changing password", error);
            toast.error("Could not change password.");
        }
    };

    const handleDeleteAccount = async () => {
        setIsDeleting(true);
        try {
            const res = await apiClient.delete("/api/user/delete");
            if (res.status === 200) toast.success("Account deleted.");
            await logout();
        } catch (err) {
            console.error("Account deletion failed", err);
            toast.error("Account deletion failed.");
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDeleteAllData = async () => {
        setIsDeleting(true);
        try {
            const res = await apiClient.delete("/api/user/data");
            if (res.status === 200) toast.success("All your data has been deleted.");
            router.push("/dashboard");
        } catch (err) {
            console.error("Data deletion failed", err);
            toast.error("Data deletion failed.");
        } finally {
            setIsDeleting(false);
        }
    };

    const handleLogout = async () => {
        await logout();
        toast.success("Logged out.");
    };

    return (
        <div className="flex flex-col gap-6 p-2 max-w-3xl">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Security, session, and account.</p>
            </div>

            {/* Security */}
            <section className="rounded-2xl border bg-background overflow-hidden">
                <div className="px-5 py-4 border-b flex items-center gap-2">
                    <IconLock size={16} className="text-muted-foreground" />
                    <h2 className="font-medium">Security</h2>
                </div>
                <div className="p-5">
                    {!editingPassword ? (
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium">Password</div>
                                <div className="text-xs text-muted-foreground">Last changed via this device.</div>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => setEditingPassword(true)}>
                                Change password
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="grid gap-1.5">
                                <Label htmlFor="currentPassword">Current password</Label>
                                <Input
                                    id="currentPassword"
                                    type="password"
                                    name="currentPassword"
                                    value={passwordData.currentPassword}
                                    onChange={handlePasswordChange}
                                />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="newPassword">New password</Label>
                                <Input
                                    id="newPassword"
                                    type="password"
                                    name="newPassword"
                                    value={passwordData.newPassword}
                                    onChange={handlePasswordChange}
                                />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="confirmPassword">Confirm new password</Label>
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    name="confirmPassword"
                                    value={passwordData.confirmPassword}
                                    onChange={handlePasswordChange}
                                />
                            </div>
                            <div className="flex gap-2 justify-end pt-1">
                                <Button size="sm" variant="ghost" onClick={() => { resetPasswordForm(); setEditingPassword(false); }}>
                                    Cancel
                                </Button>
                                <Button size="sm" onClick={handleSubmitPassword}>
                                    Update password
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* Session */}
            <section className="rounded-2xl border bg-background overflow-hidden">
                <div className="px-5 py-4 border-b flex items-center gap-2">
                    <IconLogout size={16} className="text-muted-foreground" />
                    <h2 className="font-medium">Session</h2>
                </div>
                <div className="p-5 flex items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-medium">Sign out of this browser</div>
                        <div className="text-xs text-muted-foreground">
                            Revokes your current session. You can sign back in any time.
                        </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={handleLogout}>
                        Log out
                    </Button>
                </div>
            </section>

            {/* Danger zone */}
            <section className="rounded-2xl border border-red-300/40 bg-red-500/[0.02] overflow-hidden">
                <div className="px-5 py-4 border-b border-red-300/40 flex items-center gap-2">
                    <IconAlertTriangle size={16} className="text-red-500" />
                    <h2 className="font-medium text-red-600">Danger zone</h2>
                </div>

                <div className="divide-y divide-red-300/30">
                    <div className="p-5 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                            <IconDatabase size={16} className="mt-0.5 text-red-500 shrink-0" />
                            <div className="min-w-0">
                                <div className="text-sm font-medium">Delete all data</div>
                                <div className="text-xs text-muted-foreground">
                                    Removes every uploaded file and its extracted metadata. Your account stays.
                                </div>
                            </div>
                        </div>
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button size="sm" variant="destructive">Delete data</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogTitle>Delete all data</DialogTitle>
                                <DialogDescription>
                                    This permanently removes all uploaded files and their extracted summaries. This cannot be undone.
                                </DialogDescription>
                                <div className="flex justify-end gap-2 mt-6">
                                    <DialogClose asChild>
                                        <Button variant="outline">Cancel</Button>
                                    </DialogClose>
                                    <Button variant="destructive" onClick={handleDeleteAllData} disabled={isDeleting}>
                                        {isDeleting ? "Deleting…" : "Confirm delete"}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <div className="p-5 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                            <IconTrash size={16} className="mt-0.5 text-red-500 shrink-0" />
                            <div className="min-w-0">
                                <div className="text-sm font-medium">Delete account</div>
                                <div className="text-xs text-muted-foreground">
                                    Removes your account and all associated data permanently.
                                </div>
                            </div>
                        </div>
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button size="sm" variant="destructive">Delete account</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogTitle>Delete account</DialogTitle>
                                <DialogDescription>
                                    This permanently removes your account and every piece of data tied to it. This cannot be undone.
                                </DialogDescription>
                                <div className="flex justify-end gap-2 mt-6">
                                    <DialogClose asChild>
                                        <Button variant="outline">Cancel</Button>
                                    </DialogClose>
                                    <Button variant="destructive" onClick={handleDeleteAccount} disabled={isDeleting}>
                                        {isDeleting ? "Deleting…" : "Confirm delete"}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default SettingsPage;
