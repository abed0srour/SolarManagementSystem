/**
 * True when running somewhere that tears the process down between requests.
 *
 * Two things behave differently there and both would fail silently:
 *
 *  - In-process schedulers (`@Cron`, `SchedulerRegistry`) never fire, because
 *    nothing is alive to fire them. The platform's own scheduler calls
 *    `/api/cron/*` instead, so registering them would only be misleading.
 *  - There is no writable working directory; see StorageService.
 *
 * Vercel sets `VERCEL=1` in every runtime environment.
 */
export const isServerless = (): boolean => process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;
