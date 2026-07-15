'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, CheckCircle2, PackageCheck, XCircle, ReceiptText } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import LineItemsEditor, { LineItem, emptyLine, toItemsPayload } from '../../../components/line-items-editor';
import { ClientPicker, WarehousePicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function SalesOrdersPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmFor, setConfirmFor] = useState<any>(null);
  const [serialInputs, setSerialInputs] = useState<Record<string, string>>({});
  const [deliverFor, setDeliverFor] = useState<any>(null);
  const [deliverQty, setDeliverQty] = useState<Record<string, number>>({});
  const [invoiceFor, setInvoiceFor] = useState<any>(null);
  const [depositPct, setDepositPct] = useState('');
  const [cancelTarget, setCancelTarget] = useState<any>(null);

  const openCreate = () => {
    setEditing(null);
    setForm({ client: null, warehouse: null, discountType: '', discountValue: 0, shippingFee: 0, notes: '' });
    setLines([emptyLine()]);
    setOpen(true);
  };

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
        product: { id: i.productId, name: i.product?.name ?? '', sku: i.product?.sku ?? '', salePrice: i.unitPrice, taxRatePct: i.taxRatePct, trackSerials: i.product?.trackSerials },
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        discountType: i.discountType ?? '',
        discountValue: Number(i.discountValue),
        taxRatePct: Number(i.taxRatePct),
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
        .filter(([, v]) => v.trim())
        .map(([productId, v]) => ({ productId, serialNumbers: v.split(',').map((s) => s.trim()).filter(Boolean) }));
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

  const doInvoice = async () => {
    try {
      await api.post('/invoices/from-order', {
        salesOrderId: invoiceFor.id,
        percent: depositPct ? Number(depositPct) : undefined,
      });
      toast.success(t('common.saved'));
      setInvoiceFor(null);
      setDepositPct('');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('orders.salesTitle')}</h1>
      <DataTable
        endpoint="/sales-orders"
        refreshKey={refreshKey}
        extraParams={statusFilter ? { status: statusFilter } : undefined}
        onRowClick={openEdit}
        filters={
          <Select className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {['PENDING', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </Select>
        }
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('orders.newSalesOrder')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: 'client', label: t('common.client'), render: (r) => r.client?.name },
          { key: 'orderDate', label: t('common.date'), render: (r) => fmtDate(r.orderDate) },
          { key: 'total', label: t('common.total'), className: 'text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.total)}</span> },
          { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
          { key: 'invoices', label: t('nav.invoices'), render: (r) => (r.invoices ?? []).map((i: any) => i.number).join(', ') || '—' },
          {
            key: 'actions', label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                {r.status === 'PENDING' && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title={t('orders.confirmOrder')} onClick={(e) => { e.stopPropagation(); openConfirm(r); }}>
                    <CheckCircle2 />
                  </Button>
                )}
                {['CONFIRMED', 'PARTIALLY_DELIVERED'].includes(r.status) && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title={t('orders.deliver')} onClick={(e) => { e.stopPropagation(); openDeliver(r); }}>
                    <PackageCheck />
                  </Button>
                )}
                {r.status !== 'CANCELLED' && r.status !== 'PENDING' && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" title={t('orders.createInvoice')} onClick={(e) => { e.stopPropagation(); setInvoiceFor(r); }}>
                    <ReceiptText />
                  </Button>
                )}
                {r.status !== 'CANCELLED' && (
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
                  <Input dir="ltr" placeholder={t('orders.serialsHint')} value={serialInputs[i.productId] ?? ''} onChange={(e) => setSerialInputs({ ...serialInputs, [i.productId]: e.target.value })} />
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

      {/* Invoice from order */}
      <Dialog open={!!invoiceFor} onOpenChange={(v) => !v && setInvoiceFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('orders.createInvoice')} — {invoiceFor?.number}</DialogTitle></DialogHeader>
          <Field label={t('orders.depositPercent')}>
            <Input type="number" min={1} max={99} value={depositPct} onChange={(e) => setDepositPct(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={doInvoice}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(v) => !v && setCancelTarget(null)}
        description={t('orders.confirmCancels')}
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
