import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { effectivePermissions } from './permissions';
import { SupabaseTokenService } from './supabase-token.service';
import { isSuperAdmin } from './supabase-claims';
import { setTenantContext } from '../common/tenant-context';

/**
 * Verifies the Supabase access token and, just as importantly, establishes
 * which tenant the rest of the request belongs to.
 *
 * The tenant is set here rather than in middleware because middleware runs
 * before the token has been checked -- and a tenant taken from an unverified
 * token is worth nothing. `TenantContextMiddleware` opens an empty context at
 * the start of the request; this guard is what fills it in, inside the same
 * async execution context, so every query the handler goes on to make is
 * scoped without a single service having to know about it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private tokens: SupabaseTokenService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing access token');

    const claims = await this.tokens.verify(token);
    const superAdmin = isSuperAdmin(claims);

    request.user = {
      id: claims.sub,
      email: claims.email ?? '',
      name: (claims.user_metadata?.full_name as string) ?? claims.email ?? '',
      /*
       * The fine-grained role the permission system already speaks. A token
       * issued before the hook was enabled carries no app_role, so it is
       * resolved from the coarse role instead -- the same answer the token
       * would carry if it were issued now.
       */
      role: superAdmin ? 'SUPER_ADMIN' : (claims.app_role ?? 'STAFF'),
      profileRole: claims.role,
      tenantId: claims.tenant_id ?? null,
      tenantName: claims.tenant_name ?? null,
      permissions: claims.permissions?.length
        ? claims.permissions
        : effectivePermissions(superAdmin ? 'SUPER_ADMIN' : (claims.app_role ?? 'STAFF')),
    };

    setTenantContext({
      mode: claims.tenant_id ? 'TENANT' : 'NONE',
      tenantId: claims.tenant_id ?? null,
      userId: claims.sub,
      role: claims.role ?? null,
      appRole: request.user.role,
    });

    return true;
  }
}
