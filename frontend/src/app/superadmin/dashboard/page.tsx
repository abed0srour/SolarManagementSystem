'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Building2, CheckCircle2, PauseCircle, Archive, Users, ArrowRight } from 'lucide-react';
import { api, errMsg, fmtDate } from '../../../lib/api';
import PageHeader from '../../../components/page-header';
import { buttonVariants } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import { STATUS_VARIANT } from '../tenant-status';

interface Overview {
  tenants: { total: number; active: number; suspended: number; archived: number };
  users: number;
  recent: { id: string; name: string; slug: string; status: string; createdAt: string }[];
}

export default function SuperAdminDashboard() {
  const t = useTranslations();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/superadmin/overview')
      .then((r) => setData(r.data))
      .catch((e) => setError(errMsg(e)));
  }, []);

  const tiles = [
    { key: 'totalStores', value: data?.tenants.total, icon: Building2, tone: 'text-primary bg-primary/10' },
    { key: 'activeStores', value: data?.tenants.active, icon: CheckCircle2, tone: 'text-green-700 dark:text-green-400 bg-green-600/10' },
    { key: 'suspendedStores', value: data?.tenants.suspended, icon: PauseCircle, tone: 'text-amber-700 dark:text-amber-400 bg-amber-500/10' },
    { key: 'archivedStores', value: data?.tenants.archived, icon: Archive, tone: 'text-muted-foreground bg-muted' },
    { key: 'totalUsers', value: data?.users, icon: Users, tone: 'text-sky-700 dark:text-sky-400 bg-sky-500/10' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title={t('superadmin.dashboardTitle')}
        subtitle={t('superadmin.dashboardSubtitle')}
        actions={
          <Link href="/superadmin/tenants" className={buttonVariants()}>
            {t('superadmin.manageStores')}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.key}>
              <CardContent className="flex items-center gap-3 pt-6">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tile.tone}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-2xl font-bold leading-none">
                    {data ? (tile.value ?? 0) : <Skeleton className="h-7 w-10" />}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{t(`superadmin.${tile.key}`)}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('superadmin.recentStores')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!data ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : data.recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('superadmin.noStoresYet')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.recent.map((tenant) => (
                <li key={tenant.id}>
                  <Link
                    href={`/superadmin/tenants/${tenant.id}`}
                    className="flex items-center gap-3 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{tenant.name}</div>
                      <div className="truncate text-xs text-muted-foreground" dir="ltr">
                        /{tenant.slug} · {fmtDate(tenant.createdAt)}
                      </div>
                    </div>
                    <Badge variant={STATUS_VARIANT[tenant.status] ?? 'muted'}>
                      {t(`superadmin.status.${tenant.status}`)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
