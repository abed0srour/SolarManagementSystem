'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SunMedium, ArrowLeft, MailCheck } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase/client';
import { Button, buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';

export default function ForgotPasswordPage() {
  const t = useTranslations();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    /*
     * Rate limiting is the only failure surfaced here.
     *
     * "No account with that email" is deliberately NOT shown: an error that
     * distinguishes a registered address from an unregistered one turns this
     * form into a way to enumerate every customer of the platform. The success
     * panel below is shown either way.
     */
    if (err && /rate limit|too many/i.test(err.message)) {
      setError(t('auth.tooManyRequests'));
      return;
    }
    setSent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            <SunMedium className="h-7 w-7 text-amber-500" />
            <CardTitle className="text-xl">{t('auth.forgotPasswordTitle')}</CardTitle>
          </div>
          <CardDescription>
            {sent ? t('auth.resetLinkSentDescription') : t('auth.forgotPasswordDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('auth.resetLinkSent', { email })}</span>
              </div>
              <Link href="/login" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                {t('auth.backToSignIn')}
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
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
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('common.loading') : t('auth.sendResetLink')}
              </Button>
              <Link href="/login" className={cn(buttonVariants({ variant: 'ghost' }), 'w-full')}>
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                {t('auth.backToSignIn')}
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
