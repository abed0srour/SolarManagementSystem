import type { BadgeProps } from '../../components/ui/badge';

/** One mapping of store status to badge colour, shared by every screen that shows one. */
export const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  ARCHIVED: 'muted',
};

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];
