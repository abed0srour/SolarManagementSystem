/**
 * The shape of an access token issued by Supabase for this application.
 *
 * `role`, `tenant_id`, `app_role` and `permissions` are put there by the
 * Custom Access Token Hook (see the migration of the same name). Reading them
 * off the token is the whole point of that hook: no request has to ask the
 * database who the caller is before it can decide what they may do.
 */
export interface SupabaseClaims {
  sub: string;
  email?: string;
  exp: number;
  /** Supabase's own claim: 'authenticated' for a signed-in user. */
  aud?: string | string[];
  /** Coarse tier used for routing and RLS. */
  role?: 'super_admin' | 'tenant_admin' | 'staff' | 'none' | string;
  tenant_id?: string | null;
  /** Fine-grained application role: SUPER_ADMIN | ADMIN | MANAGER | STAFF | VIEWER. */
  app_role?: string;
  permissions?: string[];
  is_active?: boolean;
  tenant_name?: string | null;
  /** ACTIVE | SUSPENDED | ARCHIVED | PLATFORM | MISSING | UNKNOWN. */
  tenant_status?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

export const SUPER_ADMIN_ROLE = 'super_admin';

export function isSuperAdmin(claims: Pick<SupabaseClaims, 'role' | 'app_role'>): boolean {
  return claims.role === SUPER_ADMIN_ROLE || claims.app_role === 'SUPER_ADMIN';
}

/**
 * Claims can arrive either at the top level (Custom Access Token Hook) or
 * nested under `app_metadata` (the mirror trigger, which covers a project where
 * the hook has not been switched on yet). Reading both means the API behaves
 * identically either way instead of failing in a way that looks like a bug in
 * the application.
 */
export function normaliseClaims(raw: Record<string, any>): SupabaseClaims {
  const meta = (raw.app_metadata ?? {}) as Record<string, any>;
  const pick = <T>(key: string): T | undefined => (raw[key] !== undefined ? raw[key] : meta[key]);

  const tenantId = pick<string | null>('tenant_id');
  return {
    ...raw,
    sub: raw.sub,
    email: raw.email,
    exp: raw.exp,
    role: pick<string>('role') ?? 'none',
    tenant_id: tenantId === undefined || tenantId === '' ? null : tenantId,
    app_role: pick<string>('app_role') ?? 'STAFF',
    permissions: pick<string[]>('permissions') ?? [],
    is_active: pick<boolean>('is_active') ?? true,
    tenant_name: pick<string | null>('tenant_name') ?? null,
    tenant_status: pick<string>('tenant_status') ?? 'UNKNOWN',
  };
}
