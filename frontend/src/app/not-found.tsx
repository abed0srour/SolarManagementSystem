'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SearchX } from 'lucide-react';
import { buttonVariants } from '../components/ui/button';

export default function NotFound() {
  const t = useTranslations('errors');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <SearchX className="h-16 w-16 text-muted-foreground" />
      <h1 className="text-3xl font-bold">404 — {t('notFound')}</h1>
      <p className="text-muted-foreground">{t('notFoundDesc')}</p>
      <Link href="/dashboard" className={buttonVariants()}>
        {t('goHome')}
      </Link>
    </div>
  );
}
