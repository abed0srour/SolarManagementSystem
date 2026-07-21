'use client';
import { ReceiptText as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import LineItemsEditor, { LineItem, emptyLine, toItemsPayload } from '../../../components/line-items-editor';
import ClientInfoDialog from '../../../components/client-info-dialog';
import { ClientPicker, SupplierPicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export default function InvoicesPage() {
  const t = useTranslations();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [clientInfo, setClientInfo] = useState<string | null>(null);

  const openCreate = () => {
    setForm({ type: 'SALE', client: null, supplier: null, dueDate: '', discountType: '', discountValue: 0, shippingFee: 0, notes: '' });
    setLines([emptyLine()]);
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        type: form.type,
        clientId: form.type === 'SALE' ? form.client?.id : undefined,
        supplierId: form.type === 'PURCHASE' ? form.supplier?.id : undefined,
        dueDate: form.dueDate || undefined,
        discountType: form.discountType || undefined,
        discountValue: form.discountType ? Number(form.discountValue) : undefined,
        shippingFee: Number(form.shippingFee) || 0,
        notes: form.notes || undefined,
        items: toItemsPayload(lines),
      };
      const { data } = await api.post('/invoices', payload);
      toast.success(t('common.saved'));
      setOpen(false);
      router.push(`/invoices/${data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('invoices.title')} subtitle={t('subtitles.invoices')} />
      <DataTable
        endpoint="/invoices"
        refreshKey={refreshKey}
        extraParams={{ ...(statusFilter ? { status: statusFilter } : {}), ...(typeFilter ? { type: typeFilter } : {}) }}
        onRowClick={(r) => router.push(`/invoices/${r.id}`)}
        filters={
          <>
            <Select className="w-36" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="SALE">{t('invoices.sale')}</option>
              <option value="PURCHASE">{t('invoices.purchase')}</option>
            </Select>
            <Select className="w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>{t(`status.${s}`)}</option>
              ))}
            </Select>
          </>
        }
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('invoices.newInvoice')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('invoices.number'), render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: 'type', label: t('clients.type'), render: (r) => (r.type === 'SALE' ? t('invoices.sale') : t('invoices.purchase')) },
          {
            key: 'party', label: `${t('common.client')} / ${t('common.supplier')}`,
            render: (r) => r.client?.name && r.clientId ? (
              <button className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setClientInfo(r.clientId); }}>{r.client.name}</button>
            ) : (r.supplier?.name ?? '—'),
          },
          { key: 'issueDate', label: t('invoices.issueDate'), render: (r) => fmtDate(r.issueDate) },
          { key: 'dueDate', label: t('common.dueDate'), render: (r) => fmtDate(r.dueDate) },
          { key: 'total', label: t('common.total'), className: 'text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.total, r.currency)}</span> },
          { key: 'paidAmount', label: t('invoices.paid'), className: 'text-end', render: (r) => <span className="tabular-nums">{fmtMoney(r.paidAmount, r.currency)}</span> },
          { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wide>
          <DialogHeader><DialogTitle>{t('invoices.newInvoice')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('clients.type')}>
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="SALE">{t('invoices.sale')}</option>
                <option value="PURCHASE">{t('invoices.purchase')}</option>
              </Select>
            </Field>
            {form.type === 'SALE' ? (
              <Field label={t('common.client')} className="md:col-span-2">
                <ClientPicker value={form.client} onChange={(c) => setForm({ ...form, client: c })} />
              </Field>
            ) : (
              <Field label={t('common.supplier')} className="md:col-span-2">
                <SupplierPicker value={form.supplier} onChange={(s) => setForm({ ...form, supplier: s })} />
              </Field>
            )}
            <Field label={t('common.dueDate')}>
              <Input type="date" value={form.dueDate ?? ''} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
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
            <Field label={t('common.shipping')}>
              <Input type="number" min={0} value={form.shippingFee ?? 0} onChange={(e) => setForm({ ...form, shippingFee: e.target.value })} />
            </Field>
            <Field label={t('common.notes')}>
              <Input value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <LineItemsEditor lines={lines} onChange={setLines} priceField={form.type === 'PURCHASE' ? 'costPrice' : 'salePrice'} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={(form.type === 'SALE' ? !form.client : !form.supplier) || toItemsPayload(lines).length === 0}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClientInfoDialog clientId={clientInfo} onOpenChange={(v) => !v && setClientInfo(null)} />
    </div>
  );
}
