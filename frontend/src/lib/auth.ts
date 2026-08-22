'use client';

/**
 * Session access for client components.
 *
 * Everything about the session — where it is stored, when it refreshes, how it
 * is cleared — now belongs to Supabase, which keeps it in cookies so the
 * middleware can read it too. This module is a thin, typed read over that: the
 * app asks "who am I and which store am I in?" and gets an answer decoded from
 * the token, with no request behind it.
 *
 * The previous hand-rolled token store (localStorage/sessionStorage tiers, a
 * mirror cookie, manual refresh-token rotation) is gone. Its remembered-email
 * convenience is kept, since Supabase has no opinion about that.
 */

import { supabaseBrowser } from './supabase/client';
import { claimsFromToken, homeRouteFor, SessionClaims } from './claims';

const REMEMBER_EMAIL_KEY = 'rememberedEmail';
/** Keys written by the pre-Supabase session. Purged on sight. */
const LEGACY_KEYS = ['token', 'refreshToken', 'user', 'rememberedLogin'];
export const LEGACY_SESSION_COOKIE = 'sms_session';

export type { SessionClaims };
export { homeRouteFor };

/** The current access token, or null when signed out. */
export async function getToken(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Identity decoded from the live token. */
export async function getClaims(): Promise<SessionClaims | null> {
  return claimsFromToken(await getToken());
}

export async function signOut(): Promise<void> {
  await supabaseBrowser().auth.signOut();
  purgeLegacySession();
}

/**
 * Remove anything the old auth system left behind.
 *
 * Worth doing once per visit rather than never: the old scheme kept an access
 * token, a refresh token and a cached user profile in Web Storage, and a stale
 * copy of those is a credential sitting in the browser for no reason.
 */
export function purgeLegacySession(): string | null {
  if (typeof window === 'undefined') return null;
  let migratedEmail: string | null = null;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const legacyLogin = store.getItem('rememberedLogin');
      if (legacyLogin) {
        const { email } = JSON.parse(legacyLogin) as { email?: string };
        if (email) migratedEmail = email;
      }
      for (const key of LEGACY_KEYS) store.removeItem(key);
    } catch {
      /* storage disabled (private mode / blocked cookies) */
    }
  }
  try {
    document.cookie = `${LEGACY_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
  } catch {
    /* ignore */
  }
  if (migratedEmail) setRememberedEmail(migratedEmail);
  return migratedEmail;
}

/**
 * Remembered email for prefilling the login form.
 *
 * Only ever the email. A password is not stored, in this key or any other:
 * unlike a token, a password cannot be revoked once it leaks.
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
