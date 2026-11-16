/**
 * Saado POS — all screens (each is a function that draws into #main).
 * Sell, Shift, Customers, Expenses, Home (owner dashboard), Reports, Products (+ import/export), Stock count,
 * Purchasing (purchase orders + suppliers, WhatsApp PDF), Ingredients, Refunds, Users, Settings, Audit, Sync, PIN, Guide.
 * Uses helpers from app.js (window.App).
 */
(function () {
  'use strict';
  const A = window.App;
  const { S, t, esc, num, fmt, money, usd, can, isOwner, setting, prods, findProd, myShift, api, enqueue, toast, sheet, confirmBox, withBusy, formData, seg, input, moneyInput, go } = A;
  const Screens = window.Screens = {};
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const methodSeg = (name, list, on) => `<div class="seg" data-name="${name}">${list.map(m => `<button data-v="${m}" class="${m === on ? 'on' : ''}">${esc(A.methodName(m))}</button>`).join('')}</div>`;
  const bizLabel = () => S.biz === 'food' ? t('Fast Food') : t('Shop');
  const I = A.icon;
  // The top app bar already shows the screen title; head() only shows extra info/actions for the page.
  const head = (title, right) => right ? `<div class="phead"><div class="grow small muted">${esc(title)}</div>${right}</div>` : '';
  // Extended floating action button (bottom-right), removed automatically when the screen changes.
  function fab(label, ic, onClick) { document.querySelectorAll('.fab').forEach(x => x.remove()); const b = document.createElement('button'); b.className = 'fab'; b.innerHTML = I(ic) + '<span>' + esc(label) + '</span>'; b.onclick = onClick; document.body.appendChild(b); return b; }
  const needOnline = () => { if (!S.online) throw new Error(t('This needs internet. Try again when online.')); };
  const skel = n => Array.from({ length: n || 3 }, () => '<div class="skel"></div>').join('');
  // Shown only if a page has never been opened with internet on this phone.
  const notYet = e => `<div class="card empty">${I(e && e.kind === 'network' ? 'wifioff' : 'alert')}${esc(e && e.kind === 'network' ? t('This page will be ready after it opens once with internet.') : (e ? e.message : ''))}</div>`;
  const neg = v => num(v) ? '−' + fmt(v) : '0';
  const offlineNote = () => S.online ? '' : `<div class="card alert amber small">${esc(t('You are offline. This list may be old.'))}</div>`;

  /* ======================= SELL ======================= */
  Screens.sell = function (main) {
    const shift = myShift();
    const needShift = setting('requireShift') === '1' && !shift;
    main.innerHTML = `
      ${needShift ? `<div class="card alert amber row"><div class="grow"><b>${esc(t('No open shift'))}</b><div class="small muted">${esc(t('Start a shift before selling.'))}</div></div><button class="btn gold" id="goShift">${esc(t('Start shift'))}</button></div>` : ''}
      <div class="searchbar"><label class="search">${I('search')}<input id="q" type="search" placeholder="${esc(t('Search or scan barcode'))}" autocomplete="off" enterkeyhint="search"></label>
        <button class="iconbtn gold" id="scanBtn" aria-label="scan">${I('scan')}</button></div>
      <div id="parked" class="chips" style="margin-bottom:8px"></div>
      <div id="results"></div>`;
    if (needShift) $('#goShift').onclick = () => go('shift');
    const q = $('#q');
    q.oninput = () => drawResults();
    q.onkeydown = e => {
      if (e.key !== 'Enter') return;
      const v = q.value.trim(); if (!v) return;
      const byCode = prods().find(p => p.barcode && p.barcode === v);
      const list = matches(v);
      if (byCode) addToCart(byCode); else if (list.length === 1) addToCart(list[0]); else if (/^\d{6,}$/.test(v)) unknownCode(v); else return;
      q.value = ''; drawResults();
    };
    $('#scanBtn').onclick = scanMany;
    drawParked(); drawResults(); drawCartBar();
    if (window.matchMedia('(min-width: 700px)').matches) q.focus();
  };
  function matches(v) {
    v = v.toLowerCase();
    return prods().filter(p => String(p.name).toLowerCase().includes(v) || (p.barcode && String(p.barcode).startsWith(v)) || String(p.category || '').toLowerCase().includes(v));
  }
  function inCart(id) { const l = S.cart.find(x => x.productId === id); return l ? l.qty : 0; }
  function stockTxt(p) { return S.biz === 'shop' && can('viewStock') ? ` · ${t('Stock')}: ${fmt(p.stock)}` : ''; }
  function drawResults() {
    const box = $('#results'); if (!box) return;
    const v = ($('#q') || {}).value ? $('#q').value.trim() : '';
    if (!prods().length) {
      box.innerHTML = `<div class="card empty">${esc(t('No products yet.'))}${can('manageProducts') ? `<div class="spacer"></div><button class="btn gold" id="addP">${esc(t('Add products'))}</button>` : ''}</div>`;
      const b = $('#addP'); if (b) b.onclick = () => go('products');
      return;
    }
    if (!v) {
      const list = prods().slice().sort((a, b) => (num(b.fav) - num(a.fav)) || (num(b.sold) - num(a.sold)) || String(a.name).localeCompare(b.name)).slice(0, S.biz === 'food' ? 60 : 24);
      box.innerHTML = `<div class="small muted" style="margin:2px 0 6px">${esc(S.biz === 'food' ? t('Menu') : t('Most sold'))}</div>
        <div class="tiles">${list.map(p => `<button class="tile ${S.biz === 'shop' && num(p.stock) <= num(p.lowStock) ? 'low' : ''}" data-id="${esc(p.id)}">
          <span class="n">${esc(p.name)}</span><span class="p">${fmt(p.price)}</span>${inCart(p.id) ? `<span class="q">${inCart(p.id)}</span>` : ''}</button>`).join('')}</div>`;
      $$('.tile', box).forEach(b => b.onclick = () => { addToCart(findProd(b.dataset.id)); });
      return;
    }
    const list = matches(v).slice(0, 50);
    box.innerHTML = list.length ? `<div class="list">${list.map(p => `<div class="li tap" data-id="${esc(p.id)}"><div class="main"><div class="name">${esc(p.name)}</div>
        <div class="sub">${esc(p.barcode || '')}${esc(stockTxt(p))}</div></div><b>${fmt(p.price)}</b>${inCart(p.id) ? `<span class="pill gold">×${inCart(p.id)}</span>` : ''}</div>`).join('')}</div>`
      : `<div class="card empty">${esc(t('Nothing found'))}</div>`;
    $$('.li', box).forEach(r => r.onclick = () => { addToCart(findProd(r.dataset.id)); $('#q').value = ''; drawResults(); });
  }
  function addToCart(p, qty) {
    if (!p) return;
    const l = S.cart.find(x => x.productId === p.id);
    if (l) l.qty += qty || 1; else S.cart.push({ productId: p.id, name: p.name, price: num(p.price), qty: qty || 1 });
    A.beep();
    if (S.biz === 'shop' && num(p.stock) - inCart(p.id) < 0) toast(t('Warning: {x} shows no stock left', { x: p.name }), 'warn');
    drawCartBar(); if (S.route === 'sell') drawResults();
    return inCart(p.id);
  }
  function cartTotals(discount) {
    const sub = S.cart.reduce((a, l) => a + l.price * l.qty, 0);
    const d = Math.min(num(discount), sub);
    return { sub, discount: d, total: A.roundStep(sub - d), count: S.cart.reduce((a, l) => a + l.qty, 0) };
  }
  function drawCartBar() {
    document.querySelectorAll('.cartbar').forEach(x => x.remove());
    if (S.route !== 'sell' || !S.cart.length) return;
    const tt = cartTotals(0);
    const bar = document.createElement('div'); bar.className = 'cartbar';
    bar.innerHTML = `<div class="inner"><button class="sum" id="openCart"><span class="cnt">${tt.count}</span><span class="grow"><b>${money(tt.total)}</b><span>${usd(tt.total)}</span></span></button>
      <button class="btn gold lg pay" id="payBtn">${esc(t('Pay'))}</button></div>`;
    document.body.appendChild(bar);
    $('#openCart').onclick = openCart; $('#payBtn').onclick = openPay;
  }
  function openCart() {
    const sh = sheet({ title: t('Cart'), body: '<div id="cl"></div>', actions: [
      { label: t('Park'), onClick: c => { park(); c(); } },
      { label: t('Clear'), cls: 'ghost', onClick: async c => { if (await confirmBox(t('Remove all items from the cart?'))) { S.cart = []; c(); drawCartBar(); drawResults(); } } },
      { label: t('Pay'), cls: 'gold', onClick: c => { c(); openPay(); } }] });
    const draw = () => {
      const box = $('#cl', sh.el); const tt = cartTotals(0);
      if (!S.cart.length) { sh.close(); drawCartBar(); drawResults(); return; }
      box.innerHTML = `<div class="list">${S.cart.map((l, i) => `<div class="li"><div class="main"><div class="name">${esc(l.name)}</div><div class="sub">${fmt(l.price)} × ${l.qty} = <b>${fmt(l.price * l.qty)}</b></div></div>
        <div class="qty"><button data-i="${i}" data-d="-1">−</button><b>${l.qty}</b><button data-i="${i}" data-d="1">+</button></div></div>`).join('')}</div>
        <div class="row"><span class="grow muted">${esc(t('Subtotal'))}</span><b>${money(tt.sub)}</b></div><div class="row"><span class="grow muted">${esc(t('To pay (rounded)'))}</span><b class="big">${money(tt.total)}</b></div>`;
      $$('.qty button', box).forEach(b => b.onclick = () => { const l = S.cart[b.dataset.i]; l.qty += num(b.dataset.d); if (l.qty <= 0) S.cart.splice(b.dataset.i, 1); draw(); drawCartBar(); drawResults(); });
    };
    draw();
  }
  function park() {
    if (!S.cart.length) return;
    S.parked.push({ id: A.uid('PK'), biz: S.biz, cart: S.cart, time: A.localParts().time, total: cartTotals(0).total });
    A.LS.set('parked', S.parked); S.cart = []; drawCartBar(); drawParked(); drawResults();
    toast(t('Sale parked'), 'ok');
  }
  function drawParked() {
    const box = $('#parked'); if (!box) return;
    const mine = S.parked.filter(p => p.biz === S.biz);
    box.innerHTML = mine.map(p => `<button class="chip" data-id="${p.id}">${I('pause')}${esc(p.time)} · ${fmt(p.total)}</button>`).join('');
    $$('button', box).forEach(b => b.onclick = async () => {
      const p = S.parked.find(x => x.id === b.dataset.id);
      if (S.cart.length) park();
      S.parked = S.parked.filter(x => x !== p); A.LS.set('parked', S.parked);
      S.cart = p.cart; drawParked(); drawCartBar(); drawResults();
    });
  }
  function unknownCode(code) {
    A.beep(false);
    if (can('manageProducts')) {
      sheet({ title: t('Barcode not found'), body: `<p>${esc(t('No product has barcode {c}.', { c: code }))}</p>`,
        actions: [{ label: t('Cancel') }, { label: t('Add product'), cls: 'gold', onClick: c => { c(); productForm({ barcode: code, business: S.biz }); } }] });
    } else toast(t('Barcode not found: {c}', { c: code }), 'err');
  }
  function scanMany() {
    const sh = sheet({ title: t('Scan items'), body: `<div id="camb"></div><div class="spacer"></div><div id="scansum" class="totalbox"></div>
      <p class="muted small">${esc(t('Keep scanning. Each beep adds one item.'))}</p>`,
      actions: [{ label: t('Done'), cls: 'primary' }, { label: t('Pay'), cls: 'gold', onClick: c => { c(); if (S.cart.length) openPay(); } }],
      onOpen: (el, close) => {
        const sum = () => { const tt = cartTotals(0); $('#scansum', el).innerHTML = `<div class="t">${money(tt.total)}</div><div class="u">${tt.count} ${esc(t('items'))}</div>`; };
        sum();
        A.startCamera($('#camb', el), code => {
          const p = prods().find(x => x.barcode && String(x.barcode) === String(code));
          if (!p) { A.beep(false); return '✗ ' + t('Not found') + ': ' + code; }
          const n = addToCart(p); sum(); return '✓ ' + p.name + ' ×' + n;
        }, true).catch(e => { toast(e.message, 'err'); close(); });
      } });
    return sh;
  }
  function openPay() {
    if (!S.cart.length) return;
    if (setting('requireShift') === '1' && !myShift()) { toast(t('Start a shift before selling.'), 'err'); go('shift'); return; }
    const biz = S.biz;
    const credit = setting(biz + '_credit') === '1';
    const methods = ['cash', 'zaad', 'edahab'].concat(credit ? ['credit'] : []);
    const types = String(setting('food_orderTypes') || 'Take away').split(',').map(x => x.trim()).filter(Boolean);
    let st = { method: 'cash', discount: 0, tendered: '', cur: 'SH', customerId: '', orderType: types[0] || '' };
    const sh = sheet({ title: t('Payment') + ' · ' + bizLabel(), sticky: true, body: `
      <div class="totalbox"><div class="t" id="pt"></div><div class="u" id="pu"></div></div>
      ${biz === 'food' && types.length ? `<label class="f"><span>${esc(t('Order type'))}</span><div class="seg gold" id="otype">${types.map((x, i) => `<button data-v="${esc(x)}" class="${i === 0 ? 'on' : ''}">${esc(t(x))}</button>`).join('')}</div></label>` : ''}
      <label class="f"><span>${esc(t('Payment method'))}</span>${methodSeg('method', methods, 'cash')}</label>
      <div id="mbox"></div>
      ${can('discount') ? `<details style="margin-top:8px"><summary class="bold" style="padding:8px 0">${esc(t('Discount'))}</summary>${moneyInput('discount', t('Discount (SH)'), '')}</details>` : ''}`,
      actions: [{ label: t('Back') }, { label: t('Complete sale'), cls: 'gold lg', onClick: c => complete(c) }] });
    const el = sh.el;
    const totals = () => cartTotals(st.discount);
    const drawTotal = () => { const tt = totals(); $('#pt', el).textContent = money(tt.total); $('#pu', el).textContent = usd(tt.total) + (tt.sub !== tt.total ? ' · ' + t('before rounding') + ' ' + fmt(tt.sub - tt.discount) : ''); drawChange(); };
    const drawChange = () => {
      const cb = $('#chg', el); if (!cb) return;
      const tt = totals(); const given = num(st.tendered) * (st.cur === 'USD' ? A.rate() : 1);
      if (!st.tendered) { cb.className = 'changebox'; cb.textContent = t('Exact amount'); return; }
      const ch = given - tt.total;
      cb.className = 'changebox' + (ch < 0 ? ' neg' : '');
      cb.textContent = ch < 0 ? t('Missing {x}', { x: money(-ch) }) : t('Change: {x}', { x: money(ch) });
    };
    const drawMethod = () => {
      const box = $('#mbox', el), tt = totals();
      if (st.method === 'cash') {
        const shQuick = [tt.total, Math.ceil(tt.total / 5000) * 5000, Math.ceil(tt.total / 10000) * 10000, Math.ceil(tt.total / 50000) * 50000].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
        const usdQuick = [1, 2, 5, 10, 20, 50, 100].filter(v => v * A.rate() >= tt.total).slice(0, 4);
        box.innerHTML = `<label class="f"><span>${esc(t('Cash given (optional)'))}</span><div class="row"><input class="in big grow" id="tend" inputmode="decimal" value="${esc(st.tendered)}" placeholder="0">
          <div class="seg" id="cur" style="flex:0 0 150px;flex-wrap:nowrap"><button data-v="SH" class="${st.cur === 'SH' ? 'on' : ''}">SH</button><button data-v="USD" class="${st.cur === 'USD' ? 'on' : ''}">USD</button></div></div></label>
          <div class="chips" id="quick">${(st.cur === 'USD' ? usdQuick.map(v => `<button class="chip" data-v="${v}">$${v}</button>`) : shQuick.map(v => `<button class="chip" data-v="${v}">${fmt(v)}</button>`)).join('')}</div>
          <div class="spacer"></div><div class="changebox" id="chg"></div>`;
        $('#tend', el).oninput = e => { st.tendered = e.target.value; drawChange(); };
        seg($('#cur', el), v => { st.cur = v; st.tendered = ''; drawMethod(); });
        $$('#quick .chip', el).forEach(b => b.onclick = () => { st.tendered = b.dataset.v; $('#tend', el).value = st.tendered; drawChange(); });
        drawChange();
      } else if (st.method === 'zaad' || st.method === 'edahab') {
        const acct = setting(biz + '_' + st.method);
        box.innerHTML = `<div class="acct"><div class="muted">${esc(t('Customer sends to {m} account', { m: A.methodName(st.method) }))}</div><b>${esc(acct || '—')}</b>
          <div class="bold">${money(tt.total)} · ${usd(tt.total)}</div></div><p class="small muted">${esc(t('Check the money arrived before completing.'))}</p>`;
      } else {
        const list = (S.data.customers || []).filter(c => c.business === biz);
        box.innerHTML = `<label class="f"><span>${esc(t('Credit customer'))}</span><div class="row"><input class="in grow" id="cq" placeholder="${esc(t('Search customer'))}">
          ${can('customers') ? `<button class="iconbtn gold" id="newc">${I('plus')}</button>` : ''}</div></label><div class="list" id="clist" style="max-height:240px;overflow:auto"></div>`;
        const draw = () => {
          const v = $('#cq', el).value.toLowerCase();
          const l = list.filter(c => !v || String(c.name).toLowerCase().includes(v) || String(c.phone).includes(v)).slice(0, 40);
          $('#clist', el).innerHTML = l.map(c => `<div class="li tap" data-id="${esc(c.id)}" style="${st.customerId === c.id ? 'background:var(--gold-c)' : ''}"><div class="main"><div class="name">${st.customerId === c.id ? I('check', 'sm') + ' ' : ''}${esc(c.name)}</div><div class="sub">${esc(c.phone || '')}</div></div><span class="${num(c.balance) > 0 ? 'red' : ''}">${fmt(c.balance)}</span></div>`).join('') || `<div class="empty">${esc(t('No customers yet'))}</div>`;
          $$('#clist .li', el).forEach(r => r.onclick = () => { st.customerId = r.dataset.id; draw(); });
        };
        $('#cq', el).oninput = draw; draw();
        const nb = $('#newc', el); if (nb) nb.onclick = () => customerForm(null, c => { list.push(c); st.customerId = c.id; draw(); });
      }
    };
    seg($('[data-name=method]', el), v => { st.method = v; drawMethod(); });
    if ($('#otype', el)) seg($('#otype', el), v => { st.orderType = v; });
    const di = $('[name=discount]', el); if (di) di.oninput = () => { st.discount = num(di.value); drawTotal(); drawMethod(); };
    drawTotal(); drawMethod();

    async function complete(close) {
      const tt = totals();
      if (st.method === 'credit' && !st.customerId) throw new Error(t('Choose a credit customer'));
      let change = 0;
      if (st.method === 'cash' && st.tendered) {
        change = num(st.tendered) * (st.cur === 'USD' ? A.rate() : 1) - tt.total;
        if (change < 0) throw new Error(t('Cash given is less than the total'));
      }
      const data = { id: A.uid('S'), business: biz, method: st.method, discount: tt.discount, tendered: st.method === 'cash' ? num(st.tendered) : 0, tenderCur: st.cur,
        customerId: st.method === 'credit' ? st.customerId : '', orderType: biz === 'food' ? st.orderType : '', ts: new Date().toISOString(),
        items: S.cart.map(l => ({ productId: l.productId, qty: l.qty, name: l.name })) };
      enqueue('sale.create', data);
      // update this phone right away (the server checks again)
      S.cart.forEach(l => { const p = findProd(l.productId); if (p) { if (biz === 'shop') p.stock = num(p.stock) - l.qty; p.sold = num(p.sold) + l.qty; } });
      if (st.method === 'credit') { const c = S.data.customers.find(x => x.id === st.customerId); if (c) c.balance = num(c.balance) + tt.total; }
      A.saveData();
      S.cart = []; close(); drawCartBar(); drawResults();
      S.lastSale = data;
      toast(st.method === 'cash' && change > 0 ? t('Sale saved · Change {x}', { x: money(change) }) : t('Sale saved · {x}', { x: money(tt.total) }), 'ok', 3500);
      const qi = $('#q'); if (qi && window.matchMedia('(min-width: 700px)').matches) qi.focus();
    }
  }

  /* ======================= SHIFT ======================= */
  Screens.shift = function (main) {
    const sh = myShift();
    const others = (S.data.shifts || []).filter(s => s.status === 'open' && s.business === S.biz && s.userId !== S.user.id);
    const amountFields = (pre) => `<div class="grid2">${moneyInput(pre + 'Cash', t('Cash in drawer (SH)'), '', 'autofocus')}<div></div>
      ${moneyInput(pre + 'ZaadSH', t('Zaad balance SH'), '')}${moneyInput(pre + 'ZaadUSD', t('Zaad balance USD'), '', 'inputmode="decimal"')}
      ${moneyInput(pre + 'EdSH', t('Edahab balance SH'), '')}${moneyInput(pre + 'EdUSD', t('Edahab balance USD'), '', 'inputmode="decimal"')}</div>`;
    if (!sh) {
      main.innerHTML = `<div class="card"><h3>${esc(t('Start shift'))}</h3><p class="small muted">${esc(t('Count the money before you start.'))}</p>
        <form id="of">${amountFields('open')}<button class="btn gold block lg">${esc(t('Start shift'))}</button></form></div>
        ${others.length ? `<div class="card"><h3>${esc(t('Other open shifts'))}</h3>${others.map(s => `<div class="row"><span class="grow">${esc(s.userName)}</span><span class="muted">${esc(t('since'))} ${A.when(s.openTs)}</span></div>`).join('')}</div>` : ''}
        <div id="hist"></div>`;
      $('#of').onsubmit = e => {
        e.preventDefault();
        const f = formData(e.target);
        const data = { id: A.uid('SH'), business: S.biz, openCash: num(f.openCash), openZaadSH: num(f.openZaadSH), openZaadUSD: num(f.openZaadUSD), openEdSH: num(f.openEdSH), openEdUSD: num(f.openEdUSD) };
        enqueue('shift.open', data);
        const lp = A.localParts(); S.data.shifts.push(Object.assign({ status: 'open', userId: S.user.id, userName: S.user.name, openTs: lp.date + 'T' + lp.time + ':00', rate: A.rate() }, data));
        A.saveData(); toast(t('Shift started'), 'ok'); go('sell');
      };
    } else {
      main.innerHTML = `
        <div class="card navy"><h3>${esc(t('Started'))} ${A.when(sh.openTs)}</h3><div class="grid2 small">
          <div>${esc(t('Opening cash'))}<br><b>${money(sh.openCash)}</b></div><div>Zaad<br><b>${fmt(sh.openZaadSH)} SH + $${fmt(sh.openZaadUSD)}</b></div>
          <div>Edahab<br><b>${fmt(sh.openEdSH)} SH + $${fmt(sh.openEdUSD)}</b></div></div></div>
        <div id="live" class="card">${skel(1)}</div>
        <div class="card"><h3>${esc(t('End shift'))}</h3><p class="small muted">${esc(t('Count the money now and enter what you have.'))}</p>
          <form id="cf">${amountFields('close')}<label class="f"><span>${esc(t('Note'))}</span><input class="in" name="note"></label>
          <button class="btn red block lg">${esc(t('End shift'))}</button></form></div>`;
      loadLive(sh);
      $('#cf').onsubmit = e => { e.preventDefault(); withBusy(e.target.querySelector('button'), () => closeShift(sh, formData(e.target))); };
    }
    if (isOwner() || can('viewReports')) loadShiftHistory();
  };
  async function loadLive(sh) {
    const draw = (srv) => {
      const box = $('#live'); if (!box) return;
      const keys = ['cashSales', 'zaadSales', 'edSales', 'creditSales', 'custPayCash', 'custPayZaad', 'custPayEd', 'expCash', 'expZaad', 'expEd', 'refCash', 'refZaad', 'refEd', 'saleCount'];
      const x = {}; keys.forEach(k => x[k] = srv ? num(srv[k]) : 0);
      // add what is still waiting on this phone, so totals are right even offline
      let waiting = 0;
      S.queue.forEach(o => {
        if (o.userId !== S.user.id || !o.data) return;
        const k = { cash: 'Cash', zaad: 'Zaad', edahab: 'Ed' }[o.data.method];
        if (o.action === 'sale.create' && o.data.business === sh.business) {
          const sub = o.data.items.reduce((a, it) => { const p = findProd(it.productId); return a + (p ? num(p.price) : 0) * num(it.qty); }, 0);
          const tot = A.roundStep(sub - num(o.data.discount));
          x[{ cash: 'cashSales', zaad: 'zaadSales', edahab: 'edSales', credit: 'creditSales' }[o.data.method]] += tot; x.saleCount++; waiting++;
        } else if (o.action === 'cust.pay' && k) { x['custPay' + k] += num(o.data.amount); waiting++; }
        else if (o.action === 'exp.create' && o.data.business === sh.business && k) { x['exp' + k] += num(o.data.amount); waiting++; }
      });
      const rate = num(sh.rate) || A.rate();
      x.expectedCash = num(sh.openCash) + x.cashSales + x.custPayCash - x.expCash - x.refCash;
      x.expectedZaad = num(sh.openZaadSH) + num(sh.openZaadUSD) * rate + x.zaadSales + x.custPayZaad - x.expZaad - x.refZaad;
      x.expectedEd = num(sh.openEdSH) + num(sh.openEdUSD) * rate + x.edSales + x.custPayEd - x.expEd - x.refEd;
      box.innerHTML = `<h3>${esc(t('So far in this shift'))} (${x.saleCount} ${esc(t('sales'))})</h3><table class="tbl">
        <tr><td>${esc(t('Cash sales'))}</td><td class="n">${fmt(x.cashSales)}</td></tr><tr><td>Zaad</td><td class="n">${fmt(x.zaadSales)}</td></tr>
        <tr><td>Edahab</td><td class="n">${fmt(x.edSales)}</td></tr><tr><td>${esc(t('Credit'))}</td><td class="n">${fmt(x.creditSales)}</td></tr>
        <tr><td>${esc(t('Customer payments (cash)'))}</td><td class="n">${fmt(x.custPayCash)}</td></tr><tr><td>${esc(t('Expenses (cash)'))}</td><td class="n">${neg(x.expCash)}</td></tr>
        <tr><td>${esc(t('Refunds (cash)'))}</td><td class="n">${neg(x.refCash)}</td></tr>
        <tr><td><b>${esc(t('Expected cash'))}</b></td><td class="n"><b>${money(x.expectedCash)}</b></td></tr>
        <tr><td>${esc(t('Expected Zaad'))}</td><td class="n">${money(x.expectedZaad)}</td></tr><tr><td>${esc(t('Expected Edahab'))}</td><td class="n">${money(x.expectedEd)}</td></tr></table>
        ${waiting ? `<p class="small muted" style="margin:8px 0 0">${esc(t('Includes {n} items saved on this phone, not sent yet.', { n: waiting }))}</p>` : ''}`;
    };
    if (S.queue.some(o => o.data && o.data.id === sh.id)) return draw(null);   // shift itself not sent yet
    const hit = A.cacheGet('shift.preview', { id: sh.id });
    draw(hit ? hit.totals : null);
    A.syncNow().then(() => A.cachedCall('shift.preview', { id: sh.id }, r => draw(r.totals))).catch(() => {});
  }
  async function closeShift(sh, f) {
    needOnline();
    await A.syncNow();
    if (S.queue.some(o => o.userId === S.user.id)) throw new Error(t('Some sales are not sent yet. Connect to the internet and try again.'));
    if (!(await confirmBox(t('End the shift now?'), t('End shift'), 'red'))) return;
    const r = await api('shift.close', { id: sh.id, closeCash: num(f.closeCash), closeZaadSH: num(f.closeZaadSH), closeZaadUSD: num(f.closeZaadUSD), closeEdSH: num(f.closeEdSH), closeEdUSD: num(f.closeEdUSD), note: f.note });
    A.upsert('shifts', r.shift);
    go('shift');
    shiftResult(r.shift);
  }
  function diffTxt(d) { d = Math.round(num(d)); return d === 0 ? `<span class="pill green">${I('check', 'sm')}${esc(t('Correct'))}</span>` : d > 0 ? `<span class="pill gold">+${fmt(d)} ${esc(t('extra'))}</span>` : `<span class="pill red">${fmt(d)} ${esc(t('short'))}</span>`; }
  function shiftResult(s) {
    A.alertBox(t('Shift ended'), `<table class="tbl"><tr><th></th><th class="n">${esc(t('Expected'))}</th><th class="n">${esc(t('Counted'))}</th><th class="n">${esc(t('Difference'))}</th></tr>
      <tr><td>${esc(t('Cash'))}</td><td class="n">${fmt(s.expectedCash)}</td><td class="n">${fmt(s.closeCash)}</td><td class="n">${diffTxt(s.diffCash)}</td></tr>
      <tr><td>Zaad</td><td class="n">${fmt(s.expectedZaad)}</td><td class="n">${fmt(num(s.closeZaadSH) + num(s.closeZaadUSD) * num(s.rate))}</td><td class="n">${diffTxt(s.diffZaad)}</td></tr>
      <tr><td>Edahab</td><td class="n">${fmt(s.expectedEd)}</td><td class="n">${fmt(num(s.closeEdSH) + num(s.closeEdUSD) * num(s.rate))}</td><td class="n">${diffTxt(s.diffEd)}</td></tr></table>
      <p class="small muted">${esc(t('USD is counted at {r} SH.', { r: fmt(s.rate) }))}</p>`);
  }
  async function loadShiftHistory() {
    const box = $('#hist') || (() => { const d = document.createElement('div'); d.id = 'hist'; $('#main').appendChild(d); return d; })();
    A.cachedCall('shift.list', { business: S.biz, from: A.addDays(A.today(), -7), to: A.today() }, r => {
      if (!$('#hist')) return;
      box.innerHTML = `<h3>${esc(t('Recent shifts'))}</h3><div class="list">${r.shifts.map(s => `<div class="li tap" data-id="${esc(s.id)}"><div class="main"><div class="name">${esc(s.userName)} · ${A.when(s.openTs)}</div>
        <div class="sub">${s.status === 'open' ? esc(t('Open')) : esc(t('Cash')) + ' ' + fmt(s.closeCash)}</div></div>${s.status === 'closed' ? diffTxt(s.diffCash) : '<span class="pill green">' + esc(t('Open')) + '</span>'}</div>`).join('') || `<div class="empty">${esc(t('No shifts'))}</div>`}</div>`;
      $$('.li', box).forEach(li => li.onclick = () => { const s = r.shifts.find(x => x.id === li.dataset.id); if (s.status === 'closed') shiftResult(s); });
    }).catch(() => {});
  }


  /* ======================= CUSTOMERS ======================= */
  Screens.customers = function (main) {
    if (!can('customers')) return noPerm(main);
    const list = () => (S.data.customers || []).filter(c => c.business === S.biz);
    main.innerHTML =
      (setting(S.biz + '_credit') !== '1' ? `<div class="card alert amber small">${esc(t('Credit sales are turned off for this business (Settings).'))}</div>` : '') +
      `<div class="searchbar"><label class="search">${I('search')}<input id="q" type="search" placeholder="${esc(t('Search name or phone'))}" autocomplete="off" enterkeyhint="search"></label></div>
      <div class="stats"><div class="stat"><div class="lbl">${esc(t('Total owed to us'))}</div><div class="val" id="tot"></div></div><div class="stat"><div class="lbl">${esc(t('Customers'))}</div><div class="val" id="cnt"></div></div></div>
      <div id="cl"></div>`;
    const draw = () => {
      const v = $('#q').value.toLowerCase();
      const l = list().filter(c => !v || String(c.name).toLowerCase().includes(v) || String(c.phone).includes(v)).sort((a, b) => num(b.balance) - num(a.balance));
      $('#tot').textContent = fmt(list().reduce((a, c) => a + Math.max(0, num(c.balance)), 0)); $('#cnt').textContent = list().length;
      $('#cl').innerHTML = `<div class="list">${l.map(c => `<div class="li tap lead" data-id="${esc(c.id)}"><span class="av ${num(c.balance) > 0 ? 'red' : 'green'}">${esc(String(c.name).slice(0, 1).toUpperCase())}</span><div class="main"><div class="name">${esc(c.name)}</div><div class="sub">${esc(c.phone || '')}</div></div>
        <b class="${num(c.balance) > 0 ? 'red' : 'green'}">${fmt(c.balance)}</b></div>`).join('') || `<div class="empty">${esc(t('No customers yet'))}</div>`}</div>`;
      $$('#cl .li').forEach(r => r.onclick = () => customerSheet(r.dataset.id, draw));
    };
    $('#q').oninput = draw; fab(t('New customer'), 'plus', () => customerForm(null, draw)); draw();
  };
  function customerForm(c, done) {
    sheet({ title: c ? t('Edit customer') : t('New customer'), body: `<form id="f">${input('name', t('Name'), c && c.name, 'autofocus required')}${input('phone', t('Phone'), c && c.phone, 'inputmode="tel"')}${input('note', t('Note'), c && c.note)}</form>`,
      actions: [{ label: t('Cancel') }, { label: t('Save'), cls: 'gold', onClick: async (close, el) => {
        const f = formData($('#f', el)); if (!f.name) throw new Error(t('Name is required'));
        if (c) { needOnline(); const r = await api('cust.save', Object.assign({ id: c.id }, f)); A.upsert('customers', r.customer); close(); if (done) done(r.customer); return; }
        const nc = { id: A.uid('C'), business: S.biz, name: f.name, phone: f.phone, note: f.note, balance: 0, active: 1 };
        enqueue('cust.save', Object.assign({}, nc)); A.upsert('customers', nc); toast(t('Customer saved'), 'ok'); close(); if (done) done(nc);
      } }] });
  }
  function customerSheet(id, redraw) {
    const c = S.data.customers.find(x => x.id === id); if (!c) return;
    const biz = c.business === 'food' ? setting('foodName') : setting('shopName');
    const sh = sheet({ title: c.name, body: `<div class="totalbox"><div class="u">${esc(t('Owes'))}</div><div class="t">${money(c.balance)}</div><div class="u">${usd(c.balance)}</div></div>
      <div class="grid2"><button class="btn gold" id="pay">${I('cash')}${esc(t('Receive payment'))}</button><button class="btn" id="ed">${I('edit')}${esc(t('Edit'))}</button>
      ${c.phone ? `<a class="btn" href="tel:${esc(c.phone)}">${I('phone')}${esc(t('Call'))}</a><button class="btn" id="wa">${I('chat')}WhatsApp</button>` : ''}</div>
      <div class="spacer"></div><h3>${esc(t('History'))}</h3><div id="led">${skel(2)}</div>` });
    const el = sh.el;
    $('#pay', el).onclick = () => { sh.close(); paymentForm(c, redraw); };
    $('#ed', el).onclick = () => { sh.close(); customerForm(c, redraw); };
    const wa = $('#wa', el); if (wa) wa.onclick = () => A.openWhatsApp(c.phone, t('Hello {n}, your balance at {b} is {x}. Thank you.', { n: c.name, b: biz, x: money(c.balance) }));
    A.cachedCall('cust.ledger', { customerId: c.id }, r => {
      $('#led', el).innerHTML = `<div class="list">${r.ledger.map(l => `<div class="li"><div class="main"><div class="name">${esc(t(l.type === 'sale' ? 'Credit sale' : l.type === 'payment' ? 'Payment' : 'Refund'))}</div>
        <div class="sub">${A.when(l.ts)} · ${esc(l.userName)} ${l.method && l.type === 'payment' ? '· ' + esc(A.methodName(l.method)) : ''}</div></div><b class="${l.type === 'sale' ? 'red' : 'green'}">${l.type === 'sale' ? '+' : '−'}${fmt(l.amount)}</b></div>`).join('') || `<div class="empty">—</div>`}</div>`;
    }).catch(e => { if ($('#led', el)) $('#led', el).innerHTML = notYet(e); });
  }
  function paymentForm(c, done) {
    sheet({ title: t('Payment from {n}', { n: c.name }), body: `<p>${esc(t('Owes'))}: <b>${money(c.balance)}</b></p><form id="f">${moneyInput('amount', t('Amount (SH)'), '', 'autofocus')}
      <div class="chips" style="margin:-4px 0 10px"><button type="button" class="chip" id="all">${esc(t('All'))}: ${fmt(c.balance)}</button></div>
      <label class="f"><span>${esc(t('Paid with'))}</span>${methodSeg('method', ['cash', 'zaad', 'edahab'], 'cash')}</label>${input('note', t('Note'), '')}</form>`,
      onOpen: el => { seg($('[data-name=method]', el)); $('#all', el).onclick = () => { $('[name=amount]', el).value = Math.max(0, num(c.balance)); }; },
      actions: [{ label: t('Cancel') }, { label: t('Save payment'), cls: 'gold', onClick: async (close, el) => {
        const amt = num($('[name=amount]', el).value); if (amt <= 0) throw new Error(t('Enter an amount'));
        const method = $('[data-name=method]', el).dataset.value;
        enqueue('cust.pay', { id: A.uid('CP'), customerId: c.id, amount: amt, method, note: $('[name=note]', el).value });
        c.balance = num(c.balance) - amt; A.saveData();
        toast(t('Payment saved. New balance {x}', { x: money(c.balance) }), 'ok', 3500); close(); if (done) done();
      } }] });
  }

  /* ======================= EXPENSES ======================= */
  Screens.expenses = function (main) {
    if (!can('expenses')) return noPerm(main);
    const cats = String(setting('expenseCats') || 'Other').split(',').map(x => x.trim()).filter(Boolean);
    main.innerHTML = `<div class="card"><form id="f">
      <label class="f"><span>${esc(t('Category'))}</span><div class="seg" data-name="category">${cats.map((c, i) => `<button data-v="${esc(c)}" class="${i === cats.length - 1 ? 'on' : ''}">${esc(t(c))}</button>`).join('')}</div></label>
      ${moneyInput('amount', t('Amount (SH)'), '')}<label class="f"><span>${esc(t('Paid with'))}</span>${methodSeg('method', ['cash', 'zaad', 'edahab'], 'cash')}</label>
      ${input('note', t('Note'), '')}<button class="btn gold block lg">${esc(t('Save expense'))}</button></form></div><div id="el"></div>`;
    $$('#f .seg').forEach(s => seg(s));
    $('#f').onsubmit = e => {
      e.preventDefault(); const f = e.target;
      const amt = num($('[name=amount]', f).value); if (amt <= 0) return toast(t('Enter an amount'), 'err');
      const d = { id: A.uid('E'), business: S.biz, category: $('[data-name=category]', f).dataset.value, amount: amt, method: $('[data-name=method]', f).dataset.value, note: $('[name=note]', f).value };
      enqueue('exp.create', d); S.localExp = (S.localExp || []).concat([Object.assign({ ts: new Date().toISOString(), userName: S.user.name, pending: 1 }, d)]);
      toast(t('Expense saved'), 'ok'); $('[name=amount]', f).value = ''; $('[name=note]', f).value = ''; loadExp();
    };
    loadExp();
  };
  async function loadExp() {
    const draw = (srv) => {
      const box = $('#el'); if (!box) return;
      const list = (S.localExp || []).filter(e => e.business === S.biz && S.queue.some(o => o.data && o.data.id === e.id)).concat(srv || []);
      box.innerHTML = `<h3>${esc(t('Today'))}</h3><div class="list">${list.map(e => `<div class="li"><div class="main"><div class="name">${esc(t(e.category))}</div><div class="sub">${esc(A.methodName(e.method))} · ${esc(e.userName || '')} ${esc(e.note || '')} ${e.pending ? '· ' + esc(t('Waiting to send')) : ''}</div></div><b>${fmt(e.amount)}</b></div>`).join('') || `<div class="empty">${esc(t('No expenses today'))}</div>`}</div>`;
    };
    const q = { business: S.biz, from: A.today(), to: A.today() };
    const hit = A.cacheGet('exp.list', q); draw(hit ? hit.expenses : []);
    A.cachedCall('exp.list', q, r => draw(r.expenses)).catch(() => {});
  }


  /* ======================= HOME (dashboard) ======================= */
  Screens.home = function (main) {
    if (!can('viewReports')) return go('sell');
    const bizs = A.myBiz();
    let sel = S.homeBiz || (bizs.length > 1 ? 'all' : bizs[0]);
    const hour = +A.localParts().time.slice(0, 2);
    const greet = hour < 12 ? t('Good morning') : hour < 17 ? t('Good afternoon') : t('Good evening');
    let dstr = A.today();
    { const d = new Date(A.today() + 'T12:00:00Z'), so = S.lang === 'so';
      const days = so ? ['Axad', 'Isniin', 'Talaado', 'Arbaco', 'Khamiis', 'Jimco', 'Sabti'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const mons = so ? ['Janaayo', 'Febraayo', 'Maarso', 'Abriil', 'May', 'Juun', 'Luulyo', 'Agoosto', 'Sebtembar', 'Oktoobar', 'Nofembar', 'Desembar'] : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      dstr = days[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + mons[d.getUTCMonth()]; }
    main.innerHTML = `<div class="hero"><img src="icons/logo.png" alt="Saado Shop and Fast Food"><div class="hi">${esc(greet)}, <b>${esc(S.user.name)}</b> · ${esc(dstr)}</div><div id="herokpi"></div></div>
      ${bizs.length > 1 ? `<div class="chips scroll" id="hb" style="margin-bottom:12px">${['all', 'shop', 'food'].map(b => `<button class="chip ${sel === b ? 'on' : ''}" data-v="${b}">${b === 'all' ? '' : I(b === 'shop' ? 'store' : 'food')}${esc(b === 'all' ? t('Shop + Fast Food') : A.bizName(b))}</button>`).join('')}</div>` : ''}
      <div id="dash">${skel(3)}</div>`;
    $$('#hb .chip').forEach(c => c.onclick = () => { S.homeBiz = sel = c.dataset.v; $$('#hb .chip').forEach(x => x.classList.toggle('on', x === c)); load(); });
    const load = () => {
      const q = { business: sel, from: A.today(), to: A.today() };
      return A.cachedCall('report', q, r => { if ($('#dash')) drawDash($('#dash'), r, sel); })
        .catch(e => { if ($('#dash') && !$('#dash .stat')) $('#dash').innerHTML = notYet(e); });
    };
    if (S.queue.length) A.syncNow().then(load);
    load();
  };
  function drawDash(box, r, sel) {
    const T = r.totals, alerts = [];
    if (r.pendingRefunds && can('approveRefunds')) alerts.push(['refunds', 'undo', t('{n} refund requests waiting', { n: r.pendingRefunds }), 'red']);
    if (S.failed.length) alerts.push(['sync', 'alert', t('{n} items failed to save', { n: S.failed.length }), 'red']);
    if (r.lowStock.length) alerts.push(['products/low', 'box', t('{n} products low on stock', { n: r.lowStock.length }), 'gold']);
    if (r.expiring.length) alerts.push(['products/exp', 'calendar', t('{n} products expired or expiring', { n: r.expiring.length }), 'gold']);
    if (r.lowIngredients.length) alerts.push(['ingredients', 'food', t('Low ingredients: {x}', { x: r.lowIngredients.map(i => t(i.name)).join(', ') }), 'gold']);
    if (r.openOrders && can('suppliers')) alerts.push(['purchasing', 'truck', t('{n} purchase orders waiting for delivery', { n: r.openOrders }), '']);
    const hk = $('#herokpi');
    if (hk) hk.innerHTML = `<div class="kpi"><div><div class="l">${esc(t('Sales today'))}</div><div class="v">${fmt(T.netSales)} <span style="font-size:15px;font-weight:600">SH</span></div>
      <div class="l" style="font-weight:500">${T.count} ${esc(t('sales'))} · ${usd(T.netSales)}</div></div>
      ${r.profitVisible ? `<div class="right"><div class="l">${esc(t('Profit'))}</div><div class="v" style="font-size:22px;color:${T.profit < 0 ? 'var(--red)' : 'var(--green)'}">${fmt(T.profit)}</div></div>` : ''}</div>`;
    const biz = ['shop', 'food'].filter(b => r.business.indexOf(b) >= 0);
    const stat = (ic, l, v) => `<div class="stat"><div class="lbl">${I(ic)}${esc(l)}</div><div class="val">${v}</div></div>`;
    box.innerHTML = `
      ${biz.length > 1 ? `<div class="stats" style="grid-template-columns:1fr 1fr">${biz.map(b => `<div class="stat"><div class="lbl">${I(b === 'shop' ? 'store' : 'food')}${esc(A.bizName(b))}</div><div class="val">${fmt(r.byBiz[b].netSales)}</div><div class="small muted">${r.byBiz[b].count} ${esc(t('sales'))}${r.profitVisible ? ' · ' + esc(t('Profit')) + ' ' + fmt(r.byBiz[b].profit) : ''}</div></div>`).join('')}</div>` : ''}
      <div class="stats">${stat('cash', t('Cash'), fmt(T.cash))}${stat('phone', 'Zaad', fmt(T.zaad))}${stat('phone', 'Edahab', fmt(T.edahab))}${stat('users', t('Credit'), fmt(T.credit))}
        ${stat('wallet', t('Expenses'), fmt(T.expenses + T.stockPurchases))}${stat('undo', t('Refunds'), fmt(T.refunds))}${stat('receipt', t('Customer debts'), fmt(r.totalDebt))}${stat('okcircle', t('Debt payments'), fmt(T.custPay))}</div>
      ${alerts.length ? `<h3>${esc(t('Needs attention'))}</h3><div class="list">${alerts.map(a => `<div class="li tap lead" data-go="${a[0]}"><span class="av ${a[3]}">${I(a[1])}</span><div class="main name" style="white-space:normal">${esc(a[2])}</div>${I('right', 'sm chev')}</div>`).join('')}</div>` : ''}
      <h3>${esc(t('Money in shifts'))}</h3><div class="list">${r.balances.map(b => `
        ${b.open.map(o => `<div class="li lead"><span class="av green">${I('clock')}</span><div class="main"><div class="name">${esc(A.bizName(b.business))} · ${esc(o.userName)}</div>
          <div class="sub" style="white-space:normal">${esc(t('Expected now'))}: ${esc(t('Cash'))} ${fmt(o.expectedCash)} · Zaad ${fmt(o.expectedZaad)} · Edahab ${fmt(o.expectedEd)}</div></div><span class="pill green">${esc(t('Open'))}</span></div>`).join('')}
        ${b.last ? `<div class="li lead"><span class="av gray">${I('lock')}</span><div class="main"><div class="name">${esc(A.bizName(b.business))} · ${esc(t('last closed'))} ${A.when(b.last.closeTs)}</div>
          <div class="sub" style="white-space:normal">${esc(b.last.userName)} · ${esc(t('Cash'))} ${fmt(b.last.cash)} · Zaad ${fmt(b.last.zaad)} · Edahab ${fmt(b.last.edahab)}</div></div>${diffTxt(b.last.diffCash)}</div>` : ''}`).join('') || `<div class="empty">${I('clock')}${esc(t('No shifts'))}</div>`}</div>
      <div class="grid2"><div><h3>${esc(t('Best sellers'))}</h3><div class="list">${r.topItems.slice(0, 5).map((i, n) => `<div class="li"><span class="av gold" style="width:28px;height:28px;border-radius:9px;font-size:13px">${n + 1}</span><div class="main name">${esc(i.name)}</div><span class="muted small">×${fmt(i.qty)}</span></div>`).join('') || `<div class="empty small">—</div>`}</div></div>
        <div><h3>${esc(t('Top debtors'))}</h3><div class="list">${r.debts.slice(0, 5).map(c => `<div class="li"><div class="main name">${esc(c.name)}</div><b class="red small">${fmt(c.balance)}</b></div>`).join('') || `<div class="empty small">—</div>`}</div></div></div>
      <div class="col" style="margin-top:4px"><button class="btn green block lg" id="wa">${I('chat')}${esc(t('Send daily summary on WhatsApp'))}</button><button class="btn block" id="rep">${I('chart')}${esc(t('Full reports'))}</button></div>`;
    $$('[data-go]', box).forEach(x => x.onclick = () => go(x.dataset.go));
    $('#wa', box).onclick = () => A.openWhatsApp(setting('ownerWhatsApp'), summaryText(r));
    $('#rep', box).onclick = () => go('reports');
  }

  /* ======================= REPORTS ======================= */
  Screens.reports = function (main) {
    if (!can('viewReports')) return noPerm(main);
    const bizs = A.myBiz();
    const st = S.repState || (S.repState = { biz: bizs.length > 1 ? 'all' : bizs[0], from: A.today(), to: A.today(), preset: 'today' });
    const presets = { today: [A.today(), A.today()], yesterday: [A.addDays(A.today(), -1), A.addDays(A.today(), -1)], week: [A.addDays(A.today(), -6), A.today()], month: [A.today().slice(0, 8) + '01', A.today()] };
    main.innerHTML = head(t('Choose business and dates'), `<button class="iconbtn tonal round noprint" onclick="window.print()" aria-label="print">${I('printer', 'sm')}</button>`) + `<div class="card noprint">
      ${bizs.length > 1 ? `<div class="chips" id="rb" style="margin-bottom:8px">${['all', 'shop', 'food'].map(b => `<button class="chip ${st.biz === b ? 'on' : ''}" data-v="${b}">${esc(b === 'all' ? t('Shop + Fast Food') : A.bizName(b))}</button>`).join('')}</div>` : ''}
      <div class="chips" id="pr">${[['today', t('Today')], ['yesterday', t('Yesterday')], ['week', t('7 days')], ['month', t('This month')]].map(p => `<button class="chip ${st.preset === p[0] ? 'on' : ''}" data-v="${p[0]}">${esc(p[1])}</button>`).join('')}</div>
      <div class="grid2" style="margin-top:8px"><label class="f"><span>${esc(t('From'))}</span><input class="in" type="date" id="rf" value="${st.from}"></label><label class="f"><span>${esc(t('To'))}</span><input class="in" type="date" id="rt" value="${st.to}"></label></div></div>
      <div id="rep">${skel(3)}</div>`;
    $$('#rb .chip').forEach(c => c.onclick = () => { st.biz = c.dataset.v; $$('#rb .chip').forEach(x => x.classList.toggle('on', x === c)); load(); });
    $$('#pr .chip').forEach(c => c.onclick = () => { st.preset = c.dataset.v; [st.from, st.to] = presets[st.preset]; $('#rf').value = st.from; $('#rt').value = st.to; $$('#pr .chip').forEach(x => x.classList.toggle('on', x === c)); load(); });
    $('#rf').onchange = $('#rt').onchange = () => { st.from = $('#rf').value; st.to = $('#rt').value; st.preset = ''; $$('#pr .chip').forEach(x => x.classList.remove('on')); load(); };
    const load = () => {
      const q = { business: st.biz, from: st.from, to: st.to };
      if (!A.cacheGet('report', q) && $('#rep')) $('#rep').innerHTML = skel(3);
      return A.cachedCall('report', q, r => { if ($('#rep')) drawReport($('#rep'), r); }).catch(e => { if ($('#rep')) $('#rep').innerHTML = notYet(e); });
    };
    if (S.queue.length) A.syncNow().then(load);
    load();
  };
  function drawReport(box, r) {
    const bz = ['shop', 'food'].filter(b => r.business.indexOf(b) >= 0), P = r.profitVisible;
    const col = (lbl, f) => `<tr><td>${esc(lbl)}</td>${bz.map(b => `<td class="n">${f(r.byBiz[b])}</td>`).join('')}${bz.length > 1 ? `<td class="n"><b>${f(r.totals)}</b></td>` : ''}</tr>`;
    const tbl = (h, rows) => `<div class="tblwrap"><table class="tbl"><tr>${h.map((x, i) => `<th class="${i ? 'n' : ''}">${esc(x)}</th>`).join('')}</tr>${rows.join('')}</table></div>`;
    box.innerHTML = `
      <div class="card"><h3>${esc(t('Summary'))} · ${esc(r.from)}${r.to !== r.from ? ' → ' + esc(r.to) : ''}</h3>${tbl([''].concat(bz.map(A.bizName)).concat(bz.length > 1 ? [t('Total')] : []), [
        col(t('Number of sales'), x => fmt(x.count)), col(t('Sales before discount'), x => fmt(x.subtotal)), col(t('Discounts'), x => fmt(x.discount)),
        col(t('Sales'), x => fmt(x.sales)), col(t('Refunds'), x => neg(x.refunds)), col(t('Net sales'), x => '<b>' + fmt(x.netSales) + '</b>'),
        col(t('Cash'), x => fmt(x.cash)), col('Zaad', x => fmt(x.zaad)), col('Edahab', x => fmt(x.edahab)), col(t('Credit'), x => fmt(x.credit)),
        col(t('Debt payments received'), x => fmt(x.custPay)),
        P ? col(t('Cost of goods sold'), x => neg(x.cost - x.refundCost)) : '', col(t('Expenses'), x => neg(x.expenses)),
        P ? col(t('Profit'), x => `<b class="${x.profit < 0 ? 'red' : 'green'}">${fmt(x.profit)}</b>`) : '',
        col(t('Stock bought from suppliers'), x => fmt(x.stockPurchases))])}
        ${P ? `<p class="small muted">${esc(t('Profit = net sales − cost of goods sold − expenses. Money paid to suppliers for shop stock is not counted again as an expense.'))}</p>` : ''}</div>
      <div class="card"><h3>${esc(t('Daily sales by payment'))}</h3>${tbl([t('Date'), t('Business'), t('Sales'), t('Cash'), 'Zaad', 'Edahab', t('Credit'), t('Total')],
        r.days.map(d => `<tr><td>${esc(d.date.slice(5))}</td><td class="n">${esc(d.business === 'shop' ? t('Shop') : t('Food'))}</td><td class="n">${d.count}</td><td class="n">${fmt(d.cash)}</td><td class="n">${fmt(d.zaad)}</td><td class="n">${fmt(d.edahab)}</td><td class="n">${fmt(d.credit)}</td><td class="n"><b>${fmt(d.total)}</b></td></tr>`))}</div>
      <div class="card"><h3>${esc(t('Best-selling items'))}</h3>${tbl([t('Item'), t('Qty'), t('Sales')].concat(P ? [t('Profit')] : []),
        r.topItems.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${fmt(i.qty)}</td><td class="n">${fmt(i.revenue)}</td>${P ? `<td class="n">${fmt(i.profit)}</td>` : ''}</tr>`))}</div>
      <div class="card"><h3>${esc(t('Sales by employee'))}</h3>${tbl([t('Name'), t('Business'), t('Sales'), t('Total')], r.employees.map(e => `<tr><td>${esc(e.name)}</td><td class="n">${esc(A.bizName(e.business))}</td><td class="n">${e.count}</td><td class="n">${fmt(e.total)}</td></tr>`))}</div>
      <div class="card"><h3>${esc(t('Expenses by category'))}</h3>${tbl([t('Category'), t('Business'), t('Amount')], r.expenses.map(e => `<tr><td>${esc(t(e.category))}</td><td class="n">${esc(A.bizName(e.business))}</td><td class="n">${fmt(e.amount)}</td></tr>`))}</div>
      <div class="card"><h3>${esc(t('Money balances from shifts'))}</h3>${tbl([t('Business'), t('Cash'), 'Zaad', 'Edahab', t('Cash difference')], r.balances.map(b => b.last ? `<tr><td>${esc(A.bizName(b.business))} <span class="small muted">${A.when(b.last.closeTs)}</span></td><td class="n">${fmt(b.last.cash)}</td><td class="n">${fmt(b.last.zaad)}</td><td class="n">${fmt(b.last.edahab)}</td><td class="n">${diffTxt(b.last.diffCash)}</td></tr>` : ''))}
        ${r.shifts.length ? `<div class="spacer"></div>${tbl([t('Shift'), t('Cash'), t('Expected'), t('Difference')], r.shifts.map(s => `<tr><td>${esc(s.userName)} ${A.when(s.openTs)}</td><td class="n">${s.status === 'closed' ? fmt(s.closeCash) : esc(t('Open'))}</td><td class="n">${s.status === 'closed' ? fmt(s.expectedCash) : ''}</td><td class="n">${s.status === 'closed' ? diffTxt(s.diffCash) : ''}</td></tr>`))}` : ''}</div>
      <div class="card"><h3>${esc(t('Customer debts'))} · ${money(r.totalDebt)}</h3>${tbl([t('Customer'), t('Phone'), t('Owes')], r.debts.map(c => `<tr><td>${esc(c.name)}</td><td class="n">${esc(c.phone || '')}</td><td class="n red">${fmt(c.balance)}</td></tr>`))}</div>
      ${r.suppliersOwed.length ? `<div class="card"><h3>${esc(t('We owe suppliers'))}</h3>${tbl([t('Supplier'), t('Amount')], r.suppliersOwed.map(s => `<tr><td>${esc(s.name)}</td><td class="n">${fmt(s.balance)}</td></tr>`))}</div>` : ''}
      <div class="card"><h3>${esc(t('Low stock'))}</h3>${tbl([t('Item'), t('Stock'), t('Low level')], r.lowStock.map(p => `<tr><td>${esc(p.name)}</td><td class="n red">${fmt(p.stock)}</td><td class="n">${fmt(p.lowStock)}</td></tr>`).concat(r.lowIngredients.map(g => `<tr><td>${esc(t(g.name))} (${esc(t(g.unit))})</td><td class="n red">${fmt(g.stock)}</td><td class="n">${fmt(g.lowLevel)}</td></tr>`)))}</div>
      ${r.expiring.length ? `<div class="card"><h3>${esc(t('Expired / expiring'))}</h3>${tbl([t('Item'), t('Expiry'), t('Stock')], r.expiring.map(p => `<tr><td>${esc(p.name)}</td><td class="n ${p.expired ? 'red' : 'amber'}">${esc(p.expiry)}</td><td class="n">${fmt(p.stock)}</td></tr>`))}</div>` : ''}
      <div class="col noprint"><button class="btn green block" id="wa">${I('chat')}${esc(t('Send summary on WhatsApp'))}</button></div>`;
    $('#wa', box).onclick = () => A.openWhatsApp(setting('ownerWhatsApp'), summaryText(r));
  }

  /* ======================= MORE ======================= */
  Screens.more = function (main) {
    const food = S.biz === 'food';
    const groups = [
      [t('Daily work'), [
        ['customers', 'users', t('Customers'), t('Credit, debts and payments'), can('customers'), 'blue'],
        ['expenses', 'wallet', t('Expenses'), t('Electricity, deliveries, salaries…'), can('expenses'), 'blue'],
        ['refunds', 'undo', t('Refunds'), t('Request or approve returns'), true, 'blue', can('approveRefunds') ? S.data.pendingRefunds : 0],
        ['ingredients', 'food', t('Ingredients'), t('Daily usage and stock'), food && (can('ingredients') || can('manageProducts')), 'blue'],
        ['stockcount', 'clipboard', t('Stock count'), t('Count the shelves and fix stock'), !food && can('stockCount'), 'blue']]],
      [t('Business'), [
        ['products', food ? 'food' : 'box', food ? t('Menu items') : t('Products'), t('Prices, barcodes, stock, import'), can('viewStock') || can('manageProducts') || can('changePrices'), 'gold'],
        ['purchasing', 'truck', t('Purchasing'), t('Purchase orders and suppliers'), can('suppliers'), 'gold'],
        ['reports', 'chart', t('Reports'), t('Sales, profit, debts, balances'), can('viewReports'), 'gold'],
        ['users', 'shield', t('Users'), t('Accounts, PINs and permissions'), can('manageUsers'), 'gold'],
        ['settings', 'sliders', t('Settings'), t('Rates, accounts, hours, install'), can('settings'), 'gold'],
        ['audit', 'file', t('Audit log'), t('Who did what and when'), can('audit'), 'gold']]],
      [t('App'), [
        ['sync', 'sync', t('Sync status'), t('Sales waiting to be sent'), true, 'gray', S.failed.length],
        ['install', 'install', t('Install the app'), t('Add Saado POS to your home screen'), !A.isStandalone(), 'gray'],
        ['guide', 'book', t('Guide'), t('How to use Saado POS'), true, 'gray'],
        ['pin', 'key', t('My PIN'), t('Change your PIN'), true, 'gray'],
        ['lang', 'globe', S.lang === 'so' ? 'English' : 'Soomaali', t('Change language'), true, 'gray'],
        ['logout', 'logout', t('Log out'), S.user.name, true, 'red']]]
    ];
    main.innerHTML = groups.map(([g, items]) => { const v = items.filter(x => x[4]); return v.length ? `<h3>${esc(g)}</h3><div class="list">${v.map(x => `<div class="li tap lead" data-r="${x[0]}">
        <span class="av ${x[5] === 'blue' ? '' : x[5]}">${I(x[1])}</span><div class="main"><div class="name">${esc(x[2])}</div><div class="sub">${esc(x[3])}</div></div>
        ${x[6] ? `<span class="badge">${x[6]}</span>` : ''}${I('right', 'sm chev')}</div>`).join('')}</div>` : ''; }).join('') +
      `<p class="small faint center" style="margin-top:18px">${esc(S.user.name)} · ${esc(isOwner() ? t('Owner') : t('Employee'))} · Saado POS v${A.APP_VERSION}</p>`;
    $$('[data-r]').forEach(b => b.onclick = async () => {
      const r = b.dataset.r;
      if (r === 'logout') return A.logout();
      if (r === 'install') return A.installApp();
      if (r === 'lang') {
        S.lang = S.lang === 'so' ? 'en' : 'so'; A.LS.set('lang', S.lang); S.user.lang = S.lang;
        A.LS.set('session', { token: S.token, expires: S.expires, user: S.user });
        if (S.online) api('me.setLang', { lang: S.lang }).catch(() => {});
        A.drawShell(); return A.render();
      }
      go(r);
    });
  };

  /* ======================= GUIDE (in-app page) ======================= */
  Screens.guide = function (main, args) {
    let part = args[0] === 'owner' ? 'owner' : 'staff';
    const G = (window.GUIDE || {})[S.lang] || (window.GUIDE || {}).en || {};
    main.innerHTML = `<div class="seg" id="gt" style="margin:4px 0 14px"><button data-v="staff" class="${part === 'staff' ? 'on' : ''}">${I('users', 'sm')} ${esc(t('Staff guide'))}</button>
      <button data-v="owner" class="${part === 'owner' ? 'on' : ''}">${I('shield', 'sm')} ${esc(t('Owner guide'))}</button></div><div class="card guide selectable" id="gb"></div>`;
    const draw = () => { $('#gb').innerHTML = G[part] || ''; };
    seg($('#gt'), v => { part = v; draw(); window.scrollTo(0, 0); });
    draw();
  };

  /* ======================= PRODUCTS ======================= */
  Screens.products = function (main, args) {
    if (!(can('viewStock') || can('manageProducts') || can('changePrices'))) return noPerm(main);
    const food = S.biz === 'food';
    let filter = args[0] || 'all';
    main.innerHTML = `
      <div class="searchbar"><label class="search">${I('search')}<input id="q" type="search" placeholder="${esc(t('Search or scan barcode'))}" autocomplete="off" enterkeyhint="search"></label><button class="iconbtn" id="sc">${I('scan')}</button></div>
      <div class="chips" id="fl" style="margin-bottom:8px">${[['all', t('All')]].concat(food ? [] : [['low', t('Low stock')], ['exp', t('Expiring')]]).concat([['off', t('Hidden')]]).map(f => `<button class="chip ${filter === f[0] ? 'on' : ''}" data-v="${f[0]}">${esc(f[1])}</button>`).join('')}</div>
      <div id="pl"></div>
      ${can('manageProducts') ? `<div class="grid2"><button class="btn" id="imp">${I('download')}${esc(t('Import CSV / Excel'))}</button><button class="btn" id="tpl">${I('file')}${esc(t('Download template'))}</button></div>` : ''}`;
    const lim = A.addDays(A.today(), num(setting('expiryWarnDays')) || 14);
    const draw = () => {
      const v = $('#q').value.toLowerCase();
      let l = (S.data.products || []).filter(p => p.business === S.biz);
      if (filter === 'off') l = l.filter(p => String(p.active) === '0'); else l = l.filter(p => String(p.active) !== '0');
      if (filter === 'low') l = l.filter(p => num(p.stock) <= num(p.lowStock));
      if (filter === 'exp') l = l.filter(p => p.expiry && p.expiry <= lim);
      if (v) l = l.filter(p => String(p.name).toLowerCase().includes(v) || String(p.barcode).includes(v) || String(p.category || '').toLowerCase().includes(v));
      l.sort((a, b) => String(a.name).localeCompare(b.name));
      $('#pl').innerHTML = `<div class="small muted" style="margin:0 4px 6px">${l.length} ${esc(t('items'))}</div><div class="list">${l.slice(0, 300).map(p => `<div class="li tap lead" data-id="${esc(p.id)}"><span class="av ${!food && num(p.stock) <= num(p.lowStock) ? 'red' : 'gold'}">${I(food ? 'food' : 'box')}</span><div class="main"><div class="name">${num(p.fav) ? I('star', 'sm') + ' ' : ''}${esc(p.name)}</div>
        <div class="sub">${esc(p.category || '')} ${p.barcode ? '· ' + esc(p.barcode) : ''} ${p.expiry ? `· <span class="${p.expiry < A.today() ? 'red' : p.expiry <= lim ? 'amber' : ''}">${esc(t('Exp'))} ${esc(p.expiry)}</span>` : ''}</div></div>
        <div class="right"><b>${fmt(p.price)}</b>${!food && can('viewStock') ? `<div class="small ${num(p.stock) <= num(p.lowStock) ? 'red bold' : 'muted'}">${esc(t('Stock'))} ${fmt(p.stock)}</div>` : ''}</div></div>`).join('') || `<div class="empty">${esc(t('Nothing found'))}</div>`}</div>`;
      $$('#pl .li').forEach(r => r.onclick = () => productForm(findProd(r.dataset.id), draw));
    };
    $('#q').oninput = draw;
    $$('#fl .chip').forEach(c => c.onclick = () => { filter = c.dataset.v; $$('#fl .chip').forEach(x => x.classList.toggle('on', x === c)); draw(); });
    $('#sc').onclick = async () => { const code = await A.scanOnce(); if (!code) return; const p = prods().find(x => x.barcode === code); if (p) productForm(p, draw); else if (can('manageProducts')) productForm({ barcode: code }, draw); else toast(t('Barcode not found: {c}', { c: code }), 'err'); };
    if (can('manageProducts')) fab(food ? t('New menu item') : t('New product'), 'plus', () => productForm(null, draw));
    if ($('#imp')) $('#imp').onclick = () => importSheet(draw);
    if ($('#tpl')) $('#tpl').onclick = () => A.download('saado-products-template.csv', A.toCSV(['name', 'barcode', 'category', 'price', 'cost', 'stock', 'lowStock', 'expiry'],
      [['Coca-Cola 330ml', '5449000000996', 'Drinks', '3000', '2500', '48', '12', ''], ['Rice 25kg bag', '', 'Rice', '260000', '235000', '10', '3', '2027-06-30']]));
    draw();
  };
  function productForm(p, done) {
    const isNew = !p || !p.id; p = p || {};
    const food = (p.business || S.biz) === 'food';
    const showCost = can('viewProfit') || can('changePrices');
    const mp = can('manageProducts'), cp = can('changePrices');
    const cats = Array.from(new Set((S.data.products || []).map(x => x.category).filter(Boolean)));
    const sh = sheet({ title: isNew ? t('New product') : p.name, body: `<form id="f">
      ${input('name', t('Name'), p.name, (mp ? '' : 'readonly ') + 'required')}
      <label class="f"><span>${esc(t('Barcode'))}</span><div class="row"><input class="in grow" name="barcode" value="${esc(p.barcode || '')}" inputmode="numeric" ${mp ? '' : 'readonly'}>${mp ? `<button type="button" class="iconbtn tonal" id="sb">${I('scan')}</button>` : ''}</div></label>
      <div class="grid2">${moneyInput('price', t('Selling price (SH)'), p.price, isNew || cp ? 'required' : 'readonly')}${showCost ? moneyInput('cost', t('Cost price (SH)'), p.cost, isNew || cp ? '' : 'readonly') : ''}</div>
      <label class="f"><span>${esc(t('Category'))}</span><input class="in" name="category" list="cats" value="${esc(p.category || '')}" ${mp ? '' : 'readonly'}><datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      ${!food ? `<div class="grid2">${moneyInput('stock', t('Stock now'), isNew ? '' : p.stock, mp ? '' : 'readonly')}${moneyInput('lowStock', t('Warn when stock is at'), isNew ? setting('defaultLowStock') : p.lowStock, mp ? '' : 'readonly')}</div>
      <label class="f"><span>${esc(t('Expiry date (optional)'))}</span><input class="in" type="date" name="expiry" value="${esc(p.expiry || '')}" ${mp ? '' : 'readonly'}></label>` : ''}
      ${mp ? `<label class="chk"><input type="checkbox" name="fav" ${num(p.fav) ? 'checked' : ''}><span class="main">${esc(t('Always show on the sell screen'))}</span></label>
      ${!isNew ? `<label class="chk"><input type="checkbox" name="active" ${String(p.active) !== '0' ? 'checked' : ''}><span class="main">${esc(t('Active (can be sold)'))}</span></label>` : ''}` : ''}
      ${!isNew ? `<p class="small muted">${esc(t('Sold so far'))}: ${fmt(p.sold)}</p>` : ''}</form>`,
      onOpen: el => { const sb = $('#sb', el); if (sb) sb.onclick = async () => { const c = await A.scanOnce(); if (c) $('[name=barcode]', el).value = c; }; },
      actions: [{ label: t('Cancel') }].concat(mp || cp ? [{ label: t('Save'), cls: 'gold', onClick: async (close, el) => {
        needOnline();
        const f = formData($('#f', el));
        const d = { id: isNew ? '' : p.id, business: p.business || S.biz, name: f.name, barcode: f.barcode, price: num(f.price), category: f.category, lowStock: f.lowStock, expiry: f.expiry || '', fav: f.fav, active: isNew ? 1 : f.active };
        if (showCost) d.cost = num(f.cost);
        if (!food) d.stock = f.stock;
        if (!d.name || !(d.price > 0)) throw new Error(t('Name and price are required'));
        const r = await api('prod.save', d);
        A.upsert('products', r.product); toast(t('Saved'), 'ok'); close(); if (done) done();
      } }] : []) });
    return sh;
  }
  function importSheet(done) {
    const map = { name: /^(name|magac|magaca|product|item)/i, barcode: /^(barcode|code|bar)/i, category: /^(category|qayb|cat)/i, price: /^(price|qiime|sell)/i, cost: /^(cost|kharash|buy)/i, stock: /^(stock|kayd|qty|quantity)/i, lowStock: /^(low)/i, expiry: /^(expiry|exp|dhac)/i };
    let rows = null;
    const sh = sheet({ title: t('Import products'), body: `<p class="small">${esc(t('Choose a CSV or Excel (.xlsx) file. First row must be headings: name, barcode, category, price, cost, stock, lowStock, expiry.'))}</p>
      <input type="file" id="file" accept=".csv,.xlsx,.txt" class="in"><div id="pv" class="spacer"></div>`,
      actions: [{ label: t('Cancel') }, { label: t('Import'), cls: 'gold', onClick: async close => {
        needOnline();
        if (!rows || !rows.length) throw new Error(t('Choose a file first'));
        let added = 0, updated = 0, skipped = 0;
        for (let i = 0; i < rows.length; i += 200) {
          const r = await api('prod.import', { business: S.biz, rows: rows.slice(i, i + 200) });
          added += r.added; updated += r.updated; skipped += r.skipped;
        }
        await A.refresh(); close(); done && done();
        A.alertBox(t('Import finished'), `<p>${esc(t('Added'))}: <b>${added}</b><br>${esc(t('Updated'))}: <b>${updated}</b><br>${esc(t('Skipped (no name or price)'))}: <b>${skipped}</b></p>`);
      } }] });
    $('#file', sh.el).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const raw = /\.xlsx$/i.test(f.name) ? await A.readXLSX(await f.arrayBuffer()) : A.parseCSV(await f.text());
        const hdr = raw[0].map(h => String(h).trim()), idx = {};
        Object.keys(map).forEach(k => { idx[k] = hdr.findIndex(h => map[k].test(h.replace(/\s/g, ''))); });
        if (idx.name < 0 || idx.price < 0) throw new Error(t('The file needs a "name" and a "price" column.'));
        rows = raw.slice(1).map(r => { const o = {}; Object.keys(idx).forEach(k => { if (idx[k] >= 0) o[k] = String(r[idx[k]] == null ? '' : r[idx[k]]).trim(); }); if (o.expiry && /^\d{5}$/.test(o.expiry)) o.expiry = new Date(Date.UTC(1899, 11, 30) + num(o.expiry) * 86400000).toISOString().slice(0, 10); return o; });
        $('#pv', sh.el).innerHTML = `<p><b>${rows.length}</b> ${esc(t('rows found'))}. ${esc(t('First rows:'))}</p><div class="tblwrap"><table class="tbl"><tr><th>${esc(t('Name'))}</th><th>${esc(t('Barcode'))}</th><th class="n">${esc(t('Price'))}</th><th class="n">${esc(t('Stock'))}</th></tr>
          ${rows.slice(0, 6).map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.barcode || '')}</td><td class="n">${esc(r.price)}</td><td class="n">${esc(r.stock || '')}</td></tr>`).join('')}</table></div>`;
      } catch (err) { rows = null; $('#pv', sh.el).innerHTML = `<p class="red">${esc(err.message)}</p>`; }
    };
  }

  /* ======================= STOCK COUNT ======================= */
  Screens.stockcount = function (main) {
    if (!can('stockCount')) return noPerm(main);
    S.count = A.LS.get('count', []);
    main.innerHTML = `<p class="small muted">${esc(t('Scan or search each item on the shelf and type how many you really have. Then save.'))}</p>
      <div class="searchbar"><label class="search">${I('search')}<input id="q" type="search" placeholder="${esc(t('Search or scan barcode'))}" autocomplete="off" enterkeyhint="search"></label><button class="iconbtn gold" id="sc">${I('scan')}</button></div>
      <div id="res"></div><h3>${esc(t('Counted'))}</h3><div id="cl"></div>
      <div class="grid2"><button class="btn" id="clr">${esc(t('Clear'))}</button><button class="btn gold lg" id="sv">${esc(t('Save count'))}</button></div>`;
    const save = () => A.LS.set('count', S.count);
    const ask = p => {
      const prev = S.count.find(c => c.productId === p.id);
      sheet({ title: p.name, body: `<p>${esc(t('System stock'))}: <b>${fmt(p.stock)}</b></p>${moneyInput('n', t('Real count'), prev ? prev.counted : '', 'autofocus')}`,
        actions: [{ label: t('Cancel') }, { label: t('OK'), cls: 'gold', onClick: (close, el) => {
          const v = $('[name=n]', el).value; if (v === '') throw new Error(t('Enter a number'));
          S.count = S.count.filter(c => c.productId !== p.id); S.count.unshift({ productId: p.id, name: p.name, system: num(p.stock), counted: num(v) }); save(); close(); draw();
        } }] });
    };
    const draw = () => {
      $('#cl').innerHTML = `<div class="list">${S.count.map(c => { const d = c.counted - c.system; return `<div class="li tap" data-id="${esc(c.productId)}"><div class="main"><div class="name">${esc(c.name)}</div><div class="sub">${esc(t('System'))} ${fmt(c.system)} → ${esc(t('Real'))} ${fmt(c.counted)}</div></div>
        <b class="${d < 0 ? 'red' : d > 0 ? 'amber' : 'green'}">${d > 0 ? '+' : ''}${fmt(d)}</b></div>`; }).join('') || `<div class="empty">${esc(t('Nothing counted yet'))}</div>`}</div>`;
      $$('#cl .li').forEach(r => r.onclick = () => ask(findProd(r.dataset.id)));
    };
    $('#q').oninput = () => {
      const v = $('#q').value.trim().toLowerCase();
      const l = v ? prods('shop').filter(p => String(p.name).toLowerCase().includes(v) || String(p.barcode).startsWith(v)).slice(0, 20) : [];
      $('#res').innerHTML = l.length ? `<div class="list">${l.map(p => `<div class="li tap" data-id="${esc(p.id)}"><div class="main name">${esc(p.name)}</div><span class="muted">${fmt(p.stock)}</span></div>`).join('')}</div>` : '';
      $$('#res .li').forEach(r => r.onclick = () => { $('#q').value = ''; $('#res').innerHTML = ''; ask(findProd(r.dataset.id)); });
    };
    $('#q').onkeydown = e => { if (e.key === 'Enter') { const p = prods('shop').find(x => x.barcode === $('#q').value.trim()); if (p) { $('#q').value = ''; ask(p); } } };
    $('#sc').onclick = async () => { const c = await A.scanOnce(); if (!c) return; const p = prods('shop').find(x => x.barcode === c); if (p) ask(p); else toast(t('Barcode not found: {c}', { c }), 'err'); };
    $('#clr').onclick = async () => { if (await confirmBox(t('Clear the count list?'))) { S.count = []; save(); draw(); } };
    $('#sv').onclick = e => withBusy(e.target, async () => {
      needOnline(); if (!S.count.length) throw new Error(t('Nothing counted yet'));
      await A.syncNow();
      const r = await api('stock.count', { id: A.uid('SC'), counts: S.count.map(c => ({ productId: c.productId, counted: c.counted })) });
      S.count = []; save(); await A.refresh(); draw(); A.alertBox(t('Stock count saved'), `<p>${esc(t('{n} products corrected.', { n: r.changed }))}</p>`);
    });
    draw();
  };

  /* ======================= PURCHASING (purchase orders + suppliers, like Adam Nokia) ======================= */
  const PST = { DRAFT: ['Draft', 'gray', 'edit'], SENT: ['Sent to supplier', 'gold', 'send'], RECEIVED: ['Received', 'green', 'inbox'], CANCELLED: ['Cancelled', 'red', 'x'] };
  const poItems = o => { try { return typeof o.items === 'string' ? JSON.parse(o.items || '[]') : (o.items || []); } catch (e) { return []; } };
  const ordersKey = () => 'orders_' + S.user.id + '_' + S.biz;
  async function loadOrders() {
    try { const r = await api('po.list', { business: S.biz }); S.orders = r.orders; A.LS.set(ordersKey(), r.orders); }
    catch (e) { S.orders = S.orders || A.LS.get(ordersKey(), []); }
    return S.orders;
  }
  function upsertOrder(o) { S.orders = S.orders || []; const i = S.orders.findIndex(x => x.id === o.id); if (i >= 0) S.orders[i] = o; else S.orders.unshift(o); A.LS.set(ordersKey(), S.orders); }
  Screens.purchasing = function (main, args) {
    if (!can('suppliers')) return noPerm(main);
    let tab = args[0] === 'suppliers' ? 'suppliers' : 'orders', filter = 'open';
    S.orders = A.LS.get(ordersKey(), []);
    main.innerHTML = `<div class="seg" id="ptab" style="margin:4px 0 14px"><button data-v="orders" class="${tab === 'orders' ? 'on' : ''}">${I('receipt', 'sm')} ${esc(t('Purchase orders'))}</button>
      <button data-v="suppliers" class="${tab === 'suppliers' ? 'on' : ''}">${I('truck', 'sm')} ${esc(t('Suppliers'))}</button></div>${offlineNote()}<div id="pbody"></div>`;
    seg($('#ptab'), v => { tab = v; history.replaceState(null, '', '#purchasing/' + v); draw(); });
    const sups = () => (S.data.suppliers || []).filter(s => s.business === S.biz);
    const draw = () => {
      document.querySelectorAll('.fab').forEach(x => x.remove());
      const box = $('#pbody'); if (!box) return;
      const owe = sups().reduce((a, s) => a + Math.max(0, num(s.balance)), 0), dep = sups().reduce((a, s) => a + Math.max(0, -num(s.balance)), 0);
      if (tab === 'orders') {
        const all = S.orders || [];
        const l = all.filter(o => filter === 'all' ? true : filter === 'open' ? (o.status === 'DRAFT' || o.status === 'SENT') : o.status === filter);
        box.innerHTML = `<div class="stats"><div class="stat"><div class="lbl">${I('send')}${esc(t('Waiting for delivery'))}</div><div class="val">${all.filter(o => o.status === 'SENT').length}</div></div>
          <div class="stat"><div class="lbl">${I('wallet')}${esc(t('We owe suppliers'))}</div><div class="val ${owe ? 'red' : ''}">${fmt(owe)}</div>${dep ? `<div class="small muted">${esc(t('Deposits paid'))}: ${fmt(dep)}</div>` : ''}</div></div>
          <div class="chips scroll" id="pf" style="margin-bottom:12px">${[['open', t('Open')], ['DRAFT', t('Draft')], ['SENT', t('Sent to supplier')], ['RECEIVED', t('Received')], ['CANCELLED', t('Cancelled')], ['all', t('All')]]
            .map(f => `<button class="chip ${filter === f[0] ? 'on' : ''}" data-v="${f[0]}">${esc(f[1])}</button>`).join('')}</div>
          <div class="list">${l.map(o => { const it = poItems(o), left = num(o.total) - num(o.paid); return `<div class="li tap lead" data-id="${esc(o.id)}"><span class="av ${PST[o.status][1] === 'gray' ? 'gray' : PST[o.status][1]}">${I(PST[o.status][2])}</span>
            <div class="main"><div class="name">${esc(o.supplierName)}</div><div class="sub">${esc(o.poNo)} · ${A.when(o.createdTs)} · ${it.length} ${esc(t('items'))}</div><div style="margin-top:4px"><span class="pill ${PST[o.status][1]}">${esc(t(PST[o.status][0]))}</span></div></div>
            <div class="right"><b>${fmt(o.total)}</b>${o.status !== 'CANCELLED' && left > 0 ? `<div class="small red">${esc(t('Unpaid'))} ${fmt(left)}</div>` : o.status !== 'CANCELLED' ? `<div class="small green">${esc(t('Paid'))}</div>` : ''}</div></div>`; }).join('')
            || `<div class="empty">${I('receipt')}${esc(sups().length ? t('No purchase orders here yet.') : t('Add a supplier first, then make a purchase order.'))}</div>`}</div>`;
        $$('#pf .chip').forEach(c => c.onclick = () => { filter = c.dataset.v; draw(); });
        $$('#pbody .li[data-id]').forEach(r => r.onclick = () => poSheet((S.orders || []).find(o => o.id === r.dataset.id), draw));
        fab(t('New order'), 'plus', () => sups().length ? poForm(null, {}, draw) : supplierForm(null, s => { draw(); poForm(null, { supplierId: s.id }, draw); }));
      } else {
        box.innerHTML = `<div class="stats"><div class="stat"><div class="lbl">${I('wallet')}${esc(t('We owe in total'))}</div><div class="val ${owe ? 'red' : ''}">${fmt(owe)}</div></div>
          <div class="stat"><div class="lbl">${I('truck')}${esc(t('Suppliers'))}</div><div class="val">${sups().length}</div></div></div>
          <div class="list">${sups().map(s => `<div class="li tap lead" data-id="${esc(s.id)}"><span class="av">${esc(String(s.name).slice(0, 1).toUpperCase())}</span><div class="main"><div class="name">${esc(s.name)}</div><div class="sub">${esc(s.phone || t('No phone'))}</div></div>
            <div class="right">${num(s.balance) > 0 ? `<b class="red">${fmt(s.balance)}</b><div class="small muted">${esc(t('We owe'))}</div>` : num(s.balance) < 0 ? `<b class="green">${fmt(-num(s.balance))}</b><div class="small muted">${esc(t('Deposit'))}</div>` : `<span class="pill green">${esc(t('Settled'))}</span>`}</div></div>`).join('')
            || `<div class="empty">${I('truck')}${esc(t('No suppliers yet'))}</div>`}</div>`;
        $$('#pbody .li[data-id]').forEach(r => r.onclick = () => supplierSheet(S.data.suppliers.find(s => s.id === r.dataset.id), draw));
        fab(t('New supplier'), 'plus', () => supplierForm(null, draw));
      }
    };
    draw();
    if (S.online) { const before = JSON.stringify(S.orders); loadOrders().then(() => { if (S.route === 'purchasing' && JSON.stringify(S.orders) !== before && !document.querySelector('.ov')) draw(); }); }
  };
  function supplierForm(s, done) {
    sheet({ title: s ? t('Edit supplier') : t('New supplier'), body: `<form id="f">${input('name', t('Name'), s && s.name, 'autofocus')}${input('phone', t('Phone / WhatsApp (e.g. 252634000000)'), s && s.phone, 'inputmode="tel"')}${input('note', t('Note'), s && s.note)}</form>`,
      actions: [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Save'), cls: 'gold', onClick: async (close, el) => {
        needOnline(); const f = formData($('#f', el)); if (!f.name) throw new Error(t('Name is required'));
        const r = await api('sup.save', Object.assign({ id: s ? s.id : '', business: s ? s.business : S.biz }, f));
        A.upsert('suppliers', r.supplier); close(); toast(t('Saved'), 'ok'); done && done(r.supplier);
      } }] });
  }
  function supplierSheet(s, done) {
    const orders = (S.orders || []).filter(o => o.supplierId === s.id);
    const bal = num(s.balance);
    const sh = sheet({ title: s.name, body: `<div class="totalbox"><div class="u">${esc(bal < 0 ? t('Deposit paid') : t('We owe'))}</div><div class="t">${money(Math.abs(bal))}</div></div>
      <div class="grid2"><button class="btn gold" id="no">${I('plus')}${esc(t('New order'))}</button><button class="btn" id="pay">${I('cash')}${esc(t('Pay supplier'))}</button>
      ${s.phone ? `<a class="btn" href="tel:${esc(s.phone)}">${I('phone')}${esc(t('Call'))}</a><button class="btn" id="wa">${I('chat')}WhatsApp</button>` : ''}<button class="btn ghost" id="ed">${I('edit')}${esc(t('Edit'))}</button></div>
      <h3>${esc(t('Purchase orders'))}</h3><div class="list">${orders.map(o => `<div class="li tap" data-id="${esc(o.id)}"><div class="main"><div class="name">${esc(o.poNo)}</div><div class="sub">${A.when(o.createdTs)} · ${esc(t(PST[o.status][0]))}</div></div><b>${fmt(o.total)}</b></div>`).join('') || `<div class="empty small">—</div>`}</div>
      <h3>${esc(t('Payments and deliveries'))}</h3><div id="led">${skel(2)}</div>` });
    const el = sh.el;
    $('#no', el).onclick = () => { sh.close(); poForm(null, { supplierId: s.id }, done); };
    $('#pay', el).onclick = () => { sh.close(); supPayForm(s, done); };
    $('#ed', el).onclick = () => { sh.close(); supplierForm(s, done); };
    const wa = $('#wa', el); if (wa) wa.onclick = () => A.openWhatsApp(s.phone, t('Hello {n},', { n: s.name }));
    $$('.li[data-id]', el).forEach(r => r.onclick = () => { sh.close(); poSheet(orders.find(o => o.id === r.dataset.id), done); });
    A.cachedCall('sup.ledger', { supplierId: s.id }, r => {
      $('#led', el).innerHTML = `<div class="list">${r.ledger.map(l => { const isPay = l.type === 'payment'; return `<div class="li"><span class="av ${isPay ? 'green' : 'gold'}" style="width:34px;height:34px">${I(isPay ? 'cash' : 'inbox', 'sm')}</span><div class="main"><div class="name">${esc(isPay ? t('Payment') : t('Goods received'))}${l.note ? ' · ' + esc(l.note) : ''}</div>
        <div class="sub">${A.when(l.ts)} · ${esc(l.userName)}${isPay ? ' · ' + esc(A.methodName(l.method)) : ''}</div></div><b class="${isPay ? 'green' : ''}">${isPay ? '−' : '+'}${fmt(l.type === 'purchase' ? num(l.amount) - num(l.paid) : l.amount)}</b></div>`; }).join('') || '<div class="empty small">—</div>'}</div>`;
    }).catch(e => { if ($('#led', el)) $('#led', el).innerHTML = notYet(e); });
  }
  function supPayForm(s, done) {
    sheet({ title: t('Pay {n}', { n: s.name }), body: `<p>${esc(t('We owe'))}: <b>${money(Math.max(0, num(s.balance)))}</b></p>${moneyInput('amount', t('Amount (SH)'), num(s.balance) > 0 ? num(s.balance) : '', 'autofocus')}
      <label class="f"><span>${esc(t('Paid with'))}</span>${methodSeg('method', ['cash', 'zaad', 'edahab'], 'cash')}</label>${input('note', t('Note'), '')}`,
      onOpen: el => seg($('[data-name=method]', el)),
      actions: [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Save payment'), cls: 'gold', onClick: async (close, el) => {
        needOnline(); const amt = num($('[name=amount]', el).value); if (amt <= 0) throw new Error(t('Enter an amount'));
        const r = await api('sup.pay', { id: A.uid('SPY'), supplierId: s.id, amount: amt, method: $('[data-name=method]', el).dataset.value, note: $('[name=note]', el).value });
        A.upsert('suppliers', r.supplier); close(); toast(t('Payment saved'), 'ok'); done && done();
      } }] });
  }
  // item picker shared by purchase orders
  function itemPicker(el, lines, onChange, withCost) {
    const food = S.biz === 'food';
    const pool = () => (food ? (S.data.ingredients || []).map(g => ({ kind: 'i', id: g.id, name: t(g.name) + ' (' + t(g.unit) + ')', cost: g.cost, stock: g.stock, low: g.lowLevel })) : [])
      .concat(prods().map(p => ({ kind: 'p', id: p.id, name: p.name, cost: p.cost, stock: p.stock, low: p.lowStock, barcode: p.barcode })));
    const add = x => { if (!lines.find(l => l.refId === x.id)) lines.push({ kind: x.kind, refId: x.id, name: x.name, qty: 1, cost: num(x.cost) }); draw(); onChange(); };
    el.innerHTML = `<div class="row"><label class="search" style="box-shadow:inset 0 0 0 1px var(--line);background:var(--surface-2)">${I('search', 'sm')}<input id="iq" placeholder="${esc(t('Search item to add'))}"></label><button type="button" class="iconbtn tonal" id="isc">${I('scan')}</button></div><div id="ir" style="margin-top:8px"></div><div id="il" style="margin-top:8px"></div>`;
    $('#iq', el).oninput = () => {
      const v = $('#iq', el).value.toLowerCase();
      const l = v ? pool().filter(x => x.name.toLowerCase().includes(v) || String(x.barcode || '').startsWith(v)).slice(0, 12) : [];
      $('#ir', el).innerHTML = l.length ? `<div class="list">${l.map(x => `<div class="li tap" data-id="${esc(x.id)}"><div class="main name">${esc(x.name)}</div><span class="muted small">${x.kind === 'i' || S.biz === 'shop' ? esc(t('Stock')) + ' ' + fmt(x.stock) : ''}</span>${I('plus', 'sm')}</div>`).join('')}</div>` : '';
      $$('#ir .li', el).forEach(r => r.onclick = () => { add(pool().find(x => x.id === r.dataset.id)); $('#iq', el).value = ''; $('#ir', el).innerHTML = ''; });
    };
    $('#isc', el).onclick = async () => { const c = await A.scanOnce(); if (!c) return; const x = pool().find(y => y.barcode === c); if (x) add(x); else toast(t('Barcode not found: {c}', { c }), 'err'); };
    const draw = () => {
      $('#il', el).innerHTML = lines.length ? `<div class="list">${lines.map((l, i) => `<div class="li" style="align-items:flex-start"><div class="main"><div class="name" style="white-space:normal">${esc(l.name)}</div>
        <div class="row" style="margin-top:8px"><label style="flex:0 0 92px"><span class="small muted">${esc(t('Qty'))}</span><input class="in" data-i="${i}" data-k="qty" value="${l.qty}" inputmode="decimal"></label>
        ${withCost ? `<label class="grow"><span class="small muted">${esc(t('Unit cost'))} (SH)</span><input class="in" data-i="${i}" data-k="cost" value="${l.cost || ''}" inputmode="numeric" placeholder="0"></label>` : ''}</div></div>
        <button type="button" class="iconbtn tonal round" data-del="${i}" aria-label="remove">${I('trash', 'sm')}</button></div>`).join('')}</div>` : `<div class="empty small">${I('box')}${esc(t('No items yet'))}</div>`;
      $$('#il input', el).forEach(inp => inp.oninput = () => { lines[inp.dataset.i][inp.dataset.k] = num(inp.value); onChange(); });
      $$('#il [data-del]', el).forEach(b => b.onclick = () => { lines.splice(b.dataset.del, 1); draw(); onChange(); });
    };
    draw();
    return { add, draw, pool };
  }
  // New / edit purchase order. preset = { supplierId }
  function poForm(po, preset, done) {
    const sups = (S.data.suppliers || []).filter(s => s.business === S.biz);
    const lines = po ? poItems(po).map(x => Object.assign({}, x)) : [];
    let pay = 'credit';
    const sh = sheet({ title: po ? t('Edit') + ' ' + po.poNo : t('New purchase order'), sticky: true, body: `
      <label class="f"><span>${esc(t('Supplier'))}</span><select class="in" id="sp">${sups.map(s => `<option value="${esc(s.id)}" ${(po ? po.supplierId : preset.supplierId) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div class="row" style="justify-content:space-between;margin:4px 4px 8px"><span class="small muted bold">${esc(t('Items to order'))}</span><button type="button" class="btn sm text" id="low">${I('alert', 'sm')}${esc(t('Add low-stock items'))}</button></div>
      <div id="pk"></div>
      <div class="totalbox" style="margin-top:14px"><div class="u">${esc(t('Order total'))}</div><div class="t" id="tot">0</div></div>
      ${po ? '' : `<label class="f"><span>${esc(t('Payment'))}</span><div class="seg tiles4" id="pay" style="grid-template-columns:repeat(3,1fr)">
          <button data-v="credit" class="on">${esc(t('Credit – pay later'))}</button><button data-v="part">${esc(t('Pay part now'))}</button><button data-v="full">${esc(t('Pay all now'))}</button></div></label>
        <div id="paybox" class="hidden">${moneyInput('paid', t('Paid now (SH)'), '')}<label class="f"><span>${esc(t('Paid with'))}</span>${methodSeg('method', ['cash', 'zaad', 'edahab'], 'cash')}</label></div>
        <div class="card tonal" style="padding:4px 14px"><label class="chk"><input type="checkbox" id="rcv"><span class="main"><b>${esc(t('Goods already received'))}</b><div class="small muted">${esc(t('Adds the items to stock now'))}</div></span></label></div>`}
      ${input('terms', t('Payment terms (shown on the order)'), po ? po.terms : '', `placeholder="${esc(t('e.g. Pay in 30 days'))}"`)}${input('notes', t('Note'), po ? po.notes : '')}
      <p class="small muted">${esc(t('Stock goes up only when you mark the order as received.'))}</p>`,
      actions: po ? [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Save'), cls: 'gold', onClick: c => save(c, false) }]
        : [{ label: t('Save draft'), cls: 'ghost', onClick: c => save(c, false) }, { label: t('Save & send'), cls: 'green', icon: 'send', onClick: c => save(c, true) }] });
    const el = sh.el;
    const total = () => lines.reduce((a, l) => a + num(l.qty) * num(l.cost), 0);
    const upd = () => { $('#tot', el).textContent = money(total()); if (pay === 'full' && $('[name=paid]', el)) $('[name=paid]', el).value = total(); };
    const pk = itemPicker($('#pk', el), lines, upd, true);
    $('#low', el).onclick = () => { pk.pool().filter(x => (x.kind === 'i' || S.biz === 'shop') && num(x.stock) <= num(x.low)).forEach(x => { if (!lines.find(l => l.refId === x.id)) lines.push({ kind: x.kind, refId: x.id, name: x.name, qty: Math.max(1, num(x.low) * 2 - num(x.stock)), cost: num(x.cost) }); }); pk.draw(); upd(); if (!lines.length) toast(t('Nothing is low on stock'), 'ok'); };
    if (!po) {
      seg($('#pay', el), v => { pay = v; $('#paybox', el).classList.toggle('hidden', v === 'credit'); $('[name=paid]', el).value = v === 'full' ? total() : ''; if (v === 'part') $('[name=paid]', el).focus(); });
      seg($('[data-name=method]', el));
    }
    upd();
    async function save(close, send) {
      needOnline();
      if (!lines.length) throw new Error(t('Add at least one item'));
      if (!$('#sp', el).value) throw new Error(t('Choose a supplier'));
      const receiveNow = !po && $('#rcv', el).checked;
      const paid = !po && pay !== 'credit' ? num($('[name=paid]', el).value) : 0;
      if (!po && pay !== 'credit' && !(paid > 0)) throw new Error(t('Enter an amount'));
      if (paid > total()) throw new Error(t('Paid amount is more than the order total'));
      let terms = $('[name=terms]', el).value.trim();
      if (!terms && !po) terms = pay === 'credit' ? t('Credit – pay later') : pay === 'full' ? t('Paid in full') : t('Part paid');
      const r = await api('po.save', { id: po ? po.id : A.uid('PO'), isNew: po ? 0 : 1, supplierId: $('#sp', el).value, items: lines, terms, notes: $('[name=notes]', el).value,
        markSent: send ? 1 : 0, payNow: paid, payMethod: !po ? $('[data-name=method]', el).dataset.value : '', receiveNow: receiveNow ? 1 : 0 });
      upsertOrder(r.order); if (r.supplier) A.upsert('suppliers', r.supplier);
      if (receiveNow) await A.refresh(true);
      close(); toast(receiveNow ? t('Saved. Stock updated.') : t('Purchase order saved'), 'ok');
      done && done();
      if (send) sharePo(r.order); else poSheet(r.order, done);
    }
  }
  async function sharePo(o) {
    const items = poItems(o), prices = A.LS.get('poPrices', false);
    const shopName = o.business === 'food' ? setting('foodName') : setting('shopName');
    const sup = (S.data.suppliers || []).find(s => s.id === o.supplierId) || {};
    const blob = await A.makeDocPDF({ title: t('PURCHASE ORDER'), lines: [o.poNo, shopName, setting('shopPhone') ? t('Phone') + ': ' + setting('shopPhone') : '', t('To') + ': ' + o.supplierName, t('Date') + ': ' + String(o.createdTs).slice(0, 10)].filter(Boolean),
      head: prices ? ['#  ' + t('Item'), t('Qty'), t('Unit cost'), t('Total')] : ['#  ' + t('Item'), t('Quantity')], colX: prices ? [0, 760, 950, 1150] : [0, 1150],
      rows: items.map((l, i) => prices ? [(i + 1) + '.  ' + l.name, fmt(l.qty), fmt(l.cost), fmt(num(l.qty) * num(l.cost))] : [(i + 1) + '.  ' + l.name, fmt(l.qty)]),
      footer: [prices ? t('Total') + ': ' + money(o.total) : '', o.terms ? t('Payment terms') + ': ' + o.terms : '', o.notes || '', t('Please confirm price and delivery time.'), t('Thank you') + ' — ' + shopName].filter(Boolean) });
    const text = `*${shopName} — ${t('PURCHASE ORDER')} ${o.poNo}*\n${t('To')}: ${o.supplierName}\n` + items.map((l, i) => `${i + 1}. ${l.name} × ${fmt(l.qty)}` + (prices ? ` @ ${fmt(l.cost)}` : '')).join('\n') + (prices ? `\n${t('Total')}: ${money(o.total)}` : '') + (o.terms ? `\n${t('Payment terms')}: ${o.terms}` : '');
    await A.shareFile(blob, o.poNo + '.pdf', text, sup.phone || '');
  }
  function poSheet(o, done) {
    if (!o) return;
    const items = poItems(o), left = num(o.total) - num(o.paid), st = o.status;
    const acts = [];
    if (st === 'DRAFT' || st === 'SENT') acts.push(['share', 'send', st === 'DRAFT' ? t('Send on WhatsApp') : t('Send again'), 'green']);
    if (st === 'SENT' || st === 'DRAFT') acts.push(['receive', 'inbox', t('Goods received'), 'gold']);
    if (st !== 'CANCELLED' && left > 0) acts.push(['pay', 'cash', t('Pay'), 'primary']);
    if (st === 'RECEIVED' || st === 'CANCELLED') acts.push(['share', 'share', t('Share PDF'), '']);
    if (st === 'DRAFT' || st === 'SENT') acts.push(['edit', 'edit', t('Edit'), '']);
    if ((st === 'DRAFT' || st === 'SENT') && !num(o.paid)) acts.push(['cancel', 'x', t('Cancel order'), 'ghost']);
    const sh = sheet({ title: o.poNo, body: `<div class="row" style="margin-bottom:12px"><span class="av ${PST[st][1] === 'gray' ? 'gray' : PST[st][1]}">${I(PST[st][2])}</span><div class="grow"><b style="font-size:17px">${esc(o.supplierName)}</b>
        <div class="small muted">${esc(t('Made'))} ${A.when(o.createdTs)} · ${esc(o.createdBy)}${o.receivedTs ? ' · ' + esc(t('Received')) + ' ' + A.when(o.receivedTs) : ''}</div></div><span class="pill ${PST[st][1]}">${esc(t(PST[st][0]))}</span></div>
      <div class="card" style="padding:6px 12px"><div class="tblwrap"><table class="tbl"><tr><th>${esc(t('Item'))}</th><th class="n">${esc(t('Qty'))}</th><th class="n">${esc(t('Unit cost'))}</th><th class="n">${esc(t('Total'))}</th></tr>
        ${items.map(l => `<tr><td>${esc(l.name)}</td><td class="n">${fmt(l.qty)}</td><td class="n">${fmt(l.cost)}</td><td class="n">${fmt(num(l.qty) * num(l.cost))}</td></tr>`).join('')}</table></div></div>
      <div class="list"><div class="li"><div class="main name">${esc(t('Order total'))}</div><b>${money(o.total)}</b></div><div class="li"><div class="main name">${esc(t('Paid'))}</div><b class="green">${money(o.paid)}</b></div>
        <div class="li"><div class="main name">${esc(t('Still to pay'))}</div><b class="${left > 0 ? 'red' : ''}">${money(Math.max(0, left))}</b></div></div>
      ${o.terms || o.notes ? `<p class="small muted">${o.terms ? esc(t('Payment terms')) + ': <b>' + esc(o.terms) + '</b><br>' : ''}${esc(o.notes || '')}</p>` : ''}
      ${o.cancelReason ? `<p class="small red">${esc(t('Reason'))}: ${esc(o.cancelReason)}</p>` : ''}
      <div class="card tonal" style="padding:2px 14px;margin-top:4px"><label class="chk"><input type="checkbox" id="pp" ${A.LS.get('poPrices', false) ? 'checked' : ''}><span class="main">${esc(t('Show prices on the order PDF'))}</span></label></div>
      <div class="col">${acts.map(a => `<button class="btn block ${a[3]}" data-a="${a[0]}">${I(a[1])}${esc(a[2])}</button>`).join('')}</div>
      ${st === 'DRAFT' || st === 'SENT' ? `<p class="small muted">${esc(t('Stock goes up only when you mark the order as received.'))}</p>` : ''}` });
    const el = sh.el;
    $('#pp', el).onchange = e => A.LS.set('poPrices', e.target.checked);
    const after = r => { upsertOrder(r.order); if (r.supplier) A.upsert('suppliers', r.supplier); done && done(); };
    $$('[data-a]', el).forEach(b => b.onclick = () => withBusy(b, async () => {
      const a = b.dataset.a;
      if (a === 'share') {
        if (st === 'DRAFT') { needOnline(); const r = await api('po.status', { id: o.id, status: 'SENT' }); after(r); o = r.order; }
        await sharePo(o); sh.close(); if (S.route === 'purchasing') done && done(); return;
      }
      if (a === 'edit') { sh.close(); return poForm(o, {}, done); }
      if (a === 'receive') { sh.close(); return receiveSheet(o, done); }
      if (a === 'pay') { sh.close(); return poPaySheet(o, done); }
      if (a === 'cancel') {
        sh.close();
        sheet({ title: t('Cancel order') + ' ' + o.poNo, body: input('reason', t('Reason'), '', 'autofocus'), actions: [{ label: t('Back'), cls: 'ghost' }, { label: t('Cancel order'), cls: 'red', onClick: async (c, e2) => {
          needOnline(); const r = await api('po.status', { id: o.id, status: 'CANCELLED', reason: $('[name=reason]', e2).value }); after(r); c(); toast(t('Order cancelled'), 'ok');
        } }] });
      }
    }));
  }
  function receiveSheet(o, done) {
    const items = poItems(o);
    sheet({ title: t('Goods received') + ' · ' + o.poNo, sticky: true, body: `<p class="small muted">${esc(t('Check what arrived. Change the quantity or price if it is different from the order.'))}</p>
      <div class="list">${items.map((l, i) => `<div class="li" style="align-items:flex-start"><div class="main"><div class="name" style="white-space:normal">${esc(l.name)}</div><div class="row" style="margin-top:8px">
        <label style="flex:0 0 92px"><span class="small muted">${esc(t('Qty'))}</span><input class="in" data-i="${i}" data-k="qty" value="${l.qty}" inputmode="decimal"></label>
        <label class="grow"><span class="small muted">${esc(t('Unit cost'))} (SH)</span><input class="in" data-i="${i}" data-k="cost" value="${l.cost}" inputmode="numeric"></label></div></div></div>`).join('')}</div>`,
      actions: [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Add to stock'), cls: 'gold', icon: 'inbox', onClick: async (close, el) => {
        needOnline();
        const lines = items.map((l, i) => ({ qty: num($(`[data-i="${i}"][data-k="qty"]`, el).value), cost: num($(`[data-i="${i}"][data-k="cost"]`, el).value) }));
        const r = await api('po.receive', { id: o.id, lines });
        upsertOrder(r.order); if (r.supplier) A.upsert('suppliers', r.supplier); await A.refresh(true);
        close(); toast(t('Saved. Stock updated.'), 'ok'); done && done(); poSheet(r.order, done);
      } }] });
  }
  function poPaySheet(o, done) {
    const left = num(o.total) - num(o.paid);
    sheet({ title: t('Pay') + ' · ' + o.poNo, body: `<p>${esc(t('Still to pay'))}: <b>${money(left)}</b></p>${moneyInput('amount', t('Amount (SH)'), left, 'autofocus')}
      <label class="f"><span>${esc(t('Paid with'))}</span>${methodSeg('method', ['cash', 'zaad', 'edahab'], 'cash')}</label>
      <p class="small muted">${esc(t('The payment is also saved as an expense.'))}</p>`,
      onOpen: el => seg($('[data-name=method]', el)),
      actions: [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Save payment'), cls: 'gold', onClick: async (close, el) => {
        needOnline(); const amt = num($('[name=amount]', el).value); if (amt <= 0) throw new Error(t('Enter an amount'));
        const r = await api('po.pay', { id: o.id, payId: A.uid('PP'), amount: amt, method: $('[data-name=method]', el).dataset.value });
        upsertOrder(r.order); if (r.supplier) A.upsert('suppliers', r.supplier); close(); toast(t('Payment saved'), 'ok'); done && done(); poSheet(r.order, done);
      } }] });
  }

  /* ======================= INGREDIENTS ======================= */
  Screens.ingredients = function (main) {
    if (!(can('ingredients') || can('manageProducts'))) return noPerm(main);
    const list = () => (S.data.ingredients || []);
    main.innerHTML = `
      <div class="grid2" style="margin-bottom:12px"><button class="btn gold lg" id="use">${I('food')}${esc(t('End of day usage'))}</button><button class="btn lg" id="add">${I('plus')}${esc(t('Add stock'))}</button></div>
      <div id="gl"></div>${can('manageProducts') ? `<button class="btn block" id="set">${esc(t('Correct the counts'))}</button>` : ''}<div class="spacer"></div><div id="log"></div>`;
    const draw = () => {
      $('#gl').innerHTML = `<div class="list">${list().map(g => `<div class="li ${can('manageProducts') ? 'tap' : ''}" data-id="${esc(g.id)}"><div class="main"><div class="name">${esc(t(g.name))}</div><div class="sub">${esc(t('Warn at'))} ${fmt(g.lowLevel)} ${esc(t(g.unit))}</div></div>
        <div class="right"><b class="${num(g.stock) <= num(g.lowLevel) ? 'red' : ''}">${fmt(g.stock)}</b> <span class="muted">${esc(t(g.unit))}</span>${num(g.stock) <= num(g.lowLevel) ? `<div><span class="pill red">${esc(t('Low'))}</span></div>` : ''}</div></div>`).join('') || `<div class="empty">—</div>`}</div>`;
      if (can('manageProducts')) $$('#gl .li').forEach(r => r.onclick = () => ingForm(list().find(g => g.id === r.dataset.id), draw));
    };
    const move = (type, title) => sheet({ title, body: `<p class="small muted">${esc(type === 'use' ? t('Enter how much of each was used today. Leave empty if none.') : type === 'add' ? t('Enter how much was bought.') : t('Enter the real amount you have now.'))}</p>
      ${list().map(g => `<label class="f"><span>${esc(t(g.name))} (${esc(t(g.unit))}) · ${esc(t('now'))} ${fmt(g.stock)}</span><input class="in" data-id="${esc(g.id)}" inputmode="decimal"></label>`).join('')}`,
      actions: [{ label: t('Cancel') }, { label: t('Save'), cls: 'gold', onClick: (close, el) => {
        const entries = $$('input[data-id]', el).filter(i => i.value !== '').map(i => ({ ingredientId: i.dataset.id, qty: num(i.value) }));
        if (!entries.length) throw new Error(t('Enter at least one amount'));
        enqueue('ing.move', { id: A.uid('IM'), type, entries });
        entries.forEach(e => { const g = list().find(x => x.id === e.ingredientId); if (g) g.stock = type === 'use' ? num(g.stock) - e.qty : type === 'add' ? num(g.stock) + e.qty : e.qty; });
        A.saveData(); close(); draw(); toast(t('Saved'), 'ok');
        const low = list().filter(g => num(g.stock) <= num(g.lowLevel)).map(g => t(g.name)); if (low.length) setTimeout(() => toast(t('Running low: {x}', { x: low.join(', ') }), 'warn', 6000), 600);
      } }] });
    $('#use').onclick = () => move('use', t('End of day usage'));
    $('#add').onclick = () => move('add', t('Add stock'));
    if ($('#set')) $('#set').onclick = () => move('set', t('Correct the counts'));
    if (can('manageProducts')) fab(t('New ingredient'), 'plus', () => ingForm(null, draw));
    draw();
    A.cachedCall('ing.log', { from: A.addDays(A.today(), -6), to: A.today() }, r => {
      if (!$('#log')) return;
      $('#log').innerHTML = `<h3>${esc(t('Last 7 days'))}</h3><div class="list">${r.logs.slice(0, 40).map(l => `<div class="li"><div class="main"><div class="name">${esc(t(l.name))}</div><div class="sub">${A.when(l.ts)} · ${esc(l.userName)}</div></div>
        <span class="${l.type === 'use' ? 'red' : 'green'}">${esc(t({ use: 'Used', add: 'Added', set: 'Corrected', purchase: 'Bought' }[l.type] || l.type))} ${fmt(l.qty)}</span></div>`).join('') || '<div class="empty">—</div>'}</div>`;
    }).catch(() => {});
  };
  function ingForm(g, done) {
    sheet({ title: g ? t(g.name) : t('New ingredient'), body: `<form id="f">${input('name', t('Name'), g && g.name, 'autofocus')}${input('unit', t('Unit (kg, liters, bags, units…)'), g && g.unit)}
      ${moneyInput('lowLevel', t('Warn when at'), g && g.lowLevel, 'inputmode="decimal"')}${moneyInput('cost', t('Cost per unit (SH)'), g && g.cost)}
      ${!g ? moneyInput('stock', t('Stock now'), '', 'inputmode="decimal"') : `<label class="chk"><input type="checkbox" name="active" ${String(g.active) !== '0' ? 'checked' : ''}><span class="main">${esc(t('Active'))}</span></label>`}</form>`,
      actions: [{ label: t('Cancel') }, { label: t('Save'), cls: 'gold', onClick: async (close, el) => {
        needOnline(); const f = formData($('#f', el));
        await api('ing.save', Object.assign({ id: g ? g.id : '' }, f)); await A.refresh(true); close(); done && done();
      } }] });
  }

  /* ======================= REFUNDS ======================= */
  Screens.refunds = function (main) {
    const approver = can('approveRefunds');
    main.innerHTML = `<button class="btn gold block lg" id="req">${I('undo')}${esc(t('Request a refund'))}</button><div class="spacer"></div>
      ${approver ? `<h3>${esc(t('Waiting for approval'))}</h3><div id="pend"></div>` : ''}<h3>${esc(t('History'))}</h3><div id="hist"></div>`;
    $('#req').onclick = () => refundRequest(load);
    const load = () => A.cachedCall('refund.list', { business: S.biz }, r => {
        if (!$('#hist')) return;
        const card = x => { let items = []; try { items = JSON.parse(x.items || '[]'); } catch (e) {} return `<div class="card" data-id="${esc(x.id)}"><div class="row"><b class="grow">${money(x.amount)} · ${esc(A.methodName(x.method))}</b>
          <span class="pill ${x.status === 'approved' ? 'green' : x.status === 'rejected' ? 'red' : 'gold'}">${esc(t(x.status === 'approved' ? 'Approved' : x.status === 'rejected' ? 'Rejected' : 'Pending'))}</span></div>
          <div class="small">${items.map(i => esc(i.name) + ' ×' + fmt(i.qty)).join(', ')}</div><div class="small muted">${esc(t('Reason'))}: ${esc(x.reason)} · ${esc(x.requestedBy)} · ${A.when(x.ts)}${x.decidedBy ? ' · ' + esc(x.decidedBy) : ''}</div>
          ${x.status === 'pending' && approver ? `<div class="grid2" style="margin-top:8px"><button class="btn red" data-act="0">${esc(t('Reject'))}</button><button class="btn green" data-act="1">${esc(t('Approve'))}</button></div>` : ''}</div>`; };
        if ($('#pend')) $('#pend').innerHTML = r.refunds.filter(x => x.status === 'pending').map(card).join('') || `<div class="card empty">${esc(t('Nothing waiting'))}</div>`;
        $('#hist').innerHTML = r.refunds.filter(x => x.status !== 'pending' || !approver).map(card).join('') || `<div class="card empty">—</div>`;
        S.data.pendingRefunds = r.refunds.filter(x => x.status === 'pending').length; A.updateTop();
        $$('[data-act]').forEach(b => b.onclick = () => withBusy(b, async () => {
          const approve = b.dataset.act === '1';
          if (!(await confirmBox(approve ? t('Approve this refund? Money goes back to the customer and items return to stock.') : t('Reject this refund?')))) return;
          await api('refund.decide', { id: b.closest('[data-id]').dataset.id, approve });
          toast(approve ? t('Refund approved') : t('Refund rejected'), 'ok'); await A.refresh(true); load();
        }));
      }).catch(e => { if ($('#hist') && !$('#hist .card')) $('#hist').innerHTML = notYet(e); });
    load();
  };
  async function refundRequest(done) {
    needOnline();
    await A.syncNow();
    const r = await api('sales.list', { business: S.biz, from: A.addDays(A.today(), -2), to: A.today() });
    const sh = sheet({ title: t('Which sale?'), body: `<input class="in" id="q" placeholder="${esc(t('Search item or customer'))}"><div class="spacer"></div><div id="sl"></div>` });
    const draw = () => {
      const v = $('#q', sh.el).value.toLowerCase();
      const l = r.sales.filter(s => s.status !== 'refunded' && (!v || JSON.stringify(s).toLowerCase().includes(v))).slice(0, 60);
      $('#sl', sh.el).innerHTML = `<div class="list">${l.map(s => `<div class="li tap" data-id="${esc(s.id)}"><div class="main"><div class="name">${money(s.total)} · ${esc(A.methodName(s.method))}${s.customerName ? ' · ' + esc(s.customerName) : ''}</div>
        <div class="sub">${A.when(s.ts)} · ${esc(s.userName)} · ${s.items.map(i => esc(i.name) + ' ×' + fmt(i.qty)).join(', ')}</div></div></div>`).join('') || `<div class="empty">${esc(t('No sales found'))}</div>`}</div>`;
      $$('#sl .li', sh.el).forEach(li => li.onclick = () => { sh.close(); refundItems(r.sales.find(s => s.id === li.dataset.id), done); });
    };
    $('#q', sh.el).oninput = draw; draw();
  }
  function refundItems(sale, done) {
    const q = {}; sale.items.forEach(i => { q[i.productId] = num(i.qty); });
    const sh = sheet({ title: t('Refund') + ' · ' + money(sale.total), body: `<div id="it"></div><label class="f"><span>${esc(t('Reason (required)'))}</span><textarea class="in" name="reason"></textarea></label>
      <p class="small muted">${esc(t('An owner must approve before money or stock changes.'))}</p>`,
      actions: [{ label: t('Cancel') }, { label: t('Send request'), cls: 'gold', onClick: async (close, el) => {
        const reason = $('[name=reason]', el).value.trim(); if (!reason) throw new Error(t('Write a reason'));
        const items = Object.keys(q).filter(k => q[k] > 0).map(k => ({ productId: k, qty: q[k] }));
        if (!items.length) throw new Error(t('Choose at least one item'));
        await api('refund.request', { id: A.uid('RF'), saleId: sale.id, items, reason });
        toast(t('Refund request sent to the owner'), 'ok'); close(); done && done();
      } }] });
    const draw = () => {
      $('#it', sh.el).innerHTML = `<div class="list">${sale.items.map(i => `<div class="li"><div class="main"><div class="name">${esc(i.name)}</div><div class="sub">${fmt(i.price)} · ${esc(t('sold'))} ${fmt(i.qty)}</div></div>
        <div class="qty"><button data-id="${esc(i.productId)}" data-d="-1">−</button><b>${q[i.productId]}</b><button data-id="${esc(i.productId)}" data-d="1">+</button></div></div>`).join('')}</div>`;
      $$('#it .qty button', sh.el).forEach(b => b.onclick = () => { const it = sale.items.find(i => i.productId === b.dataset.id); q[b.dataset.id] = Math.max(0, Math.min(num(it.qty), q[b.dataset.id] + num(b.dataset.d))); draw(); });
    };
    draw();
  }

  /* ======================= USERS ======================= */
  const PERM_LABELS = {
    viewReports: 'See dashboard and reports', viewProfit: 'See cost and profit', viewStock: 'See stock quantities', changePrices: 'Change prices',
    manageProducts: 'Add and edit products and ingredients', discount: 'Give discounts', customers: 'Credit customers and debt payments', suppliers: 'Suppliers and purchases',
    expenses: 'Record expenses', ingredients: 'Enter ingredient usage', stockCount: 'Do stock counts', approveRefunds: 'Approve refunds',
    manageUsers: 'Manage users and PINs', settings: 'Change settings', export: 'Export data (CSV)', audit: 'See the audit log'
  };
  Screens.users = function (main) {
    if (!can('manageUsers')) return noPerm(main);
    main.innerHTML = `<div id="ul">${skel(3)}</div>`;
    const load = () => A.cachedCall('users.list', {}, r => {
        if (!$('#ul')) return;
        $('#ul').innerHTML = `<div class="list">${r.users.map(u => `<div class="li tap lead" data-id="${esc(u.id)}"><span class="av ${u.role === 'owner' ? 'gold' : ''}">${esc(String(u.name).slice(0, 1).toUpperCase())}</span><div class="main"><div class="name">${esc(u.name)} ${u.active ? '' : `<span class="pill red">${esc(t('Disabled'))}</span>`}</div>
          <div class="sub">${esc(u.role === 'owner' ? t('Owner') : t('Employee'))} · ${esc(A.bizName(u.business))} · ${u.lang === 'en' ? 'English' : 'Soomaali'}${u.afterHours ? ' · ' + esc(t('after hours')) : ''}</div></div>${I('right', 'sm chev')}</div>`).join('')}</div>`;
        $$('#ul .li').forEach(li => li.onclick = () => userForm(r.users.find(u => u.id === li.dataset.id), r.perms, load));
        fab(t('New user'), 'plus', () => userForm(null, r.perms, load));
      }).catch(e => { if ($('#ul') && !$('#ul .list')) $('#ul').innerHTML = notYet(e); });
    load();
  };
  function showPin(name, pin) {
    A.alertBox(t('PIN for {n}', { n: name }), `<div class="totalbox"><div class="u">${esc(t('Give this PIN to {n}. It is shown only once.', { n: name }))}</div><div class="t" style="letter-spacing:8px">${esc(pin)}</div></div>
      <p class="small muted">${esc(t('They can change it in More → My PIN.'))}</p>`);
  }
  function userForm(u, perms, done) {
    u = u || { role: 'employee', business: S.biz, lang: 'so', afterHours: false, active: true, perms: ['viewStock', 'customers', 'expenses', 'ingredients'] };
    const isNew = !u.id;
    const sh = sheet({ title: isNew ? t('New user') : u.name, body: `<form id="f">${input('name', t('Name'), u.name, 'autofocus')}
      <label class="f"><span>${esc(t('Role'))}</span><div class="seg" data-name="role"><button data-v="employee" class="${u.role !== 'owner' ? 'on' : ''}">${esc(t('Employee'))}</button><button data-v="owner" class="${u.role === 'owner' ? 'on' : ''}">${esc(t('Owner'))}</button></div></label>
      <div id="empOnly"><label class="f"><span>${esc(t('Works at'))}</span><div class="seg" data-name="business"><button data-v="shop" class="${u.business !== 'food' ? 'on' : ''}">${esc(t('Shop'))}</button><button data-v="food" class="${u.business === 'food' ? 'on' : ''}">${esc(t('Fast Food'))}</button></div></label>
        <label class="chk"><input type="checkbox" name="afterHours" ${u.afterHours ? 'checked' : ''}><span class="main">${esc(t('Can use the app outside shift hours'))}</span></label>
        <h3 style="margin-top:12px">${esc(t('Permissions'))}</h3>${perms.map(p => `<label class="chk"><input type="checkbox" data-perm="${p}" ${u.perms.indexOf(p) >= 0 ? 'checked' : ''}><span class="main">${esc(t(PERM_LABELS[p] || p))}</span></label>`).join('')}</div>
      <p id="ownerNote" class="small muted">${esc(t('Owners can do everything in both businesses.'))}</p>
      <label class="f" style="margin-top:12px"><span>${esc(t('Language'))}</span><div class="seg" data-name="lang"><button data-v="so" class="${u.lang !== 'en' ? 'on' : ''}">Soomaali</button><button data-v="en" class="${u.lang === 'en' ? 'on' : ''}">English</button></div></label>
      ${!isNew ? `<label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}><span class="main">${esc(t('Account active'))}</span></label><div class="spacer"></div><button type="button" class="btn block" id="rp">${I('key')}${esc(t('Make a new PIN'))}</button>` : ''}
      ${isNew ? `<p class="small muted">${esc(t('A PIN is created automatically and shown after saving.'))}</p>` : ''}</form>`,
      actions: [{ label: t('Cancel') }, { label: t('Save'), cls: 'gold', onClick: async (close, el) => {
        const f = formData($('#f', el));
        const d = { id: u.id || '', name: f.name, role: $('[data-name=role]', el).dataset.value, business: $('[data-name=business]', el).dataset.value, lang: $('[data-name=lang]', el).dataset.value,
          afterHours: f.afterHours, perms: $$('[data-perm]', el).filter(c => c.checked).map(c => c.dataset.perm) };
        if (!isNew) d.active = f.active ? 1 : 0;
        const r = await api('users.save', d); close(); toast(t('Saved'), 'ok');
        if (r.pin) showPin(r.user.name, r.pin);
        if (r.user.id === S.user.id) await A.refresh(true);
        done && done();
      } }] });
    const el = sh.el;
    const roleUI = v => { $('#empOnly', el).classList.toggle('hidden', v === 'owner'); $('#ownerNote', el).classList.toggle('hidden', v !== 'owner'); };
    seg($('[data-name=role]', el), roleUI); seg($('[data-name=business]', el)); seg($('[data-name=lang]', el)); roleUI(u.role);
    if ($('#rp', el)) $('#rp', el).onclick = () => withBusy($('#rp', el), async () => {
      if (!(await confirmBox(t('Make a new PIN for {n}? The old PIN stops working.', { n: u.name })))) return;
      const r = await api('users.resetPin', { id: u.id }); sh.close(); showPin(u.name, r.pin);
    });
  }

  /* ======================= SETTINGS ======================= */
  Screens.settings = function (main) {
    if (!can('settings')) return noPerm(main);
    const s = S.data.settings;
    const on = k => s[k] === '1' ? 'checked' : '';
    let types = String(s.food_orderTypes || '').split(',').map(x => x.trim()).filter(Boolean);
    main.innerHTML = `<div class="card navy row" style="align-items:center"><span class="av" style="background:rgba(255,255,255,.15);color:#fff">${I('install')}</span>
        <div class="grow"><b>${esc(t('Install the app'))}</b><div class="small muted">${esc(A.isStandalone() ? t('Installed on this phone') : t('Add Saado POS to your home screen'))}</div></div>
        <button class="btn gold sm" id="inst">${I('download')}${esc(t('Install'))}</button></div><form id="f">
      <div class="card"><h3>${esc(t('Money'))}</h3><div class="grid2">${moneyInput('usdRate', t('1 USD = ? SH'), s.usdRate)}${moneyInput('roundStep', t('Round totals to nearest (SH)'), s.roundStep)}</div></div>
      <div class="card"><h3>${esc(t('Zaad and Edahab accounts'))}</h3><div class="grid2">${input('shop_zaad', t('Shop Zaad'), s.shop_zaad, 'inputmode="numeric"')}${input('shop_edahab', t('Shop Edahab'), s.shop_edahab, 'inputmode="numeric"')}
        ${input('food_zaad', t('Fast Food Zaad'), s.food_zaad, 'inputmode="numeric"')}${input('food_edahab', t('Fast Food Edahab'), s.food_edahab, 'inputmode="numeric"')}</div></div>
      <div class="card"><h3>${esc(t('Selling rules'))}</h3>
        <label class="chk"><input type="checkbox" name="shop_credit" ${on('shop_credit')}><span class="main">${esc(t('Allow credit sales in the Shop'))}</span></label>
        <label class="chk"><input type="checkbox" name="food_credit" ${on('food_credit')}><span class="main">${esc(t('Allow credit sales in Fast Food'))}</span></label>
        <label class="chk"><input type="checkbox" name="requireShift" ${on('requireShift')}><span class="main">${esc(t('Require an open shift before selling'))}</span></label>
        <div class="spacer"></div>${input('expenseCats', t('Expense categories (comma separated)'), s.expenseCats)}
        <div class="grid2">${moneyInput('defaultLowStock', t('Default low-stock level'), s.defaultLowStock)}${moneyInput('expiryWarnDays', t('Warn days before expiry'), s.expiryWarnDays)}</div></div>
      <div class="card"><h3>${esc(t('Fast Food'))}</h3><label class="f"><span>${esc(t('Order types'))}</span><div class="chips" id="ot"></div></label>
        <div class="row"><input class="in grow" id="otn" placeholder="${esc(t('New order type, e.g. Delivery'))}"><button type="button" class="iconbtn tonal" id="ota">${I('plus')}</button></div><div class="spacer"></div>
        <div class="grid2"><label class="f"><span>${esc(t('Opens'))}</span><input class="in" type="time" name="food_open" value="${esc(s.food_open)}"></label><label class="f"><span>${esc(t('Closes'))}</span><input class="in" type="time" name="food_close" value="${esc(s.food_close)}"></label></div></div>
      <div class="card"><h3>${esc(t('Shop hours'))}</h3>${input('shop_hours', t('Shifts (e.g. 08:00-13:00,16:00-23:00)'), s.shop_hours)}${moneyInput('graceMin', t('Minutes allowed before/after hours'), s.graceMin)}</div>
      <div class="card"><h3>${esc(t('Names and phones'))}</h3>${input('shopName', t('Shop name'), s.shopName)}${input('foodName', t('Fast Food name'), s.foodName)}
        ${input('shopPhone', t('Phone shown on supplier orders'), s.shopPhone, 'inputmode="tel"')}${input('ownerWhatsApp', t('WhatsApp number for daily summary (e.g. 252634000000)'), s.ownerWhatsApp, 'inputmode="tel"')}</div>
      <button class="btn gold block lg">${esc(t('Save settings'))}</button></form>
      ${isOwner() ? `<div class="card" style="margin-top:12px"><h3>${esc(t('Backup'))}</h3><p class="small muted">${esc(t('A copy of the Sheet is saved to Google Drive every night (folder "Saado POS Backups"). You can also make one now.'))}</p><button class="btn block" id="bk">${esc(t('Back up now'))}</button></div>` : ''}`;
    const drawTypes = () => { $('#ot').innerHTML = types.map((x, i) => `<button type="button" class="chip on" data-i="${i}">${esc(t(x))} ${I('x', 'sm')}</button>`).join('') || `<span class="muted">—</span>`; $$('#ot .chip').forEach(c => c.onclick = () => { if (types.length > 1) { types.splice(c.dataset.i, 1); drawTypes(); } else toast(t('Keep at least one order type'), 'warn'); }); };
    $('#ota').onclick = () => { const v = $('#otn').value.trim().replace(/,/g, ' '); if (v && types.indexOf(v) < 0) { types.push(v); $('#otn').value = ''; drawTypes(); } };
    drawTypes();
    $('#f').onsubmit = e => {
      e.preventDefault();
      withBusy(e.target.querySelector('button.gold.lg'), async () => {
        needOnline(); const f = formData(e.target), values = {};
        Object.keys(f).forEach(k => { values[k] = typeof f[k] === 'boolean' ? (f[k] ? '1' : '0') : f[k]; });
        values.food_orderTypes = types.join(',');
        const r = await api('settings.save', { values });
        S.data.settings = r.settings; A.saveData(); toast(t('Settings saved'), 'ok');
      });
    };
    $('#inst').onclick = () => A.installApp();
    if ($('#bk')) $('#bk').onclick = e => withBusy(e.target, async () => { needOnline(); const r = await api('backup.now', {}); toast(t('Backup saved: {n}', { n: r.name }), 'ok', 5000); });
  };

  /* ======================= AUDIT, EXPORT, SYNC, PIN ======================= */
  Screens.audit = function (main) {
    if (!can('audit')) return noPerm(main);
    main.innerHTML = `<div class="card"><div class="grid2"><label class="f"><span>${esc(t('From'))}</span><input class="in" type="date" id="af" value="${A.addDays(A.today(), -2)}"></label>
      <label class="f"><span>${esc(t('To'))}</span><input class="in" type="date" id="at" value="${A.today()}"></label></div><input class="in" id="aq" placeholder="${esc(t('Search (name, action, item)'))}"></div><div id="al"></div>`;
    let timer;
    const load = () => A.cachedCall('audit.list', { from: $('#af').value, to: $('#at').value, q: $('#aq').value }, r => {
        if ($('#al')) $('#al').innerHTML = `<div class="list">${r.audit.map(a => `<div class="li"><div class="main"><div class="name">${esc(a.action)} <span class="muted small">· ${esc(a.userName)}</span></div><div class="sub" style="word-break:break-word">${esc(String(a.details).slice(0, 300))}</div></div><span class="small muted">${A.when(a.ts)}</span></div>`).join('') || '<div class="empty">—</div>'}</div>`;
      }).catch(e => { if ($('#al')) $('#al').innerHTML = notYet(e); });
    $('#af').onchange = $('#at').onchange = load; $('#aq').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    load();
  };
  Screens.sync = function (main) {
    const mine = S.queue.filter(o => o.userId === S.user.id), others = S.queue.filter(o => o.userId !== S.user.id);
    const label = o => ({ 'sale.create': t('Sale'), 'cust.pay': t('Debt payment'), 'cust.save': t('New customer'), 'exp.create': t('Expense'), 'shift.open': t('Start shift'), 'ing.move': t('Ingredients') }[o.action] || o.action) +
      (o.action === 'sale.create' ? ' · ' + (o.data.items || []).length + ' ' + t('items') : o.data.amount ? ' · ' + fmt(o.data.amount) : '');
    main.innerHTML = `<div class="card ${S.online ? '' : 'alert'}"><b class="row" style="gap:8px">${S.online ? I('okcircle') + esc(t('Online')) : I('wifioff') + esc(t('Offline'))}</b>
      <div class="small muted">${esc(t('Sales and payments are saved on this phone first, then sent to the Sheet automatically.'))}</div></div>
      <h3>${esc(t('Waiting to send'))} (${mine.length})</h3><div class="list">${mine.map(o => `<div class="li"><div class="main"><div class="name">${esc(label(o))}</div><div class="sub">${A.when(A.localParts(new Date(o.ts)).date + 'T' + A.localParts(new Date(o.ts)).time)}</div></div>${I('clock', 'sm')}</div>`).join('') || `<div class="empty">${I('okcircle')}${esc(t('Everything is sent'))}</div>`}</div>
      ${mine.length ? `<button class="btn primary block" id="snd">${esc(t('Send now'))}</button><div class="spacer"></div>` : ''}
      ${others.length ? `<div class="card alert amber small">${esc(t('{n} items from {u} are waiting. {u} must log in on this phone to send them.', { n: others.length, u: Array.from(new Set(others.map(o => o.userName))).join(', ') }))}</div>` : ''}
      ${S.failed.length ? `<h3 class="red">${esc(t('Failed (not saved)'))}</h3><div class="list">${S.failed.map((o, i) => `<div class="li"><div class="main"><div class="name">${esc(label(o))} · ${esc(o.userName)}</div><div class="sub red">${esc(A.friendly(o.error))}</div></div>
        <div class="col"><button class="btn sm" data-retry="${i}">${esc(t('Retry'))}</button><button class="btn sm ghost" data-drop="${i}">${esc(t('Remove'))}</button></div></div>`).join('')}</div>` : ''}`;
    if ($('#snd')) $('#snd').onclick = e => withBusy(e.target, async () => { await A.syncNow(); A.render(); });
    $$('[data-retry]').forEach(b => b.onclick = () => { const o = S.failed.splice(b.dataset.retry, 1)[0]; delete o.error; S.queue.push(o); A.LS.set('failed', S.failed); A.LS.set('queue', S.queue); A.syncNow().then(() => A.render()); });
    $$('[data-drop]').forEach(b => b.onclick = async () => { if (await confirmBox(t('Remove this item? It will not be saved.'), t('Remove'), 'red')) { S.failed.splice(b.dataset.drop, 1); A.LS.set('failed', S.failed); A.updateTop(); A.render(); } });
  };
  Screens.onSync = function () { if (S.route === 'sync' && !document.querySelector('.ov')) A.render(); };
  Screens.pin = function (main) {
    main.innerHTML = `<div class="card"><form id="f">${input('oldPin', t('Current PIN'), '', 'type="password" inputmode="numeric" autocomplete="off"')}
      ${input('newPin', t('New PIN (4–6 digits)'), '', 'type="password" inputmode="numeric" autocomplete="off"')}${input('newPin2', t('New PIN again'), '', 'type="password" inputmode="numeric" autocomplete="off"')}
      <button class="btn gold block lg">${esc(t('Change PIN'))}</button></form></div>`;
    $('#f').onsubmit = e => {
      e.preventDefault();
      withBusy(e.target.querySelector('button'), async () => {
        needOnline(); const f = formData(e.target);
        if (f.newPin !== f.newPin2) throw new Error(t('The two new PINs are different'));
        await api('me.changePin', { oldPin: f.oldPin, newPin: f.newPin });
        A.rememberPin(S.user.id, f.newPin).catch(() => {});
        S.user.pinChanged = true; toast(t('PIN changed'), 'ok'); go('more');
      });
    };
  };

  function noPerm(main) { main.innerHTML = `<div class="card empty">${I('lock')}${esc(t('You do not have permission for this.'))}</div>`; }
  Screens.productForm = productForm;
})();
