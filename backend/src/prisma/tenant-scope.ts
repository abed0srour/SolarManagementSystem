import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getTenantContext } from '../common/tenant-context';

/**
 * Automatic tenant scoping for every Prisma operation.
 *
 * This is the actual security boundary of the multi-tenant system. Rather than
 * asking several hundred existing queries to remember a `tenantId` filter, one
 * client extension rewrites all of them on the way past:
 *
 *   - reads gain `WHERE tenantId = <current tenant>`
 *   - writes have `tenantId` stamped on, including nested relation writes
 *   - anything running with no tenant established is refused outright
 *
 * That last rule is what makes it trustworthy. The dangerous default is an
 * unscoped query that quietly returns every store; here the default is a loud
 * error, and crossing the boundary has to be spelled out with `runUnscoped()`
 * or `runAsTenant()`.
 *
 * Verified to apply inside interactive transactions too -- `tx.invoice.create()`
 * within `prisma.$transaction(async (tx) => ...)` goes through this same hook,
 * which matters because the money-handling paths are all transactional.
 */

const TENANT_FIELD = 'tenantId';

/** Operations whose `where` selects existing rows. */
const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Operations that bring new rows into being. */
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

/** Relation payload keys that contain rows being written. */
const NESTED_WRITE_KEYS = ['create', 'createMany', 'connectOrCreate', 'upsert', 'update', 'updateMany'] as const;

interface ModelMeta {
  /** True when the model carries a tenantId column. */
  scoped: boolean;
  /** Relation field name -> related model name, for relations to scoped models. */
  relations: Map<string, string>;
}

/**
 * Read straight from the generated schema rather than a hand-kept list. A model
 * given a `tenantId` column tomorrow is scoped from the moment it is generated,
 * with nobody having to remember to add it here.
 */
const META: Map<string, ModelMeta> = (() => {
  const meta = new Map<string, ModelMeta>();
  for (const model of Prisma.dmmf.datamodel.models) {
    meta.set(model.name, {
      scoped: model.fields.some((f) => f.name === TENANT_FIELD),
      relations: new Map(),
    });
  }
  for (const model of Prisma.dmmf.datamodel.models) {
    const entry = meta.get(model.name)!;
    for (const field of model.fields) {
      if (field.kind !== 'object') continue;
      if (meta.get(field.type)?.scoped) entry.relations.set(field.name, field.type);
    }
  }
  return meta;
})();

export function isTenantScoped(model: string | undefined): boolean {
  return !!model && !!META.get(model)?.scoped;
}

/** Every scoped model name, for diagnostics and tests. */
export function scopedModels(): string[] {
  return [...META.entries()].filter(([, m]) => m.scoped).map(([name]) => name);
}

/**
 * Stamp `tenantId` onto a row being written, and onto any rows nested inside
 * it.
 *
 * Nested writes are the part that is easy to miss: creating an invoice with
 * `items: { create: [...] }` writes InvoiceItem rows that never pass through
 * this hook as operations of their own. Walking the payload is what keeps a
 * line item from ending up unowned -- or, worse, owned by whoever inserted it.
 */
function stampWrites(model: string, data: unknown, tenantId: string): void {
  if (Array.isArray(data)) {
    for (const row of data) stampWrites(model, row, tenantId);
    return;
  }
  if (!data || typeof data !== 'object') return;

  const meta = META.get(model);
  if (!meta) return;
  const row = data as Record<string, any>;

  if (meta.scoped) row[TENANT_FIELD] = tenantId;

  for (const [field, target] of meta.relations) {
    const payload = row[field];
    if (!payload || typeof payload !== 'object') continue;

    for (const key of NESTED_WRITE_KEYS) {
      const nested = payload[key];
      if (!nested) continue;

      if (key === 'createMany') {
        stampWrites(target, nested.data, tenantId);
      } else if (key === 'connectOrCreate') {
        const entries = Array.isArray(nested) ? nested : [nested];
        for (const entry of entries) stampWrites(target, entry?.create, tenantId);
      } else if (key === 'upsert') {
        const entries = Array.isArray(nested) ? nested : [nested];
        for (const entry of entries) {
          stampWrites(target, entry?.create, tenantId);
          stampWrites(target, entry?.update, tenantId);
        }
      } else if (key === 'updateMany') {
        const entries = Array.isArray(nested) ? nested : [nested];
        for (const entry of entries) stampWrites(target, entry?.data, tenantId);
      } else if (key === 'update') {
        const entries = Array.isArray(nested) ? nested : [nested];
        // Nested update is either { where, data } or the data object itself.
        for (const entry of entries) stampWrites(target, entry?.data ?? entry, tenantId);
      } else {
        stampWrites(target, nested, tenantId);
      }
    }
  }
}

/**
 * Constrain a filter to one tenant.
 *
 * Merged with AND rather than assigned, so a caller that already filters on
 * tenantId (the super admin looking at one store) cannot widen the result by
 * overwriting it, and an `OR` in the caller's filter cannot escape it either --
 * `{ OR: [...] }` alongside a sibling `tenantId` is still an AND at the top
 * level, which is exactly what is wanted.
 */
function scopeWhere(where: unknown, tenantId: string): Record<string, any> {
  const base = (where && typeof where === 'object' ? where : {}) as Record<string, any>;
  if (base[TENANT_FIELD] === undefined) return { ...base, [TENANT_FIELD]: tenantId };
  if (base[TENANT_FIELD] === tenantId) return base;
  return { AND: [base, { [TENANT_FIELD]: tenantId }] };
}

/**
 * Rewrite one operation's arguments for `tenantId`.
 *
 * Pure and exported so the boundary can be tested directly, without a database
 * and without a running Nest application. This is the single function that
 * decides whether a query is safe, so it is worth being able to assert on its
 * output rather than inferring correctness from an integration test.
 */
export function applyTenantScope(
  model: string,
  operation: string,
  args: unknown,
  tenantId: string,
): Record<string, any> {
  const next: Record<string, any> = { ...((args ?? {}) as Record<string, any>) };

  if (WHERE_OPS.has(operation)) {
    next.where = scopeWhere(next.where, tenantId);
  }

  if (CREATE_OPS.has(operation)) {
    if (operation === 'upsert') stampWrites(model, next.create, tenantId);
    else if (next.data !== undefined) stampWrites(model, next.data, tenantId);
  }

  // update/upsert payloads can carry nested creates of their own.
  if ((operation === 'update' || operation === 'updateMany') && next.data) {
    stampWrites(model, next.data, tenantId);
  }
  if (operation === 'upsert' && next.update) {
    stampWrites(model, next.update, tenantId);
  }

  return next;
}

export const tenantScopeExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!isTenantScoped(model)) return query(args);

        const ctx = getTenantContext();
        if (ctx.mode === 'UNSCOPED') return query(args);

        if (ctx.mode !== 'TENANT' || !ctx.tenantId) {
          // Fail closed. Reaching here means a request, job or script touched
          // store data without saying which store -- returning everything would
          // be a cross-tenant leak, and returning nothing would hide the bug.
          throw new ForbiddenException(
            `No active tenant for ${model}.${operation}. A tenant-scoped query must run inside a request from a tenant user, or explicitly inside runAsTenant()/runUnscoped().`,
          );
        }

        return query(applyTenantScope(model!, operation, args, ctx.tenantId));
      },
    },
  },
});
