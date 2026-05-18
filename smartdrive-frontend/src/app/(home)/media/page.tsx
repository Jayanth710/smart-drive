"use client";
import { FileListWithDrawer } from "@/components/FileListWithDrawer";
import { UploadItem } from "@/components/FileListWithDrawer";
import SearchBar from "@/components/Search";
import UploadFile from "@/components/UploadFile";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useFetchCollections } from "@/lib/fetchCollections";
import { IconX } from "@tabler/icons-react";
import React, { useState } from "react";

const MediaPage = () => {
    const { mediaData, isLoading, error, refreshData } = useFetchCollections();
    const [searchResults, setSearchResults] = useState<UploadItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const { authReady, data } = useAuth();

    const handleAction = async () => {
        if (!authReady || !data) return;
        refreshData();
    };

    if (error) {
        return (
            <div className="flex justify-center items-center flex-1 p-4 text-red-500">
                <p className="text-lg">Error: Could not load media.</p>
            </div>
        );
    }

    const inSearch = searchQuery.trim().length > 0;
    const clearSearch = () => { setSearchResults([]); setSearchQuery(""); };

    return (
        <div className="flex flex-col gap-6 p-2">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Media</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Audio and video, transcribed and searchable.
                    </p>
                </div>
            </div>

            <div className="max-w-2xl w-full">
                <SearchBar
                    page="Media"
                    onSearchResults={setSearchResults}
                    onQueryChange={setSearchQuery}
                />
            </div>

            <FileListWithDrawer
                files={inSearch ? searchResults : (mediaData || [])}
                onRefresh={handleAction}
                isLoading={isLoading}
                hideTypeFilter
                header={inSearch ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-2.5">
                        <div className="text-sm">
                            <strong>{searchResults.length}</strong> result{searchResults.length === 1 ? "" : "s"} for{" "}
                            <span className="font-medium">&ldquo;{searchQuery}&rdquo;</span>
                        </div>
                        <Button size="sm" variant="ghost" onClick={clearSearch}>
                            <IconX size={14} className="mr-1.5" /> Clear
                        </Button>
                    </div>
                ) : undefined}
                headerAction={<UploadFile compact onUploaded={handleAction} />}
            />
        </div>
    );
};

export default MediaPage;
