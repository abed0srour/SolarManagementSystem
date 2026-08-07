'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Banknote, Eye, ShoppingCart } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate } from '../../../../../lib/api';
import StatusChip from '../../../../../components/status-chip';
import Field from '../../../../../components/form-field';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Select } from '../../../../../components/ui/select';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../../components/ui/table';

export default function ClientOrdersPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [client, setClient] = useState<any>(null);
  const [orders, setOrders] = useState<any[] | null>(null);
  const [payFor, setPayFor] = useState<any>(null);
  const [payForm, setPayForm] = useState<any>({});

  const load = useCallback(() => {
    api.get(`/clients/${params.id}/brief`).then((r) => setClient(r.data)).catch((e) => toast.error(errMsg(e)));
    api.get('/sales-orders', { params: { clientId: params.id, pageSize: 200 } })
      .then((r) => setOrders(r.data.items))
      .catch((e) => { toast.error(errMsg(e)); setOrders([]); });
  }, [params.id]);
  useEffect(load, [load]);

  const openPay = (order: any) => {
    setPayForm({ amount: order.outstanding, method: 'CASH', reference: '', paymentDate: new Date().toISOString().slice(0, 10) });
    setPayFor(order);
  };

  const doPay = async () => {
    try {
      await api.post(`/sales-orders/${payFor.id}/pay`, {
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined,
        paymentDate: payForm.paymentDate || undefined,
      });
      toast.success(t('common.saved'));
      setPayFor(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!client || orders === null)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );

  const active = orders.filter((o) => o.status !== 'CANCELLED');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{t('clients.ordersOf', { name: client.name })}</h1>
        <div className="ms-auto">
          <Button onClick={() => router.push(`/clients/${client.id}/new-order`)}>
            <ShoppingCart /> {t('clients.createOrder')}
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md border bg-card p-3 text-sm">
          <div className="text-muted-foreground">{t('nav.salesOrders')}</div>
          <div className="text-lg font-bold tabular-nums">{orders.length}</div>
        </div>
        <div className="rounded-md border bg-card p-3 text-sm">
          <div className="text-muted-foreground">{t('common.total')}</div>
          <div className="text-lg font-bold tabular-nums">{fmtMoney(active.reduce((s, o) => s + Number(o.total), 0))}</div>
        </div>
        <div className="rounded-md border bg-card p-3 text-sm">
          <div className="text-muted-foreground">{t('orders.paid')}</div>
          <div className="text-lg font-bold tabular-nums text-green-600 dark:text-green-400">{fmtMoney(active.reduce((s, o) => s + Number(o.paidAmount ?? 0), 0))}</div>
        </div>
        <div className="rounded-md border bg-card p-3 text-sm">
          <div className="text-muted-foreground">{t('orders.remaining')}</div>
          <div className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmtMoney(active.reduce((s, o) => s + Number(o.outstanding ?? 0), 0))}</div>
        </div>
      </div>

      {/* Orders */}
      <div className="rounded-lg border bg-card">
        {orders.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t('common.noRecords')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t('quotations.number')}</TableHead>
                <TableHead className="w-28">{t('common.date')}</TableHead>
                <TableHead className="w-36">{t('common.status')}</TableHead>
                <TableHead className="w-32 text-end">{t('common.total')}</TableHead>
                <TableHead className="w-32 text-end">{t('orders.paid')}</TableHead>
                <TableHead className="w-32 text-end">{t('orders.remaining')}</TableHead>
                <TableHead className="w-32">{t('orders.paymentStatus')}</TableHead>
                <TableHead className="w-24 text-end" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => router.push(`/sales-orders/${o.id}`)}>
                  <TableCell><span className="font-mono text-xs">{o.number}</span></TableCell>
                  <TableCell>{fmtDate(o.orderDate)}</TableCell>
                  <TableCell><StatusChip status={o.status} /></TableCell>
                  <TableCell className="text-end tabular-nums font-medium">{fmtMoney(o.total)}</TableCell>
                  <TableCell className="text-end tabular-nums text-green-600 dark:text-green-400">{fmtMoney(o.paidAmount ?? 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    <span className={Number(o.outstanding) > 0 && o.status !== 'CANCELLED' ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
                      {fmtMoney(o.outstanding ?? 0)}
                    </span>
                  </TableCell>
                  <TableCell>{o.status !== 'CANCELLED' && <StatusChip status={o.paymentStatus ?? 'UNPAID'} />}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {o.status !== 'CANCELLED' && Number(o.outstanding) > 0 && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 dark:text-green-400" title={t('orders.pay')} onClick={(e) => { e.stopPropagation(); openPay(o); }}>
                          <Banknote />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 dark:text-blue-400" title={t('orders.viewOrder')} onClick={(e) => { e.stopPropagation(); router.push(`/sales-orders/${o.id}`); }}>
                        <Eye />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pay an order */}
      <Dialog open={!!payFor} onOpenChange={(v) => !v && setPayFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('orders.pay')} — {payFor?.number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-between rounded-md bg-muted p-3 text-sm">
              <span>{t('common.total')}: <b className="tabular-nums">{fmtMoney(payFor?.total ?? 0)}</b></span>
              <span>{t('orders.paid')}: <b className="tabular-nums">{fmtMoney(payFor?.paidAmount ?? 0)}</b></span>
              <span>{t('orders.remaining')}: <b className="tabular-nums">{fmtMoney(payFor?.outstanding ?? 0)}</b></span>
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
