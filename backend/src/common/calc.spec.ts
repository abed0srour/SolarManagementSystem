import { applyDiscount, calcDocTotals, calcLine, round2 } from './calc';

describe('round2', () => {
  it('rounds to two decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.344)).toBe(2.34);
    expect(round2(2.345)).toBe(2.35);
  });

  it('rounds the binary-float cases that naive rounding gets wrong', () => {
    // 1.005 is stored as 1.00499999…, so Math.round(1.005 * 100) gives 100.
    // The epsilon in round2 is what makes these come out as a person expects.
    expect(round2(8.615)).toBe(8.62);
    expect(round2(1.0049999999)).toBe(1);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('keeps whole numbers whole', () => {
    expect(round2(100)).toBe(100);
    expect(round2(0)).toBe(0);
  });
});

describe('applyDiscount', () => {
  it('returns the amount untouched with no discount', () => {
    expect(applyDiscount(100, null, 0)).toBe(100);
    expect(applyDiscount(100, 'PERCENT', 0)).toBe(100);
    expect(applyDiscount(100, undefined, 25)).toBe(100);
  });

  it('takes a percentage off', () => {
    expect(applyDiscount(200, 'PERCENT', 10)).toBe(180);
    expect(applyDiscount(99.99, 'PERCENT', 50)).toBeCloseTo(49.995, 5);
  });

  it('takes a fixed amount off', () => {
    expect(applyDiscount(200, 'FIXED', 35)).toBe(165);
  });

  it('never goes below zero', () => {
    // A fixed discount larger than the line must not turn into a credit.
    expect(applyDiscount(50, 'FIXED', 80)).toBe(0);
    expect(applyDiscount(50, 'PERCENT', 150)).toBe(0);
  });

  it('treats a negative discount as a surcharge', () => {
    // The line-items editor sends "+ or − value"; a negative is a markup.
    expect(applyDiscount(100, 'FIXED', -20)).toBe(120);
    expect(applyDiscount(100, 'PERCENT', -10)).toBe(110);
  });
});

describe('calcLine', () => {
  it('multiplies quantity by unit price', () => {
    expect(calcLine({ quantity: 3, unitPrice: 250 })).toEqual({ net: 750, lineTotal: 750 });
  });

  it('handles fractional quantities for metered goods', () => {
    // Cable sold by the metre: 12.5 m at 3.30/m.
    expect(calcLine({ quantity: 12.5, unitPrice: 3.3 }).lineTotal).toBe(41.25);
  });

  it('applies a percent discount to the line', () => {
    expect(calcLine({ quantity: 2, unitPrice: 100, discountType: 'PERCENT', discountValue: 15 }).lineTotal).toBe(170);
  });

  it('applies a fixed discount to the whole line, not per unit', () => {
    expect(calcLine({ quantity: 4, unitPrice: 100, discountType: 'FIXED', discountValue: 50 }).lineTotal).toBe(350);
  });

  it('rounds the line to cents', () => {
    expect(calcLine({ quantity: 3, unitPrice: 33.333 }).lineTotal).toBe(100);
    expect(calcLine({ quantity: 7, unitPrice: 1.234 }).lineTotal).toBe(8.64);
  });

  it('gives zero for a zero quantity', () => {
    expect(calcLine({ quantity: 0, unitPrice: 999 }).lineTotal).toBe(0);
  });
});

describe('calcDocTotals', () => {
  const lines = [calcLine({ quantity: 2, unitPrice: 250 }), calcLine({ quantity: 1, unitPrice: 1300 })];

  it('sums the line nets', () => {
    expect(calcDocTotals(lines)).toEqual({ subtotal: 1800, total: 1800 });
  });

  it('applies the document discount after the line discounts', () => {
    expect(calcDocTotals(lines, 'PERCENT', 10)).toEqual({ subtotal: 1800, total: 1620 });
    expect(calcDocTotals(lines, 'FIXED', 300)).toEqual({ subtotal: 1800, total: 1500 });
  });

  it('adds shipping after the discount, so shipping is never discounted', () => {
    expect(calcDocTotals(lines, 'PERCENT', 10, 50)).toEqual({ subtotal: 1800, total: 1670 });
  });

  it('still charges shipping when the discount wipes out the goods', () => {
    expect(calcDocTotals(lines, 'FIXED', 5000, 40)).toEqual({ subtotal: 1800, total: 40 });
  });

  it('handles an empty document', () => {
    expect(calcDocTotals([])).toEqual({ subtotal: 0, total: 0 });
  });

  it('accumulates rounding at the line level, not the document level', () => {
    // Three lines of 0.335 each: rounding per line (0.34 × 3 = 1.02) is the
    // documented behaviour, because each line total is what the customer sees
    // printed. Summing raw and rounding once would give 1.01 and the invoice
    // would not add up on paper.
    const odd = [1, 1, 1].map(() => calcLine({ quantity: 1, unitPrice: 0.335 }));
    expect(calcDocTotals(odd).subtotal).toBe(1.02);
  });
});
