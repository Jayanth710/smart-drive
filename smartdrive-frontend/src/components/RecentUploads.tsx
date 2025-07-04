"use client"
import React from 'react';
import { FileCard } from './FileCard';
import { useFetchCollections } from '@/lib/fetchCollections';

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

const RecentUploads = ({ type = "all" }: RecentUploadsProps) => {
  // const [uploads, setUploads] = useState<UploadItem[]>([]);
  const { documentsData, imagesData, mediaData, refreshData, combinedData } = useFetchCollections()

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
      collectionDataToDisplay = combinedData;
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