import { applyTenantScope, isTenantScoped, scopedModels } from './tenant-scope';

const T = 'tenant-a';
const OTHER = 'tenant-b';

describe('which models are scoped', () => {
  it('covers the business tables', () => {
    for (const model of ['Client', 'Invoice', 'Payment', 'Product', 'InvoiceItem', 'Setting', 'NumberSequence']) {
      expect(isTenantScoped(model)).toBe(true);
    }
  });

  it('leaves platform and credential tables alone', () => {
    // Tenant itself must not be scoped, or the super admin could never list
    // stores; the token tables are keyed by secret and belong to no store.
    for (const model of ['Tenant', 'RefreshToken', 'PasswordResetToken', 'VerificationCode']) {
      expect(isTenantScoped(model)).toBe(false);
    }
  });

  it('is derived from the schema, not a hand-kept list', () => {
    // A guard against the list silently emptying if the DMMF shape ever changes.
    expect(scopedModels().length).toBeGreaterThan(35);
  });
});

describe('reads', () => {
  it('constrains a findMany that had no filter at all', () => {
    expect(applyTenantScope('Client', 'findMany', undefined, T)).toEqual({ where: { tenantId: T } });
  });

  it('keeps the original filter and adds the tenant', () => {
    const out = applyTenantScope('Client', 'findMany', { where: { deletedAt: null } }, T);
    expect(out.where).toEqual({ deletedAt: null, tenantId: T });
  });

  it('constrains findUnique, so an id from another store returns nothing', () => {
    const out = applyTenantScope('Invoice', 'findUnique', { where: { id: 'inv-1' } }, T);
    expect(out.where).toEqual({ id: 'inv-1', tenantId: T });
  });

  it('does not let an OR escape the tenant filter', () => {
    // The tenant filter sits beside OR, and sibling keys are ANDed, so the OR
    // can only ever widen the search *within* the store.
    const out = applyTenantScope(
      'Client',
      'findMany',
      { where: { OR: [{ name: { contains: 'a' } }, { email: { contains: 'a' } }] } },
      T,
    );
    expect(out.where.tenantId).toBe(T);
    expect(out.where.OR).toHaveLength(2);
  });

  it('refuses to widen a filter that already names a different tenant', () => {
    const out = applyTenantScope('Client', 'findMany', { where: { tenantId: OTHER } }, T);
    // Both conditions must hold, so the result is empty rather than the other
    // store's rows.
    expect(out.where).toEqual({ AND: [{ tenantId: OTHER }, { tenantId: T }] });
  });

  it('scopes deleteMany and updateMany', () => {
    expect(applyTenantScope('Payment', 'deleteMany', {}, T).where).toEqual({ tenantId: T });
    expect(applyTenantScope('Payment', 'updateMany', { where: { id: 'p1' }, data: {} }, T).where).toEqual({
      id: 'p1',
      tenantId: T,
    });
  });

  it('scopes aggregates, which would otherwise total the whole platform', () => {
    for (const op of ['count', 'aggregate', 'groupBy']) {
      expect(applyTenantScope('Invoice', op, {}, T).where).toEqual({ tenantId: T });
    }
  });
});

describe('writes', () => {
  it('stamps the tenant on a create', () => {
    const out = applyTenantScope('Client', 'create', { data: { name: 'Acme' } }, T);
    expect(out.data).toEqual({ name: 'Acme', tenantId: T });
  });

  it('overrides a tenant the caller tried to supply', () => {
    const out = applyTenantScope('Client', 'create', { data: { name: 'Acme', tenantId: OTHER } }, T);
    expect(out.data.tenantId).toBe(T);
  });

  it('stamps every row of a createMany', () => {
    const out = applyTenantScope('Notification', 'createMany', { data: [{ message: 'a' }, { message: 'b' }] }, T);
    expect(out.data).toEqual([
      { message: 'a', tenantId: T },
      { message: 'b', tenantId: T },
    ]);
  });

  /*
   * The case most likely to be missed. Creating an invoice with nested items
   * writes InvoiceItem rows that never reach this hook as operations of their
   * own, so without walking the payload they would be inserted unowned.
   */
  it('stamps nested relation creates', () => {
    const out = applyTenantScope(
      'Invoice',
      'create',
      {
        data: {
          number: 'INV-1',
          items: { create: [{ description: 'Panel', lineTotal: 10 }, { description: 'Labour', lineTotal: 5 }] },
        },
      },
      T,
    );
    expect(out.data.tenantId).toBe(T);
    expect(out.data.items.create.every((i: any) => i.tenantId === T)).toBe(true);
  });

  it('stamps a nested createMany', () => {
    const out = applyTenantScope(
      'Invoice',
      'create',
      { data: { number: 'INV-2', items: { createMany: { data: [{ description: 'x' }] } } } },
      T,
    );
    expect(out.data.items.createMany.data[0].tenantId).toBe(T);
  });

  it('stamps a nested create several levels deep', () => {
    const out = applyTenantScope(
      'Client',
      'create',
      { data: { name: 'Acme', salesOrders: { create: [{ number: 'SO-1', items: { create: [{ lineTotal: 1 }] } }] } } },
      T,
    );
    const order = out.data.salesOrders.create[0];
    expect(order.tenantId).toBe(T);
    expect(order.items.create[0].tenantId).toBe(T);
  });

  it('stamps both halves of an upsert and scopes its where', () => {
    const out = applyTenantScope(
      'Setting',
      'upsert',
      { where: { tenantId_key: { tenantId: T, key: 'company' } }, create: { key: 'company' }, update: { value: {} } },
      T,
    );
    expect(out.create.tenantId).toBe(T);
    expect(out.update.tenantId).toBe(T);
    expect(out.where.tenantId).toBe(T);
  });

  it('stamps nested creates hanging off an update', () => {
    const out = applyTenantScope(
      'SalesOrder',
      'update',
      { where: { id: 'so-1' }, data: { items: { create: [{ lineTotal: 3 }] } } },
      T,
    );
    expect(out.where.tenantId).toBe(T);
    expect(out.data.items.create[0].tenantId).toBe(T);
  });

  it('leaves connect payloads structurally intact', () => {
    // connect points at an existing row by id; the ids only ever come from
    // reads that were themselves scoped.
    const out = applyTenantScope('Invoice', 'create', { data: { client: { connect: { id: 'c1' } } } }, T);
    expect(out.data.client.connect).toEqual({ id: 'c1' });
  });

  it('does not mutate the caller arguments', () => {
    const args = { where: { deletedAt: null } };
    applyTenantScope('Client', 'findMany', args, T);
    expect(args).toEqual({ where: { deletedAt: null } });
  });
});
