'use client';

import { use, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { api, fmtMoney, fmtDateTime } from '../../../../../lib/api';
import { useLocalFirstData } from '../../../../../lib/use-local-storage-cache';
import { Button } from '../../../../../components/ui/button';
import { Skeleton } from '../../../../../components/ui/skeleton';

/**
 * POS receipt sized for an 80 mm thermal roll.
 *
 * Rendered as HTML rather than a PDF on purpose: thermal printers are driven
 * through the browser's print dialog, and HTML reflows to whatever roll width
 * the driver reports. `print:` utilities strip the app chrome so only the
 * receipt reaches the paper.
 *
 * The layout is deliberately LTR and monospaced even in Arabic — receipt
 * printers render a fixed-width Latin font, and mirroring the columns puts the
 * totals on the wrong edge of the paper.
 */
export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations();
  const { id } = use(params);

  const { data: order } = useLocalFirstData<any>(`sales-orders:receipt:${id}`, () =>
    api.get(`/sales-orders/${id}`).then((r) => r.data),
  );
  const { data: settings } = useLocalFirstData<any>('settings', () => api.get('/settings').then((r) => r.data));

  /*
   * The QR is minted per print, not cached: the token inside it expires after
   * 24h, so a cached image would print an already-dead code. Rendered to a data
   * URL locally, which also means the receipt needs no network at print time.
   */
  const [qr, setQr] = useState<string>('');
  const [expiresLabel, setExpiresLabel] = useState('');

  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    api
      .get(`/sales-orders/${order.id}/pickup-token`)
      .then(async ({ data }) => {
        if (cancelled) return;
        const url = await QRCode.toDataURL(data.token, {
          // The token is ~50 chars, so even at M this is a coarse grid — which
          // is what lets it print small and still scan.
          errorCorrectionLevel: 'M',
          margin: 1,
          // Thermal heads are 1-bit: pure black on white scans far better than
          // anything anti-aliased or grey.
          color: { dark: '#000000', light: '#FFFFFF' },
          width: 320,
        });
        if (cancelled) return;
        setQr(url);
        setExpiresLabel(fmtDateTime(data.expiresAt));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [order]);

  // Nudge the print dialog open when arrived at with ?print=1 (the button on
  // the order page does this), so issuing a receipt is one click. Waits for the
  // QR so the code is on the paper, not a blank box.
  useEffect(() => {
    if (order && qr && new URLSearchParams(window.location.search).get('print') === '1') {
      const timer = setTimeout(() => window.print(), 300);
      return () => clearTimeout(timer);
    }
  }, [order, qr]);

  if (!order) return <Skeleton className="mx-auto h-96 w-80" />;

  const company = settings?.company ?? {};
  const rule = <div className="my-1.5 border-t border-dashed border-black/50" />;
  const money = (n: any) => Number(n).toFixed(2);

  return (
    <div className="space-y-4">
      {/*
        `@page` is document-level, so declaring it here scopes it to this route.
        size 80mm + zero margin is what makes the browser stop reserving A4
        margins — and with no margin Chrome also drops its own header/footer,
        which is what was printing the URL and timestamp across the top.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }

  /*
   * A long order runs onto a second page on a sheet printer (a thermal roll
   * just keeps feeding). These keep the pieces that must be read together from
   * being sliced in half by a page break — above all the QR, which is useless
   * cut across the middle.
   */
  .receipt-keep { break-inside: avoid; page-break-inside: avoid; }
  .receipt-item { break-inside: avoid; page-break-inside: avoid; }
}`,
        }}
      />

      <div className="no-print flex justify-center gap-2">
        <Button onClick={() => window.print()}>
          <Printer /> {t('common.print')}
        </Button>
      </div>

      {/*
        A fixed 80 mm column, on screen and on paper alike. It previously went
        full-width when printing, which stretched every row across the sheet.
      */}
      <div
        dir="ltr"
        className="mx-auto w-[80mm] bg-white px-3 py-4 font-mono text-[11px] leading-snug text-black shadow-sm print:shadow-none"
      >
        {/*
          Store identity, straight from Settings → Company. Every line is
          omitted when blank, so a half-filled configuration prints tidily
          rather than leaving gaps or stray labels on the paper.
        */}
        <div className="space-y-0.5 text-center">
          {company.logoUrl && (
            // Thermal printers dither to 1-bit, so keep it small and let the
            // driver handle it. eslint: next/image cannot size a data/remote
            // logo here, and the print pipeline wants a plain <img>.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="" className="mx-auto mb-1 h-12 w-auto max-w-[40mm] object-contain" />
          )}
          <div className="text-[15px] font-bold uppercase tracking-[0.15em]">{company.name || 'Solar Store'}</div>
          {company.tagline && <div className="text-[10px] text-black/70">{company.tagline}</div>}
          {company.address && <div className="whitespace-pre-wrap text-[10px] leading-snug">{company.address}</div>}
          {company.phone && <div className="text-[10px]" dir="ltr">Tel: {company.phone}</div>}
          {company.email && <div className="text-[10px]" dir="ltr">{company.email}</div>}
          {company.taxNumber && <div className="text-[10px]">VAT: {company.taxNumber}</div>}
        </div>

        <div className="mt-2 text-center text-[10px] font-bold uppercase tracking-[0.2em]">Sales Receipt</div>

        {rule}

        {/* Meta: labels muted so the values carry the eye. */}
        <div className="space-y-0.5">
          {[
            ['Order', order.number],
            ['Date', fmtDateTime(order.orderDate)],
            ['Client', order.client?.name],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between gap-2">
              <span className="shrink-0 text-black/60">{label}</span>
              <span className="truncate text-end font-semibold">{value as string}</span>
            </div>
          ))}
        </div>

        {rule}

        {/* Items. Bundles print as one line; the pick-list detail is internal. */}
        <div className="space-y-1.5">
          {order.items?.map((i: any) => (
            <div key={i.id} className="receipt-item">
              <div className="font-semibold break-words">{i.description ?? i.product?.name}</div>
              <div className="flex justify-between text-black/70">
                <span>{Number(i.quantity)} × {money(i.unitPrice)}</span>
                <span className="font-semibold text-black">{money(i.lineTotal)}</span>
              </div>
            </div>
          ))}
        </div>

        {rule}

        <div className="space-y-0.5">
          <div className="flex justify-between"><span className="text-black/60">Subtotal</span><span>{money(order.subtotal)}</span></div>
          {Number(order.discountValue) > 0 && (
            <div className="flex justify-between"><span className="text-black/60">Discount</span><span>−{money(order.discountValue)}</span></div>
          )}
          {Number(order.shippingFee) > 0 && (
            <div className="flex justify-between"><span className="text-black/60">Shipping</span><span>{money(order.shippingFee)}</span></div>
          )}
        </div>

        {/* Total: the one thing a customer checks, so it gets its own rules. */}
        <div className="receipt-keep my-1.5 border-y-2 border-black py-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-bold uppercase tracking-wider">Total</span>
            <span className="text-[15px] font-bold">{fmtMoney(order.total)}</span>
          </div>
        </div>

        {Number(order.paidAmount) > 0 && (
          <div className="space-y-0.5">
            <div className="flex justify-between"><span className="text-black/60">Paid</span><span>{money(order.paidAmount)}</span></div>
            <div className="flex justify-between font-bold">
              <span>Balance due</span><span>{money(order.outstanding)}</span>
            </div>
          </div>
        )}

        {/*
          The whole point of the receipt. The QR carries a signed token that
          only this system can produce, so the warehouse can trust a scan
          without looking anything up by hand. The short code stays printed
          underneath as the fallback for a dead scanner or a smudged label.
        */}
        {qr && (
          <div className="receipt-keep mt-3 border-2 border-black">
            <div className="border-b border-dashed border-black/50 bg-black/[0.04] py-1 text-center text-[9px] font-bold uppercase tracking-[0.2em]">
              Collection QR
            </div>
            <div className="px-2 py-1.5 text-center">
              {/*
                Size is set inline, not via a Tailwind arbitrary class: this has
                to be exact on paper, and an inline length cannot be dropped by
                a purge or overridden by a later utility.

                18 mm is about the floor for this data density — the token is 51
                characters, so the grid is 33×33 and each module lands near
                0.5 mm, roughly four dots on a 203 dpi thermal head. Smaller and
                the modules start merging and phones stop decoding it.

                `pixelated` matters too: scaling a bitmap QR down with smooth
                interpolation blurs module edges into grey, which is what a
                1-bit print head copes worst with.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr}
                alt="Collection QR code"
                className="mx-auto"
                style={{ width: '18mm', height: '18mm', imageRendering: 'pixelated' }}
              />
              <div className="mt-1 text-[9px] leading-snug text-black/70">
                Scan at the warehouse to collect your order.
                <br />
                Valid until {expiresLabel}.
              </div>
            </div>
          </div>
        )}

        {order.claimedAt && (
          <div className="mt-2 border border-black/60 py-1 text-center text-[10px] font-bold uppercase tracking-wider">
            Collected {fmtDateTime(order.claimedAt)}
          </div>
        )}

        {rule}

        {/* Footer: how to reach the store, since the receipt is what a customer
            brings back with a question or a return. */}
        <div className="space-y-0.5 text-center text-[10px] leading-snug">
          <div className="font-semibold">Thank you for your business</div>
          {(company.phone || company.email) && (
            <div className="text-black/70" dir="ltr">{[company.phone, company.email].filter(Boolean).join('  •  ')}</div>
          )}
          {order.createdBy?.name && (
            <div className="text-[9px] text-black/60">Served by {order.createdBy.name}</div>
          )}
        </div>

        {/* Tear-off whitespace: thermal cutters need a margin below the text. */}
        <div className="h-6" />
      </div>
    </div>
  );
}
