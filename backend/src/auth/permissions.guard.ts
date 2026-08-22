import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SUPER_ADMIN_ONLY_KEY } from './super-admin.decorator';
import { isAlwaysAllowedRoute, isPlatformRoute, requiredPermission } from './permissions';

/**
 * Enforces the two-tier access model on every request, using the route itself
 * to decide what is needed. Runs after JwtAuthGuard, so `request.user` is
 * already populated from the verified token.
 *
 * An unmapped route is denied rather than allowed. That is the whole point of
 * deriving the requirement from the path: forgetting to classify a new endpoint
 * produces a loud 403 in development instead of a quietly open hole in
 * production.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return false; // JwtAuthGuard already rejected it

    const path = request.route?.path ?? request.path ?? request.url;
    const superAdmin = user.role === 'SUPER_ADMIN';
    const superOnly =
      this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || isPlatformRoute(path);

    if (superOnly) {
      if (!superAdmin) throw new ForbiddenException('This area is restricted to the platform administrator');
      return true;
    }

    if (superAdmin) {
      /*
       * The super admin is deliberately NOT given the run of every store.
       *
       * It would be easy to let it through here -- it is the most privileged
       * account in the system, after all. But "can create stores" and "can read
       * every store's ledger" are different powers, and merging them means a
       * single compromised platform login exposes every customer's finances at
       * once. It also has no tenant, so these queries have no correct answer:
       * they would silently span all tenants and produce meaningless totals.
       *
       * When the platform genuinely needs to act inside one store, it does so
       * explicitly through runAsTenant() on a /superadmin route.
       */
      if (isAlwaysAllowedRoute(path)) return true;
      throw new ForbiddenException(
        'The platform administrator does not have access to store data. Use the super admin dashboard.',
      );
    }

    const required = requiredPermission(request.method, path);
    if (required === null) return true;
    if (required === undefined) {
      throw new ForbiddenException('This area is not available to your role');
    }

    const granted: string[] = user.permissions ?? [];
    if (!granted.includes(required.permission)) {
      throw new ForbiddenException(`Your role does not allow this (${required.permission})`);
    }
    return true;
  }
}
