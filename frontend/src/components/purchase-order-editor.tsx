'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2, Truck, PackagePlus, XCircle } from 'lucide-react';
import { api, errMsg, fmtMoney } from '../lib/api';
import StatusChip from './status-chip';
import ConfirmDialog from './confirm-dialog';
import Field from './form-field';
import { SupplierPicker, WarehousePicker, ProductPicker } from './entity-picker';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FormattedNumberInput } from './ui/formatted-number-input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

interface PoLine {
  product: any | null;
  quantity: number | string;
  unitCost: number | string;
}

/**
 * Full-page purchase order editor — used for both creating a new PO and
 * editing a draft/sent one. A dialog doesn't give a large item list enough
 * room to work with, so this is a standalone page instead.
 */
export default function PurchaseOrderEditor({ editing }: { editing: any | null }) {
  const t = useTranslations();
  const router = useRouter();
  const editable = !editing || ['DRAFT', 'SENT'].includes(editing.status);

  const [form, setForm] = useState<any>(() =>
    editing
      ? {
          supplier: editing.supplier,
          warehouse: editing.warehouse,
          expectedDelivery: editing.expectedDelivery ? editing.expectedDelivery.slice(0, 10) : '',
          currency: editing.currency ?? 'USD',
          exchangeRate: editing.exchangeRate !== undefined ? String(editing.exchangeRate) : '1',
          notes: editing.notes ?? '',
          hasDeliveryCost: editing.hasDeliveryCost ?? false,
          deliveryCost: editing.deliveryCost !== undefined ? String(editing.deliveryCost) : '0',
        }
      : { supplier: null, warehouse: null, expectedDelivery: '', currency: 'USD', exchangeRate: '1', notes: '', hasDeliveryCost: false, deliveryCost: '0' },
  );
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [lines, setLines] = useState<PoLine[]>(() =>
    editing
      ? (editing.items ?? []).map((i: any) => ({
          product: { id: i.productId, name: i.product?.name ?? '', sku: i.product?.sku ?? '', costPrice: i.unitCost },
          quantity: i.quantity,
          unitCost: Number(i.unitCost),
        }))
      : [{ product: null, quantity: 1, unitCost: '' }],
  );
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Load warehouses. If exactly 1 exists, auto-assign it on new purchase orders.
  useEffect(() => {
    let cancelled = false;
    api
      .get('/inventory/warehouses')
      .then((r) => {
        if (cancelled) return;
        const list: any[] = Array.isArray(r.data) ? r.data : (r.data.items ?? []);
        setWarehouses(list);
        if (list.length === 1 && !editing) {
          setForm((f: any) => ({ ...f, warehouse: list[0] }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [editing]);

  const setLine = (idx: number, patch: Partial<PoLine>) => setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const totalQty = lines.filter((l) => l.product).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const subtotal = lines.filter((l) => l.product).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const deliveryCost = form.hasDeliveryCost ? Number(form.deliveryCost) || 0 : 0;
  const deliveryCostPerUnit = form.hasDeliveryCost && totalQty > 0 ? deliveryCost / totalQty : 0;
  const total = subtotal + deliveryCost;

  const validate = () => {
    if (!form.supplier) {
      toast.error(t('orders.selectSupplier') || 'Please select a supplier');
      return false;
    }
    const effectiveWarehouse = form.warehouse || (warehouses.length === 1 ? warehouses[0] : null);
    if (!effectiveWarehouse) {
      toast.error(t('orders.selectWarehouse') || 'Please select a warehouse');
      return false;
    }
    const activeLines = lines.filter((l) => l.product);
    if (activeLines.length === 0) {
      toast.error(t('orders.addAtLeastOneProduct') || 'Please add at least one product to the order');
      return false;
    }
    for (const l of activeLines) {
      if (l.quantity === '' || Number.isNaN(Number(l.quantity)) || Number(l.quantity) <= 0) {
        toast.error(t('orders.invalidQuantity') || `Please enter a valid quantity for ${l.product.name}`);
        return false;
      }
      if (l.unitCost === '' || Number.isNaN(Number(l.unitCost)) || Number(l.unitCost) < 0) {
        toast.error(t('orders.invalidUnitCost') || `Please enter a valid unit cost for ${l.product.name}`);
        return false;
      }
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const effectiveWarehouse = form.warehouse || (warehouses.length === 1 ? warehouses[0] : null);
      const payload = {
        supplierId: form.supplier?.id,
        warehouseId: effectiveWarehouse?.id,
        expectedDelivery: form.expectedDelivery || undefined,
        currency: form.currency || 'USD',
        exchangeRate: form.exchangeRate === '' ? 1 : Number(form.exchangeRate) || 1,
        notes: form.notes || undefined,
        hasDeliveryCost: form.hasDeliveryCost,
        deliveryCost: form.hasDeliveryCost ? Number(form.deliveryCost) || 0 : 0,
        items: lines.filter((l) => l.product).map((l) => ({ productId: l.product.id, quantity: Number(l.quantity), unitCost: Number(l.unitCost) || 0 })),
      };
      if (editing) await api.patch(`/purchase-orders/${editing.id}`, payload);
      else await api.post('/purchase-orders', payload);
      toast.success(t('common.saved'));
      router.push('/purchase-orders');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const isCancellable = editing && editing.status !== 'CANCELLED' && (editing.cancellable ?? (
    (editing.items ?? []).every((i: any) => !i.receivedQty) && Number(editing.paidAmount ?? 0) === 0
  ));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/purchase-orders')}>
          <ArrowLeft />
        </Button>
        <h1 className="text-xl font-bold md:text-2xl">{editing ? editing.number : t('orders.newPurchaseOrder')}</h1>
        {editing && <StatusChip status={editing.status} />}
      </div>

      <Card>
        <CardHeader><CardTitle>{t('common.details')}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('common.supplier')} className="sm:col-span-2">
            <SupplierPicker value={form.supplier} onChange={(s) => setForm({ ...form, supplier: s })} />
          </Field>
          <Field label={t('common.warehouse')} className="sm:col-span-2">
            {warehouses.length === 1 && !editing ? (
              <Input
                value={form.warehouse?.name || warehouses[0]?.name || ''}
                disabled
                className="bg-muted/40 font-medium cursor-not-allowed"
              />
            ) : (
              <WarehousePicker value={form.warehouse} onChange={(w) => setForm({ ...form, warehouse: w })} />
            )}
          </Field>
          <Field label={t('orders.expectedDelivery')}>
            <Input type="date" disabled={!editable} value={form.expectedDelivery ?? ''} onChange={(e) => setForm({ ...form, expectedDelivery: e.target.value })} />
          </Field>
          <Field label={t('common.currency')}>
            <Input disabled={!editable} placeholder="USD" value={form.currency ?? 'USD'} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </Field>
          <Field label={t('orders.exchangeRate')}>
            <Input type="number" min={0} step="0.000001" placeholder="1.00" disabled={!editable} value={form.exchangeRate ?? ''} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} />
          </Field>
          <Field label={t('common.notes')}>
            <Input disabled={!editable} placeholder={t('quotations.notesPlaceholder') || 'Optional notes...'} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" />{t('orders.deliveryCost')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              disabled={!editable}
              checked={!!form.hasDeliveryCost}
              onChange={(e) => setForm({ ...form, hasDeliveryCost: e.target.checked })}
            />
            {t('orders.hasDeliveryCost')}
          </label>
          {form.hasDeliveryCost && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('orders.deliveryCost')}>
                <FormattedNumberInput
                  disabled={!editable}
                  placeholder="0.00"
                  value={form.deliveryCost ?? ''}
                  onChange={(e) => setForm({ ...form, deliveryCost: e.target.value })}
                />
              </Field>
              <div className="sm:col-span-2 flex items-end">
                <p className="text-sm text-muted-foreground">
                  {t('orders.deliveryCostHint', { perUnit: deliveryCostPerUnit.toFixed(4), qty: totalQty })}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('common.items')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">{t('common.product')}</TableHead>
                  <TableHead className="w-36 min-w-32">{t('common.quantity')}</TableHead>
                  <TableHead className="w-40 min-w-36">{t('orders.unitCost')}</TableHead>
                  {editing && <TableHead className="w-28 text-end">{t('orders.received')}</TableHead>}
                  <TableHead className="w-32 text-end">{t('common.lineTotal')}</TableHead>
                  {editable && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">{t('common.noResults')}</TableCell>
                  </TableRow>
                )}
                {lines.map((l, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      {editable ? (
                        <ProductPicker value={l.product} onChange={(p) => setLine(idx, { product: p, unitCost: p ? (Number(p.costPrice) || '') : '' })} />
                      ) : (
                        <div>
                          <div className="font-medium">{l.product?.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{l.product?.sku}</div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="min-w-32">
                      <Input
                        type="number"
                        min={1}
                        className="tabular-nums"
                        placeholder="1"
                        disabled={!editable}
                        value={l.quantity}
                        onChange={(e) => setLine(idx, { quantity: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="min-w-36">
                      <FormattedNumberInput
                        className="text-end tabular-nums"
                        placeholder="0.00"
                        disabled={!editable}
                        value={l.unitCost}
                        onChange={(e) => setLine(idx, { unitCost: e.target.value })}
                      />
                    </TableCell>
                    {editing && (
                      <TableCell className="text-end tabular-nums text-muted-foreground">
                        {editing.items?.find((i: any) => i.productId === l.product?.id)?.receivedQty ?? 0}/{l.quantity}
                      </TableCell>
                    )}
                    <TableCell className="text-end tabular-nums">{fmtMoney((Number(l.quantity) || 0) * (Number(l.unitCost) || 0), form.currency)}</TableCell>
                    {editable && (
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {editable && (
            <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { product: null, quantity: 1, unitCost: '' }])}>
              <Plus /> {t('common.addLine')}
            </Button>
          )}

          <div className="flex justify-end border-t pt-4">
            <div className="w-full sm:w-72 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('common.subtotal')}</span><span className="tabular-nums">{fmtMoney(subtotal, form.currency)}</span></div>
              {form.hasDeliveryCost && (
                <div className="flex justify-between"><span className="text-muted-foreground">{t('orders.deliveryCost')}</span><span className="tabular-nums">{fmtMoney(deliveryCost, form.currency)}</span></div>
              )}
              <div className="flex justify-between border-t pt-1 text-base font-bold"><span>{t('common.total')}</span><span className="tabular-nums">{fmtMoney(total, form.currency)}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2 pb-4">
        <Button variant="outline" onClick={() => router.push('/purchase-orders')}>{t('common.cancel')}</Button>
        {isCancellable && (
          <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => setCancelOpen(true)}>
            <XCircle /> {t('orders.cancelOrder')}
          </Button>
        )}
        {editing && editing.status === 'CANCELLED' && (
          <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteOpen(true)}>
            <Trash2 /> {t('common.delete')}
          </Button>
        )}
        {editable && (
          <Button onClick={save} disabled={saving}>
            <PackagePlus /> {t('common.save')}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        description={t('orders.confirmCancelPurchaseOrder')}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            await api.post(`/purchase-orders/${editing.id}/cancel`);
            toast.success(t('common.saved'));
            router.push('/purchase-orders');
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        description={t('orders.confirmDeletePurchaseOrder')}
        requireText={t('common.deleteWord')}
        usagePath={editing ? `/purchase-orders/${editing.id}/usage` : undefined}
        onConfirm={async () => {
          try {
            const { data } = await api.delete(`/purchase-orders/${editing.id}`);
            toast.success(data?.mode === 'PURGED' ? t('common.purgedToast') : t('common.archivedToast'));
            router.push('/purchase-orders');
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
