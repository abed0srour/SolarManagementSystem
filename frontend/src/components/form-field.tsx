'use client';
import { ReactNode, createContext, useContext } from 'react';
import { Label } from './ui/label';
import { cn } from '../lib/utils';

/**
 * Set by `AlignedFieldGrid`. Off by default because most Fields live in plain
 * dialog grids that do not define the row tracks the aligned layout needs.
 */
const AlignedRows = createContext(false);

/**
 * A grid whose Fields line up with each other: every label in a row starts on
 * the same line, every control sits on the same line, and hints hang below
 * without dragging their own control out of step.
 *
 * It works by giving the grid three row tracks per row of fields — label,
 * control, hint — and having each Field adopt those tracks (`subgrid`) instead
 * of sizing its own. Since the tracks are shared, one field's two-line label or
 * long hint grows the track for the whole row rather than shifting that field
 * alone. Without this, a field carrying a hint aligns its *hint* with its
 * neighbour's *input*, which floats the input upward.
 */
export function AlignedFieldGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <AlignedRows.Provider value={true}>
      <div className={cn('grid', className)}>{children}</div>
    </AlignedRows.Provider>
  );
}

/**
 * A labelled form control.
 *
 * Inside an `AlignedFieldGrid` it spans the three shared row tracks. Outside
 * one it falls back to a bottom-anchored column: `justify-end` matters there
 * because grid cells stretch to the tallest in their row, so a label that wraps
 * to two lines would otherwise push its own input lower than the inputs beside
 * it.
 */
export default function Field({
  label,
  children,
  className,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
}) {
  const aligned = useContext(AlignedRows);

  if (aligned) {
    return (
      <div className={cn('row-span-3 grid grid-rows-subgrid gap-1.5', className)}>
        {/* Anchored to the bottom of their tracks so a short label stays next
            to its control when a neighbour's label wraps, and a short control
            stays on the baseline when a neighbour is a textarea. */}
        <Label className="self-end leading-snug">{label}</Label>
        <div className="self-end">{children}</div>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col justify-end gap-1.5', className)}>
      <Label className="leading-snug">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
