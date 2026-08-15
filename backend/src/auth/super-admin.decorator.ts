import { SetMetadata } from '@nestjs/common';

export const SUPER_ADMIN_ONLY_KEY = 'superAdminOnly';

/** Restricts a route to the super admin — used for account management. */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY_KEY, true);
