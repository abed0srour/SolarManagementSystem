'use client';
import { Activity as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Activity, BatteryCharging, Leaf, PiggyBank, Sun, Zap } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { api, fmtMoney } from '../../../lib/api';
import { seriesColors, chartInk } from '../../../lib/charts';
import StatusChip from '../../../components/status-chip';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

function KpiTile({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-xl font-bold">{value}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MonitoringPage() {
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const colors = seriesColors[mode];
  const ink = chartInk[mode];
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get('/installations/fleet/stats').then((r) => setData(r.data));
  }, []);

  if (!data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-72" />
      </div>
    );

  const k = data.kpis;
  const hasData = data.monthlyProduction.some((m: any) => m.kwh > 0);
  const tooltipStyle = {
    backgroundColor: mode === 'dark' ? '#1a1a19' : '#fcfcfb',
    border: `1px solid ${ink.grid}`,
    borderRadius: 8,
    fontSize: 12,
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('monitoring.title')} subtitle={t('subtitles.monitoring')} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTile icon={Activity} label={t('monitoring.activeSystems')} value={String(k.activeSystems)} />
        <KpiTile icon={Sun} label={t('monitoring.totalCapacity')} value={`${k.totalCapacityKw.toLocaleString()} kWp`} />
        <KpiTile icon={BatteryCharging} label={t('monitoring.totalBattery')} value={`${k.totalBatteryKwh.toLocaleString()} kWh`} />
        <KpiTile icon={Zap} label={t('monitoring.energyThisMonth')} value={`${k.kwhThisMonth.toLocaleString()} kWh`} sub={`${t('monitoring.energyAllTime')}: ${k.kwhAllTime.toLocaleString()} kWh`} />
        <KpiTile icon={PiggyBank} label={t('monitoring.estSavings')} value={fmtMoney(k.savingsAllTime)} />
        <KpiTile icon={Leaf} label={t('monitoring.co2Saved')} value={`${(k.co2SavedKg / 1000).toFixed(2)} t`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('monitoring.fleetProduction')}</CardTitle>
          </CardHeader>
          <CardContent>
            {hasData ? (
              <div dir="ltr">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.monthlyProduction} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={ink.grid} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} />
                    <YAxis tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} width={60} />
                    <Tooltip formatter={(v: any) => [`${Number(v).toLocaleString()} kWh`, 'kWh']} contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="kwh" stroke={colors[1]} strokeWidth={2} fill={colors[1]} fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{t('monitoring.noData')}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('monitoring.byStatus')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.byStatus.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">{t('common.noRecords')}</div>}
            {data.byStatus.map((s: any) => (
              <div key={s.status} className="flex items-center justify-between rounded-md border px-3 py-2">
                <StatusChip status={s.status} />
                <span className="text-lg font-bold tabular-nums">{s.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('monitoring.topSystems')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('quotations.number')}</TableHead>
                <TableHead>{t('common.client')}</TableHead>
                <TableHead className="text-end">{t('installations.capacityKw')}</TableHead>
                <TableHead className="text-end">{t('monitoring.kwh30d')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topSystems.length === 0 && (
                <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">{t('monitoring.noData')}</TableCell></TableRow>
              )}
              {data.topSystems.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/installations/${s.id}`} className="font-mono text-xs text-primary hover:underline">{s.number}</Link>
                  </TableCell>
                  <TableCell>{s.client}</TableCell>
                  <TableCell className="text-end tabular-nums">{s.capacityKw} kWp</TableCell>
                  <TableCell className="text-end tabular-nums">{s.kwh30d.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
