"use client";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import React, { useState } from "react";
import { toast } from "react-toastify";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { IconPencil, IconCheck, IconX, IconUser } from "@tabler/icons-react";

function getInitials(first?: string, last?: string, email?: string): string {
    const f = first?.trim()?.[0];
    const l = last?.trim()?.[0];
    if (f || l) return `${f ?? ""}${l ?? ""}`.toUpperCase();
    return email?.trim()?.[0]?.toUpperCase() ?? "?";
}

type EditableField = "firstName" | "lastName" | "phone";

type FieldDef = {
    key: EditableField | "email";
    label: string;
    editable: boolean;
    type?: string;
};

const FIELDS: FieldDef[] = [
    { key: "firstName", label: "First name", editable: true },
    { key: "lastName", label: "Last name", editable: true },
    { key: "email", label: "Email", editable: false, type: "email" },
    { key: "phone", label: "Phone", editable: true, type: "tel" },
];

const UserProfile = () => {
    const { data, user } = useAuth();
    const [editingField, setEditingField] = useState<EditableField | null>(null);
    const [formData, setFormData] = useState({
        firstName: data?.firstName || "",
        lastName: data?.lastName || "",
        phone: data?.phone || "",
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSave = async (field: EditableField) => {
        try {
            const res = await apiClient.put(`/api/user/edit`, { [field]: formData[field] });
            if (res.status === 200) {
                toast.success("Profile updated.");
                user();
                setEditingField(null);
            }
        } catch (error) {
            toast.error("Could not update profile.");
            console.error(error);
        }
    };

    const cancel = () => {
        setEditingField(null);
        setFormData({
            firstName: data?.firstName || "",
            lastName: data?.lastName || "",
            phone: data?.phone || "",
        });
    };

    return (
        <div className="flex flex-col gap-6 p-2 max-w-3xl">
            {/* Page header */}
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Manage how your account appears.</p>
            </div>

            {/* Hero card */}
            <div className="relative rounded-2xl border bg-background overflow-hidden">
                <div className="h-20 bg-muted/40" />
                <div className="px-6 pb-6 -mt-10">
                    <div className="flex items-end gap-4">
                        <div className="rounded-full bg-background ring-4 ring-background">
                            <div className="h-20 w-20 rounded-full bg-muted text-foreground/80 flex items-center justify-center text-2xl font-semibold border border-border">
                                {getInitials(data?.firstName, data?.lastName, data?.email)}
                            </div>
                        </div>
                        <div className="pb-1 min-w-0">
                            <div className="text-xl font-semibold truncate">
                                {data?.firstName || data?.lastName
                                    ? `${data?.firstName ?? ""} ${data?.lastName ?? ""}`.trim()
                                    : "Account"}
                            </div>
                            <div className="text-sm text-muted-foreground truncate flex items-center gap-1.5">
                                <IconUser size={14} /> {data?.email}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Field list */}
            <div className="rounded-2xl border bg-background overflow-hidden">
                {FIELDS.map((field, idx) => {
                    const isEditing = editingField === field.key;
                    const valueKey = field.key;
                    const displayValue =
                        valueKey === "email"
                            ? data?.email
                            : data?.[valueKey as EditableField];
                    const formValue =
                        valueKey === "email"
                            ? ""
                            : formData[valueKey as EditableField];

                    return (
                        <div
                            key={field.key}
                            className={`grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] items-center gap-3 px-5 py-4 ${idx > 0 ? "border-t" : ""}`}
                        >
                            <Label className="text-sm font-medium text-muted-foreground">
                                {field.label}
                            </Label>
                            <div className="min-w-0">
                                {isEditing ? (
                                    <Input
                                        name={field.key}
                                        type={field.type ?? "text"}
                                        value={formValue}
                                        onChange={handleChange}
                                        autoFocus
                                    />
                                ) : (
                                    <span className="text-sm truncate block">
                                        {displayValue || <span className="text-muted-foreground italic">Not set</span>}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-2 justify-end">
                                {!field.editable ? null : isEditing ? (
                                    <>
                                        <Button size="sm" onClick={() => handleSave(field.key as EditableField)}>
                                            <IconCheck size={14} className="mr-1.5" /> Save
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={cancel}>
                                            <IconX size={14} className="mr-1.5" /> Cancel
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setEditingField(field.key as EditableField)}
                                    >
                                        <IconPencil size={14} className="mr-1.5" /> Edit
                                    </Button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default UserProfile;
