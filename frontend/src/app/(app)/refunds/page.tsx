'use client';
import { RotateCcw as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, X, PackageCheck, Eye, ShoppingCart, History } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import EntityLink, { linkTo } from '../../../components/entity-link';
import Field from '../../../components/form-field';
import { WarehousePicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function RefundsPage() {
  const t = useTranslations();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailsFor, setDetailsFor] = useState<any>(null);
  const [completeFor, setCompleteFor] = useState<any>(null);
  const [completeWh, setCompleteWh] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [orderBefore, setOrderBefore] = useState<any>(null);

  // Order items are never mutated by a refund, so the order document IS the
  // pre-refund state — fetch and show it as-is.
  const showOrderBefore = async (r: any) => {
    try {
      const { data } = await api.get(`/sales-orders/${r.invoice.salesOrderId}`);
      setOrderBefore(data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const act = async (row: any, action: 'approve' | 'reject') => {
    try {
      await api.post(`/refunds/${row.id}/${action}`);
      toast.success(t('common.saved'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const complete = async () => {
    try {
      await api.post(`/refunds/${completeFor.id}/complete`, { warehouseId: completeWh?.id });
      toast.success(t('common.saved'));
      setCompleteFor(null);
      setCompleteWh(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('refunds.title')} subtitle={t('refunds.startFromOrder')} />
      <DataTable
        endpoint="/refunds"
        refreshKey={refreshKey}
        extraParams={statusFilter ? { status: statusFilter } : undefined}
        filters={
          <Select className="w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'].map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </Select>
        }
        onRowClick={(r) => setDetailsFor(r)}
        columns={[
          { key: 'number', label: t('quotations.number'), className: 'w-28', render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          {
            key: 'order', label: t('nav.salesOrders'), className: 'w-28',
            render: (r) => <EntityLink href={linkTo.salesOrder(r.invoice?.salesOrder?.id)} mono>{r.invoice?.salesOrder?.number}</EntityLink>,
          },
          {
            key: 'client', label: t('common.client'),
            render: (r) => <EntityLink href={linkTo.client(r.clientId)}>{r.client?.name}</EntityLink>,
          },
          { key: 'createdAt', label: t('common.date'), className: 'w-24', render: (r) => fmtDate(r.createdAt) },
          {
            key: 'items', label: t('common.items'), className: 'w-20 text-end',
            render: (r) => <span className="tabular-nums">{(r.items ?? []).reduce((s: number, i: any) => s + i.quantity, 0)}</span>,
          },
          { key: 'reason', label: t('refunds.reason'), className: 'w-32', render: (r) => t(`refunds.${r.reason}`) },
          { key: 'totalAmount', label: t('common.total'), className: 'w-28 text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.totalAmount)}</span> },
          { key: 'status', label: t('common.status'), className: 'w-32', render: (r) => <StatusChip status={r.status} /> },
          {
            key: 'actions', label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 dark:text-blue-400" title={t('refunds.details')} onClick={(e) => { e.stopPropagation(); setDetailsFor(r); }}>
                  <Eye />
                </Button>
                {r.invoice?.salesOrderId && (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 dark:text-green-400" title={t('orders.viewOrder')} onClick={(e) => { e.stopPropagation(); router.push(`/sales-orders/${r.invoice.salesOrderId}`); }}>
                      <ShoppingCart />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-purple-600 dark:text-purple-400" title={t('refunds.orderBefore')} onClick={(e) => { e.stopPropagation(); showOrderBefore(r); }}>
                      <History />
                    </Button>
                  </>
                )}
                {r.status === 'PENDING' && (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" title={t('refunds.approve')} onClick={(e) => { e.stopPropagation(); act(r, 'approve'); }}>
                      <Check />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title={t('refunds.reject')} onClick={(e) => { e.stopPropagation(); act(r, 'reject'); }}>
                      <X />
                    </Button>
                  </>
                )}
                {r.status === 'APPROVED' && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title={t('refunds.complete')} onClick={(e) => { e.stopPropagation(); setCompleteFor(r); }}>
                    <PackageCheck />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Refund details */}
      <Dialog open={!!detailsFor} onOpenChange={(v) => !v && setDetailsFor(null)}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detailsFor?.number}
              {detailsFor && <StatusChip status={detailsFor.status} />}
              {detailsFor && <Badge variant="outline">{t(`refunds.${detailsFor.reason}`)}</Badge>}
              {detailsFor && <Badge variant="outline">{t(`refunds.${detailsFor.method}`)}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {detailsFor && (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span><span className="text-muted-foreground">{t('common.client')}: </span><b>{detailsFor.client?.name}</b></span>
                <span><span className="text-muted-foreground">{t('nav.salesOrders')}: </span><b className="font-mono text-xs">{detailsFor.invoice?.salesOrder?.number ?? '—'}</b></span>
                <span><span className="text-muted-foreground">{t('common.date')}: </span><b>{fmtDate(detailsFor.createdAt)}</b></span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.product')}</TableHead>
                    <TableHead className="w-20 text-end">{t('common.quantity')}</TableHead>
                    <TableHead className="w-28 text-end">{t('common.unitPrice')}</TableHead>
                    <TableHead className="w-32">{t('refunds.condition')}</TableHead>
                    <TableHead>{t('inventory.serials')}</TableHead>
                    <TableHead className="w-28 text-end">{t('common.lineTotal')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detailsFor.items ?? []).map((i: any) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="font-medium">{i.product?.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{i.product?.sku}</div>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmtMoney(i.unitPrice)}</TableCell>
                      <TableCell><Badge variant={i.condition === 'DAMAGED' ? 'destructive' : 'success'}>{t(`refunds.${i.condition}`)}</Badge></TableCell>
                      <TableCell className="font-mono text-xs" dir="ltr">{Array.isArray(i.serialNumbers) && i.serialNumbers.length ? i.serialNumbers.join(', ') : '—'}</TableCell>
                      <TableCell className="text-end tabular-nums font-medium">{fmtMoney(Number(i.quantity) * Number(i.unitPrice))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end text-sm font-bold">
                {t('common.total')}: <span className="ms-2 tabular-nums">{fmtMoney(detailsFor.totalAmount)}</span>
              </div>
              {detailsFor.notes && <p className="text-sm text-muted-foreground">{detailsFor.notes}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Order as originally sold (pre-refund) */}
      <Dialog open={!!orderBefore} onOpenChange={(v) => !v && setOrderBefore(null)}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {t('refunds.orderBefore')} — <span className="font-mono text-sm">{orderBefore?.number}</span>
              {orderBefore && <StatusChip status={orderBefore.status} />}
            </DialogTitle>
          </DialogHeader>
          {orderBefore && (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span><span className="text-muted-foreground">{t('common.client')}: </span><b>{orderBefore.client?.name}</b></span>
                <span><span className="text-muted-foreground">{t('common.date')}: </span><b>{fmtDate(orderBefore.orderDate)}</b></span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.product')}</TableHead>
                    <TableHead className="w-20 text-end">{t('common.quantity')}</TableHead>
                    <TableHead className="w-28 text-end">{t('common.unitPrice')}</TableHead>
                    <TableHead className="w-28 text-end">{t('common.lineTotal')}</TableHead>
                    <TableHead className="w-24 text-end">{t('refunds.refunded')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(orderBefore.items ?? []).map((i: any) => {
                    const refundedQty = orderBefore.refundedByProduct?.[i.productId] ?? 0;
                    return (
                      <TableRow key={i.id}>
                        <TableCell>
                          <div className="font-medium">{i.product?.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{i.product?.sku}</div>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">{i.quantity}</TableCell>
                        <TableCell className="text-end tabular-nums">{fmtMoney(i.unitPrice)}</TableCell>
                        <TableCell className="text-end tabular-nums font-medium">{fmtMoney(i.lineTotal)}</TableCell>
                        <TableCell className="text-end tabular-nums">
                          {refundedQty > 0 ? <span className="font-semibold text-amber-600 dark:text-amber-400">{refundedQty}</span> : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex flex-col items-end gap-1 text-sm">
                <div className="font-bold">{t('common.total')}: <span className="ms-2 tabular-nums">{fmtMoney(orderBefore.total)}</span></div>
                {Number(orderBefore.refundedTotal) > 0 && (
                  <>
                    <div className="text-amber-600 dark:text-amber-400">{t('refunds.refunded')}: <span className="ms-2 tabular-nums">−{fmtMoney(orderBefore.refundedTotal)}</span></div>
                    <div className="font-semibold">{t('refunds.netAfterRefunds')}: <span className="ms-2 tabular-nums">{fmtMoney(Number(orderBefore.total) - Number(orderBefore.refundedTotal))}</span></div>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Complete refund */}
      <Dialog open={!!completeFor} onOpenChange={(v) => !v && setCompleteFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('refunds.complete')} — {completeFor?.number}</DialogTitle></DialogHeader>
          <Field label={t('refunds.restockWarehouse')}>
            <WarehousePicker value={completeWh} onChange={setCompleteWh} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={complete} disabled={!completeWh}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
