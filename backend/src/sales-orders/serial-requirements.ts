export interface SerialRequirementItem {
  productId: string | null;
  isComposite?: boolean;
  quantity: unknown;
  product?: {
    name?: string | null;
    isService?: boolean | null;
    trackSerials?: boolean | null;
    requireSerialOnSale?: boolean | null;
  } | null;
}

export interface SerialAssignment {
  productId: string;
  serialNumbers: string[];
}

export interface SerialMismatch {
  productId: string;
  name: string;
  required: number;
  provided: number;
}

/**
 * Which products on an order were not given the serials they require.
 *
 * A product marked `requireSerialOnSale` is one where knowing which physical
 * unit went to which customer matters -- an inverter under warranty, not a
 * bag of screws. Confirming the order moves its stock either way, so an order
 * confirmed without the serials leaves the count on the shelf disagreeing with
 * the units recorded against it, and no way to answer later which one was sold.
 *
 * Quantities are summed per product rather than per line: the same product can
 * appear twice on an order, and the serials for it arrive as one list.
 *
 * Bundle headers are skipped because they hold no product of their own -- their
 * components are separate rows and are checked in their own right. Services are
 * skipped because they carry no stock and no units.
 */
export function serialMismatches(
  items: SerialRequirementItem[],
  assignments: SerialAssignment[] = [],
): SerialMismatch[] {
  const provided = new Map<string, number>();
  for (const assignment of assignments) {
    const unique = new Set(assignment.serialNumbers.map((s) => s.trim()).filter(Boolean));
    provided.set(assignment.productId, (provided.get(assignment.productId) ?? 0) + unique.size);
  }

  const required = new Map<string, { name: string; quantity: number }>();
  for (const item of items) {
    if (!item.productId || item.isComposite) continue;
    if (item.product?.isService) continue;
    if (!item.product?.requireSerialOnSale || !item.product?.trackSerials) continue;

    const current = required.get(item.productId) ?? { name: item.product?.name ?? item.productId, quantity: 0 };
    current.quantity += Number(item.quantity);
    required.set(item.productId, current);
  }

  const mismatches: SerialMismatch[] = [];
  for (const [productId, { name, quantity }] of required) {
    const count = provided.get(productId) ?? 0;
    if (count !== quantity) mismatches.push({ productId, name, required: quantity, provided: count });
  }
  return mismatches;
}

/** One sentence a person can act on, naming every product that is short. */
export function describeSerialMismatches(mismatches: SerialMismatch[]): string {
  const parts = mismatches.map(
    (m) => `"${m.name}" needs ${m.required} serial number${m.required === 1 ? '' : 's'} but ${m.provided} were given`,
  );
  return `This order cannot be confirmed until every serial-tracked item is accounted for: ${parts.join('; ')}.`;
}
