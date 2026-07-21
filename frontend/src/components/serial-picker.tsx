'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Input } from './ui/input';
import { Badge } from './ui/badge';

interface Props {
  productId: string;
  /** How many serials this line needs (selection is capped at this). */
  max?: number;
  value: string[];
  onChange: (serials: string[]) => void;
  placeholder?: string;
  className?: string;
  /** Extra query filters; defaults to in-stock units. E.g. { status: 'SOLD', salesOrderId } for refunds. */
  params?: Record<string, any>;
}

/** Multi-select combobox over the product's serial numbers (in-stock by default). */
export default function SerialPicker({ productId, max, value, onChange, placeholder, className, params }: Props) {
  const [options, setOptions] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const full = max !== undefined && value.length >= max;

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

  // Fetch immediately when the dropdown opens (or the product changes); only
  // debounce while the user is actually typing a search query.
  const typedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      typedRef.current = false;
      return;
    }
    const fetchUnits = () =>
      api
        .get('/inventory/units', { params: { productId, status: 'IN_STOCK', ...params, serial: input || undefined, pageSize: 50 } })
        .then((r) => setOptions(r.data.items ?? []))
        .catch(() => setOptions([]));
    if (!typedRef.current) {
      typedRef.current = true;
      fetchUnits();
      return;
    }
    const timer = setTimeout(fetchUnits, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, productId, open]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!containerRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const available = options.filter((o) => !value.includes(o.serialNumber));

  return (
    <div ref={containerRef} className={cn('space-y-1.5', className)}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((s) => (
            <Badge key={s} variant="muted" className="gap-1 font-mono text-xs" dir="ltr">
              {s}
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(value.filter((v) => v !== s))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {!full && (
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            dir="ltr"
            maxLength={18}
            placeholder={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            className="ps-8"
          />
        </div>
      )}
      {open && !full && rect && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={listRef}
            data-entity-picker-list=""
            style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 100, pointerEvents: 'auto' }}
            className="max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
          >
            {available.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">—</div>}
            {available.map((o) => (
              <button
                key={o.id}
                type="button"
                dir="ltr"
                className="block w-full truncate rounded-sm px-3 py-1.5 text-start font-mono text-sm hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const next = [...value, o.serialNumber];
                  onChange(next);
                  setInput('');
                  if (max !== undefined && next.length >= max) setOpen(false);
                }}
              >
                {o.serialNumber}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
