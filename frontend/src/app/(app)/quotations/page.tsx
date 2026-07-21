'use client';
import { FileText as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, ArrowRightCircle, Trash2 } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import LineItemsEditor, { LineItem, emptyLine, toItemsPayload } from '../../../components/line-items-editor';
import ClientInfoDialog from '../../../components/client-info-dialog';
import { ClientPicker, WarehousePicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export default function QuotationsPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [statusFilter, setStatusFilter] = useState('');
  const [convertFor, setConvertFor] = useState<any>(null);
  const [convertWh, setConvertWh] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [clientInfo, setClientInfo] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm({ client: null, status: 'DRAFT', validUntil: '', discountType: '', discountValue: 0, notes: '' });
    setLines([emptyLine()]);
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      client: row.client ? { id: row.clientId, name: row.client.name } : null,
      status: row.status,
      validUntil: row.validUntil ? row.validUntil.slice(0, 10) : '',
      discountType: row.discountType ?? '',
      discountValue: Number(row.discountValue),
      notes: row.notes ?? '',
    });
    setLines(
      (row.items ?? []).map((i: any) => ({
        product: i.product ? { id: i.productId, name: i.product.name, sku: i.product.sku, salePrice: i.unitPrice } : { id: i.productId, name: i.description ?? 'item', sku: '', salePrice: i.unitPrice },
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        discountType: i.discountType ?? '',
        discountValue: Number(i.discountValue),
      })),
    );
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        clientId: form.client?.id,
        status: form.status,
        validUntil: form.validUntil || undefined,
        discountType: form.discountType || undefined,
        discountValue: form.discountType ? Number(form.discountValue) : undefined,
        notes: form.notes || undefined,
        items: toItemsPayload(lines),
      };
      if (editing) await api.patch(`/quotations/${editing.id}`, payload);
      else await api.post('/quotations', payload);
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const convert = async () => {
    try {
      await api.post(`/quotations/${convertFor.id}/convert`, { warehouseId: convertWh?.id });
      toast.success(t('quotations.converted'));
      setConvertFor(null);
      setConvertWh(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('quotations.title')} subtitle={t('subtitles.quotations')} />
      <DataTable
        endpoint="/quotations"
        refreshKey={refreshKey}
        extraParams={statusFilter ? { status: statusFilter } : undefined}
        onRowClick={openEdit}
        filters={
          <Select className="w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </Select>
        }
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('quotations.newQuotation')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          {
            key: 'client', label: t('common.client'),
            render: (r) => r.client?.name ? (
              <button className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setClientInfo(r.clientId); }}>{r.client.name}</button>
            ) : '—',
          },
          { key: 'createdAt', label: t('common.date'), render: (r) => fmtDate(r.createdAt) },
          { key: 'validUntil', label: t('quotations.validUntil'), render: (r) => fmtDate(r.validUntil) },
          { key: 'total', label: t('common.total'), className: 'text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.total)}</span> },
          { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
          {
            key: 'actions', label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                {['DRAFT', 'SENT', 'ACCEPTED'].includes(r.status) && r.salesOrders?.length === 0 && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title={t('quotations.convert')} onClick={(e) => { e.stopPropagation(); setConvertFor(r); }}>
                    <ArrowRightCircle />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}>
                  <Trash2 />
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{editing ? `${editing.number}` : t('quotations.newQuotation')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('common.client')} className="md:col-span-2">
              <ClientPicker value={form.client} onChange={(c) => setForm({ ...form, client: c })} />
            </Field>
            <Field label={t('common.status')}>
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'].map((s) => (
                  <option key={s} value={s}>{t(`status.${s}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('quotations.validUntil')}>
              <Input type="date" value={form.validUntil ?? ''} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </Field>
            <Field label={`${t('common.discount')} (${t('common.total')})`}>
              <Select value={form.discountType ?? ''} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
                <option value="">{t('common.none')}</option>
                <option value="PERCENT">{t('common.percent')}</option>
                <option value="FIXED">{t('common.fixed')}</option>
              </Select>
            </Field>
            {form.discountType && (
              <Field label={t('common.discount')}>
                <Input type="number" min={0} value={form.discountValue ?? 0} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} />
              </Field>
            )}
            <Field label={t('common.notes')} className="col-span-2">
              <Textarea rows={1} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <LineItemsEditor lines={lines} onChange={setLines} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!form.client || toItemsPayload(lines).length === 0}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert dialog */}
      <Dialog open={!!convertFor} onOpenChange={(v) => !v && setConvertFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('quotations.convert')} — {convertFor?.number}</DialogTitle></DialogHeader>
          <Field label={t('common.warehouse')}>
            <WarehousePicker value={convertWh} onChange={setConvertWh} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={convert} disabled={!convertWh}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClientInfoDialog clientId={clientInfo} onOpenChange={(v) => !v && setClientInfo(null)} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            await api.delete(`/quotations/${deleteTarget.id}`);
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
