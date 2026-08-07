'use client';
import { use } from 'react';
import { Package as PageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../../components/page-header';
import ProductForm from '../../../../../components/product-form';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations();
  const { id } = use(params);
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('products.editProduct')} subtitle={t('subtitles.products')} />
      <ProductForm productId={id} />
    </div>
  );
}
