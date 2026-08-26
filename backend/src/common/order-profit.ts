import { DiscountType, applyDiscount, round2 } from './calc';

interface CostedProduct {
  costPrice: unknown;
}

interface CostedSub {
  product?: CostedProduct | null;
  quantity: unknown;
  lineTotal: unknown;
}

interface CostedLine extends CostedSub {
  isComposite?: boolean;
  subItems?: CostedSub[] | null;
}

export interface OrderProfit {
  /** Charged for goods, after both line and order discounts. Excludes shipping. */
  revenue: number;
  /** Cost of goods, at each product's current weighted-average cost. */
  cost: number;
  profit: number;
  /** Profit as a percentage of revenue. Zero when nothing was charged. */
  marginPct: number;
  /**
   * True when some line carried money but no cost basis -- an ad-hoc typed line
   * with no catalogue product behind it. Profit is then overstated by whatever
   * those lines actually cost, so the UI has to say so rather than present the
   * number as complete.
   */
  hasUnknownCost: boolean;
  /** How many lines are in that position, for a specific warning. */
  unknownCostLines: number;
}

/**
 * What one line costs, and whether that figure can be trusted.
 *
 * A bundle is priced as a header but stocked as its components, so its cost is
 * the sum of what the components cost, multiplied by how many bundles were
 * sold. The header itself never has a product of its own.
 */
function lineCost(line: CostedLine): { cost: number; unknown: boolean } {
  const quantity = Number(line.quantity);

  if (line.isComposite) {
    const subs = line.subItems ?? [];
    let cost = 0;
    let unknown = false;
    for (const sub of subs) {
      if (!sub.product) {
        // A descriptive sub-item priced above zero is real money with no cost
        // behind it; one priced at zero is just a note on the packing list.
        if (Number(sub.lineTotal)) unknown = true;
        continue;
      }
      cost += Number(sub.product.costPrice) * Number(sub.quantity) * quantity;
    }
    return { cost: round2(cost), unknown };
  }

  if (!line.product) {
    return { cost: 0, unknown: Boolean(Number(line.lineTotal)) };
  }
  return { cost: round2(Number(line.product.costPrice) * quantity), unknown: false };
}

/**
 * Gross profit on one order: what the customer pays for goods, less what those
 * goods cost.
 *
 * Two deliberate exclusions. Shipping is left out of both sides -- it is
 * charged to the customer but its cost is booked as an expense rather than
 * against the order, so counting the income alone would report delivery as pure
 * profit. And cost is each product's *current* weighted-average cost, not the
 * cost when the order was placed, because no cost is recorded on the line at
 * sale time. That matches how the profit-by-product report already values
 * goods, so the two agree; it also means an old order's profit shifts as later
 * purchases move the average.
 *
 * Pass top-level lines only (`parentItemId: null`), each with `subItems` and
 * `product.costPrice` loaded.
 */
export function calcOrderProfit(order: {
  items: CostedLine[];
  discountType?: DiscountType;
  discountValue?: unknown;
}): OrderProfit {
  const subtotal = round2(order.items.reduce((sum, l) => sum + Number(l.lineTotal), 0));
  const revenue = round2(applyDiscount(subtotal, order.discountType, Number(order.discountValue ?? 0)));

  let cost = 0;
  let unknownCostLines = 0;
  for (const line of order.items) {
    const result = lineCost(line);
    cost = round2(cost + result.cost);
    if (result.unknown) unknownCostLines += 1;
  }

  const profit = round2(revenue - cost);
  return {
    revenue,
    cost,
    profit,
    marginPct: revenue ? round2((profit / revenue) * 100) : 0,
    hasUnknownCost: unknownCostLines > 0,
    unknownCostLines,
  };
}
