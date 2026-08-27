'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Building2, ArrowLeft, PauseCircle, PlayCircle, Archive, KeyRound, Send, UserX, UserCheck, Trash2, Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg, fmtDate, fmtMoney } from '../../../../lib/api';
import PageHeader from '../../../../components/page-header';
import ConfirmDialog from '../../../../components/confirm-dialog';
import { Button, buttonVariants } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Badge } from '../../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';
import { STATUS_VARIANT } from '../../tenant-status';

interface Member {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  appRole: string;
  isActive: boolean;
  createdAt: string;
}

interface Stats {
  tenant: {
    id: string; name: string; slug: string; status: string;
    contactEmail: string | null; contactPhone: string | null; notes: string | null;
    maxUsers: number | null; maxProducts: number | null; maxClients: number | null;
    expiresAt: string | null; suspendedReason: string | null; createdAt: string;
    profiles: Member[];
  };
  counts: {
    clients: number; products: number; invoices: number; salesOrders: number;
    billedTotal: number; paidTotal: number;
  };
}

export default function TenantDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Stats | null>(null);
  const [limits, setLimits] = useState({ maxUsers: '', maxProducts: '', maxClients: '' });
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<Member | null>(null);

  const load = useCallback(() => {
    api
      .get(`/superadmin/tenants/${id}/stats`)
      .then((r) => {
        setData(r.data);
        setLimits({
          maxUsers: r.data.tenant.maxUsers?.toString() ?? '',
          maxProducts: r.data.tenant.maxProducts?.toString() ?? '',
          maxClients: r.data.tenant.maxClients?.toString() ?? '',
        });
      })
      .catch((e) => toast.error(errMsg(e)));
  }, [id]);

  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { tenant, counts } = data;
  const suspended = tenant.status !== 'ACTIVE';

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title={tenant.name}
        subtitle={
          <span dir="ltr">
            /{tenant.slug} · {t('superadmin.created')} {fmtDate(tenant.createdAt)}
          </span>
        }
        actions={
          <>
            <Link href="/superadmin/tenants" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              {t('common.back')}
            </Link>
            <Badge variant={STATUS_VARIANT[tenant.status] ?? 'muted'}>{t(`superadmin.status.${tenant.status}`)}</Badge>
          </>
        }
      />

      {suspended && tenant.suspendedReason && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          {tenant.suspendedReason}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('superadmin.activity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span>{t('nav.clients')}</span><span className="font-medium">{counts.clients}</span></div>
            <div className="flex justify-between"><span>{t('nav.products')}</span><span className="font-medium">{counts.products}</span></div>
            <div className="flex justify-between"><span>{t('nav.invoices')}</span><span className="font-medium">{counts.invoices}</span></div>
            <div className="flex justify-between"><span>{t('nav.salesOrders')}</span><span className="font-medium">{counts.salesOrders}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('superadmin.revenue')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span>{t('superadmin.billed')}</span><span className="font-medium">{fmtMoney(counts.billedTotal)}</span></div>
            <div className="flex justify-between"><span>{t('superadmin.collected')}</span><span className="font-medium">{fmtMoney(counts.paidTotal)}</span></div>
            <div className="flex justify-between"><span>{t('superadmin.outstanding')}</span><span className="font-medium">{fmtMoney(counts.billedTotal - counts.paidTotal)}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('superadmin.accessControl')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {suspended ? (
              <Button
                className="w-full"
                disabled={busy}
                onClick={() =>
                  act(
                    () => api.patch(`/superadmin/tenants/${id}/status`, { status: 'ACTIVE' }),
                    t('superadmin.storeActivated'),
                  )
                }
              >
                <PlayCircle className="h-4 w-4" />
                {t('superadmin.activateStore')}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      api.patch(`/superadmin/tenants/${id}/status`, {
                        status: 'SUSPENDED',
                        reason: t('superadmin.suspendedByPlatform'),
                      }),
                    t('superadmin.storeSuspendedToast'),
                  )
                }
              >
                <PauseCircle className="h-4 w-4" />
                {t('superadmin.suspendStore')}
              </Button>
            )}
            <Button variant="outline" className="w-full text-destructive" disabled={busy} onClick={() => setArchiveOpen(true)}>
              <Archive className="h-4 w-4" />
              {t('superadmin.archiveStore')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('superadmin.suspendNote')}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('superadmin.limits')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            {(['maxUsers', 'maxProducts', 'maxClients'] as const).map((key) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={key}>{t(`superadmin.${key}`)}</Label>
                <Input
                  id={key}
                  type="number"
                  min={1}
                  value={limits[key]}
                  onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={t('superadmin.unlimited')}
                />
              </div>
            ))}
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      api.patch(`/superadmin/tenants/${id}`, {
                        maxUsers: limits.maxUsers ? Number(limits.maxUsers) : undefined,
                        maxProducts: limits.maxProducts ? Number(limits.maxProducts) : undefined,
                        maxClients: limits.maxClients ? Number(limits.maxClients) : undefined,
                      }),
                    t('common.saved'),
                  )
                }
              >
                <Save className="h-4 w-4" />
                {t('common.save')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('superadmin.members')} ({tenant.profiles.length}
            {tenant.maxUsers ? `/${tenant.maxUsers}` : ''})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('users.name')}</TableHead>
                <TableHead>{t('users.role')}</TableHead>
                <TableHead>{t('superadmin.statusLabel')}</TableHead>
                <TableHead className="text-end">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenant.profiles.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="font-medium">{member.fullName || member.email}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{member.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.role === 'tenant_admin' ? 'info' : 'muted'}>{member.appRole}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.isActive ? 'success' : 'destructive'}>
                      {member.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        title={t('superadmin.resetPassword')}
                        onClick={() => {
                          const password = window.prompt(t('superadmin.enterNewPassword'));
                          if (!password) return;
                          if (password.length < 8) return toast.error(t('auth.passwordTooShort'));
                          act(
                            () => api.post(`/superadmin/tenants/${id}/members/${member.id}/password`, { password }),
                            t('superadmin.passwordReset'),
                          );
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        title={t('superadmin.resendInvite')}
                        onClick={() =>
                          act(
                            () => api.post(`/superadmin/tenants/${id}/members/${member.id}/invite`),
                            t('superadmin.inviteResent'),
                          )
                        }
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        title={member.isActive ? t('superadmin.deactivate') : t('superadmin.activate')}
                        onClick={() =>
                          act(
                            () =>
                              api.patch(`/superadmin/tenants/${id}/members/${member.id}/active`, {
                                isActive: !member.isActive,
                              }),
                            t('common.saved'),
                          )
                        }
                      >
                        {member.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        disabled={busy}
                        title={t('common.delete')}
                        onClick={() => setRemoveMember(member)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {tenant.profiles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    {t('superadmin.noMembers')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t('superadmin.archiveStore')}
        description={t('superadmin.archiveStoreWarning', { name: tenant.name })}
        requireText={tenant.name}
        onConfirm={async () => {
          await api.delete(`/superadmin/tenants/${id}`);
          toast.success(t('superadmin.storeArchived'));
          router.push('/superadmin/tenants');
        }}
      />

      <ConfirmDialog
        open={!!removeMember}
        onOpenChange={(open) => !open && setRemoveMember(null)}
        title={t('superadmin.removeMember')}
        description={t('superadmin.removeMemberWarning', { email: removeMember?.email ?? '' })}
        onConfirm={async () => {
          await api.delete(`/superadmin/tenants/${id}/members/${removeMember!.id}`);
          toast.success(t('superadmin.memberRemoved'));
          setRemoveMember(null);
          load();
        }}
      />
    </div>
  );
}
