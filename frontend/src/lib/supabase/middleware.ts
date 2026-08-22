import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Refresh the Supabase session and hand back both the response carrying the
 * updated cookies and the access token that goes with them.
 *
 * `getUser()` rather than `getSession()` on purpose: it revalidates the token
 * with the auth server, which is what makes a refresh actually happen here
 * instead of silently expiring mid-navigation. The cookies it sets have to be
 * written onto a real response object, which is why this lives in middleware —
 * a Server Component cannot do it.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  accessToken: string | null;
}> {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { response, accessToken: null };
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });

    await supabase.auth.getUser();
    const { data } = await supabase.auth.getSession();

    return { response, accessToken: data.session?.access_token ?? null };
  } catch {
    return { response, accessToken: null };
  }
}
