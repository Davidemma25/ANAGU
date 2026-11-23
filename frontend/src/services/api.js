import axios from 'axios';

const TOKEN_STORAGE_KEY = 'anagu_jwt_token';
const REFRESH_TOKEN_STORAGE_KEY = 'anagu_refresh_token';

export function getStoredToken() {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function setStoredToken(token) {
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getStoredRefreshToken() {
  return sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) || '';
}

export function setStoredRefreshToken(token) {
  if (token) {
    sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
}

let refreshInFlight = null;

const envApiUrl = (import.meta.env?.VITE_API_URL || '').trim().replace(/\/$/, '');
const resolvedBaseUrl =
  envApiUrl &&
  !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/api\/v1$/i.test(envApiUrl) &&
  envApiUrl !== '/api/v1'
    ? envApiUrl
    : '/api';

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

export const api = axios.create({
  baseURL: resolvedBaseUrl,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (err) => {
    const statusCode = err?.response?.status;
    const requestUrl = String(err?.config?.url || '');
    const request = err?.config;
    const excludedRefreshPaths = [
      '/auth/register',
      '/auth/login',
      '/auth/refresh',
      '/auth/password-reset/request',
      '/auth/password-reset/confirm',
    ];

    if (
      statusCode === 401 &&
      request &&
      !request._anaguRetried &&
      !excludedRefreshPaths.some((path) => requestUrl.includes(path)) &&
      getStoredRefreshToken()
    ) {
      request._anaguRetried = true;
      try {
        if (!refreshInFlight) {
          refreshInFlight = api
            .post(
              '/auth/refresh',
              { refreshToken: getStoredRefreshToken() },
              { headers: { Authorization: '' } }
            )
            .then(({ data }) => data)
            .finally(() => {
              refreshInFlight = null;
            });
        }
        const data = await refreshInFlight;
        setStoredToken(data.token);
        setStoredRefreshToken(data.refreshToken);
        request.headers.Authorization = `Bearer ${data.token}`;
        return api.request(request);
      } catch {
        setStoredToken('');
        setStoredRefreshToken('');
        window.dispatchEvent(new CustomEvent('anagu:unauthorized'));
        return Promise.reject(err);
      }
    }

    if (
      statusCode === 401 &&
      typeof window !== 'undefined' &&
      !requestUrl.includes('/auth/register') &&
      getStoredToken()
    ) {
      setStoredToken('');
      setStoredRefreshToken('');
      window.dispatchEvent(new CustomEvent('anagu:unauthorized'));
    }

    if (err?.response?.data && typeof err.response.data === 'object') {
      if (typeof err.response.data.error !== 'string') {
        const normalized = extractErrorMessage(
          err,
          statusCode === 404
            ? 'API endpoint returned 404. Ensure the ANAGU backend or Vercel /api function is deployed.'
            : `Request failed (${statusCode || 'network error'}).`
        );
        err.response.data.error = normalized;
      }
    }
    return Promise.reject(err);
  }
);
