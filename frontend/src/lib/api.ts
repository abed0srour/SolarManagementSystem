import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post('/api/auth/refresh', { refreshToken });
    const payload = data?.data ?? data;
    localStorage.setItem('token', payload.accessToken);
    localStorage.setItem('refreshToken', payload.refreshToken);
    localStorage.setItem('user', JSON.stringify(payload.user));
    return payload.accessToken as string;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (res) => {
    // Unwrap the backend's { success, data } envelope
    if (res.data && typeof res.data === 'object' && res.data.success === true && 'data' in res.data) {
      res.data = res.data.data;
    }
    return res;
  },
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retried?: boolean };
    if (
      typeof window !== 'undefined' &&
      err.response?.status === 401 &&
      original &&
      !original._retried &&
      !original.url?.includes('/auth/login') &&
      !original.url?.includes('/auth/refresh')
    ) {
      original._retried = true;
      refreshing = refreshing ?? tryRefresh();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

/** Extract a readable message from an API error. */
export function errMsg(e: unknown): string {
  const anyErr = e as any;
  const m = anyErr?.response?.data?.message;
  if (Array.isArray(m)) return m.join('; ');
  return m ?? anyErr?.message ?? 'Something went wrong';
}

export function fmtMoney(n: unknown, currency = 'USD'): string {
  const v = Number(n ?? 0);
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function fmtDate(d?: string | Date | null): string {
  if (!d) return '—';
  return new Date(d).toISOString().slice(0, 10);
}

export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return '—';
  const date = new Date(d);
  return `${date.toISOString().slice(0, 10)} ${date.toTimeString().slice(0, 5)}`;
}

/** Download a file from an authenticated endpoint. */
export async function downloadFile(url: string, filename: string) {
  const res = await api.get(url, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}
