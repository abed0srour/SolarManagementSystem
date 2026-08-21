'use client';
import { BarChart3 as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api, fmtMoney, fmtDate, downloadFile } from '../../../lib/api';
import { useLocalFirstData } from '../../../lib/use-local-storage-cache';
import { seriesColors, chartInk } from '../../../lib/charts';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import { Card, CardContent } from '../../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

function ExportButtons({ report }: { report: string }) {
  const t = useTranslations();
  return (
    <div className="no-print flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => downloadFile(`/reports/${report}/export?format=csv`, `${report}.csv`)}>
        <FileDown /> {t('common.exportCsv')}
      </Button>
      <Button variant="outline" size="sm" onClick={() => downloadFile(`/reports/${report}/export?format=xlsx`, `${report}.xlsx`)}>
        <FileSpreadsheet /> {t('common.exportExcel')}
      </Button>
    </div>
  );
}

/**
 * Cache-first report loader — every report on this page goes through here, so
 * a revisited tab paints from localStorage with no skeleton while the fresh
 * figures load behind it. `null` (not `undefined`) on a cold load, to match
 * what the report components already check for.
 */
function useReport(path: string) {
  const { data } = useLocalFirstData<any>(`reports:${path}`, () => api.get(path).then((r) => r.data));
  return data ?? null;
}

function ReportSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('reports.title')} subtitle={t('subtitles.reports')} />
      <Tabs defaultValue="profit">
        <TabsList className="w-full sm:w-auto flex flex-wrap h-auto p-1 gap-1">
          <TabsTrigger value="profit">{t('reports.profitByProduct')}</TabsTrigger>
          <TabsTrigger value="valuation">{t('reports.inventoryValuation')}</TabsTrigger>
          <TabsTrigger value="receivables">{t('reports.receivables')}</TabsTrigger>
          <TabsTrigger value="payables">{t('reports.payables')}</TabsTrigger>
          <TabsTrigger value="cashflow">{t('reports.cashFlow')}</TabsTrigger>
          <TabsTrigger value="warranty">{t('reports.warrantyReport')}</TabsTrigger>
          <TabsTrigger value="reorder">{t('reports.reorder')}</TabsTrigger>
        </TabsList>

        <TabsContent value="profit"><ProfitReport /></TabsContent>
        <TabsContent value="valuation"><ValuationReport /></TabsContent>
        <TabsContent value="receivables"><ReceivablesReport /></TabsContent>
        <TabsContent value="payables"><PayablesReport /></TabsContent>
        <TabsContent value="cashflow"><CashFlowReport /></TabsContent>
        <TabsContent value="warranty"><WarrantyReport /></TabsContent>
        <TabsContent value="reorder"><ReorderReport /></TabsContent>
      </Tabs>
    </div>
  );
}

function ProfitReport() {
  const t = useTranslations();
  const data = useReport('/reports/profit-by-product');
  if (!data) return <ReportSkeleton />;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <ExportButtons report="profit-by-product" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('products.sku')}</TableHead>
              <TableHead>{t('common.product')}</TableHead>
              <TableHead className="text-end">{t('common.quantity')}</TableHead>
              <TableHead className="text-end">{t('dashboard.revenue')}</TableHead>
              <TableHead className="text-end">{t('reports.cost')}</TableHead>
              <TableHead className="text-end">{t('reports.profit')}</TableHead>
              <TableHead className="text-end">{t('reports.margin')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r: any) => (
              <TableRow key={r.sku}>
                <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-end tabular-nums">{r.qty}</TableCell>
                <TableCell className="text-end tabular-nums">{fmtMoney(r.revenue)}</TableCell>
                <TableCell className="text-end tabular-nums">{fmtMoney(r.cost)}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{fmtMoney(r.profit)}</TableCell>
                <TableCell className="text-end tabular-nums">{r.marginPct}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ValuationReport() {
  const t = useTranslations();
  const data = useReport('/reports/inventory-valuation');
  if (!data) return <ReportSkeleton />;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-4 text-sm">
            <span>
              {t('reports.costValue')}: <strong className="tabular-nums">{fmtMoney(data.totalCostValue)}</strong>
            </span>
            <span>
              {t('reports.saleValue')}: <strong className="tabular-nums">{fmtMoney(data.totalSaleValue)}</strong>
            </span>
          </div>
          <ExportButtons report="inventory-valuation" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('products.sku')}</TableHead>
              <TableHead>{t('common.product')}</TableHead>
              <TableHead>{t('products.category')}</TableHead>
              <TableHead className="text-end">{t('common.quantity')}</TableHead>
              <TableHead className="text-end">{t('reports.costValue')}</TableHead>
              <TableHead className="text-end">{t('reports.saleValue')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r: any) => (
              <TableRow key={r.sku}>
                <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.category} / {r.subCategory}</TableCell>
                <TableCell className="text-end tabular-nums">{r.quantity}</TableCell>
                <TableCell className="text-end tabular-nums">{fmtMoney(r.costValue)}</TableCell>
                <TableCell className="text-end tabular-nums">{fmtMoney(r.saleValue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ReceivablesReport() {
  const t = useTranslations();
  const data = useReport('/reports/receivables');
  if (!data) return <ReportSkeleton />;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <ExportButtons report="receivables" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('invoices.number')}</TableHead>
              <TableHead>{t('common.client')}</TableHead>
              <TableHead>{t('common.dueDate')}</TableHead>
              <TableHead className="text-end">{t('common.total')}</TableHead>
              <TableHead className="text-end">{t('invoices.paid')}</TableHead>
              <TableHead className="text-end">{t('invoices.balance')}</TableHead>
              <TableHead>{t('reports.aging')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.number}</TableCell>
                <TableCell>{r.client}</TableCell>
                <TableCell>{fmtDate(r.dueDate)}</TableCell>
                <TableCell className="text-end tabular-nums">{fmtMoney(r.total)}</TableCell>
                <TableCell className="text-end tabular-nums">{fmtMoney(r.paidAmount)}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{fmtMoney(r.balance)}</TableCell>
                <TableCell>
                  <Badge variant={r.bucket === 'current' ? 'muted' : r.bucket === '90+' ? 'destructive' : 'warning'}>{r.bucket}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PayablesReport() {
  const t = useTranslations();
  const data = useReport('/reports/payables');
  if (!data) return <ReportSkeleton />;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <ExportButtons report="payables" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('invoices.number')}</TableHead>
              <TableHead>{t('common.supplier')}</TableHead>
              <TableHead>{t('common.dueDate')}</TableHead>
              <TableHead className="text-end">{t('common.total')}</TableHead>
              <TableHead className="text-end">{t('invoices.paid')}</TableHead>
              <TableHead className="text-end">{t('invoices.balance')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.number}</TableCell>
                <TableCell>{r.supplier}</TableCell>
                <TableCell>{fmtDate(r.dueDate)}</TableCell>
                <TableCell className="text-end tabular-nums">{fmtMoney(r.total)}</TableCell>
                <TableCell className="text-end tabular-nums">{fmtMoney(r.paidAmount)}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{fmtMoney(r.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CashFlowReport() {
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const colors = seriesColors[mode];
  const ink = chartInk[mode];
  const data = useReport('/reports/cash-flow');
  if (!data) return <ReportSkeleton />;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-4 text-sm">
            <span>{t('reports.moneyIn')}: <strong className="tabular-nums">{fmtMoney(data.totalIn)}</strong></span>
            <span>{t('reports.moneyOut')}: <strong className="tabular-nums">{fmtMoney(data.totalOut)}</strong></span>
            <span>{t('reports.net')}: <strong className="tabular-nums">{fmtMoney(data.net)}</strong></span>
          </div>
          <ExportButtons report="cash-flow" />
        </div>
        <div dir="ltr">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.days} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={ink.grid} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} />
              <YAxis tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} width={70} />
              <Tooltip formatter={(v: any) => fmtMoney(v)} contentStyle={{ backgroundColor: mode === 'dark' ? '#1a1a19' : '#fcfcfb', border: `1px solid ${ink.grid}`, borderRadius: 8, fontSize: 12 }} cursor={{ fill: ink.grid, opacity: 0.4 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="in" name={t('reports.moneyIn')} fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="out" name={t('reports.moneyOut')} fill={colors[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function WarrantyReport() {
  const t = useTranslations();
  const data = useReport('/reports/warranty');
  if (!data) return <ReportSkeleton />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 font-medium">{t('common.status')}</div>
          <Table>
            <TableBody>
              {data.byStatus.map((s: any) => (
                <TableRow key={s.status}>
                  <TableCell>{t(`status.${s.status}`)}</TableCell>
                  <TableCell className="text-end tabular-nums">{s.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 font-medium">{t('common.product')}</div>
          <Table>
            <TableBody>
              {data.byProduct.map((p: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>{p.product?.name ?? '—'}</TableCell>
                  <TableCell className="text-end tabular-nums">{p.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ReorderReport() {
  const t = useTranslations();
  const data = useReport('/reports/reorder');
  if (!data) return <ReportSkeleton />;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <ExportButtons report="reorder" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('products.sku')}</TableHead>
              <TableHead>{t('common.product')}</TableHead>
              <TableHead className="text-end">{t('products.stock')}</TableHead>
              <TableHead className="text-end">{t('reports.sold90')}</TableHead>
              <TableHead className="text-end">{t('reports.daysOfStock')}</TableHead>
              <TableHead className="text-end">{t('reports.suggestedOrder')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r: any) => (
              <TableRow key={r.sku}>
                <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                <TableCell>{r.name} {r.isLow && <Badge variant="destructive">{t('inventory.low')}</Badge>}</TableCell>
                <TableCell className="text-end tabular-nums">{r.stock}</TableCell>
                <TableCell className="text-end tabular-nums">{r.sold90}</TableCell>
                <TableCell className="text-end tabular-nums">{r.daysOfStock ?? '—'}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{r.suggestedOrder}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
