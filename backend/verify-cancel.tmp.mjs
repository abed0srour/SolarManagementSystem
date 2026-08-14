import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const API = 'http://localhost:3000/api';
let pass = 0, fail = 0;
const log = (l, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  — ' + d : ''}`); };

const call = async (m, p, b, tok) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j?.data ?? j, raw: j };
};

const { body: auth } = await call('POST', '/auth/login', { email: 'abd.srour313@gmail.com', password: 'admin123' });
const token = auth.accessToken;
const client = await prisma.client.findFirst({ where: { deletedAt: null }, select: { id: true } });
const wh = (await call('GET', '/inventory/warehouses', null, token)).body[0];
const prod = await prisma.product.findFirst({
  where: { deletedAt: null, isService: false, salePrice: { gt: 0 }, stockLevels: { some: { quantity: { gt: 8 } } } },
  select: { id: true, sku: true },
});
const qtyOf = async () =>
  Number((await prisma.stockLevel.aggregate({ where: { productId: prod.id }, _sum: { quantity: true } }))._sum.quantity);

const makeOrder = async () =>
  (await call('POST', '/sales-orders', { clientId: client.id, warehouseId: wh.id, notes: 'VERIFY cancel', items: [{ productId: prod.id, quantity: 2 }] }, token)).body;

console.log('--- CONFIRMED ORDERS STAY CANCELLABLE ---');
const startQty = await qtyOf();
const a = await makeOrder();
log('pending order is cancellable', (await call('GET', `/sales-orders/${a.id}`, null, token)).body.cancellable === true);
await call('POST', `/sales-orders/${a.id}/confirm`, {}, token);
const afterConfirm = await call('GET', `/sales-orders/${a.id}`, null, token);
log('confirmed order is STILL cancellable', afterConfirm.body.cancellable === true,
    `reason ${afterConfirm.body.cancelBlockedReason}`);
log('confirm drew stock', (await qtyOf()) === startQty - 2, `${await qtyOf()} vs ${startQty - 2}`);
const cancelled = await call('POST', `/sales-orders/${a.id}/cancel`, {}, token);
log('cancelling a confirmed order works', cancelled.status < 300, `status ${cancelled.status}`);
log('stock restored by the cancel', (await qtyOf()) === startQty, `${await qtyOf()} vs ${startQty}`);
log('cancelled order reports ALREADY_CANCELLED', (await call('GET', `/sales-orders/${a.id}`, null, token)).body.cancelBlockedReason === 'ALREADY_CANCELLED');

console.log('\n--- COLLECTED ORDER MUST NOT BE CANCELLABLE (the bug) ---');
const b = await makeOrder();
await call('POST', `/sales-orders/${b.id}/confirm`, {}, token);
const qtyAfterConfirmB = await qtyOf();
const tok = await call('GET', `/sales-orders/${b.id}/pickup-token`, null, token);
const claim = await call('POST', '/sales-orders/pickup/claim-token', { token: tok.body.token }, token);
log('order collected via QR', claim.status < 300, `status ${claim.status}`);
const afterClaim = await call('GET', `/sales-orders/${b.id}`, null, token);
log('status is still CONFIRMED after collection', afterClaim.body.status === 'CONFIRMED', afterClaim.body.status);
log('collected order reports NOT cancellable', afterClaim.body.cancellable === false, `reason ${afterClaim.body.cancelBlockedReason}`);
log('reason is COLLECTED', afterClaim.body.cancelBlockedReason === 'COLLECTED');
const badCancel = await call('POST', `/sales-orders/${b.id}/cancel`, {}, token);
log('server refuses to cancel a collected order', badCancel.status === 400, `${badCancel.status} ${badCancel.raw?.message}`);
log('no phantom stock created', (await qtyOf()) === qtyAfterConfirmB, `${await qtyOf()} vs ${qtyAfterConfirmB}`);

console.log('\n--- PAID ORDER MUST NOT BE CANCELLABLE ---');
const c = await makeOrder();
await call('POST', `/sales-orders/${c.id}/confirm`, {}, token);
const inv = await call('POST', '/invoices/from-order', { salesOrderId: c.id }, token);
const payment = await call('POST', '/payments', { direction: 'INCOMING', invoiceId: inv.body.id, clientId: client.id, method: 'CASH', amount: 10 }, token);
log('partial payment recorded', payment.status < 300, `status ${payment.status}`);
const afterPay = await call('GET', `/sales-orders/${c.id}`, null, token);
log('paid order reports NOT cancellable', afterPay.body.cancellable === false, `reason ${afterPay.body.cancelBlockedReason}`);
const paidCancel = await call('POST', `/sales-orders/${c.id}/cancel`, {}, token);
log('server refuses to cancel a paid order', paidCancel.status === 400, `${paidCancel.status} ${paidCancel.raw?.message}`);

console.log('\n--- LIST ROWS CARRY THE SAME VERDICT ---');
const list = await call('GET', '/sales-orders?pageSize=50', null, token);
const row = list.body.items.find((o) => o.id === b.id);
log('list row exposes cancellable', row && row.cancellable === false, `cancellable=${row?.cancellable} reason=${row?.cancelBlockedReason}`);
log('list and detail agree', row?.cancelBlockedReason === afterClaim.body.cancelBlockedReason);

// --- cleanup
const ids = [a.id, b.id, c.id];
for (const id of ids) {
  await prisma.payment.deleteMany({ where: { invoice: { salesOrderId: id } } });
  await prisma.invoice.deleteMany({ where: { salesOrderId: id } });
}
await prisma.stockMovement.deleteMany({ where: { refId: { in: ids } } });
await prisma.salesOrder.deleteMany({ where: { id: { in: ids } } });
// b and c drew stock and were never cancelled, so put it back by hand.
const finalQty = await qtyOf();
if (finalQty !== startQty) {
  const level = await prisma.stockLevel.findFirst({ where: { productId: prod.id, warehouseId: wh.id } });
  await prisma.stockLevel.update({ where: { id: level.id }, data: { quantity: { increment: startQty - finalQty } } });
}
log('stock restored to snapshot', (await qtyOf()) === startQty, `${await qtyOf()} vs ${startQty}`);
log('test orders removed', (await prisma.salesOrder.count({ where: { id: { in: ids } } })) === 0);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
