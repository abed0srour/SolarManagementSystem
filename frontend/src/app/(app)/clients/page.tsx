'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { api, errMsg, fmtMoney } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import Field from '../../../components/form-field';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export default function ClientsPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [addresses, setAddresses] = useState<any[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'INDIVIDUAL', tier: 'RETAIL', email: '', phone: '', taxNumber: '', creditLimit: 0, notes: '' });
    setAddresses([]);
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      name: row.name, type: row.type, tier: row.tier, email: row.email ?? '', phone: row.phone ?? '',
      taxNumber: row.taxNumber ?? '', creditLimit: Number(row.creditLimit), notes: row.notes ?? '',
    });
    setAddresses((row.addresses ?? []).map((a: any) => ({ label: a.label, line1: a.line1, city: a.city ?? '', isBilling: a.isBilling, isInstallation: a.isInstallation })));
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        ...form,
        creditLimit: Number(form.creditLimit) || 0,
        email: form.email || undefined,
        phone: form.phone || undefined,
        taxNumber: form.taxNumber || undefined,
        notes: form.notes || undefined,
        addresses: addresses.filter((a) => a.line1),
      };
      if (editing) await api.patch(`/clients/${editing.id}`, payload);
      else await api.post('/clients', payload);
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('clients.title')}</h1>
      <DataTable
        endpoint="/clients"
        refreshKey={refreshKey}
        initialSearch={searchParams.get('search') ?? undefined}
        onRowClick={openEdit}
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('clients.newClient')}
          </Button>
        }
        columns={[
          { key: 'name', label: t('common.name'), sortable: true },
          { key: 'type', label: t('clients.type'), render: (r) => t(`clients.${r.type}`) },
          { key: 'tier', label: t('clients.tier'), sortable: true, render: (r) => <Badge variant="outline">{t(`clients.${r.tier}`)}</Badge> },
          { key: 'phone', label: t('common.phone') },
          { key: 'email', label: t('common.email') },
          { key: 'creditLimit', label: t('clients.creditLimit'), sortable: true, className: 'text-end', render: (r) => <span className="tabular-nums">{fmtMoney(r.creditLimit)}</span> },
          {
            key: 'outstandingBalance', label: t('clients.outstanding'), className: 'text-end',
            render: (r) => <span className={`tabular-nums ${r.outstandingBalance > 0 ? 'font-medium text-amber-600 dark:text-amber-400' : ''}`}>{fmtMoney(r.outstandingBalance)}</span>,
          },
          { key: 'storeCredit', label: t('clients.storeCredit'), className: 'text-end', render: (r) => <span className="tabular-nums">{fmtMoney(r.storeCredit)}</span> },
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
            <DialogTitle>{editing ? t('clients.editClient') : t('clients.newClient')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('common.name')} className="md:col-span-2"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('clients.type')}>
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="INDIVIDUAL">{t('clients.INDIVIDUAL')}</option>
                <option value="BUSINESS">{t('clients.BUSINESS')}</option>
              </Select>
            </Field>
            <Field label={t('clients.tier')}>
              <Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                <option value="RETAIL">{t('clients.RETAIL')}</option>
                <option value="WHOLESALE">{t('clients.WHOLESALE')}</option>
                <option value="INSTALLER">{t('clients.INSTALLER')}</option>
              </Select>
            </Field>
            <Field label={t('common.phone')}><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={t('common.email')}><Input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={t('clients.taxNumber')}><Input value={form.taxNumber ?? ''} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} /></Field>
            <Field label={t('clients.creditLimit')}><Input type="number" min={0} value={form.creditLimit ?? 0} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></Field>
            <Field label={t('common.notes')} className="col-span-2 md:col-span-4">
              <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{t('clients.addresses')}</span>
              <Button variant="outline" size="sm" onClick={() => setAddresses([...addresses, { label: 'Main', line1: '', city: '', isBilling: true, isInstallation: false }])}>
                <Plus /> {t('clients.addAddress')}
              </Button>
            </div>
            <div className="space-y-2">
              {addresses.map((a, i) => (
                <div key={i} className="grid grid-cols-2 items-center gap-2 md:grid-cols-6">
                  <Input placeholder="Label" value={a.label} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <Input className="md:col-span-2" placeholder={t('common.address')} value={a.line1} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, line1: e.target.value } : x)))} />
                  <Input placeholder="City" value={a.city} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, city: e.target.value } : x)))} />
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={a.isBilling} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, isBilling: e.target.checked } : x)))} />
                      {t('clients.billing')}
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={a.isInstallation} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, isInstallation: e.target.checked } : x)))} />
                      {t('clients.installation')}
                    </label>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setAddresses(addresses.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
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
            await api.delete(`/clients/${deleteTarget.id}`);
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
