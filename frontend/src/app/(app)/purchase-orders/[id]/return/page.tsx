'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Undo2, CheckSquare, ListPlus, Plus, Trash2 } from 'lucide-react';
import { api, errMsg, fmtMoney } from '../../../../../lib/api';
import StatusChip from '../../../../../components/status-chip';
import SerialPicker from '../../../../../components/serial-picker';
import Field from '../../../../../components/form-field';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Select } from '../../../../../components/ui/select';
import { Textarea } from '../../../../../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../../components/ui/table';

interface ReturnLine {
  productId: string;
  qty: number;
  serials: string[];
  reason: string;
}

export default function PurchaseOrderReturnPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [po, setPo] = useState<any>(null);
  const [mode, setMode] = useState<'WHOLE' | 'ITEMS'>('ITEMS');
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [form, setForm] = useState<any>({
    refundMethod: 'CASH',
    creditNoteRef: '',
    notes: '',
    refundDate: new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get(`/purchase-returns/returnable/${params.id}`)
      .then((r) => setPo(r.data))
      .catch((e) => toast.error(errMsg(e)));
  }, [params.id]);
  useEffect(load, [load]);

  if (!po)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );

  const itemByProduct = (productId: string) => po.items.find((i: any) => i.productId === productId);
  const returnableQty = (productId: string) => itemByProduct(productId)?.returnableQty ?? 0;
  const inThisReturn = (productId: string) =>
    mode === 'WHOLE' ? returnableQty(productId) : lines.find((l) => l.productId === productId)?.qty ?? 0;
  const usedProducts = lines.map((l) => l.productId);
  const availableProducts = po.items.filter((i: any) => !usedProducts.includes(i.productId) && i.returnableQty > 0);

  const setLine = (idx: number, patch: Partial<ReturnLine>) =>
    setLines((prev) => prev.map((l, j) => (j === idx ? { ...l, ...patch } : l)));

  const addLine = () => {
    const first = availableProducts[0];
    if (!first) return;
    setLines((prev) => [
      ...prev,
      { productId: first.productId, qty: first.product?.trackSerials ? 0 : 1, serials: [], reason: '' },
    ]);
  };

  const buildItems = () =>
    mode === 'WHOLE'
      ? po.items
          .filter((i: any) => i.returnableQty > 0)
          .map((i: any) => ({
            productId: i.productId,
            quantity: i.returnableQty,
            unitCost: Number(i.unitCost),
            // Serial-tracked lines send back the units still in stock from this PO.
            serialNumbers:
              i.product?.trackSerials && i.availableSerials?.length
                ? i.availableSerials.slice(0, i.returnableQty)
                : undefined,
          }))
      : lines
          .filter((l) => l.qty > 0)
          .map((l) => ({
            productId: l.productId,
            quantity: l.qty,
            unitCost: Number(itemByProduct(l.productId)?.unitCost ?? 0),
            serialNumbers: l.serials.length ? l.serials : undefined,
            reason: l.reason || undefined,
          }));

  const items = buildItems();
  const returnTotal = items.reduce((s: number, i: any) => s + i.quantity * i.unitCost, 0);
  // The supplier can only hand back money we actually paid; anything above that
  // just cancels an unpaid balance. Mirrors the same clamp on the server.
  const cashBack =
    form.refundMethod === 'CREDIT_NOTE' ? 0 : Math.min(returnTotal, Number(po.paidAmount ?? 0));

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/purchase-returns', {
        purchaseOrderId: po.id,
        items,
        refundMethod: form.refundMethod,
        creditNoteRef: form.creditNoteRef || undefined,
        notes: form.notes || undefined,
        refundDate: form.refundDate || undefined,
      });
      toast.success(t('common.saved'));
      router.push('/purchase-returns');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const nothingReturnable = po.items.every((i: any) => i.returnableQty === 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">
          {t('purchaseReturns.newReturn')} — {po.number}
        </h1>
        <StatusChip status={po.status} />
        <div className="ms-auto flex gap-2">
          <Button variant={mode === 'ITEMS' ? 'default' : 'outline'} onClick={() => setMode('ITEMS')}>
            <ListPlus /> {t('refunds.specificItems')}
          </Button>
          <Button variant={mode === 'WHOLE' ? 'default' : 'outline'} onClick={() => setMode('WHOLE')}>
            <CheckSquare /> {t('purchaseReturns.wholeOrder')}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t('purchaseReturns.hint', { supplier: po.supplier?.name ?? '', warehouse: po.warehouse?.name ?? '' })}
      </p>

      {nothingReturnable && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {t('purchaseReturns.nothingReturnable')}
        </div>
      )}

      {/* Received vs returned at a glance — remaining drops live as lines are added */}
      <Card>
        <CardHeader>
          <CardTitle>{t('purchaseReturns.receivedQuantities')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.product')}</TableHead>
                <TableHead className="w-24 text-end">{t('orders.received')}</TableHead>
                <TableHead className="w-32 text-end">{t('purchaseReturns.alreadyReturned')}</TableHead>
                <TableHead className="w-28 text-end">{t('purchaseReturns.thisReturn')}</TableHead>
                <TableHead className="w-28 text-end">{t('orders.remaining')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.items.map((i: any) => {
                const current = Math.min(inThisReturn(i.productId), i.returnableQty);
                const remaining = Math.max(0, i.returnableQty - current);
                return (
                  <TableRow key={i.id}>
                    <TableCell>
                      <div className="font-medium">{i.product?.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{i.product?.sku}</div>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{i.receivedQty}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {i.returnedQty > 0 ? (
                        <span className="font-medium text-amber-600 dark:text-amber-400">{i.returnedQty}</span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {current > 0 ? <span className="font-semibold text-destructive">−{current}</span> : '—'}
                    </TableCell>
                    <TableCell
                      className={`text-end tabular-nums font-semibold ${remaining === 0 ? 'text-muted-foreground' : 'text-green-600 dark:text-green-400'}`}
                    >
                      {remaining}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('common.items')}</CardTitle>
        </CardHeader>
        <CardContent>
          {mode === 'WHOLE' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.product')}</TableHead>
                  <TableHead className="text-end">{t('purchaseReturns.returnQty')}</TableHead>
                  <TableHead className="text-end">{t('common.unitCost')}</TableHead>
                  <TableHead>{t('inventory.serials')}</TableHead>
                  <TableHead className="text-end">{t('common.lineTotal')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.items.map((i: any) => (
                  <TableRow key={i.id} className={i.returnableQty === 0 ? 'opacity-50' : ''}>
                    <TableCell>
                      <div className="font-medium">{i.product?.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{i.product?.sku}</div>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {i.returnableQty}
                      {i.returnableQty < i.receivedQty && (
                        <span className="text-xs text-muted-foreground"> / {i.receivedQty}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{fmtMoney(i.unitCost, po.currency)}</TableCell>
                    <TableCell className="whitespace-normal font-mono text-xs" dir="ltr">
                      {i.product?.trackSerials ? i.availableSerials?.slice(0, i.returnableQty).join(', ') || '—' : '—'}
                    </TableCell>
                    <TableCell className="text-end tabular-nums font-medium">
                      {fmtMoney(i.returnableQty * Number(i.unitCost), po.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="space-y-3">
              {lines.length === 0 && <p className="text-sm text-muted-foreground">{t('purchaseReturns.addLineHint')}</p>}
              <Table>
                {lines.length > 0 && (
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-48">{t('common.product')}</TableHead>
                      <TableHead className="w-24">{t('purchaseReturns.returnQty')}</TableHead>
                      <TableHead className="min-w-48">{t('inventory.serials')}</TableHead>
                      <TableHead className="min-w-32">{t('refunds.reason')}</TableHead>
                      <TableHead className="w-28 text-end">{t('common.lineTotal')}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                )}
                <TableBody>
                  {lines.map((l, idx) => {
                    const item = itemByProduct(l.productId);
                    const tracked = !!item?.product?.trackSerials;
                    const maxQty = returnableQty(l.productId);
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          <Select
                            value={l.productId}
                            onChange={(e) =>
                              setLine(idx, {
                                productId: e.target.value,
                                qty: itemByProduct(e.target.value)?.product?.trackSerials ? 0 : 1,
                                serials: [],
                              })
                            }
                          >
                            {po.items
                              .filter(
                                (i: any) =>
                                  i.productId === l.productId ||
                                  (!usedProducts.includes(i.productId) && i.returnableQty > 0),
                              )
                              .map((i: any) => (
                                <option key={i.productId} value={i.productId}>
                                  {i.product?.name} ({i.product?.sku})
                                </option>
                              ))}
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={maxQty}
                            disabled={tracked}
                            value={l.qty}
                            onChange={(e) => setLine(idx, { qty: Math.min(maxQty, Math.max(0, Number(e.target.value))) })}
                          />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {tracked ? (
                            // Only units still in stock from this PO can go back —
                            // quantity follows the selection.
                            <SerialPicker
                              productId={l.productId}
                              max={maxQty}
                              params={{ status: 'IN_STOCK', purchaseOrderId: po.id }}
                              value={l.serials}
                              onChange={(serials) => setLine(idx, { serials, qty: serials.length })}
                              placeholder={t('purchaseReturns.pickSerials')}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={l.reason}
                            onChange={(e) => setLine(idx, { reason: e.target.value })}
                            placeholder={t('purchaseReturns.reasonPlaceholder')}
                          />
                        </TableCell>
                        <TableCell className="text-end tabular-nums font-medium">
                          {fmtMoney(l.qty * Number(item?.unitCost ?? 0), po.currency)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setLines(lines.filter((_, j) => j !== idx))}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Button variant="outline" size="sm" onClick={addLine} disabled={availableProducts.length === 0}>
                <Plus /> {t('refunds.addLine')}
              </Button>
            </div>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label={t('purchaseReturns.refundMethod')}>
              <Select
                value={form.refundMethod}
                onChange={(e) => setForm({ ...form, refundMethod: e.target.value })}
              >
                {['CASH', 'WHISH', 'OMT', 'CREDIT_NOTE'].map((m) => (
                  <option key={m} value={m}>
                    {t(`purchaseReturns.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {form.refundMethod === 'CREDIT_NOTE' ? (
              <Field label={t('purchaseReturns.creditNoteRef')}>
                <Input
                  value={form.creditNoteRef ?? ''}
                  onChange={(e) => setForm({ ...form, creditNoteRef: e.target.value })}
                />
              </Field>
            ) : (
              <Field label={t('payments.paymentDate')}>
                <Input
                  type="date"
                  value={form.refundDate ?? ''}
                  onChange={(e) => setForm({ ...form, refundDate: e.target.value })}
                />
              </Field>
            )}
            <Field label={t('common.notes')} className="md:col-span-2">
              <Textarea
                rows={3}
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder={t('purchaseReturns.notesPlaceholder')}
              />
            </Field>
          </div>

          {/* What actually happens on submit, spelled out before they commit */}
          <div className="mt-4 grid gap-2 rounded-md bg-muted p-3 text-sm sm:grid-cols-3">
            <div>
              {t('purchaseReturns.returnTotal')}:{' '}
              <b className="tabular-nums">{fmtMoney(returnTotal, po.currency)}</b>
            </div>
            <div>
              {t('purchaseReturns.cashBack')}:{' '}
              <b className="tabular-nums text-green-600 dark:text-green-400">{fmtMoney(cashBack, po.currency)}</b>
            </div>
            <div>
              {t('purchaseReturns.billReduction')}:{' '}
              <b className="tabular-nums">{fmtMoney(returnTotal - cashBack, po.currency)}</b>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <div className="text-xs text-muted-foreground">{t('purchaseReturns.effect')}</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.back()}>
                {t('common.cancel')}
              </Button>
              <Button disabled={busy || items.length === 0} onClick={submit}>
                <Undo2 /> {t('purchaseReturns.confirmReturn')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
