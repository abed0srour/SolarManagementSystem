'use client';
import { Package as PageIcon, RotateCcw } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, History, Upload, Archive, Pencil, FileUp } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, fmtDateTime } from '../../../lib/api';
import { csvBool, csvNumber, parseCsv } from '../../../lib/csv';
import { invalidateCache } from '../../../lib/cache';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
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

  useEffect(() => {
    api.get('/categories').then((r) => setCategories(r.data)).catch(() => {});
  }, []);

  const showHistory = async (row: any) => {
    setHistoryFor(row);
    const { data } = await api.get(`/products/${row.id}/price-history`);
    setHistory(data);
  };

  /**
   * Parsed preview of the pasted/uploaded CSV. Header names are normalised by
   * `parseCsv`, so `Sale Price`, `sale_price` and `SALEPRICE` all resolve.
   */
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
      // Accept either unit; years wins when both are present.
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
        setRefreshKey((k) => k + 1); // also flushes the cached product queries
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

  /** Archiving is reversible: restoring is the exact inverse of the soft delete. */
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
        filters={
          <Select className="w-44" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-initial"
              onClick={() => { setImportOpen(true); setImportCsv(''); setImportResult(null); }}
            >
              <FileUp /> {t('products.importProducts')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-initial"
              onClick={() => { setBulkOpen(true); setBulkCsv(''); }}
            >
              <Upload /> {t('products.bulkPrices')}
            </Button>
            <Button
              size="sm"
              className="flex-1 sm:flex-initial"
              onClick={() => router.push('/products/new')}
            >
              <Plus /> {t('products.newProduct')}
            </Button>
          </div>
        }
        columns={[
          { key: 'name', label: t('common.name'), mobile: 'primary', sortable: true },
          { key: 'sku', label: t('products.sku'), sortable: true, render: (r) => <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">{r.sku}</span> },
          { key: 'brand', label: t('products.brand'), sortable: true },
          { key: 'model', label: t('products.model'), sortable: true },
          { key: 'cat', label: t('products.category'), render: (r) => `${r.subCategory?.category?.name ?? ''} / ${r.subCategory?.name ?? ''}` },
          { key: 'costPrice', label: t('products.costPrice'), sortable: true, className: 'text-end', render: (r) => <span className="tabular-nums font-mono">{fmtMoney(r.costPrice)}</span> },
          { key: 'salePrice', label: t('products.salePrice'), sortable: true, className: 'text-end', render: (r) => <span className="tabular-nums font-mono font-semibold text-primary">{fmtMoney(r.salePrice)}</span> },
          { key: 'priceUpdatedAt', label: t('products.priceAsOf'), sortable: true, render: (r) => fmtDate(r.priceUpdatedAt) },
          {
            key: 'actions',
            label: '',
            render: (r) =>
              // An archived product is read-only: restore it before editing.
              archived ? (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 dark:text-emerald-400" title={t('common.restore')} onClick={() => restore(r)}>
                    <RotateCcw />
                  </Button>
                </div>
              ) : (
              <div className="flex justify-end gap-1">
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
                  // Allow re-picking the same file after a failed import.
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
            // Say which of the two things actually happened — purged is
            // irreversible, archived is not.
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
