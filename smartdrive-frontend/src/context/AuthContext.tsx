// "use client"
// import apiClient from '@/lib/api';
// import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';

// interface UserData {
//   id: string;
//   email: string;
//   firstName: string;
//   lastName: string;
//   phone?: string;
// }

// interface AuthState {
//   token: string | null;
//   login: (token: string) => void;
//   logout: () => void;
//   data: UserData | null;
//   user: () => void;
//   collectionData: DataItem[] | null;
//   documentsData: DataItem[] | null;
//   imagesData: DataItem[] | null;
//   mediaData: DataItem[] | null;
//   refreshData: () => void;
// }

// type DataItem = {
//   filename: string;
//   filetype: string;
//   created_at: string;
//   summary: string;
//   file_id: string
// };

// const AuthContext = createContext<AuthState | undefined>(undefined);

// export const AuthProvider = ({ children }: { children: ReactNode }) => {
//   const [token, setToken] = useState<string | null>(null);
//   const [data, setData] = useState<UserData | null>(null);
//   const [collectionData, setCollectionData] = useState<DataItem[] | null>(null);
//   const [documentsData, setDocumentsData] = useState<DataItem[] | null>(null);
//   const [imagesData, setImagesData] = useState<DataItem[] | null>(null);
//   const [mediaData, setMediaData] = useState<DataItem[] | null>(null);

//   const fetchDataItems = async (collection: string) => {
//     try {
//       const response = await apiClient.get('/upload', { params: { queryCollection: collection } });
//       const apiData = response.data.data || [];

//       const items = apiData.map((item: DataItem) => ({
//         filename: item.filename,
//         filetype: item.filetype,
//         created_at: item.created_at,
//         summary: item.summary,
//         file_id: item.file_id
//       }));

//       return items
//     }
//     catch (error) {
//       console.error("Failed to fetch recent uploads:", error);
//     }
//   }

//   const fetchUploads = async () => {
//     try {
//       const dataItems = await fetchDataItems("all")
//       setCollectionData(dataItems)

//       const documentItems = await fetchDataItems("Documents")
//       setDocumentsData(documentItems)

//       const imagesItems = await fetchDataItems("Images")
//       setImagesData(imagesItems)

//       const mediaItems = await fetchDataItems("Media")
//       setMediaData(mediaItems)
//     }
//     catch (error) {
//       console.error("Failed to fetch recent uploads:", error);
//     }
//   }

//   const refreshData = useCallback(async () => {
//     console.log("Refreshing all user data...");
//     await fetchUploads()
//   }, []);

//   useEffect(() => {
//     const storedToken = localStorage.getItem('accessToken');
//     if (storedToken) {
//       setToken(storedToken);
//       user()
//       refreshData()
//     }
//   }, [refreshData]);



//   const login = async (token: string) => {
//     setToken(token);
//     localStorage.setItem('accessToken', token);
//     await user()
//   };

//   const logout = () => {
//     setToken(null);
//     localStorage.removeItem('accessToken');
//   };

//   const user = async () => {
//     try {
//       const response = await apiClient.get('/api/user')
//       if (response.status === 200) {
//         setData(response.data.data)
//       }
//       else {
//         setData(null)
//       }
//     } catch (error) {
//       console.error('Error fetching user data:', error);
//       setData(null);
//     }
//   }

//   return (
//     <AuthContext.Provider value={{ token, login, logout, data, user, collectionData, documentsData, imagesData, mediaData, refreshData }}>
//       {children}
//     </AuthContext.Provider>
//   );

// }

// export const useAuth = () => {
//   const context = useContext(AuthContext);
//   if (!context) {
//     throw new Error('useAuth must be used within an AuthProvider');
//   }
//   return context;
// };

"use client"
import apiClient from '@/lib/api';
import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';

interface UserData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

interface AuthState {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  data: UserData | null;
  user: () => void;
  collectionData: DataItem[] | null;
  documentsData: DataItem[] | null;
  imagesData: DataItem[] | null;
  mediaData: DataItem[] | null;
  refreshData: () => void;
}

type DataItem = {
  filename: string;
  filetype: string;
  created_at: string;
  summary: string;
  file_id: string
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<UserData | null>(null);
  const [collectionData, setCollectionData] = useState<DataItem[] | null>(null);
  const [documentsData, setDocumentsData] = useState<DataItem[] | null>(null);
  const [imagesData, setImagesData] = useState<DataItem[] | null>(null);
  const [mediaData, setMediaData] = useState<DataItem[] | null>(null);  

  const login = async (token: string) => {
    setToken(token);
    localStorage.setItem('accessToken', token);
    await user()
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem('accessToken');
  };

  const user = async () => {
    try {
      const response = await apiClient.get('/api/user')
      if(response.status === 200){
        setData(response.data.data)
      }
      else{
        setData(null)
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      setData(null);
    }
  }

  const fetchDataItems = async (collection: string) => {
    try {
      const response = await apiClient.get('/upload', {params: {queryCollection: collection}});
      const apiData = response.data.data || [];
      
      const items = apiData.map((item: DataItem) => ({
        filename: item.filename,
        filetype: item.filetype,
        created_at: item.created_at,
        summary: item.summary,
        file_id: item.file_id
      }));

      return items
    }
    catch(error){
      console.error("Failed to fetch recent uploads:", error);
    }
  }

  const fetchUploads = useCallback(async () => {
    try {
      const dataItems = await fetchDataItems("all")
      setCollectionData(dataItems)

      const documentItems = await fetchDataItems("Documents")
      setDocumentsData(documentItems)

      const imagesItems = await fetchDataItems("Images")
      setImagesData(imagesItems)

      const mediaItems = await fetchDataItems("Media")
      setMediaData(mediaItems)
    }
    catch(error){
      console.error("Failed to fetch recent uploads:", error);
    }
  },[])

  const refreshData = useCallback(async () => {
    console.log("Refreshing all user data...");
    await fetchUploads()
  }, [fetchUploads]);

  useEffect(() => {
    const storedToken = localStorage.getItem('accessToken');
    if (storedToken) {
      setToken(storedToken);
      user()
      refreshData()
    }
  }, [refreshData]);

  return (
    <AuthContext.Provider value={{ token, login, logout, data, user, collectionData, documentsData, imagesData, mediaData, refreshData }}>
      {children}
    </AuthContext.Provider>
  );

}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};