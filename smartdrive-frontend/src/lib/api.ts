import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';

const apiClient = axios.create({
  baseURL: '',
  withCredentials: true,
});

const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

const readCookie = (name: string): string | undefined => {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
};

// Echo the csrfToken cookie back as a header on state-changing requests.
apiClient.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toLowerCase();
  if (UNSAFE_METHODS.has(method)) {
    const csrfToken = readCookie('csrfToken');
    if (csrfToken) {
      config.headers.set('X-CSRF-Token', csrfToken);
    }
  }
  return config;
});

// --- Refresh flow ---
// On 401, attempt a single refresh and replay the original request.
// All in-flight 401s share the same refresh promise — no thundering herd.
let refreshPromise: Promise<boolean> | null = null;

const refreshOnce = async (): Promise<boolean> => {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      // Use the raw axios (not apiClient) so its own interceptor doesn't
      // recursively trigger another refresh on 401.
      await axios.post('/api/refresh', null, { withCredentials: true });
      return true;
    } catch (err) {
      console.warn('[auth] refresh failed', err);
      return false;
    }
  })();
  // Clear the cached promise once it settles so a future 401 can try again.
  refreshPromise.finally(() => {
    setTimeout(() => { refreshPromise = null; }, 0);
  });
  return refreshPromise;
};

const isAuthPath = (path: string) =>
  path === '/' ||
  path.startsWith('/reset-password') ||
  path.startsWith('/forgot-password') ||
  path.startsWith('/verify-email');

const redirectToLogin = () => {
  if (typeof window === 'undefined') return;
  if (!isAuthPath(window.location.pathname)) {
    window.location.href = '/';
  }
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError): Promise<AxiosResponse | never> => {
    const status = error.response?.status;
    const original = error.config as
      | (AxiosRequestConfig & { _retried?: boolean; url?: string })
      | undefined;

    const requestUrl = original?.url ?? '';
    const isRefreshCall = requestUrl.includes('/api/refresh');
    const isLoginCall = requestUrl.includes('/api/login');

    // 401 → try refresh + replay once.
    if (status === 401 && original && !original._retried && !isRefreshCall && !isLoginCall) {
      original._retried = true;
      const ok = await refreshOnce();
      if (ok) {
        try {
          return await apiClient.request(original);
        } catch (retryErr) {
          // Replay also failed — fall through to redirect.
          if ((retryErr as AxiosError).response?.status === 401) {
            redirectToLogin();
          }
          throw retryErr;
        }
      }
      // Refresh failed → real expiry. Bounce.
      redirectToLogin();
      return Promise.reject(error);
    }

    // Non-recoverable 401 (login, refresh, or already retried) — bounce.
    if (status === 401) {
      redirectToLogin();
    }
    return Promise.reject(error);
  }
);

export default apiClient;
