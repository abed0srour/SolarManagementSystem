'use client';
import { ReactNode } from 'react';
import { Label } from './ui/label';
import { cn } from '../lib/utils';

/**
 * A labelled form control.
 *
 * `justify-end` matters: grid cells stretch to the tallest in their row, so a
 * label that wraps to two lines would otherwise push its own input lower than
 * the inputs beside it. Anchoring content to the bottom keeps every control on
 * one line regardless of how long its label is.
 */
export default function Field({ label, children, className, hint }: { label: ReactNode; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <div className={cn('flex flex-col justify-end gap-1.5', className)}>
      <Label className="leading-snug">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
