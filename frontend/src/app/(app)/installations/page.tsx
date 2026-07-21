'use client';
import { HardHat as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Sun } from 'lucide-react';
import { api, errMsg, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import { ClientPicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

const STATUSES = ['SURVEY', 'DESIGN', 'APPROVED', 'INSTALLING', 'COMMISSIONED', 'ACTIVE', 'ON_HOLD', 'CANCELLED'];

export default function InstallationsPage() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [statusFilter, setStatusFilter] = useState('');

  const openCreate = () => {
    setForm({
      client: null, systemType: 'HYBRID', capacityKw: '', panelCount: '', batteryKwh: '',
      siteAddress: '', city: '', tariffPerKwh: '0.20', expectedMonthlyKwh: '', notes: '',
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const { data } = await api.post('/installations', {
        clientId: form.client?.id,
        systemType: form.systemType,
        siteAddress: form.siteAddress || undefined,
        city: form.city || undefined,
        capacityKw: form.capacityKw ? Number(form.capacityKw) : undefined,
        panelCount: form.panelCount ? Number(form.panelCount) : undefined,
        batteryKwh: form.batteryKwh ? Number(form.batteryKwh) : undefined,
        tariffPerKwh: form.tariffPerKwh ? Number(form.tariffPerKwh) : undefined,
        expectedMonthlyKwh: form.expectedMonthlyKwh ? Number(form.expectedMonthlyKwh) : undefined,
        notes: form.notes || undefined,
      });
      toast.success(t('common.saved'));
      setOpen(false);
      router.push(`/installations/${data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('installations.title')} subtitle={t('subtitles.installations')} />
      <DataTable
        endpoint="/installations"
        extraParams={statusFilter ? { status: statusFilter } : undefined}
        onRowClick={(r) => router.push(`/installations/${r.id}`)}
        filters={
          <Select className="w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </Select>
        }
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('installations.newInstallation')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: 'client', label: t('common.client'), render: (r) => r.client?.name },
          { key: 'systemType', label: t('installations.systemType'), render: (r) => t(`installations.${r.systemType}`) },
          {
            key: 'capacityKw',
            label: t('installations.capacityKw'),
            className: 'text-end',
            render: (r) => (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Sun className="h-3.5 w-3.5 text-amber-500" /> {Number(r.capacityKw)} kWp
              </span>
            ),
          },
          { key: 'city', label: t('installations.city') },
          { key: 'commissionedAt', label: t('installations.commissionedAt'), render: (r) => fmtDate(r.commissionedAt) },
          { key: '_count', label: t('installations.readings'), className: 'text-end', render: (r) => r._count?.readings ?? 0 },
          { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{t('installations.newInstallation')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('common.client')}>
              <ClientPicker value={form.client} onChange={(c) => setForm({ ...form, client: c })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('installations.systemType')}>
                <Select value={form.systemType} onChange={(e) => setForm({ ...form, systemType: e.target.value })}>
                  {['ON_GRID', 'OFF_GRID', 'HYBRID'].map((x) => (
                    <option key={x} value={x}>{t(`installations.${x}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('installations.city')}>
                <Input value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
              <Field label={t('installations.capacityKw')}>
                <Input type="number" step="0.1" value={form.capacityKw ?? ''} onChange={(e) => setForm({ ...form, capacityKw: e.target.value })} />
              </Field>
              <Field label={t('installations.panelCount')}>
                <Input type="number" value={form.panelCount ?? ''} onChange={(e) => setForm({ ...form, panelCount: e.target.value })} />
              </Field>
              <Field label={t('installations.batteryKwh')}>
                <Input type="number" step="0.1" value={form.batteryKwh ?? ''} onChange={(e) => setForm({ ...form, batteryKwh: e.target.value })} />
              </Field>
              <Field label={t('installations.tariff')}>
                <Input type="number" step="0.01" value={form.tariffPerKwh ?? ''} onChange={(e) => setForm({ ...form, tariffPerKwh: e.target.value })} />
              </Field>
              <Field label={t('installations.expectedMonthlyKwh')}>
                <Input type="number" value={form.expectedMonthlyKwh ?? ''} onChange={(e) => setForm({ ...form, expectedMonthlyKwh: e.target.value })} />
              </Field>
            </div>
            <Field label={t('installations.siteAddress')}>
              <Input value={form.siteAddress ?? ''} onChange={(e) => setForm({ ...form, siteAddress: e.target.value })} />
            </Field>
            <Field label={t('common.notes')}>
              <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
