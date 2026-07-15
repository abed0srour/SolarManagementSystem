'use client';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { fmtMoney } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { ProductPicker } from './entity-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export interface LineItem {
  product: any | null;
  quantity: number;
  unitPrice: number;
  discountType: '' | 'PERCENT' | 'FIXED';
  discountValue: number;
  taxRatePct: number;
}

export function emptyLine(): LineItem {
  return { product: null, quantity: 1, unitPrice: 0, discountType: '', discountValue: 0, taxRatePct: 0 };
}

export function lineTotal(l: LineItem): number {
  const gross = l.quantity * l.unitPrice;
  const net =
    l.discountType === 'PERCENT' ? gross - (gross * l.discountValue) / 100 : l.discountType === 'FIXED' ? gross - l.discountValue : gross;
  const safe = Math.max(0, net);
  return Math.round((safe + (safe * (l.taxRatePct || 0)) / 100) * 100) / 100;
}

export function toItemsPayload(lines: LineItem[]) {
  return lines
    .filter((l) => l.product)
    .map((l) => ({
      productId: l.product.id,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountType: l.discountType || undefined,
      discountValue: l.discountType ? Number(l.discountValue) : undefined,
      taxRatePct: Number(l.taxRatePct) || undefined,
    }));
}

interface Props {
  lines: LineItem[];
  onChange: (lines: LineItem[]) => void;
  priceField?: 'salePrice' | 'costPrice';
}

export default function LineItemsEditor({ lines, onChange, priceField = 'salePrice' }: Props) {
  const t = useTranslations();
  const set = (idx: number, patch: Partial<LineItem>) => onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">{t('common.product')}</TableHead>
            <TableHead className="w-20">{t('common.quantity')}</TableHead>
            <TableHead className="w-28">{t('common.unitPrice')}</TableHead>
            <TableHead className="w-28">{t('common.discount')}</TableHead>
            <TableHead className="w-24"></TableHead>
            <TableHead className="w-20">{t('common.tax')} %</TableHead>
            <TableHead className="w-28 text-end">{t('common.lineTotal')}</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l, idx) => (
            <TableRow key={idx}>
              <TableCell>
                <ProductPicker
                  value={l.product}
                  onChange={(p) =>
                    set(idx, {
                      product: p,
                      unitPrice: p ? Number(p[priceField]) : 0,
                      taxRatePct: p ? Number(p.taxRatePct ?? 0) : 0,
                    })
                  }
                />
              </TableCell>
              <TableCell>
                <Input type="number" min={1} value={l.quantity} onChange={(e) => set(idx, { quantity: Math.max(1, Number(e.target.value)) })} />
              </TableCell>
              <TableCell>
                <Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => set(idx, { unitPrice: Number(e.target.value) })} />
              </TableCell>
              <TableCell>
                <Select value={l.discountType} onChange={(e) => set(idx, { discountType: e.target.value as any })}>
                  <option value="">{t('common.none')}</option>
                  <option value="PERCENT">%</option>
                  <option value="FIXED">{t('common.fixed')}</option>
                </Select>
              </TableCell>
              <TableCell>
                <Input type="number" min={0} value={l.discountValue} disabled={!l.discountType} onChange={(e) => set(idx, { discountValue: Number(e.target.value) })} />
              </TableCell>
              <TableCell>
                <Input type="number" min={0} value={l.taxRatePct} onChange={(e) => set(idx, { taxRatePct: Number(e.target.value) })} />
              </TableCell>
              <TableCell className="text-end font-medium tabular-nums">{fmtMoney(lineTotal(l))}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => onChange(lines.filter((_, i) => i !== idx))}>
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-2 flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyLine()])}>
          <Plus /> {t('common.addLine')}
        </Button>
        <div className="text-sm font-semibold">
          {t('common.items')}: {fmtMoney(lines.reduce((s, l) => s + lineTotal(l), 0))}
        </div>
      </div>
    </div>
  );
}
