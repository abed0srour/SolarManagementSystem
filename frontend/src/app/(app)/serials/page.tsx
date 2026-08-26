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
import SerialContainer from '../../../components/serial-container';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';

const STATUSES = ['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'DAMAGED', 'RETURNED_TO_SUPPLIER'];

export default function SerialsPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  // Units on the shelf are what someone opening this page is nearly always
  // after. Sold and returned units outnumber them over time and would bury the
  // ones still worth acting on, so the list starts filtered and the operator
  // widens it deliberately.
  const [statusFilter, setStatusFilter] = useState('IN_STOCK');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [product, setProduct] = useState<any>(null);
  const [containerProduct, setContainerProduct] = useState<any>(null);
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
      <Tabs defaultValue="units">
        <TabsList className="w-full sm:w-auto flex flex-wrap h-auto p-1 gap-1">
          <TabsTrigger value="units">{t('serials.allUnits')}</TabsTrigger>
          <TabsTrigger value="containers">{t('serials.containers')}</TabsTrigger>
          <TabsTrigger value="mismatches">{t('serials.mismatches')}</TabsTrigger>
        </TabsList>

        <TabsContent value="containers" className="space-y-4">
          <div className="w-full sm:w-72">
            <ProductPicker value={containerProduct} onChange={setContainerProduct} />
          </div>
          {containerProduct ? (
            <SerialContainer productId={containerProduct.id} onChanged={() => setRefreshKey((k) => k + 1)} />
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t('serials.pickProduct')}
            </div>
          )}
        </TabsContent>

        <TabsContent value="mismatches">
          <SerialDrift
            refreshKey={refreshKey}
            onPick={(row) => {
              setContainerProduct({ id: row.productId, name: row.productName, sku: row.sku });
            }}
          />
        </TabsContent>

        <TabsContent value="units">
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
        </TabsContent>
      </Tabs>

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

/**
 * Containers whose serial count does not match the stock quantity behind them.
 *
 * Read-only on purpose. The flows that move stock have not always moved serials
 * with it, so existing data drifts; this shows where, and hands the operator to
 * the container that can fix it, without rewriting anything on their behalf.
 */
function SerialDrift({ refreshKey, onPick }: { refreshKey: number; onPick: (row: any) => void }) {
  const t = useTranslations();
  const [rows, setRows] = useState<any[] | null>(null);

  useEffect(() => {
    api
      .get('/inventory/serial-drift')
      .then((r) => setRows(r.data.items))
      .catch((e) => {
        toast.error(errMsg(e));
        setRows([]);
      });
  }, [refreshKey]);

  if (rows === null) return <div className="p-8 text-center text-sm text-muted-foreground">{t('common.loading')}</div>;
  if (!rows.length)
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t('serials.driftEmpty')}
      </div>
    );

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-start font-medium">{t('common.product')}</th>
            <th className="px-4 py-2 text-start font-medium">{t('inventory.warehouses')}</th>
            <th className="px-4 py-2 text-end font-medium">{t('serials.inStockQty')}</th>
            <th className="px-4 py-2 text-end font-medium">{t('serials.recorded')}</th>
            <th className="px-4 py-2 text-end font-medium">{t('serials.difference')}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr
              key={`${r.productId}:${r.warehouseId}`}
              className="cursor-pointer hover:bg-muted/40"
              onClick={() => onPick(r)}
            >
              <td className="px-4 py-2">
                <div className="font-medium">{r.productName}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.sku}</div>
              </td>
              <td className="px-4 py-2">{r.warehouseName}</td>
              <td className="px-4 py-2 text-end tabular-nums">{r.capacity}</td>
              <td className="px-4 py-2 text-end tabular-nums">{r.filled}</td>
              <td
                className={`px-4 py-2 text-end font-medium tabular-nums ${
                  r.difference > 0 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {r.difference > 0 ? `+${r.difference}` : r.difference}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
