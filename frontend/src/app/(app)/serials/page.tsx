'use client';
import { QrCode as PageIcon, Pencil, ScanLine } from 'lucide-react';
import BarcodeScanner from '../../../components/barcode-scanner';
import PageHeader from '../../../components/page-header';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api, errMsg, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import EntityLink from '../../../components/entity-link';
import Field from '../../../components/form-field';
import { ProductPicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

const STATUSES = ['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'DAMAGED', 'RETURNED_TO_SUPPLIER'];

export default function SerialsPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [product, setProduct] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    api.get('/inventory/warehouses').then((r) => setWarehouses(r.data)).catch(() => setWarehouses([]));
  }, []);

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      serialNumber: row.serialNumber,
      status: row.status,
      warehouseId: row.warehouseId ?? '',
      manufactureDate: row.manufactureDate ? String(row.manufactureDate).slice(0, 10) : '',
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/inventory/units/${editing.id}`, {
        // Only send what actually changed, so an untouched serial can never
        // collide with itself on the uniqueness check.
        serialNumber: form.serialNumber !== editing.serialNumber ? form.serialNumber.trim() : undefined,
        status: form.status !== editing.status ? form.status : undefined,
        warehouseId: form.warehouseId && form.warehouseId !== editing.warehouseId ? form.warehouseId : undefined,
        manufactureDate: form.manufactureDate || undefined,
      });
      toast.success(t('common.saved'));
      setEditing(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('serials.title')} subtitle={t('subtitles.serials')} />
      <DataTable
        endpoint="/inventory/units"
        refreshKey={refreshKey}
        extraParams={{
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
          ...(product ? { productId: product.id } : {}),
        }}
        onRowClick={openEdit}
        filters={
          <>
            <Select className="w-full sm:w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
            <Select className="w-full sm:w-44" value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
              <option value="">{t('inventory.warehouses')}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <div className="w-full sm:w-56">
              <ProductPicker value={product} onChange={setProduct} />
            </div>
          </>
        }
        columns={[
          {
            key: 'serialNumber',
            label: t('inventory.serialNumber'),
            className: 'w-44',
            render: (r) => (
              <span className="font-mono text-xs" dir="ltr">
                {r.serialNumber}
              </span>
            ),
          },
          {
            key: 'product',
            label: t('common.product'),
            render: (r) => (
              <div>
                <div className="font-medium">{r.product?.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.product?.sku}</div>
              </div>
            ),
          },
          { key: 'status', label: t('common.status'), className: 'w-32', render: (r) => <StatusChip status={r.status} /> },
          {
            key: 'warehouse',
            label: t('inventory.warehouses'),
            className: 'w-32',
            render: (r) => r.warehouse?.name ?? '—',
          },
          {
            key: 'source',
            label: t('serials.source'),
            className: 'w-40',
            render: (r) => (
              <div className="min-w-0">
                <EntityLink href={r.purchaseOrder ? `/purchase-orders/${r.purchaseOrder.id}/edit` : null} mono>
                  {r.purchaseOrder?.number}
                </EntityLink>
                {r.purchaseOrder?.supplier?.name && (
                  <div className="truncate text-xs text-muted-foreground">{r.purchaseOrder.supplier.name}</div>
                )}
              </div>
            ),
          },
          {
            key: 'salesOrder',
            label: t('nav.salesOrders'),
            className: 'w-32',
            render: (r) => (
              <EntityLink href={r.salesOrder ? `/sales-orders/${r.salesOrder.id}` : null} mono>
                {r.salesOrder?.number}
              </EntityLink>
            ),
          },
          {
            key: 'manufactureDate',
            label: t('inventory.manufactureDate'),
            className: 'w-28 whitespace-nowrap',
            render: (r) => (r.manufactureDate ? fmtDate(r.manufactureDate) : '—'),
          },
          {
            key: 'actions',
            label: '',
            className: 'w-12',
            render: (r) => (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={t('common.edit')}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(r);
                  }}
                >
                  <Pencil />
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('serials.editUnit')}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted p-3 text-sm">
                <div className="font-medium">{editing.product?.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{editing.product?.sku}</div>
              </div>
              <Field label={t('inventory.serialNumber')} hint={t('serials.serialHint')}>
                <div className="flex items-center gap-2">
                  <Input
                    dir="ltr"
                    maxLength={18}
                    className="font-mono"
                    value={form.serialNumber ?? ''}
                    onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title={t('serials.scanToFill')}
                    onClick={() => setScanOpen((v) => !v)}
                  >
                    <ScanLine className="h-4 w-4" />
                  </Button>
                </div>
              </Field>
              {scanOpen && (
                <BarcodeScanner
                  height="240px"
                  onDecode={(value) => {
                    // One decode is enough here: this replaces a single field
                    // rather than building a list, so close the camera and let
                    // the operator confirm what landed before saving.
                    setForm((prev: any) => ({ ...prev, serialNumber: value }));
                    setScanOpen(false);
                  }}
                />
              )}
              <Field label={t('common.status')}>
                <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`status.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('inventory.warehouses')}>
                <Select value={form.warehouseId ?? ''} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
                  <option value="">—</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('inventory.manufactureDate')}>
                <Input
                  type="date"
                  value={form.manufactureDate ?? ''}
                  onChange={(e) => setForm({ ...form, manufactureDate: e.target.value })}
                />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={save} disabled={busy || !form.serialNumber?.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
