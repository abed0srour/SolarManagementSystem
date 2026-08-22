'use client';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import AccountSettings from '../../../components/account-settings';

export default function SuperAdminAccountPage() {
  const t = useTranslations();
  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title={t('auth.profile')}
        subtitle={t('superadmin.accountSubtitle')}
      />
      <AccountSettings />
    </div>
  );
}
