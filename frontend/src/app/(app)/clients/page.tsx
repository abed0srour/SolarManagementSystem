'use client';
import { Users as PageIcon, RotateCcw } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Archive, ShoppingCart, Pencil, ClipboardList } from 'lucide-react';
import { api, errMsg, fmtMoney } from '../../../lib/api';
import { invalidateCache } from '../../../lib/cache';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import Field from '../../../components/form-field';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

const SORTS: Record<string, { sortBy: string; sortDir: string }> = {
  newest: { sortBy: 'createdAt', sortDir: 'desc' },
  oldest: { sortBy: 'createdAt', sortDir: 'asc' },
  remainingHigh: { sortBy: 'remaining', sortDir: 'desc' },
  nameAz: { sortBy: 'name', sortDir: 'asc' },
};

export default function ClientsPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState('newest');

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'INDIVIDUAL', tier: 'RETAIL', email: '', phone: '', creditLimit: 0, notes: '', address: '' });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      name: row.name, type: row.type, tier: row.tier, email: row.email ?? '', phone: row.phone ?? '',
      creditLimit: Number(row.creditLimit), notes: row.notes ?? '',
      address: row.addresses?.[0]?.line1 ?? '',
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const { address, ...rest } = form;
      const payload = {
        ...rest,
        creditLimit: Number(form.creditLimit) || 0,
        email: form.email || undefined,
        phone: form.phone || undefined,
        notes: form.notes || undefined,
        addresses: address?.trim() ? [{ label: 'Main', line1: address.trim(), isBilling: true, isInstallation: true }] : [],
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

  /** Archiving is reversible: restoring is the exact inverse of the soft delete. */
  const restore = async (row: any) => {
    try {
      await api.post(`/clients/${row.id}/restore`);
      invalidateCache('clients');
      toast.success(t('common.restored'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('clients.title')} subtitle={t('subtitles.clients')} />
      <DataTable
        endpoint="/clients"
        archived={archived}
        onArchivedChange={setArchived}
        refreshKey={refreshKey}
        initialSearch={searchParams.get('search') ?? undefined}
        extraParams={SORTS[sort]}
        filters={
          <Select className="w-full sm:w-52" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">{t('clients.sortNewest')}</option>
            <option value="oldest">{t('clients.sortOldest')}</option>
            <option value="remainingHigh">{t('clients.sortRemaining')}</option>
            <option value="nameAz">{t('clients.sortName')}</option>
          </Select>
        }
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('clients.newClient')}
          </Button>
        }
        columns={[
          { key: 'name', label: t('common.name'), mobile: 'primary' },
          { key: 'type', label: t('clients.type'), render: (r) => t(`clients.${r.type}`) },
          { key: 'tier', label: t('clients.tier'), render: (r) => <Badge variant="outline">{t(`clients.${r.tier}`)}</Badge> },
          { key: 'phone', label: t('common.phone') },
          {
            key: 'billedTotal', label: t('clients.balance'), className: 'text-end',
            render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.billedTotal ?? 0)}</span>,
          },
          {
            key: 'paidTotal', label: t('orders.paid'), className: 'text-end',
            render: (r) => <span className="tabular-nums text-green-600 dark:text-green-400">{fmtMoney(r.paidTotal ?? 0)}</span>,
          },
          {
            key: 'outstandingBalance', label: t('orders.remaining'), className: 'text-end',
            render: (r) => (
              <span className={`tabular-nums ${r.outstandingBalance > 0 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                {fmtMoney(r.outstandingBalance ?? 0)}
              </span>
            ),
          },
          {
            key: 'actions', label: '',
            render: (r) =>
              archived ? (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 dark:text-emerald-400" title={t('common.restore')} onClick={(e) => { e.stopPropagation(); restore(r); }}>
                    <RotateCcw />
                  </Button>
                </div>
              ) : (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 dark:text-blue-400" title={t('clients.viewOrders')} onClick={(e) => { e.stopPropagation(); router.push(`/clients/${r.id}/orders`); }}>
                  <ClipboardList />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 dark:text-green-400" title={t('clients.createOrder')} onClick={(e) => { e.stopPropagation(); router.push(`/clients/${r.id}/new-order`); }}>
                  <ShoppingCart />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600 dark:text-amber-400" title={t('common.edit')} onClick={(e) => { e.stopPropagation(); openEdit(r); }}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 dark:text-red-400" title={t('common.archive')} onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}>
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
            <DialogTitle>{editing ? t('clients.editClient') : t('clients.newClient')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <Field label={t('common.name')} className="sm:col-span-2"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('clients.type')}>
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="INDIVIDUAL">{t('clients.INDIVIDUAL')}</option>
                <option value="BUSINESS">{t('clients.BUSINESS')}</option>
              </Select>
            </Field>
            <Field label={t('clients.tier')}>
              <Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                <option value="RETAIL">{t('clients.RETAIL')}</option>
                <option value="INSTALLER">{t('clients.INSTALLER')}</option>
              </Select>
            </Field>
            <Field label={t('common.phone')}><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={t('common.email')}><Input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={t('clients.creditLimit')}><Input type="number" min={0} value={form.creditLimit ?? 0} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></Field>
            <Field label={t('common.address')} className="sm:col-span-2 md:col-span-4">
              <Input value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label={t('common.notes')} className="sm:col-span-2 md:col-span-4">
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
        usagePath={deleteTarget ? `/clients/${deleteTarget.id}/usage` : undefined}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            const { data } = await api.delete(`/clients/${deleteTarget.id}`);
            // Say which of the two things actually happened — purged is
            // irreversible, archived is not.
            toast.success(data?.mode === 'PURGED' ? t('common.purgedToast') : t('common.archivedToast'));
            invalidateCache('clients');
            setRefreshKey((k) => k + 1);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
