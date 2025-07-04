// "use client"
// import { FileCard } from '@/components/FileCard'
// import RecentUploads, { UploadItem } from '@/components/RecentUploads'
// import SearchBar from '@/components/Search'
// import { HoverEffect } from '@/components/ui/card-hover-effect'
// import { fetchCollections } from '@/lib/fetchCollections'
// import React, { useState } from 'react'

// const MediaPage = () => {
//     const { projects, refreshData } = fetchCollections()
//     const [searchResults, setSearchResults] = useState<UploadItem[]>([]);

//     const handleAction = () => {
//         refreshData()
//     }

//     const media = [projects.media]

//     return (
//         <div className="flex flex-col flex-1 p-2 overflow-y-auto">
//             <SearchBar page={media[0].title} onSearchResults={setSearchResults} />

//             {searchResults.length > 0 ? (
//                 <div className="w-full max-w-5xl mt-4">
//                     <h3 className="text-lg font-semibold mb-2">Results:</h3>
//                     {searchResults.map((file) => (
//                         <FileCard key={file.file_id} file={file} onAction={handleAction} />
//                     ))}
//                 </div>
//             ) : (
//                 <div className="mt-2 flex-1">
//                     <div className="text-lg font-bold">Your Files Information</div>
//                     <HoverEffect items={media} />
//                     <RecentUploads type="media" />
//                 </div>
//             )}
//         </div>
//     );
// }

// export default MediaPage;
"use client"
import { FileCard } from '@/components/FileCard'
import RecentUploads, { UploadItem } from '@/components/RecentUploads'
import SearchBar from '@/components/Search'
import { HoverEffect } from '@/components/ui/card-hover-effect'
import { fetchCollections } from '@/lib/fetchCollections' 
import React, { useState } from 'react'

const MediaPage = () => {

    const { projects, isLoading, error, refreshData } = fetchCollections();
    const [searchResults, setSearchResults] = useState<UploadItem[]>([]);

    const handleAction = () => {
        refreshData();
    }

    if (isLoading) {
        return (
            <div className="flex justify-center items-center flex-1 p-4">
                <p className="text-lg">Loading Media...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex justify-center items-center flex-1 p-4 text-red-500">
                <p className="text-lg">Error: Could not load media files.</p>
            </div>
        );
    }

    const mediaInfo = projects.media;

    return (
        <div className="flex flex-col flex-1 p-2 overflow-y-auto">
            <SearchBar page={mediaInfo.title} onSearchResults={setSearchResults} />

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
                    <HoverEffect items={[mediaInfo]} />
                    <RecentUploads type="media" />
                </div>
            )}
        </div>
    );
}

export default MediaPage;
