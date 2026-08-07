'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Check, Laptop, Moon, Palette as PageIcon, Sun } from 'lucide-react';
import PageHeader from '../../../../components/page-header';
import { ACCENTS, AccentId } from '../../../../lib/accents';
import { useAccent } from '../../../../components/accent-provider';
import { cn } from '../../../../lib/utils';

/** The tick badge on a selected card. */
function SelectedBadge() {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Check className="h-3 w-3" strokeWidth={3} />
    </span>
  );
}

/**
 * Miniature of a page in the given mode: a couple of bars and a panel. Drawn
 * with plain divs rather than a screenshot so it follows the real palette.
 */
function ModePreview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  const pane = (dark: boolean, className?: string) => (
    <div className={cn('flex flex-col gap-2 p-3', dark ? 'bg-[#161615]' : 'bg-[#f4f3f0]', className)}>
      <div className={cn('h-2 w-3/4 rounded-full', dark ? 'bg-white/25' : 'bg-black/15')} />
      <div className={cn('h-2 w-1/2 rounded-full', dark ? 'bg-white/15' : 'bg-black/10')} />
      <div className={cn('mt-1 h-8 rounded-md', dark ? 'bg-white/10' : 'bg-white')} />
    </div>
  );

  if (mode === 'system') {
    // Split down the middle: the point of "system" is that it is both.
    return (
      <div className="grid h-28 grid-cols-2 overflow-hidden rounded-lg border">
        {pane(false)}
        {pane(true)}
      </div>
    );
  }
  return <div className="h-28 overflow-hidden rounded-lg border">{pane(mode === 'dark', 'h-full')}</div>;
}

/** A selectable card — shared by both sections so selection reads identically. */
function OptionCard({
  selected, onSelect, children,
}: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'rounded-xl border bg-card p-3 text-start transition-colors',
        selected ? 'border-primary ring-1 ring-primary' : 'hover:border-foreground/20',
      )}
    >
      {children}
    </button>
  );
}

export default function ThemesPage() {
  const t = useTranslations();
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  // next-themes only knows the resolved value on the client; rendering the
  // selection before mount would disagree with the server HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const MODES = [
    { id: 'light', icon: Sun },
    { id: 'dark', icon: Moon },
    { id: 'system', icon: Laptop },
  ] as const;

  return (
    <div className="space-y-8">
      <PageHeader icon={PageIcon} title={t('themes.title')} subtitle={t('themes.subtitle')} />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{t('themes.mode')}</h2>
          <p className="text-sm text-muted-foreground">{t('themes.modeHint')}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {MODES.map(({ id, icon: Icon }) => (
            <OptionCard key={id} selected={mounted && theme === id} onSelect={() => setTheme(id)}>
              <ModePreview mode={id} />
              <div className="mt-3 flex items-start gap-2 px-1 pb-1">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{t(`themes.${id}`)}</div>
                  <p className="text-xs leading-snug text-muted-foreground">{t(`themes.${id}Hint`)}</p>
                </div>
                {mounted && theme === id && <SelectedBadge />}
              </div>
            </OptionCard>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{t('themes.colorTheme')}</h2>
          <p className="text-sm text-muted-foreground">{t('themes.colorThemeHint')}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ACCENTS.map(({ id, swatch }) => (
            <OptionCard key={id} selected={accent === id} onSelect={() => setAccent(id as AccentId)}>
              <div className="flex items-center gap-3 p-1">
                {/* Two overlapping dots — the palette's dark and light tones. */}
                <span className="relative flex h-7 w-11 shrink-0 items-center">
                  <span className="absolute start-0 h-7 w-7 rounded-full" style={{ background: swatch[0] }} />
                  <span className="absolute start-4 h-7 w-7 rounded-full border-2 border-card" style={{ background: swatch[1] }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{t(`themes.accent_${id}`)}</div>
                  <p className="text-xs leading-snug text-muted-foreground">{t(`themes.accent_${id}Hint`)}</p>
                </div>
                {accent === id && <SelectedBadge />}
              </div>
            </OptionCard>
          ))}
        </div>
      </section>
    </div>
  );
}
