// import { useState, useEffect, useCallback } from 'react';
// import apiClient from '@/lib/api';
// import { useAuth } from '@/context/AuthContext';
// import { useRouter } from 'next/navigation';

// type DataItem = {
//     filename: string;
//     filetype: string;
//     created_at: string;
//     summary: string;
//     file_id: string;
// };

// const fetchDataItems = async (collection: string): Promise<DataItem[]> => {
//     try {
//         const response = await apiClient.get('/upload', { params: { queryCollection: collection } });
//         return response.data.data || [];
//     } catch (error) {
//         console.error(`Failed to fetch collection "${collection}":`, error);
//         // Return an empty array on error to prevent crashes
//         return [];
//     }
// };

// export const useFetchCollections = () => {
//     const [combinedData, setCombinedData] = useState<DataItem[] | null>(null);
//     const [documentsData, setDocumentsData] = useState<DataItem[] | null>(null);
//     const [imagesData, setImagesData] = useState<DataItem[] | null>(null);
//     const [mediaData, setMediaData] = useState<DataItem[] | null>(null);
//     const { authReady } = useAuth();
//     const router = useRouter()
//     const [isLoading, setIsLoading] = useState(true);
//     const [error, setError] = useState<Error | null>(null);


//     const fetchAll = useCallback(async () => {
//         setIsLoading(true);
//         setError(null);
//         try {

//             const [combinedData, docs, images, media] = await Promise.all([
//                 fetchDataItems("all"),
//                 fetchDataItems("Documents"),
//                 fetchDataItems("Images"),
//                 fetchDataItems("Media"),
//             ]);

//             setCombinedData(combinedData)
//             setDocumentsData(docs);
//             setImagesData(images);
//             setMediaData(media);

//         } catch (err) {
//             setError(err as Error);
//         } finally {
//             setIsLoading(false);
//         }
//     }, [router]);

//     useEffect(() => {
//         if (!authReady) return;
//         fetchAll();
//     }, [fetchAll, authReady]);

//     const projects = {
//         documents: {
//             title: "Documents",
//             description: documentsData?.length || 0,
//             link: "/documents",
//         },
//         images: {
//             title: "Images",
//             description: imagesData?.length || 0,
//             link: "/images",
//         },
//         media: {
//             title: "Media",
//             description: mediaData?.length || 0,
//             link: "/media",
//         },
//     };
//     return {
//         projects,
//         isLoading,
//         error,
//         refreshData: fetchAll,
//         combinedData,
//         documentsData,
//         imagesData,
//         mediaData,
//     };
// };

import { useState, useEffect, useCallback } from 'react';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

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
        return [];
    }
};

export const useFetchCollections = () => {
    const [combinedData, setCombinedData] = useState<DataItem[] | null>(null);
    const [documentsData, setDocumentsData] = useState<DataItem[] | null>(null);
    const [imagesData, setImagesData] = useState<DataItem[] | null>(null);
    const [mediaData, setMediaData] = useState<DataItem[] | null>(null);
    
    // 1. Pull 'data' (the user object) from the context
    const { authReady, data } = useAuth(); 
    
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // 2. Remove router from dependencies, add 'data'
    const fetchAll = useCallback(async () => {
        // DOUBLE SECURITY: If manual refresh is clicked while logged out, do nothing
        if (!data) return; 

        setIsLoading(true);
        setError(null);
        try {
            const [combined, docs, images, media] = await Promise.all([
                fetchDataItems("all"),
                fetchDataItems("Documents"),
                fetchDataItems("Images"),
                fetchDataItems("Media"),
            ]);

            setCombinedData(combined);
            setDocumentsData(docs);
            setImagesData(images);
            setMediaData(media);

        } catch (err) {
            setError(err as Error);
        } finally {
            setIsLoading(false);
        }
    }, [data]); // Hook relies on 'data' now

    useEffect(() => {
        // 3. THE FRONT DOOR CHECK
        // Only fetch if auth has finished checking AND the user actually exists
        if (authReady && data) {
            fetchAll();
        } else if (authReady && !data) {
            // If they are explicitly logged out, stop the loading spinner
            setIsLoading(false);
        }
    }, [fetchAll, authReady, data]);

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