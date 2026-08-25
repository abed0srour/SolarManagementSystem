'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Mail, MailCheck, Save, User } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { supabaseBrowser } from '../lib/supabase/client';
import { signOut } from '../lib/auth';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

type Notice = { tone: 'ok' | 'info' | 'error'; text: string } | null;

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const tone =
    notice.tone === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : notice.tone === 'info'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400'
        : 'border-destructive/30 bg-destructive/10 text-destructive';
  const Icon = notice.tone === 'ok' ? CheckCircle2 : notice.tone === 'info' ? MailCheck : AlertCircle;
  return (
    <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${tone}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{notice.text}</span>
    </div>
  );
}

/**
 * Self-service account management, shared by the store profile page and the
 * platform owner's account page.
 *
 * All three forms talk to Supabase directly rather than through this app's API.
 * Password and email changes are Supabase's to make — it owns the credential
 * and the confirmation emails — and proxying them would only add a hop that can
 * return a staler answer. Profile details are the exception: they are written
 * to Supabase user_metadata *and* to the `profiles` table, because the first is
 * what lands in the next access token and the second is what the rest of the
 * application joins against.
 */
export default function AccountSettings({ onProfileSaved }: { onProfileSaved?: () => void }) {
  const t = useTranslations();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loaded, setLoaded] = useState(false);

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<Notice>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);

  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState<Notice>(null);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const user = data.user;
        if (!user) return;
        setEmail(user.email ?? '');
        setFullName((user.user_metadata?.full_name as string) ?? '');
        setPhone((user.user_metadata?.phone as string) ?? '');
        setLoaded(true);
      });
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return toast.error(t('auth.nameRequired'));
    setSavingProfile(true);
    setProfileNotice(null);
    try {
      const { error } = await supabaseBrowser().auth.updateUser({
        data: { full_name: fullName.trim(), phone: phone.trim() },
      });
      if (error) throw error;
      // Keep the projection the app actually joins against in step.
      await api.patch('/auth/profile', { name: fullName.trim(), phone: phone.trim() });
      setProfileNotice({ tone: 'ok', text: t('auth.profileSaved') });
      onProfileSaved?.();
      router.refresh();
    } catch (err) {
      setProfileNotice({ tone: 'error', text: errMsg(err) });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) return setPasswordNotice({ tone: 'error', text: t('auth.passwordTooShort') });
    if (newPassword !== confirmPassword) return setPasswordNotice({ tone: 'error', text: t('auth.passwordsDoNotMatch') });

    setSavingPassword(true);
    setPasswordNotice(null);
    try {
      /*
       * Verify the current password by signing in with it first.
       *
       * `updateUser({ password })` on its own does not ask for the old one, so
       * anyone who walked up to an unlocked screen could take the account over.
       * Re-authenticating costs one request and closes that. (Supabase can also
       * enforce this server-side via `secure_password_change`, which
       * config.toml enables — this makes the requirement visible in the UI
       * rather than surfacing as an opaque error.)
       */
      const { error: reauthError } = await supabaseBrowser().auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (reauthError) throw new Error(t('auth.currentPasswordIncorrect'));

      const { error } = await supabaseBrowser().auth.updateUser({ password: newPassword });
      if (error) throw error;

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordNotice({ tone: 'ok', text: t('auth.passwordChangedSignOut') });
      toast.success(t('auth.passwordUpdated'));

      // Other devices keep working on their old tokens otherwise, which is not
      // what someone changing a password expects.
      setTimeout(async () => {
        await signOut();
        router.replace('/login');
      }, 2000);
    } catch (err: any) {
      setPasswordNotice({ tone: 'error', text: err?.message ?? errMsg(err) });
    } finally {
      setSavingPassword(false);
    }
  };

  const changeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = newEmail.trim().toLowerCase();
    if (!target) return;
    if (target === email.toLowerCase()) {
      return setEmailNotice({ tone: 'error', text: t('auth.emailSameAsCurrent') });
    }
    setSavingEmail(true);
    setEmailNotice(null);
    try {
      const { error } = await supabaseBrowser().auth.updateUser(
        { email: target },
        // Without this, Supabase falls back to the project's Site URL, which is
        // the local dev origin -- so the confirmation link in a real customer's
        // inbox points at their own machine and cannot work. Taking the origin
        // from the browser keeps every deployment self-consistent: production,
        // staging preview and localhost each send links back to themselves.
        { emailRedirectTo: `${window.location.origin}/login` },
      );
      if (error) throw error;
      /*
       * `double_confirm_changes` is on, so Supabase emails BOTH addresses and
       * the change only lands once each is confirmed. Saying so explicitly
       * matters: without it the address appears unchanged and the natural
       * conclusion is that the save failed.
       */
      setEmailNotice({ tone: 'info', text: t('auth.emailChangeConfirmSent', { current: email, next: target }) });
      setNewEmail('');
    } catch (err) {
      setEmailNotice({ tone: 'error', text: errMsg(err) });
    } finally {
      setSavingEmail(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-primary" />
            {t('auth.profileDetails')}
          </CardTitle>
          <CardDescription>{t('auth.profileDetailsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <NoticeBanner notice={profileNotice} />
            <div className="space-y-1.5">
              <Label htmlFor="account-email">{t('auth.email')}</Label>
              <Input id="account-email" dir="ltr" value={email} disabled readOnly />
              <p className="text-xs text-muted-foreground">{t('auth.emailChangedBelow')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-name">{t('auth.fullName')}</Label>
              <Input
                id="account-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={!loaded}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-phone">{t('auth.phone')}</Label>
              <Input id="account-phone" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!loaded} />
            </div>
            <Button type="submit" disabled={savingProfile || !loaded}>
              <Save className="h-4 w-4" />
              {savingProfile ? t('common.saving') : t('common.save')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" />
            {t('auth.changePassword')}
          </CardTitle>
          <CardDescription>{t('auth.changePasswordDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <NoticeBanner notice={passwordNotice} />
            <div className="space-y-1.5">
              <Label htmlFor="current-password">{t('auth.currentPassword')}</Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showPasswords ? 'text' : 'password'}
                  className="pe-10"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPasswords((v) => !v)}
                >
                  {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">{t('auth.newPassword')}</Label>
              <Input
                id="new-password"
                type={showPasswords ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">{t('auth.passwordRule')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-new-password">{t('auth.confirmPassword')}</Label>
              <Input
                id="confirm-new-password"
                type={showPasswords ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={savingPassword}>
              {savingPassword ? t('common.saving') : t('auth.updatePassword')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary" />
            {t('auth.changeEmail')}
          </CardTitle>
          <CardDescription>{t('auth.changeEmailDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changeEmail} className="space-y-4">
            <NoticeBanner notice={emailNotice} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('auth.currentEmail')}</Label>
                <Input dir="ltr" value={email} disabled readOnly />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-email">{t('auth.newEmail')}</Label>
                <Input
                  id="new-email"
                  type="email"
                  dir="ltr"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <Button type="submit" disabled={savingEmail}>
              {savingEmail ? t('common.saving') : t('auth.sendConfirmation')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
