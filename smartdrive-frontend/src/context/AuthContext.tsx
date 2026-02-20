// // "use client";
// // import apiClient from "@/lib/api";
// // import { useRouter } from "next/navigation";
// // import {
// //   createContext,
// //   useContext,
// //   useState,
// //   ReactNode,
// //   useEffect,
// // } from "react";

// // interface UserData {
// //   id: string;
// //   email: string;
// //   firstName: string;
// //   lastName: string;
// //   phone?: string;
// // }

// // interface AuthState {
// //   token: string | null;
// //   login: (token: string) => void;
// //   logout: () => void;
// //   data: UserData | null;
// //   user: () => void;
// //   authReady: boolean;
// // }

// // const AuthContext = createContext<AuthState | undefined>(undefined);

// // export const AuthProvider = ({ children }: { children: ReactNode }) => {
// //   const [token, setToken] = useState<string | null | undefined>(undefined);
// //   const [data, setData] = useState<UserData | null>(null);
// //   const [authReady, setAuthReady] = useState(false);
// //   const router = useRouter();

// //   const login = async (token: string) => {
// //     setToken(token);
// //     localStorage.setItem("accessToken", token);
// //     await user();
// //   };

// //   const logout = async () => {
// //     setToken(null);
// //     localStorage.removeItem("accessToken");
// //     try {
// //       await apiClient.post("/api/logout"); // withCredentials already true
// //     } catch (e) {
// //       // even if it fails, continue clearing local UI
// //     } finally {
// //       setToken(null); // if you still keep token state
// //       setData(null);
// //       localStorage.removeItem("accessToken"); // optional (cleanup old)
// //       router.replace("/"); // replace avoids “back” returning
// //     }
// //     // return;
// //   };

// //   const user = async () => {
// //     try {
// //       const response = await apiClient.get("/api/user");
// //       if (response.status === 200) {
// //         setData(response.data.data);
// //       } else {
// //         setData(null);
// //       }
// //     } catch (error) {
// //       console.error("Error fetching user data:", error);
// //       setData(null);
// //     }
// //   };

// //   useEffect(() => {
// //     // const storedToken = localStorage.getItem('accessToken');
// //     // if (storedToken) {
// //     //   setToken(storedToken);
// //     //   user()
// //     // }
// //     // else{
// //     //   logout()
// //     // }
// //     const init = async () => {
// //       const storedToken = localStorage.getItem("accessToken");
// //       setToken(storedToken); // can be null

// //       try {
// //         const res = await apiClient.get("/api/user"); // must send cookies
// //         if (res.status === 200) setData(res.data.data);
// //         else setData(null);
// //       } catch (err: any) {
// //         const status = err?.response?.status;
// //         if (status === 401 || status === 403) {
// //           setToken(null);
// //           setData(null);
// //           localStorage.removeItem("accessToken");
// //         }
// //       } finally {
// //         setAuthReady(true);
// //         if (!storedToken) setToken(null); // finish resolving token state
// //       }
// //     };

// //     init();
// //   }, [router]);

// //   return (
// //     <AuthContext.Provider
// //       value={{ token: token ?? null, login, logout, data, user, authReady }}
// //     >
// //       {children}
// //     </AuthContext.Provider>
// //   );
// // };

// // export const useAuth = () => {
// //   const context = useContext(AuthContext);
// //   if (!context) {
// //     throw new Error("useAuth must be used within an AuthProvider");
// //   }
// //   return context;
// // };

// "use client";
// import apiClient from "@/lib/api";
// import { useRouter } from "next/navigation";
// import React, { createContext, useContext, useEffect, useState } from "react";

// interface UserData {
//   id: string;
//   email: string;
//   firstName: string;
//   lastName: string;
//   phone?: string;
// }

// interface AuthState {
//   data: UserData | null;
//   authReady: boolean;
//   user: () => Promise<void>;
//   login: (email: string, password: string) => Promise<void>;
//   logout: () => Promise<void>;
// }

// const AuthContext = createContext<AuthState | undefined>(undefined);

// export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
//   const [data, setData] = useState<UserData | null>(null);
//   const [authReady, setAuthReady] = useState(false);
//   const router = useRouter();

//   const user = async () => {
//     try {
//       const res = await apiClient.get("/api/user");
//       setData(res.status === 200 ? res.data.data : null);
//     } catch {
//       setData(null);
//     }
//   };

//   const login = async (email: string, password: string) => {
//     // backend sets cookies on success
//     await apiClient.post("/api/login", { email, password });
//     await user();
//   };

//   const logout = async () => {
//     try {
//       await apiClient.post("/api/logout");
//     } finally {
//       setData(null);
//       router.replace("/");
//     }
//   };

//   useEffect(() => {
//     (async () => {
//       await user();        // checks cookie session on refresh/new tab
//       setAuthReady(true);
//     })();
//   }, []);

//   return (
//     <AuthContext.Provider value={{ data, authReady, user, login, logout }}>
//       {children}
//     </AuthContext.Provider>
//   );
// };

// export const useAuth = () => {
//   const ctx = useContext(AuthContext);
//   if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
//   return ctx;
// };

"use client";

import apiClient from "@/lib/api";
import { usePathname, useRouter } from "next/navigation";
import React, { createContext, useContext, useEffect, useState } from "react";

interface UserData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

interface AuthState {
  data: UserData | null;
  authReady: boolean;
  user: () => Promise<boolean>;
  // login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);


export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [data, setData] = useState<UserData | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const router = useRouter();
  const pathname = usePathname();

  const logout = async () => {
    try {
      await apiClient.post("/api/logout");
    } catch {
      // ignore
    } finally {
      setData(null);
      router.replace("/");
    }
  };

  const user = async (): Promise<boolean> => {
    try {
      const res = await apiClient.get("/api/user");
      if (res.status === 200 && res.data?.data) {
        setData(res.data.data);
        return true;
      }
      setData(null);
      return false;
    } catch {
      setData(null);
      return false;
    }
  };

  // const login = async (email: string, password: string) => {
  //   await apiClient.post("/api/login", { email, password });
  //   const ok = await user();
  //   if (!ok) {
  //       setData(null);
  //       router.replace("/");
  //   }
  // };

  useEffect(() => {
    if (pathname === "/") {
      setData(null);
      setAuthReady(true);
      return;
    }

    let isMounted = true;

    (async () => {
      const ok = await user();
      
      if (!isMounted) return;

      if (!ok) {
        // Only clear state and redirect. 
        // Do NOT call the API logout or set authReady to true.
        setData(null);
        router.replace("/");
      } else {
        setAuthReady(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [pathname]); 

  // BLOCK RENDERING: If not ready and not on the login page, don't render children.
  // This prevents `fetchCollections` from firing its API calls during a redirect.
  if (!authReady && pathname !== "/") {
    return null; // Or return a <LoadingSpinner />
  }

  return (
    <AuthContext.Provider value={{ data, authReady, user, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};