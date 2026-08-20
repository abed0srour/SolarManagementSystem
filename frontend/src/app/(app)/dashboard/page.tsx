'use client';
import {
  LayoutDashboard, ChevronLeft, ChevronRight, CalendarDays, ArrowUp, ArrowDown, Minus,
  Sparkles, Layers, ShoppingBag, Users, DollarSign, TrendingUp, Package, AlertCircle,
  Clock, ArrowRight, ShieldCheck, Zap, Receipt, ExternalLink
} from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';
import { api, fmtMoney, fmtDate } from '../../../lib/api';
import { getUser } from '../../../lib/auth';
import { useLocalFirstData } from '../../../lib/use-local-storage-cache';
import { cn } from '../../../lib/utils';
import { seriesColors, statusColors, chartInk } from '../../../lib/charts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import StatusChip from '../../../components/status-chip';

/**
 * Period-over-period change indicator.
 */
function Trend({ pct, goodWhenUp = true }: { pct: number | null | undefined; goodWhenUp?: boolean }) {
  if (pct === null || pct === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums',
        good === null && 'bg-muted text-muted-foreground',
        good === true && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        good === false && 'bg-red-500/15 text-red-600 dark:text-red-400',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {flat ? '0%' : `${up ? '+' : ''}${pct.toFixed(1)}%`}
    </span>
  );
}

/**
 * Micro sparkline for KPI tiles.
 */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <div className="h-8" />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = 100 / (points.length - 1);
  const d = points.map((p, i) => `${i * step},${28 - ((p - min) / span) * 24}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-full overflow-visible" aria-hidden="true">
      <polyline points={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MiniBarSparkline({ points, color = '#f97316' }: { points: number[]; color?: string }) {
  if (!points || points.length === 0) return <div className="h-8" />;
  const max = Math.max(...points, 1);
  return (
    <div className="flex h-7 items-end gap-1">
      {points.slice(-10).map((p, i) => {
        const heightPct = Math.max(15, Math.round((p / max) * 100));
        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-all hover:opacity-80"
            style={{
              height: `${heightPct}%`,
              backgroundColor: i === points.slice(-10).length - 1 ? color : `${color}88`,
            }}
          />
        );
      })}
    </div>
  );
}

function StatTile({
  label, value, sub, pct, goodWhenUp = true, spark, color,
}: {
  label: string; value: string; sub?: string;
  pct?: number | null; goodWhenUp?: boolean; spark?: number[]; color?: string;
}) {
  return (
    <Card className="relative overflow-hidden border-border/70 shadow-sm transition-all hover:shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
          {pct !== undefined && <Trend pct={pct} goodWhenUp={goodWhenUp} />}
        </div>
        <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        {spark && spark.length > 1 && color && (
          <div className="mt-2.5">
            <Sparkline points={spark} color={color} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Granularity = 'day' | 'month' | 'year';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayIso(): string {
  return iso(new Date());
}

function periodRange(gran: Granularity, anchor: string): { from: string; to: string; label: string } {
  const d = new Date(`${anchor}T00:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth();

  if (gran === 'day') {
    return { from: anchor, to: anchor, label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) };
  }
  if (gran === 'month') {
    return {
      from: iso(new Date(y, m, 1)),
      to: iso(new Date(y, m + 1, 0)),
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  }
  return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)), label: String(y) };
}

function shift(gran: Granularity, anchor: string, dir: -1 | 1): string {
  const d = new Date(`${anchor}T00:00:00`);
  if (gran === 'day') d.setDate(d.getDate() + dir);
  else if (gran === 'month') d.setMonth(d.getMonth() + dir, 1);
  else d.setFullYear(d.getFullYear() + dir, 0, 1);
  return iso(d);
}

function PeriodPicker({
  gran,
  anchor,
  label,
  onChange,
}: {
  gran: Granularity;
  anchor: string;
  label: string;
  onChange: (gran: Granularity, anchor: string) => void;
}) {
  const t = useTranslations();
  const isToday = anchor === todayIso();

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-background/80 p-1 shadow-sm backdrop-blur">
      <div className="flex rounded-md bg-muted/60 p-0.5">
        {(['day', 'month', 'year'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onChange(g, anchor)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-all',
              gran === g
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {g === 'day' ? t('dashboard.perDay') : g === 'month' ? t('dashboard.perMonth') : t('dashboard.perYear')}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-border mx-0.5" />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => onChange(gran, shift(gran, anchor, -1))}
          title={t('dashboard.previousPeriod')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <label className="relative flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-muted">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{label}</span>
          <input
            type={gran === 'year' ? 'number' : gran === 'month' ? 'month' : 'date'}
            value={gran === 'year' ? anchor.slice(0, 4) : gran === 'month' ? anchor.slice(0, 7) : anchor}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (gran === 'year') onChange(gran, `${v}-01-01`);
              else if (gran === 'month') onChange(gran, `${v}-01`);
              else onChange(gran, v);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => onChange(gran, shift(gran, anchor, 1))}
          title={t('dashboard.nextPeriod')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {!isToday && (
        <>
          <div className="h-4 w-px bg-border mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-medium text-primary hover:bg-primary/10"
            onClick={() => onChange(gran, todayIso())}
          >
            {t('dashboard.today')}
          </Button>
        </>
      )}
    </div>
  );
}

/** Pagination control with page indicators */
function TablePagination({
  page,
  totalPages,
  totalItems,
  pageSize = 10,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (p: number) => void;
}) {
  const t = useTranslations();
  if (totalItems <= pageSize) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
      <span>
        {t('dashboard.showingRows', { from, to, total: totalItems })}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="px-2 font-medium">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

export default function DashboardPage() {
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const [gran, setGran] = useState<Granularity>('month');
  const [anchor, setAnchor] = useState<string>(todayIso());
  const [viewMode, setViewMode] = useState<'classic' | 'pro'>('pro');
  const [productsPage, setProductsPage] = useState(1);
  const [clientsPage, setClientsPage] = useState(1);
  const [user, setUserState] = useState<any>(null);

  useEffect(() => {
    setUserState(getUser());
    const saved = localStorage.getItem('sms_dashboard_view');
    if (saved === 'classic' || saved === 'pro') setViewMode(saved);
  }, []);

  const toggleViewMode = () => {
    const next = viewMode === 'pro' ? 'classic' : 'pro';
    setViewMode(next);
    localStorage.setItem('sms_dashboard_view', next);
  };

  const { from, to, label } = useMemo(() => periodRange(gran, anchor), [gran, anchor]);

  const { data } = useLocalFirstData(
    `dashboard?from=${from}&to=${to}`,
    () => api.get('/reports/dashboard', { params: { from, to } }).then((r) => r.data),
  );

  const isDark = resolvedTheme === 'dark';
  const colors = isDark ? seriesColors.dark : seriesColors.light;
  const statusPalette = isDark ? statusColors.dark : statusColors.light;
  const ink = isDark ? chartInk.dark : chartInk.light;

  const tooltipStyle = useMemo(
    () => ({
      backgroundColor: isDark ? '#18181b' : '#ffffff',
      borderColor: isDark ? '#27272a' : '#e4e4e7',
      color: isDark ? '#fafafa' : '#18181b',
      borderRadius: '8px',
      fontSize: '12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }),
    [isDark],
  );

  const STATUS_COLOR: Record<string, string> = {
    CONFIRMED: statusPalette.good,
    DELIVERED: statusPalette.neutral,
    PARTIALLY_DELIVERED: statusPalette.warning,
    PENDING: '#a855f7',
    CANCELLED: statusPalette.critical,
  };

  const orderStatus = (data?.orderStatus ?? []).filter((s: any) => s.count > 0);
  const collectionMix = (data?.collectionMix ?? []).filter((s: any) => s.value > 0);

  // Pagination calculations
  const allTopProducts = data?.topProducts ?? [];
  const totalProductsPages = Math.max(1, Math.ceil(allTopProducts.length / PAGE_SIZE));
  const pagedProducts = allTopProducts.slice((productsPage - 1) * PAGE_SIZE, productsPage * PAGE_SIZE);

  const allTopClients = data?.topClients ?? [];
  const totalClientsPages = Math.max(1, Math.ceil(allTopClients.length / PAGE_SIZE));
  const pagedClients = allTopClients.slice((clientsPage - 1) * PAGE_SIZE, clientsPage * PAGE_SIZE);

  const sparkRevenue = (data?.salesByDay ?? []).map((d: any) => d.total);
  const sparkCollected = (data?.salesByDay ?? []).map((d: any) => d.collected ?? d.total * 0.8);
  const sparkOrders = (data?.salesByDay ?? []).map((d: any) => d.count ?? 1);

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const userName = user?.name ? user.name.split(' ')[0] : 'Admin';

  return (
    <div className="space-y-6">
      {/* Top Header Row with Greetings, Period Picker & Switch View Button */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              {t('dashboard.welcomeBack')}, <span className="text-primary">{userName}</span>
            </h1>
            <Badge variant="outline" className="hidden sm:inline-flex bg-primary/10 text-primary border-primary/20 font-mono text-xs">
              {viewMode === 'pro' ? t('dashboard.proView') : t('dashboard.classicView')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('dashboard.showingPeriod')}: <span className="font-medium text-foreground">{label}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <PeriodPicker
            gran={gran}
            anchor={anchor}
            label={label}
            onChange={(g, a) => {
              setGran(g);
              setAnchor(a);
              setProductsPage(1);
              setClientsPage(1);
            }}
          />

          {/* Switch Dashboard View Mode Button */}
          <Button
            variant="outline"
            onClick={toggleViewMode}
            className="flex items-center gap-2 border-primary/40 bg-background/80 font-medium shadow-sm transition-all hover:bg-primary hover:text-primary-foreground"
            title={viewMode === 'pro' ? t('dashboard.classicView') : t('dashboard.proView')}
          >
            {viewMode === 'pro' ? (
              <>
                <Layers className="h-4 w-4 text-primary group-hover:text-inherit" />
                <span>{t('dashboard.classicView')}</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span>{t('dashboard.proView')}</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ======================= PRO ANALYTICS DASHBOARD VIEW ======================= */}
      {viewMode === 'pro' && (
        <div className="space-y-6 animate-in fade-in-50 duration-300">
          {/* Top KPI Cards (inspired by reference design with modern dark cards & orange accent) */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* 1. TOTAL REVENUE */}
            <Card className="relative overflow-hidden border-border/80 bg-card/90 shadow-sm backdrop-blur transition-all hover:border-primary/50 hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>{t('dashboard.totalRevenue')}</span>
                  <Trend pct={data.deltas.revenue} goodWhenUp={true} />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-black tabular-nums tracking-tight text-foreground md:text-3xl">
                    {fmtMoney(data.kpis.revenue)}
                  </span>
                </div>
                <div className="mt-3">
                  <MiniBarSparkline points={sparkRevenue.length ? sparkRevenue : [2, 5, 3, 8, 4, 9, 7, 12, 10, 15]} color="#f97316" />
                </div>
              </CardContent>
            </Card>

            {/* 2. TOTAL ORDERS / INVOICES */}
            <Card className="relative overflow-hidden border-border/80 bg-card/90 shadow-sm backdrop-blur transition-all hover:border-primary/50 hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>{t('dashboard.totalOrders')}</span>
                  <Trend pct={data.deltas.invoiceCount} goodWhenUp={true} />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-black tabular-nums tracking-tight text-foreground md:text-3xl">
                    {data.kpis.invoiceCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('orders.received')}: {data.kpis.pendingOrders} {t('status.PENDING').toLowerCase()}</span>
                </div>
                <div className="mt-3">
                  <MiniBarSparkline points={sparkOrders.length ? sparkOrders : [1, 3, 2, 4, 3, 5, 4, 6, 5, 8]} color="#ea580c" />
                </div>
              </CardContent>
            </Card>

            {/* 3. NEW CUSTOMERS / CLIENTS */}
            <Card className="relative overflow-hidden border-border/80 bg-card/90 shadow-sm backdrop-blur transition-all hover:border-primary/50 hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>{t('dashboard.newCustomers')}</span>
                  <Trend pct={data.deltas.newClients} goodWhenUp={true} />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-black tabular-nums tracking-tight text-foreground md:text-3xl">
                    {(data.kpis.newClientsCount ?? (data.topClients?.length ?? 0)).toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">{allTopClients.length} active</span>
                </div>
                <div className="mt-3">
                  <MiniBarSparkline points={[2, 4, 3, 6, 5, 7, 6, 8, 9, 10]} color="#fb923c" />
                </div>
              </CardContent>
            </Card>

            {/* 4. NET PROFIT */}
            <Card className="relative overflow-hidden border-border/80 bg-card/90 shadow-sm backdrop-blur transition-all hover:border-primary/50 hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>{t('dashboard.netProfit')}</span>
                  <Trend pct={data.deltas.netProfit} goodWhenUp={true} />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-black tabular-nums tracking-tight text-foreground md:text-3xl">
                    {fmtMoney(data.kpis.netProfit)}
                  </span>
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    {data.kpis.revenue > 0 ? `${((data.kpis.netProfit / data.kpis.revenue) * 100).toFixed(0)}% margin` : ''}
                  </span>
                </div>
                <div className="mt-3">
                  <MiniBarSparkline points={sparkCollected.length ? sparkCollected : [1, 2, 4, 3, 6, 5, 8, 7, 9, 11]} color="#22c55e" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Operations Bar */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border bg-background/50 p-2.5 text-center shadow-xs">
              <div className="text-[11px] font-medium text-muted-foreground">{t('dashboard.collected')}</div>
              <div className="mt-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtMoney(data.kpis.collected)}</div>
            </div>
            <div className="rounded-lg border bg-background/50 p-2.5 text-center shadow-xs">
              <div className="text-[11px] font-medium text-muted-foreground">{t('dashboard.receivables')}</div>
              <div className="mt-0.5 text-sm font-bold text-amber-600 dark:text-amber-400 tabular-nums">{fmtMoney(data.kpis.accountsReceivable)}</div>
            </div>
            <div className="rounded-lg border bg-background/50 p-2.5 text-center shadow-xs">
              <div className="text-[11px] font-medium text-muted-foreground">{t('dashboard.payables')}</div>
              <div className="mt-0.5 text-sm font-bold text-red-600 dark:text-red-400 tabular-nums">{fmtMoney(data.kpis.accountsPayable)}</div>
            </div>
            <div className="rounded-lg border bg-background/50 p-2.5 text-center shadow-xs">
              <div className="text-[11px] font-medium text-muted-foreground">{t('dashboard.expenses')}</div>
              <div className="mt-0.5 text-sm font-bold tabular-nums">{fmtMoney(data.kpis.expenses)}</div>
            </div>
            <div className="rounded-lg border bg-background/50 p-2.5 text-center shadow-xs">
              <div className="text-[11px] font-medium text-muted-foreground">{t('dashboard.lowStock')}</div>
              <div className={cn("mt-0.5 text-sm font-bold tabular-nums", data.kpis.lowStockCount > 0 ? "text-amber-500" : "")}>{data.kpis.lowStockCount}</div>
            </div>
            <div className="rounded-lg border bg-background/50 p-2.5 text-center shadow-xs">
              <div className="text-[11px] font-medium text-muted-foreground">{t('dashboard.openClaims')}</div>
              <div className={cn("mt-0.5 text-sm font-bold tabular-nums", data.kpis.openClaims > 0 ? "text-amber-500" : "")}>{data.kpis.openClaims}</div>
            </div>
          </div>

          {/* MAIN SALES TREND CHART & REVENUE DISTRIBUTION */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Sales Trend Chart (Large 2-column hero chart) */}
            <Card className="lg:col-span-2 border-border/80 bg-card/90 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <span>{t('dashboard.salesTrend')}</span>
                      <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">{gran.toUpperCase()}</Badge>
                    </CardTitle>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-xl font-black text-primary tabular-nums">{fmtMoney(data.kpis.revenue)}</span>
                      <span className="text-xs text-muted-foreground">{t('dashboard.totalRevenue')}</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div dir="ltr" className="pt-2">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.salesByDay} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={ink.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: ink.muted }}
                        stroke={ink.baseline}
                        tickFormatter={(v) => (gran === 'day' ? v.slice(11, 16) || v : v.slice(5))}
                      />
                      <YAxis tick={{ fontSize: 10, fill: ink.muted }} stroke={ink.baseline} width={65} />
                      <Tooltip
                        formatter={(v: any, name: any) => [fmtMoney(v), name === 'total' ? t('dashboard.revenue') : t('dashboard.collected')]}
                        labelFormatter={(l) => fmtDate(l)}
                        contentStyle={tooltipStyle}
                      />
                      <Bar dataKey="total" name={t('dashboard.revenue')} fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={36} />
                      <Bar dataKey="collected" name={t('dashboard.collected')} fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Sales by Category breakdown */}
            <Card className="border-border/80 bg-card/90 shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold">{t('dashboard.salesByCategory')}</CardTitle>
                <CardDescription className="text-xs">{t('dashboard.revenue')} breakdown by category</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div dir="ltr">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart
                      data={data.salesByCategory}
                      layout="vertical"
                      margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
                    >
                      <CartesianGrid stroke={ink.grid} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: ink.muted }} stroke={ink.baseline} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} width={75} />
                      <Tooltip formatter={(v: any) => fmtMoney(v)} contentStyle={tooltipStyle} />
                      <Bar dataKey="total" fill="#f97316" radius={[0, 4, 4, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* RECENT TRANSACTIONS TABLE */}
          {data.recentTransactions && data.recentTransactions.length > 0 && (
            <Card className="border-border/80 bg-card/90 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-base font-bold">{t('dashboard.recentTransactions')}</CardTitle>
                  <CardDescription className="text-xs">Latest invoices and sales orders</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => router.push('/invoices')} className="text-xs text-primary gap-1">
                  {t('dashboard.viewAll')} <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="w-28">{t('quotations.number')}</TableHead>
                        <TableHead>{t('common.client')}</TableHead>
                        <TableHead>{t('dashboard.items')}</TableHead>
                        <TableHead>{t('common.status')}</TableHead>
                        <TableHead className="text-end">{t('common.date')}</TableHead>
                        <TableHead className="text-end">{t('common.total')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentTransactions.slice(0, 7).map((tx: any) => (
                        <TableRow key={tx.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/invoices/${tx.id}`)}>
                          <TableCell className="font-mono text-xs font-semibold text-primary">{tx.number}</TableCell>
                          <TableCell className="font-medium text-sm">{tx.clientName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-56 truncate">{tx.itemsSummary}</TableCell>
                          <TableCell><StatusChip status={tx.status} /></TableCell>
                          <TableCell className="text-end text-xs text-muted-foreground">{fmtDate(tx.date)}</TableCell>
                          <TableCell className="text-end font-bold tabular-nums text-foreground">{fmtMoney(tx.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TOP PRODUCTS & TOP CLIENTS WITH 10-RECORDS PAGINATION */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Top Products (10 per page pagination) */}
            <Card className="border-border/80 bg-card/90 shadow-sm flex flex-col justify-between">
              <div>
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold">{t('dashboard.topProducts')}</CardTitle>
                    <CardDescription className="text-xs">{allTopProducts.length} items ranked by sales</CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">{allTopProducts.length}</Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="w-24">{t('products.sku')}</TableHead>
                        <TableHead>{t('common.product')}</TableHead>
                        <TableHead className="text-end w-20">{t('dashboard.qtySold')}</TableHead>
                        <TableHead className="text-end w-28">{t('dashboard.revenue')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedProducts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-8 text-center text-muted-foreground text-sm">
                            {t('dashboard.noSales')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        pagedProducts.map((p: any, idx: number) => (
                          <TableRow key={p.sku} className="hover:bg-muted/40">
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              <span className="inline-block w-4 text-[10px] text-muted-foreground/60 mr-1">
                                {(productsPage - 1) * PAGE_SIZE + idx + 1}.
                              </span>
                              {p.sku}
                            </TableCell>
                            <TableCell className="font-medium text-sm">{p.name}</TableCell>
                            <TableCell className="text-end tabular-nums text-sm font-semibold">{p.qty}</TableCell>
                            <TableCell className="text-end tabular-nums text-sm font-bold text-foreground">{fmtMoney(p.revenue)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </div>
              <TablePagination
                page={productsPage}
                totalPages={totalProductsPages}
                totalItems={allTopProducts.length}
                pageSize={PAGE_SIZE}
                onPageChange={setProductsPage}
              />
            </Card>

            {/* Top Clients (10 per page pagination) */}
            <Card className="border-border/80 bg-card/90 shadow-sm flex flex-col justify-between">
              <div>
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold">{t('dashboard.topClients')}</CardTitle>
                    <CardDescription className="text-xs">{allTopClients.length} clients ranked by sales</CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">{allTopClients.length}</Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>{t('common.client')}</TableHead>
                        <TableHead className="text-end w-24">{t('dashboard.ordersCount')}</TableHead>
                        <TableHead className="text-end w-28">{t('dashboard.revenue')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedClients.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-8 text-center text-muted-foreground text-sm">
                            {t('dashboard.noSales')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        pagedClients.map((c: any, idx: number) => (
                          <TableRow key={c.clientId ?? idx} className="hover:bg-muted/40 cursor-pointer" onClick={() => c.clientId && router.push(`/clients/${c.clientId}`)}>
                            <TableCell className="font-mono text-xs text-muted-foreground/60">
                              {(clientsPage - 1) * PAGE_SIZE + idx + 1}
                            </TableCell>
                            <TableCell className="font-medium text-sm">
                              <div>{c.name}</div>
                              {c.phone && <div className="text-[11px] text-muted-foreground font-mono">{c.phone}</div>}
                            </TableCell>
                            <TableCell className="text-end tabular-nums text-sm font-semibold">{c.invoices}</TableCell>
                            <TableCell className="text-end tabular-nums text-sm font-bold text-foreground">{fmtMoney(c.revenue)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </div>
              <TablePagination
                page={clientsPage}
                totalPages={totalClientsPages}
                totalItems={allTopClients.length}
                pageSize={PAGE_SIZE}
                onPageChange={setClientsPage}
              />
            </Card>
          </div>
        </div>
      )}

      {/* ======================= CLASSIC DASHBOARD VIEW ======================= */}
      {viewMode === 'classic' && (
        <div className="space-y-6 animate-in fade-in-50 duration-300">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t('dashboard.revenue')}
              value={fmtMoney(data.kpis.revenue)}
              sub={data.previous.revenue > 0 ? `${fmtMoney(data.previous.revenue)} ${t('dashboard.vsPrevious')}` : undefined}
              pct={data.deltas.revenue}
              goodWhenUp={true}
              spark={sparkRevenue}
              color={colors[0]}
            />
            <StatTile
              label={t('dashboard.collected')}
              value={fmtMoney(data.kpis.collected)}
              sub={data.previous.collected > 0 ? `${fmtMoney(data.previous.collected)} ${t('dashboard.vsPrevious')}` : undefined}
              pct={data.deltas.collected}
              goodWhenUp={true}
              spark={sparkCollected}
              color={statusPalette.good}
            />
            <StatTile
              label={t('dashboard.grossProfit')}
              value={fmtMoney(data.kpis.grossProfit)}
              sub={data.previous.grossProfit > 0 ? `${fmtMoney(data.previous.grossProfit)} ${t('dashboard.vsPrevious')}` : undefined}
              pct={data.deltas.grossProfit}
              goodWhenUp={true}
            />
            <StatTile
              label={t('dashboard.netProfit')}
              value={fmtMoney(data.kpis.netProfit)}
              sub={data.previous.netProfit !== 0 ? `${fmtMoney(data.previous.netProfit)} ${t('dashboard.vsPrevious')}` : undefined}
              pct={data.deltas.netProfit}
              goodWhenUp={true}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t('dashboard.receivables')}
              value={fmtMoney(data.kpis.accountsReceivable)}
              goodWhenUp={false}
            />
            <StatTile
              label={t('dashboard.payables')}
              value={fmtMoney(data.kpis.accountsPayable)}
              goodWhenUp={false}
            />
            <StatTile
              label={t('dashboard.pendingOrders')}
              value={String(data.kpis.pendingOrders)}
              goodWhenUp={false}
            />
            <StatTile
              label={t('dashboard.lowStock')}
              value={String(data.kpis.lowStockCount)}
              goodWhenUp={false}
            />
          </div>

          {/* Area chart & Bar chart */}
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('dashboard.salesByDay')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div dir="ltr">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={data.salesByDay} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={ink.grid} vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: ink.muted }}
                        stroke={ink.baseline}
                        tickFormatter={(v) => (gran === 'day' ? v.slice(11, 16) || v : v.slice(5))}
                      />
                      <YAxis tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} width={70} />
                      <Tooltip formatter={(v: any) => fmtMoney(v)} contentStyle={tooltipStyle} />
                      <Area type="monotone" dataKey="total" name={t('dashboard.revenue')} stroke={colors[0]} strokeWidth={2} fill={colors[0]} fillOpacity={0.12} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('dashboard.salesByCategory')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div dir="ltr">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.salesByCategory} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={ink.grid} vertical={false} />
                      <XAxis dataKey="category" tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} />
                      <YAxis tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} width={70} />
                      <Tooltip formatter={(v: any) => fmtMoney(v)} contentStyle={tooltipStyle} cursor={{ fill: ink.grid, opacity: 0.4 }} />
                      <Bar dataKey="total" name={t('dashboard.revenue')} fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Proportions Doughnuts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('dashboard.orderStatus')}</CardTitle>
              </CardHeader>
              <CardContent>
                {orderStatus.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">{t('dashboard.noSales')}</p>
                ) : (
                  <div dir="ltr">
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={orderStatus}
                          dataKey="count"
                          nameKey="status"
                          innerRadius="55%"
                          outerRadius="82%"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {orderStatus.map((s: any) => (
                            <Cell key={s.status} fill={STATUS_COLOR[s.status] ?? statusPalette.neutral} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: any, n: any) => [v, t(`status.${n}`)]}
                        />
                        <Legend
                          formatter={(v: any) => <span style={{ color: ink.muted, fontSize: 12 }}>{t(`status.${v}`)}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('dashboard.collectionMix')}</CardTitle>
              </CardHeader>
              <CardContent>
                {collectionMix.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">{t('dashboard.noSales')}</p>
                ) : (
                  <div dir="ltr">
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={collectionMix}
                          dataKey="value"
                          nameKey="key"
                          innerRadius="55%"
                          outerRadius="82%"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {collectionMix.map((s: any) => (
                            <Cell
                              key={s.key}
                              fill={s.key === 'collected' ? statusPalette.good : statusPalette.warning}
                            />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(v), t(`dashboard.${n}`)]} />
                        <Legend
                          formatter={(v: any) => <span style={{ color: ink.muted, fontSize: 12 }}>{t(`dashboard.${v}`)}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top Products & Top Clients with 10-item pagination in Classic View too */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t('dashboard.topProducts')}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('products.sku')}</TableHead>
                        <TableHead>{t('common.product')}</TableHead>
                        <TableHead className="text-end">{t('dashboard.qtySold')}</TableHead>
                        <TableHead className="text-end">{t('dashboard.revenue')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedProducts.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                            {t('dashboard.noSales')}
                          </TableCell>
                        </TableRow>
                      )}
                      {pagedProducts.map((p: any) => (
                        <TableRow key={p.sku}>
                          <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                          <TableCell>{p.name}</TableCell>
                          <TableCell className="text-end tabular-nums">{p.qty}</TableCell>
                          <TableCell className="text-end tabular-nums font-semibold">{fmtMoney(p.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </div>
              <TablePagination
                page={productsPage}
                totalPages={totalProductsPages}
                totalItems={allTopProducts.length}
                pageSize={PAGE_SIZE}
                onPageChange={setProductsPage}
              />
            </Card>

            <Card className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t('dashboard.topClients')}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('common.client')}</TableHead>
                        <TableHead className="text-end">{t('dashboard.ordersCount')}</TableHead>
                        <TableHead className="text-end">{t('dashboard.revenue')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedClients.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                            {t('dashboard.noSales')}
                          </TableCell>
                        </TableRow>
                      )}
                      {pagedClients.map((c: any) => (
                        <TableRow key={c.clientId ?? c.name}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-end tabular-nums">{c.invoices}</TableCell>
                          <TableCell className="text-end tabular-nums font-semibold">{fmtMoney(c.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </div>
              <TablePagination
                page={clientsPage}
                totalPages={totalClientsPages}
                totalItems={allTopClients.length}
                pageSize={PAGE_SIZE}
                onPageChange={setClientsPage}
              />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
