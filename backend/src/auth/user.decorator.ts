import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Fine-grained application role: SUPER_ADMIN | ADMIN | MANAGER | STAFF | VIEWER. */
  role: string;
  /** Coarse tier from the token: 'super_admin' | 'tenant_admin' | 'staff'. */
  profileRole: string;
  /** The store this account belongs to. Null only for the super admin. */
  tenantId: string | null;
  tenantName: string | null;
  /** Effective module permissions, resolved when the token was issued. */
  permissions: string[];
}

export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
