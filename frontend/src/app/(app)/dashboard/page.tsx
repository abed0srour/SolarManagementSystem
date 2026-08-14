'use client';
import { LayoutDashboard as PageIcon, ChevronLeft, ChevronRight, CalendarDays, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { api, fmtMoney, fmtDate } from '../../../lib/api';
import { useLocalFirstData } from '../../../lib/use-local-storage-cache';
import { cn } from '../../../lib/utils';
import { seriesColors, statusColors, chartInk } from '../../../lib/charts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

/**
 * Period-over-period change.
 *
 * `null` means there was no baseline — a first month of trading is not "0%
 * growth", and printing 0% there would be a lie. Direction is never carried by
 * colour alone: an arrow glyph and the sign both say it, so it survives
 * colourblindness and greyscale printing.
 *
 * `goodWhenUp` exists because rising expenses are not good news; the same
 * component must be able to read a rise as bad.
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
        'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium tabular-nums',
        good === null && 'bg-muted text-muted-foreground',
        good === true && 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
        good === false && 'bg-red-500/12 text-red-700 dark:text-red-400',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {flat ? '0%' : `${Math.abs(pct).toFixed(1)}%`}
    </span>
  );
}

/**
 * Micro sparkline. No axes, no grid, no tooltip — it conveys shape only, and
 * the exact numbers live in the full chart below. `preserveAspectRatio="none"`
 * lets it stretch to whatever width the card has.
 */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <div className="h-8" />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = 100 / (points.length - 1);
  const d = points.map((p, i) => `${i * step},${28 - ((p - min) / span) * 26}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      <polyline points={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatTile({
  label, value, sub, pct, goodWhenUp = true, spark, color,
}: {
  label: string; value: string; sub?: string;
  pct?: number | null; goodWhenUp?: boolean; spark?: number[]; color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-muted-foreground">{label}</div>
          {pct !== undefined && <Trend pct={pct} goodWhenUp={goodWhenUp} />}
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        {spark && spark.length > 1 && color && (
          <div className="mt-2">
            <Sparkline points={spark} color={color} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Granularity = 'day' | 'month' | 'year';

/** Local calendar date as yyyy-mm-dd — `toISOString` would shift by the timezone. */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayIso(): string {
  return iso(new Date());
}

/**
 * Turn a granularity and an anchor date into the inclusive range the API wants.
 * The server treats `to` as end-of-day, so a single day is from === to.
 */
function periodRange(gran: Granularity, anchor: string): { from: string; to: string; label: string } {
  const d = new Date(`${anchor}T00:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth();

  if (gran === 'day') {
    return { from: anchor, to: anchor, label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) };
  }
  if (gran === 'month') {
    // Day 0 of the next month is the last day of this one — handles February.
    return {
      from: iso(new Date(y, m, 1)),
      to: iso(new Date(y, m + 1, 0)),
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  }
  return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)), label: String(y) };
}

/** Step one day, month or year in either direction. */
function shift(gran: Granularity, anchor: string, dir: -1 | 1): string {
  const d = new Date(`${anchor}T00:00:00`);
  if (gran === 'day') d.setDate(d.getDate() + dir);
  else if (gran === 'month') d.setMonth(d.getMonth() + dir, 1);
  else d.setFullYear(d.getFullYear() + dir, 0, 1);
  return iso(d);
}

/**
 * Period picker: granularity, a stepper, and a jump back to now.
 *
 * Built as one bordered group rather than four loose controls, because they are
 * one instrument — every part of it answers "which window am I looking at".
 *
 * The date control is a native picker made invisible and laid over a styled
 * label. That keeps the real calendar popup, the keyboard behaviour and the
 * mobile wheel that a hand-built dropdown would have to reimplement badly,
 * while dropping the native indicator icon — which renders as a clipped grey
 * square on a dark background and was the ugliest thing on the page.
 */
function PeriodPicker({
  gran,
  setGran,
  anchor,
  setAnchor,
  label,
}: {
  gran: Granularity;
  setGran: (g: Granularity) => void;
  anchor: string;
  setAnchor: (a: string) => void;
  label: string;
}) {
  const t = useTranslations();
  const today = todayIso();
  // Already on the period containing today, so the jump would do nothing.
  const isCurrent = periodRange(gran, anchor).from === periodRange(gran, today).from;

  const nowLabel = gran === 'day' ? t('dashboard.today') : gran === 'month' ? t('dashboard.thisMonth') : t('dashboard.thisYear');
  const thisYear = new Date().getFullYear();

  const step = (dir: -1 | 1) => setAnchor(shift(gran, anchor, dir));

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1">
      {/* Three mutually exclusive options: segments, not a dropdown that costs two taps. */}
      <div className="flex items-center gap-0.5">
        {(['day', 'month', 'year'] as Granularity[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGran(g)}
            aria-pressed={gran === g}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              gran === g
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t(g === 'day' ? 'dashboard.perDay' : g === 'month' ? 'dashboard.perMonth' : 'dashboard.perYear')}
          </button>
        ))}
      </div>

      <div className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title={t('dashboard.previousPeriod')}
          aria-label={t('dashboard.previousPeriod')}
          onClick={() => step(-1)}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </button>

        {/* Styled label with the real picker laid transparently on top of it. */}
        <div className="relative">
          <div className="pointer-events-none flex min-w-[8.5rem] items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold">
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="whitespace-nowrap">{label}</span>
          </div>

          {gran === 'year' ? (
            // A year has no native picker, so a plain select is the honest control.
            <select
              aria-label={t('dashboard.showingPeriod')}
              value={anchor.slice(0, 4)}
              onChange={(e) => setAnchor(`${e.target.value}-01-01`)}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {Array.from({ length: 12 }, (_, i) => thisYear + 1 - i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={gran === 'day' ? 'date' : 'month'}
              aria-label={t('dashboard.showingPeriod')}
              value={gran === 'day' ? anchor : anchor.slice(0, 7)}
              onChange={(e) =>
                e.target.value && setAnchor(gran === 'day' ? e.target.value : `${e.target.value}-01`)
              }
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          )}
        </div>

        <button
          type="button"
          title={t('dashboard.nextPeriod')}
          aria-label={t('dashboard.nextPeriod')}
          onClick={() => step(1)}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </button>
      </div>

      <div className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />

      <button
        type="button"
        onClick={() => setAnchor(today)}
        disabled={isCurrent}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        {nowLabel}
      </button>
    </div>
  );
}

export default function DashboardPage() {
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  // Granularity plus an anchor date. Every figure on this page — revenue, COGS,
  // expenses, profit — is already computed from the server's from/to window, so
  // narrowing to one day needs nothing but the right range.
  const [gran, setGran] = useState<Granularity>('month');
  const [anchor, setAnchor] = useState(() => todayIso());

  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const colors = seriesColors[mode];
  const ink = chartInk[mode];

  const { from, to, label } = useMemo(() => periodRange(gran, anchor), [gran, anchor]);

  // Cache-first: a previously viewed period paints immediately, then refreshes
  // in the background. Each period is its own cache entry.
  const { data } = useLocalFirstData<any>(`dashboard:${gran}:${from}`, () =>
    api.get('/reports/dashboard', { params: { from, to } }).then((r) => r.data),
  );

  if (!data)
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );

  const k = data.kpis;
  const d = data.deltas ?? {};
  // One shared sparkline: the daily revenue shape for the selected period.
  const spark: number[] = (data.salesByDay ?? []).map((p: any) => Number(p.total));

  const statusPalette = statusColors[mode];
  /*
   * Order status is a state, not a series, so it uses the reserved status
   * colours — and every slice is labelled, because a doughnut read by colour
   * alone is unreadable to a colourblind viewer.
   */
  const STATUS_COLOR: Record<string, string> = {
    DELIVERED: statusPalette.good,
    CONFIRMED: colors[0],
    PARTIALLY_DELIVERED: statusPalette.warning,
    PENDING: statusPalette.neutral,
    CANCELLED: statusPalette.critical,
  };
  const orderStatus = (data.orderStatus ?? []).filter((s: any) => s.count > 0);
  const collectionMix = (data.collectionMix ?? []).filter((s: any) => Number(s.value) > 0);

  const tooltipStyle = {
    backgroundColor: mode === 'dark' ? '#1a1a19' : '#fcfcfb',
    border: `1px solid ${ink.grid}`,
    borderRadius: 8,
    fontSize: 12,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader icon={PageIcon} title={t('dashboard.title')} subtitle={t('subtitles.dashboard')} />
        <PeriodPicker gran={gran} setGran={setGran} anchor={anchor} setAnchor={setAnchor} label={label} />
      </div>

      {/*
        The exact date span behind the label. "August 2026" is what the picker
        shows; this is the inclusive range every figure below is computed from,
        which matters at the edges of a month.
      */}
      <p className="text-sm text-muted-foreground">
        {t('dashboard.showingPeriod')}: <span className="font-medium text-foreground">{label}</span>
        <span className="ms-2 text-xs">
          ({fmtDate(from)} – {fmtDate(to)})
        </span>
      </p>

      {/*
        Headline row: the six figures with a like-for-like previous period to
        compare against, each carrying its trend badge and a sparkline of the
        daily revenue shape. Rising expenses read as bad, hence goodWhenUp.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label={t('dashboard.revenue')} value={fmtMoney(k.revenue)}
          sub={t('dashboard.invoicesCount', { count: k.invoiceCount })}
          pct={d.revenue} spark={spark} color={colors[0]}
        />
        <StatTile
          label={t('dashboard.collected')} value={fmtMoney(k.collected)}
          sub={`${t('dashboard.receivables')}: ${fmtMoney(k.accountsReceivable)}`}
          pct={d.collected} spark={spark} color={colors[1]}
        />
        <StatTile
          label={t('dashboard.grossProfit')} value={fmtMoney(k.grossProfit)}
          sub={`${t('dashboard.netRevenue')}: ${fmtMoney(k.netRevenue ?? k.revenue)}`}
          pct={d.grossProfit} spark={spark} color={colors[3]}
        />
        <StatTile
          label={t('dashboard.expenses')} value={fmtMoney(k.expenses)}
          pct={d.expenses} goodWhenUp={false}
        />
        <StatTile
          label={t('dashboard.netProfit')} value={fmtMoney(k.netProfit)}
          sub={`${t('dashboard.refunds')}: ${fmtMoney(k.refunds ?? 0)}`}
          pct={d.netProfit}
        />
        <StatTile
          label={t('dashboard.ordersCount')} value={String(k.invoiceCount)}
          sub={`${t('dashboard.pendingOrders')}: ${k.pendingOrders}`}
          pct={d.invoiceCount}
        />
      </div>

      {/* Operational counters: states, not trends, so no comparison badge. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label={t('dashboard.payables')} value={fmtMoney(k.accountsPayable)} />
        <StatTile label={t('dashboard.openClaims')} value={String(k.openClaims)} />
        <StatTile label={t('dashboard.lowStock')} value={String(k.lowStockCount)} />
        <StatTile label={t('dashboard.activeSystems')} value={String(k.activeInstallations ?? 0)} />
        <StatTile label={t('dashboard.energyProduced')} value={`${Number(k.energyKwh ?? 0).toLocaleString()} kWh`} />
      </div>

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
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} />
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

      {/* Proportions. Both are doughnuts: a share-of-whole question, and the
          hole gives room for the headline count in the middle. */}
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
                      // 2px surface gap between segments, per the mark spec.
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
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
                {data.topProducts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t('dashboard.noSales')}
                    </TableCell>
                  </TableRow>
                )}
                {data.topProducts.map((p: any) => (
                  <TableRow key={p.sku}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-end tabular-nums">{p.qty}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmtMoney(p.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
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
                {(data.topClients ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      {t('dashboard.noSales')}
                    </TableCell>
                  </TableRow>
                )}
                {(data.topClients ?? []).map((c: any) => (
                  <TableRow key={c.clientId}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-end tabular-nums">{c.invoices}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmtMoney(c.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
