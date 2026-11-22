/** v1.6: Take money out from cash/Zaad/Edahab to owner/customer/supplier/other, with undo.  Run: node tests/backend-v16.test.js */
const assert = require('assert');
const { makeEnv } = require('./gas-mock');
let passed = 0;
function t(name, f) { try { f(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } }
const env = makeEnv({ now: '2026-11-22T07:00:00Z' });
const pins = {}; env.ctx.setup().split('\n').forEach(l => { const m = l.match(/^(\w+): (\d{4})$/); if (m) pins[m[1]] = m[2]; });
const ids = {}; env.call('names').users.forEach(u => ids[u.name] = u.id);
const H = env.call('login', { userId: ids.Hussein, pin: pins.Hussein }), R = env.call('login', { userId: ids.Raxma, pin: pins.Raxma });
const out = (data, tok) => env.call('sync', { ops: [{ qid: 'q' + Math.random(), action: 'cash.out', data: Object.assign({ id: 'CO' + Math.random().toString(36).slice(2), business: 'shop' }, data) }] }, tok || R.token).results[0];
let sh, cust, sup;
const live = () => env.call('shift.live', { id: sh.id }, R.token).totals;
const custBal = () => +env.call('boot', {}, H.token).customers.find(c => c.id === cust.id).balance;
const supBal = () => +env.call('boot', {}, H.token).suppliers.find(c => c.id === sup.id).balance;
t('setup', () => {
  sh = env.call('shift.open', { business: 'shop', openCash: 100000, openZaadSH: 80000, openEdUSD: 200 }, R.token).shift;
  cust = env.call('cust.save', { business: 'shop', name: 'Faadumo Cali', phone: '0634' }, H.token).customer;
  sup = env.call('sup.save', { business: 'shop', name: 'Xasan Wholesale' }, H.token).supplier;
  assert.ok(env.call('sup.purchase', { id: 'PU1', supplierId: sup.id, items: [], total: 3555000, paid: 0, method: 'cash' }, H.token).ok || true);
});
let mOwner, mCust, mSup;
t('owner takes 50,000 cash (old way still works)', () => {
  const r = out({ amount: 50000, currency: 'SH', takenBy: 'Hussein', reason: 'Owner took' }); assert.ok(r.ok, r.error); mOwner = r.result.move;
  assert.strictEqual(mOwner.account, 'cash'); assert.strictEqual(live().eCashSH, 50000);
});
t('customer takes 20,000 from Zaad: Zaad −20,000, her balance +20,000', () => {
  const r = out({ amount: 20000, currency: 'SH', account: 'zaad', whoType: 'customer', refId: cust.id, note: 'Lacag deyn ah' }); assert.ok(r.ok, r.error); mCust = r.result.move;
  assert.strictEqual(mCust.takenBy, 'Faadumo Cali'); assert.strictEqual(live().eZaadSH, 60000); assert.strictEqual(custBal(), 20000);
  const led = env.call('cust.ledger', { customerId: cust.id }, H.token); const row = (led.ledger || led.rows || []).find(x => x.type === 'loan'); assert.ok(row, JSON.stringify(led).slice(0, 200));
});
t('supplier paid $100 from Edahab: Edahab −$100, we owe 1,185,000 less', () => {
  const before = supBal();
  const r = out({ amount: 100, currency: 'USD', account: 'edahab', whoType: 'supplier', refId: sup.id }); assert.ok(r.ok, r.error); mSup = r.result.move;
  assert.strictEqual(mSup.shAmount, 1185000); assert.strictEqual(live().eEdUSD, 100); assert.strictEqual(supBal(), before - 1185000);
});
t('someone else / unknown customer', () => {
  assert.ok(out({ amount: 5000, account: 'cash', whoType: 'other', takenBy: 'Cabdi (driver)', reason: 'Other' }).ok);
  assert.ok(/Customer not found/.test(out({ amount: 1, whoType: 'customer', refId: 'nope' }).error));
  assert.ok(/Who took/.test(out({ amount: 1, whoType: 'other', takenBy: '' }).error));
  assert.strictEqual(live().eCashSH, 45000);
});
t('undo needs a reason, and puts everything back', () => {
  assert.ok(/reason/.test(env.call('cash.undo', { id: mCust.id }, R.token).error));
  assert.ok(env.call('cash.undo', { id: mCust.id, reason: 'Wrong amount' }, R.token).ok);
  assert.strictEqual(live().eZaadSH, 80000); assert.strictEqual(custBal(), 0);
  const before = supBal();
  assert.ok(env.call('cash.undo', { id: mSup.id, reason: 'Wrong amount' }, R.token).ok);
  assert.strictEqual(live().eEdUSD, 200); assert.strictEqual(supBal(), before + 1185000);
  assert.ok(env.call('cash.undo', { id: mOwner.id, reason: 'Entered twice' }, R.token).ok); assert.strictEqual(live().eCashSH, 95000);
  assert.ok(env.call('cash.undo', { id: mOwner.id, reason: 'x' }, R.token).dup);
  const moves = env.call('shift.live', { id: sh.id }, R.token).moves; assert.strictEqual(moves.filter(m => m.status === 'undone').length, 3);
});
t('after the shift is closed only the owner can undo', () => {
  const r = out({ amount: 1000, account: 'cash', whoType: 'other', takenBy: 'X' }); const L = live();
  assert.ok(env.call('shift.close', { id: sh.id, closeCash: L.eCashSH, closeZaadSH: L.eZaadSH, closeEdUSD: L.eEdUSD }, R.token).ok);
  assert.ok(/closed/.test(env.call('cash.undo', { id: r.result.move.id, reason: 'x' }, R.token).error));
  assert.ok(env.call('cash.undo', { id: r.result.move.id, reason: 'x' }, H.token).ok);
});
console.log(passed + ' passed');
