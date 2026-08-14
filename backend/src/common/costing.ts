import { Prisma } from '@prisma/client';
import { round2 } from './calc';

/**
 * Re-cost a product using the weighted average cost method:
 *
 *   newCost = (onHandQty * currentCost + inboundQty * inboundUnitCost)
 *             / (onHandQty + inboundQty)
 *
 * If nothing is on hand, the inbound cost simply becomes the new cost.
 *
 * Every stock inflow that arrives with a known price has to run through here,
 * not just goods receipts — an opening-balance or found-stock adjustment
 * entered at a different price moves the average exactly as a delivery does,
 * and skipping it silently biases margin on every later sale.
 *
 * Outflows never call this: removing units at the average price leaves the
 * average unchanged.
 *
 * Each change is written to PriceHistory so the cost trail stays auditable.
 */
export async function applyWeightedAverageCost(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    receivedQty: number;
    receivedUnitCost: number;
    userId: string;
    /** Human-readable source of the inflow, e.g. a PO number or "adjustment". */
    source: string;
    deliveryCostPerUnit?: number;
  },
) {
  const product = await tx.product.findUnique({
    where: { id: params.productId },
    select: { costPrice: true },
  });
  if (!product || params.receivedQty <= 0) return;

  const agg = await tx.stockLevel.aggregate({
    where: { productId: params.productId },
    _sum: { quantity: true },
  });
  const onHand = Math.max(Number(agg._sum.quantity ?? 0), 0);
  const oldCost = Number(product.costPrice);
  const totalQty = onHand + params.receivedQty;
  const newCost =
    totalQty > 0
      ? round2((onHand * oldCost + params.receivedQty * params.receivedUnitCost) / totalQty)
      : params.receivedUnitCost;
  if (newCost === oldCost) return;

  await tx.product.update({
    where: { id: params.productId },
    data: { costPrice: newCost, priceUpdatedAt: new Date() },
  });
  await tx.priceHistory.create({
    data: {
      productId: params.productId,
      oldCostPrice: oldCost,
      newCostPrice: newCost,
      reason:
        `Weighted average cost on ${params.source}: ${onHand} on hand @ ${oldCost} + ` +
        `${params.receivedQty} received @ ${params.receivedUnitCost}` +
        (params.deliveryCostPerUnit ? ` (incl. ${round2(params.deliveryCostPerUnit)}/unit delivery)` : ''),
      changedById: params.userId,
    },
  });
}
