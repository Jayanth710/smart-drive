"use client";
import { useEffect, useState } from "react";
import {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileUpload } from "@/components/ui/file-upload";
import { IconCloudUpload } from "@tabler/icons-react";

export default function UploadFile({
    compact = false,
    onUploaded,
}: {
    compact?: boolean;
    onUploaded?: () => void;
}) {
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [hasMounted, setHasMounted] = useState(false);

    useEffect(() => {
        setHasMounted(true);
    }, []);

    const label = hasMounted ? (uploadSuccess ? "Upload another" : "Upload") : "Upload";

    return (
        <Dialog onOpenChange={(open) => { if (!open && uploadSuccess) onUploaded?.(); }}>
            <DialogTrigger asChild>
                <Button size={compact ? "sm" : "default"} className="h-8 gap-1.5 bg-gradient-to-br from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white border-0">
                    <IconCloudUpload size={14} />
                    {label}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogTitle>Upload a file</DialogTitle>
                <DialogDescription>
                    Drop or pick a file. We&apos;ll extract and index it automatically — it&apos;ll appear in your list in seconds.
                </DialogDescription>

                <FileUpload
                    onChange={() => {
                        setUploadSuccess(true);
                        onUploaded?.();
                    }}
                />

                <DialogClose asChild>
                    <Button variant="outline" className="mt-4 w-full">
                        Done
                    </Button>
                </DialogClose>
            </DialogContent>
        </Dialog>
    );
}
