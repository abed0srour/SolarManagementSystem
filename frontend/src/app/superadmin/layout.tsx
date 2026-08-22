'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Building2, LayoutDashboard, LogOut, Moon, Sun, Languages, ShieldCheck, User } from 'lucide-react';
import { getClaims, signOut } from '../../lib/auth';
import { SessionClaims } from '../../lib/claims';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

const NAV = [
  { key: 'dashboard', href: '/superadmin/dashboard', icon: LayoutDashboard },
  { key: 'tenants', href: '/superadmin/tenants', icon: Building2 },
];

function switchLocale() {
  const current = document.cookie.includes('locale=ar') ? 'ar' : 'en';
  document.cookie = `locale=${current === 'ar' ? 'en' : 'ar'};path=/;max-age=31536000`;
  window.location.reload();
}

/**
 * The platform portal shell.
 *
 * Deliberately its own layout rather than a section of the store dashboard.
 * The two have nothing in common: no store branding, no notifications, none of
 * the business navigation — because the super admin has no store and every one
 * of those panels would be empty or wrong. Keeping them apart also means the
 * store layout never has to grow "unless the user is a super admin" branches.
 */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [claims, setClaims] = useState<SessionClaims | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Middleware already turned away anyone who does not belong here; this is
    // the in-tab fallback for a session cleared after the page was served.
    getClaims().then((c) => {
      if (!c) {
        router.replace('/login');
        return;
      }
      if (c.role !== 'super_admin') {
        router.replace('/dashboard');
        return;
      }
      setClaims(c);
      setReady(true);
    });
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col gap-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    );
  }

  const logout = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4">
          <div className="flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">{t('superadmin.portal')}</span>
          </div>

          <nav className="ms-2 flex items-center gap-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                    active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{t(`superadmin.nav.${item.key}`)}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          <Button variant="ghost" size="icon" onClick={switchLocale} title={t('common.language')}>
            <Languages />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={t('common.theme')}
          >
            <Sun className="hidden dark:block" />
            <Moon className="dark:hidden" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <User className="h-4 w-4" />
                </span>
                <span className="hidden text-sm sm:block">{claims?.email}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('superadmin.platformOwner')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/superadmin/account')}>
                <User /> {t('auth.profile')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout}>
                <LogOut /> {t('auth.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
