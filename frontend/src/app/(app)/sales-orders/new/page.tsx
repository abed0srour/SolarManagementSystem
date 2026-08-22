'use client';
import { ShoppingCart as PageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../../components/page-header';
import SalesOrderForm from '../../../../components/sales-order-form';
import type { LineItem } from '../../../../components/line-items-editor';
import { takeScannedUnits, type ScannedUnit } from '../../../../lib/scan-handoff';
import { Skeleton } from '../../../../components/ui/skeleton';

/** Units collapse into one line per product, priced at the product's list price. */
function linesFromUnits(units: ScannedUnit[]): LineItem[] {
  const byProduct = new Map<string, LineItem>();
  for (const u of units) {
    const line = byProduct.get(u.productId);
    if (line) {
      line.quantity = Number(line.quantity || 0) + 1;
      continue;
    }
    byProduct.set(u.productId, {
      // The editor needs enough of the product to render it and to price it.
      product: { id: u.productId, sku: u.sku, name: u.name, salePrice: u.salePrice, costPrice: u.costPrice },
      quantity: 1,
      unitPrice: u.salePrice,
      basePrice: u.salePrice,
      costPrice: u.costPrice,
    });
  }
  return [...byProduct.values()];
}

export default function NewSalesOrderPage() {
  const t = useTranslations();
  const [initialLines, setInitialLines] = useState<LineItem[] | null>(null);
  /**
   * The handoff is destroyed as it is read, so this must happen exactly once.
   * StrictMode runs effects twice in development: the first pass consumed the
   * scanned units, the second found an empty store and overwrote the lines
   * with nothing — which is why the form arrived blank.
   */
  const consumedRef = useRef(false);

  /*
   * The flag is read straight off the URL rather than through
   * useSearchParams, which returns an empty set on the first client render and
   * fills in after. An effect keyed on it fired once with `from=scan` missing,
   * mounting the form before the handoff had been read.
   */
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const fromScan = new URLSearchParams(window.location.search).get('from') === 'scan';
    setInitialLines(fromScan ? linesFromUnits(takeScannedUnits()) : []);
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('orders.newSalesOrder')} subtitle={t('subtitles.salesOrders')} />
      {initialLines === null ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <SalesOrderForm initialLines={initialLines} />
      )}
    </div>
  );
}
