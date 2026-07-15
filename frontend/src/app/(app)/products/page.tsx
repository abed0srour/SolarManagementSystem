'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, History, Upload, Trash2 } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, fmtDateTime } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import Field from '../../../components/form-field';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function ProductsPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [categories, setCategories] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [attrs, setAttrs] = useState<Record<string, any>>({});
  const [historyFor, setHistoryFor] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCsv, setBulkCsv] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  useEffect(() => {
    api.get('/categories').then((r) => setCategories(r.data));
  }, []);

  const subCategories = categories.flatMap((c) => c.subCategories.map((s: any) => ({ ...s, categoryName: c.name })));
  const selectedSub = subCategories.find((s) => s.id === form.subCategoryId);
  const attrDefs: any[] = selectedSub?.attributeDefs ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm({ sku: '', name: '', brand: '', model: '', subCategoryId: '', costPrice: 0, salePrice: 0, taxRatePct: 0, trackSerials: true, lowStockThreshold: 5, warrantyMonths: '', performanceWarrantyMonths: '', shelfLifeMonths: '', barcode: '', notes: '' });
    setAttrs({});
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      sku: row.sku, name: row.name, brand: row.brand ?? '', model: row.model ?? '',
      subCategoryId: row.subCategoryId, costPrice: Number(row.costPrice), salePrice: Number(row.salePrice),
      taxRatePct: Number(row.taxRatePct), trackSerials: row.trackSerials, lowStockThreshold: row.lowStockThreshold,
      warrantyMonths: row.warrantyMonths ?? '', performanceWarrantyMonths: row.performanceWarrantyMonths ?? '',
      shelfLifeMonths: row.shelfLifeMonths ?? '', barcode: row.barcode ?? '', notes: row.notes ?? '',
      isActive: row.isActive, priceChangeReason: '',
    });
    setAttrs(row.attributes ?? {});
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload: any = {
        ...form,
        costPrice: Number(form.costPrice),
        salePrice: Number(form.salePrice),
        taxRatePct: Number(form.taxRatePct) || 0,
        lowStockThreshold: Number(form.lowStockThreshold) || 0,
        warrantyMonths: form.warrantyMonths === '' ? undefined : Number(form.warrantyMonths),
        performanceWarrantyMonths: form.performanceWarrantyMonths === '' ? undefined : Number(form.performanceWarrantyMonths),
        shelfLifeMonths: form.shelfLifeMonths === '' ? undefined : Number(form.shelfLifeMonths),
        brand: form.brand || undefined,
        model: form.model || undefined,
        barcode: form.barcode || undefined,
        notes: form.notes || undefined,
        priceChangeReason: form.priceChangeReason || undefined,
        attributes: attrs,
      };
      if (editing) await api.patch(`/products/${editing.id}`, payload);
      else await api.post('/products', payload);
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const showHistory = async (row: any) => {
    setHistoryFor(row);
    const { data } = await api.get(`/products/${row.id}/price-history`);
    setHistory(data);
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('products.title')}</h1>
      <DataTable
        endpoint="/products"
        refreshKey={refreshKey}
        initialSearch={searchParams.get('search') ?? undefined}
        extraParams={categoryFilter ? { categoryId: categoryFilter } : undefined}
        onRowClick={openEdit}
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
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setBulkOpen(true); setBulkCsv(''); }}>
              <Upload /> {t('products.bulkPrices')}
            </Button>
            <Button onClick={openCreate}>
              <Plus /> {t('products.newProduct')}
            </Button>
          </div>
        }
        columns={[
          { key: 'sku', label: t('products.sku'), sortable: true, render: (r) => <span className="font-mono text-xs">{r.sku}</span> },
          { key: 'name', label: t('common.name'), sortable: true },
          { key: 'brand', label: t('products.brand'), sortable: true },
          { key: 'cat', label: t('products.category'), render: (r) => `${r.subCategory?.category?.name ?? ''} / ${r.subCategory?.name ?? ''}` },
          { key: 'costPrice', label: t('products.costPrice'), sortable: true, className: 'text-end', render: (r) => <span className="tabular-nums">{fmtMoney(r.costPrice)}</span> },
          { key: 'salePrice', label: t('products.salePrice'), sortable: true, className: 'text-end', render: (r) => <span className="tabular-nums">{fmtMoney(r.salePrice)}</span> },
          { key: 'priceUpdatedAt', label: t('products.priceAsOf'), sortable: true, render: (r) => fmtDate(r.priceUpdatedAt) },
          {
            key: 'stock',
            label: t('products.stock'),
            className: 'text-end',
            render: (r) => {
              const qty = (r.stockLevels ?? []).reduce((s: number, l: any) => s + l.quantity, 0);
              return qty <= r.lowStockThreshold ? <Badge variant="destructive">{qty}</Badge> : <span className="tabular-nums">{qty}</span>;
            },
          },
          {
            key: 'actions',
            label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" title={t('products.priceHistory')} onClick={(e) => { e.stopPropagation(); showHistory(r); }}>
                  <History />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}>
                  <Trash2 />
                </Button>
              </div>
            ),
          },
        ]}
      />

      {/* Create / edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{editing ? t('products.editProduct') : t('products.newProduct')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('products.sku')}><Input value={form.sku ?? ''} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
            <Field label={t('common.name')} className="md:col-span-2"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('products.brand')}><Input value={form.brand ?? ''} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
            <Field label={t('products.model')}><Input value={form.model ?? ''} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
            <Field label={t('products.subCategory')} className="md:col-span-2">
              <Select value={form.subCategoryId ?? ''} onChange={(e) => setForm({ ...form, subCategoryId: e.target.value })}>
                <option value="">—</option>
                {subCategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.categoryName} / {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('products.barcode')}><Input value={form.barcode ?? ''} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></Field>
            <Field label={t('products.costPrice')}><Input type="number" min={0} step="0.01" value={form.costPrice ?? 0} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></Field>
            <Field label={t('products.salePrice')}><Input type="number" min={0} step="0.01" value={form.salePrice ?? 0} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} /></Field>
            <Field label={t('products.taxRate')}><Input type="number" min={0} value={form.taxRatePct ?? 0} onChange={(e) => setForm({ ...form, taxRatePct: e.target.value })} /></Field>
            <Field label={t('products.lowStockThreshold')}><Input type="number" min={0} value={form.lowStockThreshold ?? 5} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} /></Field>
            <Field label={t('products.warrantyMonths')}><Input type="number" min={0} value={form.warrantyMonths ?? ''} onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })} /></Field>
            <Field label={t('products.performanceWarrantyMonths')}><Input type="number" min={0} value={form.performanceWarrantyMonths ?? ''} onChange={(e) => setForm({ ...form, performanceWarrantyMonths: e.target.value })} /></Field>
            <Field label={t('products.shelfLifeMonths')}><Input type="number" min={0} value={form.shelfLifeMonths ?? ''} onChange={(e) => setForm({ ...form, shelfLifeMonths: e.target.value })} /></Field>
            <div className="flex items-center gap-2 pt-6">
              <input id="trackSerials" type="checkbox" className="h-4 w-4" checked={!!form.trackSerials} onChange={(e) => setForm({ ...form, trackSerials: e.target.checked })} />
              <label htmlFor="trackSerials" className="text-sm">{t('products.trackSerials')}</label>
            </div>
            {editing && (
              <Field label={t('products.priceChangeReason')} className="md:col-span-3">
                <Input value={form.priceChangeReason ?? ''} onChange={(e) => setForm({ ...form, priceChangeReason: e.target.value })} />
              </Field>
            )}
            <Field label={t('common.notes')} className="col-span-2 md:col-span-4">
              <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>

          {attrDefs.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-semibold">{t('products.specs')}</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {attrDefs.map((a) => (
                  <Field key={a.id} label={a.unit ? `${a.label} (${a.unit})` : a.label}>
                    {a.type === 'SELECT' ? (
                      <Select value={attrs[a.name] ?? ''} onChange={(e) => setAttrs({ ...attrs, [a.name]: e.target.value })}>
                        <option value="">—</option>
                        {(a.options ?? []).map((o: string) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </Select>
                    ) : a.type === 'BOOLEAN' ? (
                      <input type="checkbox" className="h-4 w-4" checked={!!attrs[a.name]} onChange={(e) => setAttrs({ ...attrs, [a.name]: e.target.checked })} />
                    ) : (
                      <Input
                        type={a.type === 'NUMBER' ? 'number' : a.type === 'DATE' ? 'date' : 'text'}
                        value={attrs[a.name] ?? ''}
                        onChange={(e) => setAttrs({ ...attrs, [a.name]: a.type === 'NUMBER' ? Number(e.target.value) : e.target.value })}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save}>{t('common.save')}</Button>
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
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={async () => {
          try {
            await api.delete(`/products/${deleteTarget.id}`);
            toast.success(t('common.deleted'));
            setRefreshKey((k) => k + 1);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
