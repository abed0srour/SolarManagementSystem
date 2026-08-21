'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, ArrowRight, Keyboard, Loader2, Plus, ScanLine, Trash2 } from 'lucide-react';
import BarcodeScanner from '../../../../components/barcode-scanner';
import { api, errMsg, fmtMoney } from '../../../../lib/api';
import { SCAN_HANDOFF_KEY, type ScannedUnit } from '../../../../lib/scan-handoff';
import { extractSerial } from '../../../../lib/serial';
import { cn } from '../../../../lib/utils';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Card, CardContent } from '../../../../components/ui/card';
import StatusChip from '../../../../components/status-chip';

/** Only stock on the shelf can be put on a new order. */
const SELLABLE = 'IN_STOCK';

/**
 * Build a sales order by scanning the units going out.
 *
 * The serial is the input method, not the output: scanning identifies which
 * product and how many, then hands that to the ordinary sales-order form where
 * the customer, warehouse, pricing and discounts are filled in as usual. That
 * keeps one code path for what an order actually is, and means scanning cannot
 * drift away from the form's pricing rules.
 *
 * A unit is refused unless it is in stock — scanning something already sold or
 * reserved is exactly the mistake this screen exists to catch, and finding out
 * at delivery instead would be far more expensive.
 */
export default function ScanSalesOrderPage() {
  const t = useTranslations();
  const router = useRouter();

  const [units, setUnits] = useState<ScannedUnit[]>([]);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Serials mid-lookup, so a repeated decode cannot add the same unit twice. */
  const inFlightRef = useRef<Set<string>>(new Set());
  const unitsRef = useRef<ScannedUnit[]>(units);
  unitsRef.current = units;

  const addRef = useRef<(raw: string) => Promise<void>>(async () => {});

  const addUnit = async (raw: string) => {
    const serial = extractSerial(raw);
    if (!serial) return;
    const key = serial.toUpperCase();

    if (unitsRef.current.some((u) => u.serialNumber.toUpperCase() === key)) return; // already on the list
    // Claimed before the first await: the camera re-reads a label many times a
    // second and the check above only sees units already committed to state.
    if (inFlightRef.current.has(key)) return;
    inFlightRef.current.add(key);

    setBusy(true);
    try {
      const { data } = await api.get(`/inventory/units/serial/${encodeURIComponent(serial)}`);
      if (data.status !== SELLABLE) {
        setError(t('scanOrder.notSellable', { serial, status: t(`status.${data.status}`) }));
        navigator.vibrate?.([40, 60, 40]);
        return;
      }
      setUnits((prev) => [
        ...prev,
        {
          serialNumber: data.serialNumber,
          productId: data.product.id,
          sku: data.product.sku,
          name: data.product.name,
          salePrice: Number(data.product.salePrice ?? 0),
          costPrice: Number(data.product.costPrice ?? 0),
          warehouseId: data.warehouseId ?? null,
          warehouseName: data.warehouse?.name ?? null,
        },
      ]);
      setError(null);
      navigator.vibrate?.(35);
    } catch (e: any) {
      if (e?.response?.status === 404) {
        setError(t('scanOrder.unknownSerial', { serial }));
      } else {
        setError(errMsg(e));
      }
      navigator.vibrate?.([40, 60, 40]);
    } finally {
      inFlightRef.current.delete(key);
      setBusy(false);
    }
  };
  addRef.current = addUnit;

  /** Units collapse into one order line per product. */
  const lines = useMemo(() => {
    const byProduct = new Map<string, { unit: ScannedUnit; count: number }>();
    for (const u of units) {
      const entry = byProduct.get(u.productId);
      if (entry) entry.count += 1;
      else byProduct.set(u.productId, { unit: u, count: 1 });
    }
    return [...byProduct.values()];
  }, [units]);

  /*
   * Units scanned out of two different warehouses cannot go on one order — the
   * form carries a single warehouse and stock is drawn from it.
   */
  const warehouses = useMemo(
    () => [...new Set(units.map((u) => u.warehouseName).filter(Boolean))] as string[],
    [units],
  );
  const mixedWarehouses = warehouses.length > 1;

  const removeUnit = (serial: string) =>
    setUnits((prev) => prev.filter((u) => u.serialNumber !== serial));

  const proceed = () => {
    if (!units.length) return;
    try {
      sessionStorage.setItem(SCAN_HANDOFF_KEY, JSON.stringify(units));
    } catch {
      toast.error(t('scanOrder.handoffFailed'));
      return;
    }
    router.push('/sales-orders/new?from=scan');
  };

  useEffect(() => {
    // A stale handoff from an abandoned run would otherwise reappear later.
    try {
      sessionStorage.removeItem(SCAN_HANDOFF_KEY);
    } catch {
      /* private mode */
    }
  }, []);

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => router.push('/sales-orders')}>
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{t('scanOrder.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('scanOrder.subtitle')}</p>
        </div>
      </div>

      <BarcodeScanner onDecode={(v) => void addRef.current(v)} />

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void addUnit(manual).then(() => setManual(''));
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Keyboard className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            dir="ltr"
            className="h-12 ps-9 font-mono text-base"
            placeholder={t('receive.typeSerial')}
            value={manual}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(e) => setManual(e.target.value)}
          />
        </div>
        <Button type="submit" size="lg" className="h-12 shrink-0 gap-1.5 px-5" disabled={!manual.trim() || busy}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
          {t('common.add')}
        </Button>
      </form>

      {error && (
        <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {mixedWarehouses && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-3 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('scanOrder.mixedWarehouses', { list: warehouses.join(', ') })}</span>
        </p>
      )}

      {units.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ScanLine className="h-9 w-9 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t('scanOrder.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {lines.map(({ unit, count }) => (
            <Card key={unit.productId}>
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{unit.name}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{unit.sku}</div>
                  </div>
                  <div className="shrink-0 text-end">
                    <div className="text-sm font-semibold tabular-nums">
                      {count} × {fmtMoney(unit.salePrice)}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {fmtMoney(unit.salePrice * count)}
                    </div>
                  </div>
                </div>
                <ul className="mt-2.5 divide-y border-t">
                  {units
                    .filter((u) => u.productId === unit.productId)
                    .map((u) => (
                      <li key={u.serialNumber} className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr">
                          {u.serialNumber}
                        </span>
                        {u.warehouseName && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">{u.warehouseName}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          title={t('common.remove')}
                          onClick={() => removeUnit(u.serialNumber)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:start-64">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('scanOrder.scanned')}
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {units.length}
              <span className="ms-1.5 text-sm font-normal text-muted-foreground">
                {t('scanOrder.acrossProducts', { count: lines.length })}
              </span>
            </div>
          </div>
          <Button size="lg" className="h-14 shrink-0 gap-2 px-6 text-base" disabled={!units.length} onClick={proceed}>
            {t('scanOrder.continue')}
            <ArrowRight className="h-5 w-5 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
