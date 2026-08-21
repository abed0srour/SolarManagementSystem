'use client';
import { ReactNode, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  destructive?: boolean;
  /** When set, the user must type this exact text before Confirm enables (for sensitive deletes). */
  requireText?: string;
  /**
   * API path returning `{ used, usedBy }` for the record being removed, e.g.
   * `/products/123/usage`. When it reports the record is unused, the dialog
   * offers a straight Delete instead of demanding the archive ceremony — a
   * record created by mistake and never referenced has nothing to preserve.
   */
  usagePath?: string;
  onConfirm: () => Promise<void> | void;
}

export default function ConfirmDialog({ open, onOpenChange, title, description, destructive = true, requireText, usagePath, onConfirm }: Props) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [usage, setUsage] = useState<{ used: boolean; usedBy: Record<string, number>; blockedReason?: string } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) {
      setTyped('');
      setUsage(null);
      return;
    }
    if (!usagePath) return;
    let cancelled = false;
    setChecking(true);
    api
      .get(usagePath)
      .then((r) => !cancelled && setUsage(r.data))
      // On failure fall back to the archive flow — the safe default.
      .catch(() => !cancelled && setUsage({ used: true, usedBy: {} }))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [open, usagePath]);

  /**
   * Some records cannot be removed at all — a category still holding live
   * sub-categories, say. Saying so up front beats letting the user type the
   * confirmation word and then rejecting it.
   */
  const blockedReason = usage?.blockedReason;

  /** Unused records are deleted outright, so the archive ceremony is skipped. */
  const canDelete = usage !== null && !usage.used && !blockedReason;

  const entered = typed.trim();
  // A deletable record needs no typed confirmation — there is no history to lose.
  const blocked = !canDelete && !!requireText && entered !== requireText;
  // Only flag a mismatch once something has been typed — an empty box is not an error.
  const mismatch = !canDelete && !!requireText && entered.length > 0 && entered !== requireText;

  const run = async () => {
    if (busy || blocked) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Wider than the default so the description and the "referenced by" list
        wrap into fewer lines. This dialog has a sticky header, so any content
        that overflows scrolls underneath it — which reads as the label being
        cropped rather than as scrolling. Keeping it short avoids that.
        gap-3 rather than gap-4 for the same reason.
      */}
      <DialogContent className="max-w-lg gap-3">
        {/*
          `static` overrides the shared sticky header. Stickiness exists for
          long forms like the product editor; here it only lets the body scroll
          underneath and clip the label below it.
        */}
        <DialogHeader className="static border-b-0 pb-0">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                destructive ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
              )}
            >
              <AlertTriangle className="h-[18px] w-[18px]" />
            </span>
            <div className="space-y-1.5">
              <DialogTitle>{canDelete ? t('common.deleteTitle') : (title ?? t('common.confirmTitle'))}</DialogTitle>
              <DialogDescription>
                {checking
                  ? t('common.loading')
                  : blockedReason
                    ? t('common.blocked.' + blockedReason)
                    : usage?.used
                      ? t('common.hasRelationsBlocked')
                      : canDelete
                        ? t('common.deleteForeverDescription')
                        : (description ?? t('common.confirmDelete'))}
              </DialogDescription>
              {/* Say exactly what is holding the record back from deletion. */}
              {usage?.used && Object.keys(usage.usedBy).length > 0 && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive font-medium">
                  {t('common.usedBy')}: {Object.entries(usage.usedBy).map(([k, n]) => `${k} (${n})`).join(', ')}
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        {requireText && !canDelete && !checking && !blockedReason && !usage?.used && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('common.typeToConfirm', { word: requireText })}</p>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void run();
                }
              }}
              // No placeholder: showing the required word in grey made the empty
              // field look already filled, so Confirm read as broken rather than
              // waiting for input.
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('common.typeToConfirm', { word: requireText })}
              aria-invalid={mismatch}
              className={cn(
                'font-mono tracking-wide',
                mismatch && 'border-destructive focus-visible:ring-destructive',
                !blocked && 'border-emerald-500/70 focus-visible:ring-emerald-500',
              )}
            />
          </div>
        )}

        <DialogFooter className="static border-t-0 pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={busy || blocked || checking || !!blockedReason || (usage !== null && usage.used)} onClick={run}>
            {busy ? t('common.loading') : canDelete ? t('common.deleteForever') : t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
