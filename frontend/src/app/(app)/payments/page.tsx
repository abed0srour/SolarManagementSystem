'use client';
import { CreditCard as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import ClientInfoDialog from '../../../components/client-info-dialog';
import Field from '../../../components/form-field';
import { ClientPicker, SupplierPicker, InvoicePicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function PaymentsPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [directionFilter, setDirectionFilter] = useState('');
  const [dueSchedules, setDueSchedules] = useState<any[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [clientInfo, setClientInfo] = useState<string | null>(null);

  useEffect(() => {
    api.get('/payments/due-schedules').then((r) => setDueSchedules(r.data)).catch(() => {});
  }, [refreshKey]);

  const save = async () => {
    try {
      await api.post('/payments', {
        direction: form.direction ?? 'INCOMING',
        invoiceId: form.invoice?.id,
        clientId: form.client?.id,
        supplierId: form.supplier?.id,
        method: form.method ?? 'CASH',
        amount: Number(form.amount),
        paymentDate: form.paymentDate || undefined,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
      });
      toast.success(t('common.saved'));
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('payments.title')} subtitle={t('subtitles.payments')} />

      {dueSchedules.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('payments.dueSchedules')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('payments.invoice')}</TableHead>
                  <TableHead>{t('common.client')}</TableHead>
                  <TableHead>{t('invoices.installment')}</TableHead>
                  <TableHead>{t('common.dueDate')}</TableHead>
                  <TableHead className="text-end">{t('common.amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dueSchedules.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.invoice?.number}</TableCell>
                    <TableCell>{s.invoice?.client?.name}</TableCell>
                    <TableCell>#{s.installmentNo}</TableCell>
                    <TableCell>
                      {fmtDate(s.dueDate)} {s.isOverdue && <Badge variant="destructive">{t('status.OVERDUE')}</Badge>}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{fmtMoney(s.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <DataTable
        endpoint="/payments"
        refreshKey={refreshKey}
        extraParams={directionFilter ? { direction: directionFilter } : undefined}
        filters={
          <Select className="w-36" value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            <option value="INCOMING">{t('payments.INCOMING')}</option>
            <option value="OUTGOING">{t('payments.OUTGOING')}</option>
          </Select>
        }
        toolbar={
          <Button onClick={() => { setForm({ direction: 'INCOMING', method: 'CASH' }); setOpen(true); }}>
            <Plus /> {t('payments.newPayment')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          {
            key: 'direction', label: t('payments.direction'),
            render: (r) => <Badge variant={r.direction === 'INCOMING' ? 'success' : 'warning'}>{t(`payments.${r.direction}`)}</Badge>,
          },
          {
            key: 'party', label: `${t('common.client')} / ${t('common.supplier')}`,
            render: (r) => r.client?.name && r.clientId ? (
              <button className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setClientInfo(r.clientId); }}>{r.client.name}</button>
            ) : (r.supplier?.name ?? '—'),
          },
          { key: 'invoice', label: t('payments.invoice'), render: (r) => r.invoice?.number ?? '—' },
          { key: 'method', label: t('common.method'), render: (r) => t(`payments.${r.method}`) },
          { key: 'paymentDate', label: t('common.date'), render: (r) => fmtDate(r.paymentDate) },
          { key: 'amount', label: t('common.amount'), className: 'text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.amount, r.currency)}</span> },
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
        <DialogContent>
          <DialogHeader><DialogTitle>{t('payments.newPayment')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('payments.direction')}>
              <Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value, invoice: null, client: null, supplier: null })}>
                <option value="INCOMING">{t('payments.INCOMING')}</option>
                <option value="OUTGOING">{t('payments.OUTGOING')}</option>
              </Select>
            </Field>
            <Field label={t('payments.invoice')}>
              <InvoicePicker
                value={form.invoice}
                onChange={(i) => setForm({ ...form, invoice: i })}
                params={{ type: form.direction === 'INCOMING' ? 'SALE' : 'PURCHASE' }}
              />
            </Field>
            {!form.invoice &&
              (form.direction === 'INCOMING' ? (
                <Field label={t('common.client')}>
                  <ClientPicker value={form.client} onChange={(c) => setForm({ ...form, client: c })} />
                </Field>
              ) : (
                <Field label={t('common.supplier')}>
                  <SupplierPicker value={form.supplier} onChange={(s) => setForm({ ...form, supplier: s })} />
                </Field>
              ))}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('common.amount')}>
                <Input type="number" min={0.01} step="0.01" value={form.amount ?? ''} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
              <Field label={t('common.method')}>
                <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {['CASH', 'WHISH', 'OMT', 'STORE_CREDIT'].map((m) => (
                    <option key={m} value={m}>{t(`payments.${m}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('payments.paymentDate')}>
                <Input type="date" value={form.paymentDate ?? ''} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
              </Field>
              <Field label={t('common.reference')}>
                <Input value={form.reference ?? ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!form.amount}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClientInfoDialog clientId={clientInfo} onOpenChange={(v) => !v && setClientInfo(null)} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            await api.delete(`/payments/${deleteTarget.id}`);
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
