'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Printer, FileDown, MessageCircle, CreditCard, CalendarClock, XCircle, Plus, Trash2 } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, downloadFile } from '../../../../lib/api';
import { openWhatsApp } from '../../../../lib/whatsapp';
import StatusChip from '../../../../components/status-chip';
import ConfirmDialog from '../../../../components/confirm-dialog';
import Field from '../../../../components/form-field';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';

export default function InvoiceDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<any>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState<any>({});
  const [schedOpen, setSchedOpen] = useState(false);
  const [installments, setInstallments] = useState<{ dueDate: string; amount: number }[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(() => {
    api.get(`/invoices/${params.id}`).then((r) => setInv(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [params.id]);
  useEffect(load, [load]);

  if (!inv)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );

  const balance = Number(inv.total) - Number(inv.paidAmount);
  // Whoever the invoice is addressed to — the client on a sale, the supplier on
  // a purchase. Both carry a phone, so both can be messaged.
  const party = inv.client ?? inv.supplier;

  const recordPayment = async () => {
    try {
      await api.post('/payments', {
        direction: inv.type === 'SALE' ? 'INCOMING' : 'OUTGOING',
        invoiceId: inv.id,
        method: payForm.method ?? 'CASH',
        amount: Number(payForm.amount),
        paymentDate: payForm.paymentDate || undefined,
        reference: payForm.reference || undefined,
      });
      toast.success(t('common.saved'));
      setPayOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveSchedule = async () => {
    try {
      await api.post(`/invoices/${inv.id}/schedule`, {
        installments: installments.map((i) => ({ dueDate: i.dueDate, amount: Number(i.amount) })),
      });
      toast.success(t('common.saved'));
      setSchedOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{inv.number}</h1>
        <StatusChip status={inv.status} />
        <div className="flex-1" />
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> {t('common.print')}
        </Button>
        <Button variant="outline" onClick={() => downloadFile(`/invoices/${inv.id}/pdf`, `invoice-${inv.number}.pdf`).catch((e) => toast.error(errMsg(e)))}>
          <FileDown /> {t('common.downloadPdf')}
        </Button>
        {party && (
          /*
           * Opens the party's own WhatsApp chat with the greeting already
           * typed, so the PDF downloaded next door is attached and sent in one
           * more click. wa.me carries text only — it cannot attach the file
           * itself, which is why this does not replace the download button.
           */
          <Button
            variant="outline"
            className="text-green-600 hover:text-green-600 dark:text-green-400"
            onClick={() => {
              const text = t('invoices.waMessage', {
                client: party.name ?? '',
                number: inv.number,
                total: fmtMoney(inv.total, inv.currency),
                balance: fmtMoney(balance, inv.currency),
              });
              if (!openWhatsApp(party.phone, text)) toast.warning(t('common.waNoNumber'));
            }}
          >
            <MessageCircle /> {t('invoices.shareWhatsApp')}
          </Button>
        )}
        {inv.status !== 'CANCELLED' && inv.status !== 'PAID' && (
          <>
            <Button onClick={() => { setPayForm({ method: 'CASH', amount: balance }); setPayOpen(true); }}>
              <CreditCard /> {t('invoices.recordPayment')}
            </Button>
            <Button variant="outline" onClick={() => {
              setInstallments(inv.schedules.length ? inv.schedules.map((s: any) => ({ dueDate: s.dueDate.slice(0, 10), amount: Number(s.amount) })) : [{ dueDate: '', amount: Number(inv.total) }]);
              setSchedOpen(true);
            }}>
              <CalendarClock /> {t('invoices.setSchedule')}
            </Button>
          </>
        )}
        {inv.status !== 'CANCELLED' && Number(inv.paidAmount) === 0 && (
          <Button variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}>
            <XCircle /> {t('invoices.cancelInvoice')}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="mb-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <div className="text-muted-foreground">{inv.type === 'SALE' ? t('common.client') : t('common.supplier')}</div>
              <div className="font-medium">{inv.client?.name ?? inv.supplier?.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t('invoices.issueDate')}</div>
              <div>{fmtDate(inv.issueDate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t('common.dueDate')}</div>
              <div>{fmtDate(inv.dueDate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t('common.currency')}</div>
              <div>{inv.currency}</div>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t('common.product')}</TableHead>
                <TableHead className="text-end">{t('common.quantity')}</TableHead>
                <TableHead className="text-end">{t('common.unitPrice')}</TableHead>
                <TableHead className="text-end">{t('common.discount')}</TableHead>
                <TableHead className="text-end">{t('common.lineTotal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inv.items.map((i: any, idx: number) => (
                <TableRow key={i.id}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell>
                    {i.product?.sku && <span className="me-1 font-mono text-xs text-muted-foreground">[{i.product.sku}]</span>}
                    {i.product?.name || i.description}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{i.quantity}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtMoney(i.unitPrice, inv.currency)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {i.discountType ? (i.discountType === 'PERCENT' ? `${Number(i.discountValue)}%` : fmtMoney(i.discountValue, inv.currency)) : '—'}
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums">{fmtMoney(i.lineTotal, inv.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('common.subtotal')}</span><span className="tabular-nums">{fmtMoney(inv.subtotal, inv.currency)}</span></div>
              {inv.discountType && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('common.discount')}</span>
                  <span className="tabular-nums">{inv.discountType === 'PERCENT' ? `${Number(inv.discountValue)}%` : fmtMoney(inv.discountValue, inv.currency)}</span>
                </div>
              )}
              {Number(inv.shippingFee) > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">{t('common.shipping')}</span><span className="tabular-nums">{fmtMoney(inv.shippingFee, inv.currency)}</span></div>
              )}
              <div className="flex justify-between border-t pt-1 text-base font-bold"><span>{t('common.total')}</span><span className="tabular-nums">{fmtMoney(inv.total, inv.currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('invoices.paid')}</span><span className="tabular-nums">{fmtMoney(inv.paidAmount, inv.currency)}</span></div>
              <div className="flex justify-between font-semibold"><span>{t('invoices.balance')}</span><span className="tabular-nums">{fmtMoney(balance, inv.currency)}</span></div>
            </div>
          </div>
          {inv.notes && <p className="mt-4 text-sm text-muted-foreground">{inv.notes}</p>}
        </CardContent>
      </Card>

      {inv.schedules.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('invoices.schedule')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>{t('common.dueDate')}</TableHead>
                  <TableHead className="text-end">{t('common.amount')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.schedules.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.installmentNo}</TableCell>
                    <TableCell>{fmtDate(s.dueDate)}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmtMoney(s.amount, inv.currency)}</TableCell>
                    <TableCell><StatusChip status={s.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {inv.payments.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('payments.title')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('quotations.number')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('common.method')}</TableHead>
                  <TableHead className="text-end">{t('common.amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.payments.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.number}</TableCell>
                    <TableCell>{fmtDate(p.paymentDate)}</TableCell>
                    <TableCell>{t(`payments.${p.method}`)}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmtMoney(p.amount, p.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Payment dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('invoices.recordPayment')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('common.amount')}>
              <Input type="number" min={0.01} step="0.01" value={payForm.amount ?? ''} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            </Field>
            <Field label={t('common.method')}>
              <Select value={payForm.method ?? 'CASH'} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                {['CASH', 'WHISH', 'OMT', 'STORE_CREDIT'].map((m) => (
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
            <Button variant="outline" onClick={() => setPayOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={recordPayment} disabled={!payForm.amount}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule dialog */}
      <Dialog open={schedOpen} onOpenChange={setSchedOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('invoices.setSchedule')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('invoices.installmentsMustSum')} ({fmtMoney(inv.total, inv.currency)})</p>
          <div className="space-y-2">
            {installments.map((ins, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 text-sm text-muted-foreground">{i + 1}.</span>
                <Input type="date" value={ins.dueDate} onChange={(e) => setInstallments(installments.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                <Input type="number" min={0.01} step="0.01" value={ins.amount} onChange={(e) => setInstallments(installments.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setInstallments(installments.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setInstallments([...installments, { dueDate: '', amount: 0 }])}>
              <Plus /> {t('common.addLine')}
            </Button>
            <span className="text-sm font-medium tabular-nums">
              {fmtMoney(installments.reduce((s, i) => s + Number(i.amount || 0), 0), inv.currency)} / {fmtMoney(inv.total, inv.currency)}
            </span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSchedOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveSchedule} disabled={installments.some((i) => !i.dueDate || !i.amount)}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        requireText={t('common.deleteWord')}
        onConfirm={async () => {
          try {
            await api.post(`/invoices/${inv.id}/cancel`);
            toast.success(t('common.saved'));
            load();
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
