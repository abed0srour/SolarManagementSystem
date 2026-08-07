import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from './lib/auth';

/**
 * Redirects unauthenticated visitors to /login before any dashboard route
 * renders, and bounces already-authenticated ones away from /login.
 *
 * This is a UX gate, not the security boundary. The cookie it reads is set by
 * client-side JS and is therefore forgeable; forging it buys nothing but an
 * empty shell, because every `/api/*` request is independently verified by the
 * NestJS JwtAuthGuard. Never rely on this to protect data.
 *
 * Note on expiry: a present-but-expired token is deliberately allowed through.
 * The 30-day "remember me" cookie routinely outlives the 12-hour access token,
 * so redirecting on `exp` would break exactly the persistence the checkbox
 * promises. The axios interceptor silently refreshes on the first 401, and
 * sends the admin to /login only if that refresh fails.
 */

const PUBLIC_PATHS = ['/login'];

type JwtClaims = { exp?: number; sub?: string };

/** Decode a JWT payload without verifying it — signature checks happen server-side. */
function decodeClaims(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as JwtClaims;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  // A structurally valid JWT is the signal; expiry is handled client-side.
  const hasSession = Boolean(raw && decodeClaims(decodeURIComponent(raw))?.sub);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // Preserve the destination so login can return the admin to it.
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (hasSession && isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Everything except:
   *  - /api/*      proxied to NestJS, which guards itself
   *  - _next/*     build output and HMR
   *  - static assets and metadata files
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
