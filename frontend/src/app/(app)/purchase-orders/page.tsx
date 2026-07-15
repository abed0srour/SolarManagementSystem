'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, PackageCheck, Trash2 } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import { SupplierPicker, WarehousePicker, ProductPicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

interface PoLine {
  product: any | null;
  quantity: number;
  unitCost: number;
}

export default function PurchaseOrdersPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [lines, setLines] = useState<PoLine[]>([{ product: null, quantity: 1, unitCost: 0 }]);
  const [statusFilter, setStatusFilter] = useState('');
  const [receiveFor, setReceiveFor] = useState<any>(null);
  const [receiveLines, setReceiveLines] = useState<Record<string, { qty: number; serials: string }>>({});

  const openCreate = () => {
    setEditing(null);
    setForm({ supplier: null, warehouse: null, expectedDelivery: '', currency: 'USD', exchangeRate: 1, notes: '', status: 'DRAFT' });
    setLines([{ product: null, quantity: 1, unitCost: 0 }]);
    setOpen(true);
  };

  const openEdit = async (row: any) => {
    const { data } = await api.get(`/purchase-orders/${row.id}`);
    setEditing(data);
    setForm({
      supplier: data.supplier,
      warehouse: data.warehouse,
      expectedDelivery: data.expectedDelivery ? data.expectedDelivery.slice(0, 10) : '',
      currency: data.currency,
      exchangeRate: Number(data.exchangeRate),
      notes: data.notes ?? '',
      status: data.status,
    });
    setLines(
      (data.items ?? []).map((i: any) => ({
        product: { id: i.productId, name: i.product?.name ?? '', sku: i.product?.sku ?? '', costPrice: i.unitCost },
        quantity: i.quantity,
        unitCost: Number(i.unitCost),
      })),
    );
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        supplierId: form.supplier?.id,
        warehouseId: form.warehouse?.id,
        expectedDelivery: form.expectedDelivery || undefined,
        currency: form.currency,
        exchangeRate: Number(form.exchangeRate) || 1,
        notes: form.notes || undefined,
        items: lines.filter((l) => l.product).map((l) => ({ productId: l.product.id, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
      };
      if (editing) await api.patch(`/purchase-orders/${editing.id}`, payload);
      else await api.post('/purchase-orders', payload);
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const setStatus = async (row: any, status: string) => {
    try {
      await api.post(`/purchase-orders/${row.id}/status`, { status });
      toast.success(t('common.saved'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const openReceive = async (row: any) => {
    const { data } = await api.get(`/purchase-orders/${row.id}`);
    setReceiveFor(data);
    setReceiveLines(Object.fromEntries(data.items.map((i: any) => [i.productId, { qty: i.quantity - i.receivedQty, serials: '' }])));
  };

  const doReceive = async () => {
    try {
      const linesPayload = Object.entries(receiveLines)
        .filter(([, v]) => Number(v.qty) > 0)
        .map(([productId, v]) => ({
          productId,
          quantity: Number(v.qty),
          serialNumbers: v.serials.trim() ? v.serials.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        }));
      await api.post(`/purchase-orders/${receiveFor.id}/receive`, { lines: linesPayload });
      toast.success(t('common.saved'));
      setReceiveFor(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const setLine = (idx: number, patch: Partial<PoLine>) => setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('orders.purchaseTitle')}</h1>
      <DataTable
        endpoint="/purchase-orders"
        refreshKey={refreshKey}
        extraParams={statusFilter ? { status: statusFilter } : undefined}
        onRowClick={openEdit}
        filters={
          <Select className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </Select>
        }
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('orders.newPurchaseOrder')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: 'supplier', label: t('common.supplier'), render: (r) => r.supplier?.name },
          { key: 'createdAt', label: t('common.date'), render: (r) => fmtDate(r.createdAt) },
          { key: 'expectedDelivery', label: t('orders.expectedDelivery'), render: (r) => fmtDate(r.expectedDelivery) },
          { key: 'total', label: t('common.total'), className: 'text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.total, r.currency)}</span> },
          { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
          {
            key: 'actions', label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                {r.status === 'DRAFT' && (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setStatus(r, 'SENT'); }}>
                    {t('status.SENT')}
                  </Button>
                )}
                {['SENT', 'PARTIALLY_RECEIVED'].includes(r.status) && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title={t('orders.receive')} onClick={(e) => { e.stopPropagation(); openReceive(r); }}>
                    <PackageCheck />
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
          <DialogHeader><DialogTitle>{editing ? editing.number : t('orders.newPurchaseOrder')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('common.supplier')} className="md:col-span-2">
              <SupplierPicker value={form.supplier} onChange={(s) => setForm({ ...form, supplier: s })} />
            </Field>
            <Field label={t('common.warehouse')} className="md:col-span-2">
              <WarehousePicker value={form.warehouse} onChange={(w) => setForm({ ...form, warehouse: w })} />
            </Field>
            <Field label={t('orders.expectedDelivery')}>
              <Input type="date" value={form.expectedDelivery ?? ''} onChange={(e) => setForm({ ...form, expectedDelivery: e.target.value })} />
            </Field>
            <Field label={t('common.currency')}>
              <Input value={form.currency ?? 'USD'} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
            </Field>
            <Field label={t('orders.exchangeRate')}>
              <Input type="number" min={0} step="0.000001" value={form.exchangeRate ?? 1} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} />
            </Field>
            <Field label={t('common.notes')}>
              <Input value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56">{t('common.product')}</TableHead>
                <TableHead className="w-24">{t('common.quantity')}</TableHead>
                <TableHead className="w-32">{t('orders.unitCost')}</TableHead>
                <TableHead className="w-28 text-end">{t('common.lineTotal')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <ProductPicker value={l.product} onChange={(p) => setLine(idx, { product: p, unitCost: p ? Number(p.costPrice) : 0 })} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" min={1} value={l.quantity} onChange={(e) => setLine(idx, { quantity: Number(e.target.value) })} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" min={0} step="0.01" value={l.unitCost} onChange={(e) => setLine(idx, { unitCost: Number(e.target.value) })} />
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{fmtMoney(l.quantity * l.unitCost, form.currency)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { product: null, quantity: 1, unitCost: 0 }])}>
              <Plus /> {t('common.addLine')}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!form.supplier || !form.warehouse || lines.filter((l) => l.product).length === 0 || (editing && !['DRAFT', 'SENT'].includes(editing.status))}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive */}
      <Dialog open={!!receiveFor} onOpenChange={(v) => !v && setReceiveFor(null)}>
        <DialogContent wide>
          <DialogHeader><DialogTitle>{t('orders.receive')} — {receiveFor?.number}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {(receiveFor?.items ?? []).map((i: any) => (
              <div key={i.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{i.product?.name}</span>
                  <span className="text-muted-foreground">{t('orders.received')}: {i.receivedQty}/{i.quantity}</span>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <Input
                    type="number" min={0} placeholder={t('common.quantity')}
                    value={receiveLines[i.productId]?.qty ?? 0}
                    onChange={(e) => setReceiveLines({ ...receiveLines, [i.productId]: { ...receiveLines[i.productId], qty: Number(e.target.value) } })}
                  />
                  {i.product?.trackSerials && (
                    <Input
                      dir="ltr" className="md:col-span-2" placeholder={t('orders.serialsHint')}
                      value={receiveLines[i.productId]?.serials ?? ''}
                      onChange={(e) => setReceiveLines({ ...receiveLines, [i.productId]: { ...receiveLines[i.productId], serials: e.target.value } })}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={doReceive}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
