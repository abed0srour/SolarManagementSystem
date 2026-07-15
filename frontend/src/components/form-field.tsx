'use client';
import { ReactNode } from 'react';
import { Label } from './ui/label';
import { cn } from '../lib/utils';

export default function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
