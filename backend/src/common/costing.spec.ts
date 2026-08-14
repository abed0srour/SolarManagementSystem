import { applyWeightedAverageCost } from './costing';

/**
 * A fake transaction client holding one product and one aggregate stock figure,
 * recording what the function writes.
 */
function makeTx(costPrice: number | null, onHand: number) {
  const writes: { product?: any; history?: any } = {};
  return {
    writes,
    tx: {
      product: {
        findUnique: async () => (costPrice === null ? null : { costPrice }),
        update: async ({ data }: any) => {
          writes.product = data;
        },
      },
      stockLevel: {
        aggregate: async () => ({ _sum: { quantity: onHand } }),
      },
      priceHistory: {
        create: async ({ data }: any) => {
          writes.history = data;
        },
      },
    } as any,
  };
}

const run = (tx: any, receivedQty: number, receivedUnitCost: number, extra: any = {}) =>
  applyWeightedAverageCost(tx, {
    productId: 'p1',
    receivedQty,
    receivedUnitCost,
    userId: 'u1',
    source: 'PO-00001',
    ...extra,
  });

describe('applyWeightedAverageCost', () => {
  it('averages the new cost against what is already on hand', () => {
    // 4 @ 730 + 10 @ 1467 = 17590 / 14
    const { tx, writes } = makeTx(730, 4);
    return run(tx, 10, 1467).then(() => {
      expect(writes.product.costPrice).toBe(1256.43);
    });
  });

  it('adopts the received cost outright when nothing is on hand', async () => {
    const { tx, writes } = makeTx(0, 0);
    await run(tx, 5, 300);
    expect(writes.product.costPrice).toBe(300);
  });

  it('barely moves the average when the delivery is small next to stock', async () => {
    const { tx, writes } = makeTx(100, 1000);
    await run(tx, 1, 200);
    expect(writes.product.costPrice).toBe(100.1);
  });

  it('folds per-unit delivery cost into the received cost via the caller', async () => {
    // The caller adds freight before calling; this checks it is not double-counted.
    const { tx, writes } = makeTx(100, 10);
    await run(tx, 10, 110, { deliveryCostPerUnit: 10 });
    expect(writes.product.costPrice).toBe(105);
    expect(writes.history.reason).toContain('incl. 10/unit delivery');
  });

  it('writes an audit trail naming the source and both sides of the average', async () => {
    const { tx, writes } = makeTx(730, 4);
    await run(tx, 10, 1467);
    expect(writes.history).toMatchObject({
      productId: 'p1',
      oldCostPrice: 730,
      newCostPrice: 1256.43,
      changedById: 'u1',
    });
    expect(writes.history.reason).toContain('PO-00001');
    expect(writes.history.reason).toContain('4 on hand @ 730');
    expect(writes.history.reason).toContain('10 received @ 1467');
  });

  it('writes nothing when the cost does not actually change', async () => {
    // Receiving at exactly the current cost must not spam price history.
    const { tx, writes } = makeTx(500, 10);
    await run(tx, 5, 500);
    expect(writes.product).toBeUndefined();
    expect(writes.history).toBeUndefined();
  });

  it('ignores a zero or negative received quantity', async () => {
    const { tx, writes } = makeTx(500, 10);
    await run(tx, 0, 999);
    await run(tx, -3, 999);
    expect(writes.product).toBeUndefined();
  });

  it('does nothing when the product is gone', async () => {
    const { tx, writes } = makeTx(null, 10);
    await run(tx, 5, 100);
    expect(writes.product).toBeUndefined();
  });

  it('treats negative on-hand as empty rather than reversing the average', async () => {
    // Stock should never go negative, but if data drift made it so, the cost
    // must not be computed from a negative weight.
    const { tx, writes } = makeTx(100, -5);
    await run(tx, 10, 200);
    expect(writes.product.costPrice).toBe(200);
  });
});
