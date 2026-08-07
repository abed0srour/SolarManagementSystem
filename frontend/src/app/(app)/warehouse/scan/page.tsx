'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, CameraOff, CheckCircle2, PackageCheck, QrCode, RotateCcw, XCircle } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDateTime } from '../../../../lib/api';
import { invalidateCache } from '../../../../lib/cache';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Badge } from '../../../../components/ui/badge';
import { Card, CardContent } from '../../../../components/ui/card';

type Verdict = {
  valid: boolean;
  reason?: string | null;
  message?: string;
  claimable?: boolean;
  expiresAt?: string | null;
  order?: any;
};

const READER_ID = 'qr-reader';

/**
 * Warehouse scanner, built for a phone held one-handed at the counter.
 *
 * The camera decodes locally; only the token is sent to the server, which is
 * the sole authority on whether a QR is genuine, unexpired and claimable. The
 * page never decides that itself — a scanner that trusted its own reading would
 * be trivially fooled by a hand-made QR.
 */
export default function ScanPage() {
  const t = useTranslations();
  const [scanning, setScanning] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<any>(null);
  /** The decoded token, kept so releasing does not require a second scan. */
  const tokenRef = useRef<string>('');

  const verify = async (token: string) => {
    setBusy(true);
    try {
      const { data } = await api.post('/sales-orders/pickup/verify', { token });
      setVerdict(data);
      if (!data.valid) toast.error(data.message);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    try {
      await s?.stop();
      await s?.clear();
    } catch {
      /* already stopped */
    }
  };

  const start = async () => {
    setVerdict(null);
    setCameraError(null);
    setScanning(true);
    try {
      // Imported on demand: the decoder is large and only the warehouse needs it.
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(READER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' }, // rear camera on a phone
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded: string) => {
          // Stop first: without it the callback fires repeatedly while the code
          // is still in frame, firing a burst of verify requests.
          await stop();
          tokenRef.current = decoded;
          verify(decoded);
        },
        () => {
          /* per-frame decode misses are normal — ignore */
        },
      );
    } catch (e: any) {
      setScanning(false);
      setCameraError(
        e?.message?.includes('Permission') || e?.name === 'NotAllowedError'
          ? t('scan.cameraDenied')
          : t('scan.cameraUnavailable'),
      );
    }
  };

  // Release the camera when leaving the page — the LED staying on is alarming.
  useEffect(() => () => void stop(), []);

  /**
   * Release the goods.
   *
   * Scanned orders go back through the signed token so the server re-checks the
   * signature and expiry at the moment of release, not just at scan time.
   * Manually entered ones have no token, so they use the plain code endpoint —
   * which applies the same double-claim guard inside its transaction.
   */
  const release = async () => {
    setBusy(true);
    try {
      const { data } = tokenRef.current
        ? await api.post('/sales-orders/pickup/claim-token', { token: tokenRef.current })
        : await api.post(`/sales-orders/pickup/${encodeURIComponent(verdict!.order.pickupCode)}/claim`, {});
      invalidateCache('sales-orders');
      toast.success(t('claim.released', { number: data.number }));
      setVerdict(null);
      setManual('');
      tokenRef.current = '';
    } catch (e) {
      toast.error(errMsg(e));
      // Re-read so the screen explains why (e.g. someone else just claimed it).
      if (tokenRef.current) verify(tokenRef.current);
    } finally {
      setBusy(false);
    }
  };

  const order = verdict?.order;

  return (
    <div className="mx-auto w-full max-w-md space-y-4 pb-8">
      <div className="text-center">
        <h1 className="text-xl font-bold">{t('scan.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('scan.subtitle')}</p>
      </div>

      {/* Camera */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div
            id={READER_ID}
            className={scanning ? 'overflow-hidden rounded-lg [&_video]:w-full' : 'hidden'}
          />

          {!scanning && (
            <Button className="h-14 w-full text-base" onClick={start} disabled={busy}>
              <QrCode className="h-5 w-5" /> {t('scan.startCamera')}
            </Button>
          )}
          {scanning && (
            <Button variant="outline" className="w-full" onClick={stop}>
              <CameraOff /> {t('scan.stopCamera')}
            </Button>
          )}

          {cameraError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* Fallback: the short code printed under the QR. */}
          <div className="space-y-1.5 border-t pt-3">
            <label className="text-xs text-muted-foreground">{t('scan.manualFallback')}</label>
            <div className="flex gap-2">
              <Input
                dir="ltr"
                value={manual}
                onChange={(e) => setManual(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && manual.trim() && lookupByCode(manual, setVerdict, setBusy, t)}
                placeholder="XXXXXXXX"
                className="font-mono tracking-[0.2em]"
              />
              <Button variant="outline" disabled={!manual.trim() || busy} onClick={() => lookupByCode(manual, setVerdict, setBusy, t)}>
                {t('claim.lookup')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verdict */}
      {verdict && !verdict.valid && (
        <Card className="border-destructive">
          <CardContent className="flex items-start gap-3 p-4">
            <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />
            <div>
              <div className="font-semibold text-destructive">{t('scan.rejected')}</div>
              <p className="text-sm text-muted-foreground">{verdict.message}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {order && verdict?.valid && (
        <Card className={verdict.claimable ? 'border-emerald-500/60' : 'border-amber-500/60'}>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-lg font-bold">
                  {verdict.claimable ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  )}
                  {order.number}
                </div>
                <div className="text-sm text-muted-foreground">{order.client?.name}</div>
              </div>
              <Badge variant={verdict.claimable ? 'success' : 'destructive'}>
                {verdict.claimable ? t('claim.readyToRelease') : verdict.reason}
              </Badge>
            </div>

            {/* Payment status: the thing the worker most needs to see. */}
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('common.total')}</span>
                <span className="font-semibold">{fmtMoney(order.total)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('orders.paid')}</span>
                <span className="text-emerald-600 dark:text-emerald-400">{fmtMoney(order.paidAmount ?? 0)}</span>
              </div>
              <div className="mt-2 border-t pt-2">
                {Number(order.outstanding) > 0 ? (
                  <div className="flex items-center justify-between font-bold text-amber-600 dark:text-amber-400">
                    <span>{t('scan.unpaid')}</span>
                    <span>{fmtMoney(order.outstanding)}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> {t('scan.fullyPaid')}
                  </div>
                )}
              </div>
            </div>

            {/* Pick list — bundles expanded, because every component is collected. */}
            <div className="space-y-1.5">
              {order.items?.map((i: any) => (
                <div key={i.id} className="rounded-md border px-3 py-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{i.description ?? i.product?.name}</span>
                    <span className="shrink-0 tabular-nums">×{Number(i.quantity)}</span>
                  </div>
                  {i.subItems?.map((s: any) => (
                    <div key={s.id} className="mt-1 flex justify-between gap-2 ps-3 text-xs text-muted-foreground">
                      <span>• {s.description ?? s.product?.name}</span>
                      <span className="shrink-0 tabular-nums">{Number(s.quantity)} {s.unit ?? ''}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {verdict.expiresAt && (
              <p className="text-center text-xs text-muted-foreground">
                {t('scan.validUntil')}: {fmtDateTime(verdict.expiresAt)}
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setVerdict(null); setManual(''); }}>
                <RotateCcw /> {t('scan.scanAnother')}
              </Button>
              <Button className="flex-1 h-12" disabled={!verdict.claimable || busy} onClick={release}>
                <PackageCheck /> {t('claim.release')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  /** Manual fallback goes through the plain code endpoint, not the token one. */
  async function lookupByCode(code: string, set: (v: Verdict) => void, setB: (b: boolean) => void, tr: any) {
    setB(true);
    try {
      const { data } = await api.get(`/sales-orders/pickup/${encodeURIComponent(code.trim())}`);
      tokenRef.current = '';
      set({ valid: true, claimable: data.claimable, reason: data.reason, order: data, expiresAt: null });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setB(false);
    }
  }
}
