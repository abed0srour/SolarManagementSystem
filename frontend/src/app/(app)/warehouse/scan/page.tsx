'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CameraOff,
  CheckCircle2,
  Clock,
  PackageCheck,
  QrCode,
  RotateCcw,
  ScanLine,
  XCircle,
} from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDateTime } from '../../../../lib/api';
import { invalidateCache } from '../../../../lib/cache';
import { cn } from '../../../../lib/utils';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
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
 *
 * The layout is arranged around one question: can these goods go out of the
 * door, and is there money to take first? So the screen shows exactly one thing
 * at a time — the scanner, or the order — and the amount still owed is the
 * largest element on the card, because collecting it is the action the worker
 * has to remember.
 */
export default function ScanPage() {
  const t = useTranslations();
  const [scanning, setScanning] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /** Deliberate acknowledgement before goods leave against an unpaid balance. */
  const [ackUnpaid, setAckUnpaid] = useState(false);
  const scannerRef = useRef<any>(null);
  /** The decoded token, kept so releasing does not require a second scan. */
  const tokenRef = useRef<string>('');

  const verify = async (token: string) => {
    setBusy(true);
    try {
      const { data } = await api.post('/sales-orders/pickup/verify', { token });
      setVerdict(data);
      setAckUnpaid(false);
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

  const reset = () => {
    setVerdict(null);
    setManual('');
    setAckUnpaid(false);
    tokenRef.current = '';
  };

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
      reset();
    } catch (e) {
      toast.error(errMsg(e));
      // Re-read so the screen explains why (e.g. someone else just claimed it).
      if (tokenRef.current) verify(tokenRef.current);
    } finally {
      setBusy(false);
    }
  };

  const order = verdict?.order;
  const outstanding = Number(order?.outstanding ?? 0);
  const lines: any[] = order?.items ?? [];
  // Physical pieces, not document lines: a bundle ordered twice means the worker
  // carries two of every component, and that is the number worth showing.
  const pieces = lines.reduce(
    (s, i) =>
      s +
      (i.subItems?.length
        ? i.subItems.reduce((n: number, sub: any) => n + Number(sub.quantity) * Number(i.quantity), 0)
        : Number(i.quantity)),
    0,
  );
  // Goods do not leave against an unpaid balance without a deliberate tap.
  const blockedByPayment = outstanding > 0 && !ackUnpaid;

  return (
    // pb leaves room for the sticky action bar so the last row is never buried.
    <div className="mx-auto w-full max-w-md space-y-4 pb-32">
      <div className="text-center">
        <h1 className="text-xl font-bold">{t('scan.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('scan.subtitle')}</p>
      </div>

      {/*
        The scanner and the result are never on screen together. Once an order
        is up, the worker is reading it and picking stock, and a second "start
        camera" button competing with "release" is only a way to lose the order.
      */}
      {!verdict && (
        <Card className="overflow-hidden">
          <CardContent className="space-y-3 p-4">
            <div
              id={READER_ID}
              className={scanning ? 'overflow-hidden rounded-xl border [&_video]:w-full' : 'hidden'}
            />

            {!scanning ? (
              <Button className="h-16 w-full text-base font-semibold" onClick={start} disabled={busy}>
                <QrCode className="h-6 w-6" /> {t('scan.startCamera')}
              </Button>
            ) : (
              <Button variant="outline" className="h-12 w-full" onClick={stop}>
                <CameraOff /> {t('scan.stopCamera')}
              </Button>
            )}

            {cameraError && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{cameraError}</span>
              </div>
            )}

            {/* Fallback: the short code printed under the QR. */}
            <div className="space-y-2 border-t pt-3">
              <label className="text-xs text-muted-foreground">{t('scan.manualFallback')}</label>
              <div className="flex gap-2">
                <Input
                  dir="ltr"
                  value={manual}
                  onChange={(e) => setManual(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && manual.trim() && lookupByCode(manual)}
                  placeholder="XXXXXXXX"
                  className="h-12 text-center font-mono text-lg tracking-[0.3em]"
                />
                <Button
                  variant="outline"
                  className="h-12 shrink-0"
                  disabled={!manual.trim() || busy}
                  onClick={() => lookupByCode(manual)}
                >
                  {t('claim.lookup')}
                </Button>
              </div>
              {/* Belongs to the field, not the camera: a hardware barcode gun
                  types into this input and sends Enter, which submits it. */}
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ScanLine className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('claim.scanHint')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* A code the server refused: say so plainly, offer nothing else. */}
      {verdict && !verdict.valid && (
        <Card className="border-2 border-destructive">
          <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
            <XCircle className="h-12 w-12 text-destructive" />
            <div className="text-lg font-bold text-destructive">{t('scan.rejected')}</div>
            <p className="text-sm text-muted-foreground">{verdict.message}</p>
          </CardContent>
        </Card>
      )}

      {order && verdict?.valid && (
        <Card className={cn('overflow-hidden border-2', verdict.claimable ? 'border-emerald-500/60' : 'border-destructive/60')}>
          {/*
            The verdict is a full-width band rather than a small badge: it is the
            first thing to read, and it carries an icon and words so it never
            depends on colour alone.
          */}
          <div
            className={cn(
              'flex items-center gap-3 px-4 py-3',
              verdict.claimable
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            {verdict.claimable ? (
              <CheckCircle2 className="h-6 w-6 shrink-0" />
            ) : (
              <AlertTriangle className="h-6 w-6 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-bold uppercase tracking-wide">
                {verdict.claimable ? t('claim.readyToRelease') : t('scan.doNotRelease')}
              </div>
              {!verdict.claimable && verdict.reason && (
                <div className="truncate text-xs opacity-90">{verdict.reason}</div>
              )}
            </div>
          </div>

          <CardContent className="space-y-4 p-4">
            <div>
              <div className="font-mono text-2xl font-bold tracking-tight">{order.number}</div>
              <div className="text-sm text-muted-foreground">{order.client?.name}</div>
            </div>

            {/*
              Money, sized by what it costs to get wrong. An outstanding balance
              is the largest thing on the card; totals that are merely
              informational sit under it in small type.
            */}
            {outstanding > 0 ? (
              <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  {t('scan.collectFirst')}
                </div>
                <div className="mt-1 text-4xl font-extrabold tabular-nums text-amber-700 dark:text-amber-300">
                  {fmtMoney(outstanding)}
                </div>
                <div className="mt-2 border-t border-amber-500/30 pt-2 text-xs text-muted-foreground">
                  {t('common.total')} {fmtMoney(order.total)} · {t('orders.paid')} {fmtMoney(order.paidAmount ?? 0)}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-3 text-center">
                <div className="flex items-center justify-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5" /> {t('scan.fullyPaid')}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('common.total')} {fmtMoney(order.total)}
                </div>
              </div>
            )}

            {/* Pick list — bundles expanded, because every component is collected. */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('scan.pickList')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('scan.pieces', { count: pieces })}
                </span>
              </div>
              {lines.map((i: any) => (
                <div key={i.id} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium leading-snug">{i.description ?? i.product?.name}</span>
                    {/* The count is what gets miscounted, so it reads as a chip. */}
                    <span className="shrink-0 rounded-md border bg-background px-2 py-0.5 text-sm font-bold tabular-nums">
                      ×{Number(i.quantity)}
                    </span>
                  </div>
                  {i.product?.sku && (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{i.product.sku}</div>
                  )}
                  {i.subItems?.length > 0 && (
                    <div className="mt-2 space-y-1 border-s-2 ps-3">
                      {i.subItems.map((s: any) => (
                        <div key={s.id} className="flex justify-between gap-2 text-xs text-muted-foreground">
                          <span>{s.description ?? s.product?.name}</span>
                          <span className="shrink-0 tabular-nums">
                            {Number(s.quantity)} {s.unit ?? ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/*
              Releasing unpaid goods stays possible — that is the shop's call, not
              this screen's — but it takes a deliberate tap, so it can never be
              the accidental outcome of reaching for a green button.
            */}
            {verdict.claimable && outstanding > 0 && (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
                  checked={ackUnpaid}
                  onChange={(e) => setAckUnpaid(e.target.checked)}
                />
                <span className="text-sm leading-snug">{t('scan.ackUnpaid')}</span>
              </label>
            )}

            {verdict.expiresAt && (
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {t('scan.validUntil')}: {fmtDateTime(verdict.expiresAt)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/*
        Pinned to the bottom of the viewport: with a long pick list the release
        button would otherwise sit below the fold, exactly when the worker has
        finished picking and wants it.
      */}
      {verdict && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-md gap-2 p-3">
            <Button variant="outline" className="h-14 flex-1" onClick={reset}>
              <RotateCcw /> {t('scan.scanAnother')}
            </Button>
            {verdict.valid && (
              <Button
                className="h-14 flex-[2] text-base font-semibold"
                disabled={!verdict.claimable || busy || blockedByPayment}
                onClick={release}
              >
                <PackageCheck className="h-5 w-5" /> {t('claim.release')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  /** Manual fallback goes through the plain code endpoint, not the token one. */
  async function lookupByCode(code: string) {
    setBusy(true);
    try {
      const { data } = await api.get(`/sales-orders/pickup/${encodeURIComponent(code.trim())}`);
      tokenRef.current = '';
      setAckUnpaid(false);
      setVerdict({ valid: true, claimable: data.claimable, reason: data.reason, order: data, expiresAt: null });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
}
