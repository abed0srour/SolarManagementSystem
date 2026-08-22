import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { supabaseBrowser } from './supabase/client';

export const api = axios.create({ baseURL: '/api' });

/**
 * Attach the Supabase access token to every call.
 *
 * `getSession()` is awaited rather than read from a cached variable because
 * Supabase refreshes the token on its own schedule; asking each time means a
 * request never goes out with a token that was rotated a moment ago. It reads
 * from memory in the common case, so this is not a network hop.
 */
api.interceptors.request.use(async (config) => {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

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
    if (typeof window !== 'undefined' && err.response?.status === 401 && original && !original._retried) {
      original._retried = true;
      /*
       * One retry against a freshly refreshed session.
       *
       * There is no hand-rolled refresh here any more — `refreshSession()` is
       * Supabase's, and it de-duplicates concurrent callers itself, which is
       * what the old `refreshing` promise existed to do. A 401 that survives
       * this is a real one: expired beyond recovery, deactivated account, or a
       * suspended store.
       */
      const { data } = await supabaseBrowser().auth.refreshSession();
      const token = data.session?.access_token;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
      await supabaseBrowser().auth.signOut();
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

