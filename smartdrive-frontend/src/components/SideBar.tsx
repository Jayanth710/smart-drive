"use client";
import React, { ReactNode, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar, SidebarBody } from "@/components/ui/sidebar";
import {
    IconLogout,
    IconLayoutDashboard,
    IconFileText,
    IconPhoto,
    IconVideo,
    IconSettings,
    IconUser,
} from "@tabler/icons-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { toast } from "react-toastify";
import { ModeToggle } from "@/components/ModeToggle";

function getInitials(first?: string, last?: string, email?: string): string {
    const f = first?.trim()?.[0];
    const l = last?.trim()?.[0];
    if (f || l) return `${f ?? ""}${l ?? ""}`.toUpperCase();
    return email?.trim()?.[0]?.toUpperCase() ?? "?";
}


type NavItem = {
    label: string;
    href: string;
    icon: React.ReactNode;
    onClick?: () => void;
};

interface SideBarProps {
    children: ReactNode;
}

const SideBar = ({ children }: SideBarProps) => {
    const { data, logout } = useAuth();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    const primaryLinks: NavItem[] = [
        { label: "Dashboard", href: "/dashboard", icon: <IconLayoutDashboard className="h-5 w-5 shrink-0" /> },
        { label: "Documents", href: "/documents", icon: <IconFileText className="h-5 w-5 shrink-0" /> },
        { label: "Images", href: "/images", icon: <IconPhoto className="h-5 w-5 shrink-0" /> },
        { label: "Media", href: "/media", icon: <IconVideo className="h-5 w-5 shrink-0" /> },
    ];

    const utilityLinks: NavItem[] = [
        { label: "Profile", href: "/profile", icon: <IconUser className="h-5 w-5 shrink-0" /> },
        { label: "Settings", href: "/settings", icon: <IconSettings className="h-5 w-5 shrink-0" /> },
        {
            label: "Logout",
            href: "#",
            icon: <IconLogout className="h-5 w-5 shrink-0" />,
            onClick: async () => {
                await logout();
                toast.success("User Logged Out");
            },
        },
    ];

    return (
        <div className={cn(
            "mx-auto flex w-full max-w-full flex-1 flex-col md:flex-row h-screen overflow-hidden bg-background text-foreground"
        )}>
            <Sidebar open={open} setOpen={setOpen}>
                <SidebarBody className="flex flex-col h-full overflow-y-auto overflow-x-hidden">
                    <div className={cn("shrink-0 flex", open ? "px-1 justify-start" : "justify-center")}>
                        {open ? <Logo /> : <LogoIcon />}
                    </div>

                    <nav className="mt-6 flex flex-col gap-0.5">
                        {primaryLinks.map((link) => (
                            <NavLink
                                key={link.href}
                                link={link}
                                active={pathname === link.href || pathname?.startsWith(link.href + "/") || false}
                                open={open}
                            />
                        ))}
                    </nav>

                    <div className="mt-auto flex flex-col gap-0.5 pt-3 border-t border-border/60">
                        {utilityLinks.map((link) => (
                            <NavLink
                                key={link.label}
                                link={link}
                                active={pathname === link.href}
                                open={open}
                            />
                        ))}
                        <div className={cn("flex", open ? "px-2.5" : "justify-center")}>
                            <ModeToggle compact />
                        </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-border/60">
                        <Link
                            href="/profile"
                            className={cn(
                                "flex items-center rounded-lg p-1.5 hover:bg-muted/60 transition",
                                open ? "gap-3 justify-start" : "justify-center"
                            )}
                        >
                            <div className="h-8 w-8 shrink-0 rounded-full bg-muted text-foreground/80 flex items-center justify-center text-xs font-semibold">
                                {getInitials(data?.firstName, data?.lastName, data?.email)}
                            </div>
                            <motion.div
                                animate={{ opacity: open ? 1 : 0, width: open ? "auto" : 0 }}
                                className="min-w-0 overflow-hidden"
                            >
                                <div className="text-sm font-medium text-foreground truncate">
                                    {data?.firstName || data?.lastName
                                        ? `${data?.firstName ?? ""} ${data?.lastName ?? ""}`.trim()
                                        : "Account"}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                    {data?.email}
                                </div>
                            </motion.div>
                        </Link>
                    </div>
                </SidebarBody>
            </Sidebar>

            {children}
        </div>
    );
};

function NavLink({ link, active, open }: { link: NavItem; active: boolean; open: boolean }) {
    const className = cn(
        "relative flex items-center rounded-lg py-2 text-sm transition",
        open ? "gap-3 px-2.5 justify-start" : "justify-center px-0",
        active
            ? "bg-muted text-foreground font-medium"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    );

    const inner = (
        <>
            {active && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-gradient-to-b from-violet-500 to-fuchsia-500" />
            )}
            {link.icon}
            <motion.span
                animate={{ opacity: open ? 1 : 0, width: open ? "auto" : 0 }}
                className="whitespace-nowrap overflow-hidden"
            >
                {link.label}
            </motion.span>
        </>
    );

    if (link.onClick) {
        return (
            <button type="button" onClick={link.onClick} className={cn(className, "text-left w-full")}>
                {inner}
            </button>
        );
    }
    return (
        <Link href={link.href} className={className}>
            {inner}
        </Link>
    );
}

export const Logo = () => (
    <Link href="/dashboard" className="relative z-20 flex items-center gap-2 py-1">
        <Image src="/SmartDrive.svg" alt="SmartDrive" width={28} height={28} className="shrink-0" />
        <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-semibold whitespace-pre bg-gradient-to-r from-violet-600 to-fuchsia-500 bg-clip-text text-transparent"
        >
            SmartDrive
        </motion.span>
    </Link>
);

export const LogoIcon = () => (
    <Link href="/dashboard" className="relative z-20 flex items-center py-1">
        <Image src="/SmartDrive.svg" alt="SmartDrive" width={28} height={28} className="shrink-0" />
    </Link>
);

export default SideBar;
