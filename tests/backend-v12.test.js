/**
 * Tests for v1.2: SH/USD shift totals, cash taken out, undo/void, low-stock email, email reports, Fast Food on/off,
 * shift start times, insights, delete, reset, archive.   Run: node tests/backend-v12.test.js
 */
const assert = require('assert');
const { makeEnv } = require('./gas-mock');
let passed = 0;
function t(name, f) { try { f(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; } }

function boot(now) {
  const env = makeEnv({ now });
  const pins = {}; env.ctx.setup().split('\n').forEach(l => { const m = l.match(/^(\w+): (\d{4})$/); if (m) pins[m[1]] = m[2]; });
  const ids = {}; env.call('names').users.forEach(u => ids[u.name] = u.id);
  const login = n => env.call('login', { userId: ids[n], pin: pins[n] });
  return { env, pins, ids, login };
}
const sale = (env, tok, d) => { const r = env.call('sync', { ops: [{ qid: 'q', action: 'sale.create', data: d }] }, tok).results[0]; if (!r.ok) throw new Error(r.error); return r.result; };

console.log('Saado POS v1.2 backend tests');
const A = boot('2026-08-10T13:00:00Z');   // 16:00 in Hargeisa
const { env } = A;
let H, R, cola, rice, shift;
t('setup gives employees undo + cash-out permissions', () => {
  H = A.login('Hussein'); assert.ok(H.ok, H.error);
  const raxma = env.call('users.list', {}, H.token).users.find(u => u.name === 'Raxma');
  assert.ok(raxma.perms.includes('undoSales') && raxma.perms.includes('cashOut'));
  cola = env.call('prod.save', { business: 'shop', name: 'Coca-Cola', barcode: '111', price: 3000, cost: 2000, stock: 10, lowStock: 5 }, H.token).product;
  rice = env.call('prod.save', { business: 'shop', name: 'Bariis 5kg', barcode: '222', price: 52000, cost: 45000, stock: 20, lowStock: 3 }, H.token).product;
  assert.ok(env.call('recip.save', { name: 'Hussein', email: 'hussein@example.com', userId: A.ids.Hussein, daily: 1, weekly: 1, lowStock: 1 }, H.token).ok);
});
t('shift start time: opened 16:21 for the 16:00 shift = 21 min late', () => {
  env.setNow('2026-08-10T13:21:00Z');
  R = A.login('Raxma'); assert.ok(R.ok, R.error);
  shift = env.call('shift.open', { business: 'shop', openCash: 100000, openCashUSD: 20 }, R.token).shift;
  const rep = env.call('report', { business: 'shop', from: '2026-08-10', to: '2026-08-10' }, H.token);
  const s = rep.shifts.find(x => x.id === shift.id);
  assert.strictEqual(s.scheduled, '16:00'); assert.strictEqual(s.lateBy, 21);
});
let s1, s3;
t('USD cash sale: $5 in the drawer, change 56,250 SH out', () => {
  s1 = sale(env, R.token, { id: 'S1', business: 'shop', method: 'cash', tendered: 5, tenderCur: 'USD', items: [{ productId: cola.id, qty: 1 }] }).sale;
  assert.strictEqual(s1.payCur, 'USD'); assert.strictEqual(s1.usdAmount, 5); assert.strictEqual(s1.change, 5 * 11850 - 3000);
});
t('Zaad paid in dollars: 52,000 SH = $4.39', () => {
  const r = sale(env, R.token, { id: 'S2', business: 'shop', method: 'zaad', payCur: 'USD', items: [{ productId: rice.id, qty: 1 }] }).sale;
  assert.strictEqual(r.usdAmount, 4.39);
});
t('low stock: one email the moment Coca-Cola reaches 5, no repeat', () => {
  const before = env.mail.length;
  s3 = sale(env, R.token, { id: 'S3', business: 'shop', method: 'cash', items: [{ productId: cola.id, qty: 4 }] }).sale;
  assert.strictEqual(env.mail.length, before + 1); assert.ok(/Low stock: Coca-Cola — 5 left/.test(env.mail[env.mail.length - 1].subject));
  sale(env, R.token, { id: 'S4', business: 'shop', method: 'cash', items: [{ productId: cola.id, qty: 1 }] });
  assert.strictEqual(env.mail.length, before + 1, 'no second email while still low');
});
t('cash taken out: 20,000 SH by Hussein lowers expected cash', () => {
  const m = env.call('cash.out', { id: 'CO1', business: 'shop', amount: 20000, currency: 'SH', takenBy: 'Hussein', reason: 'Owner took' }, R.token);
  assert.ok(m.ok, m.error); assert.strictEqual(m.move.shiftId, shift.id);
  assert.ok(env.call('cash.out', { id: 'CO1', business: 'shop', amount: 20000, takenBy: 'Hussein' }, R.token).dup);
  const tt = env.call('shift.preview', { id: shift.id }, R.token).totals;
  assert.strictEqual(tt.eCashSH, 100000 - 56250 + 12000 + 3000 - 20000); assert.strictEqual(tt.eCashUSD, 25); assert.strictEqual(tt.eZaadUSD, 4.39);
});
t('undo own sale: stock back, cash expected back down, excluded from reports, alert can fire again', () => {
  assert.ok(/reason/i.test(env.call('sale.undo', { id: 'S3' }, R.token).error));
  const u = env.call('sale.undo', { id: 'S3', reason: 'Wrong item' }, R.token);
  assert.ok(u.ok, u.error); assert.strictEqual(u.sale.status, 'undone');
  assert.strictEqual(u.stock.find(x => x.id === cola.id).stock, 8);
  const tt = env.call('shift.preview', { id: shift.id }, R.token).totals;
  assert.strictEqual(tt.eCashSH, 100000 - 56250 + 3000 - 20000); assert.strictEqual(tt.undoneCount, 1);
  const rep = env.call('report', { business: 'shop', from: '2026-08-10', to: '2026-08-10' }, H.token);
  assert.strictEqual(rep.totals.count, 3); assert.strictEqual(rep.undone[0].reason, 'Wrong item');
  assert.ok(env.call('sale.undo', { id: 'S3', reason: 'x' }, R.token).dup);
});
t('end shift: totals in SH and in USD, difference 0', () => {
  const c = env.call('shift.close', { id: shift.id, closeCash: 26750, closeCashUSD: 25, closeZaadSH: 0, closeZaadUSD: 4.39, closeEdSH: 0, closeEdUSD: 0 }, R.token).shift;
  assert.strictEqual(c.totalExpSH, 26750); assert.strictEqual(c.totalExpUSD, 29.39);
  assert.strictEqual(c.diffSH, 0); assert.strictEqual(c.diffUSD, 0); assert.strictEqual(c.diffAll, 0);
});
t('undo is only for your own OPEN shift; owner can void any sale', () => {
  assert.ok(/own open shift/.test(env.call('sale.undo', { id: 'S4', reason: 'x' }, R.token).error));
  const v = env.call('sale.undo', { id: 'S4', reason: 'Owner check' }, H.token); assert.strictEqual(v.sale.status, 'void');
});
t('undo a credit sale lowers the customer debt', () => {
  env.call('shift.open', { business: 'shop', openCash: 0 }, R.token);
  const c = env.call('cust.save', { business: 'shop', name: 'Cali' }, R.token).customer;
  sale(env, R.token, { id: 'S5', business: 'shop', method: 'credit', customerId: c.id, items: [{ productId: rice.id, qty: 1 }] });
  const u = env.call('sale.undo', { id: 'S5', reason: 'Wrong payment' }, R.token);
  assert.strictEqual(u.customer.balance, 0);
});
t('emails: daily to daily people, weekly on the weekly day, staff edit only their own', () => {
  env.call('settings.save', { values: { weeklyDay: 'Mon' } }, H.token);    // 10 Aug 2026 is a Monday
  const acc = env.call('recip.save', { name: 'Accountant', email: 'acc@example.com', monthly: 1 }, H.token).recipient;
  env.setNow('2026-08-10T20:35:00Z');   // 23:35 in Hargeisa: past the 23:30 default
  const before = env.mail.length; env.ctx.dailyEmails();
  const again = env.mail.length; env.ctx.emailTick(); assert.strictEqual(env.mail.length - again, 0, 'never sent twice');
  const sent = env.mail.slice(before, again);
  assert.deepStrictEqual(sent.map(m => m.to), ['hussein@example.com', 'hussein@example.com']);
  assert.ok(/Daily report/.test(sent[0].subject) && /Weekly report/.test(sent[1].subject));
  assert.ok(sent[0].htmlBody.includes('Cash taken out (Hussein)') && sent[0].htmlBody.includes('Undone sales'));
  assert.ok(/NOPERM/.test(env.call('recip.save', { id: acc.id, daily: 1 }, R.token).error));
  assert.ok(/NOPERM/.test(env.call('recip.list', {}, R.token).error));
});
t('Fast Food closed: Sacad hidden and blocked, owner sees Shop only; open again restores', () => {
  env.call('settings.save', { values: { food_enabled: '0' } }, H.token);
  assert.ok(!env.call('names').users.some(u => u.name === 'Sacad'));
  env.setNow('2026-08-10T15:00:00Z');
  assert.ok(/CLOSED/.test(A.login('Sacad').error));
  const b = env.call('boot', {}, H.token); assert.strictEqual(b.ingredients, undefined);
  assert.deepStrictEqual(env.call('report', { business: 'all' }, H.token).business, ['shop']);
  env.call('settings.save', { values: { food_enabled: '1' } }, H.token);
  assert.ok(A.login('Sacad').ok);
});
t('delete: used product is hidden, unused is erased; customer with debt cannot be deleted', () => {
  assert.strictEqual(env.call('prod.delete', { id: cola.id }, H.token).removed, 'hidden');
  assert.ok(!env.call('boot', {}, H.token).products.some(p => p.id === cola.id));
  const np = env.call('prod.save', { business: 'shop', name: 'Unused', price: 100 }, H.token).product;
  assert.strictEqual(env.call('prod.delete', { id: np.id }, H.token).removed, 'deleted');
  env.call('shift.open', { business: 'shop', openCash: 0 }, H.token);
  const c = env.call('cust.save', { business: 'shop', name: 'Owes' }, H.token).customer;
  sale(env, H.token, { id: 'S6', business: 'shop', method: 'credit', customerId: c.id, items: [{ productId: rice.id, qty: 1 }] });
  assert.ok(/balance/.test(env.call('cust.delete', { id: c.id }, H.token).error));
  assert.ok(/NOPERM/.test(env.call('prod.delete', { id: rice.id }, R.token).error));
});
t('insights: month totals, days, hours, attendance with late count', () => {
  const r = env.call('insights', { month: '2026-08', business: 'shop' }, H.token);
  assert.ok(r.ok, r.error); assert.strictEqual(r.dailyCur.length, 31);
  assert.ok(r.cur.sales > 0); const ra = r.attendance.find(a => a.name === 'Raxma'); assert.strictEqual(ra.shifts, 2); assert.strictEqual(ra.late, 2);   // both opened 16:21
  assert.ok(r.undone.find(x => x.name === 'Raxma').count >= 2);
  assert.ok(/NOPERM/.test(env.call('insights', {}, R.token).error));
});
t('reset: needs RESET + PIN, makes a safety copy, clears chosen parts, old phones are told', () => {
  assert.ok(/RESET/.test(env.call('admin.reset', { parts: ['sales'], confirm: 'x', pin: A.pins.Hussein }, H.token).error));
  assert.ok(/Wrong PIN/.test(env.call('admin.reset', { parts: ['sales'], confirm: 'RESET', pin: '0000' }, H.token).error));
  assert.ok(/NOPERM/.test(env.call('admin.reset', { parts: ['sales'], confirm: 'RESET', pin: A.pins.Raxma }, R.token).error));
  const r = env.call('admin.reset', { parts: ['sales', 'custBalances'], confirm: 'reset', pin: A.pins.Hussein }, H.token);
  assert.ok(r.ok, r.error); assert.strictEqual(r.dataVersion, '2');
  const n = env.call('admin.counts', {}, H.token); assert.strictEqual(n.counts.Sales, 0); assert.strictEqual(n.customerDebt, 0);
  const arch = env.rootFolders.find(f => f.name === 'Saado POS Archive'); assert.ok(arch.folders.find(f => f.name === 'Resets').files.length === 1);
  const sy = env.call('sync', { dataVersion: '1', ops: [{ qid: 'q', action: 'sale.create', data: { id: 'OLD', business: 'shop', method: 'cash', items: [{ productId: rice.id, qty: 1 }] } }] }, R.token);
  assert.ok(sy.reset); assert.strictEqual(env.call('admin.counts', {}, H.token).counts.Sales, 0);
  assert.ok(env.call('audit.list', { from: '2026-08-10', to: '2026-08-10' }, H.token).audit.some(a => a.action === 'reset'));
});

// ---------- archive (fresh shop) ----------
const B = boot('2026-08-10T10:00:00Z');
const e2 = B.env; let O, P, C, SP;
t('archive: old months move to a new Sheet in Saado POS Archive, balances stay exactly the same', () => {
  O = B.login('Hussein');
  P = e2.call('prod.save', { business: 'shop', name: 'Sonkor', price: 10000, cost: 8000, stock: 100 }, O.token).product;
  e2.call('shift.open', { business: 'shop', openCash: 0 }, O.token);
  C = e2.call('cust.save', { business: 'shop', name: 'Cali' }, O.token).customer;
  sale(e2, O.token, { id: 'A1', business: 'shop', method: 'credit', customerId: C.id, items: [{ productId: P.id, qty: 3 }] });
  sale(e2, O.token, { id: 'A2', business: 'shop', method: 'cash', items: [{ productId: P.id, qty: 1 }] });
  e2.call('cust.pay', { id: 'CP1', customerId: C.id, amount: 5000, method: 'cash' }, O.token);
  SP = e2.call('sup.save', { business: 'shop', name: 'Supplier X' }, O.token).supplier;
  e2.call('po.save', { id: 'PO1', isNew: 1, supplierId: SP.id, items: [{ kind: 'p', refId: P.id, qty: 10, cost: 8000 }], payNow: 30000, payMethod: 'cash', receiveNow: 1 }, O.token);
  e2.setNow('2026-12-15T10:00:00Z');
  const O2 = B.login('Hussein'); O.token = O2.token;
  const sh = e2.call('boot', {}, O.token).shifts.find(x => x.status === 'open');
  e2.call('shift.close', { id: sh.id, closeCash: 0 }, O.token);
  e2.call('shift.open', { business: 'shop', openCash: 0 }, O.token);
  sale(e2, O.token, { id: 'D1', business: 'shop', method: 'cash', items: [{ productId: P.id, qty: 2 }] });
  const before = { cust: e2.call('boot', {}, O.token).customers[0].balance, sup: e2.call('boot', {}, O.token).suppliers[0].balance };
  assert.strictEqual(before.cust, 25000); assert.strictEqual(before.sup, 50000);
  const pv = e2.call('admin.archivePreview', { cutoff: '2026-11-01' }, O.token);
  assert.strictEqual(pv.name, 'Aug 2026 – Oct 2026'); assert.strictEqual(pv.counts.Sales, 2);
  const a = e2.call('admin.archive', { cutoff: '2026-11-01' }, O.token);
  assert.ok(a.ok, a.error);
  const live = e2.call('admin.counts', {}, O.token);
  assert.strictEqual(live.counts.Sales, 1); assert.strictEqual(live.archivedUntil, '2026-11-01'); assert.strictEqual(live.archiveLinks.length, 1);
  const b2 = e2.call('boot', {}, O.token);
  assert.strictEqual(b2.customers[0].balance, before.cust);
  const led = e2.call('cust.ledger', { customerId: C.id }, O.token).ledger; assert.ok(led.some(l => l.type === 'opening' && l.amount === 25000));
  const sp2 = e2.call('sup.pay', { id: 'SP2', supplierId: SP.id, amount: 10000, method: 'cash' }, O.token);
  assert.strictEqual(sp2.supplier.balance, before.sup - 10000, 'supplier balance recomputed from history still right');
  const ss = Object.values(e2.created)[0];
  assert.ok(ss.getSheetByName('Summary') && ss.getSheetByName('Sales') && ss.getSheetByName('Balances') && !ss.getSheetByName('Sheet1'));
  const folder = e2.rootFolders.find(f => f.name === 'Saado POS Archive').folders.find(f => f.name === 'Aug 2026 – Oct 2026');
  assert.ok(folder.files.some(f => /Summary/.test(f.name)));
  const ins = e2.call('insights', { month: '2026-08', business: 'shop' }, O.token);
  assert.ok(ins.cur.fromArchive); assert.strictEqual(ins.cur.sales, 40000);
});
t('archive cannot be reset: Reset never touches the Archive folder', () => {
  const r = e2.call('admin.reset', { parts: ['sales', 'backups'], confirm: 'RESET', pin: B.pins.Hussein }, O.token);
  assert.ok(r.ok, r.error);
  const root = e2.rootFolders.find(f => f.name === 'Saado POS Archive');
  assert.ok(root.folders.find(f => f.name === 'Aug 2026 – Oct 2026').files.length >= 2);
});
console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
