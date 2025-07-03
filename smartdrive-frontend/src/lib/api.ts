import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.BACKEND_URL || 'http://localhost:4000',
});

// --- Interceptor ---
// This function runs BEFORE every single request made with this client.
apiClient.interceptors.request.use(
  (config) => {
    // Get the token from local storage
    const token = localStorage.getItem('accessToken');
    if (token) {
      // If the token exists, add it to the Authorization header
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default apiClient;