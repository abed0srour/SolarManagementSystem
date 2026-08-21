import { NotificationsService } from './notifications.service';

/**
 * The bug these cover: a notification reappeared after being marked seen.
 *
 * `notifyOnce` deduped against unread rows only, so the hourly cron found no
 * open alert for a condition that was still true and created a fresh one.
 * Marking something seen bought at most an hour.
 *
 * The service now syncs stored notifications to the conditions that hold right
 * now — create what is missing, delete what has cleared, leave read rows alone
 * while their condition persists. No database here; a stub Prisma records the
 * calls and answers the reads.
 */
type Row = { id: string; type: string; entity: string; entityId: string; message: string; isRead: boolean };

function stubPrisma(rows: Row[]) {
  const matches = (r: Row, where: any) => {
    if (where.type && r.type !== where.type) return false;
    if (where.entity && r.entity !== where.entity) return false;
    if (where.entityId?.in && !where.entityId.in.includes(r.entityId)) return false;
    if (where.entityId?.notIn && where.entityId.notIn.includes(r.entityId)) return false;
    if (where.entityId && typeof where.entityId === 'string' && r.entityId !== where.entityId) return false;
    if (typeof where.isRead === 'boolean' && r.isRead !== where.isRead) return false;
    return true;
  };
  return {
    rows,
    notification: {
      deleteMany: jest.fn(async ({ where }: any) => {
        const keep = rows.filter((r) => !matches(r, where));
        const deleted = rows.length - keep.length;
        rows.length = 0;
        rows.push(...keep);
        return { count: deleted };
      }),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where))),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) rows.push({ id: `n${rows.length + 1}`, isRead: false, ...d });
        return { count: data.length };
      }),
    },
  };
}

/** The helper is private; these tests exercise it as the checks do. */
const sync = (svc: NotificationsService, ...args: any[]) => (svc as any).syncNotifications(...args);

describe('notification syncing', () => {
  it('creates a notification for a condition that has no row yet', async () => {
    const prisma = stubPrisma([]);
    const svc = new NotificationsService(prisma as any);

    await sync(svc, 'LOW_STOCK', 'Product', [{ id: 'p1', message: 'Low stock: Panel' }]);

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toMatchObject({ type: 'LOW_STOCK', entity: 'Product', entityId: 'p1' });
  });

  it('does not recreate an alert the user has already read', async () => {
    // This is the reported bug: the row exists but is read, and the condition
    // still holds. Before the fix a second row was created here.
    const prisma = stubPrisma([
      { id: 'n1', type: 'LOW_STOCK', entity: 'Product', entityId: 'p1', message: 'Low stock: Panel', isRead: true },
    ]);
    const svc = new NotificationsService(prisma as any);

    await sync(svc, 'LOW_STOCK', 'Product', [{ id: 'p1', message: 'Low stock: Panel' }]);

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(prisma.rows[0].isRead).toBe(true);
  });

  it('clears an alert once its condition no longer holds', async () => {
    const prisma = stubPrisma([
      { id: 'n1', type: 'LOW_STOCK', entity: 'Product', entityId: 'p1', message: 'Low stock: Panel', isRead: true },
    ]);
    const svc = new NotificationsService(prisma as any);

    await sync(svc, 'LOW_STOCK', 'Product', []); // restocked

    expect(prisma.rows).toHaveLength(0);
  });

  it('alerts again if the condition recurs after being cleared', async () => {
    // Deleting on resolution is what makes recurrence work. A blanket "never
    // notify twice" rule would leave the second dip silent.
    const prisma = stubPrisma([]);
    const svc = new NotificationsService(prisma as any);

    await sync(svc, 'LOW_STOCK', 'Product', [{ id: 'p1', message: 'low' }]);
    prisma.rows[0].isRead = true;
    await sync(svc, 'LOW_STOCK', 'Product', []); // restocked, alert cleared
    await sync(svc, 'LOW_STOCK', 'Product', [{ id: 'p1', message: 'low again' }]);

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].isRead).toBe(false);
    expect(prisma.rows[0].message).toBe('low again');
  });

  it('leaves other types and entities alone', async () => {
    const prisma = stubPrisma([
      { id: 'n1', type: 'PAYMENT_DUE', entity: 'PaymentSchedule', entityId: 's1', message: 'due', isRead: false },
      { id: 'n2', type: 'LOW_STOCK', entity: 'Product', entityId: 'p9', message: 'low', isRead: false },
    ]);
    const svc = new NotificationsService(prisma as any);

    // Syncing one (type, entity) pair must not disturb a different pair, even
    // when it clears everything for its own.
    await sync(svc, 'LOW_STOCK', 'Product', []);

    expect(prisma.rows.map((r) => r.id)).toEqual(['n1']);
  });

  it('adds only the conditions that are missing, in a mixed set', async () => {
    const prisma = stubPrisma([
      { id: 'n1', type: 'LOW_STOCK', entity: 'Product', entityId: 'p1', message: 'low', isRead: true },
      { id: 'n2', type: 'LOW_STOCK', entity: 'Product', entityId: 'pGone', message: 'low', isRead: false },
    ]);
    const svc = new NotificationsService(prisma as any);

    await sync(svc, 'LOW_STOCK', 'Product', [
      { id: 'p1', message: 'low' },
      { id: 'p2', message: 'low' },
    ]);

    const ids = prisma.rows.map((r) => r.entityId).sort();
    expect(ids).toEqual(['p1', 'p2']);
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
  });
});
