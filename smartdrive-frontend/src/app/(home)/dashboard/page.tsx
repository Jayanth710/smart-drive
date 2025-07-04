
"use client";
import RecentUploads, { UploadItem } from "@/components/RecentUploads";
import SearchBar from "@/components/Search";
import { HoverEffect } from "@/components/ui/card-hover-effect";
import React, { useState } from "react";
import { FileCard } from "@/components/FileCard";
import { fetchCollections } from "@/lib/fetchCollections";

const Home = () => {
    const { projects, isLoading, error, refreshData } = fetchCollections();
    const [searchResults, setSearchResults] = useState<UploadItem[]>([]);
    const handleAction = () => {
        refreshData();
    }

    if (isLoading) {
        return (
            <div className="flex justify-center items-center flex-1 p-4">
                <p className="text-lg">Loading Recent Uploads...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex justify-center items-center flex-1 p-4 text-red-500">
                <p className="text-lg">Error: Could not load recent uploads files.</p>
            </div>
        );
    }

    const allProjectsArray = Object.values(projects);

    return (
        <div className="flex flex-col flex-1 p-2 overflow-y-auto">
            <SearchBar page={"SmartDrive"} onSearchResults={setSearchResults} />

            {searchResults.length > 0 ? (
                <div className="w-full max-w-5xl mt-4">
                    <h3 className="text-lg font-semibold mb-2">Results:</h3>
                    {searchResults.map((file) => (
                        <FileCard key={file.file_id} file={file} onAction={handleAction} />
                    ))}
                </div>
            ) : (
                <div className="mt-2 flex-1">
                    <div className="text-lg font-bold">Your Files Information</div>
                    <HoverEffect items={allProjectsArray} />
                    <RecentUploads type="all" />
                </div>
            )}
        </div>
    );
};

export default Home;