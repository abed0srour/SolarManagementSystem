export type DiscountType = 'PERCENT' | 'FIXED' | null | undefined;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function applyDiscount(amount: number, type: DiscountType, value: number): number {
  if (!type || !value) return amount;
  const discounted = type === 'PERCENT' ? amount - (amount * value) / 100 : amount - value;
  return Math.max(0, discounted);
}

export interface LineInput {
  quantity: number;
  unitPrice: number;
  discountType?: DiscountType;
  discountValue?: number;
  taxRatePct?: number;
}

export interface LineTotals {
  net: number;
  tax: number;
  lineTotal: number;
}

/** gross = qty*price; net = gross - line discount; tax = net * rate; lineTotal = net + tax */
export function calcLine(l: LineInput): LineTotals {
  const gross = l.quantity * l.unitPrice;
  const net = applyDiscount(gross, l.discountType, l.discountValue ?? 0);
  const tax = (net * (l.taxRatePct ?? 0)) / 100;
  return { net: round2(net), tax: round2(tax), lineTotal: round2(net + tax) };
}

/** subtotal = sum of line nets; total = (subtotal - doc discount) + tax + shipping */
export function calcDocTotals(
  lines: LineTotals[],
  docDiscountType?: DiscountType,
  docDiscountValue?: number,
  shippingFee = 0,
) {
  const subtotal = round2(lines.reduce((s, l) => s + l.net, 0));
  const taxAmount = round2(lines.reduce((s, l) => s + l.tax, 0));
  const afterDiscount = applyDiscount(subtotal, docDiscountType, docDiscountValue ?? 0);
  const total = round2(afterDiscount + taxAmount + shippingFee);
  return { subtotal, taxAmount, total };
}
