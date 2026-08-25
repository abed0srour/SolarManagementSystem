'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SunMedium, Languages, Eye, EyeOff, ShieldAlert, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { supabaseBrowser } from '../../lib/supabase/client';
import { claimsFromToken, homeRouteFor, isSuperAdmin } from '../../lib/claims';
import { getRememberedEmail, purgeLegacySession, setRememberedEmail } from '../../lib/auth';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

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

  const highlights = [
    t('auth.highlightInventory'),
    t('auth.highlightSales'),
    t('auth.highlightIsolation'),
  ];

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/*
        The brand panel is deliberately generic. This platform serves many
        separate businesses, so showing any one store's name or logo before
        sign-in would be both wrong and a small information leak about who the
        customers are. The store's own identity appears after authentication.

        Hidden below `lg` rather than stacked: on a phone it would push the
        form under the fold, and signing in is the only thing this page is for.
      */}
      <aside className="relative hidden overflow-hidden bg-slate-950 p-12 text-slate-100 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 start-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-amber-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -end-24 h-96 w-96 rounded-full bg-sky-500/10 blur-3xl"
        />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-inset ring-amber-400/30">
            <SunMedium className="h-6 w-6 text-amber-400" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{t('app.title')}</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">{t('app.subtitle')}</h1>
          <p className="mt-4 text-base leading-relaxed text-slate-300">{t('auth.tagline')}</p>

          <ul className="mt-8 space-y-3">
            {highlights.map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-slate-300">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-inset ring-emerald-400/30">
                  <Check className="h-3 w-3 text-emerald-400" />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">
          &copy; {new Date().getFullYear()} {t('app.title')}
        </p>
      </aside>

      <main className="relative flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="absolute end-4 top-4">
          <Button variant="ghost" size="icon" onClick={switchLocale} title={t('common.language')}>
            <Languages />
          </Button>
        </div>

        <div className="w-full max-w-sm">
          {/* The mark repeats here for the phone layout, where the panel is hidden. */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-inset ring-amber-500/25">
              <SunMedium className="h-6 w-6 text-amber-500" />
            </span>
            <span className="text-lg font-semibold tracking-tight">{t('app.title')}</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight">{t('auth.signInToAccount')}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{t('auth.welcome')}</p>
          </div>

          {notice && (
            <div className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                autoComplete="email"
                placeholder="e.g. user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  {t('auth.forgotPassword')}
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pe-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              {t('auth.rememberMe')}
            </label>

            <Button type="submit" className="h-10 w-full" disabled={loading}>
              {loading ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
