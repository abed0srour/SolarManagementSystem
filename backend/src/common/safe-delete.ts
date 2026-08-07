/**
 * Two-tier deletion for hand-created records.
 *
 * The problem this solves: every `remove()` used to soft-delete, so a product
 * or supplier created by mistake stayed in the database forever, invisible but
 * permanent. At the same time we can never truly delete something an invoice
 * points at, or the financial history breaks.
 *
 * So the decision is made per record, from its actual usage:
 *
 *   - **PURGED**  — nothing references it. The row is really deleted. Rows that
 *     exist purely as bookkeeping (initial price history, zero-quantity stock
 *     levels, supplier price links, compatibility links, client addresses) go
 *     with it via `onDelete: Cascade` in the schema.
 *   - **ARCHIVED** — something references it. Falls back to the previous
 *     behaviour: `deletedAt` is stamped and the record drops out of lists while
 *     every document that points at it stays intact.
 *
 * Deciding from *business* usage rather than "any relation at all" is the whole
 * point. Creating a product always writes a `PriceHistory` row, so a naive
 * any-relation check would make every product un-purgeable — including one
 * created ten seconds ago, which is exactly the case worth supporting.
 *
 * The `Restrict` foreign keys on the business tables enforce the same rule at
 * the database level, so a bug in a usage count surfaces as a failed delete
 * rather than as lost history.
 */

export type DeleteMode = 'PURGED' | 'ARCHIVED';

/**
 * Answer to "can this be deleted outright?", asked by the confirm dialog before
 * it decides whether to offer Delete or Archive.
 */
export interface UsageReport {
  /** True when something references it, so only archiving is possible. */
  used: boolean;
  /** Non-zero business references, e.g. `{ invoiceItems: 3 }`. */
  usedBy: Record<string, number>;
}

export interface SafeDeleteResult {
  success: true;
  mode: DeleteMode;
  /** Non-zero business references, e.g. `{ invoiceItems: 3 }`. Empty when purged. */
  usedBy: Record<string, number>;
}

/**
 * Reduce a map of usage counts to only the non-empty ones.
 *
 * Pass every relation that represents real business use; omit bookkeeping
 * relations that the record gets just by existing.
 */
export function usedBy(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

/** True when nothing references the record, i.e. it is safe to really delete. */
export function isUnused(counts: Record<string, number>): boolean {
  return Object.keys(usedBy(counts)).length === 0;
}
