"use client"
import apiClient from '@/lib/api';
import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

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
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<UserData | null>(null);

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

  useEffect(() => {
    const storedToken = localStorage.getItem('accessToken');
    if (storedToken) {
      setToken(storedToken);
      user()
    }
  }, []);

  return (
    <AuthContext.Provider value={{ token, login, logout, data, user }}>
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