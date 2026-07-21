'use client';
import { PackagePlus as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, PackageCheck, Banknote } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export default function PurchaseOrdersPage() {
  const t = useTranslations();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('');
  const [receiveFor, setReceiveFor] = useState<any>(null);
  const [receiveLines, setReceiveLines] = useState<Record<string, { qty: number; serials: string }>>({});
  const [payFor, setPayFor] = useState<any>(null);
  const [payForm, setPayForm] = useState<any>({});

  const openReceive = async (row: any) => {
    const { data } = await api.get(`/purchase-orders/${row.id}`);
    setReceiveFor(data);
    setReceiveLines(Object.fromEntries(data.items.map((i: any) => [i.productId, { qty: i.quantity - i.receivedQty, serials: '' }])));
  };

  const doReceive = async () => {
    try {
      const linesPayload = Object.entries(receiveLines)
        .filter(([, v]) => Number(v.qty) > 0)
        .map(([productId, v]) => ({
          productId,
          quantity: Number(v.qty),
          serialNumbers: v.serials.trim() ? v.serials.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        }));
      await api.post(`/purchase-orders/${receiveFor.id}/receive`, { lines: linesPayload });
      toast.success(t('common.saved'));
      setReceiveFor(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const openPay = (row: any) => {
    const remaining = Math.max(0, Number(row.total) - Number(row.paidAmount ?? 0));
    setPayForm({ amount: remaining, method: 'CASH', reference: '', notes: '', paymentDate: new Date().toISOString().slice(0, 10) });
    setPayFor(row);
  };

  const doPay = async () => {
    try {
      await api.post(`/purchase-orders/${payFor.id}/pay`, {
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined,
        notes: payForm.notes || undefined,
        paymentDate: payForm.paymentDate || undefined,
      });
      toast.success(t('common.saved'));
      setPayFor(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('orders.purchaseTitle')} subtitle={t('subtitles.purchaseOrders')} />
      <DataTable
        endpoint="/purchase-orders"
        refreshKey={refreshKey}
        extraParams={{ ...(statusFilter ? { status: statusFilter } : {}), ...(paymentStatusFilter ? { paymentStatus: paymentStatusFilter } : {}) }}
        onRowClick={(r) => router.push(`/purchase-orders/${r.id}/edit`)}
        filters={
          <>
            <Select className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>{t(`status.${s}`)}</option>
              ))}
            </Select>
            <Select className="w-36" value={paymentStatusFilter} onChange={(e) => setPaymentStatusFilter(e.target.value)}>
              <option value="">{t('orders.paymentStatus')}</option>
              <option value="UNPAID">{t('status.UNPAID')}</option>
            </Select>
          </>
        }
        toolbar={
          <Button onClick={() => router.push('/purchase-orders/new')}>
            <Plus /> {t('orders.newPurchaseOrder')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), className: 'w-28', render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: 'supplier', label: t('common.supplier'), render: (r) => r.supplier?.name },
          { key: 'createdAt', label: t('common.date'), className: 'w-24 whitespace-nowrap', render: (r) => fmtDate(r.createdAt) },
          { key: 'total', label: t('common.total'), className: 'w-28 text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.total, r.currency)}</span> },
          {
            key: 'remaining', label: t('orders.remaining'), className: 'w-28 text-end',
            render: (r) => {
              const remaining = Math.max(0, Number(r.total) - Number(r.paidAmount ?? 0));
              return (
                <span className={`tabular-nums ${remaining > 0 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                  {fmtMoney(remaining, r.currency)}
                </span>
              );
            },
          },
          { key: 'paymentStatus', label: t('orders.paymentStatus'), className: 'w-28', render: (r) => <StatusChip status={r.paymentStatus ?? 'UNPAID'} /> },
          { key: 'status', label: t('common.status'), className: 'w-32', render: (r) => <StatusChip status={r.status} /> },
          {
            key: 'actions', label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                {['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'].includes(r.status) && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 dark:text-green-400" title={t('orders.receive')} onClick={(e) => { e.stopPropagation(); openReceive(r); }}>
                    <PackageCheck />
                  </Button>
                )}
                {r.status !== 'CANCELLED' && r.paymentStatus !== 'PAID' && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" title={t('orders.pay')} onClick={(e) => { e.stopPropagation(); openPay(r); }}>
                    <Banknote />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Receive */}
      <Dialog open={!!receiveFor} onOpenChange={(v) => !v && setReceiveFor(null)}>
        <DialogContent wide>
          <DialogHeader><DialogTitle>{t('orders.receive')} — {receiveFor?.number}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {(receiveFor?.items ?? []).map((i: any) => (
              <div key={i.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{i.product?.name}</span>
                  <span className="text-muted-foreground">{t('orders.received')}: {i.receivedQty}/{i.quantity}</span>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <Input
                    type="number" min={0} placeholder={t('common.quantity')}
                    value={receiveLines[i.productId]?.qty ?? 0}
                    onChange={(e) => setReceiveLines({ ...receiveLines, [i.productId]: { ...receiveLines[i.productId], qty: Number(e.target.value) } })}
                  />
                  {i.product?.trackSerials && (
                    <Input
                      dir="ltr" className="md:col-span-2" placeholder={t('orders.serialsHint')}
                      value={receiveLines[i.productId]?.serials ?? ''}
                      onChange={(e) => setReceiveLines({ ...receiveLines, [i.productId]: { ...receiveLines[i.productId], serials: e.target.value } })}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={doReceive}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay */}
      <Dialog open={!!payFor} onOpenChange={(v) => !v && setPayFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('orders.pay')} — {payFor?.number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-between rounded-md bg-muted p-3 text-sm">
              <span>{t('common.total')}: <b className="tabular-nums">{fmtMoney(payFor?.total ?? 0, payFor?.currency)}</b></span>
              <span>{t('orders.paid')}: <b className="tabular-nums">{fmtMoney(payFor?.paidAmount ?? 0, payFor?.currency)}</b></span>
              <span>{t('orders.remaining')}: <b className="tabular-nums">{fmtMoney(Math.max(0, Number(payFor?.total ?? 0) - Number(payFor?.paidAmount ?? 0)), payFor?.currency)}</b></span>
            </div>
            <Field label={t('common.amount')}>
              <Input type="number" min={0.01} step="0.01" value={payForm.amount ?? ''} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            </Field>
            <Field label={t('common.method')}>
              <Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                {['CASH', 'WHISH', 'OMT'].map((m) => (
                  <option key={m} value={m}>{t(`payments.${m}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('payments.paymentDate')}>
              <Input type="date" value={payForm.paymentDate ?? ''} onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })} />
            </Field>
            <Field label={t('common.reference')}>
              <Input value={payForm.reference ?? ''} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
            </Field>
            <Field label={t('common.notes')}>
              <Input value={payForm.notes ?? ''} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={doPay} disabled={!Number(payForm.amount)}>{t('orders.pay')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
