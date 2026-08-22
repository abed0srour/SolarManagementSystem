import { PrismaService } from './prisma.service';
import { runAsTenant, runUnscoped, runWithTenantContext, setTenantContext } from '../common/tenant-context';

/**
 * The scoping extension against a real database.
 *
 * The unit tests next door prove the argument rewriting is correct. This proves
 * the rewriting is actually *reached* — that returning the extended client from
 * the PrismaService constructor really does mean every consumer gets a scoped
 * one, including inside an interactive transaction, which is where all the
 * money-handling code lives.
 *
 * Opt-in: set TEST_DATABASE_URL to a database with these migrations applied.
 * Without it the suite is skipped, so `npm test` stays offline and fast.
 *
 *   createdb sms_test
 *   psql -d sms_test -f supabase/migrations/...   # each in order
 *   TEST_DATABASE_URL=postgresql://... npx jest tenant-scope.integration
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb('tenant scoping against a real database', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    process.env.DIRECT_URL = TEST_URL;
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Every case runs inside its own request-shaped context. */
  const inRequest = <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      runWithTenantContext(() => {
        fn().then(resolve, reject);
      });
    });

  it('returns only the caller store, not the whole table', async () => {
    const names = await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: ALPHA });
      const clients = await prisma.client.findMany({ select: { name: true } });
      return clients.map((c) => c.name);
    });
    expect(names).toEqual(['Alpha Customer']);
  });

  it('gives a different store a different answer to the same query', async () => {
    const names = await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: BETA });
      const clients = await prisma.client.findMany({ select: { name: true } });
      return clients.map((c) => c.name);
    });
    expect(names).toEqual(['Beta Customer']);
  });

  it('cannot fetch another store row by its id', async () => {
    const found = await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: BETA });
      // 'c1' belongs to Alpha. Knowing the id is not enough.
      return prisma.client.findUnique({ where: { id: 'c1' } });
    });
    expect(found).toBeNull();
  });

  it('refuses a scoped query with no tenant, rather than spanning every store', async () => {
    await expect(inRequest(() => prisma.client.findMany())).rejects.toThrow(/No active tenant/);
  });

  it('stamps the tenant on a create without being asked', async () => {
    const created = await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: ALPHA });
      return prisma.client.create({ data: { name: 'Stamped By Extension' } });
    });
    expect(created.tenantId).toBe(ALPHA);
    await runUnscoped(() => prisma.client.delete({ where: { id: created.id } }));
  });

  it('applies inside an interactive transaction', async () => {
    // The property the money paths depend on: a tx client is extended too.
    const names = await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: ALPHA });
      return prisma.$transaction(async (tx) => {
        const clients = await tx.client.findMany({ select: { name: true } });
        return clients.map((c) => c.name);
      });
    });
    expect(names).toEqual(['Alpha Customer']);
  });

  it('stamps nested writes made inside a transaction', async () => {
    const result = await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: ALPHA });
      return prisma.$transaction(async (tx) => {
        const client = await tx.client.create({
          data: { name: 'Nested Parent', addresses: { create: [{ line1: 'Somewhere' }] } },
          include: { addresses: true },
        });
        return client;
      });
    });
    expect(result.tenantId).toBe(ALPHA);
    expect(result.addresses[0].tenantId).toBe(ALPHA);
    await runUnscoped(() => prisma.client.delete({ where: { id: result.id } }));
  });

  it('runAsTenant lets platform code read one store deliberately', async () => {
    const names = await inRequest(() =>
      runAsTenant(BETA, async () => {
        const clients = await prisma.client.findMany({ select: { name: true } });
        return clients.map((c) => c.name);
      }),
    );
    expect(names).toEqual(['Beta Customer']);
  });

  it('runUnscoped is the only way to see across stores', async () => {
    const count = await inRequest(() => runUnscoped(() => prisma.client.count()));
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('leaves unscoped models alone', async () => {
    // Tenant itself carries no tenantId, so listing stores must still work.
    const tenants = await inRequest(() => prisma.tenant.count());
    expect(tenants).toBeGreaterThanOrEqual(2);
  });
});
