/** v1.7: credit sale with part paid now.  Run: node tests/backend-v17.test.js */
const assert = require('assert');
const { makeEnv } = require('./gas-mock');
let passed = 0;
function t(name, f) { try { f(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } }
const env = makeEnv({ now: '2026-11-23T08:00:00Z' });
const pins = {}; env.ctx.setup().split('\n').forEach(l => { const m = l.match(/^(\w+): (\d{4})$/); if (m) pins[m[1]] = m[2]; });
const ids = {}; env.call('names').users.forEach(u => ids[u.name] = u.id);
const H = env.call('login', { userId: ids.Hussein, pin: pins.Hussein }), R = env.call('login', { userId: ids.Raxma, pin: pins.Raxma });
const sell = data => env.call('sync', { ops: [{ qid: 'q' + Math.random(), action: 'sale.create', data: Object.assign({ id: 'S' + Math.random().toString(36).slice(2), business: 'shop', method: 'credit' }, data) }] }, R.token).results[0];
let sh, cust, rice, sale;
const live = () => env.call('shift.live', { id: sh.id }, R.token).totals;
const bal = () => +env.call('boot', {}, H.token).customers.find(c => c.id === cust.id).balance;
t('setup', () => {
  sh = env.call('shift.open', { business: 'shop', openCash: 0 }, R.token).shift;
  cust = env.call('cust.save', { business: 'shop', name: 'Cali Xasan', phone: '0634' }, H.token).customer;
  rice = env.call('prod.save', { business: 'shop', name: 'Bariis 1kg', price: 3000, cost: 2000, stock: 50 }, H.token).product;
});
t('6,000 sale: 4,000 Zaad now, 2,000 on the balance', () => {
  const r = sell({ customerId: cust.id, partPaid: 4000, partMethod: 'zaad', partCur: 'SH', items: [{ productId: rice.id, qty: 2 }] });
  assert.ok(r.ok, r.error); sale = r.result.sale;
  assert.strictEqual(sale.partSH, 4000); assert.strictEqual(r.result.customer.balance, 2000); assert.strictEqual(bal(), 2000);
  const L = live(); assert.strictEqual(L.eZaadSH, 4000); assert.strictEqual(L.creditSales, 2000); assert.strictEqual(L.zaadSales, 4000);
  const led = env.call('cust.ledger', { customerId: cust.id }, H.token).ledger;
  assert.deepStrictEqual(led.map(l => l.type).sort(), ['sale', 'salepay']);
  const rep = env.call('report', { business: 'shop' }, H.token); assert.strictEqual(rep.totals.zaad, 4000); assert.strictEqual(rep.totals.credit, 2000);
});
t('part paid in dollars into cash: $2 = 23,700 SH, rest on the balance', () => {
  const big = env.call('prod.save', { business: 'shop', name: 'Saliid', price: 30000, cost: 25000, stock: 5 }, H.token).product;
  const r = sell({ customerId: cust.id, partPaid: 2, partMethod: 'cash', partCur: 'USD', items: [{ productId: big.id, qty: 1 }] });
  assert.ok(r.ok, r.error); assert.strictEqual(bal(), 2000 + 6300);
  const L = live(); assert.strictEqual(L.eCashUSD, 2); assert.strictEqual(L.eCashSH, 0);
});
t('paying the whole total is refused (use Cash/Zaad instead)', () => {
  assert.ok(/whole total/.test(sell({ customerId: cust.id, partPaid: 3000, partMethod: 'cash', items: [{ productId: rice.id, qty: 1 }] }).error));
});
t('undo the sale: the balance only loses the credit part; the Zaad comes off the expected total', () => {
  assert.ok(env.call('sale.undo', { id: sale.id, reason: 'Wrong item' }, R.token).ok);
  assert.strictEqual(bal(), 6300); const L = live(); assert.strictEqual(L.eZaadSH, 0); assert.strictEqual(L.creditSales, 6300);
});
console.log(passed + ' passed');
