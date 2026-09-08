'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BadgeDollarSign, Clock, Mail, MapPin, Phone, StickyNote, Truck } from 'lucide-react';
import { api, errMsg, fmtDate, fmtMoney } from '../../../../lib/api';
import PageHeader from '../../../../components/page-header';
import StatusChip from '../../../../components/status-chip';
import EntityLink, { linkTo } from '../../../../components/entity-link';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';

/**
 * Everything about one supplier on a page of its own — purchase orders,
 * invoices, payments, returns and the agreed price list — mirroring the
 * client detail page so a supplier name anywhere in the app can link
 * straight to its history instead of staying a dead label.
 */
export default function SupplierDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<any>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    api
      .get(`/suppliers/${params.id}`)
      .then((r) => setSupplier(r.data))
      .catch((e) => {
        setMissing(true);
        toast.error(errMsg(e));
      });
  }, [params.id]);
  useEffect(load, [load]);

  if (missing) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('common.noRecords')}</p>
        <Button variant="outline" onClick={() => router.push('/suppliers')}>{t('nav.suppliers')}</Button>
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const Row = ({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) =>
    value ? (
      <div className="flex items-start gap-2 text-sm">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">{label}:</span>
        <span className="min-w-0 break-words font-medium">{value}</span>
      </div>
    ) : null;

  const purchaseOrders: any[] = supplier.purchaseOrders ?? [];
  const invoices: any[] = supplier.invoices ?? [];
  const payments: any[] = supplier.payments ?? [];
  const returns: any[] = supplier.supplierReturns ?? [];
  const priceList: any[] = supplier.products ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Truck}
        title={supplier.name}
        subtitle={[supplier.phone, supplier.email].filter(Boolean).join(' · ') || undefined}
      />

      {supplier.deletedAt && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="destructive">{t('common.archive')}</Badge>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{t('suppliers.payable')}</div>
          <div className={`text-2xl font-bold tabular-nums ${Number(supplier.outstandingPayable) > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
            {fmtMoney(supplier.outstandingPayable ?? 0)}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{t('nav.purchaseOrders')}</div>
          <div className="text-2xl font-bold tabular-nums">{purchaseOrders.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{t('suppliers.leadTime')}</div>
          <div className="text-2xl font-bold tabular-nums">{supplier.leadTimeDays ?? '—'}</div>
        </CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('common.details')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Row icon={Phone} label={t('common.phone')} value={supplier.phone} />
            <Row icon={Mail} label={t('common.email')} value={supplier.email} />
            <Row icon={MapPin} label={t('common.address')} value={supplier.address} />
            <Row icon={BadgeDollarSign} label={t('suppliers.taxId')} value={supplier.taxId} />
            <Row icon={Clock} label={t('suppliers.leadTime')} value={supplier.leadTimeDays ?? undefined} />
            <Row icon={StickyNote} label={t('common.notes')} value={supplier.notes} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <Tabs defaultValue="orders">
              <TabsList>
                <TabsTrigger value="orders">{t('nav.purchaseOrders')} ({purchaseOrders.length})</TabsTrigger>
                <TabsTrigger value="invoices">{t('nav.invoices')} ({invoices.length})</TabsTrigger>
                <TabsTrigger value="payments">{t('nav.payments')} ({payments.length})</TabsTrigger>
                <TabsTrigger value="returns">{t('suppliers.returns')} ({returns.length})</TabsTrigger>
                <TabsTrigger value="prices">{t('suppliers.priceList')} ({priceList.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="orders">
                <MiniTable
                  cols={[t('quotations.number'), t('common.date'), t('common.status'), t('common.total')]}
                  rows={purchaseOrders}
                  empty={t('common.noRecords')}
                  render={(o) => [
                    <EntityLink key="n" href={linkTo.purchaseOrder(o.id)} mono>{o.number}</EntityLink>,
                    fmtDate(o.createdAt),
                    <StatusChip key="s" status={o.status} />,
                    <span key="t" className="tabular-nums">{fmtMoney(o.total, o.currency)}</span>,
                  ]}
                />
              </TabsContent>

              <TabsContent value="invoices">
                <MiniTable
                  cols={[t('quotations.number'), t('common.date'), t('common.status'), t('common.total')]}
                  rows={invoices}
                  empty={t('common.noRecords')}
                  render={(i) => [
                    <EntityLink key="n" href={linkTo.invoice(i.id)} mono>{i.number}</EntityLink>,
                    fmtDate(i.issueDate),
                    <StatusChip key="s" status={i.status} />,
                    <span key="t" className="tabular-nums">{fmtMoney(i.total)}</span>,
                  ]}
                />
              </TabsContent>

              <TabsContent value="payments">
                <MiniTable
                  cols={[t('quotations.number'), t('common.date'), t('common.method'), t('common.amount')]}
                  rows={payments}
                  empty={t('common.noRecords')}
                  render={(p) => [
                    <span key="n" className="font-mono text-xs">{p.number}</span>,
                    fmtDate(p.paymentDate),
                    t(`payments.${p.method}`),
                    <span key="a" className="tabular-nums text-green-600 dark:text-green-400">{fmtMoney(p.amount)}</span>,
                  ]}
                />
              </TabsContent>

              <TabsContent value="returns">
                <MiniTable
                  cols={[t('quotations.number'), t('common.date'), t('common.status')]}
                  rows={returns}
                  empty={t('common.noRecords')}
                  render={(r) => [
                    <span key="n" className="font-mono text-xs">{r.number}</span>,
                    fmtDate(r.createdAt),
                    <StatusChip key="s" status={r.status} />,
                  ]}
                />
              </TabsContent>

              <TabsContent value="prices">
                <MiniTable
                  cols={[t('common.name'), t('products.sku'), t('common.total')]}
                  rows={priceList}
                  empty={t('common.noRecords')}
                  render={(sp) => [
                    <EntityLink key="n" href={linkTo.product(sp.productId)}>{sp.product?.name}</EntityLink>,
                    <span key="k" className="font-mono text-xs">{sp.product?.sku}</span>,
                    <span key="p" className="tabular-nums">{fmtMoney(sp.supplierPrice, sp.currency)}</span>,
                  ]}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Compact table for the document lists on this page. */
function MiniTable({
  cols, rows, render, empty,
}: {
  cols: string[]; rows: any[]; render: (row: any) => React.ReactNode[]; empty: string;
}) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>{cols.map((c, i) => <TableHead key={i} className={i === cols.length - 1 ? 'text-end' : ''}>{c}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={r.id ?? i}>
            {render(r).map((cell, j) => (
              <TableCell key={j} className={j === cols.length - 1 ? 'text-end' : ''}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
