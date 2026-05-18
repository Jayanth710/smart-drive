"use client";

import Link from "next/link";
import {
    IconFileText,
    IconPhoto,
    IconVideo,
    IconArrowRight,
} from "@tabler/icons-react";

type TileKind = "documents" | "images" | "media";

type StatTileProps = {
    kind: TileKind;
    title: string;
    count: number;
    href: string;
};

const THEMES: Record<TileKind, { from: string; to: string; icon: React.ReactNode }> = {
    documents: {
        from: "rgba(34, 211, 238, 0.18)",
        to: "rgba(16, 185, 129, 0.18)",
        icon: <IconFileText size={20} />,
    },
    images: {
        from: "rgba(244, 114, 182, 0.18)",
        to: "rgba(139, 92, 246, 0.18)",
        icon: <IconPhoto size={20} />,
    },
    media: {
        from: "rgba(139, 92, 246, 0.18)",
        to: "rgba(59, 130, 246, 0.18)",
        icon: <IconVideo size={20} />,
    },
};

export function StatTile({ kind, title, count, href }: StatTileProps) {
    const theme = THEMES[kind];
    return (
        <Link
            href={href}
            className="group relative rounded-xl border bg-background overflow-hidden hover:shadow-md transition-shadow"
        >
            {/* Soft themed wash that intensifies on hover */}
            <div
                aria-hidden
                className="absolute inset-0 opacity-60 group-hover:opacity-100 transition-opacity"
                style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}
            />
            <div className="relative p-4 flex items-center gap-4">
                <div className="shrink-0 rounded-lg bg-background/80 backdrop-blur p-2.5 ring-1 ring-border text-foreground/80">
                    {theme.icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {title}
                    </div>
                    <div className="text-2xl font-semibold leading-none mt-1">{count}</div>
                </div>
                <IconArrowRight
                    size={16}
                    className="text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition"
                />
            </div>
        </Link>
    );
}

export function StatTilesRow({
    documents,
    images,
    media,
}: {
    documents: number;
    images: number;
    media: number;
}) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatTile kind="documents" title="Documents" count={documents} href="/documents" />
            <StatTile kind="images" title="Images" count={images} href="/images" />
            <StatTile kind="media" title="Media" count={media} href="/media" />
        </div>
    );
}
