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

interface RefundLine {
  productId: string;
  qty: number;
  condition: string;
  serials: string[];
}

export default function OrderRefundPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [so, setSo] = useState<any>(null);
  const [mode, setMode] = useState<'WHOLE' | 'ITEMS'>('ITEMS');
  const [lines, setLines] = useState<RefundLine[]>([]);
  const [wholeCond, setWholeCond] = useState<Record<string, string>>({});
  const [soldSerials, setSoldSerials] = useState<Record<string, string[]>>({});
  const [refunded, setRefunded] = useState<Record<string, number>>({});
  const [form, setForm] = useState<any>({ reason: 'OTHER', method: 'CASH', notes: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/sales-orders/${params.id}`).then(async (r) => {
      setSo(r.data);
      setWholeCond(Object.fromEntries(r.data.items.map((i: any) => [i.productId, 'RESELLABLE'])));
      // Sold serial units of this order, grouped by product (used for whole-order refunds)
      try {
        const units = await api.get('/inventory/units', { params: { salesOrderId: r.data.id, status: 'SOLD', pageSize: 200 } });
        const grouped: Record<string, string[]> = {};
        for (const u of units.data.items ?? []) (grouped[u.productId] ??= []).push(u.serialNumber);
        setSoldSerials(grouped);
      } catch {
        setSoldSerials({});
      }
      // Quantities already refunded on this order (any non-rejected refund)
      try {
        const rf = await api.get('/refunds', { params: { salesOrderId: r.data.id, pageSize: 200 } });
        const m: Record<string, number> = {};
        for (const ref of rf.data.items ?? []) {
          if (ref.status === 'REJECTED') continue;
          for (const it of ref.items ?? []) m[it.productId] = (m[it.productId] ?? 0) + it.quantity;
        }
        setRefunded(m);
      } catch {
        setRefunded({});
      }
    }).catch((e) => toast.error(errMsg(e)));
  }, [params.id]);
  useEffect(load, [load]);

  if (!so)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );

  const itemByProduct = (productId: string) => so.items.find((i: any) => i.productId === productId);
  // Ordered minus everything already refunded on previous (non-rejected) refunds
  const refundableQty = (productId: string) =>
    Math.max(0, (itemByProduct(productId)?.quantity ?? 0) - (refunded[productId] ?? 0));
  const inThisRefund = (productId: string) =>
    mode === 'WHOLE' ? refundableQty(productId) : (lines.find((l) => l.productId === productId)?.qty ?? 0);
  const usedProducts = lines.map((l) => l.productId);
  const availableProducts = so.items.filter((i: any) => !usedProducts.includes(i.productId) && refundableQty(i.productId) > 0);

  const setLine = (idx: number, patch: Partial<RefundLine>) =>
    setLines((prev) => prev.map((l, j) => (j === idx ? { ...l, ...patch } : l)));

  const addLine = () => {
    const first = availableProducts[0];
    if (!first) return;
    setLines((prev) => [...prev, { productId: first.productId, qty: first.product?.trackSerials ? 0 : 1, condition: 'RESELLABLE', serials: [] }]);
  };

  const buildItems = () =>
    mode === 'WHOLE'
      ? so.items
          .filter((i: any) => refundableQty(i.productId) > 0)
          .map((i: any) => ({
            productId: i.productId,
            quantity: refundableQty(i.productId),
            unitPrice: Number(i.unitPrice),
            condition: wholeCond[i.productId] ?? 'RESELLABLE',
            serialNumbers: i.product?.trackSerials && soldSerials[i.productId]?.length
              ? soldSerials[i.productId].slice(0, refundableQty(i.productId))
              : undefined,
          }))
      : lines
          .filter((l) => l.qty > 0)
          .map((l) => ({
            productId: l.productId,
            quantity: l.qty,
            unitPrice: Number(itemByProduct(l.productId)?.unitPrice ?? 0),
            condition: l.condition,
            serialNumbers: l.serials.length ? l.serials : undefined,
          }));

  const refundTotal = buildItems().reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/refunds/from-order', {
        salesOrderId: so.id,
        reason: form.reason,
        method: form.method,
        notes: form.notes || undefined,
        items: buildItems(),
      });
      toast.success(t('common.saved'));
      router.push('/refunds');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{t('refunds.newRefund')} — {so.number}</h1>
        <StatusChip status={so.status} />
        <div className="ms-auto flex gap-2">
          <Button variant={mode === 'ITEMS' ? 'default' : 'outline'} onClick={() => setMode('ITEMS')}>
            <ListPlus /> {t('refunds.specificItems')}
          </Button>
          <Button variant={mode === 'WHOLE' ? 'default' : 'outline'} onClick={() => setMode('WHOLE')}>
            <CheckSquare /> {t('refunds.wholeOrder')}
          </Button>
        </div>
      </div>

      {/* Order quantities at a glance — remaining drops live as refund lines are added */}
      <Card>
        <CardHeader><CardTitle>{t('refunds.orderQuantities')}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.product')}</TableHead>
                <TableHead className="w-24 text-end">{t('common.quantity')}</TableHead>
                <TableHead className="w-32 text-end">{t('refunds.alreadyRefunded')}</TableHead>
                <TableHead className="w-28 text-end">{t('refunds.thisRefund')}</TableHead>
                <TableHead className="w-28 text-end">{t('orders.remaining')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {so.items.map((i: any) => {
                const already = refunded[i.productId] ?? 0;
                const current = Math.min(inThisRefund(i.productId), Math.max(0, i.quantity - already));
                const remaining = Math.max(0, i.quantity - already - current);
                return (
                  <TableRow key={i.id}>
                    <TableCell>
                      <div className="font-medium">{i.product?.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{i.product?.sku}</div>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{i.quantity}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {already > 0 ? <span className="font-medium text-amber-600 dark:text-amber-400">{already}</span> : '—'}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {current > 0 ? <span className="font-semibold text-destructive">−{current}</span> : '—'}
                    </TableCell>
                    <TableCell className={`text-end tabular-nums font-semibold ${remaining === 0 ? 'text-muted-foreground' : 'text-green-600 dark:text-green-400'}`}>
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
        <CardHeader><CardTitle>{t('common.items')}</CardTitle></CardHeader>
        <CardContent>
          {mode === 'WHOLE' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.product')}</TableHead>
                  <TableHead className="text-end">{t('refunds.refundQty')}</TableHead>
                  <TableHead className="text-end">{t('common.unitPrice')}</TableHead>
                  <TableHead className="w-36">{t('refunds.condition')}</TableHead>
                  <TableHead>{t('inventory.serials')}</TableHead>
                  <TableHead className="text-end">{t('common.lineTotal')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {so.items.map((i: any) => {
                  const qty = refundableQty(i.productId);
                  return (
                    <TableRow key={i.id} className={qty === 0 ? 'opacity-50' : ''}>
                      <TableCell>
                        <div className="font-medium">{i.product?.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{i.product?.sku}</div>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {qty}
                        {qty < i.quantity && <span className="text-xs text-muted-foreground"> / {i.quantity}</span>}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{fmtMoney(i.unitPrice)}</TableCell>
                      <TableCell>
                        <Select value={wholeCond[i.productId] ?? 'RESELLABLE'} onChange={(e) => setWholeCond({ ...wholeCond, [i.productId]: e.target.value })}>
                          <option value="RESELLABLE">{t('refunds.RESELLABLE')}</option>
                          <option value="DAMAGED">{t('refunds.DAMAGED')}</option>
                        </Select>
                      </TableCell>
                      <TableCell className="whitespace-normal font-mono text-xs" dir="ltr">
                        {i.product?.trackSerials ? (soldSerials[i.productId]?.slice(0, qty).join(', ') || '—') : '—'}
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-medium">{fmtMoney(qty * Number(i.unitPrice))}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="space-y-3">
              {lines.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('refunds.addLineHint')}</p>
              )}
              <Table>
                {lines.length > 0 && (
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-48">{t('common.product')}</TableHead>
                      <TableHead className="w-24">{t('refunds.refundQty')}</TableHead>
                      <TableHead className="w-36">{t('refunds.condition')}</TableHead>
                      <TableHead className="min-w-48">{t('inventory.serials')}</TableHead>
                      <TableHead className="w-28 text-end">{t('common.lineTotal')}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                )}
                <TableBody>
                  {lines.map((l, idx) => {
                    const item = itemByProduct(l.productId);
                    const tracked = !!item?.product?.trackSerials;
                    const maxQty = refundableQty(l.productId);
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          <Select
                            value={l.productId}
                            onChange={(e) => setLine(idx, { productId: e.target.value, qty: itemByProduct(e.target.value)?.product?.trackSerials ? 0 : 1, serials: [] })}
                          >
                            {so.items
                              .filter((i: any) => i.productId === l.productId || (!usedProducts.includes(i.productId) && refundableQty(i.productId) > 0))
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
                        <TableCell>
                          <Select value={l.condition} onChange={(e) => setLine(idx, { condition: e.target.value })}>
                            <option value="RESELLABLE">{t('refunds.RESELLABLE')}</option>
                            <option value="DAMAGED">{t('refunds.DAMAGED')}</option>
                          </Select>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {tracked ? (
                            // Pick the exact sold serials to take back — quantity follows the selection
                            <SerialPicker
                              productId={l.productId}
                              max={maxQty}
                              params={{ status: 'SOLD', salesOrderId: so.id }}
                              value={l.serials}
                              onChange={(serials) => setLine(idx, { serials, qty: serials.length })}
                              placeholder={t('refunds.pickSoldSerials')}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-end tabular-nums font-medium">
                          {fmtMoney(l.qty * Number(item?.unitPrice ?? 0))}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setLines(lines.filter((_, j) => j !== idx))}>
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

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <Field label={t('common.notes')} className="sm:col-span-2">
              <Textarea rows={3} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('refunds.notesPlaceholder')} />
            </Field>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm font-semibold">
              {t('refunds.refundTotal')}: <span className="tabular-nums">{fmtMoney(refundTotal)}</span>
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">
              <Button variant="outline" onClick={() => router.back()}>{t('common.cancel')}</Button>
              <Button disabled={busy || refundTotal <= 0} onClick={submit}>
                <Undo2 /> {t('refunds.newRefund')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
