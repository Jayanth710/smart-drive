"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { motion } from "motion/react";
import apiClient from "@/lib/api";
import { toast } from "react-toastify";
import type { AxiosError } from "axios";

import {
    IconChevronRight,
    IconDownload,
    IconEye,
    IconSparkles,
    IconTrash,
    IconFile,
    IconPhoto,
    IconVideo,
    IconFileText,
} from "@tabler/icons-react";

import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "./ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export interface UploadItem {
    file_id: string;
    filename: string;
    filetype: string;
    created_at: string | number;

    summary?: string;
    size_bytes?: number;

    indexed?: boolean;
    private?: boolean;
}

type Action = "view" | "download" | "delete" | null;

function formatDate(value: UploadItem["created_at"]) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function formatBytes(bytes?: number) {
    if (bytes === undefined || bytes === null) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let b = bytes;
    let i = 0;
    while (b >= 1024 && i < units.length - 1) {
        b /= 1024;
        i++;
    }
    return `${b.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fileTypeLabel(filetype: string) {
    const t = (filetype || "").toLowerCase();
    if (t.includes("pdf")) return "PDF";
    if (t.includes("image")) return "Image";
    if (t.includes("video") || t.includes("media")) return "Video";
    if (t.includes("doc")) return "Doc";
    if (t.includes("sheet") || t.includes("excel")) return "Sheet";
    return filetype || "File";
}

function fileIcon(filetype: string) {
    const t = (filetype || "").toLowerCase();
    if (t.includes("image")) return <IconPhoto size={18} />;
    if (t.includes("video") || t.includes("media")) return <IconVideo size={18} />;
    if (t.includes("pdf") || t.includes("doc") || t.includes("text")) return <IconFileText size={18} />;
    return <IconFile size={18} />;
}

function isImage(filetype: string) {
    return (filetype || "").toLowerCase().includes("image");
}
function isPdf(filetype: string) {
    return (filetype || "").toLowerCase().includes("pdf");
}
function getStatus(err: unknown) {
    const e = err as AxiosError<any>;
    return e?.response?.status;
}

export function FileListWithDrawer({
    files,
    onRefresh,
}: {
    files: UploadItem[];
    onRefresh: () => void;
}) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [actionById, setActionById] = useState<Record<string, Action>>({});

    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    const selectedFile = useMemo(
        () => files.find((f) => f.file_id === selectedId) ?? null,
        [files, selectedId]
    );

    const setAction = (fileId: string, action: Action) => {
        setActionById((prev) => ({ ...prev, [fileId]: action }));
    };

    const openDrawerFor = (file: UploadItem) => {
        setSelectedId(file.file_id);
        setDrawerOpen(true);
    };

    const handleView = useCallback(async (file: UploadItem) => {
        setAction(file.file_id, "view");
        try {
            const res = await apiClient.get(`/file/${file.file_id}/url?action=view`);
            window.open(res.data.url, "_blank", "noopener,noreferrer");
        } catch (err) {
            const status = getStatus(err);
            if (status === 401 || status === 403) toast.warn("Session expired. Please login again.");
            else toast.error("Could not get viewable link.");
            console.error(err);
        } finally {
            setAction(file.file_id, null);
        }
    }, []);

    const handleDownload = useCallback(async (file: UploadItem) => {
        setAction(file.file_id, "download");
        try {
            const res = await apiClient.get(`/file/${file.file_id}/url?action=download`);
            window.location.assign(res.data.url);
        } catch (err) {
            const status = getStatus(err);
            if (status === 401 || status === 403) toast.warn("Session expired. Please login again.");
            else toast.error("Could not get download link.");
            console.error(err);
        } finally {
            setAction(file.file_id, null);
        }
    }, []);

    const handleDelete = useCallback(
        async (file: UploadItem) => {
            setAction(file.file_id, "delete");
            try {
                await apiClient.delete(`/file/${file.file_id}`);
                toast.success("File deleted.");

                setConfirmDeleteOpen(false);

                if (selectedId === file.file_id) {
                    setDrawerOpen(false);
                    setSelectedId(null);
                    setPreviewUrl(null);
                }

                onRefresh();
            } catch (err) {
                const status = getStatus(err);
                if (status === 401 || status === 403) toast.warn("Session expired. Please login again.");
                else toast.error("Could not delete the file.");
                console.error(err);
            } finally {
                setAction(file.file_id, null);
            }
        },
        [onRefresh, selectedId]
    );

    // Lazy preview URL when drawer opens
    useEffect(() => {
        const run = async () => {
            if (!drawerOpen || !selectedFile) return;

            setPreviewUrl(null);
            setPreviewLoading(true);

            try {
                const res = await apiClient.get(`/file/${selectedFile.file_id}/url?action=view`);
                setPreviewUrl(res.data.url);
            } catch (err) {
                console.error(err);
            } finally {
                setPreviewLoading(false);
            }
        };

        run();
    }, [drawerOpen, selectedFile?.file_id]);

    return (
        <div className="w-full">
            {/* Optional header */}
            <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-muted-foreground">
                    {files.length} file{files.length === 1 ? "" : "s"}
                </div>
            </div>

            {/* GRID */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {files.map((file) => {
                    const action = actionById[file.file_id] ?? null;
                    const isBusy = action !== null;

                    return (
                        <motion.div
                            key={file.file_id}
                            whileHover={{ scale: 1.01 }}
                            transition={{ type: "spring", stiffness: 320, damping: 26 }}
                            className="group rounded-xl border bg-background dark:bg-gray-900 shadow-sm hover:shadow-md transition cursor-pointer"
                            onClick={() => openDrawerFor(file)}
                            onDoubleClick={() => handleView(file)}
                            role="button"
                        >
                            {/* Top */}
                            <div className="p-3 flex items-start justify-between gap-3">
                                <div className="min-w-0 flex items-start gap-3">
                                    <div className="mt-0.5 text-muted-foreground">{fileIcon(file.filetype)}</div>

                                    <div className="min-w-0">
                                        <div className="font-medium truncate" title={file.filename}>
                                            {file.filename}
                                        </div>

                                        {/* Badges */}
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            <Badge variant="secondary">{fileTypeLabel(file.filetype)}</Badge>
                                            {file.indexed ? <Badge variant="outline">Indexed</Badge> : null}
                                            {file.private ? <Badge variant="outline">Private</Badge> : null}

                                            {file.summary ? (
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <button
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:bg-muted"
                                                            title="AI Summary"
                                                        >
                                                            <IconSparkles size={12} />
                                                            Summary
                                                        </button>
                                                    </PopoverTrigger>
                                                    {/* <PopoverContent
                            className="w-96 text-sm whitespace-pre-line"
                            onClick={(e) => e.stopPropagation()}
                            align="start"
                          >
                            {file.summary}
                          </PopoverContent> */}
                                                    <PopoverContent
                                                        side="top"
                                                        align="start"
                                                        sideOffset={8}
                                                        avoidCollisions
                                                        collisionPadding={12}
                                                        className="
                                                            w-[min(24rem,calc(100vw-1.5rem))]
                                                            max-h-[min(60vh,24rem)]
                                                            overflow-auto
                                                            whitespace-pre-line
                                                            break-words
                                                        "
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {file.summary}
                                                    </PopoverContent>

                                                </Popover>
                                            ) : null}
                                        </div>

                                        {/* Meta line (NOT a separate Uploaded column) */}
                                        <div className="text-xs text-muted-foreground mt-2">
                                            Uploaded {formatDate(file.created_at)}
                                            {file.size_bytes ? ` • ${formatBytes(file.size_bytes)}` : ""}
                                        </div>
                                    </div>
                                </div>

                                {/* Details chevron */}
                                <button
                                    className="p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openDrawerFor(file);
                                    }}
                                    aria-label="Details"
                                    title="Details"
                                >
                                    <IconChevronRight size={18} />
                                </button>
                            </div>

                            {/* Summary snippet (optional) */}
                            <div className="px-4 pb-3">
                                <div className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                                    {file.summary?.trim() ? file.summary : "No AI summary yet."}
                                </div>
                            </div>

                            {/* Hover actions row */}
                            <div className="px-4 pb-4 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    className="p-2 rounded-lg text-muted-foreground hover:text-blue-500 hover:bg-muted disabled:opacity-50"
                                    disabled={isBusy}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleView(file);
                                    }}
                                    aria-label="View"
                                    title="View"
                                >
                                    <IconEye size={18} />
                                </button>

                                <button
                                    className="p-2 rounded-lg text-muted-foreground hover:text-green-500 hover:bg-muted disabled:opacity-50"
                                    disabled={isBusy}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownload(file);
                                    }}
                                    aria-label="Download"
                                    title="Download"
                                >
                                    <IconDownload size={18} />
                                </button>

                                <button
                                    className="p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-muted disabled:opacity-50"
                                    disabled={isBusy}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedId(file.file_id);
                                        setConfirmDeleteOpen(true);
                                    }}
                                    aria-label="Delete"
                                    title="Delete"
                                >
                                    <IconTrash size={18} />
                                </button>
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* Right Drawer */}
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
                <SheetContent side="right" className="w-full sm:max-w-xl">
                    <SheetHeader>
                        <SheetTitle className="truncate">{selectedFile?.filename ?? "File"}</SheetTitle>
                        <SheetDescription className="flex items-center gap-2">
                            <Badge variant="secondary">
                                {selectedFile ? fileTypeLabel(selectedFile.filetype) : "—"}
                            </Badge>
                            <span className="text-xs">
                                {selectedFile ? `Uploaded ${formatDate(selectedFile.created_at)}` : ""}
                                {selectedFile?.size_bytes ? ` • ${formatBytes(selectedFile.size_bytes)}` : ""}
                            </span>
                        </SheetDescription>
                    </SheetHeader>

                    {!selectedFile ? (
                        <div className="mt-6 text-sm text-muted-foreground">Select a file to view details.</div>
                    ) : (
                        <div className="p-2 sm:max-h-[80vh] overflow-auto">
                            {/* Primary actions */}
                            <div className="flex gap-2 flex-wrap">
                                <Button onClick={() => handleView(selectedFile)}>
                                    <IconEye size={16} className="mr-2" />
                                    View
                                </Button>
                                <Button variant="secondary" onClick={() => handleDownload(selectedFile)}>
                                    <IconDownload size={16} className="mr-2" />
                                    Download
                                </Button>
                                <Button variant="destructive" onClick={() => setConfirmDeleteOpen(true)}>
                                    <IconTrash size={16} className="mr-2" />
                                    Delete
                                </Button>
                            </div>

                            <Tabs defaultValue="summary" className="mt-4 mb-2">
                                <TabsList>
                                    <TabsTrigger value="preview">Preview</TabsTrigger>
                                    <TabsTrigger value="summary">AI Summary</TabsTrigger>
                                </TabsList>

                                <TabsContent value="preview" className="mt-2">
                                    <div className="rounded-lg border p-4">
                                        <div className="max-h-[70vh] overflow-auto">
                                            {previewLoading ? (
                                                <div className="text-sm text-muted-foreground">Loading preview…</div>
                                            ) : !previewUrl ? (
                                                <div className="text-sm text-muted-foreground">No preview available.</div>
                                            ) : isImage(selectedFile.filetype) ? (
                                                <img src={previewUrl} alt={selectedFile.filename} className="block w-full rounded-md border" />
                                            ) : isPdf(selectedFile.filetype) ? (
                                                <iframe src={previewUrl} className="w-full h-[520px] rounded-md border" title="PDF Preview" />
                                            ) : (
                                                <div className="text-sm text-muted-foreground">Preview not supported. Use “View”.</div>
                                            )}
                                        </div>
                                    </div>
                                </TabsContent>

                                <TabsContent value="summary" className="mt-2 ">
                                    <div className="rounded-lg border p-4">
                                        <div className="text-sm text-muted-foreground mb-2">Generated summary</div>
                                        <div className="text-sm whitespace-pre-line max-h-[50vh] overflow-auto">
                                            {selectedFile.summary?.trim() ? selectedFile.summary : "No summary available yet."}
                                        </div>
                                    </div>
                                    {/* <div className="rounded-lg border p-4 mt-5">
                                        <div className="text-xs text-muted-foreground mb-2">Smart actions</div>
                                        <div className="flex gap-2 flex-wrap">
                                            <Button variant="secondary">Chat with this file</Button>
                                            <Button variant="outline">Extract key fields</Button>
                                            <Button variant="outline">Re-run OCR / Index</Button>
                                        </div>
                                    </div> */}
                                    <div className="rounded-lg border p-4 mt-3">
                                        <div className="text-xs text-muted-foreground mb-2">Smart actions</div>

                                        <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2">
                                            <Button className="w-full sm:w-auto" variant="secondary">
                                                Chat with this file
                                            </Button>
                                            <Button className="w-full sm:w-auto" variant="outline">
                                                Extract key fields
                                            </Button>
                                            <Button className="w-full sm:w-auto" variant="outline">
                                                Re-run OCR / Index
                                            </Button>
                                        </div>
                                    </div>
                                </TabsContent>

                                {/* <TabsContent value="activity" className="mt-4">
                                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                                        Activity placeholder
                                    </div>
                                    <div className="rounded-lg border p-4 mt-3">
                                        <div className="text-xs text-muted-foreground mb-2">Smart actions</div>
                                        <div className="flex gap-2 flex-wrap">
                                            <Button variant="secondary">Chat with this file</Button>
                                            <Button variant="outline">Extract key fields</Button>
                                            <Button variant="outline">Re-run OCR / Index</Button>
                                        </div>
                                    </div>
                                </TabsContent> */}

                                <TabsContent value="activity" className="mt-4">
                                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                                        Activity placeholder (uploads, indexing, deletes, etc.)
                                    </div>
                                </TabsContent>
                            </Tabs>
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* Delete confirm */}
            <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete file?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete{" "}
                            <span className="font-medium">{selectedFile?.filename ?? "this file"}</span>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={!selectedFile}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => selectedFile && handleDelete(selectedFile)}
                            disabled={!selectedFile || (actionById[selectedFile.file_id] ?? null) === "delete"}
                        >
                            {selectedFile && (actionById[selectedFile.file_id] ?? null) === "delete"
                                ? "Deleting…"
                                : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div >
    );
}