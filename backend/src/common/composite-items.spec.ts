import { buildCompositeItems } from './composite-items';

const CATALOGUE = [
  { id: 'p1', name: 'Panel 550W', salePrice: 250, costPrice: 180 },
  { id: 'p2', name: 'Inverter 5kW', salePrice: 1300, costPrice: 900 },
];

/** Just enough Prisma surface for the builder: one `product.findMany`. */
const prisma = {
  product: {
    findMany: async ({ where }: any) => CATALOGUE.filter((p) => where.id.in.includes(p.id)),
  },
};

const build = (items: any[], priceField?: 'salePrice' | 'costPrice') =>
  buildCompositeItems(prisma, items, priceField);

describe('buildCompositeItems', () => {
  it('prices a catalogue line from the product when no price is given', async () => {
    const [line] = await build([{ productId: 'p1', quantity: 2 }]);
    expect(line.unitPrice).toBe(250);
    expect(line.lineTotal).toBe(500);
    expect(line.isComposite).toBe(false);
  });

  it('honours an explicit price override, above or below list', async () => {
    const [up] = await build([{ productId: 'p1', quantity: 1, unitPrice: 300 }]);
    const [down] = await build([{ productId: 'p1', quantity: 1, unitPrice: 200 }]);
    expect(up.unitPrice).toBe(300);
    expect(down.unitPrice).toBe(200);
  });

  it('accepts an explicit zero price, which is not the same as omitting it', async () => {
    const [free] = await build([{ productId: 'p1', quantity: 1, unitPrice: 0 }]);
    expect(free.unitPrice).toBe(0);
  });

  it('prices from cost when asked, for purchase documents', async () => {
    const [line] = await build([{ productId: 'p2', quantity: 1 }], 'costPrice');
    expect(line.unitPrice).toBe(900);
  });

  it('rejects a negative price', async () => {
    await expect(build([{ productId: 'p1', quantity: 1, unitPrice: -5 }])).rejects.toThrow(
      /zero or greater/,
    );
  });

  it('rejects an unknown product', async () => {
    await expect(build([{ productId: 'nope', quantity: 1 }])).rejects.toThrow(/not found/);
  });

  describe('bundles', () => {
    const kit = {
      isComposite: true,
      description: '3kW Kit',
      quantity: 2,
      subItems: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 3 },
      ],
    };

    it('prices the bundle as the sum of its components by default', async () => {
      const [line] = await build([kit]);
      // 2×250 + 3×1300
      expect(line.unitPrice).toBe(4400);
      expect(line.lineTotal).toBe(8800);
    });

    it('carries no product of its own', async () => {
      const [line] = await build([{ ...kit, productId: 'p1' }]);
      expect(line.productId).toBeNull();
    });

    it('snapshots component names from the catalogue', async () => {
      const [line] = await build([kit]);
      expect(line._subItems.map((s) => s.description)).toEqual(['Panel 550W', 'Inverter 5kW']);
    });

    it('keeps a fixed price when autoPrice is off', async () => {
      const [line] = await build([{ ...kit, autoPrice: false, unitPrice: 3520 }]);
      expect(line.unitPrice).toBe(3520);
      expect(line.lineTotal).toBe(7040);
    });

    it('falls back to the given price when no components are supplied', async () => {
      // How an invoice copies an already-priced bundle from an order and
      // attaches the components separately — deriving here would bill zero.
      const [line] = await build([
        { isComposite: true, description: 'Kit', quantity: 1, unitPrice: 4400 },
      ]);
      expect(line.unitPrice).toBe(4400);
    });

    it('applies a line discount on top of the derived price', async () => {
      const [line] = await build([{ ...kit, quantity: 1, discountType: 'PERCENT', discountValue: 10 }]);
      expect(line.lineTotal).toBe(3960);
    });

    it('allows metered component quantities', async () => {
      const [line] = await build([
        { isComposite: true, description: 'Wiring', quantity: 1, subItems: [{ productId: 'p1', quantity: 12.5 }] },
      ]);
      expect(line._subItems[0].quantity).toBe(12.5);
      expect(line.unitPrice).toBe(3125);
    });

    it('requires a name', async () => {
      await expect(build([{ ...kit, description: '  ' }])).rejects.toThrow(/needs a name/);
    });

    it('requires each component to identify a product', async () => {
      await expect(
        build([{ isComposite: true, description: 'Kit', quantity: 1, subItems: [{ quantity: 1 }] }]),
      ).rejects.toThrow(/needs a product/);
    });

    it('rejects a negative component quantity', async () => {
      await expect(
        build([{ isComposite: true, description: 'Kit', quantity: 1, subItems: [{ productId: 'p1', quantity: -1 }] }]),
      ).rejects.toThrow(/zero or greater/);
    });

    it('ignores subItems on a line that is not a bundle', async () => {
      const [line] = await build([{ productId: 'p1', quantity: 1, subItems: [{ productId: 'p2', quantity: 9 }] }]);
      expect(line._subItems).toEqual([]);
      expect(line.unitPrice).toBe(250);
    });
  });
});
