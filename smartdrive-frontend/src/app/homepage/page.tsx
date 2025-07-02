// // components/SearchBar.tsx
// "use client";
// import RecentUploads from "@/components/RecentUploads";
// import SearchBar from "@/components/Search";
// import SideBar from "@/components/SideBar";
// import { HoverEffect } from "@/components/ui/card-hover-effect";
// import { useAuth } from "@/context/AuthContext";
// import React from "react";

// const page = () => {
//     const { documentsData, imagesData, mediaData } = useAuth()
//   const projects = [
//     {
//       title: "Documents",
//       description:
//         documentsData?.length || 0,
//       link: "/homepage/documents",
//     },
//     {
//       title: "Images",
//       description:
//         imagesData?.length || 0,
//       link: "/homepage/images",
//     },
//     {
//       title: "Media",
//       description:
//         mediaData?.length || 0,
//       link: "/homepage/media",
//     },
//   ];
//     return (
//         // <div className="flex h-screen">
//         //     <SideBar>
//         //         <div className="flex flex-col flex-1 p-2 overflow-y-auto">
//         //             <SearchBar />
//         //             <div className="mt-2 flex-1">
//         //                 <FilesInfo />
//         //                 <RecentUploads />
//         //             </div>
//         //         </div>
//         //         {/* <SearchBar />
//         //             <FilesInfo /> */}
//         //     </SideBar>
//         // </div>
//         // <div className="flex h-screen">
//         //     <SideBar>
//         //         <div className="flex flex-col flex-1 p-2 overflow-y-auto">
//         //             <SearchBar />
//         //             <div className="mt-2 flex-1">
//         //                 <FilesInfo />
//         //                 <RecentUploads />
//         //             </div>
//         //         </div>
//         //     </SideBar>
//         // </div>
//         <div className="flex flex-col flex-1 p-2 overflow-y-auto">
//             <SearchBar page={"SmartDrive"} />
//             <div className="mt-2 flex-1">
//                 <div className="text-lg font-bold">Your Files Information</div>
//                 <HoverEffect items={projects} />
//                 <RecentUploads type="all"/>
//             </div>
//         </div>
//     );
// };

// export default page;
// Your page component file

"use client";
import RecentUploads from "@/components/RecentUploads";
import SearchBar from "@/components/Search"; // Assuming this is the correct path
import { HoverEffect } from "@/components/ui/card-hover-effect";
import { useAuth } from "@/context/AuthContext";
import React, { useState } from "react"; // Import useState
import { FileCard } from "@/components/FileCard"; // Import FileCard

const Page = () => {
    const { documentsData, imagesData, mediaData, refreshData } = useAuth();
    // 1. Manage results state here
    const [searchResults, setSearchResults] = useState<any[]>([]);

    const projects = [
        {
            title: "Documents",
            description:
                documentsData?.length || 0,
            link: "/homepage/documents",
        },
        {
            title: "Images",
            description:
                imagesData?.length || 0,
            link: "/homepage/images",
        },
        {
            title: "Media",
            description:
                mediaData?.length || 0,
            link: "/homepage/media",
        },
    ];
    const handleAction = () => {
        if (refreshData) {
            refreshData();
        }
    }

        return (
            <div className="flex flex-col flex-1 p-2 overflow-y-auto">
                <SearchBar page={"SmartDrive"} onSearchResults={setSearchResults} />

                {/* 2. Conditionally render based on searchResults */}
                {searchResults.length > 0 ? (
                    <div className="w-full max-w-5xl mt-4">
                        <h3 className="text-lg font-semibold mb-2">Results:</h3>
                        {searchResults.map((file) => (
                            <FileCard key={file.fileId} file={file} onAction={handleAction} />
                        ))}
                    </div>
                ) : (
                    <div className="mt-2 flex-1">
                        <div className="text-lg font-bold">Your Files Information</div>
                        <HoverEffect items={projects} />
                        <RecentUploads type="all" />
                    </div>
                )}
            </div>
        );
    };

export default Page;