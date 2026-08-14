import { expandRevenueLines } from './revenue';

/** Minimal stand-ins for the Prisma rows the reports load. */
const product = (sku: string) => ({ sku });

const plain = (sku: string, quantity: number, lineTotal: number) => ({
  product: product(sku),
  quantity,
  lineTotal,
  isComposite: false,
});

const bundle = (
  quantity: number,
  lineTotal: number,
  subs: { sku: string; quantity: number; lineTotal: number }[],
) => ({
  product: null,
  quantity,
  lineTotal,
  isComposite: true,
  subItems: subs.map((s) => ({ product: product(s.sku), quantity: s.quantity, lineTotal: s.lineTotal })),
});

describe('expandRevenueLines', () => {
  it('passes plain lines through untouched', () => {
    expect(expandRevenueLines([plain('PANEL', 3, 750)])).toEqual([
      { product: { sku: 'PANEL' }, quantity: 3, revenue: 750 },
    ]);
  });

  it('drops lines with no product, which have no SKU to report against', () => {
    const adHoc = { product: null, quantity: 1, lineTotal: 500, isComposite: false };
    expect(expandRevenueLines([adHoc])).toEqual([]);
  });

  it('splits a bundle across its components pro-rata to their value', () => {
    // Components list at 500 + 3900 = 4400 and the bundle is sold at list.
    const out = expandRevenueLines([
      bundle(1, 4400, [
        { sku: 'PANEL', quantity: 2, lineTotal: 500 },
        { sku: 'INVERTER', quantity: 3, lineTotal: 3900 },
      ]),
    ]);
    expect(out).toEqual([
      { product: { sku: 'PANEL' }, quantity: 2, revenue: 500 },
      { product: { sku: 'INVERTER' }, quantity: 3, revenue: 3900 },
    ]);
  });

  it('apportions a discounted bundle so the parts add up to what was charged', () => {
    // Same bundle sold at 20% off: 3520 rather than the 4400 it lists at.
    const out = expandRevenueLines([
      bundle(1, 3520, [
        { sku: 'PANEL', quantity: 2, lineTotal: 500 },
        { sku: 'INVERTER', quantity: 3, lineTotal: 3900 },
      ]),
    ]);
    expect(out.map((l) => l.revenue)).toEqual([400, 3120]);
    expect(out.reduce((s, l) => s + l.revenue, 0)).toBe(3520);
  });

  it('multiplies component quantities by the bundle quantity', () => {
    // Two kits sold means twice the panels left the building.
    const out = expandRevenueLines([
      bundle(2, 8800, [
        { sku: 'PANEL', quantity: 2, lineTotal: 500 },
        { sku: 'INVERTER', quantity: 3, lineTotal: 3900 },
      ]),
    ]);
    expect(out.map((l) => l.quantity)).toEqual([4, 6]);
  });

  it('never loses a cent to rounding', () => {
    // 100 split three ways is 33.33 + 33.33 + 33.34, not 99.99.
    const out = expandRevenueLines([
      bundle(1, 100, [
        { sku: 'A', quantity: 1, lineTotal: 10 },
        { sku: 'B', quantity: 1, lineTotal: 10 },
        { sku: 'C', quantity: 1, lineTotal: 10 },
      ]),
    ]);
    expect(out.reduce((s, l) => s + l.revenue, 0)).toBe(100);
    expect(out.map((l) => l.revenue)).toEqual([33.33, 33.33, 33.34]);
  });

  it('splits evenly when every component is priced at zero', () => {
    // No value ratio to weight by, so an equal split is the only sane answer.
    const out = expandRevenueLines([
      bundle(1, 90, [
        { sku: 'A', quantity: 1, lineTotal: 0 },
        { sku: 'B', quantity: 1, lineTotal: 0 },
      ]),
    ]);
    expect(out.map((l) => l.revenue)).toEqual([45, 45]);
  });

  it('ignores a bundle with no components rather than inventing revenue', () => {
    expect(expandRevenueLines([bundle(1, 500, [])])).toEqual([]);
  });

  it('handles a document mixing plain lines and bundles', () => {
    const out = expandRevenueLines([
      plain('CABLE', 10, 33),
      bundle(1, 200, [
        { sku: 'A', quantity: 1, lineTotal: 100 },
        { sku: 'B', quantity: 1, lineTotal: 100 },
      ]),
    ]);
    expect(out).toHaveLength(3);
    expect(out.reduce((s, l) => s + l.revenue, 0)).toBe(233);
  });
});
