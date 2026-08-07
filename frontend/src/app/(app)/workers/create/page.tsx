'use client';
import { HardHat as PageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../components/page-header';
import WorkerForm from '../../../../components/worker-form';

export default function CreateWorkerPage() {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('workers.newWorker')} subtitle={t('workers.subtitle')} />
      <WorkerForm />
    </div>
  );
}
