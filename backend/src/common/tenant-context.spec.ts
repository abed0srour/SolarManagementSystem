import {
  getTenantContext,
  requireTenantId,
  runAsTenant,
  runUnscoped,
  runWithTenantContext,
  setTenantContext,
} from './tenant-context';

/** Run `fn` the way an HTTP request would: inside a fresh context. */
const inRequest = <T>(fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    runWithTenantContext(() => {
      fn().then(resolve, reject);
    });
  });

describe('tenant context', () => {
  it('starts empty and refuses to guess a tenant', async () => {
    await inRequest(async () => {
      expect(getTenantContext().mode).toBe('NONE');
      expect(() => requireTenantId()).toThrow(/No active tenant/);
    });
  });

  it('carries the tenant through awaits', async () => {
    await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: 't1' });
      await new Promise((r) => setTimeout(r, 5));
      expect(requireTenantId()).toBe('t1');
    });
  });

  it('keeps sibling requests apart', async () => {
    const seen = await Promise.all([
      inRequest(async () => {
        setTenantContext({ mode: 'TENANT', tenantId: 'a' });
        await new Promise((r) => setTimeout(r, 10));
        return requireTenantId();
      }),
      inRequest(async () => {
        setTenantContext({ mode: 'TENANT', tenantId: 'b' });
        await new Promise((r) => setTimeout(r, 1));
        return requireTenantId();
      }),
    ]);
    expect(seen).toEqual(['a', 'b']);
  });

  it('restores the outer tenant after runUnscoped returns', async () => {
    await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: 't1' });
      await runUnscoped(async () => {
        expect(getTenantContext().mode).toBe('UNSCOPED');
      });
      expect(getTenantContext().mode).toBe('TENANT');
      expect(requireTenantId()).toBe('t1');
    });
  });

  it('runAsTenant swaps the tenant and puts the old one back', async () => {
    await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: 't1' });
      const inner = await runAsTenant('t2', async () => requireTenantId());
      expect(inner).toBe('t2');
      expect(requireTenantId()).toBe('t1');
    });
  });

  /*
   * The regression these two guard against.
   *
   * A Prisma call returns a lazy promise -- nothing runs until something
   * subscribes. When the helpers passed the callback straight to
   * AsyncLocalStorage.run, a call site written the natural terse way
   * (`runUnscoped(() => prisma.tenant.findMany())`) handed the promise back
   * unsubscribed, the context closed, and the query then ran with no tenant
   * context at all. Every such call site was silently doing the opposite of
   * what it said. The helpers now await inside the context, so the deferred
   * form behaves like the awaited one.
   */
  it('holds the context open for a deferred callback (runUnscoped)', async () => {
    await inRequest(async () => {
      setTenantContext({ mode: 'TENANT', tenantId: 't1' });
      let modeWhenSubscribed: string | undefined;
      const deferred = {
        then(onFulfilled: (v: string) => void) {
          modeWhenSubscribed = getTenantContext().mode;
          onFulfilled('done');
        },
      };
      await runUnscoped(() => deferred as unknown as Promise<string>);
      expect(modeWhenSubscribed).toBe('UNSCOPED');
    });
  });

  it('holds the context open for a deferred callback (runAsTenant)', async () => {
    await inRequest(async () => {
      let tenantWhenSubscribed: string | null | undefined;
      const deferred = {
        then(onFulfilled: (v: string) => void) {
          tenantWhenSubscribed = getTenantContext().tenantId;
          onFulfilled('done');
        },
      };
      await runAsTenant('t9', () => deferred as unknown as Promise<string>);
      expect(tenantWhenSubscribed).toBe('t9');
    });
  });
});
