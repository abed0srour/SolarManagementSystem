'use client';
import { Check, Loader2, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

/**
 * How many empty slots are drawn before the rest are summarised.
 *
 * A warehouse holding several thousand un-serialised units would otherwise
 * render a placeholder row for every one of them, which helps nobody and costs
 * a very long page.
 */
const MAX_EMPTY_SLOTS_SHOWN = 40;

type Serial = {
  id: string;
  serialNumber: string;
  manufactureDate?: string | null;
  createdAt?: string;
};

type Container = {
  warehouseId: string;
  warehouseName: string;
  capacity: number;
  filled: number;
  missing: number;
  overfilled: number;
  balanced: boolean;
  serials: Serial[];
};

type ContainerResponse = {
  product: { id: string; sku: string; name: string; trackSerials: boolean };
  containers: Container[];
  totals: { capacity: number; filled: number; balanced: boolean };
};

/**
 * The serial numbers held for one product, drawn as one container per warehouse.
 *
 * A container has exactly as many slots as the warehouse has stock. Empty slots
 * are drawn rather than merely counted, because "three units on the shelf have
 * no serial recorded" is the thing this screen exists to make obvious, and a
 * number in a corner does not make it obvious.
 *
 * Nothing here can change stock quantity. Adding a serial fills a slot that
 * already existed; removing one empties it again. Quantity moves only when
 * goods are actually received, sold or adjusted.
 */
export default function SerialContainer({ productId, onChanged }: { productId: string; onChanged?: () => void }) {
  const t = useTranslations();
  const [data, setData] = useState<ContainerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/inventory/products/${productId}/serials`);
      setData(data);
    } catch (e) {
      toast.error(errMsg(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      const { data } = await fn();
      if (data?.containers) setData(data);
      else await load();
      onChanged?.();
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitAdd = async (warehouseId: string) => {
    // Accept whatever separator came out of a scanner, a spreadsheet paste or a
    // person typing: newlines, commas, tabs and semicolons all mean "next one".
    const serialNumbers = draft
      .split(/[\n,;\t]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!serialNumbers.length) return;
    const ok = await apply(() => api.post(`/inventory/products/${productId}/serials`, { warehouseId, serialNumbers }));
    if (ok) {
      toast.success(t('common.saved'));
      setDraft('');
      setAdding(null);
    }
  };

  const submitEdit = async (id: string, original: string) => {
    const serialNumber = editValue.trim();
    if (!serialNumber || serialNumber === original) {
      setEditingId(null);
      return;
    }
    const ok = await apply(async () => {
      await api.patch(`/inventory/units/${id}`, { serialNumber });
      return { data: null };
    });
    if (ok) {
      toast.success(t('common.saved'));
      setEditingId(null);
    }
  };

  const remove = async (unit: Serial) => {
    if (!confirm(t('serials.removeConfirm'))) return;
    const ok = await apply(() => api.delete(`/inventory/units/${unit.id}`));
    if (ok) toast.success(t('serials.removed'));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }
  if (!data) return null;

  if (!data.product.trackSerials) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t('serials.notTracked')}
      </div>
    );
  }
  if (!data.containers.length) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t('serials.noStock')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('serials.quantityNote')}</p>

      {data.containers.map((c) => {
        const emptyShown = Math.min(c.missing, MAX_EMPTY_SLOTS_SHOWN);
        return (
          <div key={c.warehouseId || 'unassigned'} className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium">{c.warehouseName}</div>
                <div className="text-xs text-muted-foreground">
                  {t('serials.slotsFilled', { filled: c.filled, capacity: c.capacity })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {c.balanced ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    {t('serials.balanced')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <TriangleAlert className="h-3 w-3" />
                    {c.overfilled
                      ? t('serials.overCount', { count: c.overfilled })
                      : t('serials.missingCount', { count: c.missing })}
                  </span>
                )}
                {c.missing > 0 && adding !== c.warehouseId && (
                  <Button size="sm" variant="outline" onClick={() => { setAdding(c.warehouseId); setDraft(''); }}>
                    <Plus className="h-3.5 w-3.5" />
                    {t('serials.addSerials')}
                  </Button>
                )}
              </div>
            </div>

            {adding === c.warehouseId && (
              <div className="space-y-2 border-b bg-muted/20 p-4">
                <Textarea
                  dir="ltr"
                  rows={4}
                  autoFocus
                  className="font-mono text-xs"
                  placeholder={t('serials.addPlaceholder')}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{t('serials.roomFor', { count: c.missing })}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setAdding(null); setDraft(''); }}>
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" disabled={busy || !draft.trim()} onClick={() => submitAdd(c.warehouseId)}>
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {t('common.save')}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <ul className="divide-y">
              {c.serials.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  {editingId === s.id ? (
                    <>
                      <Input
                        dir="ltr"
                        autoFocus
                        maxLength={18}
                        className="h-8 flex-1 font-mono text-xs"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitEdit(s.id, s.serialNumber);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} onClick={() => submitEdit(s.id, s.serialNumber)}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span dir="ltr" className="flex-1 truncate font-mono text-xs">
                        {s.serialNumber}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title={t('common.edit')}
                        onClick={() => { setEditingId(s.id); setEditValue(s.serialNumber); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        title={t('common.delete')}
                        disabled={busy}
                        onClick={() => remove(s)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              ))}

              {Array.from({ length: emptyShown }).map((_, i) => (
                <li
                  key={`empty-${i}`}
                  className="flex items-center gap-3 px-4 py-2 text-muted-foreground/60"
                >
                  <span className="w-8 shrink-0 text-xs tabular-nums">{c.serials.length + i + 1}</span>
                  <span className="flex-1 font-mono text-xs italic">{t('serials.emptySlot')}</span>
                </li>
              ))}
              {c.missing > emptyShown && (
                <li className="px-4 py-2 text-xs text-muted-foreground">
                  {t('serials.moreEmptySlots', { count: c.missing - emptyShown })}
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
