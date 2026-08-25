'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Wand2, ArrowLeft, Image as ImageIcon, Upload, Trash2, X } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { invalidateCache } from '../lib/cache';
import { cn } from '../lib/utils';
import Field, { AlignedFieldGrid } from './form-field';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { FormattedNumberInput } from './ui/formatted-number-input';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';
import { Skeleton } from './ui/skeleton';
import ProductVariantManager from './product-variant-manager';

/** Static class strings — Tailwind cannot see dynamically built class names. */
const COLS = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
} as const;

/**
 * A titled panel of form fields.
 *
 * `cols` is the number of fields the group actually has, so a two-field group
 * lays out as two columns rather than two inputs and two empty cells in a
 * fixed four-column grid.
 */
function Section({
  title, children, cols = 4, className,
}: { title: string; children: React.ReactNode; cols?: keyof typeof COLS; className?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="border-b bg-muted/40 px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      </div>
      <AlignedFieldGrid className={cn('grid-cols-1 gap-x-4 gap-y-4 p-4', cols > 1 && 'sm:grid-cols-2', COLS[cols])}>
        {children}
      </AlignedFieldGrid>
    </Card>
  );
}

/**
 * Checkbox styled as a grid cell. It claims the same three row tracks as the
 * Fields beside it and puts itself in the control track, so it lands on the
 * inputs' line rather than up against the labels. `h-9` matches the Input
 * height.
 */
function CheckRow({
  id, label, checked, onChange, title,
}: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <div className="row-span-3 grid grid-rows-subgrid gap-1.5">
      <span aria-hidden />
      <label
        htmlFor={id}
        title={title}
        className="flex h-9 cursor-pointer select-none items-center gap-2.5 self-end rounded-md border bg-muted/30 px-3 text-sm transition-colors hover:bg-muted/60"
      >
        <input id={id} type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="truncate">{label}</span>
      </label>
    </div>
  );
}

type Errors = Partial<Record<'sku' | 'name' | 'subCategoryId' | 'costPrice' | 'salePrice' | 'lowStockThreshold', string>>;

/*
 * Warranty is stored as months in the database — the date arithmetic that ends
 * a unit's cover works in months, and some goods are covered for 18 months
 * rather than a whole number of years. The form talks in years because that is
 * how solar warranties are quoted (7-year battery, 25-year panel), converting
 * on the way in and out. Half-years survive the round trip.
 */
const monthsToYears = (m: number | null | undefined): number | '' =>
  m === null || m === undefined ? '' : Math.round((m / 12) * 100) / 100;

const yearsToMonths = (y: unknown): number | undefined => {
  if (y === '' || y === null || y === undefined) return undefined;
  const n = Number(y);
  return Number.isFinite(n) ? Math.round(n * 12) : undefined;
};

/**
 * Create/edit form for a product, shared by `/products/new` and
 * `/products/[id]/edit`. Passing `productId` switches it to edit mode: it
 * loads the record, shows skeletons while fetching, and renders a fallback if
 * the id does not resolve.
 */
export default function ProductForm({ productId }: { productId?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const editing = Boolean(productId);

  const [form, setForm] = useState<any>({
    sku: '', name: '', brand: '', model: '', subCategoryId: '', costPrice: 0, salePrice: 0,
    imageUrl: '', isService: false, trackSerials: true, requireSerialOnSale: true, lowStockThreshold: 5, warrantyYears: '',
    performanceWarrantyYears: '', shelfLifeMonths: '', barcode: '', notes: '',
  });
  const [attrs, setAttrs] = useState<Record<string, any>>({});
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(editing);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skuLoading, setSkuLoading] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    api.get('/categories').then((r) => setCategories(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setLoading(true);
    api
      .get(`/products/${productId}`)
      .then((r) => {
        if (cancelled) return;
        const p = r.data;
        setForm({
          sku: p.sku, name: p.name, brand: p.brand ?? '', model: p.model ?? '',
          subCategoryId: p.subCategoryId, costPrice: Number(p.costPrice), salePrice: Number(p.salePrice),
          imageUrl: p.imageUrl ?? '',
          isService: !!p.isService, trackSerials: p.trackSerials, requireSerialOnSale: p.requireSerialOnSale ?? true, lowStockThreshold: p.lowStockThreshold,
          warrantyYears: monthsToYears(p.warrantyMonths), performanceWarrantyYears: monthsToYears(p.performanceWarrantyMonths),
          shelfLifeMonths: p.shelfLifeMonths ?? '', barcode: p.barcode ?? '', notes: p.notes ?? '',
          isActive: p.isActive, priceChangeReason: '',
        });
        setAttrs(p.attributes ?? {});
      })
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const subCategories = categories.flatMap((c) => c.subCategories.map((s: any) => ({ ...s, categoryName: c.name })));
  const attrDefs: any[] = subCategories.find((s) => s.id === form.subCategoryId)?.attributeDefs ?? [];

  const generateSku = async () => {
    setSkuLoading(true);
    try {
      const { data } = await api.get('/products/generate-sku');
      setForm((f: any) => ({ ...f, sku: data.sku }));
      setErrors((e) => ({ ...e, sku: undefined }));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSkuLoading(false);
    }
  };

  /** Mirrors the server rules so problems surface before a round-trip. */
  const validate = (): Errors => {
    const next: Errors = {};
    if (!String(form.sku).trim()) next.sku = t('validation.required');
    if (!String(form.name).trim()) next.name = t('validation.required');
    if (!form.isService && !form.subCategoryId) next.subCategoryId = t('validation.required');
    if (Number(form.salePrice) < 0 || !Number.isFinite(Number(form.salePrice))) next.salePrice = t('validation.positiveNumber');
    if (form.isService && (Number(form.costPrice) < 0 || !Number.isFinite(Number(form.costPrice)))) {
      next.costPrice = t('validation.positiveNumber');
    }
    if (!form.isService && Number(form.lowStockThreshold) < 0) next.lowStockThreshold = t('validation.positiveNumber');
    return next;
  };

  const save = async () => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error(t('validation.fixErrors'));
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        ...form,
        costPrice: Number(form.costPrice) || 0,
        salePrice: Number(form.salePrice),
        lowStockThreshold: Number(form.lowStockThreshold) || 0,
        // The API stores months; the form collects years.
        warrantyMonths: yearsToMonths(form.warrantyYears),
        performanceWarrantyMonths: yearsToMonths(form.performanceWarrantyYears),
        shelfLifeMonths: form.shelfLifeMonths === '' ? undefined : Number(form.shelfLifeMonths),
        brand: form.brand || undefined,
        model: form.model || undefined,
        barcode: form.barcode || undefined,
        notes: form.notes || undefined,
        priceChangeReason: form.priceChangeReason || undefined,
        subCategoryId: form.subCategoryId || undefined,
        attributes: attrs,
      };
      if (editing) await api.patch(`/products/${productId}`, payload);
      else await api.post('/products', payload);
      invalidateCache('products');
      toast.success(t('common.saved'));
      router.push('/products');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    // Mirrors the real card layout so nothing jumps when the data lands.
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4">
        {[0, 1, 2].map((s) => (
          <Card key={s} className="overflow-hidden">
            <div className="border-b bg-muted/40 px-4 py-2.5">
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium">{t('products.notFound')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t('products.notFoundHint')}</p>
        <Button variant="outline" onClick={() => router.push('/products')}>
          <ArrowLeft className="rtl:rotate-180" /> {t('products.backToProducts')}
        </Button>
      </div>
    );
  }

  const err = (k: keyof Errors) => errors[k];

  return (
    // Capped width: on a wide monitor a full-bleed form leaves the fields
    // stranded in dead space and the rows too long to scan.
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="space-y-4">
        <Section title={t('products.sectionIdentity')}>
          <Field label={t('products.sku')} hint={err('sku')}>
            <div className="relative">
              <Input
                className={cn('pe-9 font-mono', err('sku') && 'border-destructive')}
                placeholder="e.g. INV-5KW-001"
                value={form.sku ?? ''}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
              <button
                type="button"
                tabIndex={-1}
                disabled={skuLoading}
                title={t('products.generateSku')}
                aria-label={t('products.generateSku')}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                onClick={generateSku}
              >
                <Wand2 className={cn('h-4 w-4', skuLoading && 'animate-pulse')} />
              </button>
            </div>
          </Field>
          <Field label={t('common.name')} className="md:col-span-2" hint={err('name')}>
            <Input
              className={cn(err('name') && 'border-destructive')}
              placeholder="e.g. 5kW Hybrid Inverter Single Phase"
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          {/* Sits up top because it decides which of the fields below exist. */}
          <CheckRow
            id="isService"
            label={t('products.isService')}
            title={t('products.isServiceHint')}
            checked={!!form.isService}
            onChange={(v) => setForm({ ...form, isService: v, trackSerials: v ? false : form.trackSerials })}
          />
          {!form.isService && (
            <>
              <Field label={t('products.brand')}><Input placeholder="e.g. Deye" value={form.brand ?? ''} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
              <Field label={t('products.model')}><Input placeholder="e.g. SUN-5K-SG03LP1" value={form.model ?? ''} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
              <Field label={t('products.subCategory')} hint={err('subCategoryId')}>
                <Select
                  className={cn(err('subCategoryId') && 'border-destructive')}
                  value={form.subCategoryId ?? ''}
                  onChange={(e) => setForm({ ...form, subCategoryId: e.target.value })}
                >
                  <option value="">—</option>
                  {subCategories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.categoryName} / {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('products.barcode')}><Input placeholder="e.g. 6901234567890" value={form.barcode ?? ''} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></Field>
            </>
          )}
        </Section>

        {/* Product Image Section */}
        <Section title={t('products.image') || 'Product Image'} cols={2}>
          <div className="md:col-span-2 space-y-3">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {/* Image Preview Box */}
              <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-xl border-2 border-dashed border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0 group shadow-xs">
                {form.imageUrl ? (
                  <>
                    <img
                      src={form.imageUrl}
                      alt="Product preview"
                      className="w-full h-full object-contain p-1"
                    />
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, imageUrl: '' })}
                      title={t('common.remove') || 'Remove image'}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-xs gap-1 font-medium cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>{t('common.remove') || 'Remove'}</span>
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center text-muted-foreground/60 gap-1.5 p-2 text-center">
                    <ImageIcon className="h-8 w-8 stroke-1" />
                    <span className="text-[10px] font-medium">{t('products.noImage') || 'No image'}</span>
                  </div>
                )}
              </div>

              {/* Upload or URL Controls */}
              <div className="flex-1 space-y-3 w-full">
                <Field label={t('products.imageUrl') || 'Image URL'}>
                  <div className="flex items-center gap-2">
                    <Input
                      type="url"
                      placeholder="https://example.com/image.jpg (or upload below)"
                      value={form.imageUrl ?? ''}
                      onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                      className="text-xs"
                    />
                    {form.imageUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setForm({ ...form, imageUrl: '' })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </Field>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border rounded-lg bg-card hover:bg-accent/50 cursor-pointer transition-colors shadow-2xs">
                    <Upload className="h-3.5 w-3.5 text-primary" />
                    <span>{t('products.uploadImage') || 'Upload Image File'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024) {
                          toast.error('Image must be under 5MB');
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const result = ev.target?.result as string;
                          if (result) {
                            setForm((prev: any) => ({ ...prev, imageUrl: result }));
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  <span className="text-[11px] text-muted-foreground">PNG, JPG, WEBP up to 5MB</span>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/*
          Pricing and Inventory are small, so they share a row on wide screens
          instead of each stretching across the page. When the product is a
          service, Inventory disappears and Pricing takes the full width.
        */}
        <div className={cn('grid gap-4', !form.isService && 'lg:grid-cols-2')}>
        <Section title={t('products.sectionPricing')} cols={2}>
          {/*
            Cost is hidden when creating a stocked product: the first goods
            receipt sets it from the supplier's price. Services keep it —
            nothing else ever sets their cost — and editing keeps it so a
            wrong figure can be corrected.
          */}
          {(editing || form.isService) && (
            <Field
              label={t('products.costPrice')}
              hint={err('costPrice') ?? (form.isService ? undefined : t('products.costFromPurchase'))}
            >
              <FormattedNumberInput
                placeholder="0.00"
                className={cn(err('costPrice') && 'border-destructive')}
                value={form.costPrice ?? ''}
                onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
              />
            </Field>
          )}
          <Field label={t('products.salePrice')} hint={err('salePrice')}>
            <FormattedNumberInput
              placeholder="0.00"
              className={cn(err('salePrice') && 'border-destructive')}
              value={form.salePrice ?? ''}
              onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
            />
          </Field>
          {editing && (
            <Field label={t('products.priceChangeReason')} className="md:col-span-2">
              <Input placeholder="e.g. Supplier price update" value={form.priceChangeReason ?? ''} onChange={(e) => setForm({ ...form, priceChangeReason: e.target.value })} />
            </Field>
          )}
        </Section>

        {/* A service is labour: no stock, no serials, no warranty, no specs. */}
        {!form.isService && (
          <Section title={t('products.sectionInventory')} cols={2}>
            <Field label={t('products.lowStockThreshold')} hint={err('lowStockThreshold')}>
              <Input
                type="number"
                min={0}
                placeholder="5"
                className={cn(err('lowStockThreshold') && 'border-destructive')}
                value={form.lowStockThreshold ?? ''}
                onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
              />
            </Field>
            <CheckRow
              id="trackSerials"
              label={t('products.trackSerials')}
              checked={!!form.trackSerials}
              onChange={(v) =>
                // Nothing is captured on the way in, so there is nothing to
                // match on the way out either.
                setForm({ ...form, trackSerials: v, requireSerialOnSale: v ? form.requireSerialOnSale : false })
              }
            />
            {/* Only meaningful once units are being captured at all. */}
            {form.trackSerials && (
              <CheckRow
                id="requireSerialOnSale"
                label={t('products.requireSerialOnSale')}
                title={t('products.requireSerialOnSaleHint')}
                checked={!!form.requireSerialOnSale}
                onChange={(v) => setForm({ ...form, requireSerialOnSale: v })}
              />
            )}
          </Section>
        )}
        </div>

        {!form.isService && (
          <Section title={t('products.sectionWarranty')} cols={3}>
            <Field label={t('products.warrantyYears')} hint={t('products.warrantyAppliesToRestock')}>
              <Input
                type="number"
                min={0}
                step="0.5"
                placeholder="7"
                value={form.warrantyYears ?? ''}
                onChange={(e) => setForm({ ...form, warrantyYears: e.target.value })}
              />
            </Field>
            <Field label={t('products.performanceWarrantyYears')}>
              <Input
                type="number"
                min={0}
                step="0.5"
                placeholder="25"
                value={form.performanceWarrantyYears ?? ''}
                onChange={(e) => setForm({ ...form, performanceWarrantyYears: e.target.value })}
              />
            </Field>
            <Field label={t('products.shelfLifeMonths')}><Input type="number" min={0} placeholder="e.g. 12" value={form.shelfLifeMonths ?? ''} onChange={(e) => setForm({ ...form, shelfLifeMonths: e.target.value })} /></Field>
          </Section>
        )}

        <Section title={t('common.notes')} cols={1}>
          {/* Not a Field, so it claims the row tracks itself. */}
          <Textarea className="row-span-3" rows={2} placeholder="Optional notes or specifications..." value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Section>
      </div>

      {!form.isService && attrDefs.length > 0 && (
        <Section title={t('products.specs')}>
          <>
            {attrDefs.map((a) => (
              <Field key={a.id} label={a.unit ? `${a.label} (${a.unit})` : a.label}>
                {a.type === 'SELECT' ? (
                  <Select value={attrs[a.name] ?? ''} onChange={(e) => setAttrs({ ...attrs, [a.name]: e.target.value })}>
                    <option value="">—</option>
                    {(a.options ?? []).map((o: string) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </Select>
                ) : a.type === 'BOOLEAN' ? (
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={!!attrs[a.name]} onChange={(e) => setAttrs({ ...attrs, [a.name]: e.target.checked })} />
                ) : (
                  <Input
                    type={a.type === 'NUMBER' ? 'number' : a.type === 'DATE' ? 'date' : 'text'}
                    value={attrs[a.name] ?? ''}
                    onChange={(e) => setAttrs({ ...attrs, [a.name]: a.type === 'NUMBER' ? Number(e.target.value) : e.target.value })}
                  />
                )}
              </Field>
            ))}
          </>
        </Section>
      )}

      {/* Dynamic Product Variant & Attribute Management */}
      {!form.isService && (
        <ProductVariantManager
          productId={productId}
          baseSku={form.sku}
          baseName={form.name}
          baseSalePrice={Number(form.salePrice) || 0}
          baseCostPrice={Number(form.costPrice) || 0}
          baseImageUrl={form.imageUrl}
        />
      )}

      {/* Aligned to the form, not the page, now that the form has a max width. */}
      <div className="sticky bottom-0 flex items-center justify-end gap-2 rounded-lg border bg-card/90 px-4 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => router.push('/products')} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
