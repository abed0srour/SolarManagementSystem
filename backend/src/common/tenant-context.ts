import { AsyncLocalStorage } from 'async_hooks';

/**
 * Which tenant the current unit of work belongs to.
 *
 * This is ambient rather than passed as an argument on purpose. Twenty-five
 * modules and several hundred queries already exist; threading a `tenantId`
 * parameter through every one of them would mean that forgetting it in a single
 * place silently returns another store's data. Ambient context inverts that
 * failure mode -- the scoping is applied centrally in
 * `src/prisma/tenant-scope.ts`, and code that forgets about tenancy is still
 * correct.
 *
 * The store is deliberately mutable. Express middleware establishes it at the
 * very start of the request, before the JWT has been verified; the auth guard
 * then fills in the identity a moment later, inside the same async context.
 */
export type TenantMode =
  /** A tenant user. Every scoped query is filtered to `tenantId`. */
  | 'TENANT'
  /**
   * Explicitly stepping outside tenancy: login by email, the super admin
   * listing stores, a background job iterating tenants. Never reachable from an
   * HTTP handler by accident -- only `runUnscoped` sets it.
   */
  | 'UNSCOPED'
  /** Nothing established yet. Scoped models refuse to answer. */
  | 'NONE';

export interface TenantContext {
  mode: TenantMode;
  tenantId: string | null;
  userId: string | null;
  /** Coarse role from the token: 'super_admin' | 'tenant_admin' | 'staff'. */
  role: string | null;
  /** Fine-grained application role: ADMIN | MANAGER | STAFF | VIEWER. */
  appRole: string | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

const empty = (): TenantContext => ({
  mode: 'NONE',
  tenantId: null,
  userId: null,
  role: null,
  appRole: null,
});

/**
 * Open a context for the current request. Everything downstream -- guards,
 * interceptors, the controller, every service it calls -- runs inside it.
 */
export function runWithTenantContext<T>(fn: () => T): T {
  return storage.run(empty(), fn);
}

/** Pin the current context to one tenant. Called by the auth guard. */
export function setTenantContext(patch: Partial<TenantContext>): void {
  const store = storage.getStore();
  if (!store) return;
  Object.assign(store, patch);
}

export function getTenantContext(): TenantContext {
  return storage.getStore() ?? empty();
}

export function currentTenantId(): string | null {
  return getTenantContext().tenantId;
}

/**
 * The current tenant, or a refusal.
 *
 * For the handful of places that must name the tenant themselves rather than
 * letting the extension add it: an `upsert` or a compound-key `update`, where
 * Prisma needs a complete unique key to decide whether to insert or update and
 * a filter added afterwards would be too late.
 */
export function requireTenantId(): string {
  const { tenantId } = getTenantContext();
  if (!tenantId) {
    throw new Error(
      'No active tenant. This operation needs a tenant-scoped request, runAsTenant(), or an explicit tenant id.',
    );
  }
  return tenantId;
}

/**
 * Run `fn` with tenant scoping switched off.
 *
 * Reserved for work that is genuinely not on behalf of one store: resolving a
 * login by email, the super admin dashboard counting across the platform, a
 * migration. Every call site is a deliberate decision to cross the boundary, so
 * they are easy to find and to review -- which is the point of making it
 * explicit rather than a flag someone can leave on.
 *
 * `await fn()` rather than passing `fn` straight to `storage.run`, and this is
 * not a stylistic choice. A Prisma call returns a lazy PrismaPromise: nothing
 * executes until something subscribes to it. Handing the promise back
 * unawaited would end this context first and run the query outside it -- so
 * `runUnscoped(() => prisma.tenant.findMany())`, the most natural way to write
 * a call site, would silently do nothing at all. Awaiting here means the
 * subscription happens while the context is still open, and both the terse and
 * the async-block forms behave the same.
 */
export function runUnscoped<T>(fn: () => Promise<T> | T): Promise<T> {
  const next: TenantContext = { ...getTenantContext(), mode: 'UNSCOPED', tenantId: null };
  return storage.run(next, async () => await fn());
}

/**
 * Run `fn` as if the caller were a member of `tenantId`.
 *
 * How the super admin reads a single store (provisioning, per-tenant stats) and
 * how cron jobs sweep every store in turn: one tenant at a time, through the
 * exact same scoping the tenant itself gets, instead of a bespoke unscoped
 * query that could quietly drift out of step.
 */
export function runAsTenant<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
  const next: TenantContext = { ...getTenantContext(), mode: 'TENANT', tenantId };
  return storage.run(next, async () => await fn());
}
