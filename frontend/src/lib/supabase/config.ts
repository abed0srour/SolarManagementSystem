/**
 * The Supabase URL and publishable key, resolved once for every entry point
 * (browser client, server client, middleware).
 *
 * Deliberately not a `'use client'` module: the server client imports this too,
 * and anything marked `'use client'` becomes a client reference when a Server
 * Component imports it, so the function would no longer be callable there.
 *
 * These are `NEXT_PUBLIC_`, so their values are inlined into the bundle at
 * BUILD time — a deployment built without them cannot pick them up later.
 *
 * Falling back to the local stack is right in development and actively harmful
 * in production: the deployed bundle would carry `127.0.0.1:54321`, every
 * visitor's browser would try to reach a Supabase on its own machine, and the
 * only symptom is `TypeError: Failed to fetch` at sign-in. Better to say what
 * is actually wrong.
 */
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export function supabaseConfig(): [url: string, anonKey: string] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) return [url, anonKey];

  if (process.env.NODE_ENV === 'development') {
    return [url ?? LOCAL_URL, anonKey ?? LOCAL_ANON_KEY];
  }

  throw new Error(
    'Supabase is not configured for this build. Set NEXT_PUBLIC_SUPABASE_URL and ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY in the Vercel project, then redeploy — these are ' +
      'baked in at build time, so changing them without a rebuild has no effect.',
  );
}
