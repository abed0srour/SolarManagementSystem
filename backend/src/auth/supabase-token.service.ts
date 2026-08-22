import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { normaliseClaims, SupabaseClaims } from './supabase-claims';

/**
 * Verifies Supabase access tokens.
 *
 * Supabase signs with one of two schemes depending on the project's age and
 * settings: a shared HS256 secret, or an asymmetric key published at the
 * project's JWKS endpoint. Both are supported here because a project can be
 * switched from one to the other at any time, and an API that only understood
 * one would start rejecting every request the moment someone rotated to signing
 * keys in the dashboard.
 *
 * Configuration:
 *   SUPABASE_URL          - required; the project (or local stack) URL
 *   SUPABASE_JWT_SECRET   - the legacy HS256 secret, if the project uses one
 *
 * With neither secret set, verification falls back to JWKS alone.
 */
@Injectable()
export class SupabaseTokenService {
  private readonly logger = new Logger(SupabaseTokenService.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private secret?: Uint8Array;

  constructor() {
    const raw = process.env.SUPABASE_JWT_SECRET;
    if (raw) this.secret = new TextEncoder().encode(raw);
    const url = process.env.SUPABASE_URL;
    if (url) this.jwks = createRemoteJWKSet(new URL(`${url.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`));
    if (!raw && !url) {
      this.logger.error('Neither SUPABASE_JWT_SECRET nor SUPABASE_URL is set — every request will be rejected.');
    }
  }

  async verify(token: string): Promise<SupabaseClaims> {
    const payload = await this.verifySignature(token);
    const claims = normaliseClaims(payload as Record<string, any>);

    if (!claims.sub) throw new UnauthorizedException('Token carries no subject');
    if (claims.is_active === false) throw new UnauthorizedException('This account has been deactivated');

    // A suspended store must stop working the moment it is suspended, not
    // whenever the token happens to expire. The super admin endpoints also
    // revoke sessions on suspend; this is the belt to that pair of braces.
    if (claims.role !== 'super_admin') {
      if (!claims.tenant_id) throw new UnauthorizedException('This account is not attached to a store');
      if (claims.tenant_status && !['ACTIVE', 'UNKNOWN'].includes(claims.tenant_status)) {
        throw new UnauthorizedException(
          claims.tenant_status === 'SUSPENDED'
            ? 'This store has been suspended. Contact the platform administrator.'
            : 'This store is no longer active.',
        );
      }
    }

    return claims;
  }

  private async verifySignature(token: string): Promise<JWTPayload> {
    const header = this.decodeHeader(token);

    // Asymmetric tokens name a key id; symmetric ones do not.
    if (header?.kid && this.jwks) {
      try {
        const { payload } = await jwtVerify(token, this.jwks);
        return payload;
      } catch (err: any) {
        throw new UnauthorizedException(`Invalid or expired token: ${err.code ?? err.message}`);
      }
    }

    if (this.secret) {
      try {
        const { payload } = await jwtVerify(token, this.secret);
        return payload;
      } catch (err: any) {
        throw new UnauthorizedException(`Invalid or expired token: ${err.code ?? err.message}`);
      }
    }

    if (this.jwks) {
      try {
        const { payload } = await jwtVerify(token, this.jwks);
        return payload;
      } catch (err: any) {
        throw new UnauthorizedException(`Invalid or expired token: ${err.code ?? err.message}`);
      }
    }

    throw new UnauthorizedException('Token verification is not configured on this server');
  }

  private decodeHeader(token: string): Record<string, any> | null {
    const part = token.split('.')[0];
    if (!part) return null;
    try {
      return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }
}
