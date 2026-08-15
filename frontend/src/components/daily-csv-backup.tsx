'use client';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { downloadFile } from '../lib/api';

export const CSV_BACKUP_ENABLED_KEY = 'csvBackup:enabled';
const LAST_RUN_KEY = 'csvBackup:lastDate';

export const csvBackupEnabled = () =>
  typeof window !== 'undefined' && localStorage.getItem(CSV_BACKUP_ENABLED_KEY) !== '0';

const today = () => new Date().toISOString().slice(0, 10);

export const csvFilename = () => `solar-store-csv-${today()}.zip`;

/**
 * Downloads a CSV copy of the database to this PC once a day.
 *
 * Deliberately driven by the browser rather than the server: the API runs on
 * Vercel and has no route to a filesystem you own, so the only way a file
 * reaches this machine is for a page you have open to fetch and save it. That
 * makes the guarantee weaker than a real scheduled job — it fires on the first
 * visit of the day, so a day the app is never opened produces no copy — and the
 * file lands wherever the browser puts downloads.
 *
 * The last-run date is kept in localStorage, so "once a day" means once per
 * browser on this machine, which is the right granularity for a local copy.
 */
export default function DailyCsvBackup() {
  const t = useTranslations();
  // React strict mode mounts effects twice in development; without this the
  // first visit of the day downloads two identical files.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!csvBackupEnabled()) return;
    if (localStorage.getItem(LAST_RUN_KEY) === today()) return;

    // Marked before the request, not after: a half-finished download that the
    // user cancels should not retry on every page navigation for the rest of
    // the day. Failures are reported and can be retried from Settings.
    localStorage.setItem(LAST_RUN_KEY, today());
    downloadFile('/backup/csv', csvFilename())
      .then(() => toast.success(t('backup.csvDownloaded')))
      .catch(() => localStorage.removeItem(LAST_RUN_KEY));
  }, [t]);

  return null;
}
