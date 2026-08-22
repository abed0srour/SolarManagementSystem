'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Percent, DollarSign, Calendar, User, ShieldCheck, FileDown, MessageCircle } from 'lucide-react';
import { api, errMsg, fmtDate, fmtMoney, downloadFile } from '../lib/api';
import { openWhatsApp, waMoney } from '../lib/whatsapp';
import { invalidateCache } from '../lib/cache';
import ConfirmDialog from './confirm-dialog';
import Field from './form-field';
import LineItemsEditor, {
  LineItem,
  belowCostLines,
  belowCostLoss,
  emptyLine,
  hasInvalidLine,
  isLineFilled,
  lineTotal,
  linesFromStored,
  toItemsPayload,
} from './line-items-editor';
import { ClientPicker } from './entity-picker';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Skeleton } from './ui/skeleton';

function Section({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </Card>
  );
}

interface Props {
  /** Editing an existing quotation. Omit to create. */
  quotationId?: string;
  /** Pre-select this client and lock the picker. */
  lockedClientId?: string;
  /** Where to go after saving or cancelling. */
  returnTo?: string;
  /** Optional callback after successful save when used inside a modal */
  onSaved?: (quotation: any) => void;
  /** Optional cancel callback when used inside a modal */
  onCancel?: () => void;
  /** Render in modal mode (without page headers or sticky outer bars) */
  isModal?: boolean;
}

export default function QuotationForm({
  quotationId,
  lockedClientId,
  returnTo = '/quotations',
  onSaved,
  onCancel,
  isModal = false,
}: Props) {
  const t = useTranslations();
  const router = useRouter();
  const editing = Boolean(quotationId);

  const [form, setForm] = useState<any>({
    client: null,
    status: 'DRAFT',
    validUntil: '',
    discountType: '',
    discountValue: 0,
    notes: '',
  });
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [existing, setExisting] = useState<any>(null);
  const [loading, setLoading] = useState(Boolean(quotationId || lockedClientId));
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [lossConfirmOpen, setLossConfirmOpen] = useState(false);

  const downloadQuotationPdf = async (id: string, number?: string) => {
    setDownloadingPdf(true);
    try {
      await downloadFile(`/quotations/${id}/pdf`, `quotation-${number || id}.pdf`);
      toast.success(t('common.downloadPdf'));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Pre-fill the client when creating from a client's page.
  useEffect(() => {
    if (!lockedClientId || quotationId) return;
    let cancelled = false;
    api
      .get(`/clients/${lockedClientId}/brief`)
      .then((r) => !cancelled && setForm((f: any) => ({ ...f, client: r.data })))
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [lockedClientId, quotationId]);

  useEffect(() => {
    if (!quotationId) return;
    let cancelled = false;
    api
      .get(`/quotations/${quotationId}`)
      .then((r) => {
        if (cancelled) return;
        const data = r.data;
        setExisting(data);
        setForm({
          client: data.client ? { id: data.clientId, name: data.client.name } : null,
          status: data.status,
          validUntil: data.validUntil ? data.validUntil.slice(0, 10) : '',
          discountType: data.discountType ?? '',
          discountValue: data.discountValue ?? 0,
          notes: data.notes ?? '',
        });
        if (data.items?.length) {
          setLines(linesFromStored(data.items));
        }
      })
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [quotationId]);

  // Real-time financial calculations
  const itemsSubtotal = useMemo(() => {
    return lines.reduce((s, l) => s + lineTotal(l), 0);
  }, [lines]);

  const discountAmount = useMemo(() => {
    if (!form.discountType || !form.discountValue) return 0;
    const val = Number(form.discountValue) || 0;
    if (form.discountType === 'PERCENT') {
      return Math.round(((itemsSubtotal * Math.min(100, Math.max(0, val))) / 100) * 100) / 100;
    }
    return Math.min(itemsSubtotal, Math.max(0, val));
  }, [itemsSubtotal, form.discountType, form.discountValue]);

  const quotationTotal = useMemo(() => {
    return Math.max(0, itemsSubtotal - discountAmount);
  }, [itemsSubtotal, discountAmount]);

  const attemptSave = () => {
    if (!form.client) {
      toast.error(t('orders.selectClient') || 'Please select a client');
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
        status: form.status,
        validUntil: form.validUntil || undefined,
        discountType: form.discountType || undefined,
        discountValue: form.discountType ? (Number(form.discountValue) || 0) : undefined,
        notes: form.notes || undefined,
        items: toItemsPayload(lines),
      };

      let result;
      if (editing) result = await api.patch(`/quotations/${quotationId}`, payload);
      else result = await api.post('/quotations', payload);

      invalidateCache('quotations', 'clients', 'products');
      toast.success(t('common.saved'));

      const savedQuotation = result.data;
      if (!editing && savedQuotation?.id) {
        // Automatically initiate PDF download for newly created quotation
        void downloadQuotationPdf(savedQuotation.id, savedQuotation.number);
      }

      if (onSaved) {
        onSaved(savedQuotation);
      } else {
        router.push(returnTo);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium">{t('common.noRecords')}</p>
        <Button variant="outline" onClick={() => (onCancel ? onCancel() : router.push(returnTo))}>
          <ArrowLeft className="rtl:rotate-180" /> {t('common.cancel')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section 1: Customer & Quotation Info */}
      <Section title={t('quotations.generalInfo') || 'Quotation Details'} icon={FileText}>
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Client Picker */}
          <Field label={t('common.client')} className="sm:col-span-2 lg:col-span-2">
            {lockedClientId ? (
              <Input value={form.client?.name ?? ''} disabled />
            ) : (
              <ClientPicker
                value={form.client}
                onChange={(c) => setForm({ ...form, client: c })}
                required
                placeholder={t('clients.selectClient') || 'Select a client...'}
              />
            )}
          </Field>

          {/* Status */}
          <Field label={t('common.status')} className="sm:col-span-1 lg:col-span-1">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </Field>

          {/* Valid Until */}
          <Field label={t('quotations.validUntil')} className="sm:col-span-1 lg:col-span-1">
            <Input
              type="date"
              value={form.validUntil ?? ''}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
            />
          </Field>

          {/* Discount Type */}
          <Field label={`${t('common.discount')} (${t('common.type') || 'Type'})`} className="sm:col-span-1 lg:col-span-1">
            <Select
              value={form.discountType ?? ''}
              onChange={(e) => {
                const nextType = e.target.value;
                setForm({
                  ...form,
                  discountType: nextType,
                  discountValue: nextType ? form.discountValue || 0 : 0,
                });
              }}
            >
              <option value="">{t('common.none')}</option>
              <option value="PERCENT">{t('common.percent')} (%)</option>
              <option value="FIXED">{t('common.fixed')} ($)</option>
            </Select>
          </Field>

          {/* Discount Value */}
          <Field
            label={
              form.discountType === 'PERCENT'
                ? `${t('common.discount')} (%)`
                : form.discountType === 'FIXED'
                ? `${t('common.discount')} ($)`
                : t('common.discount')
            }
            className="sm:col-span-1 lg:col-span-1"
          >
            <Input
              type="number"
              min={0}
              max={form.discountType === 'PERCENT' ? 100 : undefined}
              step={form.discountType === 'PERCENT' ? '0.1' : '0.01'}
              disabled={!form.discountType}
              placeholder={!form.discountType ? '—' : '0'}
              value={form.discountType ? (form.discountValue ?? '') : ''}
              onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
            />
          </Field>

          {/* Notes */}
          <Field label={t('common.notes')} className="sm:col-span-2 lg:col-span-2">
            <Input
              placeholder={t('quotations.notesPlaceholder') || 'Optional notes or terms for the client...'}
              value={form.notes ?? ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
      </Section>

      {/* Section 2: Items & Bundles */}
      <Section title={t('common.items')} icon={FileText}>
        <LineItemsEditor lines={lines} onChange={setLines} />
      </Section>

      {/* Section 3: Summary Breakdown Card */}
      <Card className="overflow-hidden p-4 sm:p-5 bg-muted/20 border-border/80 shadow-sm">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {lines.filter(isLineFilled).length} {t('common.items')}
            </span>
            {form.validUntil && (
              <>
                <span>•</span>
                <span>{t('quotations.validUntil')}: {fmtDate(form.validUntil)}</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>{t('common.subtotal')}:</span>
              <span className="font-mono font-medium tabular-nums text-foreground">{fmtMoney(itemsSubtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <span>{t('common.discount')}:</span>
                <span className="font-mono font-medium tabular-nums">−{fmtMoney(discountAmount)}</span>
              </div>
            )}
            <div className="flex items-center gap-2 border-s ps-4 font-bold text-foreground">
              <span className="text-sm">{t('common.total')}:</span>
              <span className="font-mono text-lg text-primary tabular-nums">{fmtMoney(quotationTotal)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Footer Actions */}
      <div
        className={
          isModal
            ? 'flex items-center justify-end gap-2 pt-2'
            : 'sticky bottom-0 z-10 flex items-center justify-end gap-2 rounded-lg border bg-card/90 px-4 py-3 backdrop-blur shadow-sm'
        }
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => (onCancel ? onCancel() : router.push(returnTo))}
          disabled={saving}
        >
          {t('common.cancel')}
        </Button>
        {quotationId && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadQuotationPdf(quotationId, existing?.number)}
              disabled={downloadingPdf || saving}
            >
              <FileDown />
              {downloadingPdf ? t('common.loading') : t('common.downloadPdf')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-green-600 hover:text-green-600 dark:text-green-400"
              onClick={() => {
                const clientPhone = form.client?.phone ?? existing?.client?.phone;
                const text = t('quotations.waMessage', {
                  number: existing?.number ?? quotationId,
                  total: waMoney(quotationTotal),
                  validUntil: form.validUntil ? fmtDate(form.validUntil) : 'none',
                });
                if (!openWhatsApp(clientPhone, text)) toast.warning(t('common.waNoNumber'));
              }}
              disabled={saving}
            >
              <MessageCircle />
              {t('quotations.shareWhatsApp')}
            </Button>
          </>
        )}
        <Button type="button" onClick={attemptSave} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>

      <ConfirmDialog
        open={lossConfirmOpen}
        onOpenChange={setLossConfirmOpen}
        title={t('orders.belowCostTitle')}
        description={t('orders.belowCostWarning', {
          items: belowCostLines(lines)
            .map((l) => l.product?.name)
            .join(', '),
          loss: fmtMoney(belowCostLoss(lines)),
        })}
        onConfirm={save}
      />
    </div>
  );
}
