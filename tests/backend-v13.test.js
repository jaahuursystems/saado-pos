/** Tests for v1.3: email times from Settings, expenses in SH/USD with explanation, same-day undo, expenses permission.  Run: node tests/backend-v13.test.js */
const assert = require('assert');
const { makeEnv } = require('./gas-mock');
let passed = 0;
function t(name, f) { try { f(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } }
const at = local => env.setNow(new Date(Date.parse(local + 'Z') - 3 * 3600e3).toISOString());   // Hargeisa time → UTC
const env = makeEnv({ now: '2026-08-10T10:00:00Z' });
const pins = {}; env.ctx.setup().split('\n').forEach(l => { const m = l.match(/^(\w+): (\d{4})$/); if (m) pins[m[1]] = m[2]; });
const ids = {}; env.call('names').users.forEach(u => ids[u.name] = u.id);
const login = n => env.call('login', { userId: ids[n], pin: pins[n] });
const H = login('Hussein'), R = login('Raxma');
const mails = f => { const b = env.mail.length; f(); return env.mail.slice(b); };

t('setup uses one 15-minute email timer (old 23:30 timer removed)', () => {
  assert.ok(env.triggers.includes('emailTick')); assert.ok(!env.triggers.includes('dailyEmails'));
});
t('owner sets times; staff cannot', () => {
  assert.ok(env.call('settings.save', { values: { emailDailyTime: '08:00', weeklyDay: 'Sat', emailWeeklyTime: '09:00', monthlyWhen: 'first', emailMonthlyTime: '10:00', lowStockMode: 'daily', lowStockTime: '07:30' } }, H.token).ok);
  assert.ok(/NOPERM/.test(env.call('settings.save', { values: { emailDailyTime: '05:00' } }, R.token).error));
  env.call('recip.save', { name: 'Hussein', email: 'h@example.com', daily: 1, weekly: 1, monthly: 1, lowStock: 1 }, H.token);
  const p = env.call('prod.save', { business: 'shop', name: 'Sugar', price: 1000, stock: 2, lowStock: 5 }, H.token); assert.ok(p.ok, p.error);
});
t('a morning daily email reports on yesterday, sent once at the chosen time', () => {
  at('2026-08-11T07:44:00'); assert.strictEqual(mails(() => env.ctx.emailTick()).filter(m => /Daily/.test(m.subject)).length, 0);
  at('2026-08-11T08:05:00'); const m = mails(() => env.ctx.emailTick()).filter(m => /Daily/.test(m.subject));
  assert.strictEqual(m.length, 1); assert.ok(/Monday 10 August/.test(m[0].subject), m[0].subject);
  at('2026-08-11T08:20:00'); assert.strictEqual(mails(() => env.ctx.emailTick()).filter(m => /Daily/.test(m.subject)).length, 0);
});
t('low stock in "daily" mode: no instant email, one list at 07:30', () => {
  at('2026-08-12T07:00:00'); env.ctx.emailTick();
  const m = mails(() => { at('2026-08-12T07:31:00'); env.ctx.emailTick(); }).filter(m => /Low stock/.test(m.subject));
  assert.strictEqual(m.length, 1); assert.ok(m[0].htmlBody.includes('Sugar'));
});
t('weekly on the chosen day and time; monthly on the 1st covers last month', () => {
  at('2026-08-15T09:01:00'); const w = mails(() => env.ctx.emailTick()).filter(m => /Weekly/.test(m.subject));   // Saturday
  assert.strictEqual(w.length, 1); assert.ok(/2026-08-08 to 2026-08-14/.test(w[0].subject), w[0].subject);
  at('2026-09-01T10:00:00'); const mo = mails(() => env.ctx.emailTick()).filter(m => /Monthly/.test(m.subject));
  assert.strictEqual(mo.length, 1); assert.ok(/Aug 2026/.test(mo[0].subject), mo[0].subject);
  env.call('settings.save', { values: { monthlyWhen: 'last', emailMonthlyTime: '23:30' } }, H.token);
  at('2026-09-30T23:40:00'); const mo2 = mails(() => env.ctx.emailTick()).filter(m => /Monthly/.test(m.subject));
  assert.strictEqual(mo2.length, 1); assert.ok(/Sep 2026/.test(mo2[0].subject));
});
let sh, R2, e1, e2;
t('expense in USD comes out of the dollar drawer; SH expense out of shillings; explanation kept', () => {
  at('2026-10-05T09:00:00'); R2 = login('Raxma');
  sh = env.call('shift.open', { business: 'shop', openCash: 50000, openCashUSD: 100 }, R2.token).shift;
  const op = (data) => { const r = env.call('sync', { ops: [{ qid: 'x' + data.id, action: 'exp.create', data }] }, R2.token).results[0]; return r; };
  assert.ok(op({ id: 'E1', business: 'shop', category: 'Deliveries', amount: 10, currency: 'USD', method: 'cash', description: 'Bajaj to the port', note: 'receipt in drawer' }).ok);
  assert.ok(op({ id: 'E2', business: 'shop', category: 'Electricity', amount: 20000, currency: 'SH', method: 'cash' }).ok);
  assert.ok(/Write what the money was for/.test(op({ id: 'E3', business: 'shop', category: 'Other', amount: 500, method: 'cash' }).error));
  const L = env.call('shift.live', { id: sh.id }, R2.token).totals;
  assert.strictEqual(L.eCashUSD, 90); assert.strictEqual(L.eCashSH, 30000);
  const list = env.call('exp.list', { business: 'shop' }, R2.token).expenses;
  e1 = list.find(x => x.id === 'E1'); e2 = list.find(x => x.id === 'E2');
  assert.strictEqual(e1.currency, 'USD'); assert.strictEqual(+e1.usdAmount, 10); assert.strictEqual(+e1.amount, 118500); assert.strictEqual(e1.description, 'Bajaj to the port');
  const rep = env.call('report', { business: 'shop' }, H.token); assert.strictEqual(rep.totals.expenses, 138500);
});
t('undo the same day: reason needed, money back in the drawer, report drops it, record kept', () => {
  assert.ok(/reason/.test(env.call('exp.undo', { id: 'E1' }, R2.token).error));
  assert.ok(env.call('exp.undo', { id: 'E1', reason: 'Wrong amount' }, R2.token).ok);
  assert.strictEqual(env.call('shift.live', { id: sh.id }, R2.token).totals.eCashUSD, 100);
  assert.strictEqual(env.call('report', { business: 'shop' }, H.token).totals.expenses, 20000);
  assert.strictEqual(env.call('exp.list', { business: 'shop' }, H.token).expenses.find(x => x.id === 'E1').status, 'undone');
});
t('next day nobody can undo (not even the owner)', () => {
  at('2026-10-06T08:00:00');
  const r = env.call('exp.undo', { id: 'E2', reason: 'Wrong amount' }, H.token); assert.ok(/same day/.test(r.error), r.error);
});
t('without the Expenses permission: no list, no adding', () => {
  const u = env.call('users.list', {}, H.token).users.find(x => x.name === 'Raxma');
  assert.ok(env.call('users.save', Object.assign({}, u, { perms: u.perms.filter(p => p !== 'expenses') }), H.token).ok);
  const R3 = login('Raxma');
  assert.ok(/NOPERM/.test(env.call('exp.list', { business: 'shop' }, R3.token).error));
  assert.ok(/NOPERM/.test(env.call('sync', { ops: [{ qid: 'q', action: 'exp.create', data: { id: 'E9', business: 'shop', category: 'Rent', amount: 1, method: 'cash' } }] }, R3.token).results[0].error));
});
console.log(passed + ' passed');
