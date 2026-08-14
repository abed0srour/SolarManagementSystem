import { isUnused, usedBy } from './safe-delete';

describe('usedBy', () => {
  it('keeps only the non-zero counts', () => {
    expect(usedBy({ invoiceItems: 3, orders: 0, claims: 1 })).toEqual({ invoiceItems: 3, claims: 1 });
  });

  it('returns an empty map when nothing references the record', () => {
    expect(usedBy({ invoiceItems: 0, orders: 0 })).toEqual({});
    expect(usedBy({})).toEqual({});
  });
});

describe('isUnused', () => {
  it('is true only when every count is zero', () => {
    expect(isUnused({ invoiceItems: 0, orders: 0 })).toBe(true);
    expect(isUnused({})).toBe(true);
  });

  it('is false when anything references the record', () => {
    expect(isUnused({ invoiceItems: 0, orders: 1 })).toBe(false);
  });

  it('treats a single reference as decisive', () => {
    // The whole point: one invoice line is enough to make a record permanent.
    expect(isUnused({ invoiceItems: 1 })).toBe(false);
  });
});
