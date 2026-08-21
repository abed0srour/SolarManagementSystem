/**
 * Serial numbers as they arrive off a supplier label.
 *
 * Manufacturers rarely encode the bare serial. What the scanner reads is a
 * delimited record — a model or batch code, the serial split across fields,
 * and a trailing check field:
 *
 *   086-020113-00#0209#060#048#2617#0283#0614
 *   └── model ──┘ └────── serial ───────┘ └ck┘
 *
 * The serial is everything between the first delimiter and the last, with the
 * delimiters removed. Anything that does not look like one of these records is
 * already a bare serial and is returned untouched, so hand-typed values and
 * plain barcodes keep working.
 */

const DELIMITER = '#';

/**
 * Pull the serial out of a scanned label payload.
 *
 * Deliberately does not strip letters or punctuation from the extracted span:
 * the boundary rule is about the delimiters, and quietly discarding characters
 * inside the serial would be how a subtly wrong number ends up in stock.
 */
export function extractSerial(raw: string): string {
  const value = (raw ?? '').trim();

  const first = value.indexOf(DELIMITER);
  const last = value.lastIndexOf(DELIMITER);

  // No delimiter, or only one, means there is no span between two of them —
  // the payload is already the serial.
  if (first === -1 || last === first) return value;

  const extracted = value.slice(first + 1, last).split(DELIMITER).join('');

  // A record whose middle is empty (`ABC##DEF`) is not a template we
  // understand; fall back to the raw value rather than return nothing.
  return extracted || value;
}

/** True when `raw` carries more than the serial, so the UI can show both. */
export function isLabelPayload(raw: string): boolean {
  const value = (raw ?? '').trim();
  return extractSerial(value) !== value;
}
