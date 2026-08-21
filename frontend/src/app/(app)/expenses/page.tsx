'use client';
import { Wallet as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Plus, Archive, RotateCcw } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { api, errMsg, fmtDate, fmtMoney } from '../../../lib/api';
import { seriesColors, chartInk } from '../../../lib/charts';
import DataTable from '../../../components/data-table';
import Field from '../../../components/form-field';
import ConfirmDialog from '../../../components/confirm-dialog';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

const CATEGORIES = ['RENT', 'SALARIES', 'UTILITIES', 'TRANSPORT', 'MARKETING', 'EQUIPMENT', 'MAINTENANCE', 'OTHER'];
const METHODS = ['CASH', 'WHISH', 'OMT'];

export default function ExpensesPage() {
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const colors = seriesColors[mode];
  const ink = chartInk[mode];

  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [categoryFilter, setCategoryFilter] = useState('');
  const [summary, setSummary] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    api.get('/expenses/summary').then((r) => setSummary(r.data)).catch(() => {});
  }, [refreshKey]);

  const openCreate = () => {
    setEditing(null);
    setForm({ category: 'OTHER', description: '', amount: '', expenseDate: new Date().toISOString().slice(0, 10), vendor: '', paymentMethod: 'CASH', reference: '', notes: '' });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      category: row.category,
      description: row.description,
      amount: String(row.amount),
      expenseDate: row.expenseDate?.slice(0, 10) ?? '',
      vendor: row.vendor ?? '',
      paymentMethod: row.paymentMethod,
      reference: row.reference ?? '',
      notes: row.notes ?? '',
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        category: form.category,
        description: form.description,
        amount: Number(form.amount),
        expenseDate: form.expenseDate || undefined,
        vendor: form.vendor || undefined,
        paymentMethod: form.paymentMethod,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
      };
      if (editing) await api.patch(`/expenses/${editing.id}`, payload);
      else await api.post('/expenses', payload);
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/expenses/${deleteId}`);
      // An expense is always archived, never purged — see ExpensesService.remove.
      toast.success(t('common.archivedToast'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /** Archiving is reversible: restoring puts the expense back into reports. */
  const restore = async (row: any) => {
    try {
      await api.post(`/expenses/${row.id}/restore`);
      toast.success(t('common.restored'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const tooltipStyle = {
    backgroundColor: mode === 'dark' ? '#1a1a19' : '#fcfcfb',
    border: `1px solid ${ink.grid}`,
    borderRadius: 8,
    fontSize: 12,
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('expenses.title')} subtitle={t('subtitles.expenses')} />

      {summary && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t('expenses.byCategory')}</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between font-bold"><span>{t('expenses.total')}</span><span className="tabular-nums">{fmtMoney(summary.total)}</span></div>
              {summary.byCategory.map((c: any) => (
                <div key={c.category} className="flex items-center justify-between">
                  <Badge variant="muted">{t(`expenses.${c.category}`)}</Badge>
                  <span className="tabular-nums">{fmtMoney(c.total)}</span>
                </div>
              ))}
              {summary.byCategory.length === 0 && <div className="py-4 text-center text-muted-foreground">{t('common.noRecords')}</div>}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base">{t('expenses.monthlyTrend')}</CardTitle></CardHeader>
            <CardContent>
              <div dir="ltr">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={summary.byMonth} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={ink.grid} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} />
                    <YAxis tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} width={70} />
                    <Tooltip formatter={(v: any) => fmtMoney(v)} contentStyle={tooltipStyle} cursor={{ fill: ink.grid, opacity: 0.4 }} />
                    <Bar dataKey="amount" name={t('expenses.title')} fill={colors[4]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <DataTable
        endpoint="/expenses"
        refreshKey={refreshKey}
        archived={archived}
        onArchivedChange={setArchived}
        extraParams={categoryFilter ? { category: categoryFilter } : undefined}
        // Archived rows are read-only — restore before editing.
        onRowClick={archived ? undefined : openEdit}
        filters={
          <Select className="w-full sm:w-40" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`expenses.${c}`)}</option>)}
          </Select>
        }
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('expenses.newExpense')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: 'expenseDate', label: t('expenses.expenseDate'), render: (r) => fmtDate(r.expenseDate) },
          { key: 'category', label: t('expenses.category'), render: (r) => <Badge variant="muted">{t(`expenses.${r.category}`)}</Badge> },
          { key: 'description', label: t('expenses.description'), mobile: 'primary' },
          { key: 'vendor', label: t('expenses.vendor') },
          { key: 'paymentMethod', label: t('common.method'), render: (r) => t(`payments.${r.paymentMethod}`) },
          { key: 'amount', label: t('common.amount'), className: 'text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.amount)}</span> },
          { key: 'reference', label: t('common.reference'), render: (r) => r.reference ?? '—' },
          {
            key: 'actions', label: '',
            render: (r) =>
              archived ? (
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 text-green-600 dark:text-green-400"
                  title={t('common.restore')}
                  onClick={(e) => { e.stopPropagation(); void restore(r); }}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  title={t('common.archive')}
                  onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              ),
          },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? editing.number : t('expenses.newExpense')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('expenses.category')}>
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t(`expenses.${c}`)}</option>)}
                </Select>
              </Field>
              <Field label={t('common.amount')}>
                <Input type="number" step="0.01" value={form.amount ?? ''} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
              <Field label={t('expenses.expenseDate')}>
                <Input type="date" value={form.expenseDate ?? ''} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
              </Field>
              <Field label={t('common.method')}>
                <Select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                  {METHODS.map((m) => <option key={m} value={m}>{t(`payments.${m}`)}</option>)}
                </Select>
              </Field>
              <Field label={t('expenses.vendor')}>
                <Input value={form.vendor ?? ''} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
              </Field>
              <Field label={t('common.reference')}>
                <Input value={form.reference ?? ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </Field>
            </div>
            <Field label={t('expenses.description')}>
              <Input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label={t('common.notes')}>
              <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!form.description || !form.amount}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} requireText={t('common.deleteWord')} onConfirm={remove} />
    </div>
  );
}
