'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SunMedium, Languages, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { supabaseBrowser } from '../../lib/supabase/client';
import { claimsFromToken, homeRouteFor, isSuperAdmin } from '../../lib/claims';
import { getRememberedEmail, purgeLegacySession, setRememberedEmail } from '../../lib/auth';
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
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Clears anything the pre-Supabase session left in Web Storage, and
    // recovers the email from the old remembered-login blob on the way past.
    const migrated = purgeLegacySession();
    const saved = getRememberedEmail() ?? migrated;
    if (saved) {
      setEmail(saved);
      setRemember(true);
    }

    // The middleware sends a suspended store here with a reason attached.
    const reason = new URLSearchParams(window.location.search).get('reason');
    if (reason === 'suspended') setNotice(t('auth.storeSuspended'));
    else if (reason === 'inactive') setNotice(t('auth.storeInactive'));
  }, [t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setNotice(null);
    try {
      const { data, error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
      if (error) throw error;

      const claims = claimsFromToken(data.session?.access_token);
      if (!claims) throw new Error(t('auth.sessionFailed'));

      if (!claims.isActive) {
        await supabaseBrowser().auth.signOut();
        throw new Error(t('auth.accountDeactivated'));
      }
      if (!isSuperAdmin(claims) && !['ACTIVE', 'UNKNOWN'].includes(claims.tenantStatus)) {
        await supabaseBrowser().auth.signOut();
        throw new Error(claims.tenantStatus === 'SUSPENDED' ? t('auth.storeSuspended') : t('auth.storeInactive'));
      }

      setRememberedEmail(remember ? email : null);
      // Supabase has no notion of this app's own sign-in log, so it is recorded
      // here. Failure is not worth blocking the login over.
      api.post('/auth/session').catch(() => {});

      /*
       * Role decides the destination. The claim was signed by the token hook,
       * so this needs no lookup — and `?next=` is honoured only for tenant
       * users, since a deep link into a store page means nothing to the
       * platform owner.
       */
      const home = homeRouteFor(claims);
      const next = new URLSearchParams(window.location.search).get('next');
      const target = !isSuperAdmin(claims) && next?.startsWith('/') && !next.startsWith('/superadmin') ? next : home;
      router.replace(target);
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? t('auth.invalidCredentials'));
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
          {notice && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                placeholder="e.g. user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="pe-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
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
            <div className="flex items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                {t('auth.rememberMe')}
              </label>
              <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                {t('auth.forgotPassword')}
              </Link>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('common.loading') : t('auth.signIn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
