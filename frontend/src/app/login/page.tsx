'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SunMedium, Languages, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '../../lib/api';
import { getRememberedEmail, purgeLegacyCredentials, setRememberedEmail, setSession } from '../../lib/auth';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';

function switchLocale() {
  const current = document.cookie.includes('locale=ar') ? 'ar' : 'en';
  document.cookie = `locale=${current === 'ar' ? 'en' : 'ar'};path=/;max-age=31536000`;
  window.location.reload();
}

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Prefill the email when "Remember me" was used before. The password is
  // never persisted — purgeLegacyCredentials() also deletes the old cleartext
  // `rememberedLogin` blob left behind by previous versions.
  useEffect(() => {
    const migrated = purgeLegacyCredentials();
    const saved = getRememberedEmail() ?? migrated;
    if (saved) {
      setEmail(saved);
      setRemember(true);
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') {
        const { data } = await api.post('/auth/login', { email, password });
        setRememberedEmail(remember ? email : null);
        setSession(
          { accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user },
          remember,
        );
        // Honour ?next= so middleware can bounce the admin back where they were.
        const next = new URLSearchParams(window.location.search).get('next');
        router.replace(next && next.startsWith('/') ? next : '/dashboard');
      } else if (mode === 'forgot') {
        const { data } = await api.post('/auth/forgot-password', { email });
        if (data.resetToken) {
          setResetToken(data.resetToken);
          setMode('reset');
          toast.info(t('auth.resetToken') + ': ' + data.resetToken.slice(0, 12) + '…');
        }
      } else {
        await api.post('/auth/reset-password', { token: resetToken, newPassword });
        toast.success(t('common.saved'));
        setMode('login');
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute end-4 top-4">
        <Button variant="ghost" size="icon" onClick={switchLocale} title={t('common.language')}>
          <Languages />
        </Button>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            <SunMedium className="h-7 w-7 text-amber-500" />
            <CardTitle className="text-xl">{t('app.title')}</CardTitle>
          </div>
          <CardDescription>{t('auth.welcome')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {mode === 'login' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="password">{t('auth.password')}</Label>
                  <div className="relative">
                    <Input id="password" type={showPassword ? 'text' : 'password'} className="pe-10" value={password} onChange={(e) => setPassword(e.target.value)} required />
                    <button
                      type="button"
                      tabIndex={-1}
                      className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  {t('auth.rememberMe')}
                </label>
              </>
            )}
            {mode === 'reset' && (
              <>
                <div className="space-y-1.5">
                  <Label>{t('auth.resetToken')}</Label>
                  <Input value={resetToken} onChange={(e) => setResetToken(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('auth.newPassword')}</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
                </div>
              </>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.signingIn') : mode === 'login' ? t('auth.signIn') : mode === 'forgot' ? t('auth.sendResetLink') : t('auth.resetPassword')}
            </Button>
            <div className="text-center">
              {mode === 'login' ? (
                <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode('forgot')}>
                  {t('auth.forgotPassword')}
                </button>
              ) : (
                <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode('login')}>
                  {t('auth.backToLogin')}
                </button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
