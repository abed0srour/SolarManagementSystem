import { describeSerialMismatches, serialMismatches } from './serial-requirements';

const tracked = (over: Partial<any> = {}) => ({
  productId: 'inverter',
  quantity: 1,
  product: { name: 'Inverter Felicity 8kW', isService: false, trackSerials: true, requireSerialOnSale: true },
  ...over,
});

describe('serialMismatches', () => {
  it('passes when every required serial is given', () => {
    expect(serialMismatches([tracked()], [{ productId: 'inverter', serialNumbers: ['SN1'] }])).toEqual([]);
  });

  it('catches a tracked item given no serials at all', () => {
    expect(serialMismatches([tracked()], [])).toEqual([
      { productId: 'inverter', name: 'Inverter Felicity 8kW', required: 1, provided: 0 },
    ]);
  });

  it('catches the real case: serials for one product, none for another', () => {
    const items = [
      tracked({ productId: 'battery', quantity: 2, product: { name: 'Battery', isService: false, trackSerials: true, requireSerialOnSale: true } }),
      tracked(),
    ];
    const result = serialMismatches(items, [{ productId: 'battery', serialNumbers: ['B1', 'B2'] }]);
    expect(result).toEqual([{ productId: 'inverter', name: 'Inverter Felicity 8kW', required: 1, provided: 0 }]);
  });

  it('catches too few serials for the quantity', () => {
    const result = serialMismatches([tracked({ quantity: 3 })], [{ productId: 'inverter', serialNumbers: ['A', 'B'] }]);
    expect(result[0]).toMatchObject({ required: 3, provided: 2 });
  });

  it('catches more serials than the quantity', () => {
    const result = serialMismatches([tracked()], [{ productId: 'inverter', serialNumbers: ['A', 'B'] }]);
    expect(result[0]).toMatchObject({ required: 1, provided: 2 });
  });

  it('counts a repeated serial once, so duplicates cannot pad the total', () => {
    const result = serialMismatches([tracked({ quantity: 2 })], [{ productId: 'inverter', serialNumbers: ['A', 'A'] }]);
    expect(result[0]).toMatchObject({ required: 2, provided: 1 });
  });

  it('ignores blank entries', () => {
    const result = serialMismatches([tracked()], [{ productId: 'inverter', serialNumbers: ['   ', 'A'] }]);
    expect(result).toEqual([]);
  });

  it('sums the same product appearing on two lines', () => {
    const items = [tracked({ quantity: 1 }), tracked({ quantity: 2 })];
    const result = serialMismatches(items, [{ productId: 'inverter', serialNumbers: ['A', 'B', 'C'] }]);
    expect(result).toEqual([]);
  });

  it('leaves untracked products alone', () => {
    const item = tracked({
      product: { name: 'Cable', isService: false, trackSerials: false, requireSerialOnSale: false },
    });
    expect(serialMismatches([item], [])).toEqual([]);
  });

  it('leaves a product tracked but not required at sale alone', () => {
    const item = tracked({
      product: { name: 'Panel', isService: false, trackSerials: true, requireSerialOnSale: false },
    });
    expect(serialMismatches([item], [])).toEqual([]);
  });

  it('skips services, which carry no units', () => {
    const item = tracked({
      product: { name: 'Installation', isService: true, trackSerials: true, requireSerialOnSale: true },
    });
    expect(serialMismatches([item], [])).toEqual([]);
  });

  it('skips bundle headers, whose components are checked separately', () => {
    expect(serialMismatches([tracked({ isComposite: true })], [])).toEqual([]);
  });

  it('skips lines with no product behind them', () => {
    expect(serialMismatches([tracked({ productId: null })], [])).toEqual([]);
  });

  it('reads a Decimal quantity arriving as a string', () => {
    const result = serialMismatches([tracked({ quantity: '2' })], [{ productId: 'inverter', serialNumbers: ['A'] }]);
    expect(result[0]).toMatchObject({ required: 2, provided: 1 });
  });
});

describe('describeSerialMismatches', () => {
  it('names the product and both counts', () => {
    const message = describeSerialMismatches([
      { productId: 'inverter', name: 'Inverter Felicity 8kW', required: 1, provided: 0 },
    ]);
    expect(message).toContain('Inverter Felicity 8kW');
    expect(message).toContain('needs 1 serial number');
    expect(message).toContain('0 were given');
  });

  it('lists every product that is short', () => {
    const message = describeSerialMismatches([
      { productId: 'a', name: 'Inverter', required: 1, provided: 0 },
      { productId: 'b', name: 'Battery', required: 2, provided: 1 },
    ]);
    expect(message).toContain('Inverter');
    expect(message).toContain('Battery');
  });
});
