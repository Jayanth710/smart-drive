// "use client"
// import apiClient from '@/lib/api';
// import React, { useEffect } from 'react'

// const RecentUploads = () => {
//     useEffect(() => {
//         const fetchRecentUploads = async () => {
//             try {
//                 // Use our authenticated API client to make the request
//                 const response = await apiClient.get('/upload');
//                 console.log(response.data)
//                 console.log("Fetch sucess")
//             } catch (error) {
//                 console.error("Failed to fetch recent uploads:", error);
//             }
//         }
//         fetchRecentUploads()
//     },[])
//     return (
//         <div className='max-w-5xl mx-2 px-2'>
//             Your Recent Uploads
//         </div>
//     )
// }

// export default RecentUploads
"use client"
import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { FileCard } from './FileCard';

export type UploadItem = {
    filename: string;
    filetype: string;
    created_at: string;
    summary: string;
    file_id: string
};

type RecentUploadsProps = {
    type?: "all" | "documents" | "images" | "media";
  };
  
const RecentUploads = ({type = "all"}: RecentUploadsProps) => {
    // const [uploads, setUploads] = useState<UploadItem[]>([]);
    const { collectionData, documentsData, imagesData, mediaData, refreshData } = useAuth()

    let collectionDataToDisplay: UploadItem[] | null;

    switch (type) {
        case "documents":
          collectionDataToDisplay = documentsData;
          break;
        case "images":
          collectionDataToDisplay = imagesData;
          break;
        case "media":
          collectionDataToDisplay = mediaData;
          break;
        case "all":
        default:
          collectionDataToDisplay = collectionData;
          break;
      }

      const handleAction = () => {
        if (refreshData) {
            refreshData();
        }
    };

    return (
        <div className="max-w-5xl mx-2 px-2">
            <h2 className="text-lg font-bold mb-4">Your Recent Uploads</h2>
            {collectionDataToDisplay?.length === 0 ? (
                <p className="text-gray-500">No uploads yet.</p>
            ) : (
                collectionDataToDisplay?.map((file) => <FileCard key={file.file_id} file={file} onAction={handleAction} />)
            )}
        </div>
    );
};

export default RecentUploads;