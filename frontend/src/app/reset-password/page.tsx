'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SunMedium, Eye, EyeOff, ShieldAlert, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabaseBrowser } from '../../lib/supabase/client';
import { claimsFromToken, homeRouteFor } from '../../lib/claims';
import { Button, buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';

type Phase = 'checking' | 'ready' | 'invalid' | 'saved';

export default function ResetPasswordPage() {
  const t = useTranslations();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  /**
   * A recovery link signs the visitor in with a temporary session and fires
   * PASSWORD_RECOVERY. Listening for the event rather than reading the URL is
   * what makes this robust: Supabase has moved the token between the hash
   * fragment and a `?code=` query over the years, and the event is emitted in
   * both cases once the client has finished processing it.
   */
  useEffect(() => {
    const supabase = supabaseBrowser();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setPhase('ready');
    });

    // Covers the case where the client processed the link before this listener
    // was attached, which is the common one on a fast connection.
    supabase.auth.getSession().then(({ data }) => {
      setPhase((current) => (current === 'checking' ? (data.session ? 'ready' : 'invalid') : current));
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error(t('auth.passwordTooShort'));
    if (password !== confirm) return toast.error(t('auth.passwordsDoNotMatch'));

    setLoading(true);
    try {
      const { error } = await supabaseBrowser().auth.updateUser({ password });
      if (error) throw error;
      setPhase('saved');
      toast.success(t('auth.passwordUpdated'));

      // Land them wherever their role belongs, using the claims from the
      // session the recovery link established.
      const { data } = await supabaseBrowser().auth.getSession();
      const claims = claimsFromToken(data.session?.access_token);
      setTimeout(() => {
        router.replace(homeRouteFor(claims));
        router.refresh();
      }, 1200);
    } catch (err: any) {
      toast.error(err?.message ?? t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            <SunMedium className="h-7 w-7 text-amber-500" />
            <CardTitle className="text-xl">{t('auth.resetPasswordTitle')}</CardTitle>
          </div>
          <CardDescription>
            {phase === 'invalid' ? t('auth.resetLinkInvalidDescription') : t('auth.resetPasswordDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {phase === 'checking' && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}

          {phase === 'invalid' && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('auth.resetLinkInvalid')}</span>
              </div>
              <Link href="/forgot-password" className={cn(buttonVariants(), 'w-full')}>
                {t('auth.requestNewLink')}
              </Link>
              <Link href="/login" className={cn(buttonVariants({ variant: 'ghost' }), 'w-full')}>
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                {t('auth.backToSignIn')}
              </Link>
            </div>
          )}

          {phase === 'saved' && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
              {t('auth.passwordUpdatedRedirecting')}
            </div>
          )}

          {phase === 'ready' && (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">{t('auth.newPassword')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={show ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="pe-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShow((v) => !v)}
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{t('auth.passwordRule')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">{t('auth.confirmPassword')}</Label>
                <Input
                  id="confirm"
                  type={show ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('common.saving') : t('auth.setNewPassword')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
