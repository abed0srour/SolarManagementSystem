'use client';
import Link from 'next/link';
import { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * A reference from one record to another — the client on an invoice, the order
 * behind a payment.
 *
 * Two things it exists to get right everywhere at once:
 *
 * - `stopPropagation`. Most of these sit inside table rows that are themselves
 *   clickable (row click opens the edit dialog). Without it, following the link
 *   also fires the row handler, so you arrive at the target with a stray dialog
 *   open behind you.
 * - A missing reference renders as a muted em dash rather than a dead link, so
 *   a payment with no order looks deliberately empty instead of broken.
 */
export default function EntityLink({
  href,
  children,
  mono,
  className,
}: {
  /** Omit or pass null when there is nothing to link to. */
  href?: string | null;
  children: ReactNode;
  /** Reference numbers read better in monospace; names do not. */
  mono?: boolean;
  className?: string;
}) {
  if (!href || children === null || children === undefined || children === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'text-primary hover:underline',
        mono && 'font-mono text-xs',
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Canonical detail-page paths, so no caller has to remember the URL shape. */
export const linkTo = {
  client: (id?: string | null) => (id ? `/clients/${id}` : null),
  salesOrder: (id?: string | null) => (id ? `/sales-orders/${id}` : null),
  invoice: (id?: string | null) => (id ? `/invoices/${id}` : null),
  installation: (id?: string | null) => (id ? `/installations/${id}` : null),
  product: (id?: string | null) => (id ? `/products/${id}/edit` : null),
};
