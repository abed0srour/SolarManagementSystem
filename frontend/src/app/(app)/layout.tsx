'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  LayoutDashboard, BarChart3, Package, FolderTree, Warehouse as WarehouseIcon,
  Users, FileText, ShoppingCart, Receipt, CreditCard, RotateCcw, Truck, PackagePlus,
  ShieldCheck, Wrench, Settings, History, Bell, LogOut, Menu, X, Moon, Sun, Languages,
  ChevronRight, ChevronDown, User, HardHat, Activity, Calculator, Wallet, RefreshCw, Palette, PackageCheck, QrCode, Undo2, PackageSearch,
  Check, CheckCheck, Trash2, ShoppingBag, ShieldAlert, UsersRound, DollarSign,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { getClaims, signOut } from '../../lib/auth';
import { clearCache, readCache, refreshAllCaches, writeCache } from '../../lib/cache';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import DailyCsvBackup from '../../components/daily-csv-backup';
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
      { key: 'serials', href: '/serials', icon: QrCode },
    ],
  },
  {
    group: 'sales',
    items: [
      { key: 'clients', href: '/clients', icon: Users },
      { key: 'quotations', href: '/quotations', icon: FileText },
      { key: 'salesOrders', href: '/sales-orders', icon: ShoppingCart },
      { key: 'invoices', href: '/invoices', icon: Receipt },
      { key: 'payments', href: '/payments', icon: DollarSign },
      { key: 'refunds', href: '/refunds', icon: RotateCcw },
      { key: 'productBuyers', href: '/product-buyers', icon: UsersRound },
    ],
  },
  {
    group: 'purchasing',
    items: [
      { key: 'suppliers', href: '/suppliers', icon: Truck },
      { key: 'purchaseOrders', href: '/purchase-orders', icon: ShoppingBag },
      { key: 'purchaseReturns', href: '/purchase-returns', icon: Undo2 },
      { key: 'expenses', href: '/expenses', icon: CreditCard },
    ],
  },
  {
    group: 'afterSales',
    items: [
      { key: 'warranty', href: '/warranty', icon: ShieldAlert },
      { key: 'serviceJobs', href: '/service-jobs', icon: Wrench },
    ],
  },
  {
    group: 'system',
    items: [
      { key: 'workers', href: '/workers', icon: HardHat },
      { key: 'settings', href: '/settings', icon: Settings },
      { key: 'themes', href: '/settings/themes', icon: Palette },
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
  const [notifOpen, setNotifOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [userName, setUserName] = useState('');
  const [company, setCompany] = useState<any>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('sidebar_collapsed_sections');
        if (stored) setCollapsedSections(JSON.parse(stored));
      } catch {}
    }
  }, []);

  const toggleSection = (group: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [group]: !prev[group] };
      try {
        localStorage.setItem('sidebar_collapsed_sections', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    // Middleware already turned anonymous visitors away; this is the in-tab
    // fallback for a session cleared after the page was served.
    getClaims().then((claims) => {
      if (!claims) {
        router.replace('/login');
        return;
      }
      // The platform owner has no store, so none of this shell applies to them.
      if (claims.role === 'super_admin') {
        router.replace('/superadmin/dashboard');
        return;
      }
      setUserName(claims.fullName || claims.email || '');
      setReady(true);
      // Fetch full profile to display Full Name in top navbar
      api
        .get('/profile')
        .then((res) => {
          if (res.data?.fullName) {
            setUserName(res.data.fullName);
          }
        })
        .catch(() => {});
    });
    // Branding (store name, tagline, logo) comes from the admin settings.
    // Painted from cache first so the header never flashes empty, then
    // revalidated in the background.
    // The store's name and logo belong in the header, not in the browser tab.
    // Overwriting the tab left every window claiming to be whichever store was
    // signed in, with that store's logo standing in for the product's own, so
    // the tab said nothing about which application it was.
    const applyBranding = (c: any) => {
      setCompany(c);
    };
    const cachedSettings = readCache<any>('settings');
    if (cachedSettings) applyBranding(cachedSettings.data?.company ?? {});
    api
      .get('/settings')
      .then((r) => {
        writeCache('settings', r.data);
        applyBranding(r.data.company ?? {});
      })
      .catch(() => {});
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

  /*
   * Longest match wins. A plain `startsWith` would light up both Settings and
   * Themes on /settings/themes, since one route is a prefix of the other.
   */
  const activeHref = NAV.flatMap((s) => s.items)
    .map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  const activeItem = NAV.flatMap((s) => s.items).find((i) => i.href === activeHref);

  // Auto-expand the section containing the active route
  useEffect(() => {
    if (
      pathname === '/installations' ||
      pathname.startsWith('/installations/') ||
      pathname === '/monitoring' ||
      pathname.startsWith('/monitoring/') ||
      pathname === '/calculator' ||
      pathname.startsWith('/calculator/')
    ) {
      router.replace('/dashboard');
      return;
    }

    if (!activeHref) return;
    const activeSection = NAV.find((s) => s.items.some((i) => i.href === activeHref));
    if (!activeSection) return;
    setCollapsedSections((prev) => {
      if (!prev || !prev[activeSection.group]) return prev;
      const next = { ...prev, [activeSection.group]: false };
      try {
        localStorage.setItem('sidebar_collapsed_sections', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [activeHref, pathname, router]);

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
    await signOut();
    /*
     * Cached business data outlives the session otherwise — and under
     * multi-tenancy that is no longer merely stale. On a shared machine the
     * next person to sign in would briefly see the previous store's numbers
     * painted from cache before the first fetch returned.
     */
    clearCache();
    router.replace('/login');
  };

  const sidebar = (
    <nav className="flex h-full flex-col overflow-y-auto border-e bg-card">
      <div className="flex min-h-16 items-center border-b px-6 py-3">
        <div className="min-w-0 w-full">
          <div className="truncate text-base font-bold leading-tight tracking-tight text-foreground">{company.name || t('app.title')}</div>
          {company.tagline && (
            <div className="truncate text-xs text-muted-foreground mt-0.5">{company.tagline}</div>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-2 p-3">
        {NAV.map((section) => {
          const isCollapsed = Boolean(collapsedSections[section.group]);
          const hasActiveChild = section.items.some((i) => i.href === activeHref);

          return (
            <div key={section.group} className="select-none">
              <button
                type="button"
                onClick={() => toggleSection(section.group)}
                className="group/section flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{t(`nav.${section.group}`)}</span>
                  {isCollapsed && hasActiveChild && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-hover/section:text-foreground rtl:rotate-180',
                    isCollapsed ? '-rotate-90 rtl:rotate-90' : 'rotate-0'
                  )}
                />
              </button>

              <div
                className={cn(
                  'space-y-0.5 overflow-hidden transition-all duration-200',
                  isCollapsed ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-96 opacity-100 mt-0.5'
                )}
              >
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.href === activeHref;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => {
                        setMobileOpen(false);
                        router.push(item.href);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm transition-colors',
                        active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t(`nav.${item.key}`)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Renders nothing; pulls a CSV copy of the database once a day. */}
      <DailyCsvBackup />
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
          <Button variant="ghost" size="icon" className="shrink-0 md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          {/* Breadcrumbs */}
          <div className="flex min-w-0 items-center gap-1.5 text-xs sm:text-sm">
            <Link href="/dashboard" className="hidden sm:inline text-muted-foreground hover:text-foreground">
              {t('common.home')}
            </Link>
            {activeItem && pathname === activeItem.href && (
              <>
                <ChevronRight className="hidden sm:inline h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                <span className="truncate font-semibold text-foreground sm:font-medium">{t(`nav.${activeItem.key}`)}</span>
              </>
            )}
            {activeItem && pathname !== activeItem.href && (
              <>
                <ChevronRight className="hidden sm:inline h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                <Link href={activeItem.href} className="truncate text-muted-foreground hover:text-foreground">
                  {t(`nav.${activeItem.key}`)}
                </Link>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                <span className="truncate font-semibold text-foreground sm:font-medium">
                  {pathname.endsWith('/orders') ? t('clients.ordersCrumb') : pathname.endsWith('/refund') ? t('refunds.newRefund') : t('common.details')}
                </span>
              </>
            )}
          </div>
          <div className="flex-1" />
          {/* Sync now — drops every cached module and refetches from the database */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex shrink-0"
            title={t('common.syncNow')}
            onClick={() => {
              refreshAllCaches();
              toast.success(t('common.syncing'));
            }}
          >
            <RefreshCw />
          </Button>
          {/* Language */}
          <Button variant="ghost" size="icon" className="shrink-0" onClick={switchLocale} title={t('common.language')}>
            <Languages />
          </Button>
          {/* Theme */}
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={t('common.theme')}>
            <Sun className="hidden dark:block" />
            <Moon className="dark:hidden" />
          </Button>
          {/* Notifications */}
          <DropdownMenu open={notifOpen} onOpenChange={setNotifOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 relative">
                <Bell />
                {unread > 0 && (
                  <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-96 max-w-[90vw] p-0 overflow-hidden shadow-lg">
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">
                    {t('nav.dashboard') === 'Dashboard' ? 'Notifications' : 'الإشعارات'}
                  </span>
                  {unread > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-border/50">
                {notifs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                    {t('common.noRecords')}
                  </div>
                ) : (
                  notifs.map((n) => (
                    <div
                      key={n.id}
                      className="group flex items-start justify-between gap-2.5 p-3 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-xs leading-relaxed text-foreground break-words block">{n.message}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 shrink-0">
                        <button
                          type="button"
                          title={t('common.seen')}
                          className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            api.post(`/notifications/${n.id}/read`).then(() => {
                              setNotifs((p) => p.filter((x) => x.id !== n.id));
                              setUnread((u) => Math.max(0, u - 1));
                            });
                          }}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title={t('common.clear')}
                          className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            api.delete(`/notifications/${n.id}`).then(() => {
                              setNotifs((p) => p.filter((x) => x.id !== n.id));
                              setUnread((u) => Math.max(0, u - 1));
                            });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between gap-2 p-2 border-t border-border bg-muted/25">
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={notifs.length === 0}
                    className="h-7 text-xs px-2.5 gap-1 hover:text-primary hover:bg-primary/10"
                    onClick={() => {
                      api.post('/notifications/read-all').then(() => {
                        setNotifs([]);
                        setUnread(0);
                      });
                    }}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    <span>{t('common.seen')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={notifs.length === 0}
                    className="h-7 text-xs px-2.5 gap-1 hover:text-destructive hover:border-destructive/30 hover:bg-destructive/10"
                    onClick={() => {
                      api.delete('/notifications/clear-all').then(() => {
                        setNotifs([]);
                        setUnread(0);
                      });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t('common.clear')}</span>
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2.5 gap-1"
                  onClick={() => setNotifOpen(false)}
                >
                  <X className="h-3.5 w-3.5" />
                  <span>{t('common.close')}</span>
                </Button>
              </div>
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
              <DropdownMenuItem onClick={() => router.push('/profile')}>
                <User /> {t('auth.profile')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/settings')}>
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
