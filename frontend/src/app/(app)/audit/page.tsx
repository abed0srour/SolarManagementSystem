'use client';
import { ScrollText as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useTranslations } from 'next-intl';
import { fmtDateTime } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import { Badge } from '../../../components/ui/badge';

export default function AuditPage() {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('audit.title')} subtitle={t('subtitles.audit')} />
      <DataTable
        endpoint="/audit"
        searchable={false}
        columns={[
          { key: 'createdAt', label: t('audit.when'), render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</span> },
          { key: 'user', label: t('audit.user'), render: (r) => r.user?.name ?? '—' },
          { key: 'action', label: t('audit.action'), render: (r) => <Badge variant="outline">{r.action}</Badge> },
          { key: 'entity', label: t('audit.entity') },
          { key: 'entityId', label: t('audit.entityId'), render: (r) => <span className="font-mono text-xs">{r.entityId ?? '—'}</span> },
          {
            key: 'details', label: t('audit.details'),
            render: (r) => (r.details ? <span className="line-clamp-1 max-w-72 font-mono text-xs text-muted-foreground">{JSON.stringify(r.details)}</span> : '—'),
          },
        ]}
      />
    </div>
  );
}
