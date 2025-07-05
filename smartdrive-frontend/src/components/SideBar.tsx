"use client";
import React, { ReactNode, useState } from "react";
import Image from "next/image";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import {
    IconArrowLeft,
    IconBrandTabler,
    IconSettings,
    IconUserBolt,
} from "@tabler/icons-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";


interface SideBarProps {
    children: ReactNode;
    onClick?: () => void;
}

const SideBar = ({ children }: SideBarProps) => {
    const { data, logout } = useAuth()
    const router = useRouter()
    const links = [
        {
            label: "Dashboard",
            href: "/dashboard",
            icon: (
                <IconBrandTabler className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />
            ),
        },
        {
            label: "Profile",
            href: "/profile",
            icon: (
                <IconUserBolt className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />
            ),
        },
        {
            label: "Settings",
            href: "/settings",
            icon: (
                <IconSettings className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />
            ),
        },
        {
            label: "Logout",
            href: "/",
            icon: (
                <IconArrowLeft className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />
            ),
            onClick: () => {
                logout()
                toast.success("User Logged Out")
                router.push("/")
            }
        },
    ];
    const [open, setOpen] = useState(false);
    return (
        <div
            className={cn(
                "mx-auto flex w-full max-w-full flex-1 flex-col overflow-hidden rounded-md border border-neutral-200 bg-gray-100 md:flex-row dark:border-neutral-700 dark:bg-neutral-800",
                "h-screen",
            )}
        >
            <Sidebar open={open} setOpen={setOpen}>
                <SidebarBody className="justify-between gap-10">
                    <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
                        {open ? <Logo /> : <LogoIcon />}
                        <div className="mt-8 flex flex-col gap-2">
                            {links.map((link, idx) => (
                                <SidebarLink key={idx} link={link} />
                            ))}
                        </div>
                    </div>
                    <div>
                        <SidebarLink
                            link={{
                                label: `${data?.firstName} ${data?.lastName}`,
                                href: "/dashboard",
                                icon: (
                                    <Image
                                        src="/Avatar.svg"
                                        className="h-7 w-7 shrink-0 rounded-full"
                                        width={50}
                                        height={50}
                                        alt="Avatar"
                                    />
                                ),
                            }}
                        />
                    </div>
                </SidebarBody>
            </Sidebar>
            {/* <Dashboard /> */}
            {children}
        </div>
    );
}
export const Logo = () => {
    return (
        <a
            href="/dashboard"
            className="relative z-20 flex items-center space-x-2 py-1 text-xl font-normal text-black"
        >
            <Image
                src="/SmartDrive.svg"
                alt="Acet Labs Logo"
                width={24}
                height={24}
                className="shrink-0"
            />
            <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-medium whitespace-pre text-black dark:text-white hover:font-extrabold"
            >
                Smart Drive
            </motion.span>
        </a>
    );
};
export const LogoIcon = () => {
    return (
        <a
            href="/dashboard"
            className="relative z-20 flex items-center space-x-2 py-1 text-sm font-normal text-black"
        >
            <Image
                src="/SmartDrive.svg"
                alt="Acet Labs Logo"
                width={24}
                height={24}
                className="shrink-0"
            />
        </a>
    );
};


export default SideBar;