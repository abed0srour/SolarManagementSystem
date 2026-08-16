'use client';
import { ShoppingCart as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, CheckCircle2, Truck, XCircle, Undo2, Pencil, FileDown, MessageCircle, Banknote, Trash2, RotateCcw } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, downloadFile } from '../../../lib/api';
import { openWhatsApp, waMoney } from '../../../lib/whatsapp';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import EntityLink, { linkTo } from '../../../components/entity-link';
import SerialSelector from '../../../components/serial-selector';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function SalesOrdersPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('');
  const [confirmFor, setConfirmFor] = useState<any>(null);
  const [serialInputs, setSerialInputs] = useState<Record<string, string[]>>({});
  const [deliverFor, setDeliverFor] = useState<any>(null);
  const [deliverQty, setDeliverQty] = useState<Record<string, number>>({});
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [archived, setArchived] = useState(false);
  const [payFor, setPayFor] = useState<any>(null);
  const [payForm, setPayForm] = useState<any>({});

  const restore = async (row: any) => {
    try {
      await api.post(`/sales-orders/${row.id}/restore`);
      toast.success(t('common.saved'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const openPay = (row: any) => {
    setPayFor(row);
    setPayForm({ amount: row.outstanding, method: 'CASH', reference: '', paymentDate: new Date().toISOString().slice(0, 10) });
  };

  const doPay = async () => {
    try {
      await api.post(`/sales-orders/${payFor.id}/pay`, {
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined,
        paymentDate: payForm.paymentDate || undefined,
      });
      toast.success(t('common.saved'));
      setPayFor(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Legacy entry point: /sales-orders?clientId=… now redirects to the client's
  // own new-order page, which is where that flow lives.
  useEffect(() => {
    const clientId = searchParams.get('clientId');
    if (clientId) router.replace(`/clients/${clientId}/new-order`);
  }, [searchParams, router]);

  const openConfirm = async (row: any) => {
    const { data } = await api.get(`/sales-orders/${row.id}`);
    setConfirmFor(data);
    setSerialInputs({});
  };

  const doConfirm = async () => {
    try {
      const serialAssignments = Object.entries(serialInputs)
        .filter(([, v]) => v.length > 0)
        .map(([productId, serialNumbers]) => ({ productId, serialNumbers }));
      await api.post(`/sales-orders/${confirmFor.id}/confirm`, { serialAssignments: serialAssignments.length ? serialAssignments : undefined });
      toast.success(t('common.saved'));
      setConfirmFor(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const openDeliver = async (row: any) => {
    const { data } = await api.get(`/sales-orders/${row.id}`);
    setDeliverFor(data);
    setDeliverQty(Object.fromEntries(data.items.map((i: any) => [i.id, i.quantity - i.deliveredQty])));
  };

  const doDeliver = async () => {
    try {
      const deliveries = Object.entries(deliverQty)
        .filter(([, q]) => Number(q) > 0)
        .map(([itemId, q]) => ({ itemId, quantity: Number(q) }));
      await api.post(`/sales-orders/${deliverFor.id}/deliver`, { deliveries });
      toast.success(t('common.saved'));
      setDeliverFor(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('orders.salesTitle')} subtitle={t('subtitles.salesOrders')} />
      <DataTable
        endpoint="/sales-orders"
        refreshKey={refreshKey}
        archived={archived}
        onArchivedChange={setArchived}
        extraParams={{ ...(statusFilter ? { status: statusFilter } : {}), ...(paymentStatusFilter ? { paymentStatus: paymentStatusFilter } : {}) }}
        onRowClick={(r) => router.push(`/sales-orders/${r.id}`)}
        filters={
          <>
            <Select className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {['PENDING', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>{t(`status.${s}`)}</option>
              ))}
            </Select>
            <Select className="w-36" value={paymentStatusFilter} onChange={(e) => setPaymentStatusFilter(e.target.value)}>
              <option value="">{t('orders.paymentStatus')}</option>
              <option value="UNPAID">{t('status.UNPAID')}</option>
            </Select>
          </>
        }
        toolbar={
          <Button onClick={() => router.push('/sales-orders/new')}>
            <Plus /> {t('orders.newSalesOrder')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), className: 'w-28', render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          {
            key: 'client', label: t('common.client'),
            render: (r) => <EntityLink href={linkTo.client(r.clientId)}>{r.client?.name}</EntityLink>,
          },
          { key: 'orderDate', label: t('common.date'), className: 'w-24 whitespace-nowrap', render: (r) => fmtDate(r.orderDate) },
          { key: 'total', label: t('common.total'), className: 'w-28 text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.total)}</span> },
          {
            key: 'paidAmount', label: t('orders.paid'), className: 'w-28 text-end',
            render: (r) => <span className="tabular-nums text-green-600 dark:text-green-400">{fmtMoney(r.paidAmount ?? 0)}</span>,
          },
          {
            key: 'outstanding', label: t('orders.remaining'), className: 'w-28 text-end',
            render: (r) => (
              <span className={`tabular-nums ${Number(r.outstanding) > 0 && r.status !== 'CANCELLED' ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                {fmtMoney(r.outstanding ?? 0)}
              </span>
            ),
          },
          { key: 'status', label: t('common.status'), className: 'w-32', render: (r) => <StatusChip status={r.status} /> },
          {
            key: 'actions', label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                {r.status === 'PENDING' && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" title={t('common.edit')} onClick={(e) => { e.stopPropagation(); router.push(`/sales-orders/${r.id}/edit`); }}>
                    <Pencil />
                  </Button>
                )}
                {r.status === 'PENDING' && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title={t('orders.confirmOrder')} onClick={(e) => { e.stopPropagation(); openConfirm(r); }}>
                    <CheckCircle2 />
                  </Button>
                )}
                {['CONFIRMED', 'PARTIALLY_DELIVERED'].includes(r.status) && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title={t('orders.deliver')} onClick={(e) => { e.stopPropagation(); openDeliver(r); }}>
                    <Truck />
                  </Button>
                )}
                {r.status !== 'CANCELLED' && Number(r.outstanding) > 0 && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 dark:text-green-400" title={t('orders.pay')} onClick={(e) => { e.stopPropagation(); openPay(r); }}>
                    <Banknote />
                  </Button>
                )}
                {['CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED'].includes(r.status) && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" title={t('refunds.newRefund')} onClick={(e) => { e.stopPropagation(); router.push(`/sales-orders/${r.id}/refund`); }}>
                    <Undo2 />
                  </Button>
                )}
                {r.status !== 'CANCELLED' && (
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 text-blue-600 dark:text-blue-400" title={t('orders.invoicePdf')}
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await downloadFile(`/sales-orders/${r.id}/invoice-pdf`, `invoice-${r.number}.pdf`);
                        setRefreshKey((k) => k + 1);
                      } catch (err) {
                        toast.error(errMsg(err));
                      }
                    }}
                  >
                    <FileDown />
                  </Button>
                )}
                {r.status !== 'CANCELLED' && (
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 text-green-600 dark:text-green-400" title={t('orders.shareInvoice')}
                    onClick={(e) => {
                      e.stopPropagation();
                      const balance = Number(r.outstanding ?? 0);
                      const text = t('orders.waInvoiceMessage', {
                        number: r.number,
                        total: waMoney(r.total),
                        balance: waMoney(balance),
                        // Under a cent is settled — the note says so rather than
                        // leaving the customer to read "$0.00" and wonder.
                        paidInFull: balance < 0.01 ? 'yes' : 'no',
                      });
                      // The chat opens with the greeting typed; the invoice PDF
                      // is attached there by hand — wa.me cannot carry a file.
                      if (!openWhatsApp(r.client?.phone, text)) toast.warning(t('common.waNoNumber'));
                    }}
                  >
                    <MessageCircle />
                  </Button>
                )}
                {r.cancellable && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title={t('orders.cancelOrder')} onClick={(e) => { e.stopPropagation(); setCancelTarget(r); }}>
                    <XCircle />
                  </Button>
                )}
                {/*
                  Only a cancelled order can be removed, so nothing else in this
                  row needs an `archived` guard: every archived order is a
                  cancelled one, and none of the actions above render for those.
                */}
                {!archived && r.status === 'CANCELLED' && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 dark:text-red-400" title={t('common.delete')} onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}>
                    <Trash2 />
                  </Button>
                )}
                {archived && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 dark:text-emerald-400" title={t('common.restore')} onClick={(e) => { e.stopPropagation(); restore(r); }}>
                    <RotateCcw />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />


      {/* Confirm w/ serials */}
      <Dialog open={!!confirmFor} onOpenChange={(v) => !v && setConfirmFor(null)}>
        <DialogContent wide>
          <DialogHeader><DialogTitle>{t('orders.confirmOrder')} — {confirmFor?.number}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {(confirmFor?.items ?? []).map((i: any) => (
              <div key={i.id}>
                <div className="mb-1.5 text-sm font-medium">
                  {i.product?.name} <span className="text-muted-foreground">× {i.quantity}</span>
                </div>
                {i.product?.trackSerials && (
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={doConfirm}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deliver */}
      <Dialog open={!!deliverFor} onOpenChange={(v) => !v && setDeliverFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('orders.deliver')} — {deliverFor?.number}</DialogTitle></DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.product')}</TableHead>
                <TableHead className="text-end">{t('orders.delivered')}</TableHead>
                <TableHead className="w-28">{t('common.quantity')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(deliverFor?.items ?? []).map((i: any) => (
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
            <Button variant="outline" onClick={() => setDeliverFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={doDeliver}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay */}
      <Dialog open={!!payFor} onOpenChange={(v) => !v && setPayFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('orders.pay')} — {payFor?.number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-between rounded-md bg-muted p-3 text-sm">
              <span>{t('common.total')}: <b className="tabular-nums">{fmtMoney(payFor?.total ?? 0)}</b></span>
              <span>{t('orders.paid')}: <b className="tabular-nums">{fmtMoney(payFor?.paidAmount ?? 0)}</b></span>
              <span>{t('orders.remaining')}: <b className="tabular-nums">{fmtMoney(payFor?.outstanding ?? 0)}</b></span>
            </div>
            <Field label={t('common.amount')}>
              <Input type="number" min={0.01} step="0.01" value={payForm.amount ?? ''} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
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
            <Button variant="outline" onClick={() => setPayFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={doPay} disabled={!Number(payForm.amount)}>{t('orders.pay')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(v) => !v && setCancelTarget(null)}
        description={t('orders.confirmCancels')}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            await api.post(`/sales-orders/${cancelTarget.id}/cancel`);
            toast.success(t('common.saved'));
            setRefreshKey((k) => k + 1);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        description={t('orders.confirmDeleteOrder')}
        requireText={t('common.deleteWord')}
        usagePath={deleteTarget ? `/sales-orders/${deleteTarget.id}/usage` : undefined}
        onConfirm={async () => {
          try {
            const { data } = await api.delete(`/sales-orders/${deleteTarget.id}`);
            // An order cancelled before anything came of it is deleted outright;
            // one that left invoices or stock movements behind is archived.
            toast.success(data?.mode === 'PURGED' ? t('common.purgedToast') : t('common.archivedToast'));
            setRefreshKey((k) => k + 1);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
