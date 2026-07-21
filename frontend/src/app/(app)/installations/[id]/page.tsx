'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Leaf, Pencil, Plus, Sun, Trash2, Wrench, Zap } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Line, ComposedChart } from 'recharts';
import { api, errMsg, fmtDate, fmtMoney } from '../../../../lib/api';
import { seriesColors, chartInk } from '../../../../lib/charts';
import StatusChip from '../../../../components/status-chip';
import Field from '../../../../components/form-field';
import ConfirmDialog from '../../../../components/confirm-dialog';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';

const STATUSES = ['SURVEY', 'DESIGN', 'APPROVED', 'INSTALLING', 'COMMISSIONED', 'ACTIVE', 'ON_HOLD', 'CANCELLED'];

function InfoTile({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-lg font-bold">{value}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function InstallationDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const colors = seriesColors[mode];
  const ink = chartInk[mode];

  const [inst, setInst] = useState<any>(null);
  const [production, setProduction] = useState<any[]>([]);
  const [readings, setReadings] = useState<any[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [readingOpen, setReadingOpen] = useState(false);
  const [readingForm, setReadingForm] = useState<any>({});
  const [contractOpen, setContractOpen] = useState(false);
  const [contractForm, setContractForm] = useState<any>({});
  const [visitContract, setVisitContract] = useState<any>(null);
  const [visitForm, setVisitForm] = useState<any>({});
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(() => {
    api.get(`/installations/${id}`).then((r) => setInst(r.data)).catch(() => router.replace('/installations'));
    api.get(`/installations/${id}/production`).then((r) => setProduction(r.data.months));
    api.get(`/installations/${id}/readings`, { params: { pageSize: 31 } }).then((r) => setReadings(r.data.items));
  }, [id, router]);

  useEffect(load, [load]);

  if (!inst)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-72" />
      </div>
    );

  const openEdit = () => {
    setEditForm({
      status: inst.status,
      systemType: inst.systemType,
      siteAddress: inst.siteAddress ?? '',
      city: inst.city ?? '',
      capacityKw: String(inst.capacityKw ?? ''),
      panelCount: String(inst.panelCount ?? ''),
      batteryKwh: String(inst.batteryKwh ?? ''),
      tariffPerKwh: String(inst.tariffPerKwh ?? ''),
      expectedMonthlyKwh: inst.expectedMonthlyKwh ? String(inst.expectedMonthlyKwh) : '',
      notes: inst.notes ?? '',
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    try {
      await api.patch(`/installations/${id}`, {
        status: editForm.status,
        systemType: editForm.systemType,
        siteAddress: editForm.siteAddress || undefined,
        city: editForm.city || undefined,
        capacityKw: editForm.capacityKw ? Number(editForm.capacityKw) : undefined,
        panelCount: editForm.panelCount ? Number(editForm.panelCount) : undefined,
        batteryKwh: editForm.batteryKwh ? Number(editForm.batteryKwh) : undefined,
        tariffPerKwh: editForm.tariffPerKwh ? Number(editForm.tariffPerKwh) : undefined,
        expectedMonthlyKwh: editForm.expectedMonthlyKwh ? Number(editForm.expectedMonthlyKwh) : undefined,
        notes: editForm.notes || undefined,
      });
      toast.success(t('common.saved'));
      setEditOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveReading = async () => {
    try {
      await api.post(`/installations/${id}/readings`, {
        readingDate: readingForm.readingDate,
        energyKwh: Number(readingForm.energyKwh),
        peakPowerKw: readingForm.peakPowerKw ? Number(readingForm.peakPowerKw) : undefined,
        sunHours: readingForm.sunHours ? Number(readingForm.sunHours) : undefined,
        note: readingForm.note || undefined,
      });
      toast.success(t('common.saved'));
      setReadingOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const deleteReading = async (readingId: string) => {
    try {
      await api.delete(`/installations/${id}/readings/${readingId}`);
      toast.success(t('common.deleted'));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveContract = async () => {
    try {
      await api.post('/maintenance-contracts', {
        installationId: id,
        startDate: contractForm.startDate,
        endDate: contractForm.endDate,
        visitsPerYear: contractForm.visitsPerYear ? Number(contractForm.visitsPerYear) : undefined,
        pricePerYear: contractForm.pricePerYear ? Number(contractForm.pricePerYear) : undefined,
        notes: contractForm.notes || undefined,
      });
      toast.success(t('common.saved'));
      setContractOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveVisit = async () => {
    try {
      await api.post(`/maintenance-contracts/${visitContract.id}/visit`, {
        visitDate: visitForm.visitDate || undefined,
        technicianName: visitForm.technicianName || undefined,
        createServiceJob: visitForm.createServiceJob,
      });
      toast.success(t('maintenance.visitRecorded'));
      setVisitContract(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const removeInstallation = async () => {
    try {
      await api.delete(`/installations/${id}`);
      toast.success(t('common.deleted'));
      router.replace('/installations');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const p = inst.production;
  const tooltipStyle = {
    backgroundColor: mode === 'dark' ? '#1a1a19' : '#fcfcfb',
    border: `1px solid ${ink.grid}`,
    borderRadius: 8,
    fontSize: 12,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{inst.number}</h1>
        <StatusChip status={inst.status} />
        <span className="text-muted-foreground">·</span>
        <Link className="text-primary hover:underline" href={`/clients?search=${encodeURIComponent(inst.client?.name ?? '')}`}>
          {inst.client?.name}
        </Link>
        {inst.salesOrder && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{t('installations.linkedOrder')}: {inst.salesOrder.number}</span>
          </>
        )}
        <div className="flex-1" />
        <Button variant="outline" onClick={openEdit}><Pencil /> {t('common.edit')}</Button>
        <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 /> {t('common.delete')}</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <InfoTile icon={Sun} label={t('installations.system')} value={`${Number(inst.capacityKw)} kWp`} sub={`${inst.panelCount} ${t('installations.panelCount')} · ${Number(inst.batteryKwh)} kWh · ${t(`installations.${inst.systemType}`)}`} />
        <InfoTile icon={Zap} label={`${t('installations.production')} (${t('installations.allTime')})`} value={`${p.kwhAllTime.toLocaleString()} kWh`} sub={`${t('installations.last30')}: ${p.kwhLast30.toLocaleString()} kWh`} />
        <InfoTile icon={Wrench} label={t('installations.savings')} value={fmtMoney(p.savingsAllTime)} sub={`${t('installations.tariff')}: ${Number(inst.tariffPerKwh)}`} />
        <InfoTile icon={Leaf} label={t('installations.co2Saved')} value={`${(p.co2SavedKg / 1000).toFixed(2)} t`} sub={`${p.co2SavedKg.toLocaleString()} kg`} />
      </div>

      <div className="grid gap-4 text-sm lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 md:grid-cols-4">
            <div><span className="text-muted-foreground">{t('installations.site')}: </span>{[inst.siteAddress, inst.city].filter(Boolean).join(', ') || '—'}</div>
            <div><span className="text-muted-foreground">{t('installations.installedAt')}: </span>{fmtDate(inst.installedAt)}</div>
            <div><span className="text-muted-foreground">{t('installations.commissionedAt')}: </span>{fmtDate(inst.commissionedAt)}</div>
            <div><span className="text-muted-foreground">{t('installations.expectedMonthlyKwh')}: </span>{inst.expectedMonthlyKwh ? Number(inst.expectedMonthlyKwh).toLocaleString() : '—'}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('installations.productionLast12')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={production} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={ink.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} />
                <YAxis tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} width={60} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: ink.grid, opacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="kwh" name="kWh" fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                {inst.expectedMonthlyKwh && (
                  <Line type="monotone" dataKey="expected" name={t('installations.expectedMonthlyKwh')} stroke={colors[2]} strokeDasharray="6 3" strokeWidth={2} dot={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Readings */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">{t('installations.readings')}</CardTitle>
            <Button size="sm" onClick={() => { setReadingForm({ readingDate: new Date().toISOString().slice(0, 10), energyKwh: '', peakPowerKw: '', sunHours: '', note: '' }); setReadingOpen(true); }}>
              <Plus /> {t('installations.addReading')}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('installations.readingDate')}</TableHead>
                  <TableHead className="text-end">{t('installations.energyKwh')}</TableHead>
                  <TableHead className="text-end">{t('installations.peakPowerKw')}</TableHead>
                  <TableHead className="text-end">{t('installations.sunHours')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {readings.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('common.noRecords')}</TableCell></TableRow>
                )}
                {readings.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.readingDate)}</TableCell>
                    <TableCell className="text-end tabular-nums">{Number(r.energyKwh)}</TableCell>
                    <TableCell className="text-end tabular-nums">{r.peakPowerKw ? Number(r.peakPowerKw) : '—'}</TableCell>
                    <TableCell className="text-end tabular-nums">{r.sunHours ? Number(r.sunHours) : '—'}</TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteReading(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Maintenance contracts */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">{t('maintenance.contracts')}</CardTitle>
            <Button size="sm" variant="outline" onClick={() => { setContractForm({ startDate: new Date().toISOString().slice(0, 10), endDate: '', visitsPerYear: '2', pricePerYear: '', notes: '' }); setContractOpen(true); }}>
              <Plus /> {t('maintenance.newContract')}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('quotations.number')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('maintenance.nextVisit')}</TableHead>
                  <TableHead>{t('maintenance.endDate')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {inst.contracts.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('common.noRecords')}</TableCell></TableRow>
                )}
                {inst.contracts.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.number}</TableCell>
                    <TableCell><StatusChip status={c.status} /></TableCell>
                    <TableCell>{fmtDate(c.nextVisitDate)}</TableCell>
                    <TableCell>{fmtDate(c.endDate)}</TableCell>
                    <TableCell className="text-end">
                      {c.status === 'ACTIVE' && (
                        <Button variant="outline" size="sm" onClick={() => { setVisitContract(c); setVisitForm({ visitDate: new Date().toISOString().slice(0, 10), technicianName: '', createServiceJob: true }); }}>
                          <Wrench /> {t('maintenance.recordVisit')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{t('installations.editInstallation')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.status')}>
              <Select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('installations.systemType')}>
              <Select value={editForm.systemType} onChange={(e) => setEditForm({ ...editForm, systemType: e.target.value })}>
                {['ON_GRID', 'OFF_GRID', 'HYBRID'].map((x) => <option key={x} value={x}>{t(`installations.${x}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('installations.capacityKw')}>
              <Input type="number" step="0.1" value={editForm.capacityKw ?? ''} onChange={(e) => setEditForm({ ...editForm, capacityKw: e.target.value })} />
            </Field>
            <Field label={t('installations.panelCount')}>
              <Input type="number" value={editForm.panelCount ?? ''} onChange={(e) => setEditForm({ ...editForm, panelCount: e.target.value })} />
            </Field>
            <Field label={t('installations.batteryKwh')}>
              <Input type="number" step="0.1" value={editForm.batteryKwh ?? ''} onChange={(e) => setEditForm({ ...editForm, batteryKwh: e.target.value })} />
            </Field>
            <Field label={t('installations.tariff')}>
              <Input type="number" step="0.01" value={editForm.tariffPerKwh ?? ''} onChange={(e) => setEditForm({ ...editForm, tariffPerKwh: e.target.value })} />
            </Field>
            <Field label={t('installations.expectedMonthlyKwh')}>
              <Input type="number" value={editForm.expectedMonthlyKwh ?? ''} onChange={(e) => setEditForm({ ...editForm, expectedMonthlyKwh: e.target.value })} />
            </Field>
            <Field label={t('installations.city')}>
              <Input value={editForm.city ?? ''} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
            </Field>
            <Field label={t('installations.siteAddress')} className="col-span-2">
              <Input value={editForm.siteAddress ?? ''} onChange={(e) => setEditForm({ ...editForm, siteAddress: e.target.value })} />
            </Field>
            <Field label={t('common.notes')} className="col-span-2">
              <Textarea rows={2} value={editForm.notes ?? ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveEdit}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add reading dialog */}
      <Dialog open={readingOpen} onOpenChange={setReadingOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('installations.addReading')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('installations.readingDate')}>
              <Input type="date" value={readingForm.readingDate ?? ''} onChange={(e) => setReadingForm({ ...readingForm, readingDate: e.target.value })} />
            </Field>
            <Field label={t('installations.energyKwh')}>
              <Input type="number" step="0.1" value={readingForm.energyKwh ?? ''} onChange={(e) => setReadingForm({ ...readingForm, energyKwh: e.target.value })} />
            </Field>
            <Field label={t('installations.peakPowerKw')}>
              <Input type="number" step="0.1" value={readingForm.peakPowerKw ?? ''} onChange={(e) => setReadingForm({ ...readingForm, peakPowerKw: e.target.value })} />
            </Field>
            <Field label={t('installations.sunHours')}>
              <Input type="number" step="0.1" value={readingForm.sunHours ?? ''} onChange={(e) => setReadingForm({ ...readingForm, sunHours: e.target.value })} />
            </Field>
            <Field label={t('common.notes')} className="col-span-2">
              <Input value={readingForm.note ?? ''} onChange={(e) => setReadingForm({ ...readingForm, note: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReadingOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveReading} disabled={!readingForm.readingDate || !readingForm.energyKwh}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New contract dialog */}
      <Dialog open={contractOpen} onOpenChange={setContractOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('maintenance.newContract')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('maintenance.startDate')}>
              <Input type="date" value={contractForm.startDate ?? ''} onChange={(e) => setContractForm({ ...contractForm, startDate: e.target.value })} />
            </Field>
            <Field label={t('maintenance.endDate')}>
              <Input type="date" value={contractForm.endDate ?? ''} onChange={(e) => setContractForm({ ...contractForm, endDate: e.target.value })} />
            </Field>
            <Field label={t('maintenance.visitsPerYear')}>
              <Input type="number" value={contractForm.visitsPerYear ?? ''} onChange={(e) => setContractForm({ ...contractForm, visitsPerYear: e.target.value })} />
            </Field>
            <Field label={t('maintenance.pricePerYear')}>
              <Input type="number" step="0.01" value={contractForm.pricePerYear ?? ''} onChange={(e) => setContractForm({ ...contractForm, pricePerYear: e.target.value })} />
            </Field>
            <Field label={t('common.notes')} className="col-span-2">
              <Input value={contractForm.notes ?? ''} onChange={(e) => setContractForm({ ...contractForm, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContractOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveContract} disabled={!contractForm.startDate || !contractForm.endDate}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record visit dialog */}
      <Dialog open={!!visitContract} onOpenChange={(o) => !o && setVisitContract(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('maintenance.recordVisit')} — {visitContract?.number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('maintenance.visitDate')}>
                <Input type="date" value={visitForm.visitDate ?? ''} onChange={(e) => setVisitForm({ ...visitForm, visitDate: e.target.value })} />
              </Field>
              <Field label={t('serviceJobs.technician')}>
                <Input value={visitForm.technicianName ?? ''} onChange={(e) => setVisitForm({ ...visitForm, technicianName: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!visitForm.createServiceJob} onChange={(e) => setVisitForm({ ...visitForm, createServiceJob: e.target.checked })} />
              {t('maintenance.createJob')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVisitContract(null)}>{t('common.cancel')}</Button>
            <Button onClick={saveVisit}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        requireText={t('common.deleteWord')}
        title={t('common.confirmTitle')}
        description={t('installations.deleteConfirm')}
        onConfirm={removeInstallation}
      />
    </div>
  );
}
