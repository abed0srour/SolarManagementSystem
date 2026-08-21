'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ScanLine, X, Zap, ZapOff } from 'lucide-react';
import { extractSerial } from '../lib/serial';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

/**
 * Camera scanner for QR and 1D barcodes.
 *
 * ZXing rather than html5-qrcode: the latter reads QR fine but does not decode
 * a Code 128 strip in practice, and its native-BarcodeDetector escape hatch is
 * absent on iOS. Verified by feeding Chrome a fake camera showing a generated
 * barcode — html5-qrcode saw nothing, ZXing decoded first try.
 *
 * The decoder is loaded on demand, so it stays out of the main bundle for the
 * pages that never open a camera.
 */
export default function BarcodeScanner({
  onDecode,
  height = 'min(42vh, 340px)',
  className,
  /** Unwrap supplier label records into the bare serial before reporting. */
  extract = true,
}: {
  onDecode: (value: string) => void;
  height?: string;
  className?: string;
  extract?: boolean;
}) {
  const t = useTranslations();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchable, setTorchable] = useState(false);
  const controlsRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /*
   * ZXing keeps the callback handed to it for the whole scan, so a plain
   * closure would freeze whatever state the caller had when the camera
   * started. Going through a ref keeps every decode on the current handler.
   */
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;

  const stop = useCallback(() => {
    const controls = controlsRef.current;
    controlsRef.current = null;
    setScanning(false);
    setTorchOn(false);
    setTorchable(false);
    try {
      controls?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setScanning(true);
    try {
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);

      const hints = new Map();
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
      // A label is usually read at an angle; the extra work per frame is worth it.
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
      const video = videoRef.current;
      if (!video) throw new Error('viewfinder not mounted');

      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        video,
        (result) => {
          if (!result) return; // an empty frame is the normal case
          const raw = result.getText().trim();
          if (!raw) return;
          onDecodeRef.current(extract ? extractSerial(raw) : raw);
        },
      );
      controlsRef.current = controls;
      setTorchable(Boolean(controls.switchTorch));
    } catch (e: any) {
      setScanning(false);
      setError(
        e?.message?.includes('Permission') || e?.name === 'NotAllowedError'
          ? t('scan.cameraDenied')
          : t('scan.cameraUnavailable'),
      );
    }
  }, [t, extract]);

  // Releasing the camera on unmount matters: a lit LED after navigation reads
  // as the app still recording.
  useEffect(() => () => stop(), [stop]);

  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-black', className)} style={{ height }}>
      {/* Kept mounted: the decoder is handed this element before the stream resolves. */}
      <video
        ref={videoRef}
        className={cn('h-full w-full object-contain', !scanning && 'invisible')}
        muted
        playsInline
        autoPlay
      />

      {!scanning ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <ScanLine className="h-9 w-9 text-white/70" />
          <p className="text-sm text-white/75">{error ?? t('receive.cameraIdle')}</p>
          <Button size="lg" className="h-12 gap-2 px-6" onClick={start}>
            <ScanLine className="h-5 w-5" />
            {t('scan.startCamera')}
          </Button>
        </div>
      ) : (
        <>
          {/* Aiming hint only — the whole frame is decoded. The shadow keeps the
              corners visible against the white label they sit over. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
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
                title={t('receive.torch')}
                onClick={async () => {
                  try {
                    await controlsRef.current?.switchTorch?.(!torchOn);
                    setTorchOn((v) => !v);
                  } catch {
                    /* torch refused; leave the state alone */
                  }
                }}
              >
                {torchOn ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
              </Button>
            )}
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10 bg-black/50 text-white hover:bg-black/70"
              title={t('scan.stopCamera')}
              onClick={stop}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
