'use client';
import { ShieldCheck as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Eye, Plus } from 'lucide-react';
import { api, errMsg, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import { ClientPicker, ProductPicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export default function WarrantyPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [statusFilter, setStatusFilter] = useState('');
  const [unitInfo, setUnitInfo] = useState<any>(null);

  const save = async () => {
    try {
      await api.post('/warranty/claims', {
        serialNumber: form.serialNumber || undefined,
        clientId: form.client?.id,
        productId: form.product?.id,
        issue: form.issue,
      });
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const update = async () => {
    try {
      await api.patch(`/warranty/claims/${editTarget.id}`, {
        status: editForm.status,
        resolution: editForm.resolution || undefined,
      });
      toast.success(t('common.saved'));
      setEditTarget(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('warranty.title')} subtitle={t('subtitles.warranty')} />
      <Tabs defaultValue="units">
        <TabsList>
          <TabsTrigger value="units">{t('warranty.soldUnits')}</TabsTrigger>
          <TabsTrigger value="claims">{t('warranty.claims')}</TabsTrigger>
          <TabsTrigger value="expiring">{t('warranty.expiring')}</TabsTrigger>
        </TabsList>

        <TabsContent value="units">
          <DataTable
            endpoint="/inventory/units"
            searchable={false}
            refreshKey={refreshKey}
            extraParams={{ status: 'SOLD' }}
            onRowClick={(r) => setUnitInfo(r)}
            columns={[
              { key: 'serialNumber', label: t('inventory.serialNumber'), render: (r) => <span className="whitespace-nowrap font-mono text-xs" dir="ltr">{r.serialNumber}</span> },
              { key: 'product', label: t('common.product'), render: (r) => `${r.product?.name} [${r.product?.sku}]` },
              { key: 'client', label: t('common.client'), render: (r) => r.invoice?.client?.name ?? r.salesOrder?.client?.name ?? '—' },
              { key: 'phone', label: t('common.phone'), render: (r) => r.invoice?.client?.phone ?? r.salesOrder?.client?.phone ?? '—' },
              { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
              {
                key: 'actions', label: '', className: 'w-12',
                render: (r) => (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 dark:text-blue-400" title={t('warranty.unitDetails')} onClick={(e) => { e.stopPropagation(); setUnitInfo(r); }}>
                    <Eye />
                  </Button>
                ),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="claims">
          <DataTable
            endpoint="/warranty/claims"
            refreshKey={refreshKey}
            extraParams={statusFilter ? { status: statusFilter } : undefined}
            onRowClick={(r) => {
              setEditTarget(r);
              setEditForm({ status: r.status, resolution: r.resolution ?? '' });
            }}
            filters={
              <Select className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">{t('common.all')}</option>
                {['OPEN', 'SENT_TO_SUPPLIER', 'RESOLVED', 'REPLACED', 'REJECTED'].map((s) => (
                  <option key={s} value={s}>{t(`status.${s}`)}</option>
                ))}
              </Select>
            }
            toolbar={
              <Button onClick={() => { setForm({}); setOpen(true); }}>
                <Plus /> {t('warranty.newClaim')}
              </Button>
            }
            columns={[
              { key: 'number', label: t('quotations.number'), render: (r) => <span className="font-mono text-xs">{r.number}</span> },
              { key: 'client', label: t('common.client'), render: (r) => r.client?.name },
              { key: 'product', label: t('common.product'), render: (r) => `${r.product?.name} ${r.serialNumber ? `(SN ${r.serialNumber})` : ''}` },
              { key: 'issue', label: t('warranty.issue'), render: (r) => <span className="line-clamp-1 max-w-64">{r.issue}</span> },
              { key: 'openedAt', label: t('warranty.openedAt'), render: (r) => fmtDate(r.openedAt) },
              { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
            ]}
          />
        </TabsContent>

        <TabsContent value="expiring">
          <DataTable
            endpoint="/warranty/expiring"
            searchable={false}
            refreshKey={refreshKey}
            columns={[
              { key: 'serialNumber', label: t('inventory.serialNumber'), render: (r) => <span className="font-mono text-xs">{r.serialNumber}</span> },
              { key: 'product', label: t('common.product'), render: (r) => `${r.product?.name} [${r.product?.sku}]` },
              { key: 'client', label: t('common.client'), render: (r) => r.invoice?.client?.name ?? '—' },
              { key: 'phone', label: t('common.phone'), render: (r) => r.invoice?.client?.phone ?? '—' },
              { key: 'invoice', label: t('payments.invoice'), render: (r) => r.invoice?.number ?? '—' },
              { key: 'warrantyEndDate', label: t('warranty.warrantyEnd'), render: (r) => fmtDate(r.warrantyEndDate) },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* New claim */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('warranty.newClaim')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('inventory.serialNumber')}>
              <Input dir="ltr" placeholder={t('warranty.serialHint')} value={form.serialNumber ?? ''} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
            </Field>
            <Field label={t('common.client')}>
              <ClientPicker value={form.client} onChange={(c) => setForm({ ...form, client: c })} />
            </Field>
            {!form.serialNumber && (
              <Field label={t('common.product')}>
                <ProductPicker value={form.product} onChange={(p) => setForm({ ...form, product: p })} />
              </Field>
            )}
            <Field label={t('warranty.issue')}>
              <Textarea rows={3} value={form.issue ?? ''} onChange={(e) => setForm({ ...form, issue: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!form.issue || (!form.serialNumber && !form.product)}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sold unit warranty details */}
      <Dialog open={!!unitInfo} onOpenChange={(v) => !v && setUnitInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono text-sm" dir="ltr">{unitInfo?.serialNumber}</DialogTitle>
          </DialogHeader>
          {unitInfo && (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('common.product')}: </span>{unitInfo.product?.name} [{unitInfo.product?.sku}]</div>
              <div><span className="text-muted-foreground">{t('common.client')}: </span>{unitInfo.invoice?.client?.name ?? unitInfo.salesOrder?.client?.name ?? '—'}</div>
              <div><span className="text-muted-foreground">{t('common.phone')}: </span>{unitInfo.invoice?.client?.phone ?? unitInfo.salesOrder?.client?.phone ?? '—'}</div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">{t('common.status')}: </span><StatusChip status={unitInfo.status} /></div>
              <div><span className="text-muted-foreground">{t('inventory.startDay')}: </span>{fmtDate(unitInfo.warrantyStartDate)}</div>
              <div><span className="text-muted-foreground">{t('warranty.warrantyEnd')}: </span>{fmtDate(unitInfo.warrantyEndDate)}</div>
              {unitInfo.performanceWarrantyEndDate && (
                <div><span className="text-muted-foreground">{t('warranty.performanceEnd')}: </span>{fmtDate(unitInfo.performanceWarrantyEndDate)}</div>
              )}
              {unitInfo.manufactureDate && (
                <div><span className="text-muted-foreground">{t('inventory.manufactureDate')}: </span>{fmtDate(unitInfo.manufactureDate)}</div>
              )}
              {unitInfo.invoice?.number && (
                <div><span className="text-muted-foreground">{t('payments.invoice')}: </span><span className="font-mono text-xs">{unitInfo.invoice.number}</span></div>
              )}
              {unitInfo.salesOrder?.number && (
                <div><span className="text-muted-foreground">{t('nav.salesOrders')}: </span><span className="font-mono text-xs">{unitInfo.salesOrder.number}</span></div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Update claim */}
      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editTarget?.number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{editTarget?.issue}</p>
            <Field label={t('common.status')}>
              <Select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                {['OPEN', 'SENT_TO_SUPPLIER', 'RESOLVED', 'REPLACED', 'REJECTED'].map((s) => (
                  <option key={s} value={s}>{t(`status.${s}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('warranty.resolution')}>
              <Textarea rows={3} value={editForm.resolution ?? ''} onChange={(e) => setEditForm({ ...editForm, resolution: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={update}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
