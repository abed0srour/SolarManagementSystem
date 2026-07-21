'use client';
import { ReactNode, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  destructive?: boolean;
  /** When set, the user must type this exact text before Confirm enables (for sensitive deletes). */
  requireText?: string;
  onConfirm: () => Promise<void> | void;
}

export default function ConfirmDialog({ open, onOpenChange, title, description, destructive = true, requireText, onConfirm }: Props) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const blocked = !!requireText && typed.trim() !== requireText;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? t('common.confirmTitle')}</DialogTitle>
          <DialogDescription>{description ?? t('common.confirmDelete')}</DialogDescription>
        </DialogHeader>
        {requireText && (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              {t('common.typeToConfirm', { word: requireText })}
            </p>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireText}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy || blocked}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
