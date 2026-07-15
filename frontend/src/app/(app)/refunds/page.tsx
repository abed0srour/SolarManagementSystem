'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Check, X, PackageCheck } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import { InvoicePicker, WarehousePicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function RefundsPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [returnRows, setReturnRows] = useState<Record<string, { qty: number; condition: string; serials: string }>>({});
  const [completeFor, setCompleteFor] = useState<any>(null);
  const [completeWh, setCompleteWh] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const pickInvoice = async (inv: any) => {
    setForm({ ...form, invoice: inv });
    if (inv) {
      const { data } = await api.get(`/invoices/${inv.id}`);
      const items = data.items.filter((i: any) => i.productId);
      setInvoiceItems(items);
      setReturnRows(Object.fromEntries(items.map((i: any) => [i.productId, { qty: 0, condition: 'RESELLABLE', serials: '' }])));
    } else {
      setInvoiceItems([]);
    }
  };

  const save = async () => {
    try {
      const items = invoiceItems
        .filter((i) => Number(returnRows[i.productId]?.qty) > 0)
        .map((i) => ({
          productId: i.productId,
          quantity: Number(returnRows[i.productId].qty),
          unitPrice: Number(i.unitPrice),
          condition: returnRows[i.productId].condition,
          serialNumbers: returnRows[i.productId].serials.trim()
            ? returnRows[i.productId].serials.split(',').map((s: string) => s.trim()).filter(Boolean)
            : undefined,
        }));
      await api.post('/refunds', {
        invoiceId: form.invoice?.id,
        reason: form.reason ?? 'OTHER',
        method: form.method ?? 'CASH',
        notes: form.notes || undefined,
        items,
      });
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
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
      <h1 className="text-2xl font-bold">{t('refunds.title')}</h1>
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
        toolbar={
          <Button onClick={() => { setForm({ reason: 'OTHER', method: 'CASH' }); setInvoiceItems([]); setOpen(true); }}>
            <Plus /> {t('refunds.newRefund')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: 'invoice', label: t('payments.invoice'), render: (r) => r.invoice?.number },
          { key: 'client', label: t('common.client'), render: (r) => r.client?.name },
          { key: 'createdAt', label: t('common.date'), render: (r) => fmtDate(r.createdAt) },
          { key: 'reason', label: t('refunds.reason'), render: (r) => t(`refunds.${r.reason}`) },
          { key: 'method', label: t('common.method'), render: (r) => t(`refunds.${r.method}`) },
          { key: 'totalAmount', label: t('common.total'), className: 'text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.totalAmount)}</span> },
          { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
          {
            key: 'actions', label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
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

      {/* New refund */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wide>
          <DialogHeader><DialogTitle>{t('refunds.newRefund')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('payments.invoice')} className="md:col-span-2">
              <InvoicePicker value={form.invoice} onChange={pickInvoice} params={{ type: 'SALE' }} />
            </Field>
            <Field label={t('refunds.reason')}>
              <Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                {['DEFECTIVE', 'WRONG_ITEM', 'CHANGE_OF_MIND', 'OTHER'].map((x) => (
                  <option key={x} value={x}>{t(`refunds.${x}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.method')}>
              <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {['CASH', 'STORE_CREDIT', 'EXCHANGE'].map((x) => (
                  <option key={x} value={x}>{t(`refunds.${x}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.notes')} className="col-span-2 md:col-span-4">
              <Textarea rows={1} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          {invoiceItems.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.product')}</TableHead>
                  <TableHead className="text-end">{t('common.quantity')}</TableHead>
                  <TableHead className="w-24">{t('refunds.title')}</TableHead>
                  <TableHead className="w-36">{t('refunds.condition')}</TableHead>
                  <TableHead className="min-w-44">{t('inventory.serials')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoiceItems.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.description}</TableCell>
                    <TableCell className="text-end tabular-nums">{i.quantity}</TableCell>
                    <TableCell>
                      <Input type="number" min={0} max={i.quantity} value={returnRows[i.productId]?.qty ?? 0} onChange={(e) => setReturnRows({ ...returnRows, [i.productId]: { ...returnRows[i.productId], qty: Number(e.target.value) } })} />
                    </TableCell>
                    <TableCell>
                      <Select value={returnRows[i.productId]?.condition ?? 'RESELLABLE'} onChange={(e) => setReturnRows({ ...returnRows, [i.productId]: { ...returnRows[i.productId], condition: e.target.value } })}>
                        <option value="RESELLABLE">{t('refunds.RESELLABLE')}</option>
                        <option value="DAMAGED">{t('refunds.DAMAGED')}</option>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input dir="ltr" value={returnRows[i.productId]?.serials ?? ''} onChange={(e) => setReturnRows({ ...returnRows, [i.productId]: { ...returnRows[i.productId], serials: e.target.value } })} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!form.invoice || !invoiceItems.some((i) => Number(returnRows[i.productId]?.qty) > 0)}>
              {t('common.save')}
            </Button>
          </DialogFooter>
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
