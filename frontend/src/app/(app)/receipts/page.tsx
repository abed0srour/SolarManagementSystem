'use client';
import { Receipt as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileDown, MessageCircle } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, downloadFile } from '../../../lib/api';
import { openWhatsApp } from '../../../lib/whatsapp';
import DataTable from '../../../components/data-table';
import EntityLink, { linkTo } from '../../../components/entity-link';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';

export default function ReceiptsPage() {
  const t = useTranslations();

  const download = async (r: any) => {
    try {
      await downloadFile(`/payments/${r.id}/receipt-pdf`, `receipt-${r.number}.pdf`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const shareWhatsApp = (r: any) => {
    const orderRef = r.invoice?.salesOrder?.number ? ` (${r.invoice.salesOrder.number})` : '';
    const text = t('receipts.waMessage', {
      client: r.client?.name ?? '',
      number: r.number,
      amount: fmtMoney(r.amount, r.currency),
      date: fmtDate(r.paymentDate),
    }) + orderRef;
    if (!openWhatsApp(r.client?.phone, text)) toast.warning(t('common.waNoNumber'));
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('receipts.title')} subtitle={t('subtitles.receipts')} />
      <DataTable
        endpoint="/payments"
        extraParams={{ direction: 'INCOMING' }}
        columns={[
          { key: 'number', label: t('quotations.number'), className: 'w-28', render: (r) => <span className="font-mono text-xs">{r.number}</span> },
          {
            key: 'client', label: t('common.client'),
            render: (r) => <EntityLink href={linkTo.client(r.clientId)}>{r.client?.name}</EntityLink>,
          },
          {
            /*
             * What this money was for. A receipt settles an invoice, and the
             * invoice usually belongs to an order — so both are shown: the order
             * is what staff and customers refer to out loud, the invoice is the
             * document the payment is actually posted against. A payment taken
             * without an invoice (a bare deposit) has neither, and says so.
             */
            key: 'order', label: t('receipts.paidFor'), className: 'w-36',
            render: (r) =>
              r.invoice ? (
                <div className="leading-tight">
                  {r.invoice.salesOrder ? (
                    <EntityLink href={linkTo.salesOrder(r.invoice.salesOrder.id)} mono>{r.invoice.salesOrder.number}</EntityLink>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t('receipts.noOrder')}</span>
                  )}
                  <div className="font-mono text-[11px] text-muted-foreground">{r.invoice.number}</div>
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          { key: 'paymentDate', label: t('common.date'), className: 'w-24', render: (r) => fmtDate(r.paymentDate) },
          { key: 'method', label: t('common.method'), className: 'w-28', render: (r) => <Badge variant="outline">{t(`payments.${r.method}`)}</Badge> },
          { key: 'amount', label: t('common.amount'), className: 'w-32 text-end', render: (r) => <span className="tabular-nums font-medium text-green-600 dark:text-green-400">{fmtMoney(r.amount, r.currency)}</span> },
          { key: 'reference', label: t('common.reference'), render: (r) => r.reference ?? '—' },
          {
            key: 'actions', label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 dark:text-blue-400" title={t('common.downloadPdf')} onClick={(e) => { e.stopPropagation(); download(r); }}>
                  <FileDown />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 dark:text-green-400" title={t('receipts.share')} onClick={(e) => { e.stopPropagation(); shareWhatsApp(r); }}>
                  <MessageCircle />
                </Button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
