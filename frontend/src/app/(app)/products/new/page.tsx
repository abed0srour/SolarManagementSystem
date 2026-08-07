'use client';
import { Package as PageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../components/page-header';
import ProductForm from '../../../../components/product-form';

export default function NewProductPage() {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('products.newProduct')} subtitle={t('subtitles.products')} />
      <ProductForm />
    </div>
  );
}
