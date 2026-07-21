'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import { api, fmtMoney } from '../lib/api';
import { cn } from '../lib/utils';
import { Input } from './ui/input';

interface Props {
  endpoint: string;
  value: any | null;
  onChange: (value: any | null) => void;
  getLabel: (opt: any) => string;
  getSub?: (opt: any) => string | null;
  placeholder?: string;
  extraParams?: Record<string, any>;
  className?: string;
  required?: boolean;
}

/**
 * Searchable async combobox for picking an entity from a list endpoint.
 * The options list renders in a body portal with fixed positioning so it is
 * never clipped by dialog/table overflow and never overlaps sibling fields.
 */
export function EntityPicker({ endpoint, value, onChange, getLabel, getSub, placeholder, extraParams, className, required }: Props) {
  const [options, setOptions] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect((prev) =>
      prev && prev.top === r.bottom + 4 && prev.left === r.left && prev.width === r.width
        ? prev
        : { top: r.bottom + 4, left: r.left, width: r.width },
    );
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Keep tracking while open: the picker often opens while a dialog is still
    // mounting/animating into its centered position, so a one-shot measurement
    // can capture pre-layout coordinates (dropdown appearing bottom-right).
    const timer = setInterval(place, 100);
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      clearInterval(timer);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      api
        .get(endpoint, { params: { search: input || undefined, pageSize: 20, ...extraParams } })
        .then((r) => setOptions(Array.isArray(r.data) ? r.data : (r.data.items ?? [])))
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, endpoint, open]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!containerRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {value ? (
        <div className="flex h-9 items-center justify-between gap-1 rounded-md border border-input bg-background px-3 text-sm">
          <span className="truncate">{getLabel(value)}</span>
          <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={placeholder}
            value={input}
            required={required}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            className="ps-8 pe-8"
          />
          <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      )}
      {open && !value && rect && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={listRef}
            data-entity-picker-list=""
            // pointerEvents must be re-enabled explicitly: a modal Radix dialog
            // sets pointer-events:none on everything outside its own content.
            style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 100, pointerEvents: 'auto' }}
            className="max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
          >
            {options.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">—</div>}
            {options.map((o) => {
              const sub = getSub?.(o);
              return (
                <button
                  key={o.id}
                  type="button"
                  className="block w-full rounded-sm px-3 py-1.5 text-start text-sm hover:bg-accent"
                  // mousedown, not click: it fires before the input blurs or the
                  // dialog's outside-interaction logic runs.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(o);
                    setOpen(false);
                    setInput('');
                  }}
                >
                  <span className="block truncate">{getLabel(o)}</span>
                  {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

const productStock = (p: any) =>
  Array.isArray(p.stockLevels) ? p.stockLevels.reduce((s: number, l: any) => s + (l.quantity ?? 0), 0) : null;

export const ClientPicker = (p: Omit<Props, 'endpoint' | 'getLabel'>) => (
  <EntityPicker endpoint="/clients" getLabel={(c) => c.name} getSub={(c) => c.phone ?? c.email ?? null} {...p} />
);
export const SupplierPicker = (p: Omit<Props, 'endpoint' | 'getLabel'>) => (
  <EntityPicker endpoint="/suppliers" getLabel={(s) => s.name} {...p} />
);
export const ProductPicker = (p: Omit<Props, 'endpoint' | 'getLabel'>) => (
  <EntityPicker
    endpoint="/products"
    getLabel={(x) => `${x.name} [${x.sku}]`}
    getSub={(x) => {
      const stock = productStock(x);
      const parts = [x.salePrice !== undefined ? fmtMoney(x.salePrice) : null, stock !== null ? `In stock: ${stock}` : null];
      return parts.filter(Boolean).join(' · ') || null;
    }}
    {...p}
  />
);
export const WarehousePicker = (p: Omit<Props, 'endpoint' | 'getLabel'>) => (
  <EntityPicker endpoint="/inventory/warehouses" getLabel={(w) => w.name} {...p} />
);
export const InvoicePicker = (p: Omit<Props, 'endpoint' | 'getLabel'> & { params?: Record<string, any> }) => (
  <EntityPicker endpoint="/invoices" getLabel={(i) => `${i.number} — ${i.client?.name ?? i.supplier?.name ?? ''}`} extraParams={p.params} {...p} />
);
