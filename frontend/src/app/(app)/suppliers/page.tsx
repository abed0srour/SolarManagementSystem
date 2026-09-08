'use client';
import { Truck as PageIcon, RotateCcw } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Archive, Pencil } from 'lucide-react';
import { api, errMsg, fmtMoney } from '../../../lib/api';
import { invalidateCache } from '../../../lib/cache';
import DataTable from '../../../components/data-table';
import EntityLink, { linkTo } from '../../../components/entity-link';
import ConfirmDialog from '../../../components/confirm-dialog';
import Field from '../../../components/form-field';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export default function SuppliersPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [archived, setArchived] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', contactName: '', email: '', phone: '', address: '', taxId: '', leadTimeDays: '', notes: '' });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      name: row.name, contactName: row.contactName ?? '', email: row.email ?? '', phone: row.phone ?? '',
      address: row.address ?? '', taxId: row.taxId ?? '', leadTimeDays: row.leadTimeDays ?? '', notes: row.notes ?? '',
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        name: form.name,
        contactName: form.contactName || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        taxId: form.taxId || undefined,
        leadTimeDays: form.leadTimeDays === '' ? undefined : Number(form.leadTimeDays),
        notes: form.notes || undefined,
      };
      if (editing) await api.patch(`/suppliers/${editing.id}`, payload);
      else await api.post('/suppliers', payload);
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /** Archiving is reversible: restoring is the exact inverse of the soft delete. */
  const restore = async (row: any) => {
    try {
      await api.post(`/suppliers/${row.id}/restore`);
      invalidateCache('suppliers');
      toast.success(t('common.restored'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('suppliers.title')} subtitle={t('subtitles.suppliers')} />
      <DataTable
        endpoint="/suppliers"
        archived={archived}
        onArchivedChange={setArchived}
        refreshKey={refreshKey}
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('suppliers.newSupplier')}
          </Button>
        }
        columns={[
          {
            key: 'name', label: t('common.name'), mobile: 'primary', sortable: true,
            render: (r) => <EntityLink href={linkTo.supplier(r.id)}>{r.name}</EntityLink>,
          },
          { key: 'contactName', label: t('suppliers.contactName') },
          { key: 'phone', label: t('common.phone') },
          { key: 'address', label: t('suppliers.location'), render: (r) => r.address ?? '—' },
          {
            key: 'totalPurchased', label: t('common.total'), className: 'text-end',
            render: (r) => <span className="tabular-nums">{fmtMoney(r.totalPurchased ?? 0)}</span>,
          },
          {
            key: 'totalPaid', label: t('orders.paid'), className: 'text-end',
            render: (r) => <span className="tabular-nums text-green-600 dark:text-green-400">{fmtMoney(r.totalPaid ?? 0)}</span>,
          },
          {
            key: 'outstandingPayable', label: t('orders.remaining'), className: 'text-end',
            render: (r) => <span className={`tabular-nums ${r.outstandingPayable > 0 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>{fmtMoney(r.outstandingPayable)}</span>,
          },
          {
            key: 'actions', label: '',
            render: (r) =>
              archived ? (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 dark:text-emerald-400" title={t('common.restore')} onClick={() => restore(r)}>
                    <RotateCcw />
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title={t('common.edit')} onClick={() => openEdit(r)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 dark:text-red-400" title={t('common.archive')} onClick={() => setDeleteTarget(r)}>
                    <Archive />
                  </Button>
                </div>
              ),
          },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{editing ? t('suppliers.editSupplier') : t('suppliers.newSupplier')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <Field label={t('common.name')} className="sm:col-span-2">
              <Input placeholder="e.g. Deye Middle East / Alpha Solar SARL" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('suppliers.contactName')}>
              <Input placeholder="e.g. Jane Smith" value={form.contactName ?? ''} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </Field>
            <Field label={t('suppliers.taxId')}>
              <Input dir="ltr" placeholder="e.g. 1234567-89" value={form.taxId ?? ''} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
            </Field>
            <Field label={t('common.phone')}>
              <Input dir="ltr" placeholder="e.g. +961 1 234 567" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label={t('common.email')}>
              <Input type="email" dir="ltr" placeholder="e.g. info@supplier.com" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label={t('common.address')}>
              <Input placeholder="e.g. Industrial Zone, Sector 4, Beirut" value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label={t('suppliers.leadTime')}>
              <Input type="number" min={0} placeholder="e.g. 7" value={form.leadTimeDays ?? ''} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} />
            </Field>
            <Field label={t('common.notes')} className="sm:col-span-2 md:col-span-4">
              <Textarea rows={2} placeholder="Optional notes about this supplier..." value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        usagePath={deleteTarget ? `/suppliers/${deleteTarget.id}/usage` : undefined}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            const { data } = await api.delete(`/suppliers/${deleteTarget.id}`);
            // Say which of the two things actually happened — purged is
            // irreversible, archived is not.
            toast.success(data?.mode === 'PURGED' ? t('common.purgedToast') : t('common.archivedToast'));
            invalidateCache('suppliers');
            setRefreshKey((k) => k + 1);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
