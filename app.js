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
  const APP_VERSION = '1.0.0';
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
  const myBiz = () => !S.user ? [] : (isOwner() || S.user.business === 'both') ? ['shop', 'food'] : [S.user.business];
  const setting = k => S.data ? S.data.settings[k] : '';
  const prods = (b) => (S.data ? S.data.products : []).filter(p => p.business === (b || S.biz) && String(p.active) !== '0');
  const findProd = id => (S.data ? S.data.products : []).find(p => p.id === id);
  const myShift = (b) => (S.data ? S.data.shifts : []).find(s => s.status === 'open' && s.business === (b || S.biz) && s.userId === S.user.id);

  /* ---------------- server calls ---------------- */
  class AppError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }

  function friendly(raw) {
    const m = String(raw || '');
    if (/^AUTH/.test(m)) return t('Your session ended. Please log in again.');
    if (/^HOURS/.test(m)) return t('Outside working hours. Ask an owner for access.');
    if (/^SHIFT/.test(m)) return t('Start a shift before selling.');
    if (/^LOCKED/.test(m)) return t('Too many wrong PINs. Wait 5 minutes.');
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
    progress(1);
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, data: data || {}, token: S.token }), redirect: 'follow', signal: ctl ? ctl.signal : undefined });
    } catch (e) {
      const aborted = e && e.name === 'AbortError';
      setOnline(false);
      throw new AppError(!navigator.onLine ? t('No internet connection.') : aborted ? t('The script took too long to answer. Check the internet and try again.')
        : t('Cannot reach the script. Check the internet. If it keeps happening, the Apps Script deployment must have access "Anyone".'), 'network');
    } finally { clearTimeout(timer); progress(-1); }
    setOnline(true);
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch (e) {
      throw new AppError(/<html|<!DOCTYPE/i.test(text) ? t('The script answered with a Google page instead of data. The deployment access must be "Anyone" and the URL must end with /exec.')
        : t('The script sent an unexpected answer (HTTP {s}).', { s: res.status }), 'server');
    }
    if (!j.ok) {
      if (/^AUTH/.test(j.error || '')) { sessionEnded(); }
      throw new AppError(friendly(j.error), 'app');
    }
    return j;
  }
  let busyCount = 0;
  function progress(d) { busyCount = Math.max(0, busyCount + d); const b = document.getElementById('topprog'); if (b) b.style.opacity = busyCount ? 1 : 0; }

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
        const r = await api('sync', { ops: batch.map(o => ({ qid: o.qid, action: o.action, data: o.data })) }, { timeout: 60000 });
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
    S.lang = b.user.lang || S.lang; LS.set('lang', S.lang);
    LS.set('session', { token: S.token, expires: S.expires, user: S.user });
    saveData();
    const saved = LS.get('biz_' + S.user.id);
    S.biz = myBiz().indexOf(saved) >= 0 ? saved : myBiz()[0];
  }
  async function refresh(quiet) {
    try {
      const b = await api('boot', {});
      const tok = S.token, exp = S.expires;
      S.data = b; S.user = b.user; S.token = tok; S.expires = exp;
      LS.set('session', { token: S.token, expires: S.expires, user: S.user });
      // re-apply sales still waiting in the queue so local stock stays right
      S.queue.forEach(op => { if (op.action === 'shift.open' && !S.data.shifts.some(x => x.id === op.data.id)) S.data.shifts.push(Object.assign({ status: 'open', userId: op.userId, userName: op.userName, openTs: op.ts.slice(0, 19), rate: rate() }, op.data)); });
      S.queue.forEach(op => { if (op.action === 'sale.create' && op.data.business === 'shop') op.data.items.forEach(it => { const p = findProd(it.productId); if (p) p.stock = num(p.stock) - num(it.qty); }); });
      saveData(); updateTop();
      return true;
    } catch (e) { if (!quiet) toast(e.message, 'err'); return false; }
  }
  function sessionEnded() {
    S.token = null; LS.del('session');
    setTimeout(() => { if (!document.querySelector('.login')) { toast(t('Your session ended. Please log in again.'), 'warn', 5000); showLogin(); } }, 10);
  }
  async function logout() {
    const waiting = S.queue.filter(o => o.userId === S.user.id).length;
    if (waiting && !(await confirmBox(t('{n} items are not sent yet. They stay on this phone and will be sent when you log in again. Log out?', { n: waiting })))) return;
    try { if (S.online) await api('logout', {}); } catch (e) {}
    S.token = null; S.cart = []; LS.del('session');
    showLogin();
  }

  /* ---------------- login screen ---------------- */
  async function showLogin() {
    stopCamera();
    document.getElementById('top').classList.add('hidden');
    document.getElementById('nav').classList.add('hidden');
    const main = document.getElementById('main');
    let names = LS.get('names', []), sel = LS.get('lastUser', null), pin = '';
    main.innerHTML = `<div class="login">
      <img class="logo" src="icons/logo.png" alt="Saado">
      <div class="row" style="margin-bottom:10px"><div class="seg" style="min-width:220px">
        <button data-l="so" class="${S.lang === 'so' ? 'on' : ''}">Soomaali</button><button data-l="en" class="${S.lang === 'en' ? 'on' : ''}">English</button></div></div>
      <div class="muted" id="lgmsg" style="margin-bottom:8px">${esc(t('Choose your name'))}</div>
      <div class="names" id="names"></div>
      <div id="pinarea" class="col hidden" style="align-items:center;width:100%">
        <div class="pinshow" id="pinshow"></div>
        <div class="pad" id="pad"></div>
        <div id="lgerr" class="red bold" style="margin-top:10px;text-align:center;min-height:22px"></div>
      </div>
      <div class="small muted" style="margin-top:auto;padding-top:20px">Saado POS v${APP_VERSION}</div></div>`;
    main.style.paddingBottom = '0';
    main.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { S.lang = b.dataset.l; LS.set('lang', S.lang); showLogin(); });
    const drawNames = () => {
      const box = document.getElementById('names'); if (!box) return;
      box.innerHTML = names.length ? names.map(u => `<button data-id="${esc(u.id)}" class="${sel === u.id ? 'on' : ''}">${esc(u.name)}</button>`).join('')
        : `<div class="muted" style="grid-column:1/-1;text-align:center">${esc(t('Loading names…'))}</div>`;
      box.querySelectorAll('button').forEach(b => b.onclick = () => { sel = b.dataset.id; pin = ''; drawNames(); drawPin(); document.getElementById('pinarea').classList.remove('hidden'); document.getElementById('lgerr').textContent = ''; });
      if (sel && names.find(u => u.id === sel)) document.getElementById('pinarea').classList.remove('hidden');
    };
    const drawPin = () => { const s = document.getElementById('pinshow'); if (s) s.innerHTML = [0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map(i => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join(''); };
    const pad = document.getElementById('pad');
    pad.innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map(k => `<button data-k="${k}" class="${k === 'OK' ? 'go' : ''}">${k === 'OK' ? esc(t('Enter')) : k}</button>`).join('');
    const submit = async () => {
      if (!sel || pin.length < 4) return;
      const err = document.getElementById('lgerr');
      err.innerHTML = `<span class="muted">${esc(t('Checking…'))}</span>`;
      try {
        const b = await api('login', { userId: sel, pin });
        LS.set('lastUser', sel); startSession(b); boot();
      } catch (e) { pin = ''; drawPin(); err.textContent = e.message; if (navigator.vibrate) navigator.vibrate(200); }
    };
    pad.querySelectorAll('button').forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      if (k === '⌫') pin = pin.slice(0, -1); else if (k === 'OK') return submit(); else if (pin.length < 6) pin += k;
      drawPin(); if (navigator.vibrate) navigator.vibrate(10);
    });
    document.onkeydown = e => { if (!document.getElementById('pad')) { document.onkeydown = null; return; } if (/^\d$/.test(e.key) && pin.length < 6) { pin += e.key; drawPin(); } else if (e.key === 'Backspace') { pin = pin.slice(0, -1); drawPin(); } else if (e.key === 'Enter') submit(); };
    drawNames(); drawPin();
    try {
      const r = await api('names', {});
      names = r.users; LS.set('names', names); drawNames();
    } catch (e) { const m = document.getElementById('lgmsg'); if (m) { m.className = 'red bold'; m.textContent = e.message; } if (names.length) drawNames(); }
  }

  /* ---------------- shell ---------------- */
  function navItems() {
    const n = [];
    if (can('viewReports')) n.push(['home', '🏠', t('Home')]);
    n.push(['sell', '🛒', t('Sell')]);
    n.push(['shift', '⏱️', t('Shift')]);
    if (can('customers') && (setting(S.biz + '_credit') === '1' || isOwner())) n.push(['customers', '👥', t('Customers')]);
    else if (can('expenses')) n.push(['expenses', '💸', t('Expenses')]);
    n.push(['more', '☰', t('More')]);
    return n;
  }
  function updateTop() {
    const top = document.getElementById('top'); if (!top || !S.user) return;
    const pending = S.queue.length, mine = S.queue.filter(o => o.userId === S.user.id).length;
    const sd = document.getElementById('syncdot');
    if (sd) {
      sd.className = 'syncdot' + (!S.online ? ' off' : pending ? ' wait' : '');
      sd.textContent = !S.online ? '⚠ ' + t('Offline') + (pending ? ' · ' + pending : '') : S.syncing ? '↻ ' + mine : pending ? '⏳ ' + pending : '✓';
    }
    const ob = document.getElementById('offbar');
    if (ob) ob.classList.toggle('hidden', S.online);
    const nb = document.querySelector('#nav [data-r="more"] .badge');
    const alerts = (S.data && S.data.pendingRefunds && can('approveRefunds') ? S.data.pendingRefunds : 0) + S.failed.length;
    if (nb) { nb.textContent = alerts; nb.classList.toggle('hidden', !alerts); }
  }
  function drawShell() {
    const top = document.getElementById('top'), nav = document.getElementById('nav');
    top.classList.remove('hidden'); nav.classList.remove('hidden');
    const bizs = myBiz();
    top.innerHTML = `<img src="icons/icon-192.png" alt=""><div class="title">Saado<small>${esc(S.user.name)} · ${esc(bizName(S.biz))}</small></div>
      ${bizs.length > 1 ? `<div class="bizswitch">${bizs.map(b => `<button data-b="${b}" class="${S.biz === b ? 'on' : ''}">${esc(b === 'shop' ? t('Shop') : t('Food'))}</button>`).join('')}</div>` : '<div style="margin-left:auto"></div>'}
      <button class="syncdot" id="syncdot"></button>
      <div id="topprog" style="position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--gold);opacity:0;transition:opacity .2s"></div>`;
    top.querySelectorAll('[data-b]').forEach(b => b.onclick = () => {
      if (S.cart.length && b.dataset.b !== S.biz) { toast(t('Finish or park the current sale first'), 'warn'); return; }
      S.biz = b.dataset.b; LS.set('biz_' + S.user.id, S.biz); drawShell(); render();
    });
    document.getElementById('syncdot').onclick = () => go('sync');
    nav.innerHTML = navItems().map(([r, ic, l]) => `<button data-r="${r}" class="${S.route === r ? 'on' : ''}"><span class="ic">${ic}</span>${esc(l)}${r === 'more' ? '<span class="badge hidden"></span>' : ''}</button>`).join('');
    nav.querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.r));
    let ob = document.getElementById('offbar');
    if (!ob) { ob = document.createElement('div'); ob.id = 'offbar'; ob.className = 'offline-bar hidden'; top.after(ob); }
    ob.textContent = t('Offline: sales are saved on this phone and sent later.');
    updateTop();
  }
  function go(r) { if (location.hash !== '#' + r) location.hash = r; else render(); }
  function render() {
    if (!S.user || !S.token) return;
    stopCamera();
    let r = (location.hash || '').slice(1) || (can('viewReports') ? 'home' : 'sell');
    const scr = window.Screens && Screens[r.split('/')[0]];
    if (!scr) r = 'sell';
    S.route = r.split('/')[0];
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.r === S.route || (S.route !== 'sell' && S.route !== 'home' && S.route !== 'shift' && S.route !== 'customers' && b.dataset.r === 'more' && !navItems().some(n => n[0] === S.route))));
    const main = document.getElementById('main');
    main.style.paddingBottom = '';
    main.innerHTML = '';
    document.querySelectorAll('.cartbar').forEach(x => x.remove());
    window.scrollTo(0, 0);
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

  /* ---------------- UI helpers ---------------- */
  function toast(msg, type, ms) {
    const box = document.getElementById('toasts');
    while (box.children.length >= 1) box.firstChild.remove();   // one message at a time: easier to read when busy
    const el = document.createElement('div'); el.className = 'toast ' + (type || ''); el.textContent = msg;
    box.appendChild(el);
    el.onclick = () => el.remove();
    setTimeout(() => el.remove(), ms || (type === 'err' ? 5000 : 2200));
    if (type === 'err' && navigator.vibrate) navigator.vibrate([60, 40, 60]);
  }
  // sheet({title, body, actions:[{label, cls, onClick(close, el)}], onOpen(el, close), wide})
  function sheet(o) {
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<div class="sheet"><div class="hd"><h2>${esc(o.title || '')}</h2><button class="x" aria-label="close">✕</button></div>
      <div class="bd">${o.body || ''}</div>${o.actions && o.actions.length ? '<div class="ft"></div>' : ''}</div>`;
    document.body.appendChild(ov);
    const el = ov.querySelector('.sheet');
    const close = () => { stopCamera(); ov.remove(); if (o.onClose) o.onClose(); };
    ov.querySelector('.x').onclick = close;
    ov.addEventListener('click', e => { if (e.target === ov && !o.sticky) close(); });
    (o.actions || []).forEach(a => {
      const b = document.createElement('button'); b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
      b.onclick = () => a.onClick ? withBusy(b, () => a.onClick(close, el)) : close();
      ov.querySelector('.ft').appendChild(b);
    });
    if (o.onOpen) o.onOpen(el, close);
    const first = el.querySelector('input[autofocus]'); if (first) setTimeout(() => first.focus(), 60);
    return { el, close };
  }
  function confirmBox(msg, okLabel, cls) {
    return new Promise(res => {
      let done = false;
      sheet({ title: t('Please confirm'), body: `<p style="font-size:17px">${esc(msg)}</p>`, onClose: () => { if (!done) res(false); },
        actions: [{ label: t('Cancel'), onClick: c => { done = true; res(false); c(); } }, { label: okLabel || t('Yes'), cls: cls || 'primary', onClick: c => { done = true; res(true); c(); } }] });
    });
  }
  function alertBox(title, html) { return sheet({ title, body: html, actions: [{ label: t('OK'), cls: 'primary' }] }); }
  async function withBusy(btn, fn) {
    if (btn.disabled) return;
    const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${esc(t('Please wait…'))}`;
    try { await fn(); } catch (e) { toast(e.message || String(e), 'err'); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
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
  window.addEventListener('online', () => { setOnline(true); syncNow(); });
  window.addEventListener('offline', () => setOnline(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncNow(); if (S.token && Date.now() > S.expires) sessionEnded(); } });
  setInterval(() => { if (S.queue.length) syncNow(); }, 20000);

  function start() {
    const sess = LS.get('session', null);
    if (sess && sess.token && sess.expires > Date.now()) {
      S.token = sess.token; S.expires = sess.expires; S.user = sess.user;
      S.data = LS.get('data_' + S.user.id, null);
      const saved = LS.get('biz_' + S.user.id);
      S.biz = myBiz().indexOf(saved) >= 0 ? saved : myBiz()[0];
      S.lang = S.user.lang || S.lang;
      if (S.data) { boot(); refresh(true).then(ok => { if (ok) { drawShell(); if (!document.querySelector('.ov')) render(); } }); return; }
      refresh(true).then(ok => ok ? boot() : showLogin());
      return;
    }
    showLogin();
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || S.cart.length) return; reloaded = true; location.reload(); });
  }

  window.App = {
    S, LS, CFG, APP_VERSION, t, esc, num, fmt, money, usd, rate, roundStep, uid, today, addDays, when, localParts, bizName, methodName,
    isOwner, can, myBiz, setting, prods, findProd, myShift, api, enqueue, syncNow, refresh, upsert, saveData, logout, friendly,
    toast, sheet, confirmBox, alertBox, withBusy, formData, seg, input, moneyInput, beep, go, render, drawShell, updateTop,
    startCamera, stopCamera, scanOnce, toCSV, download, parseCSV, readXLSX, makeDocPDF, shareFile, openWhatsApp, start
  };
  document.addEventListener('DOMContentLoaded', () => window.Screens ? start() : setTimeout(start, 50));
})();
