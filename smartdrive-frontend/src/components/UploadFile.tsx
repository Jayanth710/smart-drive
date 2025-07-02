// "use client"
// import { Button } from "@/components/ui/button";
// import { FileUpload } from "@/components/ui/file-upload";
// import {
//     Dialog,
//     DialogTrigger,
//     DialogContent,
//     DialogClose,
// } from "@/components/ui/dialog";
// import apiClient from "@/lib/api";
// import axios from "axios";
// import { useState } from "react";

// const UploadFile = () => {
//     const [uploadSuccess, setUploadSuccess] = useState(false)

//     return (
//         <div className="p-4">
//             <Dialog>
//                 <DialogTrigger asChild>
//                     <Button>{uploadSuccess ? "Upload Another" : "Upload File"}</Button>
//                 </DialogTrigger>
//                 <DialogContent className="max-w-2xl">
//                     <FileUpload
//                         onChange={() => {
//                             setUploadSuccess(true);
//                         }}
//                     />
//                     <DialogClose asChild>
//                         <Button variant="outline" className="mt-4 w-full">
//                             Close
//                         </Button>
//                     </DialogClose>
//                 </DialogContent>
//             </Dialog>
//         </div>
//     )
// }

// export default UploadFile;
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

                    <FileUpload
                        onChange={() => {
                            setUploadSuccess(true);
                            window.location.reload();
                        }}
                    />
                    <DialogClose asChild>
                        <Button variant="outline" className="mt-4 w-full">
                            Close
                        </Button>
                    </DialogClose>
                </DialogContent>
            </Dialog>
        </div>
    );
}
