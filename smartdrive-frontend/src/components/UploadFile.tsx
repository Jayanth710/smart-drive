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

export default function UploadFile() {
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [hasMounted, setHasMounted] = useState(false);

    useEffect(() => {
        setHasMounted(true);
    }, []);

    return (
        <div className="p-4">
            <Dialog>
                <DialogTrigger asChild>
                    <Button>
                        {hasMounted
                            ? uploadSuccess
                                ? "Upload Another"
                                : "Upload File"
                            : "Upload File"}
                    </Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogTitle className="sr-only">Upload File</DialogTitle>
                    <DialogDescription className="sr-only">
                        Upload your file by selecting or dragging here
                    </DialogDescription>
                    <div className="text-xs text-muted-foreground">
                        <span className="font-bold">Note:</span> It may take a few seconds for the uploaded file to appear while we extract its metadata.
                    </div>

                    <FileUpload
                        onChange={() => {
                            setUploadSuccess(true);
                            // window.location.reload();
                        }}
                    />
                    <DialogClose asChild>
                        <Button variant="outline" className="mt-4 w-full" onClick={() => window.location.reload()}>
                            Close
                        </Button>
                    </DialogClose>
                </DialogContent>
            </Dialog>
        </div>
    );
}
