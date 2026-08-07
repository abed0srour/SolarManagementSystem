/**
 * Single source of truth for the admin session.
 *
 * Storage split, and why:
 *  - Tokens live in `localStorage` when "remember me" is checked and in
 *    `sessionStorage` otherwise, so an unchecked box really does end the
 *    session when the browser closes.
 *  - A mirror cookie (`sms_session`) holds the access token because Next.js
 *    middleware runs on the server/edge and cannot read either Web Storage
 *    API. The cookie is what `middleware.ts` inspects to decide redirects.
 *
 * The cookie is a UX signal, not a security boundary: it is forgeable by
 * anyone with devtools, and forging it only yields an empty dashboard shell
 * because every `/api/*` call is still verified by the NestJS JwtAuthGuard.
 * Authorization is enforced on the backend, never here.
 *
 * We deliberately never persist the password. See `rememberedEmail` below.
 */

export const SESSION_COOKIE = 'sms_session';

const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refreshToken';
const USER_KEY = 'user';
const REMEMBER_EMAIL_KEY = 'rememberedEmail';
/** Legacy key that stored `{ email, password }` in cleartext. Purged on sight. */
const LEGACY_REMEMBER_KEY = 'rememberedLogin';

const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type SessionUser = { id: string; email: string; name?: string; role?: string };

export type SessionPayload = {
  accessToken: string;
  refreshToken?: string;
  user?: SessionUser;
};

function stores(): Storage[] {
  if (typeof window === 'undefined') return [];
  return [window.localStorage, window.sessionStorage];
}

/** Read a key from whichever store currently holds it. */
function read(key: string): string | null {
  for (const s of stores()) {
    try {
      const v = s.getItem(key);
      if (v !== null) return v;
    } catch {
      /* storage disabled (private mode / blocked cookies) */
    }
  }
  return null;
}

function writeCookie(token: string, remember: boolean) {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // Session cookie (no Max-Age) when "remember me" is off, so it dies with the tab.
  const age = remember ? `; Max-Age=${REMEMBER_MAX_AGE}` : '';
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Strict${age}${secure}`;
}

function clearCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
}

/**
 * Persist a freshly issued session. `remember` picks the storage tier; when it
 * is omitted we keep whatever tier the current session already uses (so a
 * silent token refresh doesn't silently downgrade a remembered login).
 */
export function setSession(payload: SessionPayload, remember?: boolean) {
  if (typeof window === 'undefined') return;
  const persist = remember ?? isRemembered();
  const target = persist ? window.localStorage : window.sessionStorage;
  const other = persist ? window.sessionStorage : window.localStorage;

  try {
    // Drop any copy held by the other tier so there is exactly one live token.
    for (const k of [TOKEN_KEY, REFRESH_KEY, USER_KEY]) other.removeItem(k);

    target.setItem(TOKEN_KEY, payload.accessToken);
    if (payload.refreshToken) target.setItem(REFRESH_KEY, payload.refreshToken);
    if (payload.user) target.setItem(USER_KEY, JSON.stringify(payload.user));
  } catch {
    /* quota or disabled storage — the cookie below still carries the session */
  }
  writeCookie(payload.accessToken, persist);
}

export function getToken(): string | null {
  return read(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return read(REFRESH_KEY);
}

/** Update the cached user profile in whichever tier holds the live session. */
export function setUser(user: SessionUser): void {
  if (typeof window === 'undefined') return;
  const target = isRemembered() ? window.localStorage : window.sessionStorage;
  try {
    target.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

export function getUser(): SessionUser | null {
  const raw = read(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

/** True when the live token is held in localStorage, i.e. "remember me" was on. */
export function isRemembered(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TOKEN_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  for (const s of stores()) {
    try {
      for (const k of [TOKEN_KEY, REFRESH_KEY, USER_KEY]) s.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  clearCookie();
}

/**
 * Remembered email for prefilling the login form.
 *
 * Only the email is ever stored. The previous implementation also wrote the
 * password in cleartext, which handed full credentials to any XSS payload or
 * anyone opening devtools — and unlike a token, a password cannot be revoked.
 * `purgeLegacyCredentials()` deletes that old key on next visit.
 */
export function setRememberedEmail(email: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (email) window.localStorage.setItem(REMEMBER_EMAIL_KEY, email);
    else window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

export function getRememberedEmail(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(REMEMBER_EMAIL_KEY);
  } catch {
    return null;
  }
}

/** Migrate away from the cleartext `{ email, password }` blob. */
export function purgeLegacyCredentials(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_REMEMBER_KEY);
    window.localStorage.removeItem(LEGACY_REMEMBER_KEY);
    if (!raw) return null;
    const { email } = JSON.parse(raw) as { email?: string };
    if (email) setRememberedEmail(email);
    return email ?? null;
  } catch {
    return null;
  }
}
