"use client";
import { ToastContainer } from "react-toastify";
import { useTheme } from "next-themes";

export function ThemedToastContainer() {
    const { resolvedTheme } = useTheme();
    return (
        <ToastContainer
            position="bottom-right"
            autoClose={3500}
            hideProgressBar
            closeOnClick
            pauseOnHover
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            toastClassName="!rounded-xl !shadow-lg !text-sm"
        />
    );
}
