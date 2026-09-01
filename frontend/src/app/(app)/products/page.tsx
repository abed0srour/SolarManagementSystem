'use client';
import { Package as PageIcon, RotateCcw } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Plus, History, Upload, Archive, Pencil, FileUp, Eye, Image as ImageIcon,
  Barcode, Warehouse, ShieldCheck, Tag, Sparkles, Check, X, Layers, UsersRound,
  ExternalLink, DollarSign, ArrowRight, GitFork, MoreHorizontal,
} from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, fmtDateTime } from '../../../lib/api';
import { csvBool, csvNumber, parseCsv } from '../../../lib/csv';
import { invalidateCache } from '../../../lib/cache';
import { cn } from '../../../lib/utils';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function ProductsPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [categories, setCategories] = useState<any[]>([]);
  const [historyFor, setHistoryFor] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCsv, setBulkCsv] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [archived, setArchived] = useState(false);

  // User preference: toggle thumbnail images in the table
  const [showImages, setShowImages] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('sms_show_product_images');
    return stored !== null ? stored === '1' : true;
  });

  // Selected product for comprehensive info modal
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    api.get('/categories').then((r) => setCategories(r.data)).catch(() => {});
  }, []);

  const toggleShowImages = () => {
    const next = !showImages;
    setShowImages(next);
    try {
      localStorage.setItem('sms_show_product_images', next ? '1' : '0');
    } catch {}
  };

  const openProductDetails = async (row: any) => {
    setSelectedProduct(row);
    setDetailsLoading(true);
    try {
      const { data } = await api.get(`/products/${row.id}`);
      setSelectedProduct(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDetailsLoading(false);
    }
  };

  const showHistory = async (row: any) => {
    setHistoryFor(row);
    const { data } = await api.get(`/products/${row.id}/price-history`);
    setHistory(data);
  };

  const importRows = useMemo(() => {
    if (!importCsv.trim()) return [];
    return parseCsv(importCsv).map((r) => ({
      sku: r.sku ?? '',
      name: r.name ?? '',
      brand: r.brand || undefined,
      model: r.model || undefined,
      category: r.category || undefined,
      subCategory: r.subcategory || r.subcat || undefined,
      barcode: r.barcode || undefined,
      notes: r.notes || undefined,
      salePrice: csvNumber(r.saleprice) ?? 0,
      costPrice: csvNumber(r.costprice),
      lowStockThreshold: csvNumber(r.lowstockthreshold),
      warrantyMonths:
        csvNumber(r.warrantyyears) !== undefined
          ? Math.round(csvNumber(r.warrantyyears)! * 12)
          : csvNumber(r.warrantymonths),
      isService: csvBool(r.isservice),
    }));
  }, [importCsv]);

  const runImport = async () => {
    setImporting(true);
    try {
      const { data } = await api.post('/products/import', { rows: importRows });
      setImportResult(data);
      if (data.created > 0) {
        toast.success(t('products.importedCount', { count: data.created }));
        setRefreshKey((k) => k + 1);
      }
      if (data.created === 0 && data.failed > 0) toast.error(t('validation.fixErrors'));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setImporting(false);
    }
  };

  const runBulk = async () => {
    try {
      const rows = bulkCsv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !/^sku[,;]/i.test(l))
        .map((l) => {
          const [sku, cost, sale] = l.split(/[,;]/).map((x) => x.trim());
          return { sku, costPrice: cost ? Number(cost) : undefined, salePrice: sale ? Number(sale) : undefined };
        });
      const { data } = await api.post('/products/bulk-price', { rows, reason: 'Bulk price import' });
      const updated = data.results.filter((r: any) => r.status === 'updated').length;
      const unchanged = data.results.filter((r: any) => r.status === 'unchanged').length;
      const notFound = data.results.filter((r: any) => r.status === 'not found').length;
      toast.success(t('products.updatedCount', { updated, unchanged, notFound }));
      setBulkOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const restore = async (row: any) => {
    try {
      await api.post(`/products/${row.id}/restore`);
      invalidateCache('products');
      toast.success(t('common.restored'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Total stock on hand for selected product
  const selectedTotalStock = useMemo(() => {
    if (!selectedProduct?.stockLevels) return 0;
    return selectedProduct.stockLevels.reduce((s: number, l: any) => s + (l.quantity ?? 0), 0);
  }, [selectedProduct]);

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('products.title')} subtitle={t('subtitles.products')} />
      <DataTable
        endpoint="/products"
        archived={archived}
        onArchivedChange={setArchived}
        refreshKey={refreshKey}
        initialSearch={searchParams.get('search') ?? undefined}
        extraParams={categoryFilter ? { categoryId: categoryFilter } : undefined}
        onRowClick={archived ? undefined : (r) => openProductDetails(r)}
        filters={
          <Select className="w-36 sm:w-40" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        }
        toolbar={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={cn('h-9 w-9 shrink-0', showImages && 'bg-primary/10 border-primary/40 text-primary')}
                  title={t('common.actions')}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={toggleShowImages}>
                  <ImageIcon className="h-4 w-4" />
                  {showImages ? t('products.hideImages') : t('products.showImages')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setImportOpen(true); setImportCsv(''); setImportResult(null); }}>
                  <FileUp className="h-4 w-4" />
                  {t('products.importProducts')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setBulkOpen(true); setBulkCsv(''); }}>
                  <Upload className="h-4 w-4" />
                  {t('products.bulkPrices')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => router.push('/products/new')}>
              <Plus /> {t('products.newProduct')}
            </Button>
          </>
        }
        columns={[
          ...(showImages
            ? [
                {
                  key: 'imageUrl',
                  label: t('products.image') || 'Image',
                  className: 'w-14 text-center',
                  render: (r: any) => (
                    <div className="w-10 h-10 rounded-lg border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0 mx-auto shadow-2xs">
                      {r.imageUrl ? (
                        <img src={r.imageUrl} alt={r.name} className="w-full h-full object-contain p-0.5" />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
                      )}
                    </div>
                  ),
                },
              ]
            : []),
          {
            key: 'name',
            label: t('common.name'),
            mobile: 'primary',
            sortable: true,
            render: (r: any) => (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground hover:text-primary transition-colors cursor-pointer">{r.name}</span>
                  {r.isService && <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">Service</Badge>}
                  {r.isVariant && <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-muted/40 font-normal">Variant</Badge>}
                  {r.variants && r.variants.length > 0 && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-primary/5 text-primary border-primary/20 font-semibold gap-1">
                      <Layers className="h-3 w-3" />
                      {r.variants.length} Variants
                    </Badge>
                  )}
                </div>
                {/* Variant attributes badge breakdown if this product is a variant */}
                {r.variantAttributes && typeof r.variantAttributes === 'object' && Object.keys(r.variantAttributes).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(r.variantAttributes).map(([k, v]) => (
                      <span key={k} className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded border text-muted-foreground">
                        {k}: <b className="text-foreground">{String(v)}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'sku',
            label: t('products.sku'),
            sortable: true,
            render: (r: any) => (
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">{r.sku}</span>
            ),
          },
          { key: 'brand', label: t('products.brand'), sortable: true },
          { key: 'model', label: t('products.model'), sortable: true },
          { key: 'cat', label: t('products.category'), render: (r: any) => `${r.subCategory?.category?.name ?? ''} / ${r.subCategory?.name ?? ''}` },
          { key: 'costPrice', label: t('products.costPrice'), sortable: true, className: 'text-end', render: (r: any) => <span className="tabular-nums font-mono">{fmtMoney(r.costPrice)}</span> },
          { key: 'salePrice', label: t('products.salePrice'), sortable: true, className: 'text-end', render: (r: any) => <span className="tabular-nums font-mono font-semibold text-primary">{fmtMoney(r.salePrice)}</span> },
          { key: 'priceUpdatedAt', label: t('products.priceAsOf'), sortable: true, render: (r: any) => fmtDate(r.priceUpdatedAt) },
          {
            key: 'actions',
            label: '',
            render: (r: any) =>
              archived ? (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 dark:text-emerald-400" title={t('common.restore')} onClick={() => restore(r)}>
                    <RotateCcw />
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title={t('products.viewDetails') || 'View Info'} onClick={() => openProductDetails(r)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title={t('common.edit')} onClick={() => router.push(`/products/${r.id}/edit`)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title={t('products.priceHistory')} onClick={() => showHistory(r)}>
                    <History />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 dark:text-red-400" title={t('common.archive')} onClick={() => setDeleteTarget(r)}>
                    <Archive />
                  </Button>
                </div>
              ),
          },
        ]}
      />

      {/* PRODUCT DETAILS MODAL */}
      <Dialog open={!!selectedProduct} onOpenChange={(v) => !v && setSelectedProduct(null)}>
        <DialogContent wide className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-3 pe-6">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl border bg-muted/30 overflow-hidden flex items-center justify-center shrink-0 shadow-xs">
                  {selectedProduct?.imageUrl ? (
                    <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-full h-full object-contain p-1" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                  )}
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold">{selectedProduct?.name}</DialogTitle>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {selectedProduct?.sku}
                    </span>
                    {selectedProduct?.isService ? (
                      <Badge variant="outline" className="text-[10px] font-normal">Service</Badge>
                    ) : selectedProduct?.isVariant ? (
                      <Badge variant="outline" className="text-[10px] font-normal bg-primary/10 text-primary">
                        Child Variant
                      </Badge>
                    ) : (
                      <Badge variant="muted" className="text-[10px] font-normal">
                        Stocked Product
                      </Badge>
                    )}
                    {selectedProduct?.variants && selectedProduct.variants.length > 0 && (
                      <Badge variant="outline" className="text-[10px] font-semibold bg-primary/10 text-primary border-primary/30">
                        {selectedProduct.variants.length} Variants Available
                      </Badge>
                    )}
                    <Badge variant={selectedProduct?.isActive !== false ? 'default' : 'destructive'} className="text-[10px] font-normal">
                      {selectedProduct?.isActive !== false ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </DialogHeader>

          {selectedProduct && (
            <div className="space-y-6 pt-2">
              {/* Financial & Stock KPI Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border bg-card p-3.5 space-y-1 shadow-2xs">
                  <span className="text-[11px] font-medium text-muted-foreground">{t('products.salePrice')}</span>
                  <div className="text-base font-bold font-mono text-primary">{fmtMoney(selectedProduct.salePrice)}</div>
                </div>
                <div className="rounded-xl border bg-card p-3.5 space-y-1 shadow-2xs">
                  <span className="text-[11px] font-medium text-muted-foreground">{t('products.costPrice')}</span>
                  <div className="text-base font-bold font-mono text-foreground">{fmtMoney(selectedProduct.costPrice)}</div>
                </div>
                <div className="rounded-xl border bg-card p-3.5 space-y-1 shadow-2xs">
                  <span className="text-[11px] font-medium text-muted-foreground">Profit Margin</span>
                  <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {selectedProduct.salePrice && Number(selectedProduct.salePrice) > 0
                      ? `${Math.round(((Number(selectedProduct.salePrice) - Number(selectedProduct.costPrice || 0)) / Number(selectedProduct.salePrice)) * 100)}%`
                      : '0%'}
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-3.5 space-y-1 shadow-2xs">
                  <span className="text-[11px] font-medium text-muted-foreground">Total In Stock</span>
                  <div className="text-base font-bold font-mono text-foreground">
                    {selectedProduct.isService ? 'N/A' : selectedTotalStock}
                  </div>
                </div>
              </div>

              {/* Large Image Preview (if provided) */}
              {selectedProduct.imageUrl && (
                <div className="rounded-xl border bg-muted/20 p-4 flex flex-col items-center justify-center">
                  <img
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.name}
                    className="max-h-64 rounded-lg object-contain shadow-xs"
                  />
                </div>
              )}

              {/* 1. PRODUCT VARIANTS & ATTRIBUTES MATRIX BREAKDOWN */}
              {((selectedProduct.variants && selectedProduct.variants.length > 0) ||
                (selectedProduct.customAttributes && selectedProduct.customAttributes.length > 0)) && (
                <div className="space-y-4 rounded-xl border bg-primary/5 p-4 border-primary/20 shadow-xs">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-foreground text-xs uppercase tracking-wide flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      Dynamic Attributes & Variants ({selectedProduct.variants?.length ?? 0} variants)
                    </h4>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 gap-1"
                      onClick={() => {
                        setSelectedProduct(null);
                        router.push(`/products/${selectedProduct.id}/edit`);
                      }}
                    >
                      <Pencil className="h-3 w-3" /> Manage Variants
                    </Button>
                  </div>

                  {/* Attribute Definitions Pills */}
                  {selectedProduct.customAttributes && selectedProduct.customAttributes.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[11px] font-medium text-muted-foreground block">Defined Dynamic Attributes:</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {selectedProduct.customAttributes.map((attr: any) => (
                          <div key={attr.id} className="rounded-lg border bg-card p-2.5 space-y-1 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">{attr.name}</span>
                              <Badge variant="outline" className="text-[9px] uppercase py-0 font-mono">
                                {attr.type}
                              </Badge>
                            </div>
                            {attr.permittedValues && Array.isArray(attr.permittedValues) && attr.permittedValues.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {attr.permittedValues.map((pv: any, pvIdx: number) => (
                                  <span key={pvIdx} className="text-[10px] bg-muted px-1.5 py-0.5 rounded border">
                                    {String(pv)} {attr.unit || ''}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Variants List Table */}
                  {selectedProduct.variants && selectedProduct.variants.length > 0 && (
                    <div className="rounded-lg border bg-card overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs bg-muted/30">
                            <TableHead className="w-32">Variant SKU</TableHead>
                            <TableHead>Variant Name & Attributes</TableHead>
                            <TableHead className="text-end w-24">Sale Price</TableHead>
                            <TableHead className="text-end w-24">Cost Price</TableHead>
                            <TableHead className="text-end w-20">In Stock</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedProduct.variants.map((v: any) => {
                            const variantStock = v.stockLevels
                              ? v.stockLevels.reduce((sum: number, sl: any) => sum + (sl.quantity || 0), 0)
                              : 0;
                            return (
                              <TableRow key={v.id} className="text-xs">
                                <TableCell className="font-mono font-semibold">{v.sku}</TableCell>
                                <TableCell>
                                  <div className="font-medium text-foreground">{v.name}</div>
                                  {v.variantAttributes && typeof v.variantAttributes === 'object' && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {Object.entries(v.variantAttributes).map(([k, val]) => (
                                        <Badge key={k} variant="outline" className="text-[10px] py-0 px-1 font-normal">
                                          {k}: {String(val)}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="text-end font-mono font-semibold text-primary">
                                  {fmtMoney(v.salePrice)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {fmtMoney(v.costPrice)}
                                </TableCell>
                                <TableCell className="text-end font-mono font-bold">
                                  {variantStock}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              {/* Product Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="rounded-xl border bg-muted/20 p-4 space-y-2.5">
                  <h4 className="font-semibold text-foreground text-xs uppercase tracking-wide border-b pb-1.5 flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-primary" />
                    Classification & Specs
                  </h4>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">{t('products.category')}</span>
                    <span className="font-medium text-foreground">
                      {selectedProduct.subCategory?.category?.name ?? '—'} / {selectedProduct.subCategory?.name ?? '—'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">{t('products.brand')}</span>
                    <span className="font-medium text-foreground">{selectedProduct.brand || '—'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">{t('products.model')}</span>
                    <span className="font-medium text-foreground">{selectedProduct.model || '—'}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">{t('products.barcode')}</span>
                    <span className="font-mono text-foreground font-medium flex items-center gap-1">
                      {selectedProduct.barcode ? <><Barcode className="h-3.5 w-3.5" /> {selectedProduct.barcode}</> : '—'}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border bg-muted/20 p-4 space-y-2.5">
                  <h4 className="font-semibold text-foreground text-xs uppercase tracking-wide border-b pb-1.5 flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    Tracking & Warranty
                  </h4>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Track Serials on Purchase</span>
                    <span className="font-medium">{selectedProduct.trackSerials ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Require Serial on Sale</span>
                    <span className="font-medium">{selectedProduct.requireSerialOnSale ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Product Warranty</span>
                    <span className="font-medium">
                      {selectedProduct.warrantyMonths ? `${selectedProduct.warrantyMonths} months (${(selectedProduct.warrantyMonths / 12).toFixed(1)} yrs)` : 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">Low Stock Alert Threshold</span>
                    <span className="font-medium">{selectedProduct.lowStockThreshold ?? 5} units</span>
                  </div>
                </div>
              </div>

              {/* Warehouse Inventory Stock Breakdown */}
              {!selectedProduct.isService && (
                <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                  <h4 className="font-semibold text-foreground text-xs uppercase tracking-wide flex items-center gap-1.5">
                    <Warehouse className="h-3.5 w-3.5 text-primary" />
                    Warehouse Stock Distribution
                  </h4>
                  {selectedProduct.stockLevels && selectedProduct.stockLevels.length > 0 ? (
                    <div className="rounded-lg border overflow-hidden bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs">
                            <TableHead>Warehouse</TableHead>
                            <TableHead className="text-end">In Stock</TableHead>
                            <TableHead className="text-end">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedProduct.stockLevels.map((lvl: any) => (
                            <TableRow key={lvl.id} className="text-xs">
                              <TableCell className="font-medium">{lvl.warehouse?.name ?? 'Main Warehouse'}</TableCell>
                              <TableCell className="text-end font-mono font-bold">{lvl.quantity ?? 0}</TableCell>
                              <TableCell className="text-end">
                                {(lvl.quantity ?? 0) <= (selectedProduct.lowStockThreshold ?? 5) ? (
                                  <Badge variant="destructive" className="text-[10px]">Low Stock</Badge>
                                ) : (
                                  <Badge variant="default" className="text-[10px]">In Stock</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground py-2">No active warehouse stock levels recorded yet.</p>
                  )}
                </div>
              )}

              {/* Technical Specifications (from category definitions) */}
              {selectedProduct.attributes && Object.keys(selectedProduct.attributes).length > 0 && (
                <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                  <h4 className="font-semibold text-foreground text-xs uppercase tracking-wide flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Category Technical Specifications
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {Object.entries(selectedProduct.attributes).map(([k, v]) => (
                      <div key={k} className="rounded-lg border bg-card p-2.5 text-xs">
                        <span className="text-[11px] text-muted-foreground capitalize block truncate">{k}</span>
                        <span className="font-semibold text-foreground font-mono">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {selectedProduct.notes && (
                <div className="rounded-xl border bg-muted/20 p-4 space-y-1 text-xs">
                  <span className="font-semibold text-muted-foreground uppercase text-[11px] tracking-wide block">Notes</span>
                  <p className="text-foreground whitespace-pre-wrap">{selectedProduct.notes}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t mt-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => {
                  if (selectedProduct) {
                    const p = selectedProduct;
                    setSelectedProduct(null);
                    showHistory(p);
                  }
                }}
              >
                <History className="h-3.5 w-3.5" />
                Price History
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => {
                  if (selectedProduct) {
                    router.push(`/product-buyers?search=${encodeURIComponent(selectedProduct.sku)}`);
                  }
                }}
              >
                <UsersRound className="h-3.5 w-3.5" />
                Who Bought What
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => {
                  if (selectedProduct) {
                    router.push(`/products/${selectedProduct.id}/edit`);
                  }
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('common.edit')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedProduct(null)}>
                {t('common.close')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price history */}
      <Dialog open={!!historyFor} onOpenChange={(v) => !v && setHistoryFor(null)}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>
              {t('products.priceHistory')} — {historyFor?.name}
            </DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.date')}</TableHead>
                <TableHead>{t('products.costPrice')} ({t('products.oldToNew')})</TableHead>
                <TableHead>{t('products.salePrice')} ({t('products.oldToNew')})</TableHead>
                <TableHead>{t('products.reason')}</TableHead>
                <TableHead>{t('products.changedBy')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(h.createdAt)}</TableCell>
                  <TableCell className="tabular-nums">
                    {h.oldCostPrice != null ? fmtMoney(h.oldCostPrice) : '—'} → {h.newCostPrice != null ? fmtMoney(h.newCostPrice) : '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {h.oldSalePrice != null ? fmtMoney(h.oldSalePrice) : '—'} → {h.newSalePrice != null ? fmtMoney(h.newSalePrice) : '—'}
                  </TableCell>
                  <TableCell>{h.reason ?? '—'}</TableCell>
                  <TableCell>{h.changedBy?.name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      {/* Import products from CSV */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{t('products.importProducts')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('products.importHint')}</p>
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-1 font-medium">{t('products.importColumns')}</div>
              <code className="block overflow-x-auto whitespace-pre font-mono" dir="ltr">
                sku,name,brand,model,category,subCategory,salePrice,barcode,lowStockThreshold,warrantyYears,isService,notes
              </code>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setImportCsv(String(reader.result ?? ''));
                  reader.readAsText(file);
                  e.target.value = '';
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload /> {t('products.chooseFile')}
              </Button>
              {importRows.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {t('products.rowsDetected', { count: importRows.length })}
                </span>
              )}
            </div>

            <Textarea
              rows={7}
              dir="ltr"
              className="font-mono text-xs"
              placeholder={'sku,name,brand,model,category,subCategory,salePrice\nPAN-550,Longi 550W,Longi,LR5-72,Solar Panels,Monocrystalline,120'}
              value={importCsv}
              onChange={(e) => setImportCsv(e.target.value)}
            />

            {importResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="text-emerald-600 dark:text-emerald-400">{t('products.imported')}: {importResult.created}</span>
                  <span className="text-muted-foreground">{t('products.skipped')}: {importResult.skipped}</span>
                  <span className={importResult.failed ? 'text-destructive' : 'text-muted-foreground'}>
                    {t('products.failedRows')}: {importResult.failed}
                  </span>
                </div>
                {importResult.results.some((r: any) => r.status !== 'created') && (
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    <Table>
                      <TableBody>
                        {importResult.results
                          .filter((r: any) => r.status !== 'created')
                          .map((r: any) => (
                            <TableRow key={r.row}>
                              <TableCell className="w-14 text-xs text-muted-foreground">#{r.row}</TableCell>
                              <TableCell className="w-28 font-mono text-xs">{r.sku || '—'}</TableCell>
                              <TableCell className="text-xs">{r.message}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>{t('common.close')}</Button>
            <Button onClick={runImport} disabled={importRows.length === 0 || importing}>
              {importing ? t('common.loading') : t('products.importCount', { count: importRows.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk price */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('products.bulkPrices')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('products.bulkPricesHint')}</p>
          <Textarea rows={8} dir="ltr" placeholder={'PAN-550,95,120\nINV-5K,,780'} value={bulkCsv} onChange={(e) => setBulkCsv(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={runBulk} disabled={!bulkCsv.trim()}>{t('products.apply')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        usagePath={deleteTarget ? `/products/${deleteTarget.id}/usage` : undefined}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            const { data } = await api.delete(`/products/${deleteTarget.id}`);
            toast.success(data?.mode === 'PURGED' ? t('common.purgedToast') : t('common.archivedToast'));
            invalidateCache('products');
            setRefreshKey((k) => k + 1);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
