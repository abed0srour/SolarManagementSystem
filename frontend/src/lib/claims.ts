/**
 * Reading identity out of the access token.
 *
 * `role` and `tenant_id` are signed into the token by the Custom Access Token
 * Hook, so answering "who is this and which store are they in?" costs nothing —
 * no database query, no API call, no await. That matters most in the
 * middleware, which runs before every navigation and would otherwise add a
 * round trip to each one.
 *
 * The decoding here is deliberately unverified. It is used only to decide what
 * to SHOW: which dashboard to route to, which nav to render. Anything that
 * actually returns data verifies the signature server-side — the NestJS API in
 * `SupabaseTokenService`, and Postgres in the RLS policies. A forged cookie
 * therefore buys an empty shell and nothing else.
 */

export type ProfileRole = 'super_admin' | 'tenant_admin' | 'staff' | 'none';

export interface SessionClaims {
  sub: string;
  email?: string;
  fullName?: string;
  exp?: number;
  role: ProfileRole;
  tenantId: string | null;
  tenantName: string | null;
  tenantStatus: string;
  appRole: string;
  permissions: string[];
  isActive: boolean;
}

/** Decode a JWT payload without verifying it. Signature checks happen server-side. */
export function decodeJwt(token: string): Record<string, any> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json =
      typeof atob === 'function'
        ? decodeURIComponent(
            atob(padded)
              .split('')
              .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
              .join(''),
          )
        : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Normalise a decoded payload into the claims this app cares about.
 *
 * Reads each value from the top level first and `app_metadata` second. The hook
 * writes the former and a database trigger mirrors it to the latter, so the app
 * behaves identically whether or not the hook has been switched on for a given
 * project — a misconfiguration shows up as a support question, not as a
 * mysteriously roleless user.
 */
export function toClaims(payload: Record<string, any> | null): SessionClaims | null {
  if (!payload?.sub) return null;
  const meta = payload.app_metadata ?? {};
  const pick = (key: string) => (payload[key] !== undefined ? payload[key] : meta[key]);

  const tenantId = pick('tenant_id');
  const userMeta = payload.user_metadata ?? {};
  const fullName = userMeta.full_name || userMeta.name || payload.full_name || payload.name || undefined;
  return {
    sub: payload.sub,
    email: payload.email,
    fullName,
    exp: payload.exp,
    role: (pick('role') ?? 'none') as ProfileRole,
    tenantId: tenantId === undefined || tenantId === '' ? null : tenantId,
    tenantName: pick('tenant_name') ?? null,
    tenantStatus: pick('tenant_status') ?? 'UNKNOWN',
    appRole: pick('app_role') ?? 'STAFF',
    permissions: pick('permissions') ?? [],
    isActive: pick('is_active') ?? true,
  };
}

export function claimsFromToken(token: string | undefined | null): SessionClaims | null {
  return token ? toClaims(decodeJwt(token)) : null;
}

export const isSuperAdmin = (claims: SessionClaims | null): boolean => claims?.role === 'super_admin';
export const isTenantAdmin = (claims: SessionClaims | null): boolean => claims?.role === 'tenant_admin';

/** Where this account belongs after signing in. */
export function homeRouteFor(claims: SessionClaims | null): string {
  if (!claims) return '/login';
  return isSuperAdmin(claims) ? '/superadmin/dashboard' : '/dashboard';
}
