"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "motion/react";
import apiClient from "@/lib/api";
import { toast } from "react-toastify";
import type { AxiosError } from "axios";
import Image from "next/image";

import {
    IconDownload,
    IconEye,
    IconSparkles,
    IconTrash,
    IconFile,
    IconPhoto,
    IconVideo,
    IconFileText,
    IconLoader2,
    IconAlertTriangle,
    IconCircleCheck,
    IconDots,
    IconCloudUpload,
    IconRefresh,
    IconLayoutGrid,
    IconList,
    IconSearch,
    IconArrowsSort,
    IconX,
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { FileChat } from "./FileChat";

export type ExtractionStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface IndexJson {
    relevant_dates?: string[];
    entities?: string[];
    document_ids?: string[];
    technical_topics?: string[];
    [key: string]: unknown;
}

export interface UploadItem {
    file_id: string;
    filename: string;
    filetype: string;
    created_at: string | number;

    summary?: string;
    size_bytes?: number;

    indexed?: boolean;
    private?: boolean;

    extraction_status?: ExtractionStatus;
    extraction_error?: string;
    index_json?: IndexJson;

    /** Set by the search endpoint: the chunk text that scored highest against
     *  the user's query. Surfaced on the card so users know *why* a file matched. */
    matched_chunk?: string;
    /** Hybrid-search score from Weaviate. Present on search results only. */
    score?: number;
    /** High-precision filter hits: entities/dates/doc_ids the user query mentioned
     *  that this file also contains. Empty/undefined for pure semantic hits. */
    matched_entities?: string[];
    matched_dates?: string[];
    matched_doc_ids?: string[];
}

type Action = "view" | "download" | "delete" | "extract" | null;

function formatDate(value: UploadItem["created_at"]) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function formatRelative(value: UploadItem["created_at"]) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
}

function topEntities(idx: IndexJson | undefined, max = 3): string[] {
    if (!idx) return [];
    const all: string[] = [];
    for (const key of ["entities", "document_ids", "technical_topics", "relevant_dates"] as const) {
        const v = idx[key];
        if (Array.isArray(v)) for (const item of v) if (typeof item === "string" && item.trim()) all.push(item);
    }
    // de-dup preserving order
    return Array.from(new Set(all)).slice(0, max);
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
    const e = err as AxiosError<unknown>;
    return e?.response?.status;
}

// Per-file-type accent. Used for the gradient border, icon ring, and spotlight tint.
function typeAccent(filetype: string) {
    const t = (filetype || "").toLowerCase();
    if (t.includes("image"))
        return {
            from: "rgba(244, 114, 182, 0.9)", // pink-400
            via: "rgba(217, 70, 239, 0.9)",   // fuchsia-500
            to: "rgba(139, 92, 246, 0.9)",    // violet-500
            spot: "rgba(244, 114, 182, 0.18)",
            ring: "from-pink-400/10 to-violet-500/10",
        };
    if (t.includes("video") || t.includes("media"))
        return {
            from: "rgba(139, 92, 246, 0.9)", // violet-500
            via: "rgba(99, 102, 241, 0.9)",  // indigo-500
            to: "rgba(59, 130, 246, 0.9)",   // blue-500
            spot: "rgba(139, 92, 246, 0.18)",
            ring: "from-violet-500/10 to-blue-500/10",
        };
    if (t.includes("audio"))
        return {
            from: "rgba(99, 102, 241, 0.9)",  // indigo-500
            via: "rgba(56, 189, 248, 0.9)",   // sky-400
            to: "rgba(45, 212, 191, 0.9)",    // teal-400
            spot: "rgba(56, 189, 248, 0.18)",
            ring: "from-indigo-500/10 to-teal-400/10",
        };
    if (t.includes("pdf") || t.includes("doc") || t.includes("text"))
        return {
            from: "rgba(34, 211, 238, 0.9)", // cyan-400
            via: "rgba(45, 212, 191, 0.9)",  // teal-400
            to: "rgba(16, 185, 129, 0.9)",   // emerald-500
            spot: "rgba(34, 211, 238, 0.18)",
            ring: "from-cyan-400/10 to-emerald-500/10",
        };
    return {
        from: "rgba(148, 163, 184, 0.7)", // slate-400
        via: "rgba(100, 116, 139, 0.7)",  // slate-500
        to: "rgba(71, 85, 105, 0.7)",     // slate-600
        spot: "rgba(148, 163, 184, 0.15)",
        ring: "from-slate-400/10 to-slate-600/10",
    };
}

function ExtractionBadge({ status }: { status: ExtractionStatus | undefined }) {
    const s = status ?? 'done';
    if (s === 'done') {
        return (
            <Badge variant="outline" className="gap-1">
                <IconCircleCheck size={12} className="text-emerald-500" />
                Ready
            </Badge>
        );
    }
    if (s === 'failed') {
        return (
            <Badge variant="outline" className="gap-1 border-red-300 text-red-600">
                <IconAlertTriangle size={12} />
                Extraction failed
            </Badge>
        );
    }
    // pending or processing
    return (
        <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300">
            <IconLoader2 size={12} className="animate-spin" />
            {s === 'pending' ? 'Queued' : 'Processing'}
        </Badge>
    );
}

const ENTITY_CATEGORIES: { key: keyof IndexJson; label: string }[] = [
    { key: "entities", label: "People & organizations" },
    { key: "relevant_dates", label: "Dates" },
    { key: "document_ids", label: "Document IDs" },
    { key: "technical_topics", label: "Topics" },
];

function EntityPanel({ idx }: { idx: IndexJson | undefined }) {
    const nonEmpty = ENTITY_CATEGORIES.filter((c) => {
        const v = idx?.[c.key];
        return Array.isArray(v) && v.length > 0;
    });
    if (!idx || nonEmpty.length === 0) {
        return (
            <div className="rounded-lg border p-6 text-sm text-muted-foreground text-center">
                <IconSparkles size={20} className="mx-auto mb-2 opacity-60" />
                No structured entities extracted yet.
            </div>
        );
    }
    return (
        <div className="space-y-4">
            {nonEmpty.map((cat) => {
                const items = (idx[cat.key] as string[]).filter((x) => typeof x === "string" && x.trim());
                if (items.length === 0) return null;
                return (
                    <div key={cat.key as string} className="rounded-lg border p-4">
                        <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">{cat.label}</div>
                        <div className="flex flex-wrap gap-1.5">
                            {items.map((item, i) => (
                                <span
                                    key={`${item}-${i}`}
                                    className="text-xs px-2 py-1 rounded-md bg-muted/60 text-foreground"
                                >
                                    {item}
                                </span>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Crazy mode: animated conic-gradient border, mouse-tracked spotlight, 3D tilt,
 * per-file-type color theming, status-driven aura, kebab menu for actions.
 */
function FileCard({
    file,
    busyAction,
    selected,
    selectMode,
    onOpen,
    onView,
    onDownload,
    onDeleteRequest,
    onExtract,
    onToggleSelect,
}: {
    file: UploadItem;
    busyAction: Action;
    selected: boolean;
    selectMode: boolean;
    onOpen: () => void;
    onView: () => void;
    onDownload: () => void;
    onDeleteRequest: () => void;
    onExtract: () => void;
    onToggleSelect: () => void;
}) {
    const accent = useMemo(() => typeAccent(file.filetype), [file.filetype]);
    const reduce = useReducedMotion();
    const ref = useRef<HTMLDivElement | null>(null);
    const entities = useMemo(() => topEntities(file.index_json), [file.index_json]);
    const showThumbnail = isImage(file.filetype) && (file.extraction_status ?? "done") === "done";

    // Lazy-load thumbnail signed URL when the card enters the viewport.
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);
    const [thumbFailed, setThumbFailed] = useState(false);
    useEffect(() => {
        if (!showThumbnail || thumbUrl || thumbFailed) return;
        const node = ref.current;
        if (!node) return;
        const observer = new IntersectionObserver(async (entries) => {
            if (!entries[0]?.isIntersecting) return;
            observer.disconnect();
            try {
                const res = await apiClient.get(`/file/${file.file_id}/url?action=view`);
                setThumbUrl(res.data.url);
            } catch {
                setThumbFailed(true);
            }
        }, { rootMargin: "200px" });
        observer.observe(node);
        return () => observer.disconnect();
    }, [file.file_id, showThumbnail, thumbUrl, thumbFailed]);

    // Pointer position normalised to the card (0..1)
    const px = useMotionValue(0.5);
    const py = useMotionValue(0.5);
    // Raw pixel position for the spotlight gradient
    const sx = useMotionValue(-9999);
    const sy = useMotionValue(-9999);

    // Tilt — convert pointer position into a small rotation.
    const rotX = useSpring(useTransform(py, [0, 1], [6, -6]), { stiffness: 220, damping: 18 });
    const rotY = useSpring(useTransform(px, [0, 1], [-6, 6]), { stiffness: 220, damping: 18 });

    const status = file.extraction_status ?? "done";
    const isBusy = busyAction !== null;
    const isStuck = status === "pending" || status === "processing";

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (reduce) return;
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        px.set(x / rect.width);
        py.set(y / rect.height);
        sx.set(x);
        sy.set(y);
    };

    const handleMouseLeave = () => {
        px.set(0.5);
        py.set(0.5);
        sx.set(-9999);
        sy.set(-9999);
    };

    const spotlight = useTransform(
        [sx, sy] as never,
        ([x, y]: number[]) =>
            `radial-gradient(420px circle at ${x}px ${y}px, ${accent.spot}, transparent 55%)`
    );

    const statusRing =
        status === "failed"
            ? "ring-red-500/20"
            : isStuck
                ? "ring-amber-500/20"
                : "ring-border";

    return (
        <motion.div
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={() => (selectMode ? onToggleSelect() : onOpen())}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (selectMode) onToggleSelect(); else onOpen();
                }
            }}
            style={{ rotateX: reduce ? 0 : rotX, rotateY: reduce ? 0 : rotY, transformStyle: "preserve-3d" }}
            whileTap={{ scale: 0.985 }}
            className={`relative group rounded-2xl cursor-pointer ring-1 ${selected ? "ring-2 ring-violet-500" : statusRing} bg-background dark:bg-zinc-950 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300`}
        >
            {/* Thin colored accent strip on top — the only "type color" the card carries */}
            <div
                aria-hidden
                className="absolute top-0 inset-x-0 h-[3px] opacity-80"
                style={{
                    background: `linear-gradient(90deg, ${accent.from}, ${accent.via}, ${accent.to})`,
                }}
            />

            <div className="relative" style={{ transform: "translateZ(0)" }}>
                {/* Mouse-tracking spotlight */}
                <motion.div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    style={{ background: spotlight }}
                />

                {/* Processing aurora */}
                {isStuck && (
                    <div
                        aria-hidden
                        className="pointer-events-none absolute -inset-px rounded-2xl opacity-40"
                        style={{
                            background:
                                "linear-gradient(120deg, transparent 30%, rgba(245,158,11,0.18) 50%, transparent 70%)",
                            backgroundSize: "200% 100%",
                            animation: reduce ? undefined : "shimmer 2.4s ease-in-out infinite",
                        }}
                    />
                )}

                {/* Selection checkbox — appears on hover (or always, when in selectMode) */}
                <label
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
                    className={`absolute top-3 left-3 z-10 w-5 h-5 rounded-md border-2 cursor-pointer transition flex items-center justify-center bg-background/95 ${
                        selected
                            ? "border-violet-500 bg-violet-500"
                            : `border-border ${selectMode ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`
                    }`}
                >
                    {selected && <IconCircleCheck size={14} className="text-white" />}
                </label>

                {/* Thumbnail for images (lazy) */}
                {showThumbnail && (
                    <div className="relative h-32 w-full bg-muted/40 overflow-hidden border-b">
                        {thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={thumbUrl}
                                alt={file.filename}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        ) : thumbFailed ? (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                <IconPhoto size={28} />
                            </div>
                        ) : (
                            <div className="w-full h-full animate-pulse bg-gradient-to-br from-muted to-muted/50" />
                        )}
                    </div>
                )}

                {/* Header band for non-image files — matches image thumbnail's visual weight.
                    Shows a big themed icon + filename extension on a soft tinted gradient. */}
                {!showThumbnail && (
                    <div
                        className="relative h-24 w-full overflow-hidden border-b flex items-center justify-center"
                        style={{
                            background: `linear-gradient(135deg, ${accent.from.replace("0.9", "0.08")}, ${accent.to.replace("0.9", "0.06")})`,
                        }}
                    >
                        {/* Faint repeating watermark of the type icon for texture */}
                        <div className="absolute inset-0 opacity-[0.04] pointer-events-none flex items-center justify-center">
                            <div style={{ transform: "scale(4)" }} className="text-foreground">
                                {fileIcon(file.filetype)}
                            </div>
                        </div>
                        {/* Centered icon + extension tag */}
                        <div className="relative flex items-center gap-3">
                            <div
                                className="rounded-xl p-3 ring-1 ring-white/10 dark:ring-white/5 backdrop-blur-sm"
                                style={{
                                    background: `linear-gradient(135deg, ${accent.from.replace("0.9", "0.18")}, ${accent.to.replace("0.9", "0.18")})`,
                                }}
                            >
                                <div className="text-foreground" style={{ transform: "scale(1.4)" }}>
                                    {fileIcon(file.filetype)}
                                </div>
                            </div>
                            {(() => {
                                const ext = file.filename.split(".").pop()?.toUpperCase();
                                if (!ext || ext.length > 5) return null;
                                return (
                                    <div className="text-[11px] font-semibold tracking-wider px-2 py-1 rounded-md bg-background/70 text-foreground/80 ring-1 ring-border">
                                        {ext}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* Content */}
                <div className="relative p-5 flex flex-col gap-3">
                    {/* Header — every card now has imagery up top (thumbnail or band),
                        so we don't repeat the icon down here. Filename clamps to 2 lines. */}
                    <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="font-semibold leading-tight text-[15px] line-clamp-2 break-words" title={file.filename}>
                                {file.filename}
                            </div>
                            <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                                {fileTypeLabel(file.filetype)} · {formatRelative(file.created_at)}
                            </div>
                        </div>

                        {/* Quick re-run extraction — hover-revealed (always visible on touch via :focus-within fallback). Hidden while processing. */}
                        {status !== "processing" && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onExtract(); }}
                                disabled={isBusy}
                                aria-label={status === "failed" ? "Retry extraction" : "Re-run extraction"}
                                title={status === "failed" ? "Retry extraction" : "Re-run extraction"}
                                className="shrink-0 p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                            >
                                <IconRefresh size={16} className={busyAction === "extract" ? "animate-spin" : ""} />
                            </button>
                        )}

                        {/* Kebab menu — always visible, works on touch */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    onClick={(e) => e.stopPropagation()}
                                    className="shrink-0 p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
                                    aria-label="File actions"
                                    title="Actions"
                                    disabled={isBusy}
                                >
                                    <IconDots size={18} />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem onClick={onView} disabled={isStuck}>
                                    <IconEye size={14} className="mr-2" /> View
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={onDownload}>
                                    <IconDownload size={14} className="mr-2" /> Download
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={onExtract} disabled={status === "processing"}>
                                    <IconRefresh size={14} className="mr-2" />
                                    {status === "failed" ? "Retry extraction" : "Re-run extraction"}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={onDeleteRequest} className="text-red-600 focus:text-red-600">
                                    <IconTrash size={14} className="mr-2" /> Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {/* Status row */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <ExtractionBadge status={file.extraction_status} />
                    </div>

                    {/* Hero summary — 3 lines, soft fade-out for overflow */}
                    {status === "done" && file.summary?.trim() && (
                        <div className="relative">
                            <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                                {file.summary}
                            </p>
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-background to-transparent" />
                        </div>
                    )}
                    {status === "done" && !file.summary?.trim() && (
                        <div className="text-xs text-muted-foreground italic flex items-center gap-1">
                            <IconSparkles size={12} /> No summary yet
                        </div>
                    )}
                    {status === "failed" && (
                        <div className="text-xs text-red-600/90 flex items-start gap-1.5">
                            <IconAlertTriangle size={12} className="mt-0.5 shrink-0" />
                            <span>{file.extraction_error ?? "Extraction failed."}</span>
                        </div>
                    )}

                    {/* High-precision filter hits — entities/dates/IDs from the user's query
                        that this file actually contains. Strongest signal of "this is the file you meant." */}
                    {(file.matched_entities?.length || file.matched_dates?.length || file.matched_doc_ids?.length) && (
                        <div className="flex flex-wrap gap-1.5 items-center">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Matches:
                            </span>
                            {file.matched_entities?.map((e) => (
                                <span key={`me-${e}`} className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium">
                                    {e}
                                </span>
                            ))}
                            {file.matched_dates?.map((d) => (
                                <span key={`md-${d}`} className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium">
                                    {d}
                                </span>
                            ))}
                            {file.matched_doc_ids?.map((d) => (
                                <span key={`mi-${d}`} className="text-[11px] px-1.5 py-0.5 rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-300 font-medium">
                                    #{d}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Matched chunk — only present on search results. Shows the actual
                        snippet that scored highest so users know *why* this file matched. */}
                    {file.matched_chunk && (
                        <div className="rounded-md border-l-2 border-violet-500/60 bg-violet-500/[0.04] px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                                <IconSearch size={10} /> Matched in this file
                            </div>
                            <div className="text-xs italic text-foreground/80 line-clamp-3 leading-relaxed">
                                &ldquo;{file.matched_chunk}&rdquo;
                            </div>
                        </div>
                    )}

                    {/* Entity chips from index_json — the "AI understood this file" moment */}
                    {entities.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {entities.map((e, i) => (
                                <span
                                    key={`${e}-${i}`}
                                    className="text-[10.5px] px-1.5 py-0.5 rounded-md bg-muted/60 text-foreground/70 max-w-[140px] truncate"
                                    title={e}
                                >
                                    {e}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

type FilterKind = "all" | "images" | "docs" | "media" | "failed";
type SortKind = "newest" | "oldest" | "name" | "type" | "status";
type ViewKind = "grid" | "list";

const FILTERS: { value: FilterKind; label: string }[] = [
    { value: "all", label: "All" },
    { value: "docs", label: "Docs" },
    { value: "images", label: "Images" },
    { value: "media", label: "Media" },
    { value: "failed", label: "Failed" },
];

const SORTS: { value: SortKind; label: string }[] = [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "name", label: "Name" },
    { value: "type", label: "Type" },
    { value: "status", label: "Status" },
];

function matchesFilter(f: UploadItem, kind: FilterKind): boolean {
    if (kind === "all") return true;
    if (kind === "failed") return (f.extraction_status ?? "done") === "failed";
    const t = (f.filetype || "").toLowerCase();
    if (kind === "images") return t.startsWith("image/");
    if (kind === "media") return t.startsWith("audio/") || t.startsWith("video/");
    if (kind === "docs") return !t.startsWith("image/") && !t.startsWith("audio/") && !t.startsWith("video/");
    return true;
}

function sortFiles(arr: UploadItem[], kind: SortKind): UploadItem[] {
    const copy = [...arr];
    switch (kind) {
        case "newest": return copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        case "oldest": return copy.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        case "name": return copy.sort((a, b) => a.filename.localeCompare(b.filename));
        case "type": return copy.sort((a, b) => a.filetype.localeCompare(b.filetype));
        case "status": {
            const order: Record<string, number> = { failed: 0, processing: 1, pending: 2, done: 3 };
            return copy.sort((a, b) => (order[a.extraction_status ?? "done"] ?? 4) - (order[b.extraction_status ?? "done"] ?? 4));
        }
    }
}

function FileListSkeleton({ count = 6 }: { count?: number }) {
    return (
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="rounded-2xl border bg-background overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-muted via-muted-foreground/20 to-muted animate-pulse" />
                    <div className="p-5 flex flex-col gap-3">
                        <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-xl bg-muted animate-pulse" />
                            <div className="flex-1 space-y-2">
                                <div className="h-3.5 w-3/4 bg-muted animate-pulse rounded" />
                                <div className="h-2.5 w-1/3 bg-muted animate-pulse rounded" />
                            </div>
                        </div>
                        <div className="h-2.5 w-full bg-muted animate-pulse rounded" />
                        <div className="h-2.5 w-5/6 bg-muted animate-pulse rounded" />
                        <div className="h-2.5 w-2/3 bg-muted animate-pulse rounded" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function FileListWithDrawer({
    files,
    onRefresh,
    isLoading,
    hideTypeFilter,
    header,
    headerAction,
}: {
    files: UploadItem[];
    onRefresh: () => void;
    isLoading?: boolean;
    /** Hide the All/Docs/Images/Media pills (use on dedicated pages where type is already fixed). Failed pill stays. */
    hideTypeFilter?: boolean;
    /** Slot rendered above the controls bar — pages use this for titles, result framing, etc. */
    header?: React.ReactNode;
    /** Slot rendered inside the controls bar (right side) — e.g. an Upload button. */
    headerAction?: React.ReactNode;
}) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [actionById, setActionById] = useState<Record<string, Action>>({});

    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewText, setPreviewText] = useState<string | null>(null);
    const [previewTextLoading, setPreviewTextLoading] = useState(false);
    const [previewTextTruncated, setPreviewTextTruncated] = useState(false);

    // Which drawer tab is active. We control this so the "Chat with this file"
    // action button can jump to the Chat tab. Resets when the file changes.
    const [drawerTab, setDrawerTab] = useState<"preview" | "summary" | "entities" | "chat">("summary");
    useEffect(() => { setDrawerTab("summary"); }, [selectedId]);

    // List controls
    const [filter, setFilter] = useState<FilterKind>("all");
    const [sort, setSort] = useState<SortKind>("newest");
    const [view, setView] = useState<ViewKind>("grid");
    const [search, setSearch] = useState("");
    const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

    const inFlightCount = useMemo(
        () => files.filter((f) => {
            const s = f.extraction_status ?? "done";
            return s === "pending" || s === "processing";
        }).length,
        [files]
    );
    const failedCount = useMemo(
        () => files.filter((f) => (f.extraction_status ?? "done") === "failed").length,
        [files]
    );

    // Auto-poll while anything is in flight, with backoff.
    useEffect(() => {
        if (inFlightCount === 0) return;
        let attempt = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const delays = [3000, 5000, 10000, 20000, 30000];
        const tick = () => {
            onRefresh();
            const delay = delays[Math.min(attempt, delays.length - 1)];
            attempt++;
            timer = setTimeout(tick, delay);
        };
        timer = setTimeout(tick, delays[0]);
        return () => { if (timer) clearTimeout(timer); };
    }, [inFlightCount, onRefresh]);

    const visibleFiles = useMemo(() => {
        const filtered = files.filter((f) => matchesFilter(f, filter));
        const searched = search.trim()
            ? filtered.filter((f) => f.filename.toLowerCase().includes(search.toLowerCase().trim()))
            : filtered;
        return sortFiles(searched, sort);
    }, [files, filter, sort, search]);

    const selectMode = bulkSelected.size > 0;
    const toggleSelect = (id: string) => {
        setBulkSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const clearSelection = () => setBulkSelected(new Set());

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

    const handleExtract = useCallback(
        async (file: UploadItem) => {
            // Optimistic: flip status immediately so the UI feels instant.
            setAction(file.file_id, "extract");
            file.extraction_status = "pending";
            try {
                await apiClient.post(`/file/${file.file_id}/extract`);
                toast.success("Extraction queued.");
                onRefresh();
            } catch (err) {
                const status = getStatus(err);
                if (status === 409) toast.info("Extraction is already running for this file.");
                else if (status === 401 || status === 403) toast.warn("Session expired. Please login again.");
                else toast.error("Could not queue extraction.");
                console.error(err);
                onRefresh(); // revert to server truth
            } finally {
                setAction(file.file_id, null);
            }
        },
        [onRefresh]
    );

    const handleBulkRetry = useCallback(async () => {
        const ids = Array.from(bulkSelected);
        const results = await Promise.allSettled(
            ids.map((id) => apiClient.post(`/file/${id}/extract`))
        );
        const ok = results.filter((r) => r.status === "fulfilled").length;
        toast.success(`Queued extraction for ${ok}/${ids.length} files.`);
        clearSelection();
        onRefresh();
    }, [bulkSelected, onRefresh]);

    const handleBulkDelete = useCallback(async () => {
        const ids = Array.from(bulkSelected);
        const results = await Promise.allSettled(
            ids.map((id) => apiClient.delete(`/file/${id}`))
        );
        const ok = results.filter((r) => r.status === "fulfilled").length;
        toast.success(`Deleted ${ok}/${ids.length} files.`);
        clearSelection();
        onRefresh();
    }, [bulkSelected, onRefresh]);

    const handleRetryAllFailed = useCallback(async () => {
        const failedIds = files
            .filter((f) => (f.extraction_status ?? "done") === "failed")
            .map((f) => f.file_id);
        if (failedIds.length === 0) return;
        const results = await Promise.allSettled(
            failedIds.map((id) => apiClient.post(`/file/${id}/extract`))
        );
        const ok = results.filter((r) => r.status === "fulfilled").length;
        toast.success(`Queued extraction for ${ok}/${failedIds.length} failed files.`);
        onRefresh();
    }, [files, onRefresh]);

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
            setPreviewText(null);
            setPreviewTextTruncated(false);

            try {
                const res = await apiClient.get(`/file/${selectedFile?.file_id}/url?action=view`);
                setPreviewUrl(res.data.url);
            } catch (err) {
                console.error(err);
            } finally {
                setPreviewLoading(false);
            }
        };

        run();
    }, [drawerOpen, selectedFile]);

    // Lazy extracted-text fallback for non-image/non-pdf previews (docx, txt, etc.).
    useEffect(() => {
        const run = async () => {
            if (!drawerOpen || !selectedFile) return;
            if (drawerTab !== "preview") return;
            const ft = (selectedFile.filetype || "").toLowerCase();
            const needsTextFallback = !ft.includes("image") && !ft.includes("pdf");
            if (!needsTextFallback) return;
            if (previewText !== null || previewTextLoading) return;
            if ((selectedFile.extraction_status ?? "done") !== "done") return;

            setPreviewTextLoading(true);
            try {
                const res = await apiClient.get(`/file/${selectedFile.file_id}/text`);
                setPreviewText(typeof res.data?.text === "string" ? res.data.text : "");
                setPreviewTextTruncated(!!res.data?.truncated);
            } catch {
                setPreviewText("");
            } finally {
                setPreviewTextLoading(false);
            }
        };
        run();
    }, [drawerOpen, drawerTab, selectedFile, previewText, previewTextLoading]);

    const visibleFilters = hideTypeFilter
        ? FILTERS.filter((f) => f.value === "all" || f.value === "failed")
        : FILTERS;

    return (
        <div className="w-full space-y-4">
            {header}

            {/* Failed files banner */}
            {failedCount > 0 && filter !== "failed" && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-300/40 bg-red-500/5 px-4 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                        <IconAlertTriangle size={16} className="text-red-500" />
                        <span>
                            <strong>{failedCount}</strong> file{failedCount === 1 ? "" : "s"} failed extraction.
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setFilter("failed")}>View</Button>
                        <Button size="sm" variant="secondary" onClick={handleRetryAllFailed}>Retry all</Button>
                    </div>
                </div>
            )}

            {/* Controls bar — wraps on narrow screens; filters take their own row, controls stack below */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {visibleFilters.map((f) => {
                        const active = filter === f.value;
                        const count =
                            f.value === "all" ? files.length :
                            f.value === "failed" ? failedCount :
                            files.filter((file) => matchesFilter(file, f.value)).length;
                        return (
                            <button
                                key={f.value}
                                onClick={() => setFilter(f.value)}
                                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                                    active
                                        ? "bg-foreground text-background border-foreground"
                                        : "border-border text-muted-foreground hover:bg-muted"
                                }`}
                            >
                                {f.label}
                                {count > 0 && <span className={`ml-1.5 ${active ? "opacity-70" : "opacity-50"}`}>{count}</span>}
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[160px] sm:flex-initial">
                        <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Filter by name"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="text-sm h-8 pl-8 pr-7 rounded-md border bg-background w-full sm:w-[180px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch("")}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                aria-label="Clear"
                            >
                                <IconX size={14} />
                            </button>
                        )}
                    </div>

                    {/* Sort */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-8 gap-1.5">
                                <IconArrowsSort size={14} />
                                {SORTS.find((s) => s.value === sort)?.label}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {SORTS.map((s) => (
                                <DropdownMenuItem key={s.value} onClick={() => setSort(s.value)}>
                                    {s.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* View toggle */}
                    <div className="flex h-8 rounded-md border overflow-hidden">
                        <button
                            onClick={() => setView("grid")}
                            className={`px-2 ${view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                            aria-label="Grid view"
                            title="Grid view"
                        >
                            <IconLayoutGrid size={14} />
                        </button>
                        <button
                            onClick={() => setView("list")}
                            className={`px-2 ${view === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                            aria-label="List view"
                            title="List view"
                        >
                            <IconList size={14} />
                        </button>
                    </div>

                    {headerAction}
                </div>
            </div>

            {/* Bulk action bar */}
            {selectMode && (
                <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                        <IconCircleCheck size={16} className="text-violet-500" />
                        <span><strong>{bulkSelected.size}</strong> selected</span>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
                        <Button size="sm" variant="secondary" onClick={handleBulkRetry}>
                            <IconRefresh size={14} className="mr-1.5" /> Re-extract
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
                            <IconTrash size={14} className="mr-1.5" /> Delete
                        </Button>
                    </div>
                </div>
            )}

            {/* GRID / LIST / EMPTY / SKELETON */}
            {isLoading && files.length === 0 ? (
                <FileListSkeleton />
            ) : visibleFiles.length === 0 ? (
                files.length === 0 ? (
                    <div className="rounded-2xl border border-dashed p-12 text-center">
                        <div className="mx-auto mb-4 inline-flex items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500/20 via-violet-500/20 to-cyan-400/20 p-4 ring-1 ring-white/10">
                            <IconCloudUpload size={28} className="text-foreground/80" />
                        </div>
                        <div className="font-medium">No files yet</div>
                        <div className="text-sm text-muted-foreground mt-1">
                            Upload your first file to see it appear here instantly.
                        </div>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-dashed p-12 text-center">
                        <div className="mx-auto mb-3 inline-flex items-center justify-center rounded-full bg-muted/60 p-3">
                            <IconSearch size={20} className="text-muted-foreground" />
                        </div>
                        <div className="font-medium">
                            {search.trim()
                                ? <>No matches for &ldquo;<span className="font-semibold">{search}</span>&rdquo;</>
                                : "No files match the current filter."}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                            Try a different filter, or clear what&apos;s applied.
                        </div>
                        <div className="mt-4">
                            <Button size="sm" variant="ghost" onClick={() => { setFilter("all"); setSearch(""); }}>
                                Clear filters
                            </Button>
                        </div>
                    </div>
                )
            ) : view === "grid" ? (
                <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 [perspective:1000px]">
                    {visibleFiles.map((file) => (
                        <FileCard
                            key={file.file_id}
                            file={file}
                            busyAction={actionById[file.file_id] ?? null}
                            selected={bulkSelected.has(file.file_id)}
                            selectMode={selectMode}
                            onOpen={() => openDrawerFor(file)}
                            onView={() => handleView(file)}
                            onDownload={() => handleDownload(file)}
                            onExtract={() => handleExtract(file)}
                            onToggleSelect={() => toggleSelect(file.file_id)}
                            onDeleteRequest={() => {
                                setSelectedId(file.file_id);
                                setConfirmDeleteOpen(true);
                            }}
                        />
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border bg-background overflow-hidden">
                    {visibleFiles.map((file, i) => {
                        const status = file.extraction_status ?? "done";
                        const isStuck = status === "pending" || status === "processing";
                        const isFailed = status === "failed";
                        const isSelected = bulkSelected.has(file.file_id);
                        return (
                            <div
                                key={file.file_id}
                                onClick={() => selectMode ? toggleSelect(file.file_id) : openDrawerFor(file)}
                                className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition ${
                                    i > 0 ? "border-t" : ""
                                } ${isSelected ? "bg-violet-500/5" : ""}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleSelect(file.file_id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-4 h-4 accent-violet-500"
                                />
                                <div className="text-muted-foreground shrink-0">{fileIcon(file.filetype)}</div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium truncate">{file.filename}</div>
                                    <div className="text-xs text-muted-foreground truncate">
                                        {fileTypeLabel(file.filetype)} · {formatRelative(file.created_at)}
                                    </div>
                                </div>
                                <ExtractionBadge status={file.extraction_status} />
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            onClick={(e) => e.stopPropagation()}
                                            className="p-1.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                            aria-label="Actions"
                                        >
                                            <IconDots size={16} />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                        <DropdownMenuItem onClick={() => handleView(file)} disabled={isStuck}>
                                            <IconEye size={14} className="mr-2" /> View
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleDownload(file)}>
                                            <IconDownload size={14} className="mr-2" /> Download
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleExtract(file)} disabled={status === "processing"}>
                                            <IconRefresh size={14} className="mr-2" />
                                            {isFailed ? "Retry extraction" : "Re-run extraction"}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => { setSelectedId(file.file_id); setConfirmDeleteOpen(true); }}
                                            className="text-red-600 focus:text-red-600"
                                        >
                                            <IconTrash size={14} className="mr-2" /> Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Keyframes used by FileCard */}
            <style jsx global>{`
                @keyframes shimmer { 0% { background-position: -100% 0; } 100% { background-position: 200% 0; } }
            `}</style>

            {/* Right Drawer */}
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
                <SheetContent side="right" className="w-full sm:max-w-xl">
                    <SheetHeader>
                        <SheetTitle className="truncate">
                            {selectedFile ? (
                                <button
                                    onClick={() => { setDrawerTab("preview"); if (selectedFile) handleView(selectedFile); }}
                                    title="Open file in a new tab"
                                    className="hover:underline underline-offset-2 inline-flex items-center gap-1.5"
                                >
                                    {selectedFile.filename}
                                    <IconEye size={14} className="opacity-60" />
                                </button>
                            ) : "File"}
                        </SheetTitle>
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

                            {/* Smart actions row — clicking "Chat with this file" jumps
                                straight to the Chat tab below. */}
                            <div className="mt-4 rounded-lg border p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs text-muted-foreground">Smart actions</div>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => setDrawerTab("chat")}
                                    >
                                        <IconSparkles size={14} className="mr-1.5" />
                                        Chat with this file
                                    </Button>
                                </div>
                            </div>

                            <Tabs value={drawerTab} onValueChange={(v) => setDrawerTab(v as typeof drawerTab)} className="mt-4 mb-2">
                                <TabsList>
                                    <TabsTrigger value="preview">Preview</TabsTrigger>
                                    <TabsTrigger value="summary">Summary</TabsTrigger>
                                    <TabsTrigger value="entities">Entities</TabsTrigger>
                                    <TabsTrigger value="chat">Chat</TabsTrigger>
                                </TabsList>

                                <TabsContent value="preview" className="mt-2">
                                    <div className="rounded-lg border p-4">
                                        <div className="max-h-[70vh] overflow-auto">
                                            {previewLoading ? (
                                                <div className="text-sm text-muted-foreground">Loading preview…</div>
                                            ) : !previewUrl ? (
                                                <div className="text-sm text-muted-foreground">No preview available.</div>
                                            ) : isImage(selectedFile.filetype) ? (
                                                <Image 
                                                    width={500}
                                                    height={500}
                                                    src={previewUrl} 
                                                    alt={selectedFile.filename} 
                                                    className="block w-full rounded-md border" 
                                                />
                                            ) : isPdf(selectedFile.filetype) ? (
                                                <iframe src={previewUrl} className="w-full h-[520px] rounded-md border" title="PDF Preview" />
                                            ) : previewTextLoading ? (
                                                <div className="text-sm text-muted-foreground">Loading extracted text…</div>
                                            ) : previewText && previewText.trim().length > 0 ? (
                                                <div>
                                                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                                                        Extracted text {previewTextTruncated ? "(truncated)" : ""}
                                                    </div>
                                                    <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed bg-muted/30 p-3 rounded-md border max-h-[60vh] overflow-auto">
                                                        {previewText}
                                                    </pre>
                                                </div>
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
                                            {(() => {
                                                const status = selectedFile.extraction_status ?? 'done';
                                                if (status === 'pending' || status === 'processing') {
                                                    return (
                                                        <div className="flex items-center gap-2 text-amber-700">
                                                            <IconLoader2 size={16} className="animate-spin" />
                                                            {status === 'pending'
                                                                ? 'Queued for extraction…'
                                                                : 'Extraction in progress…'}
                                                        </div>
                                                    );
                                                }
                                                if (status === 'failed') {
                                                    return (
                                                        <div className="flex items-start gap-2 text-red-600">
                                                            <IconAlertTriangle size={16} className="mt-0.5" />
                                                            <div>
                                                                <div className="font-medium">Extraction failed</div>
                                                                {selectedFile.extraction_error ? (
                                                                    <div className="text-xs text-muted-foreground mt-1">
                                                                        {selectedFile.extraction_error}
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return selectedFile.summary?.trim()
                                                    ? selectedFile.summary
                                                    : 'No summary available yet.';
                                            })()}
                                        </div>
                                    </div>
                                </TabsContent>

                                <TabsContent value="entities" className="mt-2">
                                    <EntityPanel idx={selectedFile.index_json} />
                                </TabsContent>

                                <TabsContent value="chat" className="mt-2">
                                    <FileChat
                                        fileId={selectedFile.file_id}
                                        fileName={selectedFile.filename}
                                        ready={(selectedFile.extraction_status ?? "done") === "done"}
                                    />
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