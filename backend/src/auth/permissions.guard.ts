import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SUPER_ADMIN_ONLY_KEY } from './super-admin.decorator';
import { requiredPermission } from './permissions';

/**
 * Enforces module permissions on every request, using the route itself to
 * decide what is needed. Runs after JwtAuthGuard, so `request.user` is already
 * populated from the token.
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

    if (user.role === 'SUPER_ADMIN') return true;

    const superOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (superOnly) throw new ForbiddenException('Only the super admin can do this');

    const required = requiredPermission(request.method, request.route?.path ?? request.path ?? request.url);
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
