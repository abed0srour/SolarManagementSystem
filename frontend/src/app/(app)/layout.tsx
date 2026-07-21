'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  SunMedium, LayoutDashboard, BarChart3, Package, FolderTree, Warehouse as WarehouseIcon,
  Users, FileText, ShoppingCart, Receipt, CreditCard, RotateCcw, Truck, PackagePlus,
  ShieldCheck, Wrench, Settings, History, Bell, LogOut, Menu, X, Moon, Sun, Languages,
  ChevronRight, User, HardHat, Activity, Calculator, Wallet,
} from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

const NAV: { group: string; items: { key: string; href: string; icon: React.ElementType }[] }[] = [
  {
    group: 'overview',
    items: [
      { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
      { key: 'reports', href: '/reports', icon: BarChart3 },
    ],
  },
  {
    group: 'catalog',
    items: [
      { key: 'products', href: '/products', icon: Package },
      { key: 'categories', href: '/categories', icon: FolderTree },
      { key: 'inventory', href: '/inventory', icon: WarehouseIcon },
    ],
  },
  {
    group: 'sales',
    items: [
      { key: 'clients', href: '/clients', icon: Users },
      { key: 'quotations', href: '/quotations', icon: FileText },
      { key: 'salesOrders', href: '/sales-orders', icon: ShoppingCart },
      { key: 'payments', href: '/payments', icon: CreditCard },
      { key: 'receipts', href: '/receipts', icon: Receipt },
      { key: 'refunds', href: '/refunds', icon: RotateCcw },
    ],
  },
  {
    group: 'purchasing',
    items: [
      { key: 'suppliers', href: '/suppliers', icon: Truck },
      { key: 'purchaseOrders', href: '/purchase-orders', icon: PackagePlus },
      { key: 'expenses', href: '/expenses', icon: Wallet },
    ],
  },
  {
    group: 'solar',
    items: [
      { key: 'installations', href: '/installations', icon: HardHat },
      { key: 'monitoring', href: '/monitoring', icon: Activity },
      { key: 'calculator', href: '/calculator', icon: Calculator },
    ],
  },
  {
    group: 'afterSales',
    items: [
      { key: 'warranty', href: '/warranty', icon: ShieldCheck },
      { key: 'serviceJobs', href: '/service-jobs', icon: Wrench },
    ],
  },
  {
    group: 'system',
    items: [
      { key: 'settings', href: '/settings', icon: Settings },
      { key: 'auditLog', href: '/audit', icon: History },
    ],
  },
];

function switchLocale() {
  const current = document.cookie.includes('locale=ar') ? 'ar' : 'en';
  document.cookie = `locale=${current === 'ar' ? 'en' : 'ar'};path=/;max-age=31536000`;
  window.location.reload();
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [userName, setUserName] = useState('');
  const [company, setCompany] = useState<any>({});

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setUserName(JSON.parse(localStorage.getItem('user') ?? '{}')?.name ?? '');
    setReady(true);
    // Branding (store name, tagline, logo) comes from the admin settings.
    api.get('/settings').then((r) => {
      const c = r.data.company ?? {};
      setCompany(c);
      if (c.logoUrl) {
        let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = c.logoUrl;
      }
      if (c.name) document.title = c.name;
    }).catch(() => {});
    const load = () =>
      api
        .get('/notifications', { params: { unreadOnly: 'true', pageSize: 12 } })
        .then((r) => {
          setUnread(r.data.unread);
          setNotifs(r.data.items);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [router]);

  if (!ready)
    return (
      <div className="flex min-h-screen flex-col gap-4 p-6">
        <Skeleton className="h-10 w-full" />
        <div className="flex gap-4">
          <Skeleton className="hidden h-[80vh] w-56 md:block" />
          <Skeleton className="h-[80vh] flex-1" />
        </div>
      </div>
    );

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    api.post('/auth/logout', { refreshToken }).catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    router.replace('/login');
  };

  const activeItem = NAV.flatMap((s) => s.items).find((i) => pathname.startsWith(i.href));

  const sidebar = (
    <nav className="flex h-full flex-col overflow-y-auto border-e bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded object-contain" />
        ) : (
          <SunMedium className="h-6 w-6 text-amber-500" />
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-bold leading-tight">{company.name || t('app.title')}</div>
          <div className="truncate text-[11px] text-muted-foreground">{company.tagline || t('app.subtitle')}</div>
        </div>
      </div>
      <div className="flex-1 space-y-4 p-3">
        {NAV.map((section) => (
          <div key={section.group}>
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t(`nav.${section.group}`)}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                      active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {t(`nav.${item.key}`)}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 start-0 z-30 hidden w-60 md:block">{sidebar}</aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64 bg-card shadow-xl">
            <button className="absolute end-2 top-3 z-10 rounded-md p-1.5 hover:bg-accent" onClick={() => setMobileOpen(false)}>
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col md:ms-60">
        {/* Navbar */}
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          {/* Breadcrumbs */}
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
              {t('common.home')}
            </Link>
            {activeItem && pathname === activeItem.href && (
              <>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                <span className="truncate font-medium">{t(`nav.${activeItem.key}`)}</span>
              </>
            )}
            {activeItem && pathname !== activeItem.href && (
              <>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                <Link href={activeItem.href} className="truncate text-muted-foreground hover:text-foreground">
                  {t(`nav.${activeItem.key}`)}
                </Link>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                <span className="truncate font-medium">
                  {pathname.endsWith('/orders') ? t('clients.ordersCrumb') : pathname.endsWith('/refund') ? t('refunds.newRefund') : t('common.details')}
                </span>
              </>
            )}
          </div>
          <div className="flex-1" />
          {/* Language */}
          <Button variant="ghost" size="icon" onClick={switchLocale} title={t('common.language')}>
            <Languages />
          </Button>
          {/* Theme */}
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={t('common.theme')}>
            <Sun className="hidden dark:block" />
            <Moon className="dark:hidden" />
          </Button>
          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell />
                {unread > 0 && (
                  <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-96 max-w-[90vw]">
              <DropdownMenuLabel>{t('nav.dashboard') === 'Dashboard' ? 'Notifications' : 'الإشعارات'}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifs.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">{t('common.noRecords')}</div>}
              {notifs.map((n) => (
                <DropdownMenuItem
                  key={n.id}
                  className="whitespace-normal"
                  onClick={() => {
                    api.post(`/notifications/${n.id}/read`).then(() => {
                      setNotifs((p) => p.filter((x) => x.id !== n.id));
                      setUnread((u) => Math.max(0, u - 1));
                    });
                  }}
                >
                  <span className="text-xs leading-relaxed">{n.message}</span>
                </DropdownMenuItem>
              ))}
              {notifs.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      api.post('/notifications/read-all').then(() => {
                        setNotifs([]);
                        setUnread(0);
                      });
                    }}
                  >
                    <span className="text-xs font-medium text-primary">✓ {t('common.close')}</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <User className="h-4 w-4" />
                </span>
                <span className="hidden text-sm sm:block">{userName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{userName}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/settings?tab=security')}>
                <Settings /> {t('nav.settings')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout}>
                <LogOut /> {t('auth.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
