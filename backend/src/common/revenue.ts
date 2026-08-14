import { round2 } from './calc';

/**
 * One product's share of a document line, ready to be aggregated into a report.
 */
export interface RevenueLine<P> {
  product: P;
  quantity: number;
  revenue: number;
}

interface ExpandableSub<P> {
  product: P | null;
  quantity: unknown;
  lineTotal: unknown;
}

interface ExpandableLine<P> extends ExpandableSub<P> {
  isComposite: boolean;
  subItems?: ExpandableSub<P>[];
}

/**
 * Turn document lines into per-product revenue, splitting bundles across their
 * components.
 *
 * A bundle is sold as one line: the customer is charged the header's price, and
 * the components carry only their own list prices. Reporting on the components
 * directly would therefore invent revenue whenever the bundle was discounted or
 * marked up — the parts would total something the customer never paid, and the
 * category and top-product charts would disagree with the headline revenue
 * taken from invoice totals.
 *
 * So the header's actual charged amount is apportioned across its components
 * pro-rata to their list value, which is the standard treatment for a bundled
 * sale. A bundle whose components are all priced at zero splits evenly, since
 * there is no value ratio to weight by.
 *
 * Pass only top-level lines (`parentItemId: null`) with `subItems` loaded;
 * components reached through their parent must not also be passed in, or their
 * revenue is counted twice.
 */
export function expandRevenueLines<P>(lines: ExpandableLine<P>[]): RevenueLine<P>[] {
  const out: RevenueLine<P>[] = [];

  for (const line of lines) {
    const lineTotal = Number(line.lineTotal);
    const quantity = Number(line.quantity);

    if (!line.isComposite) {
      // A plain catalogue line. Lines with no product (ad-hoc text, deposits)
      // have no SKU to report against and are dropped by the caller.
      if (line.product) out.push({ product: line.product, quantity, revenue: lineTotal });
      continue;
    }

    const subs = (line.subItems ?? []).filter((s) => s.product);
    if (!subs.length) continue;

    const componentValue = subs.reduce((s, c) => s + Number(c.lineTotal), 0);
    let allocated = 0;

    subs.forEach((sub, idx) => {
      const share =
        componentValue > 0 ? Number(sub.lineTotal) / componentValue : 1 / subs.length;
      // The last component absorbs the rounding remainder so the components
      // always add back up to exactly what was charged.
      const revenue =
        idx === subs.length - 1 ? round2(lineTotal - allocated) : round2(lineTotal * share);
      allocated = round2(allocated + revenue);

      out.push({
        product: sub.product as P,
        // A bundle bought twice contains twice each component.
        quantity: Number(sub.quantity) * quantity,
        revenue,
      });
    });
  }

  return out;
}

/**
 * What to `include` when loading lines for {@link expandRevenueLines}.
 * `where: { parentItemId: null }` belongs on the query alongside it.
 */
export const revenueLineInclude = <T>(productSelect: T) => ({
  product: productSelect,
  subItems: { select: { quantity: true, lineTotal: true, product: productSelect } },
});
