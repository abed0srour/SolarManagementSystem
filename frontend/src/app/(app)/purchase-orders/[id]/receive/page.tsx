'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Keyboard,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  ScanLine,
  Trash2,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import { api, errMsg } from '../../../../../lib/api';
import { invalidateCache } from '../../../../../lib/cache';
import { extractSerial, isLabelPayload } from '../../../../../lib/serial';
import { cn } from '../../../../../lib/utils';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Skeleton } from '../../../../../components/ui/skeleton';

/** The backend rejects anything longer; catch it at the scanner instead of on submit. */
const MAX_SERIAL_LEN = 18;

type Line = {
  productId: string;
  name: string;
  sku: string;
  trackSerials: boolean;
  ordered: number;
  received: number;
  /** Ordered minus already received — the most this session may add. */
  outstanding: number;
  /** Captured this session. Serial-tracked products only. */
  serials: string[];
  /** Plain count for products that carry no serials (bulk goods, services). */
  qty: number;
};

/** A line contributes this many units to the receipt. */
const unitsOf = (l: Line) => (l.trackSerials ? l.serials.length : l.qty);

/* -------------------------------------------------------------------------- */

/** Progress pill: captured over outstanding, coloured once the line is complete. */
function Counter({ done, total, className }: { done: number; total: number; className?: string }) {
  const complete = done >= total && total > 0;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums',
        complete ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {complete && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      {done}/{total}
    </span>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full transition-all', done >= total ? 'bg-emerald-500' : 'bg-primary')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Scan-to-receive.
 *
 * Built for one hand in a warehouse doorway, so the whole screen does one job
 * at a time: pick a product, then fill it. Received quantity is defined as the
 * number of serials captured — scan five and you receive five, scan three and
 * three arrive with two still outstanding. That makes serials impossible to
 * skip on a tracked product without ever blocking a short delivery.
 *
 * The camera decodes locally and the value is only a candidate until it is
 * added: a barcode drifting through frame should never silently commit a unit
 * to stock.
 */
export default function ReceivePurchaseOrderPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const poId = params.id;

  const [po, setPo] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* --- scanner state --- */
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pending, setPending] = useState('');
  const [manual, setManual] = useState('');
  const [checking, setChecking] = useState(false);
  /** Why the last serial was refused. Shown beside the input, not as a toast. */
  const [scanError, setScanError] = useState<string | null>(null);
  const [autoAdd, setAutoAdd] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchable, setTorchable] = useState(false);
  /** ZXing scanner controls: stop() and, where supported, switchTorch(). */
  const scannerRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** Read inside the decode callback, which closes over its first render. */
  const autoAddRef = useRef(autoAdd);
  autoAddRef.current = autoAdd;

  const active = lines.find((l) => l.productId === activeId) ?? null;
  const activeRef = useRef<Line | null>(active);
  activeRef.current = active;

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/purchase-orders/${poId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setPo(data);
        setLines(
          (data.items ?? [])
            .map((i: any) => ({
              productId: i.productId,
              name: i.product?.name ?? '—',
              sku: i.product?.sku ?? '',
              trackSerials: Boolean(i.product?.trackSerials) && !i.product?.isService,
              ordered: i.quantity,
              received: i.receivedQty,
              outstanding: Math.max(0, i.quantity - i.receivedQty),
              serials: [],
              qty: 0,
            }))
            .filter((l: Line) => l.outstanding > 0),
        );
      })
      .catch((e) => toast.error(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [poId]);

  const totalUnits = lines.reduce((s, l) => s + unitsOf(l), 0);
  const totalOutstanding = lines.reduce((s, l) => s + l.outstanding, 0);

  /** Every serial captured in this session, across all products. */
  const allSerials = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lines) for (const s of l.serials) m.set(s.toUpperCase(), l.name);
    return m;
  }, [lines]);

  /* ------------------------------ camera ---------------------------------- */

  const stopCamera = useCallback(async () => {
    const controls = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    setTorchOn(false);
    setTorchable(false);
    if (!controls) return;
    try {
      controls.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setScanning(true);
    try {
      /*
       * ZXing directly, rather than the html5-qrcode wrapper the pickup
       * scanner uses.
       *
       * That wrapper reads QR fine but would not decode a Code 128 strip at
       * all — verified by feeding Chrome a fake camera showing a generated
       * barcode: html5-qrcode saw nothing across a 25-second run, while the
       * same image handed straight to ZXing decoded first time. Its
       * `useBarCodeDetectorIfSupported` flag only helps where the browser has
       * a native BarcodeDetector, which rules out iOS Safari entirely.
       *
       * Both decoders are loaded on demand; neither is in the main bundle.
       */
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);

      const hints = new Map();
      // Serial labels are 1D far more often than QR, so the 1D symbologies are
      // listed explicitly. Naming the formats also keeps the decoder from
      // spending every frame testing ones this app will never see.
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
      ]);
      // Worth the extra work per frame: a label is usually held at an angle.
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
      const video = videoRef.current;
      if (!video) throw new Error('viewfinder not mounted');

      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        video,
        (result) => {
          if (!result) return; // a frame with nothing in it is the normal case
          const value = result.getText().trim();
          if (!value) return;
          if (autoAddRef.current) {
            void addSerial(value, { silentDuplicate: true });
          } else {
            // Hold it as a candidate; the operator commits it with Add.
            setPending((prev) => (prev === value ? prev : value));
            buzz(20);
          }
        },
      );
      scannerRef.current = controls;

      // Torch is only exposed on some Android browsers.
      setTorchable(Boolean(controls.switchTorch));
    } catch (e: any) {
      setScanning(false);
      setCameraError(
        e?.message?.includes('Permission') || e?.name === 'NotAllowedError'
          ? t('scan.cameraDenied')
          : t('scan.cameraUnavailable'),
      );
    }
  }, [t]);

  const toggleTorch = async () => {
    const controls = scannerRef.current;
    if (!controls?.switchTorch) return;
    try {
      await controls.switchTorch(!torchOn);
      setTorchOn((v) => !v);
    } catch {
      toast.error(t('receive.torchFailed'));
    }
  };

  // Never leave the camera running behind a navigation — the LED staying lit
  // reads as the app recording you.
  useEffect(() => () => void stopCamera(), [stopCamera]);

  /* ------------------------------ capture --------------------------------- */

  const buzz = (ms: number | number[]) => {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* unsupported */
    }
  };

  /**
   * Refuse a serial and clear the field for the next one.
   *
   * Clearing matters as much as the message: leaving a rejected value sitting
   * in the box means the next scan lands behind it, and someone working through
   * a pallet has to stop and empty the field by hand every time a label is a
   * duplicate. The buzz pattern is deliberately unlike the single pulse a
   * successful add gives, so a bad read is felt without looking at the screen.
   */
  const reject = (message: string) => {
    // Inline rather than a toast: the toaster sits bottom-right, which on a
    // phone lands squarely on top of the fixed footer button — and a scanning
    // error belongs beside the input the operator is already looking at.
    setScanError(message);
    buzz([40, 60, 40]);
    setPending('');
    setManual('');
  };

  /**
   * Commit one serial to the active product.
   *
   * Three gates, cheapest first: the length the backend enforces, this
   * session's own captures, then the database. The last one costs a round trip,
   * so it runs only after the local checks pass.
   */
  const addSerial = async (raw: string, opts: { silentDuplicate?: boolean } = {}) => {
    const line = activeRef.current;
    if (!line) return;
    // Every path lands here — camera, typing, paste — so the label record is
    // unwrapped once, in one place, rather than at each call site.
    const serial = extractSerial(raw);
    if (!serial) return;

    if (serial.length > MAX_SERIAL_LEN) {
      reject(t('receive.serialTooLong', { max: MAX_SERIAL_LEN }));
      return;
    }
    if (line.serials.length >= line.outstanding) {
      reject(t('receive.lineFull', { count: line.outstanding }));
      return;
    }
    const clash = allSerials.get(serial.toUpperCase());
    if (clash) {
      // Auto-add re-reads the same label many times a second; that is expected,
      // not an error worth shouting about.
      if (!opts.silentDuplicate) reject(t('receive.duplicateInBatch', { product: clash }));
      return;
    }

    setChecking(true);
    try {
      await api.get(`/inventory/units/serial/${encodeURIComponent(serial)}`);
      // A hit means the serial is already registered to a unit in stock.
      reject(t('receive.alreadyRegistered'));
      return;
    } catch (e: any) {
      if (e?.response?.status !== 404) {
        reject(errMsg(e));
        return;
      }
      // 404 is the good case: nothing owns this serial yet.
    } finally {
      setChecking(false);
    }

    setLines((prev) =>
      prev.map((l) => (l.productId === line.productId ? { ...l, serials: [...l.serials, serial] } : l)),
    );
    setScanError(null);
    setPending('');
    setManual('');
    buzz(35);
  };

  const removeSerial = (productId: string, index: number) => {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, serials: l.serials.filter((_, i) => i !== index) } : l)),
    );
  };

  const setQty = (productId: string, next: number) => {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, qty: Math.max(0, Math.min(l.outstanding, next)) } : l)),
    );
  };

  const openProduct = (id: string) => {
    setActiveId(id);
    setScanError(null);
    setPending('');
    setManual('');
  };

  const closeProduct = async () => {
    await stopCamera();
    setActiveId(null);
    setPending('');
    setManual('');
  };

  /* ------------------------------ submit ---------------------------------- */

  const submit = async () => {
    const payload = lines
      .filter((l) => unitsOf(l) > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: unitsOf(l),
        ...(l.trackSerials ? { serialNumbers: l.serials } : {}),
      }));
    if (payload.length === 0) {
      toast.error(t('receive.nothingToReceive'));
      return;
    }
    setSubmitting(true);
    try {
      await stopCamera();
      await api.post(`/purchase-orders/${poId}/receive`, { lines: payload });
      invalidateCache('purchase-orders');
      invalidateCache('inventory');
      toast.success(t('receive.receivedUnits', { count: payload.reduce((s, l) => s + l.quantity, 0) }));
      router.push('/purchase-orders');
    } catch (e) {
      toast.error(errMsg(e));
      setSubmitting(false);
    }
  };

  /* ------------------------------ render ---------------------------------- */

  if (!po) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  /* ---------- Scanner: one product, full screen ---------- */
  if (active) {
    const done = active.serials.length;
    const remaining = active.outstanding - done;
    const tooLong = extractSerial(manual).length > MAX_SERIAL_LEN;

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-3 py-2.5">
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={closeProduct}>
            <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{active.name}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{active.sku}</div>
          </div>
          <Counter done={done} total={active.outstanding} className="text-base" />
        </div>
        <ProgressBar done={done} total={active.outstanding} />

        {/* Camera */}
        <div className="relative shrink-0 bg-black" style={{ height: 'min(42vh, 340px)' }}>
          {/* ZXing decodes the whole frame, so object-contain keeps the preview
              and the decoded picture identical — with object-cover you would be
              aiming at a crop of what is actually being read.
              Kept mounted rather than conditional: the decoder is handed this
              element before the stream resolves. */}
          <video
            ref={videoRef}
            className={cn('h-full w-full object-contain', !scanning && 'invisible')}
            muted
            playsInline
            autoPlay
          />

          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <ScanLine className="h-10 w-10 text-white/70" />
              {cameraError ? (
                <p className="text-sm text-white/80">{cameraError}</p>
              ) : (
                <p className="text-sm text-white/70">{t('receive.cameraIdle')}</p>
              )}
              <Button size="lg" className="h-12 gap-2 px-6" onClick={startCamera}>
                <ScanLine className="h-5 w-5" />
                {t('scan.startCamera')}
              </Button>
            </div>
          )}

          {scanning && (
            <>
              {/* Aiming frame. Pointer-events off so it never eats a tap. */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                {/* Purely an aiming hint — ZXing reads the whole frame, so a
                    label outside these corners still scans. The drop shadow is
                    load-bearing: white-on-white corners vanish against the
                    label itself, which is the surface they sit over most. */}
                <div className="relative aspect-[10/7] w-[85%] drop-shadow-[0_0_2px_rgba(0,0,0,0.85)]">
                  {['-top-px -start-px border-t-4 border-s-4',
                    '-top-px -end-px border-t-4 border-e-4',
                    '-bottom-px -start-px border-b-4 border-s-4',
                    '-bottom-px -end-px border-b-4 border-e-4'].map((pos) => (
                    <span key={pos} className={cn('absolute h-7 w-7 rounded-sm border-white', pos)} />
                  ))}
                </div>
              </div>
              <div className="absolute end-2 top-2 flex flex-col gap-2">
                {torchable && (
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-10 w-10 bg-black/50 text-white hover:bg-black/70"
                    onClick={toggleTorch}
                    title={t('receive.torch')}
                  >
                    {torchOn ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-10 w-10 bg-black/50 text-white hover:bg-black/70"
                  onClick={stopCamera}
                  title={t('scan.stopCamera')}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Candidate + manual entry */}
        <div className="shrink-0 border-b bg-muted/30 px-3 py-3">
          {pending ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 rounded-lg border-2 border-primary bg-background px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t('receive.scanned')}
                </div>
                {/* The extracted serial is what gets stored, so it is the one
                    shown large. The full label stays visible underneath: the
                    operator is the last check that the right digits were
                    pulled out, and they cannot check what they cannot see. */}
                <div className="truncate font-mono text-base font-semibold" dir="ltr">
                  {extractSerial(pending)}
                </div>
                {isLabelPayload(pending) && (
                  <div className="truncate font-mono text-[10px] text-muted-foreground" dir="ltr">
                    {t('receive.fromLabel', { label: pending })}
                  </div>
                )}
              </div>
              <Button variant="outline" size="icon" className="h-12 w-12 shrink-0" onClick={() => setPending('')}>
                <X className="h-5 w-5" />
              </Button>
              <Button
                size="lg"
                className="h-12 shrink-0 gap-1.5 px-5 text-base"
                disabled={checking || remaining <= 0}
                onClick={() => addSerial(pending)}
              >
                {checking ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                {t('common.add')}
              </Button>
            </div>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addSerial(manual);
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Keyboard className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                {/* Deliberately no maxLength: it would silently clip an
                    over-long paste down to 18 characters and accept it, and a
                    truncated serial is a wrong serial in stock. Let the length
                    check reject it out loud instead. */}
                <Input
                  dir="ltr"
                  className={cn('h-12 ps-9 font-mono text-base', tooLong && 'border-destructive focus-visible:ring-destructive')}
                  placeholder={t('receive.typeSerial')}
                  value={manual}
                  autoCapitalize="characters"
                  autoComplete="off"
                  onChange={(e) => setManual(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="h-12 shrink-0 gap-1.5 px-5 text-base"
                disabled={!manual.trim() || tooLong || checking || remaining <= 0}
              >
                {checking ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                {t('common.add')}
              </Button>
            </form>
          )}

          {(tooLong || scanError) && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-xs font-medium text-destructive">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{tooLong ? t('receive.serialTooLong', { max: MAX_SERIAL_LEN }) : scanError}</span>
            </p>
          )}

          <label className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[hsl(var(--primary))]"
              checked={autoAdd}
              onChange={(e) => setAutoAdd(e.target.checked)}
            />
            {t('receive.autoAdd')}
          </label>
        </div>

        {/* Captured list — newest first, so the last scan is under your thumb. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {done === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
              <PackageCheck className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {t('receive.noneYet', { count: active.outstanding })}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {active.serials
                .map((s, i) => ({ s, i }))
                .reverse()
                .map(({ s, i }) => (
                  <li key={`${s}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm" dir="ltr">
                      {s}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeSerial(active.productId, i)}
                      title={t('common.remove')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {/* Thumb-reachable close-out */}
        <div className="shrink-0 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button size="lg" className="h-14 w-full text-base" onClick={closeProduct}>
            {remaining > 0 ? t('receive.doneWithRemaining', { count: remaining }) : t('receive.doneProduct')}
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- Product list ---------- */
  return (
    <div className="pb-28">
      <div className="mb-4 flex items-start gap-3">
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => router.push('/purchase-orders')}>
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{t('orders.receive')}</h1>
          <p className="truncate text-sm text-muted-foreground">
            <span className="font-mono">{po.number}</span> · {po.supplier?.name}
          </p>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-lg border p-10 text-center">
          <PackageCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t('receive.allReceived')}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {lines.map((l) => {
            const done = unitsOf(l);
            const complete = done >= l.outstanding;
            return (
              <li key={l.productId} className="rounded-lg border bg-card">
                {l.trackSerials ? (
                  <button
                    type="button"
                    onClick={() => openProduct(l.productId)}
                    className="flex w-full items-center gap-3 p-3.5 text-start transition-colors hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                        complete ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-primary/10 text-primary',
                      )}
                    >
                      {complete ? <Check className="h-5 w-5" strokeWidth={3} /> : <ScanLine className="h-5 w-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{l.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{l.sku}</span>
                      <span className="mt-2 block">
                        <ProgressBar done={done} total={l.outstanding} />
                      </span>
                    </span>
                    <Counter done={done} total={l.outstanding} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                  </button>
                ) : (
                  /* No serials on this product — a plain count is the honest control. */
                  <div className="flex items-center gap-3 p-3.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{l.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {l.sku} · {t('receive.noSerials')}
                      </span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        disabled={l.qty <= 0}
                        onClick={() => setQty(l.productId, l.qty - 1)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-14 text-center text-base font-semibold tabular-nums">
                        {l.qty}
                        <span className="text-xs font-normal text-muted-foreground">/{l.outstanding}</span>
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        disabled={l.qty >= l.outstanding}
                        onClick={() => setQty(l.productId, l.qty + 1)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Sticky close-out: the running total is the thing you check before committing. */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:start-64">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('receive.toReceive')}
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {totalUnits}
                <span className="text-sm font-normal text-muted-foreground">/{totalOutstanding}</span>
              </div>
            </div>
            <Button
              size="lg"
              className="h-14 shrink-0 gap-2 px-6 text-base"
              disabled={totalUnits === 0 || submitting}
              onClick={submit}
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <PackageCheck className="h-5 w-5" />}
              {t('orders.receive')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
