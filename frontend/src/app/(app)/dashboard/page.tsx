'use client';
import { LayoutDashboard as PageIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { api, fmtMoney } from '../../../lib/api';
import { useLocalFirstData } from '../../../lib/use-local-storage-cache';
import { seriesColors, chartInk } from '../../../lib/charts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
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
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-32" value={gran} onChange={(e) => setGran(e.target.value as Granularity)}>
            <option value="day">{t('dashboard.perDay')}</option>
            <option value="month">{t('dashboard.perMonth')}</option>
            <option value="year">{t('dashboard.perYear')}</option>
          </Select>

          {/* Native pickers: a real calendar for a day, a month picker for a month. */}
          {gran === 'day' && (
            <Input type="date" className="w-40" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} />
          )}
          {gran === 'month' && (
            <Input
              type="month"
              className="w-36"
              value={anchor.slice(0, 7)}
              onChange={(e) => e.target.value && setAnchor(`${e.target.value}-01`)}
            />
          )}
          {gran === 'year' && (
            <Input
              type="number"
              className="w-24 text-center tabular-nums"
              value={anchor.slice(0, 4)}
              onChange={(e) => e.target.value.length === 4 && setAnchor(`${e.target.value}-01-01`)}
            />
          )}

          {/* Step through periods without reaching for the picker each time. */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-9 w-9" title={t('dashboard.previousPeriod')} onClick={() => setAnchor(shift(gran, anchor, -1))}>
              <ChevronLeft className="rtl:rotate-180" />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9" title={t('dashboard.nextPeriod')} onClick={() => setAnchor(shift(gran, anchor, 1))}>
              <ChevronRight className="rtl:rotate-180" />
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => setAnchor(todayIso())}>
              {t('dashboard.today')}
            </Button>
          </div>
        </div>
      </div>

      {/* Spells out exactly which period every figure below covers. */}
      <p className="text-sm text-muted-foreground">
        {t('dashboard.showingPeriod')}: <span className="font-medium text-foreground">{label}</span>
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t('dashboard.revenue')} value={fmtMoney(k.revenue)} sub={t('dashboard.invoicesCount', { count: k.invoiceCount })} />
        <StatTile label={t('dashboard.refunds')} value={fmtMoney(k.refunds ?? 0)} sub={`${t('dashboard.netRevenue')}: ${fmtMoney(k.netRevenue ?? k.revenue)}`} />
        <StatTile label={t('dashboard.collected')} value={fmtMoney(k.collected)} />
        <StatTile label={t('dashboard.grossProfit')} value={fmtMoney(k.grossProfit)} />
        <StatTile label={t('dashboard.receivables')} value={fmtMoney(k.accountsReceivable)} />
        <StatTile label={t('dashboard.payables')} value={fmtMoney(k.accountsPayable)} />
        <StatTile label={t('dashboard.pendingOrders')} value={String(k.pendingOrders)} />
        <StatTile label={t('dashboard.openClaims')} value={String(k.openClaims)} />
        <StatTile label={t('dashboard.lowStock')} value={String(k.lowStockCount)} />
        <StatTile label={t('dashboard.expenses')} value={fmtMoney(k.expenses)} />
        <StatTile label={t('dashboard.netProfit')} value={fmtMoney(k.netProfit)} />
        <StatTile label={t('dashboard.energyProduced')} value={`${Number(k.energyKwh ?? 0).toLocaleString()} kWh`} />
        <StatTile label={t('dashboard.activeSystems')} value={String(k.activeInstallations ?? 0)} />
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
