/**
 * Turning one row of a backup file into one row this database will accept.
 *
 * Split out of BackupService so it can be tested without a database, a Nest
 * container or a 300KB fixture: everything here is a pure function of the row
 * and the ids already known to exist.
 *
 * The rules that matter, and why:
 *
 *  - `tenantId` is never validated as a foreign key. It is overwritten with the
 *    restoring tenant a moment later, so checking the file's value achieves
 *    nothing -- and because it is a required column, checking it meant that
 *    restoring any export taken from a different store silently discarded every
 *    row in every table while still reporting success.
 *
 *  - A reference to a `User` that this database has never heard of falls back
 *    to the person performing the restore. Accounts live in Supabase Auth, not
 *    in the backup, so a file from another environment always names strangers.
 *    Dropping those rows would throw away invoices and orders to preserve a
 *    "created by" label.
 *
 *  - Any other unknown reference still drops the row when the column is
 *    required. A sales order line pointing at a sales order that does not exist
 *    is not repairable, and inserting it would fail at the database anyway.
 */

export interface RestoreFieldDef {
  name: string;
  kind: string;
  type: string;
  isRequired: boolean;
}

export interface BuildRowContext {
  /** Column name -> Prisma field definition, for the model being restored. */
  fieldMap: Map<string, RestoreFieldDef>;
  /** Foreign key column -> the model it points at. */
  relationFieldMap: Map<string, string>;
  /** Ids known to exist, per model: pre-existing rows plus ones already inserted. */
  knownIdsByModel: Map<string, Set<string>>;
  /** The store this restore belongs to. Every scoped row is stamped with it. */
  tenantId: string;
  /** Who is performing the restore; adopts orphaned `createdById` references. */
  fallbackUserId?: string | null;
}

export type RestoreRowOutcome =
  | { ok: true; row: Record<string, any> }
  | { ok: false; reason: string };

/** The value a required column falls back to when the file has none. */
function emptyValueFor(type: string): any {
  if (type === 'Int' || type === 'Float' || type === 'Decimal') return 0;
  if (type === 'Boolean') return false;
  if (type === 'DateTime') return new Date();
  if (type === 'Json') return {};
  return '';
}

function coerce(field: RestoreFieldDef, val: unknown): any {
  if (field.type === 'DateTime') {
    const d = new Date(val as string);
    return isNaN(d.getTime()) ? (field.isRequired ? new Date() : null) : d;
  }
  if (field.type === 'Int') {
    const num = parseInt(String(val), 10);
    return isNaN(num) ? (field.isRequired ? 0 : null) : num;
  }
  if (field.type === 'Float' || field.type === 'Decimal') {
    // CSV exports wrap decimals in literal quote characters ("0"), so strip a
    // matched pair before parsing rather than reading them as NaN.
    const num = parseFloat(String(val).replace(/^"(-?[\d.]+)"$/, '$1'));
    return isNaN(num) ? (field.isRequired ? 0 : null) : num;
  }
  if (field.type === 'Boolean') {
    return val === 'true' || val === true || val === '1' || val === 1;
  }
  if (field.type === 'Json') {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  }
  return String(val);
}

const BLANK = new Set(['', 'null', 'undefined']);

function isBlank(val: unknown): boolean {
  return val === null || val === undefined || (typeof val === 'string' && BLANK.has(val));
}

export function buildRestoreRow(
  raw: Record<string, unknown>,
  ctx: BuildRowContext,
): RestoreRowOutcome {
  const clean: Record<string, any> = {};

  for (const [key, val] of Object.entries(raw)) {
    const field = ctx.fieldMap.get(key);
    // Unknown columns (an older export, a renamed field) and virtual relation
    // properties are dropped rather than passed to Prisma, which would throw.
    if (!field || field.kind === 'object') continue;

    clean[key] = isBlank(val)
      ? field.isRequired
        ? emptyValueFor(field.type)
        : null
      : coerce(field, val);
  }

  // Scope first. The file's own tenantId carries no authority here, and leaving
  // it in place long enough to be foreign-key checked is what broke restores
  // across environments.
  if (ctx.fieldMap.has('tenantId')) {
    clean['tenantId'] = ctx.tenantId;
  }

  for (const [fkCol, targetModel] of ctx.relationFieldMap.entries()) {
    if (fkCol === 'tenantId') continue;

    const value = clean[fkCol];
    if (isBlank(value)) continue;

    const known = ctx.knownIdsByModel.get(targetModel);
    if (known?.has(String(value))) continue;

    const field = ctx.fieldMap.get(fkCol);

    if (targetModel === 'User' && ctx.fallbackUserId) {
      clean[fkCol] = ctx.fallbackUserId;
      continue;
    }

    if (field?.isRequired) {
      return { ok: false, reason: `${fkCol} -> ${targetModel}:${String(value)} not found` };
    }

    clean[fkCol] = null;
  }

  return { ok: true, row: clean };
}
