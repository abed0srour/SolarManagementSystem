'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { api, fmtMoney } from '../../../lib/api';
import { seriesColors, chartInk } from '../../../lib/charts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
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

export default function DashboardPage() {
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);

  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const colors = seriesColors[mode];
  const ink = chartInk[mode];

  useEffect(() => {
    const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
    api.get('/reports/dashboard', { params: { from } }).then((r) => setData(r.data));
  }, [days]);

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
        <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
        <Select className="w-44" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>{t('dashboard.last7')}</option>
          <option value={30}>{t('dashboard.last30')}</option>
          <option value={90}>{t('dashboard.last90')}</option>
          <option value={365}>{t('dashboard.last365')}</option>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t('dashboard.revenue')} value={fmtMoney(k.revenue)} sub={t('dashboard.invoicesCount', { count: k.invoiceCount })} />
        <StatTile label={t('dashboard.collected')} value={fmtMoney(k.collected)} />
        <StatTile label={t('dashboard.grossProfit')} value={fmtMoney(k.grossProfit)} />
        <StatTile label={t('dashboard.receivables')} value={fmtMoney(k.accountsReceivable)} />
        <StatTile label={t('dashboard.payables')} value={fmtMoney(k.accountsPayable)} />
        <StatTile label={t('dashboard.pendingOrders')} value={String(k.pendingOrders)} />
        <StatTile label={t('dashboard.openClaims')} value={String(k.openClaims)} />
        <StatTile label={t('dashboard.lowStock')} value={String(k.lowStockCount)} />
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
    </div>
  );
}
