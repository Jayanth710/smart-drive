"use client"
import { FileCard } from '@/components/FileCard'
import RecentUploads, { UploadItem } from '@/components/RecentUploads'
import SearchBar from '@/components/Search'
import { HoverEffect } from '@/components/ui/card-hover-effect'
import { useAuth } from '@/context/AuthContext'
import React, { useState } from 'react'

const Page = () => {
    const { imagesData, refreshData } = useAuth()
    const [searchResults, setSearchResults] = useState<UploadItem[]>([]);
    
    const projects = [
        {
            title: "Images",
            description:
                imagesData?.length || 0,
            link: "/homepage/images",
        },
    ]

    const handleAction = () => {
        if (refreshData) {
            refreshData();
        }
    }

    return (
        <div className="flex flex-col flex-1 p-2 overflow-y-auto">
            <SearchBar page={"Images"} onSearchResults={setSearchResults} />

            {/* 2. Conditionally render based on searchResults */}
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
                    <HoverEffect items={projects} />
                    <RecentUploads type="images" />
                </div>
            )}
        </div>
    );
}

export default Page
