'use client';
import { use } from 'react';
import { ShoppingCart as PageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../../components/page-header';
import SalesOrderForm from '../../../../../components/sales-order-form';

/** New sales order for a specific client — the client is fixed by the URL. */
export default function ClientNewOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations();
  const { id } = use(params);
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('orders.newSalesOrder')} subtitle={t('subtitles.salesOrders')} />
      <SalesOrderForm lockedClientId={id} returnTo={`/clients/${id}/orders`} />
    </div>
  );
}
