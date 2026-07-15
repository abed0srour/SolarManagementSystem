'use client';
import { useTranslations } from 'next-intl';
import { Badge } from './ui/badge';

const VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'muted'> = {
  DRAFT: 'muted',
  PENDING: 'warning',
  SENT: 'info',
  ACCEPTED: 'success',
  EXPIRED: 'muted',
  CANCELLED: 'destructive',
  CONFIRMED: 'default',
  PARTIALLY_DELIVERED: 'info',
  DELIVERED: 'success',
  PARTIALLY_RECEIVED: 'info',
  RECEIVED: 'success',
  CLOSED: 'muted',
  UNPAID: 'warning',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
  OVERDUE: 'destructive',
  APPROVED: 'default',
  REJECTED: 'destructive',
  COMPLETED: 'success',
  OPEN: 'warning',
  SENT_TO_SUPPLIER: 'info',
  RESOLVED: 'success',
  REPLACED: 'default',
  SCHEDULED: 'info',
  IN_PROGRESS: 'default',
  IN_STOCK: 'success',
  RESERVED: 'info',
  SOLD: 'default',
  RETURNED: 'warning',
  DAMAGED: 'destructive',
  RETURNED_TO_SUPPLIER: 'muted',
  CREDITED: 'success',
};

export default function StatusChip({ status }: { status?: string }) {
  const t = useTranslations('status');
  if (!status) return null;
  let label = status.replace(/_/g, ' ');
  try {
    label = t(status as any);
  } catch {
    /* fall back to raw */
  }
  return <Badge variant={VARIANTS[status] ?? 'muted'}>{label}</Badge>;
}
