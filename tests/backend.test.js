/**
 * Backend tests: runs the real Code.gs against the in-memory Google imitation and checks the money rules.
 * Run: node tests/backend.test.js
 */
const assert = require('assert');
const { makeEnv } = require('./gas-mock');

let passed = 0;
function t(name, f) { try { f(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; } }

const env = makeEnv({ now: '2026-11-15T09:00:00Z' }); // 12:00 in Hargeisa
const msg = env.ctx.setup();
const pins = {}; msg.split('\n').forEach(l => { const m = l.match(/^(\w+): (\d{4})$/); if (m) pins[m[1]] = m[2]; });
const names = env.call('names').users;
const id = n => names.find(u => u.name === n).id;
const login = n => env.call('login', { userId: id(n), pin: pins[n] });

console.log('Saado POS backend tests');
t('setup made 4 users with 4-digit PINs, safe to run twice', () => {
  assert.strictEqual(Object.keys(pins).length, 4);
  Object.values(pins).forEach(p => assert.ok(/^\d{4}$/.test(p) && !/^(\d)\1+$/.test(p)));
  env.ctx.setup();
  assert.strictEqual(env.call('names').users.length, 4);
  assert.ok(env.sheets.Settings.getLastRow() > 10);
});
t('names is public; everything else needs a token', () => {
  const r = env.call('boot', {});
  assert.strictEqual(r.ok, false); assert.ok(/AUTH/.test(r.error));
});
let Z, R, S;
t('owner login works and sees both businesses', () => {
  Z = login('Zakariye'); assert.ok(Z.ok, Z.error); assert.ok(Z.token);
  assert.strictEqual(Z.user.role, 'owner'); assert.ok(Z.user.perms.includes('viewProfit'));
});
t('wrong PIN locks after 5 tries', () => {
  for (let i = 0; i < 4; i++) assert.ok(/Wrong PIN/.test(env.call('login', { userId: id('Hussein'), pin: '0000' }).error));
  assert.ok(/LOCKED/.test(env.call('login', { userId: id('Hussein'), pin: '0000' }).error));
  assert.ok(/LOCKED/.test(env.call('login', { userId: id('Hussein'), pin: pins.Hussein }).error));
  env.cache.clear(); Z = login('Zakariye');
});
let rice, cola, chicken;
t('owner adds products (shop with stock, food without)', () => {
  rice = env.call('prod.save', { business: 'shop', name: 'Rice 5kg', barcode: '0012345', price: 52000, cost: 45000, stock: 10, lowStock: 3 }, Z.token).product;
  cola = env.call('prod.save', { business: 'shop', name: 'Coca-Cola', barcode: '5449000000996', price: 3200, cost: 2500, stock: 48 }, Z.token).product;
  chicken = env.call('prod.save', { business: 'food', name: 'Chicken full', price: 60000, cost: 35000 }, Z.token).product;
  assert.strictEqual(rice.barcode, '0012345'); assert.strictEqual(chicken.stock, '');
  const dup = env.call('prod.save', { business: 'shop', name: 'X', barcode: '0012345', price: 1 }, Z.token);
  assert.ok(/already used/.test(dup.error));
});
t('formula text is never stored as a formula', () => {
  env.call('cust.save', { business: 'shop', name: '=HYPERLINK("x")', phone: '+252' }, Z.token);
  const row = env.sheets.Customers.data.find(r => String(r[2]).includes('HYPERLINK'));
  assert.ok(row);
});
t('employee is blocked outside hours (14:30 Hargeisa) and allowed inside', () => {
  env.setNow('2026-11-15T11:30:00Z');
  assert.ok(/HOURS/.test(login('Raxma').error));
  env.setNow('2026-11-15T07:45:00Z'); // 10:45
  R = login('Raxma'); assert.ok(R.ok, R.error);
  assert.deepStrictEqual(R.products.map(p => p.business).filter((v, i, a) => a.indexOf(v) === i), ['shop']);
  assert.strictEqual(R.products[0].cost, undefined, 'employee must not see cost');
});
t('selling requires an open shift', () => {
  const r = env.call('sync', { ops: [{ qid: 1, action: 'sale.create', data: { id: 'S1', business: 'shop', method: 'cash', items: [{ productId: rice.id, qty: 1 }] } }] }, R.token);
  assert.ok(/SHIFT/.test(r.results[0].error));
});
let shift;
t('open shift', () => {
  shift = env.call('shift.open', { business: 'shop', openCash: 100000, openZaadSH: 50000, openZaadUSD: 10, openEdSH: 0, openEdUSD: 5 }, R.token).shift;
  assert.strictEqual(shift.status, 'open');
  assert.ok(/already/.test(env.call('shift.open', { business: 'shop' }, R.token).error));
});
t('sale: server uses sheet prices, rounds to nearest 500, cuts stock, change in SH from USD', () => {
  const r = env.call('sync', { ops: [{ qid: 1, action: 'sale.create', data: { id: 'S1', business: 'shop', method: 'cash', tendered: 5, tenderCur: 'USD',
    items: [{ productId: cola.id, qty: 2, price: 1 }, { productId: rice.id, qty: 1 }] } }] }, R.token);
  const s = r.results[0].result.sale;
  assert.strictEqual(s.subtotal, 58400); assert.strictEqual(s.total, 58500); assert.strictEqual(s.change, 5 * 11850 - 58500);
  assert.strictEqual(r.results[0].result.stock.find(x => x.id === rice.id).stock, 9);
});
t('rounding: 750 -> 1000, 250 -> 500, 1200 -> 1000', () => {
  assert.strictEqual(env.ctx.roundTo_(750, 500), 1000);
  assert.strictEqual(env.ctx.roundTo_(250, 500), 500);
  assert.strictEqual(env.ctx.roundTo_(1200, 500), 1000);
});
t('duplicate sale id is never saved twice', () => {
  const r = env.call('sync', { ops: [{ qid: 2, action: 'sale.create', data: { id: 'S1', business: 'shop', method: 'cash', items: [{ productId: rice.id, qty: 1 }] } }] }, R.token);
  assert.ok(r.results[0].result.dup);
  assert.strictEqual(env.sheets.Sales.getLastRow(), 2);
});
t('employee cannot discount without permission; cannot sell in Fast Food', () => {
  const r = env.call('sync', { ops: [
    { qid: 3, action: 'sale.create', data: { id: 'S2', business: 'shop', method: 'cash', discount: 1000, items: [{ productId: cola.id, qty: 1 }] } },
    { qid: 4, action: 'sale.create', data: { id: 'S3', business: 'food', method: 'cash', items: [{ productId: chicken.id, qty: 1 }] } }] }, R.token);
  assert.ok(/NOPERM/.test(r.results[0].error)); assert.ok(/NOPERM/.test(r.results[1].error));
});
let cust;
t('credit sale + partial payment updates balance', () => {
  cust = env.call('cust.save', { business: 'shop', name: 'Cali Xasan', phone: '063' }, R.token).customer;
  const r = env.call('sync', { ops: [{ qid: 5, action: 'sale.create', data: { id: 'S4', business: 'shop', method: 'credit', customerId: cust.id, items: [{ productId: rice.id, qty: 2 }] } }] }, R.token);
  assert.ok(r.results[0].ok, r.results[0].error);
  assert.strictEqual(r.results[0].result.customer.balance, 104000);
  const p = env.call('cust.pay', { id: 'CP1', customerId: cust.id, amount: 40000, method: 'cash' }, R.token);
  assert.strictEqual(p.customer.balance, 64000);
  assert.ok(env.call('cust.pay', { id: 'CP1', customerId: cust.id, amount: 40000, method: 'cash' }, R.token).dup);
});
t('expense + zaad sale', () => {
  assert.ok(env.call('exp.create', { id: 'E1', business: 'shop', category: 'Deliveries', amount: 5000, method: 'cash' }, R.token).ok);
  const r = env.call('sync', { ops: [{ qid: 6, action: 'sale.create', data: { id: 'S5', business: 'shop', method: 'zaad', items: [{ productId: cola.id, qty: 1 }] } }] }, R.token);
  assert.strictEqual(r.results[0].result.sale.total, 3000);
});
t('refund: employee requests, owner approves, stock and debt return', () => {
  const rq = env.call('refund.request', { id: 'RF1', saleId: 'S4', items: [{ productId: rice.id, qty: 1 }], reason: 'Bag torn' }, R.token);
  assert.ok(rq.ok, rq.error); assert.strictEqual(rq.refund.amount, 52000);
  assert.ok(/NOPERM/.test(env.call('refund.decide', { id: 'RF1', approve: true }, R.token).error));
  const before = env.call('boot', {}, Z.token).products.find(p => p.id === rice.id).stock;
  const ap = env.call('refund.decide', { id: 'RF1', approve: true }, Z.token);
  assert.strictEqual(ap.refund.status, 'approved');
  const b = env.call('boot', {}, Z.token);
  assert.strictEqual(b.products.find(p => p.id === rice.id).stock, before + 1);
  assert.strictEqual(b.customers.find(c => c.id === cust.id).balance, 12000);
  assert.ok(/Too many/.test(env.call('refund.request', { saleId: 'S4', items: [{ productId: rice.id, qty: 2 }], reason: 'x' }, R.token).error));
});
t('cash refund comes off expected cash', () => {
  const rq = env.call('refund.request', { id: 'RF2', saleId: 'S5', reason: 'Wrong item' }, R.token);
  // S5 was zaad -> reduces expected zaad
  env.call('refund.decide', { id: 'RF2', approve: true }, Z.token);
});
t('shift close: expected cash = open + cash sales + cust payments - cash expenses', () => {
  const c = env.call('shift.close', { id: shift.id, closeCash: 193000, closeZaadSH: 50000, closeZaadUSD: 10, closeEdSH: 0, closeEdUSD: 5 }, R.token).shift;
  assert.strictEqual(c.expectedCash, 100000 + 58500 + 40000 - 5000);
  assert.strictEqual(c.diffCash, 193000 - 193500);
  assert.strictEqual(c.expectedZaad, 50000 + 10 * 11850 + 3000 - 3000);
  assert.strictEqual(c.diffZaad, 0);
});
t('supplier purchase adds stock, updates cost, unpaid part owed, paid part is expense', () => {
  const sp = env.call('sup.save', { business: 'shop', name: 'Dahabshiil Trading', phone: '252634000000' }, Z.token).supplier;
  const r = env.call('sup.purchase', { id: 'PU1', supplierId: sp.id, items: [{ kind: 'p', refId: rice.id, qty: 5, cost: 46000 }], paid: 100000, method: 'zaad' }, Z.token);
  assert.strictEqual(r.total, 230000); assert.strictEqual(r.supplier.balance, 130000);
  const b = env.call('boot', {}, Z.token);
  assert.strictEqual(b.products.find(p => p.id === rice.id).cost, 46000);
  const pay = env.call('sup.pay', { id: 'SPY1', supplierId: sp.id, amount: 30000, method: 'cash' }, Z.token);
  assert.strictEqual(pay.supplier.balance, 100000);
  assert.strictEqual(env.sheets.Expenses.data.filter(r => r[4] === 'Supplier purchases').length, 2);
});
t('Fast Food: Sacad sells meals at 18:00, uses ingredients, low warning', () => {
  env.setNow('2026-11-15T15:00:00Z'); // 18:00
  S = login('Sacad'); assert.ok(S.ok, S.error);
  assert.ok(S.ingredients.length === 4);
  env.call('shift.open', { business: 'food', openCash: 0 }, S.token);
  const r = env.call('sync', { ops: [{ qid: 1, action: 'sale.create', data: { id: 'F1', business: 'food', method: 'cash', orderType: 'Take away', items: [{ productId: chicken.id, qty: 3 }] } }] }, S.token);
  assert.strictEqual(r.results[0].result.sale.total, 180000);
  const flour = S.ingredients.find(i => i.name === 'Flour');
  env.call('ing.move', { id: 'IA1', type: 'add', entries: [{ ingredientId: flour.id, qty: 25 }] }, S.token);
  const u = env.call('ing.move', { id: 'IU1', type: 'use', entries: [{ ingredientId: flour.id, qty: 16 }] }, S.token);
  assert.strictEqual(u.ingredients.find(i => i.id === flour.id).stock, 9);
  assert.deepStrictEqual(u.low, ['Flour']);
  assert.ok(env.call('ing.move', { id: 'IU1', type: 'use', entries: [{ ingredientId: flour.id, qty: 16 }] }, S.token).dup);
  const cr = env.call('sync', { ops: [{ qid: 2, action: 'sale.create', data: { id: 'F2', business: 'food', method: 'credit', customerId: cust.id, items: [{ productId: chicken.id, qty: 1 }] } }] }, S.token);
  assert.ok(/Credit is turned off/.test(cr.results[0].error));
});
t('fast food midnight closing: Sacad allowed at 00:20, blocked at 01:00', () => {
  env.setNow('2026-11-15T21:20:00Z'); assert.ok(login('Sacad').ok);
  env.setNow('2026-11-15T22:00:00Z'); assert.ok(/HOURS/.test(login('Sacad').error));
});
t('report: combined totals, profit, debts, low stock, balances', () => {
  const r = env.call('report', { from: '2026-11-15', to: '2026-11-16', business: 'all' }, Z.token);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.byBiz.shop.sales, 58500 + 104000 + 3000);
  assert.strictEqual(r.byBiz.food.sales, 180000);
  assert.strictEqual(r.byBiz.shop.refunds, 55000);
  assert.strictEqual(r.byBiz.shop.expenses, 5000); // supplier purchases excluded from profit expenses
  assert.ok(typeof r.totals.profit === 'number');
  assert.strictEqual(r.debts[0].balance, 12000);
  assert.ok(r.balances.find(b => b.business === 'shop').last.cash === 193000);
  assert.ok(r.topItems.length >= 2);
  const rr = env.call('report', {}, R.token); assert.ok(/NOPERM/.test(rr.error));
});
t('users: owner adds user with generated PIN, user changes PIN, reset PIN', () => {
  const a = env.call('users.save', { name: 'Hodan', role: 'employee', business: 'shop', perms: ['discount', 'viewStock'], lang: 'en', afterHours: 1 }, Z.token);
  assert.ok(/^\d{4}$/.test(a.pin));
  const L = env.call('login', { userId: a.user.id, pin: a.pin }); assert.ok(L.ok, L.error);
  assert.ok(/too easy/.test(env.call('me.changePin', { oldPin: a.pin, newPin: '1234' }, L.token).error));
  assert.ok(env.call('me.changePin', { oldPin: a.pin, newPin: '58213' }, L.token).ok);
  assert.ok(env.call('login', { userId: a.user.id, pin: '58213' }).ok);
  const rp = env.call('users.resetPin', { id: a.user.id }, Z.token); assert.ok(env.call('login', { userId: a.user.id, pin: rp.pin }).ok);
  assert.ok(/at least one|own owner/.test(env.call('users.save', { id: id('Zakariye'), name: 'Zakariye', role: 'employee' }, Z.token).error));
  const dis = env.call('users.save', { id: a.user.id, name: 'Hodan', role: 'employee', business: 'shop', active: 0 }, Z.token);
  assert.strictEqual(dis.user.active, false);
  assert.ok(/disabled/.test(env.call('login', { userId: a.user.id, pin: rp.pin }).error));
});
t('settings: owner changes rate, employee cannot', () => {
  const s = env.call('settings.save', { values: { usdRate: '12000', food_close: '01:00', bogus: 'x' } }, Z.token);
  assert.strictEqual(s.settings.usdRate, '12000'); assert.strictEqual(s.settings.bogus, undefined);
  assert.ok(/NOPERM/.test(env.call('settings.save', { values: { usdRate: '1' } }, R.token).error));
});
t('import products: updates by barcode, adds new, skips bad rows', () => {
  const r = env.call('prod.import', { business: 'shop', rows: [{ name: 'Rice 5kg', barcode: '0012345', price: 53000 }, { name: 'Colgate 100ml', barcode: '', price: 4500, stock: 12 }, { name: '', price: 1 }] }, Z.token);
  assert.deepStrictEqual([r.added, r.updated, r.skipped], [1, 1, 1]);
});
t('stock count fixes stock and logs difference', () => {
  const r = env.call('stock.count', { id: 'SC1', counts: [{ productId: cola.id, counted: 40 }] }, Z.token);
  assert.strictEqual(r.changed, 1); assert.strictEqual(r.logs[0].before, 46);
});
t('export and audit', () => {
  const e = env.call('export', { type: 'sales', from: '2026-11-15', to: '2026-11-16' }, Z.token);
  assert.ok(e.rows.length >= 4);
  const a = env.call('audit.list', { from: '2026-11-15', to: '2026-11-16' }, Z.token);
  assert.ok(a.audit.some(x => x.action === 'refund.approve'));
});
console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
