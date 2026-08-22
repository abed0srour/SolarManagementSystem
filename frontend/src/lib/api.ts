import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { clearSession, getRefreshToken, getToken, setSession } from './auth';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post('/api/auth/refresh', { refreshToken });
    const payload = data?.data ?? data;
    // No `remember` argument: keep the tier the session already lives in.
    setSession({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      user: payload.user,
    });
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
      clearSession();
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

/** Open and preview or print a PDF in a new tab from an authenticated endpoint. */
export async function openPdf(url: string) {
  const res = await api.get(url, { responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, '_blank');
  if (!win) {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = blobUrl;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    };
  }
}

