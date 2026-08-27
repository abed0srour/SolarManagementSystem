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
  /** What Supabase said went wrong, when it said anything at all. */
  const [reason, setReason] = useState<string | null>(null);
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
  /**
   * Say why the link failed, rather than only that it did.
   *
   * Supabase reports a rejection on the way back: in the query string for the
   * code flow, in the hash fragment for the implicit one. "Already used" and
   * "expired" and "redirect not allowed" all arrive here as distinct messages
   * and need different responses from whoever is reading the screen, so
   * flattening them into one sentence throws away the only useful part.
   *
   * When nothing was reported, what matters instead is which shape of token
   * arrived -- or that none did -- so that is noted too.
   */
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const pick = (key: string) => query.get(key) ?? hash.get(key);

    const description = pick('error_description');
    const code = pick('error_code') ?? pick('error');
    if (description || code) {
      setReason([description?.replace(/\+/g, ' '), code && `(${code})`].filter(Boolean).join(' '));
      return;
    }

    const carried = ['access_token', 'code', 'token_hash', 'token'].filter((k) => pick(k));
    setReason(carried.length ? `Link carried: ${carried.join(', ')}` : 'Link carried no token at all');
  }, []);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setPhase('ready');
    });

    void (async () => {
      /**
       * Exchange the link's tokens for a session explicitly.
       *
       * Relying on the client to notice them was the bug: `createBrowserClient`
       * defaults to the PKCE flow, which looks for a `?code=` alongside a
       * verifier saved in the browser that began the request. An invite or
       * recovery mail is generated on the server for someone who has never
       * visited, so neither exists, and the `#access_token` it does carry was
       * left unread -- the page then reported a valid link as expired.
       *
       * Handing the tokens to `setSession` skips that detection entirely and
       * works whichever flow the client is configured for.
       */
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (!error) {
          // Strip the tokens from the address bar once spent, so a reload or a
          // copied URL cannot replay them.
          window.history.replaceState(null, '', window.location.pathname);
          setPhase('ready');
          return;
        }
        setReason(error.message);
      }

      // No tokens in the URL: either the client already consumed them, or the
      // visitor arrived here with a session of their own to change.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setPhase((current) => (current === 'checking' ? (data.session ? 'ready' : 'invalid') : current));
    })();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
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
              {reason && (
                <p className="break-words rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                  {reason}
                </p>
              )}
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
