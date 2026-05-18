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
import { IconCloudUpload, IconLock } from "@tabler/icons-react";

export default function UploadFile({
    compact = false,
    onUploaded,
}: {
    compact?: boolean;
    onUploaded?: () => void;
}) {
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [hasMounted, setHasMounted] = useState(false);
    const [isPrivate, setIsPrivate] = useState(false);

    useEffect(() => {
        setHasMounted(true);
    }, []);

    const label = hasMounted ? (uploadSuccess ? "Upload another" : "Upload") : "Upload";

    return (
        <Dialog onOpenChange={(open) => {
            if (!open) {
                if (uploadSuccess) onUploaded?.();
                setIsPrivate(false);
                setUploadSuccess(false);
            }
        }}>
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

                <label className="mt-3 flex items-start gap-2.5 rounded-md border bg-muted/30 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition">
                    <input
                        type="checkbox"
                        checked={isPrivate}
                        onChange={(e) => setIsPrivate(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-violet-600"
                    />
                    <div className="text-sm">
                        <div className="font-medium flex items-center gap-1.5">
                            <IconLock size={13} /> Keep this file private
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                            We won&apos;t send the contents to any AI. No summary, no chat, no entity extraction —
                            only the filename is indexed so you can still find it.
                        </div>
                    </div>
                </label>

                <FileUpload
                    isPrivate={isPrivate}
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
