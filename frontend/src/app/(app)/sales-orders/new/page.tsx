'use client';
import { ShoppingCart as PageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../components/page-header';
import SalesOrderForm from '../../../../components/sales-order-form';

export default function NewSalesOrderPage() {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('orders.newSalesOrder')} subtitle={t('subtitles.salesOrders')} />
      <SalesOrderForm />
    </div>
  );
}
