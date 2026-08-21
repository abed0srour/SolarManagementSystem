'use client';

import { use } from 'react';
import { FileText as PageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../../components/page-header';
import QuotationForm from '../../../../../components/quotation-form';

export default function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations();
  const { id } = use(params);
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('quotations.title')} subtitle={t('subtitles.quotations')} />
      <QuotationForm quotationId={id} />
    </div>
  );
}
