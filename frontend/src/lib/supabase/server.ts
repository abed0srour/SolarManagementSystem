import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * The `setAll` catch is not laziness: a Server Component is not allowed to
 * write cookies, and Supabase will still try when it decides a token is due for
 * refresh. Swallowing it there is correct because the middleware refreshes the
 * session on every request anyway — that is the one place with a real response
 * to attach the new cookies to.
 */
export async function supabaseServer() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            /* read-only cookie store (Server Component) — middleware handles the refresh */
          }
        },
      },
    },
  );
}
