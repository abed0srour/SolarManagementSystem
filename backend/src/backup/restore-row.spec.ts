import { buildRestoreRow, BuildRowContext, RestoreFieldDef } from './restore-row';

const f = (name: string, type: string, isRequired = true): RestoreFieldDef => ({
  name,
  kind: 'scalar',
  type,
  isRequired,
});

/** An Invoice-shaped model: tenant-scoped, created by a user, tied to a client. */
function invoiceContext(over: Partial<BuildRowContext> = {}): BuildRowContext {
  return {
    fieldMap: new Map<string, RestoreFieldDef>([
      ['id', f('id', 'String')],
      ['number', f('number', 'String')],
      ['total', f('total', 'Decimal')],
      ['issueDate', f('issueDate', 'DateTime')],
      ['notes', f('notes', 'String', false)],
      ['clientId', f('clientId', 'String', false)],
      ['createdById', f('createdById', 'String')],
      ['tenantId', f('tenantId', 'String')],
    ]),
    relationFieldMap: new Map([
      ['clientId', 'Client'],
      ['createdById', 'User'],
      ['tenantId', 'Tenant'],
    ]),
    knownIdsByModel: new Map([
      ['Tenant', new Set(['tenant-here'])],
      ['User', new Set(['user-here'])],
      ['Client', new Set(['client-here'])],
    ]),
    tenantId: 'tenant-here',
    fallbackUserId: 'user-here',
    ...over,
  };
}

const rowFromOtherEnvironment = {
  id: 'inv-1',
  number: 'INV-00001',
  total: '"1250.50"',
  issueDate: '2026-08-20T08:00:00.000Z',
  notes: '',
  clientId: 'client-here',
  createdById: 'user-from-production',
  tenantId: 'tenant-from-production',
};

describe('buildRestoreRow', () => {
  it('keeps a row whose tenantId belongs to another store, and re-scopes it', () => {
    const out = buildRestoreRow(rowFromOtherEnvironment, invoiceContext());

    // The regression this exists for: every row used to be discarded here,
    // while the restore still reported success.
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.tenantId).toBe('tenant-here');
  });

  it('adopts an unknown createdById rather than discarding the invoice', () => {
    const out = buildRestoreRow(rowFromOtherEnvironment, invoiceContext());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.createdById).toBe('user-here');
  });

  it('still drops a row whose required non-user parent is missing', () => {
    const ctx = invoiceContext({
      fieldMap: new Map<string, RestoreFieldDef>([
        ['id', f('id', 'String')],
        ['salesOrderId', f('salesOrderId', 'String')],
        ['tenantId', f('tenantId', 'String')],
      ]),
      relationFieldMap: new Map([
        ['salesOrderId', 'SalesOrder'],
        ['tenantId', 'Tenant'],
      ]),
      knownIdsByModel: new Map([['SalesOrder', new Set(['so-here'])]]),
    });

    const out = buildRestoreRow({ id: 'x', salesOrderId: 'so-missing', tenantId: 't' }, ctx);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain('SalesOrder');
  });

  it('nulls an optional reference that cannot be resolved', () => {
    const out = buildRestoreRow({ ...rowFromOtherEnvironment, clientId: 'client-gone' }, invoiceContext());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.clientId).toBeNull();
  });

  it('parses the quote-wrapped decimals the CSV exporter produces', () => {
    const out = buildRestoreRow(rowFromOtherEnvironment, invoiceContext());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.total).toBe(1250.5);
  });

  it('fills required blanks and nulls optional ones', () => {
    const out = buildRestoreRow({ ...rowFromOtherEnvironment, number: '', notes: '' }, invoiceContext());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.number).toBe('');
    expect(out.row.notes).toBeNull();
  });

  it('ignores columns the current schema no longer has', () => {
    const out = buildRestoreRow({ ...rowFromOtherEnvironment, legacyColumn: 'x' }, invoiceContext());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row).not.toHaveProperty('legacyColumn');
  });

  it('drops an unknown required user reference when there is nobody to adopt it', () => {
    const out = buildRestoreRow(rowFromOtherEnvironment, invoiceContext({ fallbackUserId: null }));
    expect(out.ok).toBe(false);
  });
});
