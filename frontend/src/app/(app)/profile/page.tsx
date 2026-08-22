'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { User, Building2, Clock, ShieldCheck } from 'lucide-react';
import { api, errMsg, fmtDateTime } from '../../../lib/api';
import PageHeader from '../../../components/page-header';
import AccountSettings from '../../../components/account-settings';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';

interface Profile {
  id: string;
  email: string;
  name: string | null;
  role: string;
  profileRole: string;
  isActive: boolean;
  createdAt: string;
  tenant: { id: string; name: string; slug: string; status: string } | null;
  lastLogin: { createdAt: string; ip: string | null; userAgent: string | null } | null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-end text-sm font-medium">{value}</span>
    </div>
  );
}

export default function ProfilePage() {
  const t = useTranslations();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get('/auth/profile')
      .then((r) => setProfile(r.data))
      .catch((e) => setError(errMsg(e)));

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader icon={User} title={t('auth.profile')} subtitle={t('auth.profileSubtitle')} />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {t('auth.accountSummary')}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {!profile ? (
              <div className="space-y-2 py-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (
              <>
                <Row label={t('auth.email')} value={<span dir="ltr">{profile.email}</span>} />
                <Row label={t('users.role')} value={<Badge variant="info">{profile.role}</Badge>} />
                <Row
                  label={t('common.status')}
                  value={
                    <Badge variant={profile.isActive ? 'success' : 'destructive'}>
                      {profile.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                  }
                />
                <Row label={t('auth.memberSince')} value={fmtDateTime(profile.createdAt)} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              {t('auth.yourStore')}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {!profile ? (
              <Skeleton className="h-6 w-full" />
            ) : profile.tenant ? (
              <>
                <Row label={t('superadmin.storeName')} value={profile.tenant.name} />
                <Row label={t('superadmin.statusLabel')} value={t(`superadmin.status.${profile.tenant.status}`)} />
                <Row
                  label={t('auth.lastSignIn')}
                  value={
                    profile.lastLogin ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        {fmtDateTime(profile.lastLogin.createdAt)}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
              </>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">{t('auth.noStore')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <AccountSettings onProfileSaved={load} />
    </div>
  );
}
