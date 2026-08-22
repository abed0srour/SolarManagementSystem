'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { api, errMsg, fmtMoney } from '../lib/api';
import { invalidateCache } from '../lib/cache';
import ConfirmDialog from './confirm-dialog';
import Field from './form-field';
import LineItemsEditor, { LineItem, belowCostLines, belowCostLoss, emptyLine, hasInvalidLine, linesFromStored, toItemsPayload } from './line-items-editor';
import { ClientPicker, WarehousePicker } from './entity-picker';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Skeleton } from './ui/skeleton';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-muted/40 px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

interface Props {
  /** Editing an existing order. Omit to create. */
  orderId?: string;
  /** Pre-select this client and lock the picker — used by /clients/[id]/new-order. */
  lockedClientId?: string;
  /** Where to go after saving or cancelling. */
  returnTo?: string;
  /**
   * Lines to start from, used by the scan-to-order flow. Create mode only — an
   * existing order loads its own lines and must not be overwritten.
   */
  initialLines?: LineItem[];
}

/**
 * Full-page create/edit form for a sales order.
 *
 * Replaces the old modal so the line-item table has room to breathe — each row
 * now carries its own unit price and discount, which is cramped in a dialog.
 */
export default function SalesOrderForm({
  orderId,
  lockedClientId,
  returnTo = '/sales-orders',
  initialLines,
}: Props) {
  const t = useTranslations();
  const router = useRouter();
  const editing = Boolean(orderId);

  const [form, setForm] = useState<any>({ client: null, warehouse: null, discountType: '', discountValue: 0, shippingFee: 0, notes: '', showSubItemsOnInvoice: false });
  // Seeded directly rather than in an effect: an effect would flash the empty
  // row first, and would overwrite anything edited before it ran.
  const [lines, setLines] = useState<LineItem[]>(
    !orderId && initialLines?.length ? initialLines : [emptyLine()],
  );
  const [existing, setExisting] = useState<any>(null);
  const [loading, setLoading] = useState(Boolean(orderId || lockedClientId));
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lossConfirmOpen, setLossConfirmOpen] = useState(false);

  // Pre-fill the client when creating from a client's page.
  useEffect(() => {
    if (!lockedClientId || orderId) return;
    let cancelled = false;
    api
      .get(`/clients/${lockedClientId}/brief`)
      .then((r) => !cancelled && setForm((f: any) => ({ ...f, client: r.data })))
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [lockedClientId, orderId]);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    api
      .get(`/sales-orders/${orderId}`)
      .then((r) => {
        if (cancelled) return;
        const data = r.data;
        setExisting(data);
        setForm({
          client: data.client,
          warehouse: data.warehouse,
          discountType: data.discountType ?? '',
          discountValue: Number(data.discountValue),
          shippingFee: Number(data.shippingFee),
          notes: data.notes ?? '',
          showSubItemsOnInvoice: Boolean(data.showSubItemsOnInvoice),
        });
        setLines(linesFromStored(data.items ?? []));
      })
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  /**
   * Saving a below-cost order asks first.
   *
   * The editor already marks those lines in red, but a red caption is easy to
   * miss on a long order and the price is often typed as a round number without
   * checking it against cost. The confirmation names the products and the money
   * being given away, so the loss is a decision rather than a slip.
   */
  const attemptSave = () => {
    if (!form.client) {
      toast.error(t('orders.selectClient') || 'Please select a client');
      return;
    }
    if (!form.warehouse) {
      toast.error(t('orders.selectWarehouse') || 'Please select a warehouse');
      return;
    }
    const payloadItems = toItemsPayload(lines);
    if (payloadItems.length === 0) {
      toast.error(t('orders.addAtLeastOneProduct') || 'Please add at least one product');
      return;
    }
    if (hasInvalidLine(lines)) {
      toast.error(t('orders.invalidLinesError') || 'Please enter valid quantities and prices for all items');
      return;
    }
    if (belowCostLines(lines).length > 0) setLossConfirmOpen(true);
    else void save();
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        clientId: form.client?.id,
        warehouseId: form.warehouse?.id,
        discountType: form.discountType || undefined,
        discountValue: form.discountType ? (Number(form.discountValue) || 0) : undefined,
        shippingFee: Number(form.shippingFee) || 0,
        showSubItemsOnInvoice: Boolean(form.showSubItemsOnInvoice),
        notes: form.notes || undefined,
        items: toItemsPayload(lines),
      };
      if (editing) await api.patch(`/sales-orders/${orderId}`, payload);
      else await api.post('/sales-orders', payload);
      // An order moves stock and touches the client's balance.
      invalidateCache('sales-orders', 'products', 'clients', 'inventory');
      toast.success(t('common.saved'));
      router.push(returnTo);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium">{t('common.noRecords')}</p>
        <Button variant="outline" onClick={() => router.push(returnTo)}>
          <ArrowLeft className="rtl:rotate-180" /> {t('common.cancel')}
        </Button>
      </div>
    );
  }

  // Confirmed orders have already moved stock; editing them is not allowed.
  const locked = editing && existing && existing.status !== 'PENDING';

  return (
    <div className="space-y-4">
      <Section title={t('orders.newSalesOrder')}>
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 md:grid-cols-4">
          <Field label={t('common.client')} className="md:col-span-2">
            {lockedClientId ? (
              // Fixed by the route — changing it here would contradict the URL.
              <Input value={form.client?.name ?? ''} disabled />
            ) : (
              <ClientPicker value={form.client} onChange={(c) => setForm({ ...form, client: c })} placeholder={t('clients.selectClient') || 'Select a client...'} />
            )}
          </Field>
          <Field label={t('common.warehouse')} className="md:col-span-2">
            <WarehousePicker value={form.warehouse} onChange={(w) => setForm({ ...form, warehouse: w })} placeholder={t('inventory.selectWarehouse') || 'Select a warehouse...'} />
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
              <Input
                type="number"
                min={0}
                placeholder="0.00"
                value={form.discountValue ?? ''}
                onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
              />
            </Field>
          )}
          <Field label={t('common.shipping')}>
            <Input
              type="number"
              min={0}
              placeholder="0.00"
              value={form.shippingFee ?? ''}
              onChange={(e) => setForm({ ...form, shippingFee: e.target.value })}
            />
          </Field>
          <Field label={t('common.notes')}>
            <Input
              placeholder={t('quotations.notesPlaceholder') || 'Optional notes...'}
              value={form.notes ?? ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
      </Section>

      <Section title={t('common.items')}>
        <LineItemsEditor lines={lines} onChange={setLines} />
        {/* Only meaningful once a bundle exists — otherwise there is nothing to itemise. */}
        {lines.some((l) => l.isComposite) && (
          <label className="mt-4 flex w-fit cursor-pointer items-center gap-2.5 rounded-md border bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/60">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={Boolean(form.showSubItemsOnInvoice)}
              onChange={(e) => setForm({ ...form, showSubItemsOnInvoice: e.target.checked })}
            />
            <span>{t('orders.showSubItemsOnInvoice')}</span>
            <span className="text-xs text-muted-foreground">{t('orders.showSubItemsHint')}</span>
          </label>
        )}
      </Section>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-card/90 px-4 py-3 backdrop-blur shadow-sm">
        {locked && <span className="me-auto text-sm text-muted-foreground">{t('orders.onlyPendingEditable')}</span>}
        <Button variant="outline" onClick={() => router.push(returnTo)} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={attemptSave} disabled={saving || !!locked}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>

      <ConfirmDialog
        open={lossConfirmOpen}
        onOpenChange={setLossConfirmOpen}
        title={t('orders.belowCostTitle')}
        description={t('orders.belowCostWarning', {
          items: belowCostLines(lines).map((l) => l.product?.name).join(', '),
          loss: fmtMoney(belowCostLoss(lines)),
        })}
        onConfirm={save}
      />
    </div>
  );
}
