"use client";
import { UploadItem } from "@/components/FileListWithDrawer";
import SearchBar from "@/components/Search";
import React, { useState } from "react";
import { useFetchCollections } from "@/lib/fetchCollections";
import { FileListWithDrawer } from "@/components/FileListWithDrawer";
import { StatTilesRow } from "@/components/StatTile";
import UploadFile from "@/components/UploadFile";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";

const Home = () => {
    const { projects, error, refreshData, isLoading, combinedData } = useFetchCollections();
    const [searchResults, setSearchResults] = useState<UploadItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");

    const handleAction = async () => {
        refreshData();
    };

    if (error) {
        return (
            <div className="flex justify-center items-center flex-1 p-4 text-red-500">
                <p className="text-lg">Error: Could not load recent uploads.</p>
            </div>
        );
    }

    const inSearch = searchQuery.trim().length > 0;
    const clearSearch = () => {
        setSearchResults([]);
        setSearchQuery("");
    };

    return (
        <div className="flex flex-col gap-6 p-2">
            {/* Page header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Your AI-indexed files at a glance.
                    </p>
                </div>
            </div>

            {/* Search */}
            <div className="max-w-2xl w-full">
                <SearchBar
                    page="SmartDrive"
                    onSearchResults={setSearchResults}
                    onQueryChange={setSearchQuery}
                />
            </div>

            {inSearch ? (
                <FileListWithDrawer
                    files={searchResults}
                    onRefresh={handleAction}
                    isLoading={false}
                    header={
                        <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-2.5">
                            <div className="text-sm">
                                <strong>{searchResults.length}</strong> result{searchResults.length === 1 ? "" : "s"} for{" "}
                                <span className="font-medium">&ldquo;{searchQuery}&rdquo;</span>
                            </div>
                            <Button size="sm" variant="ghost" onClick={clearSearch}>
                                <IconX size={14} className="mr-1.5" /> Clear search
                            </Button>
                        </div>
                    }
                />
            ) : (
                <>
                    <StatTilesRow
                        documents={projects.documents.description}
                        images={projects.images.description}
                        media={projects.media.description}
                    />

                    <FileListWithDrawer
                        files={combinedData || []}
                        onRefresh={handleAction}
                        isLoading={isLoading}
                        header={
                            <div className="flex items-end justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold">Your files</h2>
                                    <p className="text-xs text-muted-foreground">
                                        Filter, search, and re-extract any file.
                                    </p>
                                </div>
                            </div>
                        }
                        headerAction={<UploadFile compact onUploaded={handleAction} />}
                    />
                </>
            )}
        </div>
    );
};

export default Home;
