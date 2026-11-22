/**
 * Saado POS — app core.
 * State, server calls (clear error messages), offline queue (sales save on the phone first and sync later),
 * login with name + PIN, top bar / bottom menu, shared UI helpers (sheets, toasts, forms), barcode scanner
 * (BarcodeDetector on Android, ZXing fallback for iPhone), and file tools (CSV, Excel .xlsx reader, PDF maker).
 * The screens themselves are in screens.js.
 */
(function () {
  'use strict';
  const CFG = window.SAADO_CONFIG || {};
  const APP_VERSION = '1.5.0';
  const TZ = 'Africa/Mogadishu';

  /* ---------------- storage ---------------- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('saado_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('saado_' + k, JSON.stringify(v)); } catch (e) { console.warn('storage full', e); } },
    del(k) { try { localStorage.removeItem('saado_' + k); } catch (e) {} }
  };

  const S = {
    token: null, expires: 0, user: null, data: null, biz: 'shop', route: '',
    lang: LS.get('lang', 'so'),
    cart: [], parked: LS.get('parked', []),
    queue: LS.get('queue', []), failed: LS.get('failed', []),
    online: navigator.onLine, syncing: false
  };

  /* ---------------- text / format helpers ---------------- */
  function t(s, vars) {
    let out = (S.lang === 'so' && window.SO && window.SO[s]) || s;
    if (vars) Object.keys(vars).forEach(k => { out = out.split('{' + k + '}').join(vars[k]); });
    return out;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const fmt = n => Math.round(num(n)).toLocaleString('en-US');
  const money = n => fmt(n) + ' SH';
  const rate = () => num(S.data && S.data.settings.usdRate) || 11850;
  const usd = n => '$' + (num(n) / rate()).toFixed(2);
  const roundStep = x => { const st = num(S.data && S.data.settings.roundStep) || 1; return Math.max(0, Math.round(x / st) * st); };
  const uid = p => p + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 7).toUpperCase();
  function localParts(d) {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d || new Date());
    const g = x => p.find(y => y.type === x).value;
    return { date: g('year') + '-' + g('month') + '-' + g('day'), time: g('hour') + ':' + g('minute') };
  }
  const today = () => localParts().date;
  const addDays = (ds, n) => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const when = iso => { if (!iso) return ''; const s = String(iso); return s.slice(0, 10) === today() ? s.slice(11, 16) : s.slice(5, 10).replace('-', '/') + ' ' + s.slice(11, 16); };
  const bizName = b => b === 'food' ? t('Fast Food') : b === 'shop' ? t('Shop') : t('Both');
  const methodName = m => ({ cash: t('Cash'), zaad: 'Zaad', edahab: 'Edahab', credit: t('Credit') }[m] || m);

  /* ---------------- permissions ---------------- */
  const isOwner = () => S.user && S.user.role === 'owner';
  const can = p => isOwner() || (S.user && S.user.perms.indexOf(p) >= 0);
  const foodOn = () => !(S.data && S.data.settings && S.data.settings.food_enabled === '0');
  const myBiz = () => !S.user ? [] : ((isOwner() || S.user.business === 'both') ? ['shop', 'food'] : [S.user.business]).filter(b => b !== 'food' || foodOn());
  const setting = k => S.data ? S.data.settings[k] : '';
  const prods = (b) => (S.data ? S.data.products : []).filter(p => p.business === (b || S.biz) && String(p.active) !== '0');
  const findProd = id => (S.data ? S.data.products : []).find(p => p.id === id);
  /* Selling loose (pieces) — the same rules as the server (Code.gs). Stock of a loose item is kept in pieces; price/cost are per packet. */
  const isLoose = p => !!p && p.business === 'shop' && (p.loose === 1 || p.loose === '1' || p.loose === true) && num(p.perPack) > 1;
  function looseTable(p) {
    let tb = []; try { tb = typeof p.looseTable === 'string' ? JSON.parse(p.looseTable || '[]') : (p.looseTable || []); } catch (e) {}
    return (Array.isArray(tb) ? tb : []).map(r => [Math.floor(num(r[0])), num(r[1])]).filter(r => r[0] > 0 && r[1] > 0 && r[0] < num(p.perPack)).sort((a, b) => a[0] - b[0]);
  }
  function loosePrice(p, n) {   // whole packets at the packet price; the rest from the price list, added up from the biggest rows; never more than a packet
    const per = num(p.perPack), pack = num(p.price), tb = looseTable(p);
    let total = Math.floor(n / per) * pack; const rest = n % per;
    if (!rest) return total;
    const exact = tb.find(r => r[0] === rest); let part = 0;
    if (exact) part = exact[1];
    else { let left = rest; const desc = tb.slice().reverse(); while (left > 0) { const r = desc.find(x => x[0] <= left); if (!r) { part += Math.round(pack / per * left); break; } part += r[1]; left -= r[0]; } }
    return total + Math.min(part, pack);
  }
  function stockTxt(p, n) {   // "4 pk + 7 pcs"
    n = n === undefined ? num(p.stock) : num(n);
    if (!isLoose(p)) return fmt(n);
    const per = num(p.perPack), a = Math.abs(n), pk = Math.floor(a / per), pc = a % per;
    return (n < 0 ? '−' : '') + (pk ? pk + ' ' + t('pk') : '') + (pk && pc ? ' + ' : '') + (pc || !pk ? pc + ' ' + t('pcs') : '');
  }
  const lowAt = p => isLoose(p) ? num(p.lowStock) * num(p.perPack) : num(p.lowStock);
  const isLow = p => num(p.stock) <= lowAt(p);
  const piecesOf = (p, qty, unit) => isLoose(p) ? (unit === 'pc' ? num(qty) : num(qty) * num(p.perPack)) : num(qty);
  function lineTotal(l) { const p = findProd(l.productId); return l.unit === 'pc' && p && isLoose(p) ? loosePrice(p, l.qty) : num(l.price) * num(l.qty); }
  const myShift = (b) => (S.data ? S.data.shifts : []).find(s => s.status === 'open' && s.business === (b || S.biz) && s.userId === S.user.id);

  /* ---------------- server calls ---------------- */
  class AppError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }

  function friendly(raw) {
    const m = String(raw || '');
    if (/^AUTH/.test(m)) return t('Your session ended. Please log in again.');
    if (/^HOURS/.test(m)) return t('Outside working hours. Ask an owner for access.');
    if (/^SHIFT/.test(m)) return t('Start a shift before selling.');
    if (/^LOCKED/.test(m)) return t('Too many wrong PINs. Wait 5 minutes.');
    if (/^CLOSED/.test(m) || /Fast Food is closed/.test(m)) return t('Fast Food is closed. Ask the owner.');
    if (/^NOPERM/.test(m)) return t('You do not have permission for this.');
    const w = m.match(/^Wrong PIN \((\d+)/); if (w) return t('Wrong PIN. {n} tries left.', { n: w[1] });
    return t(m);
  }

  async function api(action, data, opts) {
    opts = opts || {};
    const url = CFG.API_URL || '';
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url) && !CFG.TEST_MODE)
      throw new AppError(t('The app is not connected yet: the script address in config.js is missing or wrong (it must end with /exec).'), 'config');
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), opts.timeout || 45000);
    let res;
    const tok = S.token;   // the session this request belongs to
    progress(1);
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, data: data || {}, token: tok }), keepalive: action === 'logout', redirect: 'follow', signal: ctl ? ctl.signal : undefined });
    } catch (e) {
      const aborted = e && e.name === 'AbortError';
      netFails++;
      if (!navigator.onLine || (!aborted && netFails >= 2)) setOnline(false);
      throw new AppError(!navigator.onLine ? t('No internet connection.') : aborted ? t('The script took too long to answer. Check the internet and try again.')
        : t('Cannot reach the script. Check the internet. If it keeps happening, the Apps Script deployment must have access "Anyone".'), 'network');
    } finally { clearTimeout(timer); progress(-1); }
    netFails = 0; setOnline(true);
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch (e) {
      throw new AppError(/<html|<!DOCTYPE/i.test(text) ? t('The script answered with a Google page instead of data. The deployment access must be "Anyone" and the URL must end with /exec.')
        : t('The script sent an unexpected answer (HTTP {s}).', { s: res.status }), 'server');
    }
    // An answer that arrives after this person logged out (or someone else logged in) is ignored quietly.
    if (tok !== S.token && action !== 'login' && action !== 'names') throw new AppError('', 'stale');
    if (!j.ok) {
      if (/^AUTH/.test(j.error || '')) { if (!S.loggingOut) sessionEnded(); throw new AppError('', 'stale'); }
      throw new AppError(friendly(j.error), 'app');
    }
    if (tok && S.token === tok && !S.offlineSession) {   // the server keeps an active session alive: move our end time too
      const exp = Date.now() + 5.5 * 3600 * 1000;
      if (exp - S.expires > 10 * 60 * 1000) { S.expires = exp; if (S.user) LS.set('session', { token: tok, expires: exp, user: S.user }); }
    }
    return j;
  }
  let busyCount = 0, netFails = 0;
  function progress(d) { busyCount = Math.max(0, busyCount + d); }   // background work is invisible on purpose (no loading bar)

  function setOnline(v) { if (S.online !== v) { S.online = v; updateTop(); } }

  /* ---------------- offline queue ---------------- */
  function enqueue(action, data) {
    const op = { qid: uid('Q'), action, data, userId: S.user.id, userName: S.user.name, ts: new Date().toISOString() };
    S.queue.push(op); LS.set('queue', S.queue); updateTop();
    setTimeout(syncNow, 50);
    return op;
  }
  async function syncNow() {
    if (S.syncing || !S.token || !S.user) return;
    const mine = S.queue.filter(o => o.userId === S.user.id);
    if (!mine.length) return;
    S.syncing = true; updateTop();
    try {
      while (true) {
        const batch = S.queue.filter(o => o.userId === S.user.id).slice(0, 15);
        if (!batch.length) break;
        const r = await api('sync', { dataVersion: LS.get('dataVersion', ''), ops: batch.map(o => ({ qid: o.qid, action: o.action, data: o.data })) }, { timeout: 60000 });
        if (r.reset) { dataWasReset(r.dataVersion); break; }
        let stop = false;
        r.results.forEach(res => {
          const op = S.queue.find(o => o.qid === res.qid);
          if (!op) return;
          if (res.ok) { S.queue = S.queue.filter(o => o !== op); applyResult(op, res.result); }
          else if (/busy|Service invoked too many|timed out/i.test(res.error)) { stop = true; }
          else { S.queue = S.queue.filter(o => o !== op); op.error = res.error; S.failed.push(op); toast(t('Not saved: {e}', { e: friendly(res.error) }), 'err', 6000); }
        });
        LS.set('queue', S.queue); LS.set('failed', S.failed); saveData();
        if (stop) break;
      }
    } catch (e) {
      if (e.kind !== 'network') console.warn(e);
    } finally { S.syncing = false; updateTop(); if (window.Screens && Screens.onSync) Screens.onSync(); }
  }
  // The owner reset the data: whatever this phone still had waiting belongs to the old data, so it is dropped.
  function dataWasReset(v) {
    const n = S.queue.length;
    S.queue = []; S.failed = []; S.cart = []; LS.set('queue', []); LS.set('failed', []); LS.set('parked', []); S.parked = [];
    LS.get('ckeys', []).forEach(k => LS.del(k.replace(/^saado_/, ''))); LS.set('ckeys', []);
    LS.set('dataVersion', String(v || ''));
    toast(t('The owner reset the data.') + (n ? ' ' + t('{n} unsent items on this phone were removed.', { n }) : ''), 'warn', 7000);
    refresh(true).then(() => { drawShell(); render(); });
  }
  function applyResult(op, r) {
    if (!r || !S.data) return;
    if (r.stock) r.stock.forEach(x => { const p = findProd(x.id); if (p) { p.stock = x.stock; p.sold = x.sold; } });
    if (r.customer) upsert('customers', r.customer);
    if (r.shift) upsert('shifts', r.shift);
    if (r.ingredients) S.data.ingredients = r.ingredients;
    if (r.low && r.low.length) toast(t('Running low: {x}', { x: r.low.map(x => t(x)).join(', ') }), 'warn', 6000);
  }
  function upsert(list, obj) {
    if (!S.data[list]) S.data[list] = [];
    const i = S.data[list].findIndex(x => x.id === obj.id);
    if (i >= 0) S.data[list][i] = Object.assign(S.data[list][i], obj); else S.data[list].push(obj);
    saveData();
  }
  function saveData() { if (S.data) LS.set('data_' + S.user.id, S.data); }

  /* ---------------- session ---------------- */
  function startSession(b) {
    S.token = b.token; S.expires = b.expires; S.user = b.user; S.data = b;
    const dv = String(b.settings && b.settings.dataVersion || ''), had = LS.get('dataVersion', '');
    if (had && dv && had !== dv) setTimeout(() => dataWasReset(dv), 50); else if (dv) LS.set('dataVersion', dv);
    S.lang = b.user.lang || S.lang; LS.set('lang', S.lang);
    LS.set('session', { token: S.token, expires: S.expires, user: S.user });
    LS.set('sess_' + S.user.id, { token: S.token, expires: S.expires, user: S.user }); S.offlineSession = false;
    saveData();
    const saved = LS.get('biz_' + S.user.id);
    S.biz = myBiz().indexOf(saved) >= 0 ? saved : myBiz()[0];
  }
  async function refresh(quiet) {
    try {
      const b = await api('boot', {});
      const sig = d => d ? JSON.stringify([d.products, d.customers, d.suppliers, d.ingredients, d.shifts, d.settings, d.pendingRefunds, d.user]) : '';
      const before = sig(S.data);
      const tok = S.token, exp = S.expires;
      const dv = String(b.settings && b.settings.dataVersion || ''), had = LS.get('dataVersion', '');
      if (had && dv && had !== dv) { S.data = b; dataWasReset(dv); return 'changed'; }
      if (dv) LS.set('dataVersion', dv);
      S.data = b; S.user = b.user; S.token = tok; S.expires = exp;
      LS.set('session', { token: S.token, expires: S.expires, user: S.user });
      // re-apply sales still waiting in the queue so local stock stays right
      S.queue.forEach(op => { if (op.action === 'shift.open' && !S.data.shifts.some(x => x.id === op.data.id)) S.data.shifts.push(Object.assign({ status: 'open', userId: op.userId, userName: op.userName, openTs: op.ts.slice(0, 19), rate: rate() }, op.data)); });
      S.queue.forEach(op => { if (op.action === 'sale.create' && op.data.business === 'shop') op.data.items.forEach(it => { const p = findProd(it.productId); if (p) p.stock = num(p.stock) - num(it.qty); }); });
      saveData(); updateTop();
      return sig(S.data) !== before ? 'changed' : true;
    } catch (e) { if (!quiet) toast(e.message, 'err'); return false; }
  }
  function sessionEnded() {
    if (!S.token) return;
    S.token = null; LS.del('session');
    setTimeout(() => { if (!document.querySelector('.login')) { showLogin(); setTimeout(() => toast(t('For safety, please type your PIN again.'), 'warn', 5000), 50); } }, 10);
  }
  // Log out at once on this phone (with a clear "Logging out…" screen); the server is told in the background.
  async function logout() {
    if (S.loggingOut) return;
    const waiting = S.queue.filter(o => o.userId === S.user.id).length;
    if (waiting && !(await confirmBox(t('{n} items are not sent yet. They stay on this phone and will be sent when you log in again. Log out?', { n: waiting })))) return;
    S.loggingOut = true;
    const ov = document.createElement('div'); ov.className = 'busyov';
    ov.innerHTML = `<div class="bx"><span class="spin"></span><b>${esc(t('Logging out…'))}</b><span class="small muted">${esc(t('Please wait'))}</span></div>`;
    document.body.appendChild(ov);
    try {
      if (S.online && S.token && !S.offlineSession) api('logout', {}, { timeout: 10000 }).catch(() => {});
      stopCamera();
      S.token = null; S.cart = []; LS.del('session');   // the per-user copy stays so this person can still unlock offline later
      await new Promise(r => setTimeout(r, 450));      // long enough to see that the tap worked
      document.querySelectorAll('.ov').forEach(x => x.remove());
      await showLogin();
    } finally { S.loggingOut = false; ov.remove(); }
  }

  /* ---------------- icons (line icons, 24px grid) ---------------- */
  const IC = {
    home: ['p:M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
    cart: ['c:9,20,1.5', 'c:18,20,1.5', 'p:M2.5 3h2.2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7H6'],
    clock: ['c:12,12,9', 'p:M12 7v5l3 2'],
    users: ['c:9.5,8,3.5', 'p:M3 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1', 'p:M16 4.6a3.5 3.5 0 0 1 0 6.8', 'p:M21 20v-1a5 5 0 0 0-3-4.6'],
    menu: ['p:M4 7h16M4 12h16M4 17h16'],
    chart: ['p:M3 21h18', 'p:M7 17v-5', 'p:M12 17V7', 'p:M17 17v-8'],
    wallet: ['p:M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6', 'p:M16.5 14h.01'],
    swap: ['p:M7 4 3 8l4 4', 'p:M3 8h14', 'p:m17 20 4-4-4-4', 'p:M21 16H7'],
    undo: ['p:M3 12a9 9 0 1 0 3-6.7L3 8', 'p:M3 3v5h5'],
    box: ['p:M21 8 12 3 3 8v8l9 5 9-5z', 'p:M3 8l9 5 9-5', 'p:M12 13v8'],
    food: ['p:M6 3v7a2 2 0 0 0 4 0V3', 'p:M8 10v11', 'p:M18 21V3c-2.2 1.2-3.5 4-3.5 7.5V13H18'],
    clipboard: ['p:M9 4h6v3H9z', 'p:M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2', 'p:M9 14l2 2 4-4'],
    truck: ['p:M3 6h11v10H3z', 'p:M14 9h4l3 3v4h-7', 'c:7,18,2', 'c:17,18,2'],
    shield: ['p:M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z', 'p:M9 12l2 2 4-4'],
    sliders: ['p:M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1', 'c:15,6,2', 'c:9,12,2', 'c:17,18,2'],
    file: ['p:M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'p:M14 3v6h6', 'p:M8 13h8M8 17h5'],
    sync: ['p:M20 11A8 8 0 0 0 6 6.3L4 8', 'p:M4 4v4h4', 'p:M4 13a8 8 0 0 0 14 4.7l2-1.7', 'p:M20 20v-4h-4'],
    key: ['c:8,15,4', 'p:M10.9 12.1 20 3', 'p:M16.5 6.5l2 2', 'p:M14 9l2 2'],
    globe: ['c:12,12,9', 'p:M3 12h18', 'p:M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18'],
    book: ['p:M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z', 'p:M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3'],
    logout: ['p:M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'p:M10 17l5-5-5-5', 'p:M15 12H3'],
    scan: ['p:M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3', 'p:M8 8v8M11 8v8M14 8v8M17 8v8'],
    search: ['c:11,11,7', 'p:M20 20l-3.5-3.5'],
    plus: ['p:M12 5v14M5 12h14'], minus: ['p:M5 12h14'], x: ['p:M6 6l12 12M18 6 6 18'], check: ['p:M5 12.5l4.5 4.5L19 7'],
    down: ['p:M6 9l6 6 6-6'], right: ['p:M9 6l6 6-6 6'], left: ['p:M15 6l-6 6 6 6'],
    user: ['c:12,8,4', 'p:M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'],
    backspace: ['p:M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z', 'p:M12.5 9.5l5 5M17.5 9.5l-5 5'],
    download: ['p:M12 3v12', 'p:M7 10l5 5 5-5', 'p:M5 21h14'],
    chat: ['p:M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5z'],
    phone: ['p:M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'],
    edit: ['p:M4 20h4L19 9l-4-4L4 16z', 'p:M14 6l4 4'],
    cash: ['p:M3 6h18v12H3z', 'c:12,12,2.5', 'p:M6.5 9.5h.01M17.5 14.5h.01'],
    pause: ['p:M9 5v14M15 5v14'], trash: ['p:M4 7h16', 'p:M10 11v6M14 11v6', 'p:M6 7l1 13h10l1-13', 'p:M9 7V4h6v3'],
    alert: ['p:M12 3.5 2.5 20h19z', 'p:M12 10v4.5', 'p:M12 17.5h.01'],
    printer: ['p:M7 9V3h10v6', 'p:M7 17H4v-7h16v7h-3', 'p:M7 14h10v7H7z'],
    send: ['p:M21 3 10 14', 'p:M21 3l-7 18-4-7-7-4z'],
    inbox: ['p:M3 13h5l1.5 3h5L16 13h5', 'p:M5.5 5h13L21 13v6H3v-6z'],
    store: ['p:M4 9l1.5-5h13L20 9', 'p:M4 9h16v1.5a3 3 0 0 1-5.3 1.8 3 3 0 0 1-5.4 0A3 3 0 0 1 4 10.5z', 'p:M5 13v8h14v-8', 'p:M10 21v-5h4v5'],
    wifioff: ['p:M3 3l18 18', 'p:M8.5 16.5a5 5 0 0 1 7 0', 'p:M5 12.6a10 10 0 0 1 4.2-2.4', 'p:M12 20h.01', 'p:M14.8 10.3A10 10 0 0 1 19 12.6'],
    okcircle: ['c:12,12,9', 'p:M8 12.5l3 3 5-6'],
    star: ['p:M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z'],
    tag: ['p:M3 12V4h8l10 10-8 8z', 'p:M7.5 7.5h.01'],
    receipt: ['p:M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z', 'p:M9 8h6M9 12h6'],
    bell: ['p:M6 16V11a6 6 0 0 1 12 0v5l2 2H4z', 'p:M10 21h4'],
    lock: ['p:M6 11h12v10H6z', 'p:M8 11V7a4 4 0 0 1 8 0v4'],
    install: ['p:M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z', 'p:M12 7v8', 'p:M9 12l3 3 3-3', 'p:M11 19h2'],
    share: ['c:18,5,2.5', 'c:6,12,2.5', 'c:18,19,2.5', 'p:M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4'],
    calendar: ['p:M4 5h16v16H4z', 'p:M4 10h16', 'p:M8 3v4M16 3v4']
  };
  function icon(name, cls) {
    const parts = (IC[name] || IC.box).map(x => {
      const k = x.slice(0, 2), v = x.slice(2);
      if (k === 'c:') { const [cx, cy, r] = v.split(','); return `<circle cx="${cx}" cy="${cy}" r="${r}"/>`; }
      return `<path d="${v}"/>`;
    }).join('');
    return `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${parts}</svg>`;
  }

  /* ---------------- offline login ----------------
     After a normal login this phone keeps a salted hash of the PIN, so the same person can unlock the app
     with their PIN while the internet is down. Everything they do waits in the queue and is sent later. */
  async function sha(txt) {
    if (!window.crypto || !crypto.subtle) return null;
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function rememberPin(userId, pin) {
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x => x.toString(16).padStart(2, '0')).join('');
    const h = await sha(salt + ':' + pin); if (h) LS.set('cred_' + userId, { salt, h });
  }
  async function offlineUnlock(userId, pin) {
    const c = LS.get('cred_' + userId, null), sess = LS.get('sess_' + userId, null), data = LS.get('data_' + userId, null);
    if (!c || !sess || !data) return false;
    if ((await sha(c.salt + ':' + pin)) !== c.h) throw new AppError(t('Wrong PIN.'), 'app');
    S.token = sess.token; S.expires = sess.expires; S.user = sess.user; S.data = data; S.offlineSession = true;
    LS.set('session', sess);
    const saved = LS.get('biz_' + S.user.id); S.biz = myBiz().indexOf(saved) >= 0 ? saved : myBiz()[0];
    S.lang = S.user.lang || S.lang;
    return true;
  }

  /* ---------------- login screen ---------------- */
  async function showLogin() {
    stopCamera();
    document.getElementById('top').classList.add('hidden');
    document.getElementById('nav').classList.add('hidden');
    const ob = document.getElementById('offbar'); if (ob) ob.remove();
    const main = document.getElementById('main');
    let names = LS.get('names', []), sel = LS.get('lastUser', null), pin = '', open = false;
    main.className = 'page-in';
    main.style.padding = '0';
    main.innerHTML = `<div class="login">
      <div class="lang"><button data-l="so" class="${S.lang === 'so' ? 'on' : ''}">Somali</button><button data-l="en" class="${S.lang === 'en' ? 'on' : ''}">English</button></div>
      <img class="logo" src="icons/logo.png" alt="Saado Shop and Fast Food">
      <h1>${esc(t('Welcome. Please Login'))}</h1>
      <div class="box">
        <div class="lgcard" id="ucard"><button class="dd" id="dd">${icon('user')}<span class="grow" id="ddv"></span>${icon('down', 'chev')}</button></div>
        <div class="lgcard">
          <div class="pinrow"><span>PIN</span><div class="pinshow" id="pinshow"></div></div>
          <div class="pad" id="pad"></div>
        </div>
        <div class="lgerr" id="lgerr"></div>
      </div>
      <div class="lgfoot">Saado POS · v${APP_VERSION}</div></div>`;
    main.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { S.lang = b.dataset.l; LS.set('lang', S.lang); showLogin(); });
    const drawSel = () => {
      const u = names.find(x => x.id === sel);
      document.getElementById('ddv').innerHTML = u ? esc(u.name) : `<span class="ph">${esc(names.length ? t('Choose your name') : t('Loading names…'))}</span>`;
    };
    const closeList = () => { open = false; const l = document.getElementById('ddlist'); if (l) l.remove(); document.getElementById('dd').classList.remove('open'); };
    document.getElementById('dd').onclick = () => {
      if (open) return closeList();
      if (!names.length) return;
      open = true; document.getElementById('dd').classList.add('open');
      const l = document.createElement('div'); l.className = 'ddlist'; l.id = 'ddlist';
      l.innerHTML = names.map(u => `<button data-id="${esc(u.id)}" class="${sel === u.id ? 'on' : ''}">${esc(u.name)}</button>`).join('');
      document.getElementById('ucard').appendChild(l);
      l.querySelectorAll('button').forEach(b => b.onclick = () => { sel = b.dataset.id; pin = ''; drawPin(); drawSel(); closeList(); document.getElementById('lgerr').textContent = ''; });
    };
    const drawPin = () => { const s = document.getElementById('pinshow'); if (s) s.innerHTML = [0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map(i => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join(''); };
    const pad = document.getElementById('pad');
    pad.innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bk', '0', 'OK'].map(k => `<button data-k="${k}" class="${k === 'OK' ? 'go' : k === 'bk' ? 'bk' : ''}" aria-label="${k === 'bk' ? 'delete' : k}">${k === 'OK' ? esc(t('Enter')) : k === 'bk' ? icon('backspace', 'lg') : k}</button>`).join('');
    const err = m => { const e = document.getElementById('lgerr'); if (e) e.textContent = m; const ps = document.getElementById('pinshow'); if (ps) { ps.classList.remove('shake'); void ps.offsetWidth; ps.classList.add('shake'); } if (navigator.vibrate) navigator.vibrate(120); };
    let busy = false, slowT = null;
    // While the PIN is being checked: the Enter button spins, the keypad is locked and a clear "please wait" shows, so nobody taps twice.
    const setBusy = on => {
      busy = on; pad.classList.toggle('busy', on);
      const go = pad.querySelector('.go'); if (go) go.innerHTML = on ? '<span class="spin"></span>' : esc(t('Enter'));
      const ps = document.getElementById('pinshow'); if (ps) ps.classList.toggle('pulse', on);
      const e = document.getElementById('lgerr'); clearTimeout(slowT);
      if (on) {
        e.innerHTML = `<span class="lgwait"><span class="spin"></span>${esc(t('Logging in… please wait'))}</span>`;
        slowT = setTimeout(() => { const w = document.querySelector('.lgwait'); if (w) w.innerHTML = `<span class="spin"></span>${esc(t('Still checking — the internet is slow. Please wait.'))}`; }, 6000);
      } else if (e.querySelector('.lgwait')) e.textContent = '';
    };
    const submit = async () => {
      if (busy) return;
      if (!sel) return err(t('Choose your name'));
      if (pin.length < 4) return err(t('PIN must be 4 to 6 digits'));
      setBusy(true);
      try {
        let b = null;
        try { b = await api('login', { userId: sel, pin }); }
        catch (x) { if (x.kind !== 'network' && x.kind !== 'config') throw x; }
        if (b) { setBusy(false); LS.set('lastUser', sel); rememberPin(sel, pin).catch(() => {}); main.style.padding = ''; startSession(b); boot(); setTimeout(prefetch, 1500); return; }
        if (await offlineUnlock(sel, pin)) { setBusy(false); LS.set('lastUser', sel); main.style.padding = ''; boot(); toast(t('Offline: sales are saved on this phone and sent later.'), 'warn', 4000); return; }
        throw new AppError(t('No internet. This person must log in once with internet on this phone first.'), 'app');
      } catch (x) { setBusy(false); pin = ''; drawPin(); err(x.message); }
    };
    pad.querySelectorAll('button').forEach(b => b.onclick = () => {
      if (busy) return;
      const k = b.dataset.k;
      if (k === 'bk') pin = pin.slice(0, -1); else if (k === 'OK') return submit(); else if (pin.length < 6) pin += k;
      drawPin(); if (navigator.vibrate) navigator.vibrate(8);
      if (pin.length === 6) submit();
    });
    document.onkeydown = e => { if (!document.getElementById('pad')) { document.onkeydown = null; return; } if (busy) return; if (/^\d$/.test(e.key) && pin.length < 6) { pin += e.key; drawPin(); } else if (e.key === 'Backspace') { pin = pin.slice(0, -1); drawPin(); } else if (e.key === 'Enter') submit(); };
    drawSel(); drawPin();
    try {
      const r = await api('names', {});
      names = r.users; LS.set('names', names);
      if (sel && !names.find(u => u.id === sel)) sel = null;
      drawSel();
    } catch (e) { err(e.message); if (names.length) drawSel(); }
  }

  /* ---------------- shell ---------------- */
  const TITLES = { insights: 'Insights', emails: 'My email reports', home: 'Home', sell: 'Sell', shift: 'Shift', customers: 'Customers', expenses: 'Expenses', more: 'More', products: 'Products', stockcount: 'Stock count',
    purchasing: 'Purchasing', ingredients: 'Ingredients', refunds: 'Refunds', reports: 'Reports', users: 'Users', settings: 'Settings', audit: 'Audit log', sync: 'Sync status', pin: 'My PIN', guide: 'Guide' };
  function navItems() {
    const n = [];
    if (can('viewReports')) n.push(['home', 'home', t('Home')]);
    n.push(['sell', 'cart', t('Sell')]);
    n.push(['shift', 'clock', t('Shift')]);
    if (can('viewReports')) n.push(['reports', 'chart', t('Reports')]);
    else if (can('customers') && setting(S.biz + '_credit') === '1') n.push(['customers', 'users', t('Customers')]);
    else if (can('expenses')) n.push(['expenses', 'wallet', t('Expenses')]);
    n.push(['more', 'menu', t('More')]);
    return n;
  }
  function updateTop() {
    const top = document.getElementById('top'); if (!top || !S.user) return;
    const pending = S.queue.length, mine = S.queue.filter(o => o.userId === S.user.id).length;
    const sd = document.getElementById('syncdot');
    if (sd) {
      sd.className = 'syncdot' + (!S.online ? ' off' : pending ? ' wait' : '') + (S.syncing ? ' spin' : '');
      sd.innerHTML = icon(!S.online ? 'wifioff' : S.syncing || pending ? 'sync' : 'okcircle') + (pending ? `<span class="n">${pending}</span>` : '');
      sd.setAttribute('aria-label', !S.online ? t('Offline') : pending ? t('Waiting to send') + ' ' + mine : t('Everything is sent'));
    }
    let ob = document.getElementById('offbar');
    if (!S.online && !ob) { ob = document.createElement('div'); ob.id = 'offbar'; ob.className = 'offline-bar'; ob.innerHTML = icon('wifioff', 'sm') + '<span>' + esc(t('Offline: sales are saved on this phone and sent later.')) + '</span>'; top.after(ob); }
    if (S.online && ob) ob.remove();
    const nb = document.querySelector('#nav [data-r="more"] .badge');
    const alerts = (S.data && S.data.pendingRefunds && can('approveRefunds') ? S.data.pendingRefunds : 0) + S.failed.length;
    if (nb) { nb.textContent = alerts; nb.classList.toggle('hidden', !alerts); }
  }
  function setTitle() {
    const tt = document.querySelector('#top .ttl'); if (!tt) return;
    tt.innerHTML = `<b>${esc(t(TITLES[S.route] || 'Saado'))}</b><span>${esc(S.user.name)} · ${esc(bizName(S.biz))}</span>`;
  }
  function drawShell() {
    const top = document.getElementById('top'), nav = document.getElementById('nav');
    top.classList.remove('hidden'); nav.classList.remove('hidden');
    const bizs = myBiz();
    top.innerHTML = `<div class="emb"><img src="icons/icon-192.png" alt=""></div><div class="ttl"></div>
      ${bizs.length > 1 ? `<div class="bizswitch">${bizs.map(b => `<button data-b="${b}" class="${S.biz === b ? 'on' : ''}" aria-label="${esc(bizName(b))}">${icon(b === 'shop' ? 'store' : 'food')}<span>${esc(b === 'shop' ? t('Shop') : t('Food'))}</span></button>`).join('')}</div>` : ''}
      <button class="syncdot" id="syncdot"></button>`;
    top.querySelectorAll('[data-b]').forEach(b => b.onclick = () => {
      if (S.cart.length && b.dataset.b !== S.biz) { toast(t('Finish or park the current sale first'), 'warn'); return; }
      S.biz = b.dataset.b; LS.set('biz_' + S.user.id, S.biz); drawShell(); render();
    });
    document.getElementById('syncdot').onclick = () => go('sync');
    nav.innerHTML = navItems().map(([r, ic, l]) => `<button data-r="${r}" class="${S.route === r ? 'on' : ''}"><span class="ind">${icon(ic)}</span><span>${esc(l)}</span>${r === 'more' ? '<span class="badge hidden"></span>' : ''}</button>`).join('');
    nav.querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.r));
    setTitle(); updateTop();
  }
  function go(r) { if (location.hash !== '#' + r) location.hash = r; else render(); }
  function render() {
    if (!S.user || !S.token) return;
    stopCamera();
    document.querySelectorAll('.ov').forEach(x => x.remove());
    let r = (location.hash || '').slice(1) || (can('viewReports') ? 'home' : 'sell');
    const scr = window.Screens && Screens[r.split('/')[0]];
    if (!scr || typeof scr !== 'function' || r === 'productForm' || r === 'onSync') r = 'sell';
    S.route = r.split('/')[0];
    const inNav = navItems().some(n => n[0] === S.route);
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.r === S.route || (!inNav && b.dataset.r === 'more')));
    const main = document.getElementById('main');
    main.style.padding = '';
    main.className = '';
    main.innerHTML = '';
    document.querySelectorAll('.cartbar, .fab').forEach(x => x.remove());
    setTitle();
    if (!S.soft) { window.scrollTo(0, 0); void main.offsetWidth; main.className = 'page-in'; }
    try { Screens[S.route](main, r.split('/').slice(1)); } catch (e) { console.error(e); main.innerHTML = `<div class="card red">${esc(t('Something went wrong on this screen:'))} ${esc(e.message)}</div>`; }
  }

  async function boot() {
    drawShell(); render();
    syncNow();
    if (S.data && S.user && !S.user.pinChanged && !LS.get('pinNag_' + S.user.id)) {
      LS.set('pinNag_' + S.user.id, 1);
      setTimeout(() => toast(t('Tip: change your PIN in More → My PIN.'), 'warn', 5000), 800);
    }
  }

  /* ---------------- offline-first data ----------------
     Every screen shows what is saved on this phone at once, then refreshes quietly in the background.
     Nothing "loads" in front of the user; if the internet is gone, the last saved data is shown. */
  const CKEYS = 'ckeys', CMAX = 45;
  function ckey(action, data) { return 'c_' + (S.user ? S.user.id : '') + '_' + action + '_' + JSON.stringify(data || {}); }
  function cacheGet(action, data) { const h = LS.get(ckey(action, data), null); return h ? h.r : null; }
  function cachePut(action, data, r) {
    const k = ckey(action, data);
    let keys = LS.get(CKEYS, []).filter(x => x !== k); keys.push(k);
    while (keys.length > CMAX) LS.del(keys.shift().replace(/^saado_/, ''));
    LS.set(k, { r, at: Date.now() }); LS.set(CKEYS, keys);
  }
  /** onData(result, fromCache) is called with saved data first (if any) and again only if the server has something newer. */
  async function cachedCall(action, data, onData) {
    const hit = cacheGet(action, data);
    if (hit && onData) onData(hit, true);
    if (!S.online && hit) return hit;
    try {
      const r = await api(action, data);
      const same = hit && JSON.stringify(hit) === JSON.stringify(r);
      cachePut(action, data, r);
      if (!same && onData) onData(r, false);
      return r;
    } catch (e) {
      if (hit) return hit;
      throw e;
    }
  }
  // Re-draw the current screen with fresh data, but never while the user is typing, has a sheet open, or is mid-sale search.
  function softRender() {
    if (!S.user || !S.token || document.querySelector('.ov')) return;
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    if (Array.from(document.querySelectorAll('#main input, #main textarea')).some(i => i.type !== 'checkbox' && i.type !== 'date' && i.value)) return;
    const y = window.scrollY; S.soft = true;
    try { render(); } finally { S.soft = false; }
    window.scrollTo(0, y);
  }
  // Fill the phone's memory for every tab, so all of them open instantly and work offline.
  let prefetching = false;
  async function prefetch() {
    if (prefetching || !S.online || !S.token || !S.user) return;
    prefetching = true;
    try {
      const td = today(), jobs = [];
      const bizs = myBiz();
      if (can('viewReports')) {
        (bizs.length > 1 ? ['all'].concat(bizs) : bizs).forEach(b => jobs.push(['report', { business: b, from: td, to: td }]));
        jobs.push(['shift.list', { business: S.biz, from: addDays(td, -7), to: td }]);
      }
      jobs.push(['refund.list', { business: S.biz }]);
      if (can('expenses')) jobs.push(['exp.list', { business: S.biz, from: td, to: td }]);
      if (can('suppliers')) jobs.push(['po.list', { business: S.biz }]);
      if (can('manageUsers')) jobs.push(['users.list', {}]);
      if (can('viewInsights')) jobs.push(['insights', { month: td.slice(0, 7), business: bizs.length > 1 ? 'all' : bizs[0] }]);
      if (can('settings')) jobs.push(['recip.list', {}]);
      if (isOwner()) jobs.push(['admin.counts', {}]);
      if (can('audit')) jobs.push(['audit.list', { from: addDays(td, -2), to: td, q: '' }]);
      if (S.biz === 'food' && (can('ingredients') || can('manageProducts'))) jobs.push(['ing.log', { from: addDays(td, -6), to: td }]);
      const sh = myShift(); if (sh && !S.queue.some(o => o.data && o.data.id === sh.id)) jobs.unshift(['shift.live', { id: sh.id }]);
      for (const [a, d] of jobs) {
        if (!S.online || !S.token) break;
        try { cachePut(a, d, await api(a, d)); } catch (e) { if (e.kind === 'network') break; }
      }
    } finally { prefetching = false; }
  }
  async function backgroundUpdate() {
    if (!S.token || !S.online || document.hidden) return;
    await syncNow();
    const r = await refresh(true);
    if (r === 'changed') { drawShell(); softRender(); }
    prefetch();
  }
  setInterval(backgroundUpdate, 120000);   // every 2 minutes: other users' changes appear without anyone waiting

  /* ---------------- UI helpers ---------------- */
  function toast(msg, type, ms, action) {
    if (!msg) return;   // quiet errors (e.g. an old answer after logging out)
    const box = document.getElementById('toasts');
    while (box.children.length >= 1) box.firstChild.remove();
    const el = document.createElement('div'); el.className = 'toast ' + (type || '');
    el.innerHTML = icon(type === 'ok' ? 'okcircle' : type === 'err' || type === 'warn' ? 'alert' : 'bell') + '<span></span>' + (action ? '<button class="tact"></button>' : '');
    el.querySelector('span').textContent = msg;
    if (action) { const b = el.querySelector('.tact'); b.textContent = action.label; b.onclick = e => { e.stopPropagation(); el.remove(); action.fn(); }; }
    box.appendChild(el);
    el.onclick = () => el.remove();
    setTimeout(() => el.remove(), ms || (type === 'err' ? 5000 : 2400));
    if (type === 'err' && navigator.vibrate) navigator.vibrate([60, 40, 60]);
  }
  // sheet({title, body, actions:[{label, cls, onClick(close, el)}], onOpen(el, close), sticky})
  function sheet(o) {
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="hd"><h2>${esc(o.title || '')}</h2><button class="x" aria-label="close">${icon('x', 'sm')}</button></div>
      <div class="bd">${o.body || ''}</div>${o.actions && o.actions.length ? '<div class="ft"></div>' : ''}</div>`;
    document.body.appendChild(ov);
    const el = ov.querySelector('.sheet');
    let closed = false;
    const close = () => { if (closed) return; closed = true; stopCamera(); ov.classList.add('closing'); setTimeout(() => ov.remove(), 180); if (o.onClose) o.onClose(); };
    ov.querySelector('.x').onclick = close;
    ov.addEventListener('click', e => { if (e.target === ov && !o.sticky) close(); });
    (o.actions || []).forEach(a => {
      const b = document.createElement('button'); b.className = 'btn ' + (a.cls || ''); b.innerHTML = (a.icon ? icon(a.icon) : '') + esc(a.label);
      b.onclick = () => closed ? null : a.onClick ? withBusy(b, () => a.onClick(close, el)) : close();   // no second tap while the sheet closes
      ov.querySelector('.ft').appendChild(b);
    });
    if (o.onOpen) o.onOpen(el, close);
    const first = el.querySelector('input[autofocus]'); if (first) setTimeout(() => first.focus(), 120);
    return { el, close };
  }
  function confirmBox(msg, okLabel, cls) {
    return new Promise(res => {
      let done = false;
      sheet({ title: t('Please confirm'), body: `<p style="font-size:16px;margin:4px 2px">${esc(msg)}</p>`, onClose: () => { if (!done) res(false); },
        actions: [{ label: t('Cancel'), cls: 'ghost', onClick: c => { done = true; res(false); c(); } }, { label: okLabel || t('Yes'), cls: cls || 'primary', onClick: c => { done = true; res(true); c(); } }] });
    });
  }
  function alertBox(title, html) { return sheet({ title, body: html, actions: [{ label: t('OK'), cls: 'primary' }] }); }
  async function withBusy(btn, fn) {
    if (btn.disabled) return;
    const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${esc(t('Please wait…'))}`;
    try { await fn(); } catch (e) { if (e.kind !== 'stale') toast(e.message || String(e), 'err'); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
  }
  function formData(el) {
    const o = {};
    el.querySelectorAll('[name]').forEach(i => { if (i.type === 'checkbox') o[i.name] = i.checked; else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; } else o[i.name] = i.value.trim(); });
    return o;
  }
  // segmented buttons: <div class="seg" data-name="method"> ... bind with seg(el, onChange)
  function seg(box, onChange) {
    box.querySelectorAll('button').forEach(b => b.onclick = e => { e.preventDefault(); box.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); box.dataset.value = b.dataset.v; if (onChange) onChange(b.dataset.v); });
    const on = box.querySelector('.on'); if (on) box.dataset.value = on.dataset.v;
  }
  // Material ripple on anything tappable
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest('.btn, .li.tap, .chip, .tile, .seg button, .iconbtn, .pad button, #nav .ind, .fab, .dd, .ddlist button, .cartbar .sum, .bizswitch button, .qty button, .x');
    if (!el || el.disabled) return;
    const r = el.getBoundingClientRect(), d = Math.max(r.width, r.height);
    const sp = document.createElement('span'); sp.className = 'ripple';
    sp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(sp); setTimeout(() => sp.remove(), 600);
  }, { passive: true });
  window.addEventListener('scroll', () => { const t2 = document.getElementById('top'); if (t2) t2.classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });
  // "Install app": Android/desktop Chrome gives us a prompt; iPhone needs Share → Add to Home Screen.
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  window.addEventListener('appinstalled', () => { installEvt = null; toast(t('App installed'), 'ok'); });
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function installApp() {
    if (isStandalone()) return alertBox(t('Install the app'), `<p>${esc(t('The app is already installed on this phone. Open it from your home screen.'))}</p>`);
    if (installEvt) { installEvt.prompt(); const c = await installEvt.userChoice; if (c.outcome === 'accepted') installEvt = null; return; }
    const steps = isIOS()
      ? [t('Open this page in Safari.'), t('Tap the Share button (square with an arrow).'), t('Choose "Add to Home Screen", then tap "Add".')]
      : [t('Open this page in Chrome.'), t('Tap the menu ⋮ at the top right.'), t('Choose "Install app" or "Add to Home screen".')];
    alertBox(t('Install the app'), `<ol style="padding-left:20px;font-size:16px;line-height:1.7">${steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`);
  }

  const input = (name, label, val, attrs) => `<label class="f"><span>${esc(label)}</span><input class="in" name="${name}" value="${esc(val == null ? '' : val)}" ${attrs || ''}></label>`;
  const moneyInput = (name, label, val, attrs) => input(name, label, val, 'inputmode="numeric" pattern="[0-9]*" ' + (attrs || ''));
  function beep(ok) {
    try {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
      beep.ctx = beep.ctx || new A(); const c = beep.ctx, o = c.createOscillator(), g = c.createGain();
      o.frequency.value = ok === false ? 220 : 1200; o.connect(g); g.connect(c.destination); g.gain.value = .12;
      o.start(); o.stop(c.currentTime + (ok === false ? .25 : .08));
    } catch (e) {}
    if (navigator.vibrate) navigator.vibrate(ok === false ? 150 : 30);
  }

  /* ---------------- barcode scanner ---------------- */
  let cam = null;
  function stopCamera() {
    if (!cam) return;
    try { cam.stop(); } catch (e) {}
    cam = null;
  }
  function loadZXing() {
    if (window.ZXing) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
      s.onload = () => res(); s.onerror = () => rej(new Error(t('Could not load the scanner. Connect to the internet once, or type the barcode.')));
      document.head.appendChild(s);
    });
  }
  /** Opens a camera in `box`. Calls onCode(code) for each barcode found. continuous=true keeps scanning. */
  async function startCamera(box, onCode, continuous) {
    stopCamera();
    box.innerHTML = `<div class="camwrap"><video playsinline muted autoplay></video><div class="aim"></div><div class="last hidden"></div></div>`;
    const video = box.querySelector('video'), last = box.querySelector('.last');
    let lastCode = '', lastAt = 0, stopped = false;
    const hit = code => {
      const now = Date.now();
      if (code === lastCode && now - lastAt < 1600) return;
      lastCode = code; lastAt = now;
      const r = onCode(code);
      if (typeof r === 'string') { last.textContent = r; last.classList.remove('hidden'); }
      if (!continuous) stopCamera();
    };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(t('This browser cannot open the camera. Type the barcode instead.'));
    let native = false;
    if ('BarcodeDetector' in window) {
      try { const f = await BarcodeDetector.getSupportedFormats(); native = f.indexOf('ean_13') >= 0; } catch (e) {}
    }
    if (native) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      video.srcObject = stream; await video.play().catch(() => {});
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] });
      let timer = null;
      const loop = async () => {
        if (stopped) return;
        try { const r = await det.detect(video); if (r && r[0]) hit(r[0].rawValue); } catch (e) {}
        if (!stopped) timer = setTimeout(loop, 120);
      };
      loop();
      cam = { stop() { stopped = true; clearTimeout(timer); stream.getTracks().forEach(tr => tr.stop()); } };
    } else {
      await loadZXing();
      const hints = new Map(); hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      const reader = new ZXing.BrowserMultiFormatReader(hints, 150);
      cam = { stop() { stopped = true; try { reader.reset(); } catch (e) {} } };
      await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (res) => { if (res && !stopped) hit(res.getText()); });
    }
  }
  /** One-shot scan in a sheet; resolves with the code (or null). */
  function scanOnce(title) {
    return new Promise(res => {
      let done = false;
      sheet({ title: title || t('Scan barcode'), body: `<div id="camb"></div><p class="muted small">${esc(t('Point the camera at the barcode.'))}</p>`,
        onOpen: (el, close) => startCamera(el.querySelector('#camb'), code => { done = true; beep(); res(code); close(); }, false).catch(e => { toast(e.message, 'err'); close(); }),
        onClose: () => { if (!done) res(null); } });
    });
  }

  /* ---------------- files: CSV, XLSX, PDF, share ---------------- */
  function toCSV(headers, rows) {
    const q = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [headers].concat(rows).map(r => r.map(q).join(',')).join('\r\n');
  }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.split(';').length > first.split(',').length) ? ';' : (first.split('\t').length > first.split(',').length ? '\t' : ',');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }
  // Minimal .xlsx reader (first sheet) using the browser's built-in unzip.
  async function readXLSX(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error(t('This is not a valid Excel file.'));
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {};
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.slice(p + 46, p + 46 + nl));
      files[name] = { method, csize, off }; p += 46 + nl + el + cl;
    }
    const get = async name => {
      const f = files[name]; if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const data = u8.slice(start, start + f.csize);
      if (f.method === 0) return new TextDecoder().decode(data);
      if (typeof DecompressionStream === 'undefined') throw new Error(t('This phone cannot read Excel files. Save the file as CSV and import that.'));
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(ds).text();
    };
    const xml = s => new DOMParser().parseFromString(s, 'application/xml');
    const ssx = await get('xl/sharedStrings.xml');
    const shared = ssx ? Array.from(xml(ssx).getElementsByTagName('si')).map(si => Array.from(si.getElementsByTagName('t')).map(x => x.textContent).join('')) : [];
    const sheetName = Object.keys(files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort()[0];
    const doc = xml(await get(sheetName));
    const rows = [];
    Array.from(doc.getElementsByTagName('row')).forEach(r => {
      const arr = [];
      Array.from(r.getElementsByTagName('c')).forEach(c => {
        const ref = c.getAttribute('r') || ''; const col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const tp = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0];
        let val = tp === 's' ? shared[num(v && v.textContent)] : tp === 'inlineStr' ? Array.from(c.getElementsByTagName('t')).map(x => x.textContent).join('') : (v ? v.textContent : '');
        arr[col >= 0 ? col : arr.length] = val;
      });
      rows.push(Array.from(arr, x => x == null ? '' : x));
    });
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }
  // Tiny PDF maker: each canvas becomes one A4 page (as a JPEG image).
  function canvasesToPDF(canvases) {
    const enc = new TextEncoder(), parts = [], offsets = []; let len = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (id, body) => { offsets[id] = len; push(id + ' 0 obj\n'); body(); push('\nendobj\n'); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const W = 595, H = 842, n = canvases.length;
    const pageIds = canvases.map((_, i) => 3 + i * 3);
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] /Count ${n} >>`));
    canvases.forEach((cv, i) => {
      const pid = pageIds[i], cid = pid + 1, iid = pid + 2;
      const b64 = cv.toDataURL('image/jpeg', 0.85).split(',')[1], bin = atob(b64), img = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) img[k] = bin.charCodeAt(k);
      obj(pid, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${iid} 0 R >> >> /Contents ${cid} 0 R >>`));
      const content = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
      obj(cid, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
      obj(iid, () => { push(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`); push(img); push('\nendstream'); });
    });
    const total = 3 + n * 3, xref = len;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  async function loadImage(src) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
  /** Draws a simple document (title, lines, table) on A4 canvases. rows = [[col1, col2], ...] */
  async function makeDocPDF(o) {
    const W = 1240, H = 1754, M = 90, logo = await loadImage('icons/logo.png'), pages = [];
    let cv, g, y;
    const newPage = () => {
      cv = document.createElement('canvas'); cv.width = W; cv.height = H; g = cv.getContext('2d'); pages.push(cv);
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#003366'; g.fillRect(0, 0, W, 16); g.fillStyle = '#FFBF00'; g.fillRect(0, 16, W, 6);
      y = M;
      if (logo) { const lh = 170, lw = logo.width * lh / logo.height; g.drawImage(logo, M, y, lw, lh); }
      g.fillStyle = '#003366'; g.font = 'bold 46px sans-serif'; g.textAlign = 'right'; g.fillText(o.title, W - M, y + 60);
      g.font = '28px sans-serif'; g.fillStyle = '#333'; (o.lines || []).forEach((l, i) => g.fillText(l, W - M, y + 110 + i * 38));
      g.textAlign = 'left'; y += 230;
      g.fillStyle = '#003366'; g.fillRect(M, y, W - 2 * M, 54); g.fillStyle = '#fff'; g.font = 'bold 28px sans-serif';
      o.head.forEach((h, i) => { g.textAlign = i === 0 ? 'left' : 'right'; g.fillText(h, i === 0 ? M + 16 : o.colX[i], y + 37); });
      y += 54;
    };
    newPage();
    o.rows.forEach((r, ri) => {
      if (y > H - M - 60) newPage();
      if (ri % 2) { g.fillStyle = '#F5F5F5'; g.fillRect(M, y, W - 2 * M, 50); }
      g.fillStyle = '#14202e'; g.font = '28px sans-serif';
      r.forEach((c, i) => { g.textAlign = i === 0 ? 'left' : 'right'; let s = String(c); if (i === 0) while (g.measureText(s).width > (o.colX[1] || W) - M - 140 && s.length > 3) s = s.slice(0, -2); g.fillText(s, i === 0 ? M + 16 : o.colX[i], y + 35); });
      y += 50;
    });
    if (o.footer) { y += 30; if (y > H - M) newPage(); g.textAlign = 'left'; g.fillStyle = '#5d6b7a'; g.font = '26px sans-serif'; o.footer.forEach(l => { g.fillText(l, M, y); y += 36; }); }
    return canvasesToPDF(pages);
  }
  /** Share a file (PDF) to WhatsApp via the phone's share sheet; falls back to download + WhatsApp text. */
  async function shareFile(blob, filename, text, phone) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
    download(filename, blob);
    openWhatsApp(phone, text + '\n' + t('(PDF downloaded on this phone — attach it in WhatsApp)'));
    return true;
  }
  function openWhatsApp(phone, text) {
    const p = String(phone || '').replace(/[^\d]/g, '');
    window.open('https://wa.me/' + p + '?text=' + encodeURIComponent(text), '_blank');
  }

  /* ---------------- start ---------------- */
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => { setOnline(true); backgroundUpdate(); });
  window.addEventListener('offline', () => setOnline(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (S.token && navigator.onLine && Date.now() > S.expires) return sessionEnded(); backgroundUpdate(); } });
  setInterval(() => { if (S.queue.length) syncNow(); }, 20000);

  function start() {
    const sess = LS.get('session', null);
    if (sess && sess.token && (sess.expires > Date.now() || (!navigator.onLine && LS.get('data_' + sess.user.id, null)))) {
      S.token = sess.token; S.expires = sess.expires; S.user = sess.user;
      S.data = LS.get('data_' + S.user.id, null);
      const saved = LS.get('biz_' + S.user.id);
      S.biz = myBiz().indexOf(saved) >= 0 ? saved : myBiz()[0];
      S.lang = S.user.lang || S.lang;
      if (S.data) { boot(); refresh(true).then(ok => { if (ok === 'changed') { drawShell(); softRender(); } prefetch(); }); return; }
      refresh(true).then(ok => { if (ok) { boot(); prefetch(); } else showLogin(); });
      return;
    }
    showLogin();
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || S.cart.length) return; reloaded = true; location.reload(); });
  }

  window.App = {
    S, LS, CFG, APP_VERSION, t, esc, num, fmt, money, usd, rate, roundStep, uid, today, addDays, when, localParts, bizName, methodName,
    isLoose, looseTable, loosePrice, stockTxt, lowAt, isLow, piecesOf, lineTotal,
    icon, installApp, isStandalone, rememberPin, foodOn, cachedCall, cacheGet, cachePut, prefetch, softRender, isOwner, can, myBiz, setting, prods, findProd, myShift, api, enqueue, syncNow, refresh, upsert, saveData, logout, friendly,
    toast, sheet, confirmBox, alertBox, withBusy, formData, seg, input, moneyInput, beep, go, render, drawShell, updateTop,
    startCamera, stopCamera, scanOnce, toCSV, download, parseCSV, readXLSX, makeDocPDF, shareFile, openWhatsApp, start
  };
  document.addEventListener('DOMContentLoaded', () => window.Screens ? start() : setTimeout(start, 50));
})();
