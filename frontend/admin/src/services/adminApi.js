import axios from 'axios';

const ADMIN_TOKEN_STORAGE_KEY = 'anagu_admin_jwt_token';
const ADMIN_REFRESH_TOKEN_STORAGE_KEY = 'anagu_admin_refresh_token';

export function getStoredAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
}

export function setStoredAdminToken(token) {
  if (token) {
    sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  }
}

export function getStoredAdminRefreshToken() {
  return sessionStorage.getItem(ADMIN_REFRESH_TOKEN_STORAGE_KEY) || '';
}

export function setStoredAdminRefreshToken(token) {
  if (token) {
    sessionStorage.setItem(ADMIN_REFRESH_TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(ADMIN_REFRESH_TOKEN_STORAGE_KEY);
  }
}

let refreshInFlight = null;

const resolvedAdminBaseUrl =
  (import.meta.env?.VITE_ADMIN_API_URL || '').trim().replace(/\/$/, '') || '/api/admin';

export function extractErrorMessage(err, fallback = 'Request failed. Please try again.') {
  if (!err) return fallback;
  if (typeof err === 'string') return err.trim() || fallback;

  const data = err?.response?.data;
  if (typeof data === 'string' && data.trim()) {
    const trimmed = data.trim();
    if (trimmed.startsWith('<')) {
      return fallback;
    }
    return trimmed;
  }
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string' && data.error.trim()) {
      return data.error.trim();
    }
    if (data.error && typeof data.error === 'object') {
      if (typeof data.error.message === 'string' && data.error.message.trim()) {
        return data.error.message.trim();
      }
      if (typeof data.error.code === 'string' || typeof data.error.code === 'number') {
        return `Server error (${data.error.code}).`;
      }
    }
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message.trim();
    }
  }

  if (typeof err?.error === 'object' && err.error !== null) {
    if (typeof err.error.message === 'string' && err.error.message.trim()) {
      return err.error.message.trim();
    }
  }

  if (typeof err?.message === 'string' && err.message.trim()) {
    return err.message.trim();
  }

  return fallback;
}

export const adminApi = axios.create({
  baseURL: resolvedAdminBaseUrl,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

adminApi.interceptors.request.use((config) => {
  const token = getStoredAdminToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

adminApi.interceptors.response.use(
  (response) => response,
  async (err) => {
    const statusCode = err?.response?.status;
    const requestUrl = String(err?.config?.url || '');
    const request = err?.config;
    const excludedRefreshPaths = ['/auth/login', '/auth/setup', '/auth/refresh'];

    if (
      statusCode === 401 &&
      request &&
      !request._anaguAdminRetried &&
      !excludedRefreshPaths.some((path) => requestUrl.includes(path)) &&
      getStoredAdminRefreshToken()
    ) {
      request._anaguAdminRetried = true;
      try {
        if (!refreshInFlight) {
          refreshInFlight = adminApi
            .post(
              '/auth/refresh',
              { refreshToken: getStoredAdminRefreshToken() },
              { headers: { Authorization: '' } }
            )
            .then(({ data }) => data)
            .finally(() => {
              refreshInFlight = null;
            });
        }
        const data = await refreshInFlight;
        setStoredAdminToken(data.token);
        setStoredAdminRefreshToken(data.refreshToken);
        request.headers.Authorization = `Bearer ${data.token}`;
        return adminApi.request(request);
      } catch {
        setStoredAdminToken('');
        setStoredAdminRefreshToken('');
        window.dispatchEvent(new CustomEvent('anagu:admin-unauthorized'));
        return Promise.reject(err);
      }
    }

    if (
      statusCode === 401 &&
      typeof window !== 'undefined' &&
      !requestUrl.includes('/auth/login') &&
      !requestUrl.includes('/auth/setup') &&
      getStoredAdminToken()
    ) {
      setStoredAdminToken('');
      setStoredAdminRefreshToken('');
      window.dispatchEvent(new CustomEvent('anagu:admin-unauthorized'));
    }

    if (err?.response?.data && typeof err.response.data === 'object') {
      if (typeof err.response.data.error !== 'string') {
        err.response.data.error = extractErrorMessage(
          err,
          statusCode === 404
            ? 'Admin API endpoint returned 404. Ensure /api/admin is running.'
            : `Request failed (${statusCode || 'network error'}).`
        );
      }
    }
    return Promise.reject(err);
  }
);
