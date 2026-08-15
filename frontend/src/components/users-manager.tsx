'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react';
import { api, errMsg, fmtDate } from '../lib/api';
import Field from './form-field';
import ConfirmDialog from './confirm-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { PasswordInput } from './ui/password-input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

const ASSIGNABLE_ROLES = ['ADMIN', 'MANAGER', 'STAFF', 'VIEWER'];

/**
 * Accounts and what they can reach. Visible only to the super admin — the API
 * enforces that independently, so hiding the tab is presentation, not security.
 *
 * Permissions are shown as a module × read/write grid because that is how they
 * are actually granted; the role picker just pre-ticks a sensible set, which
 * the super admin can then adjust per account.
 */
export default function UsersManager() {
  const t = useTranslations();
  const [users, setUsers] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<{ permissions: string[]; rolePermissions: Record<string, string[]> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get('/users')
      .then((r) => setUsers(r.data.items ?? []))
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    api.get('/users/catalog').then((r) => setCatalog(r.data)).catch(() => setCatalog(null));
  }, [load]);

  const modules = catalog ? Array.from(new Set(catalog.permissions.map((p) => p.split('.')[0]))) : [];

  const openCreate = () => {
    setForm({ email: '', name: '', password: '', role: 'STAFF', permissions: catalog?.rolePermissions.STAFF ?? [], isNew: true });
    setEditing({ isNew: true });
  };

  const openEdit = (u: any) => {
    setForm({
      name: u.name,
      role: u.role,
      // Show what the account effectively has, so unticking starts from reality
      // rather than from an empty grid.
      permissions: u.effectivePermissions ?? [],
      isActive: u.isActive,
      password: '',
      isNew: false,
    });
    setEditing(u);
  };

  /** Switching role re-ticks that role's defaults — the usual starting point. */
  const pickRole = (role: string) =>
    setForm((f: any) => ({ ...f, role, permissions: catalog?.rolePermissions[role] ?? [] }));

  const toggle = (permission: string) =>
    setForm((f: any) => ({
      ...f,
      permissions: f.permissions.includes(permission)
        ? f.permissions.filter((p: string) => p !== permission)
        : [...f.permissions, permission],
    }));

  const save = async () => {
    setBusy(true);
    try {
      if (form.isNew) {
        await api.post('/users', {
          email: form.email.trim(),
          name: form.name.trim(),
          password: form.password,
          role: form.role,
          permissions: form.permissions,
        });
      } else {
        await api.patch(`/users/${editing.id}`, {
          name: form.name.trim(),
          role: form.role,
          permissions: form.permissions,
          isActive: form.isActive,
          ...(form.password ? { password: form.password } : {}),
        });
      }
      toast.success(t('common.saved'));
      setEditing(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/users/${deleteTarget.id}`);
      toast.success(t('common.deleted'));
      load();
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    }
  };

  const canSave = form.isNew
    ? form.email?.trim() && form.name?.trim() && form.password?.length >= 8
    : form.name?.trim() && (!form.password || form.password.length >= 8);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('users.hint')}</p>
        <Button onClick={openCreate}>
          <Plus /> {t('users.newUser')}
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common.name')}</TableHead>
              <TableHead>{t('common.email')}</TableHead>
              <TableHead className="w-32">{t('users.role')}</TableHead>
              <TableHead className="w-24">{t('common.status')}</TableHead>
              <TableHead className="w-28 whitespace-nowrap">{t('common.createdAt')}</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {t('common.loading')}
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const superAdmin = u.role === 'SUPER_ADMIN';
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {superAdmin && <ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                        {u.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={superAdmin ? 'default' : 'outline'}>{t(`users.roles.${u.role}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? 'success' : 'muted'}>
                        {u.isActive ? t('common.active') : t('common.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(u.createdAt)}</TableCell>
                    <TableCell>
                      {/* The super admin is edited from its own profile page, so
                          the owner cannot demote or delete themselves here. */}
                      {!superAdmin && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title={t('common.edit')} onClick={() => openEdit(u)}>
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            title={t('common.delete')}
                            onClick={() => setDeleteTarget(u)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{form.isNew ? t('users.newUser') : `${t('common.edit')} — ${editing?.email}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {form.isNew && (
                <Field label={t('common.email')}>
                  <Input type="email" dir="ltr" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
              )}
              <Field label={t('common.name')}>
                <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field
                label={form.isNew ? t('auth.newPassword') : t('users.resetPassword')}
                hint={form.isNew ? t('auth.passwordMinHint') : t('users.resetPasswordHint')}
              >
                <PasswordInput
                  autoComplete="new-password"
                  value={form.password ?? ''}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>
              <Field label={t('users.role')}>
                <Select value={form.role} onChange={(e) => pickRole(e.target.value)}>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`users.roles.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {!form.isNew && (
                <Field label={t('common.status')}>
                  <Select value={form.isActive ? '1' : '0'} onChange={(e) => setForm({ ...form, isActive: e.target.value === '1' })}>
                    <option value="1">{t('common.active')}</option>
                    <option value="0">{t('common.inactive')}</option>
                  </Select>
                </Field>
              )}
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">{t('users.permissions')}</div>
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('users.module')}</TableHead>
                      <TableHead className="w-24 text-center">{t('users.view')}</TableHead>
                      <TableHead className="w-24 text-center">{t('users.edit')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modules.map((m) => (
                      <TableRow key={m}>
                        <TableCell className="font-medium">{t(`users.modules.${m}`)}</TableCell>
                        {['read', 'write'].map((kind) => {
                          const key = `${m}.${kind}`;
                          return (
                            <TableCell key={kind} className="text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-primary"
                                checked={form.permissions?.includes(key) ?? false}
                                onChange={() => toggle(key)}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t('users.permissionsHint')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={save} disabled={busy || !canSave}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={t('users.deleteTitle')}
        description={t('users.deleteHint', { email: deleteTarget?.email ?? '' })}
        onConfirm={doDelete}
      />
    </div>
  );
}
