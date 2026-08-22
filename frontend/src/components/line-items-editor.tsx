'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Package, Plus, Trash2 } from 'lucide-react';
import { fmtMoney } from '../lib/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FormattedNumberInput } from './ui/formatted-number-input';
import { Select } from './ui/select';
import { ProductPicker } from './entity-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

/** Units of measure offered for bundle components. */
export const UNITS = ['pcs', 'set', 'm', 'ft'] as const;

/**
 * One component inside a bundle. Descriptive only — it appears on the internal
 * pick-list and optionally on the invoice, but never moves stock, which is why
 * its quantity may be fractional (12.5 m of cable).
 */
export interface SubLine {
  /** The catalogue product. Its stock is drawn when the order is confirmed. */
  product: any | null;
  description: string;
  quantity: number | string;
  unit: string;
  unitPrice: number | string;
}

export interface LineItem {
  product: any | null;
  quantity: number | string;
  /** What the customer is charged per unit on this line. Editable. */
  unitPrice: number | string;
  /** The product's list price when it was picked — reference only, never sent. */
  basePrice: number;
  /** What the product costs us. Shown beside the price so margin is visible. Never sent. */
  costPrice: number;
  /** True when this line is a bundle header rather than a catalogue product. */
  isComposite?: boolean;
  /** Bundle name, e.g. "AC & DC Protection Components". */
  description?: string;
  /** When true (default) the bundle price is the sum of its components. */
  autoPrice?: boolean;
  subItems?: SubLine[];
}

export function emptyLine(): LineItem {
  return { product: null, quantity: 1, unitPrice: '', basePrice: 0, costPrice: 0 };
}

export function emptyBundle(): LineItem {
  return {
    product: null, quantity: 1, unitPrice: '', basePrice: 0, costPrice: 0,
    isComposite: true, description: '', autoPrice: true, subItems: [emptySubLine()],
  };
}

export function emptySubLine(): SubLine {
  return { product: null, description: '', quantity: 1, unit: 'pcs', unitPrice: '' };
}

export function subLineTotal(s: SubLine): number {
  return Math.round(Math.max(0, (Number(s.quantity) || 0) * (Number(s.unitPrice) || 0)) * 100) / 100;
}

/** Sum of a bundle's components — what an auto-priced bundle charges. */
export function bundleComponentsTotal(l: LineItem): number {
  return Math.round((l.subItems ?? []).reduce((s, x) => s + subLineTotal(x), 0) * 100) / 100;
}

export function lineSubtotal(l: LineItem): number {
  const unit = l.isComposite && l.autoPrice !== false ? bundleComponentsTotal(l) : (Number(l.unitPrice) || 0);
  return Math.round(Math.max(0, (Number(l.quantity) || 0) * unit) * 100) / 100;
}

export function lineTotal(l: LineItem): number {
  return lineSubtotal(l);
}

/** A line is "filled in" once it has a product, or a name if it is a bundle. */
export function isLineFilled(l: LineItem): boolean {
  return l.isComposite ? Boolean(l.description?.trim()) : Boolean(l.product);
}

/** Profit per unit at the current price. Negative means selling below cost. */
export function lineUnitMargin(l: LineItem): number {
  if (!l.product) return 0;
  return Math.round(((Number(l.unitPrice) || 0) - l.costPrice) * 100) / 100;
}

/**
 * Lines priced under what the goods cost us.
 *
 * Selling at a loss is allowed — clearing dead stock and matching a competitor
 * are real decisions — but never by accident, so the form confirms before
 * saving. Bundles are skipped: their price is the sum of components that are
 * each checked on their own, and a bundle header carries no cost of its own.
 */
export function belowCostLines(lines: LineItem[]): LineItem[] {
  return lines.filter((l) => !l.isComposite && l.product && lineUnitMargin(l) < 0);
}

/** What the whole order gives away, across every below-cost line. */
export function belowCostLoss(lines: LineItem[]): number {
  const loss = belowCostLines(lines).reduce((s, l) => s + lineUnitMargin(l) * (Number(l.quantity) || 0), 0);
  return Math.round(Math.abs(loss) * 100) / 100;
}

/**
 * Amount without a currency suffix, for the captions under the price input.
 * "1,300.00 USD" is too wide for that column and the currency is already shown
 * on the line total beside it.
 */
const plain = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Difference between the charged price and the product's list price. */
export function lineMarkup(l: LineItem): number {
  if (!l.product) return 0;
  return Math.round(((Number(l.unitPrice) || 0) - l.basePrice) * 100) / 100;
}

/** True when any line is unusable — blocks submitting the order. */
export function hasInvalidLine(lines: LineItem[]): boolean {
  return lines.some((l) => {
    if (!isLineFilled(l)) return false;
    if (l.quantity === '' || !Number.isFinite(Number(l.quantity)) || Number(l.quantity) < 1) return true;
    if (l.isComposite) {
      // A bundle needs at least one named component, and none may be negative.
      const subs = (l.subItems ?? []).filter((s) => s.product);
      if (!subs.length) return true;
      return subs.some((s) => s.quantity === '' || !Number.isFinite(Number(s.quantity)) || Number(s.quantity) <= 0 || s.unitPrice === '' || !Number.isFinite(Number(s.unitPrice)) || Number(s.unitPrice) < 0);
    }
    return l.unitPrice === '' || !Number.isFinite(Number(l.unitPrice)) || Number(l.unitPrice) < 0;
  });
}

export function toItemsPayload(lines: LineItem[]) {
  return lines.filter(isLineFilled).map((l) =>
    l.isComposite
      ? {
          isComposite: true,
          description: l.description?.trim(),
          quantity: Number(l.quantity) || 1,
          autoPrice: l.autoPrice !== false,
          // Only priced when overridden; otherwise the server sums the parts.
          unitPrice: l.autoPrice === false ? Number(l.unitPrice) || 0 : undefined,
          subItems: (l.subItems ?? [])
            .filter((s) => s.product)
            .map((s) => ({
              productId: s.product.id,
              quantity: Number(s.quantity) || 1,
              unit: s.unit || undefined,
              unitPrice: Number(s.unitPrice) || 0,
            })),
        }
      : {
          productId: l.product.id,
          quantity: Number(l.quantity) || 1,
          unitPrice: Number(l.unitPrice) || 0,
        },
  );
}

/** Rebuild editor lines from a saved document, including bundle contents. */
export function linesFromStored(items: any[]): LineItem[] {
  return (items ?? []).map((i) =>
    i.isComposite
      ? {
          product: null,
          isComposite: true,
          description: i.description ?? '',
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice ?? 0),
          basePrice: 0,
          costPrice: 0,
          autoPrice: i.autoPrice !== false,
          subItems: (i.subItems ?? []).map((s: any) => ({
            product: s.product ? { id: s.productId, name: s.product?.name ?? '', sku: s.product?.sku ?? '' } : null,
            description: s.description ?? s.product?.name ?? '',
            quantity: s.quantity,
            unit: s.unit ?? 'pcs',
            unitPrice: Number(s.unitPrice ?? 0),
          })),
        }
      : {
          product: {
            id: i.productId,
            name: i.product?.name ?? '',
            sku: i.product?.sku ?? '',
            costPrice: i.product?.costPrice ?? 0,
            salePrice: i.product?.salePrice ?? 0,
          },
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          basePrice: Number(i.product?.salePrice ?? i.unitPrice),
          costPrice: Number(i.product?.costPrice ?? 0),
        },
  );
}

/**
 * A bundle: one customer-facing line whose price comes from the components
 * listed beneath it. The components are expandable so the warehouse can pick
 * against them, while the customer's invoice shows only this header.
 */
function BundleRow({
  line, onChange, onRemove,
}: { line: LineItem; onChange: (patch: Partial<LineItem>) => void; onRemove: () => void }) {
  const t = useTranslations();
  const [open, setOpen] = useState(true);
  const subs = line.subItems ?? [];
  const auto = line.autoPrice !== false;

  const setSub = (i: number, patch: Partial<SubLine>) =>
    onChange({ subItems: subs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <>
      <TableRow className="bg-muted/30">
        <TableCell>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={open ? t('orders.hideComponents') : t('orders.showComponents')}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rtl:rotate-180" />}
            </button>
            <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              placeholder={t('orders.bundleNamePlaceholder')}
              className="font-medium"
              value={line.description ?? ''}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </div>
        </TableCell>
        <TableCell className="min-w-32">
          <Input
            type="number"
            min={1}
            className="tabular-nums"
            placeholder="1"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
        </TableCell>
        <TableCell className="text-end text-xs text-muted-foreground">
          {t('orders.componentCount', { count: subs.filter((s) => s.product).length })}
        </TableCell>
        <TableCell className="min-w-36">
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onChange({ autoPrice: !auto, unitPrice: auto ? bundleComponentsTotal(line) : line.unitPrice })}
              className={cn(
                'shrink-0 rounded px-1.5 py-1 text-[10px] font-medium',
                auto ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
              )}
              title={auto ? t('orders.autoPriceHint') : t('orders.fixedPriceHint')}
            >
              {auto ? t('orders.autoPrice') : t('orders.fixedPrice')}
            </button>
            {auto ? (
              <span className="tabular-nums">{plain(bundleComponentsTotal(line))}</span>
            ) : (
              <FormattedNumberInput
                placeholder="0.00"
                className="w-28 text-end tabular-nums"
                value={line.unitPrice}
                onChange={(e) => onChange({ unitPrice: e.target.value })}
              />
            )}
          </div>
        </TableCell>
        <TableCell className="text-end font-medium tabular-nums">{fmtMoney(lineTotal(line))}</TableCell>
        <TableCell>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2 />
          </Button>
        </TableCell>
      </TableRow>

      {open && (
        <TableRow>
          <TableCell colSpan={6} className="whitespace-normal bg-muted/10 py-3">
            <div className="space-y-2 ps-8">
              {subs.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  {/* Components come from the catalogue so their stock is drawn. */}
                  <div className="min-w-56 flex-1">
                    <ProductPicker
                      value={s.product}
                      onChange={(p) =>
                        setSub(i, {
                          product: p,
                          description: p?.name ?? '',
                          unitPrice: p ? (Number(p.salePrice) || '') : '',
                        })
                      }
                    />
                  </div>
                  {/* step 0.001 so cable and conduit can be entered by the metre */}
                  <Input
                    type="number"
                    min={0}
                    step="0.001"
                    className="w-28 text-end tabular-nums"
                    placeholder="1"
                    value={s.quantity}
                    onChange={(e) => setSub(i, { quantity: e.target.value })}
                  />
                  <Select className="w-20" value={s.unit} onChange={(e) => setSub(i, { unit: e.target.value })}>
                    {UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </Select>
                  <FormattedNumberInput
                    className="w-32 text-end tabular-nums"
                    placeholder="0.00"
                    value={s.unitPrice}
                    onChange={(e) => setSub(i, { unitPrice: e.target.value })}
                  />
                  <span className="w-28 text-end text-sm tabular-nums text-muted-foreground">{plain(subLineTotal(s))}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => onChange({ subItems: subs.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => onChange({ subItems: [...subs, emptySubLine()] })}>
                <Plus /> {t('orders.addComponent')}
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

interface Props {
  lines: LineItem[];
  onChange: (lines: LineItem[]) => void;
  priceField?: 'salePrice' | 'costPrice';
}

/**
 * Each line carries its own unit price and its own discount.
 *
 * The unit price defaults to the product's list price but is editable in both
 * directions — it may be raised above list (a markup) or lowered. The list
 * price stays visible underneath as a reference, and any difference is called
 * out so an altered price is never silent. The discount then applies on top of
 * whatever unit price the line ended up with.
 */
export default function LineItemsEditor({ lines, onChange, priceField = 'salePrice' }: Props) {
  const t = useTranslations();
  const set = (idx: number, patch: Partial<LineItem>) => onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">{t('common.product')}</TableHead>
            <TableHead className="w-36 min-w-32">{t('common.quantity')}</TableHead>
            <TableHead className="w-32 text-end">{t('products.costPrice')}</TableHead>
            <TableHead className="w-40 min-w-36 text-end">{t('common.unitPrice')}</TableHead>
            <TableHead className="w-28 text-end">{t('common.lineTotal')}</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l, idx) =>
            l.isComposite ? (
              <BundleRow
                key={idx}
                line={l}
                onChange={(patch) => set(idx, patch)}
                onRemove={() => onChange(lines.filter((_, i) => i !== idx))}
              />
            ) : (
            <TableRow key={idx}>
              <TableCell>
                <ProductPicker
                  value={l.product}
                  onChange={(p) =>
                    set(idx, {
                      product: p,
                      unitPrice: p ? (Number(p[priceField]) || '') : '',
                      basePrice: p ? Number(p[priceField]) : 0,
                      costPrice: p ? Number(p.costPrice ?? 0) : 0,
                    })
                  }
                />
              </TableCell>
              <TableCell className="min-w-32">
                <Input
                  type="number"
                  min={1}
                  className="tabular-nums"
                  placeholder="1"
                  value={l.quantity}
                  onChange={(e) => set(idx, { quantity: e.target.value })}
                />
              </TableCell>
              {/*
                Read-only cost, sat immediately left of the editable price so
                the margin is obvious while typing. Turns red the moment the
                price drops below what the item cost us.
              */}
              <TableCell className="text-end tabular-nums">
                {l.product ? (
                  <span
                    className={cn(
                      lineUnitMargin(l) < 0 ? 'font-medium text-destructive' : 'text-muted-foreground',
                    )}
                    title={
                      lineUnitMargin(l) < 0
                        ? t('orders.belowCost')
                        : `${t('orders.marginPerUnit')}: ${plain(lineUnitMargin(l))}`
                    }
                  >
                    {plain(l.costPrice)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              {/*
                The caption is positioned absolutely, so this cell is exactly as
                tall as the plain inputs beside it. In normal flow it stretched
                the cell and pushed the price input out of line with Qty.
              */}
              <TableCell className="min-w-36">
                <div className="relative">
                  <FormattedNumberInput
                    placeholder="0.00"
                    className={cn('text-end tabular-nums', lineMarkup(l) !== 0 && 'border-amber-500/70')}
                    value={l.unitPrice}
                    disabled={!l.product}
                    onChange={(e) => set(idx, { unitPrice: e.target.value })}
                  />
                  {/*
                    Only shown once the price differs from list. Repeating the
                    list price under an unchanged field just duplicated the
                    number already in the input.
                  */}
                  {l.product && lineMarkup(l) !== 0 && (
                    <div className="pointer-events-none absolute inset-x-0 top-full flex justify-end pt-0.5 text-[10px] leading-none">
                      <span
                        className={cn(
                          'rounded px-1 py-px font-medium',
                          lineMarkup(l) > 0 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                        )}
                        title={`${t('common.listPrice')}: ${fmtMoney(l.basePrice)}`}
                      >
                        {lineMarkup(l) > 0 ? '+' : '−'}
                        {plain(Math.abs(lineMarkup(l)))}
                      </span>
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-end font-medium tabular-nums">{fmtMoney(lineTotal(l))}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => onChange(lines.filter((_, i) => i !== idx))}>
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
            ),
          )}
        </TableBody>
      </Table>
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyLine()])}>
            <Plus /> {t('common.addLine')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyBundle()])}>
            <Package /> {t('orders.addBundle')}
          </Button>
        </div>
        <div className="text-sm font-semibold text-start sm:text-end">
          {t('common.items')}: {fmtMoney(lines.reduce((s, l) => s + lineTotal(l), 0))}
        </div>
      </div>
    </div>
  );
}
