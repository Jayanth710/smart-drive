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
import { toast } from "react-toastify";

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
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [data, setData] = useState<UserData | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const router = useRouter();

  const pathname = usePathname();

  // const logout = async () => {
  //   try {
  //     await apiClient.post("/api/logout");
  //   } catch {
  //     // ignore
  //   }
  //   finally {

  //     // 1. Erase the data immediately
  //     setData(null);
  //     toast.success("Logged out successfully");

  //     // 2. THE SNAPSHOT FIX: 
  //     // Wait 100 milliseconds for React to actually erase the DOM and hit the 
  //     // Global Firewall (returning null). THEN navigate. 
  //     // This ensures Safari's memory snapshot is completely blank.
  //     setTimeout(() => {
  //       window.location.href = "/";
  //     }, 100);
  //   }
  // };

  const logout = async () => {
    try {
      await apiClient.post("/api/logout");
    } catch {
      // ignore
    } finally {
      setData(null);
      toast.success("Logged out successfully");

      setTimeout(() => router.replace("/"), 500);

      // 1) Replace current page (does not add history)
      // window.location.replace("/");

      // 2) After landing, push a state so Back stays on "/"
      // (works across Safari/Chrome)
      setTimeout(() => {
        window.history.pushState(null, "", "/");
      }, 0);
    }
  };

  const user = async (): Promise<boolean> => {
    try {
      // 1. CACHE BUSTER: The timestamp forces the browser to treat this as a brand new request every single time.
      const timestamp = new Date().getTime();

      const res = await apiClient.get(`/api/user?t=${timestamp}`, {
        // 2. STRICT HEADERS: Tell the browser network layer to never save this response
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        }
      });

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

  const login = async (email: string, password: string) => {
    // 1. Tell the backend to verify the user and set the secure cookie
    await apiClient.post("/api/login", { email, password });

    // 2. Immediately fetch the user's profile using the brand new cookie
    const ok = await user();

    // 3. (Inside the user() function) React updates the global `data` state!
    if (!ok) {
      setData(null);
      toast.error("Login failed.");
    }
  };

  useEffect(() => {
    let isMounted = true;

    (async () => {
      const ok = await user();

      if (!isMounted) return;
      setAuthReady(true);

      if (!ok && pathname !== "/") {
        window.location.replace("/");
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [pathname]);

  if (!authReady && pathname !== "/") {
    return null;
  }

  if (authReady && !data && pathname !== "/") {
    return null;
  }

  return (
    <AuthContext.Provider value={{ data, authReady, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};