'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, ArrowLeftRight, SlidersHorizontal } from 'lucide-react';
import { api, errMsg, fmtDate, fmtDateTime } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import { ProductPicker, WarehousePicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export default function InventoryPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [lowOnly, setLowOnly] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [whOpen, setWhOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const loadWh = () => api.get('/inventory/warehouses').then((r) => setWarehouses(r.data));
  useEffect(() => {
    loadWh();
  }, []);

  const doAdjust = async () => {
    try {
      await api.post('/inventory/adjust', {
        productId: form.product?.id,
        warehouseId: form.warehouse?.id,
        delta: Number(form.delta),
        reason: form.reason,
      });
      toast.success(t('common.saved'));
      setAdjustOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const doTransfer = async () => {
    try {
      await api.post('/inventory/transfer', {
        productId: form.product?.id,
        fromWarehouseId: form.fromWarehouse?.id,
        toWarehouseId: form.toWarehouse?.id,
        quantity: Number(form.quantity),
        reason: form.reason || undefined,
        serialNumbers: form.serials ? String(form.serials).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
      });
      toast.success(t('common.saved'));
      setTransferOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const addWarehouse = async () => {
    try {
      await api.post('/inventory/warehouses', { name: form.name, address: form.address || undefined, isDefault: !!form.isDefault });
      toast.success(t('common.saved'));
      setWhOpen(false);
      loadWh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('inventory.title')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setForm({}); setAdjustOpen(true); }}>
            <SlidersHorizontal /> {t('inventory.adjust')}
          </Button>
          <Button variant="outline" onClick={() => { setForm({}); setTransferOpen(true); }}>
            <ArrowLeftRight /> {t('inventory.transfer')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('inventory.overview')}</TabsTrigger>
          <TabsTrigger value="movements">{t('inventory.movements')}</TabsTrigger>
          <TabsTrigger value="serials">{t('inventory.serials')}</TabsTrigger>
          <TabsTrigger value="warehouses">{t('inventory.warehouses')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <DataTable
            endpoint="/inventory/overview"
            refreshKey={refreshKey}
            extraParams={{ lowOnly: lowOnly ? 'true' : undefined }}
            filters={
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
                {t('inventory.lowOnly')}
              </label>
            }
            columns={[
              { key: 'sku', label: t('products.sku'), render: (r) => <span className="font-mono text-xs">{r.sku}</span> },
              { key: 'name', label: t('common.name') },
              { key: 'cat', label: t('products.category'), render: (r) => `${r.subCategory?.category?.name} / ${r.subCategory?.name}` },
              {
                key: 'levels', label: t('inventory.warehouses'),
                render: (r) => (
                  <div className="flex flex-wrap gap-1">
                    {(r.stockLevels ?? []).map((l: any) => (
                      <Badge key={l.id} variant="muted">
                        {l.warehouse?.name}: {l.quantity}
                      </Badge>
                    ))}
                  </div>
                ),
              },
              {
                key: 'totalQty', label: t('inventory.onHand'), className: 'text-end',
                render: (r) => (r.isLow ? <Badge variant="destructive">{r.totalQty}</Badge> : <span className="tabular-nums">{r.totalQty}</span>),
              },
              { key: 'lowStockThreshold', label: t('products.lowStockThreshold'), className: 'text-end' },
            ]}
          />
        </TabsContent>

        <TabsContent value="movements">
          <DataTable
            endpoint="/inventory/movements"
            refreshKey={refreshKey}
            searchable={false}
            columns={[
              { key: 'createdAt', label: t('common.date'), render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</span> },
              { key: 'product', label: t('common.product'), render: (r) => `${r.product?.name} [${r.product?.sku}]` },
              { key: 'type', label: t('inventory.movementType'), render: (r) => <Badge variant="outline">{r.type}</Badge> },
              { key: 'quantity', label: t('common.quantity'), className: 'text-end' },
              { key: 'warehouse', label: t('common.warehouse'), render: (r) => r.toWarehouse ? `${r.warehouse?.name} → ${r.toWarehouse?.name}` : r.warehouse?.name },
              { key: 'reason', label: t('products.reason') },
              { key: 'user', label: t('audit.user'), render: (r) => r.user?.name ?? '—' },
            ]}
          />
        </TabsContent>

        <TabsContent value="serials">
          <DataTable
            endpoint="/inventory/units"
            refreshKey={refreshKey}
            searchable={false}
            filters={<SerialSearch onFound={() => {}} />}
            columns={[
              { key: 'serialNumber', label: t('inventory.serialNumber'), render: (r) => <span className="font-mono text-xs">{r.serialNumber}</span> },
              { key: 'product', label: t('common.product'), render: (r) => `${r.product?.name} [${r.product?.sku}]` },
              { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
              { key: 'warehouse', label: t('common.warehouse'), render: (r) => r.warehouse?.name ?? '—' },
              { key: 'manufactureDate', label: t('inventory.manufactureDate'), render: (r) => fmtDate(r.manufactureDate) },
              { key: 'warrantyEndDate', label: t('warranty.warrantyEnd'), render: (r) => fmtDate(r.warrantyEndDate) },
              { key: 'invoice', label: t('payments.invoice'), render: (r) => r.invoice?.number ?? '—' },
            ]}
          />
        </TabsContent>

        <TabsContent value="warehouses">
          <div className="rounded-lg border bg-card">
            <div className="flex justify-end border-b p-3">
              <Button onClick={() => { setForm({}); setWhOpen(true); }}>
                <Plus /> {t('inventory.newWarehouse')}
              </Button>
            </div>
            <div className="divide-y">
              {warehouses.map((w) => (
                <div key={w.id} className="flex items-center gap-3 p-3">
                  <span className="font-medium">{w.name}</span>
                  {w.isDefault && <Badge>{t('inventory.default')}</Badge>}
                  <span className="text-sm text-muted-foreground">{w.address}</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Adjust dialog */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('inventory.adjust')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('common.product')}><ProductPicker value={form.product ?? null} onChange={(p) => setForm({ ...form, product: p })} /></Field>
            <Field label={t('common.warehouse')}><WarehousePicker value={form.warehouse ?? null} onChange={(w) => setForm({ ...form, warehouse: w })} /></Field>
            <Field label={t('inventory.delta')}><Input type="number" value={form.delta ?? ''} onChange={(e) => setForm({ ...form, delta: e.target.value })} /></Field>
            <Field label={t('products.reason')}><Input value={form.reason ?? ''} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={doAdjust} disabled={!form.product || !form.warehouse || !form.delta || !form.reason}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('inventory.transfer')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('common.product')}><ProductPicker value={form.product ?? null} onChange={(p) => setForm({ ...form, product: p })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('inventory.fromWarehouse')}><WarehousePicker value={form.fromWarehouse ?? null} onChange={(w) => setForm({ ...form, fromWarehouse: w })} /></Field>
              <Field label={t('inventory.toWarehouse')}><WarehousePicker value={form.toWarehouse ?? null} onChange={(w) => setForm({ ...form, toWarehouse: w })} /></Field>
            </div>
            <Field label={t('common.quantity')}><Input type="number" min={1} value={form.quantity ?? ''} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
            <Field label={t('orders.serialsHint')}><Input dir="ltr" value={form.serials ?? ''} onChange={(e) => setForm({ ...form, serials: e.target.value })} /></Field>
            <Field label={t('products.reason')}><Input value={form.reason ?? ''} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={doTransfer} disabled={!form.product || !form.fromWarehouse || !form.toWarehouse || !form.quantity}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Warehouse dialog */}
      <Dialog open={whOpen} onOpenChange={setWhOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('inventory.newWarehouse')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('common.name')}><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('common.address')}><Input value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={!!form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              {t('inventory.default')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWhOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={addWarehouse} disabled={!form.name}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SerialSearch({ onFound }: { onFound: (unit: any) => void }) {
  const t = useTranslations();
  const [serial, setSerial] = useState('');
  const [result, setResult] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const lookup = async () => {
    try {
      const { data } = await api.get(`/inventory/units/serial/${encodeURIComponent(serial.trim())}`);
      setResult(data);
      setOpen(true);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <>
      <div className="flex gap-2">
        <Input dir="ltr" className="w-48" placeholder={t('inventory.serialLookup')} value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && serial && lookup()} />
        <Button variant="outline" onClick={lookup} disabled={!serial.trim()}>
          {t('inventory.serialLookup')}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{result?.serialNumber}</DialogTitle></DialogHeader>
          {result && (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('common.product')}: </span>{result.product?.name} [{result.product?.sku}]</div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">{t('common.status')}: </span><StatusChip status={result.status} /></div>
              <div><span className="text-muted-foreground">{t('common.warehouse')}: </span>{result.warehouse?.name ?? '—'}</div>
              <div><span className="text-muted-foreground">{t('payments.invoice')}: </span>{result.invoice?.number ?? '—'} {result.invoice?.client?.name ? `(${result.invoice.client.name})` : ''}</div>
              <div><span className="text-muted-foreground">{t('warranty.warrantyEnd')}: </span>{fmtDate(result.warrantyEndDate)}</div>
              {result.warrantyClaims?.length > 0 && (
                <div>
                  <span className="text-muted-foreground">{t('warranty.claims')}: </span>
                  {result.warrantyClaims.map((c: any) => c.number).join(', ')}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
