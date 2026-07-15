'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { api, errMsg, fmtMoney } from '../../../lib/api';
import DataTable from '../../../components/data-table';
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('suppliers.title')}</h1>
      <DataTable
        endpoint="/suppliers"
        refreshKey={refreshKey}
        onRowClick={openEdit}
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('suppliers.newSupplier')}
          </Button>
        }
        columns={[
          { key: 'name', label: t('common.name'), sortable: true },
          { key: 'contactName', label: t('suppliers.contactName') },
          { key: 'phone', label: t('common.phone') },
          { key: 'email', label: t('common.email') },
          { key: 'leadTimeDays', label: t('suppliers.leadTime'), className: 'text-end' },
          {
            key: 'outstandingPayable', label: t('suppliers.payable'), className: 'text-end',
            render: (r) => <span className={`tabular-nums ${r.outstandingPayable > 0 ? 'font-medium text-amber-600 dark:text-amber-400' : ''}`}>{fmtMoney(r.outstandingPayable)}</span>,
          },
          {
            key: 'actions', label: '',
            render: (r) => (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}>
                <Trash2 />
              </Button>
            ),
          },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{editing ? t('suppliers.editSupplier') : t('suppliers.newSupplier')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('common.name')} className="md:col-span-2"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('suppliers.contactName')}><Input value={form.contactName ?? ''} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
            <Field label={t('suppliers.taxId')}><Input value={form.taxId ?? ''} onChange={(e) => setForm({ ...form, taxId: e.target.value })} /></Field>
            <Field label={t('common.phone')}><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={t('common.email')}><Input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={t('common.address')}><Input value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label={t('suppliers.leadTime')}><Input type="number" min={0} value={form.leadTimeDays ?? ''} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} /></Field>
            <Field label={t('common.notes')} className="col-span-2 md:col-span-4">
              <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={async () => {
          try {
            await api.delete(`/suppliers/${deleteTarget.id}`);
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
