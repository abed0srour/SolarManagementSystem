'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { HardHat as PageIcon, Plus, Pencil, Archive, CalendarPlus, RotateCcw } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import Field from '../../../components/form-field';
import { api, errMsg, fmtMoney, fmtDate } from '../../../lib/api';
import { invalidateCache } from '../../../lib/cache';
import { useLocalFirstData } from '../../../lib/use-local-storage-cache';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent } from '../../../components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

/** yyyy-mm-dd in local time — `toISOString` shifts the day east of UTC. */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Start and end of the current week (Mon–Sun) or month. */
function periodRange(period: 'WEEKLY' | 'MONTHLY', anchor: Date) {
  if (period === 'WEEKLY') {
    const day = (anchor.getDay() + 6) % 7; // Monday = 0
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - day);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: iso(start), to: iso(end) };
  }
  return {
    from: iso(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
    to: iso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
  };
}

export default function WorkersPage() {
  const t = useTranslations();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [archived, setArchived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const [period, setPeriod] = useState<'WEEKLY' | 'MONTHLY'>('MONTHLY');
  const [anchor, setAnchor] = useState(() => iso(new Date()));
  const { from, to } = useMemo(() => periodRange(period, new Date(`${anchor}T00:00:00`)), [period, anchor]);

  const { data: summary, refresh: refreshSummary } = useLocalFirstData<any>(
    `workers:payroll:${period}:${from}`,
    () => api.get('/workers/payroll-summary', { params: { from, to } }).then((r) => r.data),
  );

  // Attendance logging
  const [attFor, setAttFor] = useState<any>(null);
  const [att, setAtt] = useState<any>({});

  const openAttendance = (row: any) => {
    setAttFor(row);
    setAtt({ date: iso(new Date()), status: 'PRESENT', hoursWorked: Number(row.expectedHoursPerDay), lateHours: 0, bonus: 0, deduction: 0, notes: '' });
  };

  const saveAttendance = async () => {
    try {
      await api.post(`/workers/${attFor.id}/attendance`, {
        ...att,
        hoursWorked: Number(att.hoursWorked) || 0,
        lateHours: Number(att.lateHours) || 0,
        bonus: Number(att.bonus) || 0,
        deduction: Number(att.deduction) || 0,
        notes: att.notes || undefined,
      });
      invalidateCache('workers');
      toast.success(t('common.saved'));
      setAttFor(null);
      refreshSummary();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const restore = async (row: any) => {
    try {
      await api.post(`/workers/${row.id}/restore`);
      invalidateCache('workers');
      toast.success(t('common.restored'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('workers.title')} subtitle={t('workers.subtitle')} />

      {/* Settlement summary for the chosen week or month. */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full sm:w-auto">
              <label className="mb-1.5 block text-sm font-medium">{t('workers.payPeriod')}</label>
              <Select className="w-full sm:w-36" value={period} onChange={(e) => setPeriod(e.target.value as any)}>
                <option value="WEEKLY">{t('workers.weekly')}</option>
                <option value="MONTHLY">{t('workers.monthly')}</option>
              </Select>
            </div>
            <div className="w-full sm:w-auto">
              <label className="mb-1.5 block text-sm font-medium">{t('common.date')}</label>
              <Input type="date" className="w-full sm:w-40" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} />
            </div>
            <div className="w-full sm:w-auto sm:ms-auto text-start sm:text-end pt-2 sm:pt-0">
              <div className="text-xs text-muted-foreground">{t('workers.periodTotal')}</div>
              <div className="text-2xl font-bold">{fmtMoney(summary?.grandTotal ?? 0)}</div>
              <div className="text-xs text-muted-foreground">{fmtDate(from)} — {fmtDate(to)}</div>
            </div>
          </div>

          {summary?.rows?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead className="w-20 text-end">{t('workers.present')}</TableHead>
                  <TableHead className="w-20 text-end">{t('workers.absent')}</TableHead>
                  <TableHead className="w-24 text-end">{t('workers.lateHours')}</TableHead>
                  <TableHead className="w-28 text-end">{t('workers.gross')}</TableHead>
                  <TableHead className="w-28 text-end">{t('workers.deductions')}</TableHead>
                  <TableHead className="w-28 text-end">{t('workers.net')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="font-medium">{r.name}</span>
                      <span className="ms-2 font-mono text-xs text-muted-foreground">{r.code}</span>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{r.daysPresent}</TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">{r.daysAbsent}</TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">{r.lateHours}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmtMoney(r.gross)}</TableCell>
                    <TableCell className="text-end tabular-nums text-destructive">{r.deductions ? `−${fmtMoney(r.deductions)}` : '—'}</TableCell>
                    <TableCell className="text-end font-semibold tabular-nums">{fmtMoney(r.net)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('common.noRecords')}</p>
          )}
        </CardContent>
      </Card>

      <DataTable
        endpoint="/workers"
        refreshKey={refreshKey}
        archived={archived}
        onArchivedChange={setArchived}
        toolbar={
          <Button onClick={() => router.push('/workers/create')}>
            <Plus /> {t('workers.newWorker')}
          </Button>
        }
        columns={[
          { key: 'name', label: t('common.name'), mobile: 'primary', sortable: true },
          { key: 'code', label: t('workers.code'), render: (r) => <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">{r.code}</span> },
          { key: 'jobTitle', label: t('workers.jobTitle'), render: (r) => r.jobTitle ?? '—' },
          { key: 'phone', label: t('common.phone'), render: (r) => r.phone ?? '—' },
          {
            key: 'rate', label: t('workers.rate'), className: 'text-end',
            render: (r) => (
              <span className="tabular-nums">
                {r.payBasis === 'HOURLY' ? `${fmtMoney(r.hourlyRate)} / ${t('workers.hour')}` : `${fmtMoney(r.dailyRate)} / ${t('workers.day')}`}
              </span>
            ),
          },
          { key: 'payPeriod', label: t('workers.payPeriod'), render: (r) => <Badge variant="outline">{t(`workers.${r.payPeriod === 'WEEKLY' ? 'weekly' : 'monthly'}`)}</Badge> },
          {
            key: 'actions', label: '',
            render: (r) =>
              archived ? (
                <div className="flex justify-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 dark:text-emerald-400" title={t('common.restore')} onClick={() => restore(r)}>
                    <RotateCcw />
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 dark:text-emerald-400" title={t('workers.logAttendance')} onClick={() => openAttendance(r)}>
                    <CalendarPlus />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title={t('common.edit')} onClick={() => router.push(`/workers/${r.id}/edit`)}>
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

      {/* Log a day */}
      <Dialog open={!!attFor} onOpenChange={(v) => !v && setAttFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workers.logAttendance')} — {attFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <Field label={t('common.date')}><Input type="date" value={att.date ?? ''} onChange={(e) => setAtt({ ...att, date: e.target.value })} /></Field>
            <Field label={t('common.status')}>
              <Select value={att.status} onChange={(e) => setAtt({ ...att, status: e.target.value })}>
                <option value="PRESENT">{t('workers.present')}</option>
                <option value="ABSENT">{t('workers.absent')}</option>
                <option value="LEAVE">{t('workers.leave')}</option>
                <option value="HOLIDAY">{t('workers.holiday')}</option>
              </Select>
            </Field>
            {att.status === 'PRESENT' && (
              <>
                <Field label={t('workers.hoursWorked')}><Input type="number" min={0} step="0.5" value={att.hoursWorked ?? 0} onChange={(e) => setAtt({ ...att, hoursWorked: e.target.value })} /></Field>
                <Field label={t('workers.lateHours')}><Input type="number" min={0} step="0.5" value={att.lateHours ?? 0} onChange={(e) => setAtt({ ...att, lateHours: e.target.value })} /></Field>
              </>
            )}
            <Field label={t('workers.bonus')}><Input type="number" step="0.01" value={att.bonus ?? 0} onChange={(e) => setAtt({ ...att, bonus: e.target.value })} /></Field>
            <Field label={t('workers.deduction')}><Input type="number" step="0.01" value={att.deduction ?? 0} onChange={(e) => setAtt({ ...att, deduction: e.target.value })} /></Field>
            <Field label={t('common.notes')} className="sm:col-span-2"><Input value={att.notes ?? ''} onChange={(e) => setAtt({ ...att, notes: e.target.value })} /></Field>
          </div>
          <p className="text-xs text-muted-foreground">{t('workers.attendanceHint')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={saveAttendance} disabled={!att.date}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        usagePath={deleteTarget ? `/workers/${deleteTarget.id}/usage` : undefined}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            const { data } = await api.delete(`/workers/${deleteTarget.id}`);
            invalidateCache('workers');
            toast.success(data?.mode === 'PURGED' ? t('common.purgedToast') : t('common.archivedToast'));
            setRefreshKey((k) => k + 1);
            refreshSummary();
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
