import { useState, useEffect, useCallback } from 'react';
import apiClient from '@/lib/api';

type DataItem = {
    filename: string;
    filetype: string;
    created_at: string;
    summary: string;
    file_id: string;
};

const fetchDataItems = async (collection: string): Promise<DataItem[]> => {
    try {
        const response = await apiClient.get('/upload', { params: { queryCollection: collection } });
        return response.data.data || [];
    } catch (error) {
        console.error(`Failed to fetch collection "${collection}":`, error);
        // Return an empty array on error to prevent crashes
        return [];
    }
};

export const useFetchCollections = () => {
    const [combinedData, setCombinedData] = useState<DataItem[] | null>(null);
    const [documentsData, setDocumentsData] = useState<DataItem[] | null>(null);
    const [imagesData, setImagesData] = useState<DataItem[] | null>(null);
    const [mediaData, setMediaData] = useState<DataItem[] | null>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchAll = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [combinedData, docs, images, media] = await Promise.all([
                fetchDataItems("all"),
                fetchDataItems("Documents"),
                fetchDataItems("Images"),
                fetchDataItems("Media"),
            ]);

            setCombinedData(combinedData)
            setDocumentsData(docs);
            setImagesData(images);
            setMediaData(media);

        } catch (err) {
            setError(err as Error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const projects = {
        documents: {
            title: "Documents",
            description: documentsData?.length || 0,
            link: "/documents",
        },
        images: {
            title: "Images",
            description: imagesData?.length || 0,
            link: "/images",
        },
        media: {
            title: "Media",
            description: mediaData?.length || 0,
            link: "/media",
        },
    };
    return {
        projects,
        isLoading,
        error,
        refreshData: fetchAll,
        combinedData,
        documentsData,
        imagesData,
        mediaData,
    };
};