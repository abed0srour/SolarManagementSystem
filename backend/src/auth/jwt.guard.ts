import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from './public.decorator';
import { effectivePermissions } from './permissions';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
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
    try {
      const payload = await this.jwtService.verifyAsync(token);
      request.user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        /*
         * Must be carried through: PermissionsGuard reads this, and omitting it
         * denies every non-super-admin request rather than failing open.
         *
         * A token issued before permissions existed has no such claim. Treating
         * that as "no permissions" would 403 every already-signed-in user until
         * their token expired, so it is resolved from the role instead — the
         * same answer the token would carry if it were issued now.
         */
        permissions: payload.permissions ?? effectivePermissions(payload.role),
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
