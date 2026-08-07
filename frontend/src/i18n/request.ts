import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Load the message catalogue for a locale.
 *
 * In development the file is read from disk on every request. `import()` caches
 * the parsed JSON in the module registry, and editing a `.json` does not
 * reliably invalidate it — so newly added keys kept rendering as
 * MISSING_MESSAGE until the dev server was restarted. Reading the file directly
 * costs one small fs call per request, which is irrelevant locally and buys
 * translations that appear on a plain refresh.
 *
 * Production keeps the static import so the catalogue is bundled and there is
 * no filesystem access at runtime.
 */
async function loadMessages(locale: Locale) {
  if (process.env.NODE_ENV === 'development') {
    try {
      const file = path.join(process.cwd(), 'src', 'i18n', 'messages', `${locale}.json`);
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      // Fall through to the bundled copy if the path ever stops matching.
    }
  }
  return (await import(`./messages/${locale}.json`)).default;
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get('locale')?.value;
  const locale: Locale = cookieLocale === 'ar' ? 'ar' : 'en';
  return {
    locale,
    messages: await loadMessages(locale),
  };
});
