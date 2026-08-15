'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtMoney } from '../lib/api';
import Combobox, { ComboboxOption } from './combobox';

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
 *
 * Callers work in whole records — `value` and `onChange` carry the entity, not
 * an id — so the fetched rows are kept alongside the flattened options and
 * mapped back on selection.
 */
export function EntityPicker({ endpoint, value, onChange, getLabel, getSub, placeholder, extraParams, className, required }: Props) {
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const rows = useRef<Map<string, any>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRows = useCallback(
    (search?: string) => {
      api
        .get(endpoint, { params: { search: search || undefined, pageSize: 20, ...extraParams } })
        .then((r) => {
          const items: any[] = Array.isArray(r.data) ? r.data : (r.data.items ?? []);
          rows.current = new Map(items.map((i) => [i.id, i]));
          setOptions(items.map((i) => ({ value: i.id, label: getLabel(i), sub: getSub?.(i) ?? null })));
        })
        .catch(() => setOptions([]));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, JSON.stringify(extraParams)],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <Combobox
      value={value ? { value: value.id, label: getLabel(value) } : null}
      onChange={(o) => onChange(o ? (rows.current.get(o.value) ?? null) : null)}
      options={options}
      placeholder={placeholder}
      className={className}
      required={required}
      onOpen={() => fetchRows()}
      onSearch={(q) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => fetchRows(q), 250);
      }}
    />
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
