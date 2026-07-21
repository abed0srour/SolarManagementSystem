'use client';
import { ShoppingCart as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, CheckCircle2, Truck, XCircle, Undo2, Pencil, FileDown, MessageCircle, Banknote } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, downloadFile } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import LineItemsEditor, { LineItem, emptyLine, toItemsPayload } from '../../../components/line-items-editor';
import ClientInfoDialog from '../../../components/client-info-dialog';
import SerialPicker from '../../../components/serial-picker';
import { ClientPicker, WarehousePicker } from '../../../components/entity-picker';
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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('');
  const [confirmFor, setConfirmFor] = useState<any>(null);
  const [serialInputs, setSerialInputs] = useState<Record<string, string[]>>({});
  const [deliverFor, setDeliverFor] = useState<any>(null);
  const [deliverQty, setDeliverQty] = useState<Record<string, number>>({});
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [clientInfo, setClientInfo] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<any>(null);
  const [payForm, setPayForm] = useState<any>({});

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

  const openCreate = (client: any = null) => {
    setEditing(null);
    setForm({ client, warehouse: null, discountType: '', discountValue: 0, shippingFee: 0, notes: '' });
    setLines([emptyLine()]);
    setOpen(true);
  };

  // "Create order" from the Clients page lands here with ?clientId=…
  useEffect(() => {
    const clientId = searchParams.get('clientId');
    if (!clientId) return;
    api.get(`/clients/${clientId}/brief`).then((r) => openCreate(r.data)).catch(() => openCreate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openEdit = async (row: any) => {
    const { data } = await api.get(`/sales-orders/${row.id}`);
    setEditing(data);
    setForm({
      client: data.client,
      warehouse: data.warehouse,
      discountType: data.discountType ?? '',
      discountValue: Number(data.discountValue),
      shippingFee: Number(data.shippingFee),
      notes: data.notes ?? '',
    });
    setLines(
      (data.items ?? []).map((i: any) => ({
        product: { id: i.productId, name: i.product?.name ?? '', sku: i.product?.sku ?? '', salePrice: i.unitPrice, trackSerials: i.product?.trackSerials },
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        discountType: i.discountType ?? '',
        discountValue: Number(i.discountValue),
      })),
    );
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        clientId: form.client?.id,
        warehouseId: form.warehouse?.id,
        discountType: form.discountType || undefined,
        discountValue: form.discountType ? Number(form.discountValue) : undefined,
        shippingFee: Number(form.shippingFee) || 0,
        notes: form.notes || undefined,
        items: toItemsPayload(lines),
      };
      if (editing) await api.patch(`/sales-orders/${editing.id}`, payload);
      else await api.post('/sales-orders', payload);
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

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
          <Button onClick={() => openCreate()}>
            <Plus /> {t('orders.newSalesOrder')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), className: 'w-28', render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          {
            key: 'client', label: t('common.client'),
            render: (r) => r.client?.name ? (
              <button className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setClientInfo(r.clientId); }}>
                {r.client.name}
              </button>
            ) : '—',
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
                  <Button variant="ghost" size="icon" className="h-8 w-8" title={t('common.edit')} onClick={(e) => { e.stopPropagation(); openEdit(r); }}>
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
                      const phone = (r.client?.phone ?? '').replace(/[^\d]/g, '');
                      const text = t('orders.waInvoiceMessage', {
                        number: r.number,
                        total: fmtMoney(r.total),
                        remaining: fmtMoney(r.outstanding ?? 0),
                      });
                      window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                    }}
                  >
                    <MessageCircle />
                  </Button>
                )}
                {!['CANCELLED', 'DELIVERED'].includes(r.status) && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title={t('orders.cancelOrder')} onClick={(e) => { e.stopPropagation(); setCancelTarget(r); }}>
                    <XCircle />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Create / edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{editing ? editing.number : t('orders.newSalesOrder')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('common.client')} className="md:col-span-2">
              <ClientPicker value={form.client} onChange={(c) => setForm({ ...form, client: c })} />
            </Field>
            <Field label={t('common.warehouse')} className="md:col-span-2">
              <WarehousePicker value={form.warehouse} onChange={(w) => setForm({ ...form, warehouse: w })} />
            </Field>
            <Field label={`${t('common.discount')} (${t('common.total')})`}>
              <Select value={form.discountType ?? ''} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
                <option value="">{t('common.none')}</option>
                <option value="PERCENT">{t('common.percent')}</option>
                <option value="FIXED">{t('common.fixed')}</option>
              </Select>
            </Field>
            {form.discountType && (
              <Field label={t('common.discount')}>
                <Input type="number" min={0} value={form.discountValue ?? 0} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} />
              </Field>
            )}
            <Field label={t('common.shipping')}>
              <Input type="number" min={0} value={form.shippingFee ?? 0} onChange={(e) => setForm({ ...form, shippingFee: e.target.value })} />
            </Field>
            <Field label={t('common.notes')}>
              <Input value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <LineItemsEditor lines={lines} onChange={setLines} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!form.client || !form.warehouse || toItemsPayload(lines).length === 0 || (editing && editing.status !== 'PENDING')}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm w/ serials */}
      <Dialog open={!!confirmFor} onOpenChange={(v) => !v && setConfirmFor(null)}>
        <DialogContent wide>
          <DialogHeader><DialogTitle>{t('orders.confirmOrder')} — {confirmFor?.number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {(confirmFor?.items ?? []).map((i: any) => (
              <div key={i.id}>
                <div className="mb-1 text-sm font-medium">
                  {i.product?.name} × {i.quantity}
                </div>
                {i.product?.trackSerials && (
                  <SerialPicker
                    productId={i.productId}
                    max={i.quantity}
                    value={serialInputs[i.productId] ?? []}
                    onChange={(serials) => setSerialInputs({ ...serialInputs, [i.productId]: serials })}
                    placeholder={t('orders.pickSerials')}
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

      <ClientInfoDialog clientId={clientInfo} onOpenChange={(v) => !v && setClientInfo(null)} />

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
    </div>
  );
}
