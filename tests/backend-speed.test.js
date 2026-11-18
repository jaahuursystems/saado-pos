/** v1.2.1: Shift screen reads only recent rows; results must match a full read even with a big history.  Run: node tests/backend-speed.test.js */
const assert = require('assert');
const { makeEnv } = require('./gas-mock');
let passed = 0;
function t(name, f) { try { f(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } }
const env = makeEnv({ now: '2026-08-10T13:00:00Z' });
const pins = {}; env.ctx.setup().split('\n').forEach(l => { const m = l.match(/^(\w+): (\d{4})$/); if (m) pins[m[1]] = m[2]; });
const ids = {}; env.call('names').users.forEach(u => ids[u.name] = u.id);
const H = env.call('login', { userId: ids.Hussein, pin: pins.Hussein });
const R = env.call('login', { userId: ids.Raxma, pin: pins.Raxma });
const cola = env.call('prod.save', { business: 'shop', name: 'Cola', price: 3000, cost: 2000, stock: 100000 }, H.token).product;
// 5,000 old sales rows (2025) written straight into the Sheet, as if the shop had sold for a year
const S = env.sheets.Sales, I = env.sheets.SaleItems, hs = S.data[0], hi = I.data[0];
for (let k = 0; k < 5000; k++) {
  const d = '2025-' + String(1 + (k % 12)).padStart(2, '0') + '-' + String(1 + (k % 28)).padStart(2, '0');
  const row = hs.map(h => ({ id: 'OLD' + k, ts: d + 'T10:00:00', date: d, business: 'shop', userId: ids.Raxma, shiftId: 'OLDSHIFT', method: 'cash', total: 3000, status: 'done' })[h] ?? '');
  S.data.push(row); I.data.push(hi.map(h => ({ saleId: 'OLD' + k, date: d, business: 'shop', productId: cola.id, name: 'Cola', qty: 1, price: 3000 })[h] ?? ''));
}
let sh;
t('shift.live after a year of history: totals, sales with items, one call', () => {
  sh = env.call('shift.open', { business: 'shop', openCash: 1000 }, R.token).shift;
  for (let k = 0; k < 3; k++) { const r = env.call('sync', { ops: [{ qid: 'q' + k, action: 'sale.create', data: { id: 'NEW' + k, business: 'shop', method: 'cash', items: [{ productId: cola.id, qty: 2 }] } }] }, R.token); assert.ok(r.results[0].ok, r.results[0].error); }
  const r = env.call('shift.live', { id: sh.id }, R.token);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.totals.eCashSH, 1000 + 3 * 6000);
  assert.strictEqual(r.sales.length, 3); assert.strictEqual(r.sales[0].items[0].qty, 2);
  const p = env.call('shift.preview', { id: sh.id }, R.token); assert.deepStrictEqual(p.totals, r.totals);
});
t('retrying an old sale id is still caught as a duplicate', () => {
  const r = env.call('sync', { ops: [{ qid: 'z', action: 'sale.create', data: { id: 'NEW1', business: 'shop', method: 'cash', items: [{ productId: cola.id, qty: 2 }] } }] }, R.token);
  assert.strictEqual(r.results[0].result.dup, true);
});
t('sales.list for an old range still finds old sales (reads further back when needed)', () => {
  const r = env.call('sales.list', { business: 'shop', from: '2025-03-01', to: '2025-03-31' }, H.token);
  assert.ok(r.sales.length > 100, r.sales.length); assert.ok(r.sales.every(s => s.items.length === 1));
  const today = env.call('sales.list', { business: 'shop' }, H.token); assert.strictEqual(today.sales.length, 3);
});
t('closing the shift uses the same numbers', () => {
  const c = env.call('shift.close', { id: sh.id, closeCash: 19000 }, R.token); assert.ok(c.ok, c.error);
  assert.strictEqual(c.shift.diffAll, 0);
});
console.log(passed + ' passed');
