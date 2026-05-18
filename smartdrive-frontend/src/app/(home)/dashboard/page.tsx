"use client";
import { UploadItem } from "@/components/FileListWithDrawer";
import SearchBar from "@/components/Search";
import React, { useCallback, useRef, useState } from "react";
import { useFetchCollections } from "@/lib/fetchCollections";
import { FileListWithDrawer } from "@/components/FileListWithDrawer";
import { StatTilesRow } from "@/components/StatTile";
import UploadFile from "@/components/UploadFile";
import { Button } from "@/components/ui/button";
import { IconX, IconMailExclamation, IconCloudUpload } from "@tabler/icons-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { toast } from "react-toastify";
import type { AxiosError } from "axios";
import { OnboardingTip } from "@/components/OnboardingTip";

async function hashFile(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function uploadDroppedFile(file: File): Promise<void> {
    const hash = await hashFile(file);
    try {
        await apiClient.get("/file/exists", { params: { hash }, withCredentials: true });
        throw new Error("DUP");
    } catch (err: unknown) {
        const status = (err as AxiosError)?.response?.status;
        if (status !== 404) {
            if ((err as Error)?.message === "DUP") throw new Error("File already exists.");
            throw new Error("Could not check for duplicates.");
        }
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("fileHash", hash);
    await apiClient.post("/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        withCredentials: true,
    });
}

const Home = () => {
    const { projects, error, refreshData, isLoading, combinedData } = useFetchCollections();
    const [searchResults, setSearchResults] = useState<UploadItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const { data: authUser } = useAuth();
    const [verifyDismissed, setVerifyDismissed] = useState(false);
    const [resending, setResending] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [dropUploading, setDropUploading] = useState(false);
    const dragCounter = useRef(0);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer?.types?.includes("Files")) {
            dragCounter.current += 1;
            setDragActive(true);
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current = Math.max(0, dragCounter.current - 1);
        if (dragCounter.current === 0) setDragActive(false);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current = 0;
        setDragActive(false);

        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        setDropUploading(true);
        let okCount = 0;
        for (const file of files) {
            try {
                await uploadDroppedFile(file);
                toast.success(`${file.name} uploaded.`);
                okCount += 1;
            } catch (err) {
                toast.error(`${file.name}: ${(err as Error).message || "Upload failed"}`);
            }
        }
        setDropUploading(false);
        if (okCount > 0) refreshData();
    }, [refreshData]);

    const resendVerification = async () => {
        if (resending) return;
        setResending(true);
        try {
            await apiClient.post("/api/resend-verification");
            toast.success("Verification email sent. Check your inbox.");
        } catch {
            toast.error("Could not send verification email. Try again later.");
        } finally {
            setResending(false);
        }
    };

    const handleAction = async () => {
        refreshData();
    };

    if (error) {
        return (
            <div className="flex justify-center items-center flex-1 p-4 text-red-500">
                <p className="text-lg">Error: Could not load recent uploads.</p>
            </div>
        );
    }

    const inSearch = searchQuery.trim().length > 0;
    const clearSearch = () => {
        setSearchResults([]);
        setSearchQuery("");
    };

    const showVerifyBanner = !!authUser && authUser.emailVerified === false && !verifyDismissed;

    return (
        <div
            className="relative flex flex-col gap-6 p-2"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {(dragActive || dropUploading) && (
                <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-violet-500/10 backdrop-blur-[1px]">
                    <div className="rounded-2xl border-2 border-dashed border-violet-500/70 bg-background/90 px-8 py-6 shadow-xl text-center">
                        <IconCloudUpload size={32} className="mx-auto mb-2 text-violet-500" />
                        <div className="text-base font-medium">
                            {dropUploading ? "Uploading…" : "Drop to upload"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                            Files are extracted and indexed automatically.
                        </div>
                    </div>
                </div>
            )}
            {showVerifyBanner && (
                <div className="flex flex-col sm:flex-row sm:items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                        <IconMailExclamation size={18} className="mt-0.5 shrink-0" />
                        <div className="flex-1 text-sm min-w-0">
                            <div className="font-medium">Verify your email</div>
                            <div className="text-xs opacity-80 mt-0.5 break-words">
                                We sent a confirmation link to <span className="font-medium">{authUser?.email}</span>. Verify it to keep account recovery and security alerts working.
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 sm:shrink-0 self-end sm:self-auto">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={resendVerification}
                            disabled={resending}
                            className="h-8"
                        >
                            {resending ? "Sending…" : "Resend email"}
                        </Button>
                        <button
                            onClick={() => setVerifyDismissed(true)}
                            title="Dismiss"
                            className="p-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-500/20"
                        >
                            <IconX size={14} />
                        </button>
                    </div>
                </div>
            )}

            <OnboardingTip
                id="dashboard-welcome"
                title="Welcome to SmartDrive"
                body={
                    <>
                        Drag and drop any file here to upload. Click a file to summarize, browse entities,
                        or chat with it. Try <span className="font-medium">Quick chat</span> in the sidebar for
                        one-off files that don&apos;t need saving.
                    </>
                }
            />

            {/* Page header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Your AI-indexed files at a glance.
                    </p>
                </div>
            </div>

            {/* Search */}
            <div className="max-w-2xl w-full">
                <SearchBar
                    page="SmartDrive"
                    onSearchResults={setSearchResults}
                    onQueryChange={setSearchQuery}
                />
            </div>

            {inSearch ? (
                <FileListWithDrawer
                    files={searchResults}
                    onRefresh={handleAction}
                    isLoading={false}
                    header={
                        <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-2.5">
                            <div className="text-sm">
                                <strong>{searchResults.length}</strong> result{searchResults.length === 1 ? "" : "s"} for{" "}
                                <span className="font-medium">&ldquo;{searchQuery}&rdquo;</span>
                            </div>
                            <Button size="sm" variant="ghost" onClick={clearSearch}>
                                <IconX size={14} className="mr-1.5" /> Clear search
                            </Button>
                        </div>
                    }
                />
            ) : (
                <>
                    <StatTilesRow
                        documents={projects.documents.description}
                        images={projects.images.description}
                        media={projects.media.description}
                    />

                    <FileListWithDrawer
                        files={combinedData || []}
                        onRefresh={handleAction}
                        isLoading={isLoading}
                        header={
                            <div className="flex items-end justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold">Your files</h2>
                                    <p className="text-xs text-muted-foreground">
                                        Filter, search, and re-extract any file.
                                    </p>
                                </div>
                            </div>
                        }
                        headerAction={<UploadFile compact onUploaded={handleAction} />}
                    />
                </>
            )}
        </div>
    );
};

export default Home;
