/**
 * Building readable SKUs.
 *
 * A random six-character code is unique and says nothing. A SKU someone reads
 * off a shelf, a picking list or a supplier invoice is worth more when it
 * carries what the product is, so these are assembled from the product's own
 * category, brand and model, and closed with a running number:
 *
 *   PAN-JIN-JKM550-0007    a Jinko JKM550 panel, the seventh of its kind
 *   BAT-VIC-0003           a Victron battery, no model given
 *
 * Only characters that survive the variant generator's filter are used --
 * A-Z, 0-9 and the hyphen -- so a variant built on one of these keeps its
 * parent's meaning: PAN-JIN-JKM550-0007-BLACK.
 */

/** How many characters each part contributes, longest-lived first. */
export const SKU_SEGMENT_LENGTH = { category: 3, brand: 3, model: 6 } as const;

/** Digits in the trailing counter. Four allows 9999 of any one kind. */
export const SKU_SEQUENCE_DIGITS = 4;

function asciiAlnum(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Condense a phrase into a short code.
 *
 * Several words become their initials, because that is what distinguishes them
 * -- "Lead Acid Batteries" and "Lithium Batteries" share a first word but not
 * an initialism. A single word contributes its opening letters instead, since
 * one initial says nothing at all.
 */
export function skuCode(value: string | null | undefined, maxLength: number): string {
  if (!value) return '';
  const words = value.trim().split(/\s+/).map(asciiAlnum).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, maxLength);
  return words.map((w) => w[0]).join('').slice(0, maxLength);
}

/**
 * The stable part of a SKU: everything before the running number.
 *
 * Empty when nothing usable survives -- a product with no category or brand
 * yet, or one named only in Arabic, which leaves no Latin characters behind.
 * The caller falls back to a random code rather than emitting a bare number.
 */
export function buildSkuPrefix(input: {
  category?: string | null;
  brand?: string | null;
  model?: string | null;
}): string {
  return [
    skuCode(input.category, SKU_SEGMENT_LENGTH.category),
    skuCode(input.brand, SKU_SEGMENT_LENGTH.brand),
    // A model is already a code, so its own characters are kept in order
    // rather than reduced to initials.
    asciiAlnum(input.model ?? '').slice(0, SKU_SEGMENT_LENGTH.model),
  ]
    .filter(Boolean)
    .join('-');
}

/**
 * The next free number for a prefix, read from the SKUs already using it.
 *
 * Counts from the highest in use rather than from how many exist, so deleting
 * the newest product does not hand its number to the next one and collide with
 * whatever still references the old SKU on paper.
 */
export function nextSkuSequence(existing: string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let highest = 0;
  for (const sku of existing) {
    const match = pattern.exec(sku.toUpperCase());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

/** Assemble prefix and counter into the finished SKU. */
export function formatSku(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(SKU_SEQUENCE_DIGITS, '0')}`;
}
