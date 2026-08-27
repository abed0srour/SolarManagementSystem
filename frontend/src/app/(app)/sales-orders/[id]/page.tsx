'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  FileDown,
  Printer,
  QrCode,
  Truck,
  Undo2,
  User,
  Warehouse as WarehouseIcon,
  XCircle,
  StickyNote,
} from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, downloadFile } from '../../../../lib/api';
import StatusChip from '../../../../components/status-chip';
import ConfirmDialog from '../../../../components/confirm-dialog';
import EntityLink, { linkTo } from '../../../../components/entity-link';
import SerialSelector from '../../../../components/serial-selector';
import Field from '../../../../components/form-field';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { FormattedNumberInput } from '../../../../components/ui/formatted-number-input';
import { Select } from '../../../../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';

export default function SalesOrderDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [so, setSo] = useState<any>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [itemDetail, setItemDetail] = useState<any>(null);
  const [serialInputs, setSerialInputs] = useState<Record<string, string[]>>({});
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverQty, setDeliverQty] = useState<Record<string, number>>({});
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState<any>({});
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(() => {
    api.get(`/sales-orders/${params.id}`).then((r) => setSo(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [params.id]);
  useEffect(load, [load]);

  if (!so)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );

  const discountLabel = (type: string | null, value: any) =>
    !type ? '—' : type === 'PERCENT' ? `${Number(value)}%` : fmtMoney(value);

  /**
   * Items still short of the serials the order needs.
   *
   * The server refuses a confirm that leaves any of these outstanding, because
   * confirming moves stock whether or not the units were recorded. Checking the
   * same rule here means the operator is told before they press the button
   * rather than after.
   */
  const missingSerials = ((so?.items ?? []) as any[]).filter(
    (i) =>
      i.productId &&
      !i.isComposite &&
      !i.product?.isService &&
      i.product?.trackSerials &&
      i.product?.requireSerialOnSale !== false &&
      (serialInputs[i.productId]?.filter(Boolean).length ?? 0) !== Number(i.quantity),
  );

  const doConfirm = async () => {
    try {
      const serialAssignments = Object.entries(serialInputs)
        .filter(([, v]) => v.length > 0)
        .map(([productId, serialNumbers]) => ({ productId, serialNumbers }));
      await api.post(`/sales-orders/${so.id}/confirm`, { serialAssignments: serialAssignments.length ? serialAssignments : undefined });
      toast.success(t('common.saved'));
      setConfirmOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /**
   * Lines on an already-confirmed order that are still short of serials.
   *
   * Stock for these left the shelf at confirmation, so what is missing is the
   * record of which units went — not the movement itself.
   */
  const unrecorded = ((so?.items ?? []) as any[])
    .filter(
      (i) =>
        i.productId &&
        !i.isComposite &&
        !i.product?.isService &&
        i.product?.trackSerials &&
        i.product?.requireSerialOnSale !== false,
    )
    .map((i) => ({
      item: i,
      assigned: (so.serialsByProduct?.[i.productId] ?? []) as string[],
      remaining: Number(i.quantity) - (so.serialsByProduct?.[i.productId]?.length ?? 0),
    }))
    .filter((row) => row.remaining > 0);

  const doAssign = async () => {
    try {
      const serialAssignments = Object.entries(serialInputs)
        .filter(([, v]) => v.filter(Boolean).length > 0)
        .map(([productId, serialNumbers]) => ({ productId, serialNumbers: serialNumbers.filter(Boolean) }));
      if (!serialAssignments.length) return;
      await api.post(`/sales-orders/${so.id}/serials`, { serialAssignments });
      toast.success(t('common.saved'));
      setAssignOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const doReissueInvoice = async () => {
    try {
      await api.post(`/sales-orders/${so.id}/reissue-invoice`);
      toast.success(t('orders.invoiceReissued'));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const doDeliver = async () => {
    try {
      const deliveries = Object.entries(deliverQty)
        .filter(([, q]) => Number(q) > 0)
        .map(([itemId, q]) => ({ itemId, quantity: Number(q) }));
      await api.post(`/sales-orders/${so.id}/deliver`, { deliveries });
      toast.success(t('common.saved'));
      setDeliverOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const doPay = async () => {
    try {
      await api.post(`/sales-orders/${so.id}/pay`, {
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined,
        paymentDate: payForm.paymentDate || undefined,
      });
      toast.success(t('common.saved'));
      setPayOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Header + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{so.number}</h1>
        <StatusChip status={so.status} />
        {so.status !== 'CANCELLED' && <StatusChip status={so.paymentStatus ?? 'UNPAID'} />}
        <div className="ms-auto flex flex-wrap gap-2 w-full sm:w-auto">
          {so.status === 'PENDING' && (
            <Button size="sm" onClick={() => { setSerialInputs({}); setConfirmOpen(true); }}>
              <CheckCircle2 /> {t('orders.confirmOrder')}
            </Button>
          )}
          {so.status !== 'PENDING' && so.status !== 'CANCELLED' && unrecorded.length > 0 && (
            <Button size="sm" variant="outline" className="text-amber-600" onClick={() => { setSerialInputs({}); setAssignOpen(true); }}>
              <QrCode /> {t('orders.assignSerials')}
            </Button>
          )}
          {['CONFIRMED', 'PARTIALLY_DELIVERED'].includes(so.status) && (
            <Button size="sm" variant="outline" onClick={() => { setDeliverQty(Object.fromEntries(so.items.map((i: any) => [i.id, i.quantity - i.deliveredQty]))); setDeliverOpen(true); }}>
              <Truck /> {t('orders.deliver')}
            </Button>
          )}
          {so.status !== 'CANCELLED' && Number(so.outstanding) > 0 && (
            <Button size="sm" variant="outline" className="text-green-600" onClick={() => { setPayForm({ amount: so.outstanding, method: 'CASH', reference: '', paymentDate: new Date().toISOString().slice(0, 10) }); setPayOpen(true); }}>
              <Banknote /> {t('orders.pay')}
            </Button>
          )}
          {['CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED'].includes(so.status) && (
            <Button size="sm" variant="outline" className="text-amber-600" onClick={() => router.push(`/sales-orders/${so.id}/refund`)}>
              <Undo2 /> {t('refunds.newRefund')}
            </Button>
          )}
          {so.status !== 'CANCELLED' && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await downloadFile(`/sales-orders/${so.id}/invoice-pdf`, `invoice-${so.number}.pdf`);
                  load(); // an invoice may have been generated
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
            >
              <FileDown /> {t('orders.invoicePdf')}
            </Button>
          )}
          {/* Opens the thermal receipt and triggers print in one step. */}
          <Button size="sm" variant="outline" onClick={() => router.push(`/sales-orders/${so.id}/receipt?print=1`)}>
            <Printer /> {t('orders.posReceipt')}
          </Button>
          {so.cancellable && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}>
              <XCircle /> {t('orders.cancelOrder')}
            </Button>
          )}
        </div>
      </div>

      {/*
        The invoice describes a different sale from the order. Every dashboard
        figure is built from invoices, so this is the state where the reports
        are quietly wrong and only this screen can tell.
      */}
      {so.invoiceOutOfDate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <div className="text-sm text-amber-700 dark:text-amber-400">
            {t('orders.invoiceOutOfDate', {
              invoiced: fmtMoney(so.invoicedTotal),
              order: fmtMoney(so.total),
            })}
          </div>
          <Button size="sm" variant="outline" onClick={doReissueInvoice}>
            {t('orders.reissueInvoice')}
          </Button>
        </div>
      )}

      {/*
        When cancelling is off the table for a reason the status does not already
        make obvious — money taken, or goods collected while still CONFIRMED —
        say so and name the route that does work. A button that has simply
        vanished reads as a bug.
      */}
      {!so.cancellable && so.cancelBlockedReason && so.cancelBlockedReason !== 'ALREADY_CANCELLED' && (
        <p className="text-xs text-muted-foreground">
          {t(`orders.cancelBlocked.${so.cancelBlockedReason}`)}
        </p>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md border bg-card p-3 text-sm">
          <div className="text-muted-foreground">{t('common.items')}</div>
          <div className="text-lg font-bold tabular-nums">{so.items.length}</div>
        </div>
        <div className="rounded-md border bg-card p-3 text-sm">
          <div className="text-muted-foreground">{t('common.total')}</div>
          <div className="text-lg font-bold tabular-nums">{fmtMoney(so.total)}</div>
        </div>
        <div className="rounded-md border bg-card p-3 text-sm">
          <div className="text-muted-foreground">{t('orders.paid')}</div>
          <div className="text-lg font-bold tabular-nums text-green-600 dark:text-green-400">{fmtMoney(so.paidAmount ?? 0)}</div>
        </div>
        <div className="rounded-md border bg-card p-3 text-sm">
          <div className="text-muted-foreground">{t('orders.remaining')}</div>
          <div className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmtMoney(so.outstanding ?? 0)}</div>
        </div>
      </div>

      {/* Order info */}
      <Card>
        <CardContent className="grid gap-2 pt-6 text-sm md:grid-cols-2">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('common.client')}:</span>
            <EntityLink href={linkTo.client(so.clientId)} className="font-medium">{so.client?.name}</EntityLink>
          </div>
          <div className="flex items-center gap-2">
            <WarehouseIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('common.warehouse')}:</span>
            <span className="font-medium">{so.warehouse?.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('common.date')}:</span>
            <span className="font-medium">{fmtDate(so.orderDate)}</span>
          </div>
          {so.notes && (
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('common.notes')}:</span>
              <span className="font-medium">{so.notes}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader><CardTitle>{t('common.items')}</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.product')}</TableHead>
                  <TableHead className="text-end">{t('common.quantity')}</TableHead>
                  <TableHead className="text-end">{t('common.unitPrice')}</TableHead>
                  <TableHead className="text-end">{t('common.discount')}</TableHead>
                  <TableHead className="text-end">{t('common.lineTotal')}</TableHead>
                  <TableHead className="text-end">{t('orders.delivered')}</TableHead>
                  <TableHead className="text-end">{t('refunds.refunded')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {so.items.map((i: any) => {
                  const refundedQty = so.refundedByProduct?.[i.productId] ?? 0;
                  return (
                    <TableRow key={i.id} className="cursor-pointer" onClick={() => setItemDetail(i)}>
                      <TableCell>
                        <div className="font-medium">{i.product?.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{i.product?.sku}</div>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmtMoney(i.unitPrice)}</TableCell>
                      <TableCell className="text-end tabular-nums">{discountLabel(i.discountType, i.discountValue)}</TableCell>
                      <TableCell className="text-end tabular-nums font-medium">{fmtMoney(i.lineTotal)}</TableCell>
                      <TableCell className="text-end tabular-nums">{i.deliveredQty}/{i.quantity}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {refundedQty > 0 ? <span className="font-semibold text-amber-600 dark:text-amber-400">{refundedQty}</span> : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('common.subtotal')}</span><span className="tabular-nums">{fmtMoney(so.subtotal)}</span></div>
              {so.discountType && (
                <div className="flex justify-between"><span className="text-muted-foreground">{t('common.discount')}</span><span className="tabular-nums">{discountLabel(so.discountType, so.discountValue)}</span></div>
              )}
              {Number(so.shippingFee) > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">{t('common.shipping')}</span><span className="tabular-nums">{fmtMoney(so.shippingFee)}</span></div>
              )}
              <div className="flex justify-between border-t pt-1 text-base font-bold"><span>{t('common.total')}</span><span className="tabular-nums">{fmtMoney(so.total)}</span></div>
              {Number(so.refundedTotal) > 0 && (
                <>
                  <div className="flex justify-between text-amber-600 dark:text-amber-400"><span>{t('refunds.refunded')}</span><span className="tabular-nums">−{fmtMoney(so.refundedTotal)}</span></div>
                  <div className="flex justify-between font-semibold"><span>{t('refunds.netAfterRefunds')}</span><span className="tabular-nums">{fmtMoney(Number(so.total) - Number(so.refundedTotal))}</span></div>
                </>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">{t('orders.paid')}</span><span className="tabular-nums">{fmtMoney(so.paidAmount ?? 0)}</span></div>
              <div className="flex justify-between font-semibold"><span>{t('orders.remaining')}</span><span className="tabular-nums">{fmtMoney(so.outstanding ?? 0)}</span></div>

              {so.profit && (
                <div className="mt-3 space-y-1 rounded-md border bg-muted/30 p-2.5">
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">{t('orders.goodsRevenue')}</span><span className="tabular-nums">{fmtMoney(so.profit.revenue)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">{t('orders.costOfGoods')}</span><span className="tabular-nums">−{fmtMoney(so.profit.cost)}</span></div>
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <span>{t('orders.profit')}</span>
                    <span className={`tabular-nums ${Number(so.profit.profit) < 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
                      {fmtMoney(so.profit.profit)}
                      <span className="ms-1.5 text-xs font-normal text-muted-foreground">{Number(so.profit.marginPct).toFixed(1)}%</span>
                    </span>
                  </div>
                  {so.profit.hasUnknownCost && (
                    <p className="pt-1 text-xs text-amber-600 dark:text-amber-400">
                      {t('orders.profitUnknownCost', { count: so.profit.unknownCostLines })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/*
        One line's detail, including the units that went out against it. Serials
        are recorded per product rather than per line, so a product appearing on
        two lines shows the same set on both — the order bought them together.
      */}
      <Dialog open={!!itemDetail} onOpenChange={(v) => !v && setItemDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{itemDetail?.product?.name ?? itemDetail?.description ?? t('common.items')}</DialogTitle>
          </DialogHeader>
          {itemDetail && (
            <div className="space-y-4">
              {itemDetail.product?.sku && (
                <div className="font-mono text-xs text-muted-foreground" dir="ltr">{itemDetail.product.sku}</div>
              )}

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <span className="text-muted-foreground">{t('common.quantity')}</span>
                <span className="text-end tabular-nums">{itemDetail.quantity}{itemDetail.unit ? ` ${itemDetail.unit}` : ''}</span>

                <span className="text-muted-foreground">{t('common.unitPrice')}</span>
                <span className="text-end tabular-nums">{fmtMoney(itemDetail.unitPrice)}</span>

                <span className="text-muted-foreground">{t('common.discount')}</span>
                <span className="text-end tabular-nums">{discountLabel(itemDetail.discountType, itemDetail.discountValue)}</span>

                <span className="text-muted-foreground">{t('common.lineTotal')}</span>
                <span className="text-end font-semibold tabular-nums">{fmtMoney(itemDetail.lineTotal)}</span>

                <span className="text-muted-foreground">{t('orders.delivered')}</span>
                <span className="text-end tabular-nums">{itemDetail.deliveredQty}/{itemDetail.quantity}</span>

                {(so.refundedByProduct?.[itemDetail.productId] ?? 0) > 0 && (
                  <>
                    <span className="text-muted-foreground">{t('refunds.refunded')}</span>
                    <span className="text-end tabular-nums text-amber-600 dark:text-amber-400">
                      {so.refundedByProduct[itemDetail.productId]}
                    </span>
                  </>
                )}
              </div>

              {itemDetail.subItems?.length > 0 && (
                <div>
                  <div className="mb-1.5 text-sm font-medium">{t('orders.bundleContents')}</div>
                  <ul className="divide-y rounded-md border text-sm">
                    {itemDetail.subItems.map((s: any) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <span className="truncate">{s.product?.name ?? s.description}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">× {s.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-1.5 text-sm font-medium">{t('inventory.serialNumber')}</div>
                {(so.serialsByProduct?.[itemDetail.productId] ?? []).length > 0 ? (
                  <ul className="divide-y rounded-md border">
                    {so.serialsByProduct[itemDetail.productId].map((serial: string, index: number) => (
                      <li key={serial} className="flex items-center gap-3 px-3 py-1.5">
                        <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                        <span dir="ltr" className="font-mono text-xs">{serial}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    {itemDetail.product?.trackSerials
                      ? t('orders.noSerialsRecorded')
                      : t('orders.productNotSerialTracked')}
                  </p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDetail(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Recording serials after the fact. Stock already moved at confirmation,
        so this names units without touching any quantity.
      */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent wide>
          <DialogHeader><DialogTitle>{t('orders.assignSerials')} — {so.number}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">{t('orders.assignSerialsHint')}</p>
          <div className="space-y-4">
            {unrecorded.map(({ item, assigned, remaining }) => (
              <div key={item.id}>
                <div className="mb-1.5 text-sm font-medium">
                  {item.product?.name}{' '}
                  <span className="text-muted-foreground">
                    — {t('orders.serialsRemaining', { count: remaining })}
                  </span>
                </div>
                {assigned.length > 0 && (
                  <p className="mb-1.5 font-mono text-xs text-muted-foreground" dir="ltr">
                    {assigned.join(', ')}
                  </p>
                )}
                <SerialSelector
                  productId={item.productId}
                  required={remaining}
                  value={serialInputs[item.productId] ?? []}
                  onChange={(serials) => setSerialInputs({ ...serialInputs, [item.productId]: serials })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={doAssign}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm with serials */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent wide>
          <DialogHeader><DialogTitle>{t('orders.confirmOrder')} — {so.number}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {so.items.map((i: any) => (
              <div key={i.id}>
                <div className="mb-1.5 text-sm font-medium">
                  {i.product?.name} <span className="text-muted-foreground">× {i.quantity}</span>
                </div>
                {i.product?.trackSerials && i.product?.requireSerialOnSale !== false && (
                  <SerialSelector
                    productId={i.productId}
                    required={i.quantity}
                    value={serialInputs[i.productId] ?? []}
                    onChange={(serials) => setSerialInputs({ ...serialInputs, [i.productId]: serials })}
                  />
                )}
              </div>
            ))}
          </div>
          {missingSerials.length > 0 && (
            <p className="px-1 text-xs text-amber-600 dark:text-amber-400">
              {t('orders.serialsIncomplete', { count: missingSerials.length })}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={doConfirm} disabled={missingSerials.length > 0}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deliver */}
      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('orders.deliver')} — {so.number}</DialogTitle></DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.product')}</TableHead>
                <TableHead className="text-end">{t('orders.delivered')}</TableHead>
                <TableHead className="w-28">{t('common.quantity')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {so.items.map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell>{i.product?.name}</TableCell>
                  <TableCell className="text-end tabular-nums">{i.deliveredQty}/{i.quantity}</TableCell>
                  <TableCell>
                    <Input type="number" min={0} max={i.quantity - i.deliveredQty} value={deliverQty[i.id] ?? 0} onChange={(e) => setDeliverQty({ ...deliverQty, [i.id]: Number(e.target.value) })} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={doDeliver}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('orders.pay')} — {so.number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-between rounded-md bg-muted p-3 text-sm">
              <span>{t('common.total')}: <b className="tabular-nums">{fmtMoney(so.total)}</b></span>
              <span>{t('orders.paid')}: <b className="tabular-nums">{fmtMoney(so.paidAmount ?? 0)}</b></span>
              <span>{t('orders.remaining')}: <b className="tabular-nums">{fmtMoney(so.outstanding ?? 0)}</b></span>
            </div>
            <Field label={t('common.amount')}>
              <FormattedNumberInput placeholder="0.00" value={payForm.amount ?? ''} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            </Field>
            <Field label={t('common.method')}>
              <Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                {['CASH', 'WHISH', 'OMT'].map((m) => (
                  <option key={m} value={m}>{t(`payments.${m}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('payments.paymentDate')}>
              <Input type="date" value={payForm.paymentDate ?? ''} onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })} />
            </Field>
            <Field label={t('common.reference')}>
              <Input value={payForm.reference ?? ''} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={doPay} disabled={!Number(payForm.amount)}>{t('orders.pay')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        description={t('orders.confirmCancels')}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            await api.post(`/sales-orders/${so.id}/cancel`);
            toast.success(t('common.saved'));
            load();
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
