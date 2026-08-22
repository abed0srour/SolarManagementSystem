'use client';
import { Wrench as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api, errMsg, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import EntityLink, { linkTo } from '../../../components/entity-link';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import { ClientPicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export default function ServiceJobsPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [statusFilter, setStatusFilter] = useState('');

  const openCreate = () => {
    setEditing(null);
    setForm({ client: null, type: 'INSTALLATION', technicianName: '', scheduledDate: '', notes: '' });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      client: row.client ? { id: row.clientId, name: row.client.name } : null,
      type: row.type,
      status: row.status,
      technicianName: row.technicianName ?? '',
      scheduledDate: row.scheduledDate ? row.scheduledDate.slice(0, 10) : '',
      notes: row.notes ?? '',
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        clientId: form.client?.id,
        type: form.type,
        status: form.status,
        technicianName: form.technicianName || undefined,
        scheduledDate: form.scheduledDate || undefined,
        notes: form.notes || undefined,
      };
      if (editing) await api.patch(`/service-jobs/${editing.id}`, payload);
      else await api.post('/service-jobs', payload);
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('serviceJobs.title')} subtitle={t('subtitles.serviceJobs')} />
      <DataTable
        endpoint="/service-jobs"
        refreshKey={refreshKey}
        extraParams={statusFilter ? { status: statusFilter } : undefined}
        onRowClick={openEdit}
        filters={
          <Select className="w-full sm:w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </Select>
        }
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('serviceJobs.newJob')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), mobile: 'primary', render: (r) => <span className="font-mono text-sm font-semibold">{r.number}</span> },
          { key: 'client', label: t('common.client'), render: (r) => r.client?.name },
          { key: 'type', label: t('serviceJobs.jobType'), render: (r) => t(`serviceJobs.${r.type}`) },
          { key: 'technicianName', label: t('serviceJobs.technician') },
          { key: 'scheduledDate', label: t('serviceJobs.scheduledDate'), render: (r) => fmtDate(r.scheduledDate) },
          { key: 'salesOrder', label: t('orders.salesTitle'), render: (r) => <EntityLink href={linkTo.salesOrder(r.salesOrderId ?? r.salesOrder?.id)} mono>{r.salesOrder?.number}</EntityLink> },
          { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? editing.number : t('serviceJobs.newJob')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('common.client')}>
              <ClientPicker value={form.client} onChange={(c) => setForm({ ...form, client: c })} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('serviceJobs.jobType')}>
                <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {['INSTALLATION', 'MAINTENANCE', 'SURVEY', 'REPAIR'].map((x) => (
                    <option key={x} value={x}>{t(`serviceJobs.${x}`)}</option>
                  ))}
                </Select>
              </Field>
              {editing && (
                <Field label={t('common.status')}>
                  <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
                      <option key={s} value={s}>{t(`status.${s}`)}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t('serviceJobs.technician')}>
                <Input placeholder="e.g. Ali Ahmad" value={form.technicianName ?? ''} onChange={(e) => setForm({ ...form, technicianName: e.target.value })} />
              </Field>
              <Field label={t('serviceJobs.scheduledDate')}>
                <Input type="date" value={form.scheduledDate ?? ''} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
              </Field>
            </div>
            <Field label={t('common.notes')}>
              <Textarea rows={3} placeholder="Job details, issue description, or site notes..." value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!form.client}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
