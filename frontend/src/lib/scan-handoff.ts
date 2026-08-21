/**
 * Handoff between the scan screen and the sales-order form.
 *
 * The scanned units travel through sessionStorage rather than the URL: a
 * pallet's worth of serials is far past what a query string should carry, and
 * the payload is single-use scratch that should not survive a tab closing.
 */

export const SCAN_HANDOFF_KEY = 'sms_scan_to_order';

export type ScannedUnit = {
  serialNumber: string;
  productId: string;
  sku: string;
  name: string;
  salePrice: number;
  costPrice: number;
  warehouseId: string | null;
  warehouseName: string | null;
};

/**
 * Read the handoff and clear it in the same breath.
 *
 * Consuming it on read is deliberate: a reload of the order form should not
 * silently re-add lines the user has since deleted.
 */
export function takeScannedUnits(): ScannedUnit[] {
  try {
    const raw = sessionStorage.getItem(SCAN_HANDOFF_KEY);
    if (!raw) return [];
    sessionStorage.removeItem(SCAN_HANDOFF_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScannedUnit[]) : [];
  } catch {
    return [];
  }
}
