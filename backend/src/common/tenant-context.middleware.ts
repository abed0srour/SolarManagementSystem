import { NextFunction, Request, Response } from 'express';
import { runWithTenantContext } from './tenant-context';

/**
 * Opens an empty tenant context around the whole request.
 *
 * Express middleware is the right layer for this, and a Nest interceptor is
 * not: the rest of the request -- guards, pipes, the controller, every service
 * -- runs inside this `next()` call, so anything it awaits stays inside the
 * same AsyncLocalStorage context. A Nest interceptor returns an Observable that
 * is subscribed to after its own function has returned, which would drop the
 * context exactly where it is needed.
 *
 * Registered with `app.use()` in `bootstrap.ts` rather than through
 * `MiddlewareConsumer`. It has no dependencies to inject, and this way it wraps
 * every request unconditionally -- including ones Nest does not route -- with
 * no wildcard path pattern to keep in step with the router.
 *
 * The context starts empty. `JwtAuthGuard` fills in the tenant once it has
 * actually verified the token.
 */
export function tenantContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  runWithTenantContext(() => next());
}
