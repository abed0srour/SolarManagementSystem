'use client';
import { use } from 'react';
import { HardHat as PageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../../components/page-header';
import WorkerForm from '../../../../../components/worker-form';

export default function EditWorkerPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations();
  const { id } = use(params);
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('workers.editWorker')} subtitle={t('workers.subtitle')} />
      <WorkerForm workerId={id} />
    </div>
  );
}
