/** v1.4: selling loose pieces (Beensal 20 pcs = 16,000; 1=1,000 2=2,000 3=2,500 4=3,000 5=4,000 6=5,000 7=5,500 10=7,500).  Run: node tests/backend-loose.test.js */
const assert = require('assert');
const { makeEnv } = require('./gas-mock');
let passed = 0;
function t(name, f) { try { f(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } }
const env = makeEnv({ now: '2026-11-21T08:00:00Z' });
const pins = {}; env.ctx.setup().split('\n').forEach(l => { const m = l.match(/^(\w+): (\d{4})$/); if (m) pins[m[1]] = m[2]; });
const ids = {}; env.call('names').users.forEach(u => ids[u.name] = u.id);
const H = env.call('login', { userId: ids.Hussein, pin: pins.Hussein }), R = env.call('login', { userId: ids.Raxma, pin: pins.Raxma });
const TABLE = [[1, 1000], [2, 2000], [3, 2500], [4, 3000], [5, 4000], [6, 5000], [7, 5500], [10, 7500]];
let bee, cola, sh;
const prod = id => env.call('boot', {}, H.token).products.find(p => p.id === id);
const sell = (items, extra) => env.call('sync', { ops: [{ qid: 'q' + Math.random(), action: 'sale.create', data: Object.assign({ id: 'S' + Math.random().toString(36).slice(2), business: 'shop', method: 'cash', items }, extra || {}) }] }, R.token).results[0];

t('owner switches "sell loose" on: 20 pieces, price list; stock is kept in pieces', () => {
  const r = env.call('prod.save', { business: 'shop', name: 'Beensal', price: 16000, cost: 14000, stock: 87, lowStock: 3, loose: 1, perPack: 20, looseTable: TABLE.concat([[0, 5], [25, 1], [3, 999]]) }, H.token);
  assert.ok(r.ok, r.error); bee = r.product;
  assert.strictEqual(bee.loose, 1); assert.strictEqual(+bee.perPack, 20); assert.strictEqual(+bee.stock, 87);
  assert.deepStrictEqual(JSON.parse(bee.looseTable), TABLE, 'bad rows dropped, first 3 kept');
  cola = env.call('prod.save', { business: 'shop', name: 'Cola', price: 3000, cost: 2000, stock: 50 }, H.token).product;
  assert.ok(!cola.loose);
  sh = env.call('shift.open', { business: 'shop', openCash: 0 }, R.token).shift;
});
t('prices from the list, added up for missing amounts, never more than a packet', () => {
  const P = env.ctx.loosePrice_;
  const b = Object.assign({}, bee);
  const exp = { 1: 1000, 2: 2000, 3: 2500, 4: 3000, 5: 4000, 6: 5000, 7: 5500, 8: 6500, 9: 7500, 10: 7500, 11: 8500, 13: 10000, 18: 14000, 19: 15000, 20: 16000, 23: 18500, 40: 32000 };
  for (const n in exp) assert.strictEqual(P(b, +n), exp[n], n + ' pieces');
});
t('selling 3 pieces + 1 packet + 2 colas: right total, profit and stock', () => {
  const r = sell([{ productId: bee.id, qty: 3, unit: 'pc' }, { productId: bee.id, qty: 1 }, { productId: cola.id, qty: 2, unit: 'pc' }]);
  assert.ok(r.ok, r.error);
  const s = r.result.sale; assert.strictEqual(s.subtotal, 2500 + 16000 + 6000); assert.strictEqual(s.total, 24500);
  assert.strictEqual(s.cost, 3 * 700 + 14000 + 4000);
  assert.strictEqual(+prod(bee.id).stock, 87 - 23); assert.strictEqual(+prod(cola.id).stock, 48, '"pc" is ignored for normal items');
  const items = env.sheets.SaleItems.data.slice(-3).map(r => r[9]); assert.deepStrictEqual(items, ['pc', '', '']);
});
t('cannot cheat the price: the server works it out from the Sheet', () => {
  const r = sell([{ productId: bee.id, qty: 9, unit: 'pc', price: 1 }]); assert.ok(r.ok);
  assert.strictEqual(r.result.sale.total, 7500); assert.strictEqual(+prod(bee.id).stock, 64 - 9);
});
let refundSale;
t('refund of pieces puts pieces back; packet line kept separate', () => {
  const r = sell([{ productId: bee.id, qty: 4, unit: 'pc' }, { productId: bee.id, qty: 1 }]); refundSale = r.result.sale;
  const before = +prod(bee.id).stock;
  const rq = env.call('refund.request', { id: 'RF1', saleId: refundSale.id, reason: 'test', items: [{ productId: bee.id, unit: 'pc', qty: 4 }] }, R.token); assert.ok(rq.ok, rq.error);
  assert.strictEqual(rq.refund.amount, 3000);
  assert.ok(/Too many/.test(env.call('refund.request', { id: 'RF2', saleId: refundSale.id, reason: 'x', items: [{ productId: bee.id, unit: 'pc', qty: 1 }] }, R.token).error));
  assert.ok(env.call('refund.decide', { id: 'RF1', approve: true }, H.token).ok);
  assert.strictEqual(+prod(bee.id).stock, before + 4);
});
t('undo a sale with pieces gives the pieces back', () => {
  const r = sell([{ productId: bee.id, qty: 7, unit: 'pc' }]); const before = +prod(bee.id).stock;
  assert.ok(env.call('sale.undo', { id: r.result.sale.id, reason: 'Wrong item' }, R.token).ok);
  assert.strictEqual(+prod(bee.id).stock, before + 7);
});
t('low stock is counted in packets (warn at 3 packets = 60 pieces) and shown as "pk + pcs"', () => {
  env.call('recip.save', { name: 'Hussein', email: 'h@example.com', lowStock: 1 }, H.token);
  assert.ok(env.call('stock.count', { id: 'CNT1', counts: [{ productId: bee.id, counted: 70 }] }, H.token).ok);   // count in pieces
  const mails = env.mail.length;
  const r = sell([{ productId: bee.id, qty: 11, unit: 'pc' }]); assert.ok(r.ok, r.error);
  assert.strictEqual(+prod(bee.id).stock, 59);
  const m = env.mail.slice(mails).find(x => /Low stock/.test(x.subject));
  assert.ok(m, 'low-stock email'); assert.ok(/2 pk \+ 19 pcs/.test(m.subject + m.htmlBody), m.subject);
  const rep = env.call('report', { business: 'shop' }, H.token);
  const low = rep.lowStock.find(x => x.id === bee.id); assert.ok(low); assert.strictEqual(low.stockTxt, '2 pk + 19 pcs');
  const ls = rep.looseSales.find(x => x.productId === bee.id); assert.ok(ls && ls.pcs > 0 && ls.qty >= 1, JSON.stringify(ls));
});
t('buying from a supplier is in packets', () => {
  const s = env.call('sup.save', { business: 'shop', name: 'Xasan Wholesale' }, H.token).supplier;
  const r = env.call('sup.purchase', { id: 'PU1', supplierId: s.id, items: [{ kind: 'p', refId: bee.id, qty: 10, cost: 14000 }], paid: 140000, method: 'cash' }, H.token);
  assert.ok(r.ok, r.error); assert.strictEqual(+prod(bee.id).stock, 59 + 200);
});
t('switching loose off needs "manage products"; switching off keeps the number as it is', () => {
  const p = prod(bee.id);
  const r = env.call('prod.save', Object.assign({}, p, { loose: 0, stock: 12, looseTable: [] }), H.token); assert.ok(r.ok, r.error);
  assert.ok(!r.product.loose); assert.strictEqual(+r.product.stock, 12);
  const s2 = sell([{ productId: bee.id, qty: 2, unit: 'pc' }]); assert.strictEqual(s2.result.sale.total, 32000, 'now sold as whole packets only');
});
console.log(passed + ' passed');
