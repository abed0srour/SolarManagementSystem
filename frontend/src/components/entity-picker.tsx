'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Input } from './ui/input';

interface Props {
  endpoint: string;
  value: any | null;
  onChange: (value: any | null) => void;
  getLabel: (opt: any) => string;
  placeholder?: string;
  extraParams?: Record<string, any>;
  className?: string;
  required?: boolean;
}

/** Searchable async combobox for picking an entity from a list endpoint. */
export function EntityPicker({ endpoint, value, onChange, getLabel, placeholder, extraParams, className, required }: Props) {
  const [options, setOptions] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
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
          <Input
            placeholder={placeholder}
            value={input}
            required={required}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            className="pe-8"
          />
          <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      )}
      {open && !value && (
        <div className="absolute top-10 z-50 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {options.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">—</div>}
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="block w-full truncate rounded-sm px-3 py-1.5 text-start text-sm hover:bg-accent"
              onClick={() => {
                onChange(o);
                setOpen(false);
                setInput('');
              }}
            >
              {getLabel(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const ClientPicker = (p: Omit<Props, 'endpoint' | 'getLabel'>) => (
  <EntityPicker endpoint="/clients" getLabel={(c) => c.name} {...p} />
);
export const SupplierPicker = (p: Omit<Props, 'endpoint' | 'getLabel'>) => (
  <EntityPicker endpoint="/suppliers" getLabel={(s) => s.name} {...p} />
);
export const ProductPicker = (p: Omit<Props, 'endpoint' | 'getLabel'>) => (
  <EntityPicker endpoint="/products" getLabel={(x) => `${x.name} [${x.sku}]`} {...p} />
);
export const WarehousePicker = (p: Omit<Props, 'endpoint' | 'getLabel'>) => (
  <EntityPicker endpoint="/inventory/warehouses" getLabel={(w) => w.name} {...p} />
);
export const InvoicePicker = (p: Omit<Props, 'endpoint' | 'getLabel'> & { params?: Record<string, any> }) => (
  <EntityPicker endpoint="/invoices" getLabel={(i) => `${i.number} — ${i.client?.name ?? i.supplier?.name ?? ''}`} extraParams={p.params} {...p} />
);
