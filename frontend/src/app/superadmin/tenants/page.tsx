'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Building2, Plus, Search, Users, Package, Receipt, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg, fmtDate } from '../../../lib/api';
import PageHeader from '../../../components/page-header';
import { Button, buttonVariants } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { STATUS_VARIANT, TENANT_STATUSES } from '../tenant-status';
import CreateTenantDialog from './create-tenant-dialog';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  contactEmail: string | null;
  createdAt: string;
  expiresAt: string | null;
  maxUsers: number | null;
  counts: { users: number; clients: number; products: number; invoices: number };
}

export default function TenantsPage() {
  const t = useTranslations();
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    api
      .get('/superadmin/tenants', {
        params: {
          search: search || undefined,
          status: status || undefined,
          includeArchived: includeArchived ? 'true' : undefined,
        },
      })
      .then((r) => setRows(r.data))
      .catch((e) => {
        setRows([]);
        toast.error(errMsg(e));
      });
  }, [search, status, includeArchived]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title={t('superadmin.storesTitle')}
        subtitle={t('superadmin.storesSubtitle')}
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} title={t('common.syncNow')}>
              <RefreshCw />
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('superadmin.newStore')}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-8"
              placeholder={t('superadmin.searchStores')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select className="w-auto min-w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('superadmin.allStatuses')}</option>
            {TENANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`superadmin.status.${s}`)}
              </option>
            ))}
          </Select>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            {t('superadmin.showArchived')}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {!rows ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t('superadmin.noStoresMatch')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('superadmin.store')}</TableHead>
                  <TableHead>{t('superadmin.statusLabel')}</TableHead>
                  <TableHead>{t('superadmin.usage')}</TableHead>
                  <TableHead>{t('superadmin.created')}</TableHead>
                  <TableHead className="text-end">{t('common.details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <div className="font-medium">{tenant.name}</div>
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        /{tenant.slug}
                        {tenant.contactEmail ? ` · ${tenant.contactEmail}` : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[tenant.status] ?? 'muted'}>
                        {t(`superadmin.status.${tenant.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1" title={t('superadmin.usersCount')}>
                          <Users className="h-3.5 w-3.5" />
                          {tenant.counts.users}
                          {tenant.maxUsers ? `/${tenant.maxUsers}` : ''}
                        </span>
                        <span className="flex items-center gap-1" title={t('superadmin.productsCount')}>
                          <Package className="h-3.5 w-3.5" />
                          {tenant.counts.products}
                        </span>
                        <span className="flex items-center gap-1" title={t('superadmin.invoicesCount')}>
                          <Receipt className="h-3.5 w-3.5" />
                          {tenant.counts.invoices}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {fmtDate(tenant.createdAt)}
                    </TableCell>
                    <TableCell className="text-end">
                      <Link
                        href={`/superadmin/tenants/${tenant.id}`}
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        {t('superadmin.manage')}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
    </div>
  );
}
