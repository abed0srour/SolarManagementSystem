import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import AccentProvider from '../components/accent-provider';
import { ACCENT_INIT_SCRIPT } from '../lib/accents';
import './globals.css';

export const metadata: Metadata = {
  title: 'Solar Store Management',
  description: 'Management system for a solar equipment retail store',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {/* Applies the saved accent before first paint, the same way next-themes
            avoids a light/dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
      </head>
      {/* suppressHydrationWarning: browser extensions inject attributes (bis_skin_checked…) before React hydrates */}
      <body suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AccentProvider>
            <NextIntlClientProvider messages={messages}>
              {children}
              <Toaster richColors position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'} />
            </NextIntlClientProvider>
          </AccentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
