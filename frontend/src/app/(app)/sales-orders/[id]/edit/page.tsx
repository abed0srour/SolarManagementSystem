'use client';
import { use } from 'react';
import { ShoppingCart as PageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../../components/page-header';
import SalesOrderForm from '../../../../../components/sales-order-form';

export default function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations();
  const { id } = use(params);
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('orders.salesOrders')} subtitle={t('subtitles.salesOrders')} />
      <SalesOrderForm orderId={id} />
    </div>
  );
}
