'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import Combobox, { ComboboxOption } from './combobox';

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

/** Multi-select over a product's serial numbers (in-stock by default). */
export default function SerialPicker({ productId, max, value, onChange, placeholder, className, params }: Props) {
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUnits = useCallback(
    (serial?: string) => {
      api
        .get('/inventory/units', {
          params: { productId, status: 'IN_STOCK', ...params, serial: serial || undefined, pageSize: 50 },
        })
        .then((r) =>
          setOptions(
            (r.data.items ?? []).map((u: any) => ({
              value: u.serialNumber,
              label: u.serialNumber,
              sub: u.warehouse?.name ?? null,
              mono: true,
            })),
          ),
        )
        .catch(() => setOptions([]));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productId, JSON.stringify(params)],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <Combobox
      multiple
      max={max}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      className={className}
      emptyText="—"
      // Fetch immediately when the list opens; only debounce actual typing.
      onOpen={() => fetchUnits()}
      onSearch={(q) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => fetchUnits(q), 250);
      }}
    />
  );
}
