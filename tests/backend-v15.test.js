/** v1.5: change from Zaad/Edahab, Exchange Zaad/Edahab <-> cash, items priced in dollars.  Run: node tests/backend-v15.test.js */
const assert = require('assert');
const { makeEnv } = require('./gas-mock');
let passed = 0;
function t(name, f) { try { f(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } }
const env = makeEnv({ now: '2026-11-22T07:00:00Z' });   // 10:00 in Hargeisa
const pins = {}; env.ctx.setup().split('\n').forEach(l => { const m = l.match(/^(\w+): (\d{4})$/); if (m) pins[m[1]] = m[2]; });
const ids = {}; env.call('names').users.forEach(u => ids[u.name] = u.id);
const H = env.call('login', { userId: ids.Hussein, pin: pins.Hussein });
let R = env.call('login', { userId: ids.Raxma, pin: pins.Raxma });
const op = (action, data, tok) => env.call('sync', { ops: [{ qid: 'q' + Math.random(), action, data: Object.assign({ id: 'X' + Math.random().toString(36).slice(2) }, data) }] }, tok || R.token).results[0];
let sh, biscuit;
const live = () => env.call('shift.live', { id: sh.id }, R.token).totals;
t('setup: Exchanges tab and the "exchange" permission (not given by default)', () => {
  assert.ok(env.sheets.Exchanges); assert.ok(!R.user.perms.includes('exchange'));
  biscuit = env.call('prod.save', { business: 'shop', name: 'Biscuit', price: 2000, cost: 1500, stock: 100 }, H.token).product;
  sh = env.call('shift.open', { business: 'shop', openCash: 50000, openCashUSD: 10 }, R.token).shift;
});
t('Zaad 4,000 sent for a 2,000 sale: Zaad +4,000, cash drawer −2,000', () => {
  const r = op('sale.create', { business: 'shop', method: 'zaad', tendered: 4000, tenderCur: 'SH', items: [{ productId: biscuit.id, qty: 1 }] });
  assert.ok(r.ok, r.error); assert.strictEqual(r.result.sale.change, 2000);
  const L = live(); assert.strictEqual(L.eZaadSH, 4000); assert.strictEqual(L.eCashSH, 48000); assert.strictEqual(L.zaadSales, 2000);
});
t('Edahab $5 sent for a 52,000 sale: Edahab +$5, cash −7,250 SH', () => {
  const big = env.call('prod.save', { business: 'shop', name: 'Rice', price: 52000, cost: 45000, stock: 10 }, H.token).product;
  const r = op('sale.create', { business: 'shop', method: 'edahab', payCur: 'USD', tendered: 5, tenderCur: 'USD', items: [{ productId: big.id, qty: 1 }] });
  assert.ok(r.ok, r.error); assert.strictEqual(r.result.sale.change, 7250);
  const L = live(); assert.strictEqual(L.eEdUSD, 5); assert.strictEqual(L.eCashSH, 48000 - 7250);
});
t('sent less than the total is refused; exact Zaad (no amount typed) works as before', () => {
  assert.ok(/less than the total/.test(op('sale.create', { business: 'shop', method: 'zaad', tendered: 1000, items: [{ productId: biscuit.id, qty: 1 }] }).error));
  const before = live();
  assert.ok(op('sale.create', { business: 'shop', method: 'zaad', items: [{ productId: biscuit.id, qty: 1 }] }).ok);
  const L = live(); assert.strictEqual(L.eZaadSH - before.eZaadSH, 2000); assert.strictEqual(L.eCashSH, before.eCashSH);
});
t('exchange needs the ticked permission', () => {
  assert.ok(/NOPERM/.test(op('exch.create', { business: 'shop', dir: 'in', account: 'zaad', recvAmount: 10000, giveAmount: 10000 }).error));
  const u = env.call('users.list', {}, H.token).users.find(x => x.name === 'Raxma');
  assert.ok(env.call('users.save', Object.assign({}, u, { perms: u.perms.concat(['exchange']) }), H.token).ok);
  R = env.call('login', { userId: ids.Raxma, pin: pins.Raxma });
});
t('exchanges move money between cash and Zaad/Edahab; a fee stays in the drawer', () => {
  const b = live();
  assert.ok(op('exch.create', { business: 'shop', dir: 'in', account: 'zaad', recvAmount: 50000, recvCur: 'SH', giveAmount: 49000, giveCur: 'SH', customer: 'Axmed' }).ok);
  assert.ok(op('exch.create', { business: 'shop', dir: 'out', account: 'edahab', recvAmount: 20, recvCur: 'USD', giveAmount: 20, giveCur: 'USD' }).ok);
  const L = live();
  assert.strictEqual(L.eZaadSH - b.eZaadSH, 50000); assert.strictEqual(L.eCashSH - b.eCashSH, -49000);
  assert.strictEqual(L.eCashUSD - b.eCashUSD, 20); assert.strictEqual(L.eEdUSD - b.eEdUSD, -20);
  assert.strictEqual(L.exCount, 2); assert.strictEqual(L.exFees, 1000);
  assert.ok(/more than you received/.test(op('exch.create', { business: 'shop', dir: 'in', account: 'zaad', recvAmount: 1000, giveAmount: 5000 }).error));
});
t('undo an exchange while the shift is open; it stays in the list, marked undone', () => {
  const x = env.call('shift.live', { id: sh.id }, R.token).exchanges.find(e => e.customer === 'Axmed');
  const b = live();
  assert.ok(env.call('exch.undo', { id: x.id }, R.token).ok);
  const L = live(); assert.strictEqual(L.eZaadSH - b.eZaadSH, -50000); assert.strictEqual(L.eCashSH - b.eCashSH, 49000);
  assert.strictEqual(env.call('shift.live', { id: sh.id }, R.token).exchanges.find(e => e.id === x.id).status, 'undone');
});
t('closing the shift with these counts comes out exact', () => {
  const L = live();
  const c = env.call('shift.close', { id: sh.id, closeCash: L.eCashSH, closeCashUSD: L.eCashUSD, closeZaadSH: L.eZaadSH, closeZaadUSD: L.eZaadUSD, closeEdSH: L.eEdSH, closeEdUSD: L.eEdUSD }, R.token);
  assert.ok(c.ok, c.error); assert.strictEqual(c.shift.diffAll, 0);
  const rep = env.call('report', { business: 'shop' }, H.token); assert.strictEqual(rep.exchanges.length, 1);
});
let shampoo;
t('item priced in dollars: shilling price from the rate', () => {
  const r = env.call('prod.save', { business: 'shop', name: 'Shampoo', priceCur: 'USD', priceUSD: 2.5, costUSD: 1.8, price: 1, cost: 1, stock: 18 }, H.token);
  assert.ok(r.ok, r.error); shampoo = r.product;
  assert.strictEqual(shampoo.price, 29625); assert.strictEqual(shampoo.cost, 21330); assert.strictEqual(shampoo.priceUSD, 2.5);
  assert.ok(/dollars/.test(env.call('prod.save', { business: 'shop', name: 'X', priceCur: 'USD', priceUSD: 0 }, H.token).error));
});
t('new dollar rate re-prices dollar items; old sales keep their price', () => {
  sh = env.call('shift.open', { business: 'shop', openCash: 0 }, R.token).shift;
  const s1 = op('sale.create', { business: 'shop', method: 'cash', items: [{ productId: shampoo.id, qty: 2 }] }); assert.strictEqual(s1.result.sale.subtotal, 59250);
  const b = env.call('settings.save', { values: { usdRate: '12000' } }, H.token); assert.ok(b.ok, b.error);
  const p = b.products.find(x => x.id === shampoo.id); assert.strictEqual(p.price, 30000); assert.strictEqual(p.cost, 21600);
  assert.strictEqual(b.products.find(x => x.id === biscuit.id).price, 2000, 'SH items unchanged');
  const s2 = op('sale.create', { business: 'shop', method: 'cash', items: [{ productId: shampoo.id, qty: 1 }] }); assert.strictEqual(s2.result.sale.subtotal, 30000);
  const old = env.call('sales.list', { business: 'shop' }, H.token).sales.find(s => s.id === s1.result.sale.id); assert.strictEqual(old.subtotal, 59250);
});
t('switching back to shillings keeps the price you type', () => {
  const r = env.call('prod.save', Object.assign({}, shampoo, { priceCur: 'SH', price: 31000, cost: 22000 }), H.token); assert.ok(r.ok, r.error);
  assert.strictEqual(r.product.priceCur, ''); assert.strictEqual(r.product.price, 31000);
});
console.log(passed + ' passed');
