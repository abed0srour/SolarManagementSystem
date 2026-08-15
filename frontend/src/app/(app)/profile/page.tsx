'use client';
import { User as PageIcon, KeyRound, Mail, ShieldCheck, LogOut, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import PageHeader from '../../../components/page-header';
import DataTable from '../../../components/data-table';
import Field from '../../../components/form-field';
import ConfirmDialog from '../../../components/confirm-dialog';
import { api, errMsg, fmtDateTime } from '../../../lib/api';
import { setUser } from '../../../lib/auth';
import { useLocalFirstData } from '../../../lib/use-local-storage-cache';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { PasswordInput } from '../../../components/ui/password-input';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';

/** One label/value row in the identity card. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * The admin's own account: who they are, and every self-service action that
 * changes it. Changing the email still goes through an emailed verification
 * code; changing the password only requires the current one, so it works with
 * no SMTP configured.
 */
export default function ProfilePage() {
  const t = useTranslations();

  const { data: profile, refresh } = useLocalFirstData<any>('auth:profile', () =>
    api.get('/auth/profile').then((r) => r.data),
  );

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState<any>({ currentPassword: '', newPassword: '', confirmPassword: '', busy: false });
  const [em, setEm] = useState<any>({ currentPassword: '', newEmail: '', code: '', codeSent: false, busy: false });
  const [signOutAll, setSignOutAll] = useState(false);

  useEffect(() => {
    if (profile?.name) setName(profile.name);
  }, [profile?.name]);

  const saveName = async () => {
    setSavingName(true);
    try {
      const { data } = await api.patch('/auth/profile', { name: name.trim() });
      // Keep the header's greeting in step with the change.
      setUser(data);
      toast.success(t('common.saved'));
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingName(false);
    }
  };

  const mismatch = pw.confirmPassword.length > 0 && pw.newPassword !== pw.confirmPassword;
  const canChangePassword =
    !!pw.currentPassword && pw.newPassword.length >= 8 && pw.newPassword === pw.confirmPassword;

  /*
   * Changed directly, with no emailed code. The code flow exists for accounts
   * where a stolen session should not be enough to take the account over, but
   * it depends on SMTP being configured — and with none configured it made
   * changing a password impossible rather than merely less strict. The current
   * password is still required, which is the check that matters here.
   */
  const changePassword = async () => {
    setPw((p: any) => ({ ...p, busy: true }));
    try {
      await api.post('/auth/change-password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      toast.success(t('common.saved'));
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '', busy: false });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPw((p: any) => ({ ...p, busy: false }));
    }
  };

  const requestEmailCode = async () => {
    setEm((p: any) => ({ ...p, busy: true }));
    try {
      await api.post('/auth/request-email-change', { currentPassword: em.currentPassword, newEmail: em.newEmail });
      setEm((p: any) => ({ ...p, codeSent: true, busy: false }));
      toast.success(t('auth.codeSent'));
    } catch (e) {
      toast.error(errMsg(e));
      setEm((p: any) => ({ ...p, busy: false }));
    }
  };

  const confirmEmailChange = async () => {
    setEm((p: any) => ({ ...p, busy: true }));
    try {
      const { data } = await api.post('/auth/confirm-email-change', { code: em.code });
      if (data.user) setUser(data.user);
      toast.success(t('common.saved'));
      setEm({ currentPassword: '', newEmail: '', code: '', codeSent: false, busy: false });
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
      setEm((p: any) => ({ ...p, busy: false }));
    }
  };

  if (!profile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('auth.profile')} subtitle={t('subtitles.profile')} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {t('profile.account')}
            </CardTitle>
            <CardDescription>{t('profile.accountHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-2">
              <Field label={t('common.name')} className="flex-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Button onClick={saveName} disabled={savingName || !name.trim() || name.trim() === profile.name}>
                <Check /> {t('common.save')}
              </Button>
            </div>

            <div>
              <Row label={t('common.email')} value={profile.email} />
              <Row label={t('profile.role')} value={<Badge variant="outline">{profile.role}</Badge>} />
              <Row label={t('profile.memberSince')} value={fmtDateTime(profile.createdAt)} />
              <Row
                label={t('profile.lastLogin')}
                value={profile.lastLogin ? fmtDateTime(profile.lastLogin.createdAt) : '—'}
              />
              <Row label={t('profile.activeSessions')} value={profile.activeSessions} />
            </div>

            <Button variant="outline" className="w-full" onClick={() => setSignOutAll(true)}>
              <LogOut /> {t('profile.signOutOthers')}
            </Button>
          </CardContent>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              {t('auth.changePassword')}
            </CardTitle>
            <CardDescription>{t('auth.changePasswordHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label={t('auth.currentPassword')}>
              <PasswordInput
                autoComplete="current-password"
                value={pw.currentPassword}
                onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
              />
            </Field>
            <Field label={t('auth.newPassword')} hint={t('auth.passwordMinHint')}>
              <PasswordInput
                autoComplete="new-password"
                value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
              />
            </Field>
            <Field
              label={t('auth.confirmPassword')}
              hint={mismatch ? <span className="text-destructive">{t('auth.passwordsDoNotMatch')}</span> : undefined}
            >
              <PasswordInput
                autoComplete="new-password"
                className={mismatch ? 'border-destructive' : undefined}
                value={pw.confirmPassword}
                onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })}
              />
            </Field>
            <Button className="w-full" disabled={pw.busy || !canChangePassword} onClick={changePassword}>
              <KeyRound /> {t('auth.changePassword')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('auth.changePasswordSignsOut')}</p>
          </CardContent>
        </Card>

        {/* Email */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              {t('auth.changeEmail')}
            </CardTitle>
            <CardDescription>{t('auth.changeEmailHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label={t('auth.currentPassword')}>
              <Input type="password" value={em.currentPassword} onChange={(e) => setEm({ ...em, currentPassword: e.target.value })} />
            </Field>
            <Field label={t('auth.newEmail')}>
              <Input type="email" dir="ltr" value={em.newEmail} onChange={(e) => setEm({ ...em, newEmail: e.target.value })} />
            </Field>
            {em.codeSent ? (
              <>
                <Field label={t('auth.verificationCode')} hint={t('auth.codeHint')}>
                  <Input dir="ltr" inputMode="numeric" maxLength={6} className="font-mono tracking-widest" value={em.code} onChange={(e) => setEm({ ...em, code: e.target.value })} />
                </Field>
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={em.busy || em.code.length < 6} onClick={confirmEmailChange}>
                    {t('common.confirm')}
                  </Button>
                  <Button variant="outline" disabled={em.busy} onClick={requestEmailCode}>
                    {t('auth.resendCode')}
                  </Button>
                </div>
              </>
            ) : (
              <Button className="w-full" disabled={em.busy || !em.currentPassword || !em.newEmail} onClick={requestEmailCode}>
                <Mail /> {t('auth.sendCode')}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Sign-in history */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('profile.loginHistory')}</CardTitle>
            <CardDescription>{t('profile.loginHistoryHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              endpoint="/auth/login-history"
              searchable={false}
              columns={[
                { key: 'createdAt', label: t('common.date'), render: (r) => fmtDateTime(r.createdAt) },
                { key: 'email', label: t('common.email') },
                {
                  key: 'success',
                  label: t('common.status'),
                  render: (r) => (
                    <Badge variant={r.success ? 'success' : 'destructive'}>
                      {r.success ? t('profile.signInSuccess') : t('profile.signInFailed')}
                    </Badge>
                  ),
                },
                { key: 'ip', label: t('profile.ipAddress'), render: (r) => <span className="font-mono text-xs">{r.ip ?? '—'}</span> },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={signOutAll}
        onOpenChange={setSignOutAll}
        title={t('profile.signOutOthers')}
        description={t('profile.signOutOthersHint')}
        onConfirm={async () => {
          try {
            const { data } = await api.post('/auth/revoke-sessions');
            toast.success(t('profile.sessionsRevoked', { count: data.revoked }));
            refresh();
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
