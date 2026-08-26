import { calcOrderProfit } from './order-profit';

const line = (over: Partial<any> = {}) => ({
  quantity: 1,
  lineTotal: 100,
  product: { costPrice: 60 },
  ...over,
});

describe('calcOrderProfit', () => {
  it('is revenue less cost on a single line', () => {
    const r = calcOrderProfit({ items: [line()] });
    expect(r.revenue).toBe(100);
    expect(r.cost).toBe(60);
    expect(r.profit).toBe(40);
    expect(r.marginPct).toBe(40);
  });

  it('multiplies cost by quantity', () => {
    const r = calcOrderProfit({ items: [line({ quantity: 3, lineTotal: 300 })] });
    expect(r.cost).toBe(180);
    expect(r.profit).toBe(120);
  });

  it('sums across lines', () => {
    const r = calcOrderProfit({
      items: [line(), line({ lineTotal: 50, product: { costPrice: 20 } })],
    });
    expect(r.revenue).toBe(150);
    expect(r.cost).toBe(80);
    expect(r.profit).toBe(70);
  });

  it('applies a percentage order discount to revenue but not to cost', () => {
    const r = calcOrderProfit({ items: [line()], discountType: 'PERCENT', discountValue: 10 });
    expect(r.revenue).toBe(90);
    expect(r.cost).toBe(60);
    expect(r.profit).toBe(30);
  });

  it('applies a fixed order discount', () => {
    const r = calcOrderProfit({ items: [line()], discountType: 'FIXED', discountValue: 25 });
    expect(r.revenue).toBe(75);
    expect(r.profit).toBe(15);
  });

  it('reports a loss when goods are sold below cost', () => {
    const r = calcOrderProfit({ items: [line({ lineTotal: 40 })] });
    expect(r.profit).toBe(-20);
    expect(r.marginPct).toBe(-50);
  });

  it('costs a bundle from its components, scaled by how many bundles sold', () => {
    const r = calcOrderProfit({
      items: [
        {
          quantity: 2,
          lineTotal: 500,
          isComposite: true,
          product: null,
          subItems: [
            { quantity: 1, lineTotal: 200, product: { costPrice: 100 } },
            { quantity: 3, lineTotal: 90, product: { costPrice: 20 } },
          ],
        },
      ],
    });
    // (100*1 + 20*3) = 160 per bundle, two bundles sold.
    expect(r.cost).toBe(320);
    expect(r.revenue).toBe(500);
    expect(r.profit).toBe(180);
  });

  it('flags a priced line that has no product behind it', () => {
    const r = calcOrderProfit({ items: [line(), { quantity: 1, lineTotal: 80, product: null }] });
    expect(r.revenue).toBe(180);
    expect(r.cost).toBe(60);
    expect(r.hasUnknownCost).toBe(true);
    expect(r.unknownCostLines).toBe(1);
  });

  it('does not flag a zero-priced descriptive line', () => {
    const r = calcOrderProfit({ items: [line(), { quantity: 1, lineTotal: 0, product: null }] });
    expect(r.hasUnknownCost).toBe(false);
  });

  it('flags a bundle carrying a priced component with no product', () => {
    const r = calcOrderProfit({
      items: [
        {
          quantity: 1,
          lineTotal: 300,
          isComposite: true,
          product: null,
          subItems: [
            { quantity: 1, lineTotal: 200, product: { costPrice: 100 } },
            { quantity: 1, lineTotal: 50, product: null },
          ],
        },
      ],
    });
    expect(r.cost).toBe(100);
    expect(r.hasUnknownCost).toBe(true);
  });

  it('treats a free order as zero margin rather than dividing by zero', () => {
    const r = calcOrderProfit({ items: [line({ lineTotal: 0, product: { costPrice: 0 } })] });
    expect(r.revenue).toBe(0);
    expect(r.marginPct).toBe(0);
  });

  it('handles an empty order', () => {
    const r = calcOrderProfit({ items: [] });
    expect(r).toMatchObject({ revenue: 0, cost: 0, profit: 0, marginPct: 0, hasUnknownCost: false });
  });

  it('never lets a discount push revenue below zero', () => {
    const r = calcOrderProfit({ items: [line()], discountType: 'FIXED', discountValue: 500 });
    expect(r.revenue).toBe(0);
    expect(r.profit).toBe(-60);
  });

  it('reads Decimal-like values that arrive as strings from Prisma', () => {
    const r = calcOrderProfit({
      items: [{ quantity: '2', lineTotal: '250.50', product: { costPrice: '100.25' } }],
      discountType: 'PERCENT',
      discountValue: '10',
    });
    expect(r.revenue).toBe(225.45);
    expect(r.cost).toBe(200.5);
    expect(r.profit).toBe(24.95);
  });
});
