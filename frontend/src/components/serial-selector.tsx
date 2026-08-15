'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Search, Wand2 } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface Unit {
  id: string;
  serialNumber: string;
  warehouse?: { name?: string } | null;
}

/**
 * Picking the serial numbers that fulfil an order line.
 *
 * Deliberately not a dropdown. The task is "choose exactly N of these units",
 * which means seeing many candidates at once, tracking progress against a
 * target, and tapping repeatedly — all of which a floating list anchored to a
 * one-line input does badly, and which broke outright when the list opened near
 * the bottom of a dialog and got clipped. Laying the units out inline as a
 * scrolling grid removes the clipping entirely: nothing floats, so nothing can
 * be cut off.
 */
export default function SerialSelector({
  productId,
  required,
  value,
  onChange,
  params,
}: {
  productId: string;
  /** How many units this line needs. */
  required: number;
  value: string[];
  onChange: (serials: string[]) => void;
  /** Extra filters; defaults to in-stock units. */
  params?: Record<string, any>;
}) {
  const t = useTranslations();
  const [units, setUnits] = useState<Unit[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    (serial?: string) => {
      setLoading(true);
      api
        .get('/inventory/units', {
          params: { productId, status: 'IN_STOCK', ...params, serial: serial || undefined, pageSize: 100 },
        })
        .then((r) => setUnits(r.data.items ?? []))
        .catch(() => setUnits([]))
        .finally(() => setLoading(false));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productId, JSON.stringify(params)],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const search = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(q), 250);
  };

  const complete = value.length >= required;

  const toggle = (serial: string) => {
    if (value.includes(serial)) onChange(value.filter((s) => s !== serial));
    else if (!complete) onChange([...value, serial]);
  };

  /** Fill the line from the top of the list — the common case is "any N". */
  const autoPick = () => {
    const pool = units.map((u) => u.serialNumber).filter((s) => !value.includes(s));
    onChange([...value, ...pool.slice(0, Math.max(0, required - value.length))]);
  };

  return (
    <div className="rounded-lg border bg-muted/20">
      <div className="flex flex-wrap items-center gap-2 border-b p-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            dir="ltr"
            className="ps-8"
            placeholder={t('orders.searchSerials')}
            value={query}
            onChange={(e) => search(e.target.value)}
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={autoPick} disabled={complete || units.length === 0}>
          <Wand2 /> {t('orders.autoPick')}
        </Button>
        <span
          className={cn(
            'rounded-md px-2 py-1 text-xs font-semibold tabular-nums',
            complete ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
          )}
        >
          {value.length} / {required}
        </span>
      </div>

      {/* Fixed-height scroll area: the grid can grow to hundreds of units
          without the dialog itself turning into an endless page. */}
      <div className="max-h-64 overflow-y-auto overscroll-contain p-2.5">
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
        ) : units.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t('orders.noSerialsInStock')}</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {units.map((u) => {
              const selected = value.includes(u.serialNumber);
              // Once the line is full, unselected tiles are inert — clearer than
              // letting a tap silently do nothing.
              const locked = !selected && complete;
              return (
                <button
                  key={u.id}
                  type="button"
                  disabled={locked}
                  onClick={() => toggle(u.serialNumber)}
                  className={cn(
                    'flex min-h-[52px] items-center gap-2 rounded-md border p-2 text-start transition-colors',
                    selected
                      ? 'border-primary bg-primary/10'
                      : locked
                        ? 'cursor-not-allowed border-dashed opacity-40'
                        : 'hover:border-primary/50 hover:bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                    )}
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs font-medium" dir="ltr">
                      {u.serialNumber}
                    </span>
                    {u.warehouse?.name && (
                      <span className="block truncate text-[11px] text-muted-foreground">{u.warehouse.name}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
