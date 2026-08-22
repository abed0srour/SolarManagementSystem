import { NextRequest, NextResponse } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { claimsFromToken, homeRouteFor, isSuperAdmin } from './lib/claims';

/**
 * Route guarding and role-based redirection.
 *
 * Two jobs, in this order:
 *
 *  1. Refresh the Supabase session so a long-lived tab never lands on a page
 *     with an expired token.
 *  2. Decide, from the claims already in that token, whether this account
 *     belongs on this route — no database query, so it costs nothing per
 *     navigation.
 *
 * This is a UX gate, not the security boundary. The claims are decoded without
 * verifying the signature, so a forged cookie can get past it — and gets an
 * empty shell, because every `/api/*` call is independently verified by the
 * NestJS guard and every direct Supabase query by RLS. Authorization is
 * enforced where the data is, never here.
 */

/** Reachable without a session. */
const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password', '/auth/callback'];

const isPublic = (pathname: string) =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { response, accessToken } = await updateSession(request);
  const claims = claimsFromToken(accessToken);

  const redirect = (to: string, keepNext = false) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = '';
    if (keepNext) url.searchParams.set('next', `${pathname}${search}`);
    // Carry the refreshed cookies onto the redirect, or the very next request
    // arrives with the stale token this middleware just replaced.
    const res = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) res.cookies.set(cookie);
    return res;
  };

  /*
   * /reset-password is deliberately reachable while signed in. Clicking a
   * recovery link signs the user in with a temporary session first, so treating
   * it as "already authenticated, go to the dashboard" would bounce them off
   * the page before they could set a new password.
   */
  if (isPublic(pathname)) {
    if (claims && pathname === '/login') return redirect(homeRouteFor(claims));
    return response;
  }

  if (!claims) return redirect('/login', true);

  const wantsPlatform = pathname === '/superadmin' || pathname.startsWith('/superadmin/');

  if (wantsPlatform && !isSuperAdmin(claims)) {
    // A store user has no business on the platform portal. Sent to their own
    // dashboard rather than /login: they are signed in, just not for this.
    return redirect('/dashboard');
  }

  if (!wantsPlatform && isSuperAdmin(claims)) {
    /*
     * And the reverse. The platform owner has no tenant, so a store page would
     * have nothing to render and the API would refuse every request behind it.
     * Redirecting is clearer than showing a dashboard full of errors.
     */
    return redirect('/superadmin/dashboard');
  }

  // A tenant user whose store has been suspended keeps a valid token until it
  // expires. Stop them at the door rather than letting every panel fail.
  if (!isSuperAdmin(claims) && !['ACTIVE', 'UNKNOWN'].includes(claims.tenantStatus)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?reason=${claims.tenantStatus === 'SUSPENDED' ? 'suspended' : 'inactive'}`;
    const res = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) res.cookies.set(cookie);
    return res;
  }

  return response;
}

export const config = {
  /*
   * Everything except:
   *  - /api/*      proxied to NestJS, which guards itself
   *  - _next/*     build output and HMR
   *  - static assets and metadata files
   */
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
