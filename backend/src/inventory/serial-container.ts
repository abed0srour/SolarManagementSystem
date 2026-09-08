import { BadRequestException } from '@nestjs/common';

/** Serials are printed on the hardware, and the label stock in use is 18 wide. */
export const SERIAL_MAX_LENGTH = 18;

/**
 * How a tenant wants a raw scanned/typed value turned into the serial that
 * actually gets stored. Every field is optional and defaults to a no-op, so a
 * tenant that never visits the setting sees exactly today's trim-only behaviour.
 */
export interface SerialFormatRule {
  /** Removed once from the start, if the value starts with it exactly. */
  removePrefix?: string;
  /** Removed once from the end, if the value ends with it exactly. */
  removeSuffix?: string;
  /** Every occurrence of any of these characters is dropped, e.g. "#- ". */
  stripChars?: string;
  /** Applied last of the shape rules: keep only the final N characters. */
  keepLastN?: number;
  case?: 'UPPER' | 'LOWER' | 'AS_IS';
}

/**
 * Turn one raw value into what the tenant's rule says the stored serial should
 * look like. Prefix/suffix removal runs before character stripping so a
 * configured prefix that itself contains a "stripped" character (e.g. prefix
 * "SN-" with "-" also in stripChars) still matches literally.
 */
export function applySerialFormat(raw: string, rule?: SerialFormatRule | null): string {
  let value = raw;
  if (!rule) return value;

  if (rule.removePrefix && value.startsWith(rule.removePrefix)) {
    value = value.slice(rule.removePrefix.length);
  }
  if (rule.removeSuffix && value.endsWith(rule.removeSuffix)) {
    value = value.slice(0, value.length - rule.removeSuffix.length);
  }
  if (rule.stripChars) {
    const drop = new Set(rule.stripChars);
    value = Array.from(value)
      .filter((c) => !drop.has(c))
      .join('');
  }
  if (rule.keepLastN && rule.keepLastN > 0 && value.length > rule.keepLastN) {
    value = value.slice(-rule.keepLastN);
  }
  if (rule.case === 'UPPER') value = value.toUpperCase();
  else if (rule.case === 'LOWER') value = value.toLowerCase();

  return value;
}

/**
 * One place that decides what a serial number may look like.
 *
 * A serial can be captured at goods receipt, typed into a product's container,
 * or corrected on an existing unit. Those are three entry points to the same
 * physical label, so they answer to the same rules rather than each growing its
 * own slightly different check. `rule` is the tenant's configured Settings ->
 * Serial Format shape rule, looked up by the caller.
 */
export function normaliseSerial(raw: string, rule?: SerialFormatRule | null): string {
  const serial = applySerialFormat(raw.trim(), rule).trim();
  if (!serial) throw new BadRequestException('Serial number cannot be empty');
  if (serial.length > SERIAL_MAX_LENGTH)
    throw new BadRequestException(`Serial numbers must be ${SERIAL_MAX_LENGTH} characters or less`);
  return serial;
}

/**
 * Normalise a whole batch, reporting every bad value rather than the first.
 *
 * A goods receipt can carry hundreds of scanned serials. Failing on the first
 * over-long one would send the operator round the loop once per bad row, so the
 * batch is checked as a batch and the complaints arrive together.
 */
export function normaliseSerials(raw: string[], rule?: SerialFormatRule | null): string[] {
  const tooLong: string[] = [];
  const cleaned: string[] = [];
  let sawEmpty = false;

  for (const value of raw) {
    const serial = applySerialFormat(value.trim(), rule).trim();
    if (!serial) {
      sawEmpty = true;
      continue;
    }
    if (serial.length > SERIAL_MAX_LENGTH) tooLong.push(serial);
    else cleaned.push(serial);
  }

  const problems: string[] = [];
  if (sawEmpty) problems.push('one or more entries were blank');
  if (tooLong.length)
    problems.push(`longer than ${SERIAL_MAX_LENGTH} characters: ${tooLong.join(', ')}`);
  if (problems.length) throw new BadRequestException(`Serial numbers rejected — ${problems.join('; ')}`);

  return cleaned;
}

/** Serials repeated inside a single batch, each reported once. */
export function repeatedSerials(serials: string[]): string[] {
  return [...new Set(serials.filter((s, i) => serials.indexOf(s) !== i))];
}

/**
 * How many more serials a container can accept.
 *
 * This is the invariant the whole feature exists for: a container holds one
 * serial per unit of stock, no more. Kept as a pure function so the rule can be
 * asserted directly rather than inferred from the behaviour of an endpoint.
 *
 * Clamped at zero because an already-overfilled container -- possible in data
 * written before this rule existed -- has negative room, and "room for -3 more"
 * is not a thing anyone should have to reason about downstream.
 */
export function serialRoom(capacity: number, filled: number): number {
  return Math.max(0, capacity - filled);
}

/** Whether a batch of `incoming` serials fits the room left in a container. */
export function fitsContainer(capacity: number, filled: number, incoming: number): boolean {
  return incoming <= serialRoom(capacity, filled);
}
