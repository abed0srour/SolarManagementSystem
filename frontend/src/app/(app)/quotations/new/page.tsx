'use client';

import { FileText as PageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../components/page-header';
import QuotationForm from '../../../../components/quotation-form';

export default function NewQuotationPage() {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('quotations.newQuotation')} subtitle={t('subtitles.quotations')} />
      <QuotationForm />
    </div>
  );
}
