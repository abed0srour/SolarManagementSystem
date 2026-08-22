'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The browser's Supabase client.
 *
 * `createBrowserClient` stores the session in cookies rather than
 * localStorage, which is the whole reason for using `@supabase/ssr` here: the
 * Next.js middleware runs on the edge and can only see cookies, so this is what
 * lets a route be guarded before the page is ever sent.
 *
 * Only the publishable key is used. It is safe in a browser by design — it can
 * do nothing that Row Level Security does not allow. The service role key must
 * never appear in this file or any other under `src/`.
 */
let client: SupabaseClient | undefined;

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
    client = createBrowserClient(url, anonKey);
  }
  return client;
}
