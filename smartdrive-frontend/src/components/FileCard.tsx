import {
    IconChevronDown, IconChevronUp, IconEye,
    IconDownload,
    IconTrash
} from "@tabler/icons-react";
import { useState } from "react";
import { UploadItem } from "./RecentUploads";
import apiClient from "@/lib/api";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "./ui/dialog";
import { toast } from "react-toastify";


interface FileCardProps {
    file: UploadItem;
    onAction: () => void;
}

export const FileCard = ({ file, onAction }: FileCardProps) => {
    const [showSummary, setShowSummary] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);


    const handleView = async () => {
        setIsProcessing(true);
        setError('');
        try {
            const response = await apiClient.get(`/file/${file.file_id}/url?action=view`);
            window.open(response.data.url, '_blank');
        } catch (err) {
            setError('Could not get viewable link.');
            toast.error(error)
            console.error(err);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDownload = async () => {
        setIsProcessing(true);
        setError('');
        try {
            const response = await apiClient.get(`/file/${file.file_id}/url?action=download`);
            window.location.href = response.data.url;
        } catch (err) {
            setError('Could not get download link.');
            toast.error(error)
            console.error(err);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDelete = async () => {
        setIsProcessing(true);
        setError('');
        try {
            await apiClient.delete(`/file/${file.file_id}`);
            onAction();
            setConfirmOpen(false);
        } catch (err) {
            setError('Could not delete the file.');
            console.error(err);
            toast.error(error)
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="border rounded-xl shadow p-4 mb-4 bg-white dark:bg-gray-900 transition-all duration-300 hover:cursor-pointer hover:shadow-xl">
            <div className="flex justify-between items-start gap-2">
                {/* File Info on the left */}
                <div className="flex-grow min-w-0"  onClick={()=>setShowSummary(!showSummary)}>
                    <h3 className="text-lg font-semibold truncate" title={file.filename}>{file.filename}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{file.filetype}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(file.created_at).toLocaleString()}
                    </p>
                </div>

                {/* --- Step 5: Add the Action Icons --- */}
                <div className="flex items-center flex-shrink-0">
                    <button onClick={handleView} disabled={isProcessing} className="p-2 text-gray-500 hover:text-blue-500 disabled:opacity-50" aria-label="View File" title="View File">
                        <IconEye size={20} />
                    </button>
                    <button onClick={handleDownload} disabled={isProcessing} className="p-2 text-gray-500 hover:text-green-500 disabled:opacity-50" aria-label="Download File" title="Download File">
                        <IconDownload size={20} />
                    </button>
                    {/*  */}
                    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                        <DialogTrigger asChild>
                            <button disabled={isProcessing} className="p-2 text-gray-500 hover:text-red-500 disabled:opacity-50" aria-label="Delete File" title="Delete File">
                                <IconTrash size={20} />
                            </button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogTitle>Delete File</DialogTitle>
                            <DialogDescription>
                                Are you sure you want to delete <strong>{file.filename}</strong>? This action cannot be undone.
                            </DialogDescription>
                            {error && <p className="text-xs text-red-500">{error}</p>}
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isProcessing}>
                                    Cancel
                                </Button>
                                <Button variant="destructive" onClick={handleDelete} disabled={isProcessing}>
                                    {isProcessing ? "Deleting..." : "Delete"}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                    <button onClick={() => setShowSummary(!showSummary)} className="p-2 text-gray-500 hover:text-white" aria-label="Toggle Summary">
                        {showSummary ? <IconChevronUp size={20} /> : <IconChevronDown size={20} />}
                    </button>
                </div>
            </div>

            {/* Summary Section (collapsible) */}
            {showSummary && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="font-semibold text-sm mb-2">Summary</h4>
                    <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-line">
                        {file.summary}
                    </p>
                </div>
            )}

            {/* Error Message Display */}
            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
    );
};