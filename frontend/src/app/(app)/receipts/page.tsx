'use client';
import { Receipt as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileDown, MessageCircle } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, downloadFile } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import ClientInfoDialog from '../../../components/client-info-dialog';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';

export default function ReceiptsPage() {
  const t = useTranslations();
  const [clientInfo, setClientInfo] = useState<string | null>(null);

  const download = async (r: any) => {
    try {
      await downloadFile(`/payments/${r.id}/receipt-pdf`, `receipt-${r.number}.pdf`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const shareWhatsApp = (r: any) => {
    const phone = (r.client?.phone ?? '').replace(/[^\d]/g, '');
    const orderRef = r.invoice?.salesOrder?.number ? ` (${r.invoice.salesOrder.number})` : '';
    const text = t('receipts.waMessage', {
      number: r.number,
      amount: fmtMoney(r.amount, r.currency),
      date: fmtDate(r.paymentDate),
    }) + orderRef;
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
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
            render: (r) => r.client?.name && r.clientId ? (
              <button className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setClientInfo(r.clientId); }}>{r.client.name}</button>
            ) : '—',
          },
          {
            key: 'order', label: t('nav.salesOrders'), className: 'w-28',
            render: (r) => <span className="font-mono text-xs">{r.invoice?.salesOrder?.number ?? '—'}</span>,
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
      <ClientInfoDialog clientId={clientInfo} onOpenChange={(v) => !v && setClientInfo(null)} />
    </div>
  );
}
