import { buildSkuPrefix, formatSku, nextSkuSequence, skuCode } from './sku';

describe('skuCode', () => {
  it('takes the opening letters of a single word', () => {
    expect(skuCode('Inverters', 3)).toBe('INV');
  });

  it('takes initials when there are several words', () => {
    expect(skuCode('Lead Acid Batteries', 3)).toBe('LAB');
    expect(skuCode('Solar Panels', 3)).toBe('SP');
  });

  it('distinguishes categories that share a first word', () => {
    expect(skuCode('Lead Acid Batteries', 3)).not.toBe(skuCode('Lithium Batteries', 3));
  });

  it('drops punctuation and spacing', () => {
    expect(skuCode('  Off-Grid   Inverters ', 3)).toBe('OI');
  });

  it('is empty when nothing Latin survives', () => {
    expect(skuCode('ألواح شمسية', 3)).toBe('');
    expect(skuCode('', 3)).toBe('');
    expect(skuCode(null, 3)).toBe('');
    expect(skuCode(undefined, 3)).toBe('');
  });

  it('respects the length cap', () => {
    expect(skuCode('Batteries', 3)).toBe('BAT');
    expect(skuCode('Batteries', 6)).toBe('BATTER');
  });
});

describe('buildSkuPrefix', () => {
  it('joins category, brand and model', () => {
    expect(buildSkuPrefix({ category: 'Panels', brand: 'Jinko', model: 'JKM550M' })).toBe('PAN-JIN-JKM550');
  });

  it('omits the parts that are missing', () => {
    expect(buildSkuPrefix({ category: 'Batteries', brand: 'Victron' })).toBe('BAT-VIC');
    expect(buildSkuPrefix({ brand: 'Victron' })).toBe('VIC');
    expect(buildSkuPrefix({ category: 'Batteries' })).toBe('BAT');
  });

  it('keeps a model in its own order rather than initialising it', () => {
    expect(buildSkuPrefix({ model: 'JKM 550M-72' })).toBe('JKM550');
  });

  it('is empty when there is nothing to work from', () => {
    expect(buildSkuPrefix({})).toBe('');
    expect(buildSkuPrefix({ category: 'ألواح', brand: '' })).toBe('');
  });

  it('produces only characters a variant SKU can be built on', () => {
    const prefix = buildSkuPrefix({ category: 'Off-Grid Inverters', brand: "O'Brien", model: 'X/2000' });
    expect(prefix).toMatch(/^[A-Z0-9-]+$/);
  });
});

describe('nextSkuSequence', () => {
  it('starts at one when the prefix is unused', () => {
    expect(nextSkuSequence([], 'PAN-JIN')).toBe(1);
    expect(nextSkuSequence(['BAT-VIC-0001'], 'PAN-JIN')).toBe(1);
  });

  it('continues from the highest number in use', () => {
    expect(nextSkuSequence(['PAN-JIN-0001', 'PAN-JIN-0007', 'PAN-JIN-0003'], 'PAN-JIN')).toBe(8);
  });

  it('counts from the highest, not the count, so a deletion never reissues a number', () => {
    expect(nextSkuSequence(['PAN-JIN-0001', 'PAN-JIN-0009'], 'PAN-JIN')).toBe(10);
  });

  it('ignores SKUs that merely start the same way', () => {
    expect(nextSkuSequence(['PAN-JIN-0004-RED', 'PAN-JINKO-0009', 'PAN-JIN-0002'], 'PAN-JIN')).toBe(3);
  });

  it('is unaffected by regex characters in the prefix', () => {
    expect(nextSkuSequence(['A.B-0005'], 'A.B')).toBe(6);
    expect(nextSkuSequence(['AXB-0005'], 'A.B')).toBe(1);
  });
});

describe('formatSku', () => {
  it('pads the counter to four digits', () => {
    expect(formatSku('PAN-JIN', 7)).toBe('PAN-JIN-0007');
    expect(formatSku('PAN-JIN', 1234)).toBe('PAN-JIN-1234');
  });

  it('does not truncate once past four digits', () => {
    expect(formatSku('PAN-JIN', 12345)).toBe('PAN-JIN-12345');
  });
});
