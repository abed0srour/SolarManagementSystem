/**
 * Who can do what.
 *
 * Permissions are `<module>.read` / `<module>.write` over a small set of
 * business areas rather than one per endpoint: an admin granting access thinks
 * in terms of "can they touch purchasing", not "can they POST /purchase-orders".
 *
 * The required permission is derived from the request's own route (see
 * `requiredPermission`) instead of a decorator on every controller. That means
 * a new endpoint is covered the moment it is added — the failure mode is a
 * route being denied until it is mapped, never a route being silently
 * unprotected, which is the right way round for an access-control default.
 */

export const MODULES = [
  'catalog',
  'inventory',
  'sales',
  'purchasing',
  'finance',
  'operations',
  'workers',
  'reports',
  'settings',
  'users',
] as const;

export type PermissionModule = (typeof MODULES)[number];
export type Permission = `${PermissionModule}.read` | `${PermissionModule}.write`;

export const ALL_PERMISSIONS: Permission[] = MODULES.flatMap((m) => [`${m}.read` as Permission, `${m}.write` as Permission]);

/** First path segment after /api → the module it belongs to. */
const ROUTE_MODULE: Record<string, PermissionModule> = {
  products: 'catalog',
  categories: 'catalog',
  inventory: 'inventory',
  warehouse: 'inventory',
  'product-history': 'inventory',
  clients: 'sales',
  quotations: 'sales',
  'sales-orders': 'sales',
  receipts: 'sales',
  refunds: 'sales',
  suppliers: 'purchasing',
  'purchase-orders': 'purchasing',
  'purchase-returns': 'purchasing',
  invoices: 'finance',
  payments: 'finance',
  expenses: 'finance',
  installations: 'operations',
  monitoring: 'operations',
  'service-jobs': 'operations',
  warranty: 'operations',
  'maintenance-contracts': 'operations',
  'solar-calculator': 'operations',
  workers: 'workers',
  reports: 'reports',
  dashboard: 'reports',
  settings: 'settings',
  backup: 'settings',
  audit: 'settings',
  uploads: 'settings',
  users: 'users',
};

/**
 * Endpoints every signed-in user reaches regardless of role: their own account,
 * their own notifications, and the cron entry points (which carry their own
 * shared-secret check rather than a user session).
 */
const ALWAYS_ALLOWED = new Set(['auth', 'notifications', 'cron']);

/**
 * Platform routes. Not a permission module: they are gated on being the super
 * admin, which is a different question from "which parts of a store may you
 * touch". Kept as its own set so `requiredPermission` cannot accidentally
 * classify them as tenant routes and let a store admin in.
 */
const PLATFORM_ROUTES = new Set(['superadmin']);

export function isPlatformRoute(path: string): boolean {
  const segments = path.replace(/^\/+/, '').split('/');
  const resource = segments[0] === 'api' ? segments[1] : segments[0];
  return !!resource && PLATFORM_ROUTES.has(resource);
}

export function isAlwaysAllowedRoute(path: string): boolean {
  const segments = path.replace(/^\/+/, '').split('/');
  const resource = segments[0] === 'api' ? segments[1] : segments[0];
  return !resource || ALWAYS_ALLOWED.has(resource);
}

export interface RequiredPermission {
  module: PermissionModule;
  permission: Permission;
}

/**
 * The permission a request needs, or null when the route is open to any signed-
 * in user. Returns `undefined` for an unmapped route so the guard can deny it.
 */
export function requiredPermission(method: string, path: string): RequiredPermission | null | undefined {
  const segments = path.replace(/^\/+/, '').split('/');
  // Strip the global prefix when present — the guard sees the full URL.
  const resource = segments[0] === 'api' ? segments[1] : segments[0];
  if (!resource) return null;
  if (ALWAYS_ALLOWED.has(resource)) return null;
  // Platform routes are decided by SuperAdminGuard, never by a permission.
  if (PLATFORM_ROUTES.has(resource)) return null;

  const module = ROUTE_MODULE[resource];
  if (!module) return undefined;

  const write = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  return { module, permission: `${module}.${write ? 'write' : 'read'}` as Permission };
}

const readOnly = (modules: PermissionModule[]): Permission[] => modules.map((m) => `${m}.read` as Permission);
const full = (modules: PermissionModule[]): Permission[] =>
  modules.flatMap((m) => [`${m}.read` as Permission, `${m}.write` as Permission]);

/**
 * What each role grants before per-user overrides.
 *
 * SUPER_ADMIN is deliberately absent. It is not a store role at all: it manages
 * tenants and never touches their business data, so giving it store permissions
 * would be describing access it is not supposed to have.
 *
 * ADMIN — the Tenant Admin — now includes `users`. Under multi-tenancy a store
 * has to be able to manage its own staff; the alternative is every new cashier
 * account going through the platform owner, which does not scale past the first
 * customer and hands the platform owner a job that is not theirs.
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: full([...MODULES]),
  MANAGER: [
    ...full(['catalog', 'inventory', 'sales', 'purchasing', 'operations']),
    ...readOnly(['finance', 'reports', 'workers']),
  ],
  STAFF: [...full(['sales', 'inventory']), ...readOnly(['catalog', 'purchasing', 'operations'])],
  VIEWER: readOnly([...MODULES].filter((m) => m !== 'users' && m !== 'settings') as PermissionModule[]),
};

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'] as const;

/**
 * A user's effective permissions: the role's defaults, unless the account has
 * an explicit override list. An empty array means "no override", not "nothing
 * allowed" — otherwise every existing account would lose access on upgrade.
 */
export function effectivePermissions(role: string, overrides?: string[] | null): Permission[] {
  if (role === 'SUPER_ADMIN') return ALL_PERMISSIONS;
  if (overrides && overrides.length) return overrides as Permission[];
  return ROLE_PERMISSIONS[role] ?? [];
}
