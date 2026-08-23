import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { pathToFileURL } from 'node:url';
import { normaliseClaims, SupabaseClaims } from './supabase-claims';

type Jose = typeof import('jose');
type JWTPayload = import('jose').JWTPayload;
type JWKS = ReturnType<Jose['createRemoteJWKSet']>;

/**
 * `jose` is published as ESM only, and this project compiles to CommonJS, so a
 * plain `import ... from 'jose'` becomes `require()` and throws
 * ERR_REQUIRE_ESM the first time a request touches this service. TypeScript
 * also rewrites a literal `await import()` into `require()` under
 * `module: commonjs`, so the import goes through `new Function` to keep a
 * genuine dynamic import in the emitted JavaScript.
 *
 * The specifier has to be an absolute file URL rather than the bare name
 * "jose": code inside `new Function` carries no module context, so a bare
 * specifier has no `node_modules` to resolve against and fails with
 * ERR_MODULE_NOT_FOUND. `require.resolve` still locates the file happily -- it
 * only refuses to *execute* ESM -- so it supplies the path.
 *
 * The types above come in via `import type` syntax, which is erased at compile
 * time and so emits no require of its own.
 */
const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<Jose>;

let cached: Promise<Jose> | undefined;
const loadJose = (): Promise<Jose> =>
  (cached ??= importModule(pathToFileURL(require.resolve('jose')).href));

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
  private jwksUrl?: URL;
  private jwks?: JWKS;
  private secret?: Uint8Array;

  constructor() {
    const raw = process.env.SUPABASE_JWT_SECRET;
    if (raw) this.secret = new TextEncoder().encode(raw);
    const url = process.env.SUPABASE_URL;
    // Only the URL is built here. Constructing the key set needs `jose` itself,
    // which can only be loaded asynchronously, so that is deferred to first use.
    if (url) this.jwksUrl = new URL(`${url.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`);
    if (!raw && !url) {
      this.logger.error('Neither SUPABASE_JWT_SECRET nor SUPABASE_URL is set - every request will be rejected.');
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

  /** The remote key set, built once and reused; undefined when no URL is set. */
  private async getJwks(): Promise<JWKS | undefined> {
    if (!this.jwksUrl) return undefined;
    if (!this.jwks) {
      const { createRemoteJWKSet } = await loadJose();
      this.jwks = createRemoteJWKSet(this.jwksUrl);
    }
    return this.jwks;
  }

  private async verifySignature(token: string): Promise<JWTPayload> {
    const { jwtVerify } = await loadJose();
    const header = this.decodeHeader(token);
    const jwks = await this.getJwks();

    // Asymmetric tokens name a key id; symmetric ones do not.
    if (header?.kid && jwks) {
      try {
        const { payload } = await jwtVerify(token, jwks);
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

    if (jwks) {
      try {
        const { payload } = await jwtVerify(token, jwks);
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
