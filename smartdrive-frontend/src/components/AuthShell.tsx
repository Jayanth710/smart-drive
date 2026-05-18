"use client";
import Image from "next/image";
import Link from "next/link";
import React from "react";
import { IconSparkles, IconSearch, IconBolt } from "@tabler/icons-react";

/**
 * Minimal two-column auth layout. Left side: muted brand panel with value-prop.
 * Right side: form. Designed to feel quiet in both light and dark modes.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground">
            {/* Brand panel — quiet, muted, dark-mode friendly */}
            <div className="relative hidden lg:flex flex-col justify-between p-12 border-r bg-muted/30">
                <Link href="/" className="flex items-center gap-2 w-fit">
                    <Image src="/SmartDrive.svg" alt="SmartDrive" width={28} height={28} />
                    <span className="font-semibold">SmartDrive</span>
                </Link>

                <div className="space-y-5 max-w-md">
                    <h1 className="text-3xl font-semibold leading-tight tracking-tight">
                        Your files, finally understood.
                    </h1>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                        SmartDrive extracts, summarises, and semantically indexes everything you upload —
                        so you stop hunting through folders and start asking real questions.
                    </p>
                    <div className="space-y-2.5 pt-1">
                        <Feature icon={<IconSparkles size={14} />} text="AI summaries the moment a file lands" />
                        <Feature icon={<IconSearch size={14} />} text="Semantic search across documents, audio, and images" />
                        <Feature icon={<IconBolt size={14} />} text="Re-extract anything in one click" />
                    </div>
                </div>

                <div className="text-xs text-muted-foreground">
                    © {new Date().getFullYear()} SmartDrive
                </div>
            </div>

            {/* Form panel */}
            <div className="flex items-center justify-center p-6 sm:p-10">
                <div className="w-full max-w-md">
                    {/* Mobile brand */}
                    <Link href="/" className="flex lg:hidden items-center gap-2 mb-8">
                        <Image src="/SmartDrive.svg" alt="SmartDrive" width={28} height={28} />
                        <span className="font-semibold">SmartDrive</span>
                    </Link>
                    {children}
                </div>
            </div>
        </div>
    );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <div className="flex items-center gap-2.5 text-sm text-foreground/80">
            <span className="rounded-full bg-muted p-1 text-muted-foreground">{icon}</span>
            {text}
        </div>
    );
}
