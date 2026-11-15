/**
 * Saado POS — all screens (each is a function that draws into #main).
 * Sell, Shift, Customers, Expenses, Home (owner dashboard), Reports, Products (+ import/export), Stock count,
 * Suppliers (purchases, payments, WhatsApp order PDF), Ingredients, Refunds, Users, Settings, Audit, Export, Sync, PIN.
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
  const head = (title, right) => `<div class="row" style="margin-bottom:10px"><h2 class="grow" style="margin:0">${esc(title)}</h2>${right || ''}</div>`;
  const needOnline = () => { if (!S.online) throw new Error(t('This needs internet. Try again when online.')); };
  const neg = v => num(v) ? '−' + fmt(v) : '0';
  const offlineNote = () => S.online ? '' : `<div class="card alert amber small">${esc(t('You are offline. This list may be old.'))}</div>`;

  /* ======================= SELL ======================= */
  Screens.sell = function (main) {
    const shift = myShift();
    const needShift = setting('requireShift') === '1' && !shift;
    main.innerHTML = `
      ${needShift ? `<div class="card alert amber row"><div class="grow"><b>${esc(t('No open shift'))}</b><div class="small muted">${esc(t('Start a shift before selling.'))}</div></div><button class="btn gold" id="goShift">${esc(t('Start shift'))}</button></div>` : ''}
      <div class="searchbar"><input class="in" id="q" type="search" placeholder="${esc(t('Search or scan barcode'))}" autocomplete="off" enterkeyhint="search">
        <button class="iconbtn gold" id="scanBtn" aria-label="scan">📷</button></div>
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
    bar.innerHTML = `<div class="inner"><button class="sum" id="openCart"><b>${money(tt.total)}</b><span>${tt.count} ${esc(t('items'))} · ${usd(tt.total)} · ${esc(t('tap to see cart'))}</span></button>
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
    box.innerHTML = mine.map(p => `<button class="chip" data-id="${p.id}">⏸ ${esc(p.time)} · ${fmt(p.total)}</button>`).join('');
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
          ${can('customers') ? `<button class="btn gold" id="newc">＋</button>` : ''}</div></label><div class="list" id="clist" style="max-height:240px;overflow:auto"></div>`;
        const draw = () => {
          const v = $('#cq', el).value.toLowerCase();
          const l = list.filter(c => !v || String(c.name).toLowerCase().includes(v) || String(c.phone).includes(v)).slice(0, 40);
          $('#clist', el).innerHTML = l.map(c => `<div class="li tap" data-id="${esc(c.id)}" style="${st.customerId === c.id ? 'background:#fff4cc' : ''}"><div class="main"><div class="name">${st.customerId === c.id ? '✓ ' : ''}${esc(c.name)}</div><div class="sub">${esc(c.phone || '')}</div></div><span class="${num(c.balance) > 0 ? 'red' : ''}">${fmt(c.balance)}</span></div>`).join('') || `<div class="empty">${esc(t('No customers yet'))}</div>`;
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
      main.innerHTML = head(t('Shift') + ' · ' + bizLabel()) + `<div class="card"><h3>${esc(t('Start shift'))}</h3><p class="small muted">${esc(t('Count the money before you start.'))}</p>
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
      main.innerHTML = head(t('Shift') + ' · ' + bizLabel(), `<span class="pill green">${esc(t('Open'))}</span>`) + `
        <div class="card navy"><h3>${esc(t('Started'))} ${A.when(sh.openTs)}</h3><div class="grid2 small">
          <div>${esc(t('Opening cash'))}<br><b>${money(sh.openCash)}</b></div><div>Zaad<br><b>${fmt(sh.openZaadSH)} SH + $${fmt(sh.openZaadUSD)}</b></div>
          <div>Edahab<br><b>${fmt(sh.openEdSH)} SH + $${fmt(sh.openEdUSD)}</b></div></div></div>
        <div id="live" class="card"><div class="muted">${esc(t('Loading totals…'))}</div></div>
        <div class="card"><h3>${esc(t('End shift'))}</h3><p class="small muted">${esc(t('Count the money now and enter what you have.'))}</p>
          <form id="cf">${amountFields('close')}<label class="f"><span>${esc(t('Note'))}</span><input class="in" name="note"></label>
          <button class="btn red block lg">${esc(t('End shift'))}</button></form></div>`;
      loadLive(sh);
      $('#cf').onsubmit = e => { e.preventDefault(); withBusy(e.target.querySelector('button'), () => closeShift(sh, formData(e.target))); };
    }
    if (isOwner() || can('viewReports')) loadShiftHistory();
  };
  async function loadLive(sh) {
    const box = $('#live');
    try {
      await A.syncNow();
      if (S.queue.some(o => o.data && o.data.id === sh.id)) { box.innerHTML = `<div class="muted">${esc(t('Waiting for internet to show totals.'))}</div>`; return; }
      const r = await api('shift.preview', { id: sh.id });
      const x = r.totals;
      if (!$('#live')) return;
      box.innerHTML = `<h3>${esc(t('So far in this shift'))} (${x.saleCount} ${esc(t('sales'))})</h3><table class="tbl">
        <tr><td>${esc(t('Cash sales'))}</td><td class="n">${fmt(x.cashSales)}</td></tr><tr><td>Zaad</td><td class="n">${fmt(x.zaadSales)}</td></tr>
        <tr><td>Edahab</td><td class="n">${fmt(x.edSales)}</td></tr><tr><td>${esc(t('Credit'))}</td><td class="n">${fmt(x.creditSales)}</td></tr>
        <tr><td>${esc(t('Customer payments (cash)'))}</td><td class="n">${fmt(x.custPayCash)}</td></tr><tr><td>${esc(t('Expenses (cash)'))}</td><td class="n">${neg(x.expCash)}</td></tr>
        <tr><td>${esc(t('Refunds (cash)'))}</td><td class="n">${neg(x.refCash)}</td></tr>
        <tr><td><b>${esc(t('Expected cash'))}</b></td><td class="n"><b>${money(x.expectedCash)}</b></td></tr>
        <tr><td>${esc(t('Expected Zaad'))}</td><td class="n">${money(x.expectedZaad)}</td></tr><tr><td>${esc(t('Expected Edahab'))}</td><td class="n">${money(x.expectedEd)}</td></tr></table>`;
    } catch (e) { if ($('#live')) box.innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
  }
  async function closeShift(sh, f) {
    needOnline();
    await A.syncNow();
    if (S.queue.some(o => o.userId === S.user.id)) throw new Error(t('Some sales are not sent yet. Connect to the internet and try again.'));
    if (!(await confirmBox(t('End the shift now?'), t('End shift'), 'red'))) return;
    const r = await api('shift.close', { id: sh.id, closeCash: num(f.closeCash), closeZaadSH: num(f.closeZaadSH), closeZaadUSD: num(f.closeZaadUSD), closeEdSH: num(f.closeEdSH), closeEdUSD: num(f.closeEdUSD), note: f.note });
    A.upsert('shifts', r.shift);
    shiftResult(r.shift);
    go('shift');
  }
  function diffTxt(d) { d = Math.round(num(d)); return d === 0 ? `<span class="green bold">✓ ${esc(t('Correct'))}</span>` : d > 0 ? `<span class="amber bold">+${fmt(d)} ${esc(t('extra'))}</span>` : `<span class="red bold">${fmt(d)} ${esc(t('short'))}</span>`; }
  function shiftResult(s) {
    A.alertBox(t('Shift ended'), `<table class="tbl"><tr><th></th><th class="n">${esc(t('Expected'))}</th><th class="n">${esc(t('Counted'))}</th><th class="n">${esc(t('Difference'))}</th></tr>
      <tr><td>${esc(t('Cash'))}</td><td class="n">${fmt(s.expectedCash)}</td><td class="n">${fmt(s.closeCash)}</td><td class="n">${diffTxt(s.diffCash)}</td></tr>
      <tr><td>Zaad</td><td class="n">${fmt(s.expectedZaad)}</td><td class="n">${fmt(num(s.closeZaadSH) + num(s.closeZaadUSD) * num(s.rate))}</td><td class="n">${diffTxt(s.diffZaad)}</td></tr>
      <tr><td>Edahab</td><td class="n">${fmt(s.expectedEd)}</td><td class="n">${fmt(num(s.closeEdSH) + num(s.closeEdUSD) * num(s.rate))}</td><td class="n">${diffTxt(s.diffEd)}</td></tr></table>
      <p class="small muted">${esc(t('USD is counted at {r} SH.', { r: fmt(s.rate) }))}</p>`);
  }
  async function loadShiftHistory() {
    const box = $('#hist') || (() => { const d = document.createElement('div'); d.id = 'hist'; $('#main').appendChild(d); return d; })();
    if (!S.online) return;
    try {
      const r = await api('shift.list', { business: S.biz, from: A.addDays(A.today(), -7), to: A.today() });
      if (!$('#hist')) return;
      box.innerHTML = `<h3>${esc(t('Recent shifts'))}</h3><div class="list">${r.shifts.map(s => `<div class="li tap" data-id="${esc(s.id)}"><div class="main"><div class="name">${esc(s.userName)} · ${A.when(s.openTs)}</div>
        <div class="sub">${s.status === 'open' ? esc(t('Open')) : esc(t('Cash')) + ' ' + fmt(s.closeCash)}</div></div>${s.status === 'closed' ? diffTxt(s.diffCash) : '<span class="pill green">' + esc(t('Open')) + '</span>'}</div>`).join('') || `<div class="empty">${esc(t('No shifts'))}</div>`}</div>`;
      $$('.li', box).forEach(li => li.onclick = () => { const s = r.shifts.find(x => x.id === li.dataset.id); if (s.status === 'closed') shiftResult(s); });
    } catch (e) {}
  }

  /* ======================= CUSTOMERS ======================= */
  Screens.customers = function (main) {
    if (!can('customers')) return noPerm(main);
    const list = () => (S.data.customers || []).filter(c => c.business === S.biz);
    main.innerHTML = head(t('Credit customers') + ' · ' + bizLabel(), `<button class="btn gold" id="nc">＋ ${esc(t('New'))}</button>`) +
      (setting(S.biz + '_credit') !== '1' ? `<div class="card alert amber small">${esc(t('Credit sales are turned off for this business (Settings).'))}</div>` : '') +
      `<div class="searchbar"><input class="in" id="q" type="search" placeholder="${esc(t('Search name or phone'))}"></div>
      <div class="stats"><div class="stat"><div class="lbl">${esc(t('Total owed to us'))}</div><div class="val" id="tot"></div></div><div class="stat"><div class="lbl">${esc(t('Customers'))}</div><div class="val" id="cnt"></div></div></div>
      <div id="cl"></div>`;
    const draw = () => {
      const v = $('#q').value.toLowerCase();
      const l = list().filter(c => !v || String(c.name).toLowerCase().includes(v) || String(c.phone).includes(v)).sort((a, b) => num(b.balance) - num(a.balance));
      $('#tot').textContent = fmt(list().reduce((a, c) => a + Math.max(0, num(c.balance)), 0)); $('#cnt').textContent = list().length;
      $('#cl').innerHTML = `<div class="list">${l.map(c => `<div class="li tap" data-id="${esc(c.id)}"><div class="main"><div class="name">${esc(c.name)}</div><div class="sub">${esc(c.phone || '')}</div></div>
        <b class="${num(c.balance) > 0 ? 'red' : 'green'}">${fmt(c.balance)}</b></div>`).join('') || `<div class="empty">${esc(t('No customers yet'))}</div>`}</div>`;
      $$('#cl .li').forEach(r => r.onclick = () => customerSheet(r.dataset.id, draw));
    };
    $('#q').oninput = draw; $('#nc').onclick = () => customerForm(null, draw); draw();
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
      <div class="grid2"><button class="btn gold" id="pay">💵 ${esc(t('Receive payment'))}</button><button class="btn" id="ed">✏️ ${esc(t('Edit'))}</button>
      ${c.phone ? `<a class="btn" href="tel:${esc(c.phone)}">📞 ${esc(t('Call'))}</a><button class="btn" id="wa">💬 WhatsApp</button>` : ''}</div>
      <div class="spacer"></div><h3>${esc(t('History'))}</h3><div id="led" class="muted">${esc(t('Loading…'))}</div>` });
    const el = sh.el;
    $('#pay', el).onclick = () => { sh.close(); paymentForm(c, redraw); };
    $('#ed', el).onclick = () => { sh.close(); customerForm(c, redraw); };
    const wa = $('#wa', el); if (wa) wa.onclick = () => A.openWhatsApp(c.phone, t('Hello {n}, your balance at {b} is {x}. Thank you.', { n: c.name, b: biz, x: money(c.balance) }));
    if (!S.online) { $('#led', el).textContent = t('History needs internet.'); return; }
    api('cust.ledger', { customerId: c.id }).then(r => {
      $('#led', el).innerHTML = `<div class="list">${r.ledger.map(l => `<div class="li"><div class="main"><div class="name">${esc(t(l.type === 'sale' ? 'Credit sale' : l.type === 'payment' ? 'Payment' : 'Refund'))}</div>
        <div class="sub">${A.when(l.ts)} · ${esc(l.userName)} ${l.method && l.type === 'payment' ? '· ' + esc(A.methodName(l.method)) : ''}</div></div><b class="${l.type === 'sale' ? 'red' : 'green'}">${l.type === 'sale' ? '+' : '−'}${fmt(l.amount)}</b></div>`).join('') || `<div class="empty">—</div>`}</div>`;
    }).catch(e => { $('#led', el).textContent = e.message; });
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
    main.innerHTML = head(t('Expenses') + ' · ' + bizLabel()) + `<div class="card"><form id="f">
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
    const box = $('#el'); if (!box) return;
    let list = (S.localExp || []).filter(e => e.business === S.biz && S.queue.some(o => o.data && o.data.id === e.id));
    try { if (S.online) { const r = await api('exp.list', { business: S.biz, from: A.today(), to: A.today() }); list = list.concat(r.expenses); } } catch (e) {}
    if (!$('#el')) return;
    box.innerHTML = `<h3>${esc(t('Today'))}</h3><div class="list">${list.map(e => `<div class="li"><div class="main"><div class="name">${esc(t(e.category))}</div><div class="sub">${esc(A.methodName(e.method))} · ${esc(e.userName || '')} ${esc(e.note || '')} ${e.pending ? '· ⏳' : ''}</div></div><b>${fmt(e.amount)}</b></div>`).join('') || `<div class="empty">${esc(t('No expenses today'))}</div>`}</div>`;
  }

  /* ======================= HOME (dashboard) ======================= */
  Screens.home = function (main) {
    if (!can('viewReports')) return go('sell');
    const bizs = A.myBiz();
    let sel = S.homeBiz || (bizs.length > 1 ? 'all' : bizs[0]);
    main.innerHTML = `<div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">${esc(t('Today'))}</h2><span class="muted">${A.today()}</span></div>
      ${bizs.length > 1 ? `<div class="chips" id="hb" style="margin-bottom:10px">${['all', 'shop', 'food'].map(b => `<button class="chip ${sel === b ? 'on' : ''}" data-v="${b}">${esc(b === 'all' ? t('Shop + Fast Food') : A.bizName(b))}</button>`).join('')}</div>` : ''}
      <div id="dash"><div class="card muted">${esc(t('Loading…'))}</div></div>`;
    $$('#hb .chip').forEach(c => c.onclick = () => { S.homeBiz = sel = c.dataset.v; $$('#hb .chip').forEach(x => x.classList.toggle('on', x === c)); load(); });
    const load = async () => {
      const box = $('#dash');
      const cached = A.LS.get('dash_' + S.user.id + sel);
      if (cached) drawDash(box, cached, sel);
      try { await A.syncNow(); const r = await api('report', { business: sel, from: A.today(), to: A.today() }); A.LS.set('dash_' + S.user.id + sel, r); if ($('#dash')) drawDash($('#dash'), r, sel); }
      catch (e) { if (!cached && $('#dash')) box.innerHTML = `<div class="card red">${esc(e.message)}</div>`; else toast(e.message, 'err'); }
    };
    load();
  };
  function drawDash(box, r, sel) {
    const T = r.totals, alerts = [];
    if (r.pendingRefunds && can('approveRefunds')) alerts.push(['refunds', '↩️', t('{n} refund requests waiting', { n: r.pendingRefunds }), 'red']);
    if (S.failed.length) alerts.push(['sync', '⚠️', t('{n} items failed to save', { n: S.failed.length }), 'red']);
    if (r.lowStock.length) alerts.push(['products/low', '📦', t('{n} products low on stock', { n: r.lowStock.length }), 'amber']);
    if (r.expiring.length) alerts.push(['products/exp', '⏰', t('{n} products expired or expiring', { n: r.expiring.length }), 'amber']);
    if (r.lowIngredients.length) alerts.push(['ingredients', '🍗', t('Low ingredients: {x}', { x: r.lowIngredients.map(i => t(i.name)).join(', ') }), 'amber']);
    const biz = ['shop', 'food'].filter(b => r.business.indexOf(b) >= 0);
    box.innerHTML = `
      <div class="card navy"><div class="row"><div class="grow"><div class="small" style="opacity:.8">${esc(t('Sales today'))}</div><div class="big" style="color:var(--gold)">${money(T.netSales)}</div>
        <div class="small" style="opacity:.8">${T.count} ${esc(t('sales'))} · ${usd(T.netSales)}</div></div>
        ${r.profitVisible ? `<div class="right"><div class="small" style="opacity:.8">${esc(t('Profit'))}</div><div class="big">${fmt(T.profit)}</div></div>` : ''}</div></div>
      ${biz.length > 1 ? `<div class="stats">${biz.map(b => `<div class="stat"><div class="lbl">${esc(A.bizName(b))}</div><div class="val">${fmt(r.byBiz[b].netSales)}</div><div class="small muted">${r.byBiz[b].count} ${esc(t('sales'))}${r.profitVisible ? ' · ' + esc(t('Profit')) + ' ' + fmt(r.byBiz[b].profit) : ''}</div></div>`).join('')}</div>` : ''}
      <div class="stats"><div class="stat"><div class="lbl">${esc(t('Cash'))}</div><div class="val">${fmt(T.cash)}</div></div><div class="stat"><div class="lbl">Zaad</div><div class="val">${fmt(T.zaad)}</div></div>
        <div class="stat"><div class="lbl">Edahab</div><div class="val">${fmt(T.edahab)}</div></div><div class="stat"><div class="lbl">${esc(t('Credit'))}</div><div class="val">${fmt(T.credit)}</div></div>
        <div class="stat"><div class="lbl">${esc(t('Expenses'))}</div><div class="val">${fmt(T.expenses + T.stockPurchases)}</div></div><div class="stat"><div class="lbl">${esc(t('Refunds'))}</div><div class="val">${fmt(T.refunds)}</div></div>
        <div class="stat"><div class="lbl">${esc(t('Customer debts'))}</div><div class="val">${fmt(r.totalDebt)}</div></div><div class="stat"><div class="lbl">${esc(t('Debt payments'))}</div><div class="val">${fmt(T.custPay)}</div></div></div>
      ${alerts.length ? `<div class="list">${alerts.map(a => `<div class="li tap alert ${a[3] === 'amber' ? 'amber' : ''}" data-go="${a[0]}"><span style="font-size:22px">${a[1]}</span><div class="main name">${esc(a[2])}</div><span>›</span></div>`).join('')}</div>` : ''}
      <h3>${esc(t('Money in shifts'))}</h3><div class="list">${r.balances.map(b => `
        ${b.open.map(o => `<div class="li"><div class="main"><div class="name">${esc(A.bizName(b.business))} · ${esc(o.userName)} <span class="pill green">${esc(t('Open'))}</span></div>
          <div class="sub">${esc(t('Expected now'))}: ${esc(t('Cash'))} ${fmt(o.expectedCash)} · Zaad ${fmt(o.expectedZaad)} · Edahab ${fmt(o.expectedEd)}</div></div></div>`).join('')}
        ${b.last ? `<div class="li"><div class="main"><div class="name">${esc(A.bizName(b.business))} · ${esc(t('last closed'))} ${A.when(b.last.closeTs)} (${esc(b.last.userName)})</div>
          <div class="sub">${esc(t('Cash'))} ${fmt(b.last.cash)} · Zaad ${fmt(b.last.zaad)} · Edahab ${fmt(b.last.edahab)}</div></div>${diffTxt(b.last.diffCash)}</div>` : ''}`).join('') || `<div class="empty">—</div>`}</div>
      <div class="grid2"><div><h3>${esc(t('Best sellers'))}</h3><div class="list">${r.topItems.slice(0, 6).map(i => `<div class="li"><div class="main name">${esc(i.name)}</div><span class="muted">×${fmt(i.qty)}</span></div>`).join('') || `<div class="empty">—</div>`}</div></div>
        <div><h3>${esc(t('Top debtors'))}</h3><div class="list">${r.debts.slice(0, 6).map(c => `<div class="li"><div class="main name">${esc(c.name)}</div><b class="red">${fmt(c.balance)}</b></div>`).join('') || `<div class="empty">—</div>`}</div></div></div>
      <div class="col"><button class="btn green block lg" id="wa">💬 ${esc(t('Send daily summary on WhatsApp'))}</button><button class="btn block" id="rep">📊 ${esc(t('Full reports'))}</button></div>`;
    $$('[data-go]', box).forEach(x => x.onclick = () => go(x.dataset.go));
    $('#wa', box).onclick = () => A.openWhatsApp(setting('ownerWhatsApp'), summaryText(r));
    $('#rep', box).onclick = () => go('reports');
  }
  function summaryText(r) {
    const L = [`*Saado — ${r.from === r.to ? r.from : r.from + ' → ' + r.to}*`];
    ['shop', 'food'].filter(b => r.business.indexOf(b) >= 0).forEach(b => {
      const x = r.byBiz[b];
      L.push('', `*${A.bizName(b)}*`, `${t('Sales')}: ${fmt(x.netSales)} SH (${x.count})`,
        `${t('Cash')} ${fmt(x.cash)} · Zaad ${fmt(x.zaad)} · Edahab ${fmt(x.edahab)} · ${t('Credit')} ${fmt(x.credit)}`,
        `${t('Expenses')}: ${fmt(x.expenses + x.stockPurchases)} · ${t('Refunds')}: ${fmt(x.refunds)}` + (r.profitVisible ? ` · ${t('Profit')}: ${fmt(x.profit)}` : ''));
    });
    if (r.business.length > 1) L.push('', `*${t('Total')}*: ${fmt(r.totals.netSales)} SH` + (r.profitVisible ? ` · ${t('Profit')}: ${fmt(r.totals.profit)}` : ''));
    r.balances.forEach(b => { if (b.last) L.push(`${A.bizName(b.business)} ${t('last shift')}: ${t('Cash')} ${fmt(b.last.cash)} (${num(b.last.diffCash) >= 0 ? '+' : ''}${fmt(b.last.diffCash)})`); });
    L.push('', `${t('Customer debts')}: ${fmt(r.totalDebt)} SH`);
    if (r.lowStock.length) L.push(`${t('Low stock')}: ${r.lowStock.slice(0, 10).map(p => p.name).join(', ')}`);
    return L.join('\n');
  }

  /* ======================= REPORTS ======================= */
  Screens.reports = function (main) {
    if (!can('viewReports')) return noPerm(main);
    const bizs = A.myBiz();
    const st = S.repState || (S.repState = { biz: bizs.length > 1 ? 'all' : bizs[0], from: A.today(), to: A.today(), preset: 'today' });
    const presets = { today: [A.today(), A.today()], yesterday: [A.addDays(A.today(), -1), A.addDays(A.today(), -1)], week: [A.addDays(A.today(), -6), A.today()], month: [A.today().slice(0, 8) + '01', A.today()] };
    main.innerHTML = head(t('Reports'), `<button class="btn sm noprint" onclick="window.print()">🖨️</button>`) + `<div class="card noprint">
      ${bizs.length > 1 ? `<div class="chips" id="rb" style="margin-bottom:8px">${['all', 'shop', 'food'].map(b => `<button class="chip ${st.biz === b ? 'on' : ''}" data-v="${b}">${esc(b === 'all' ? t('Shop + Fast Food') : A.bizName(b))}</button>`).join('')}</div>` : ''}
      <div class="chips" id="pr">${[['today', t('Today')], ['yesterday', t('Yesterday')], ['week', t('7 days')], ['month', t('This month')]].map(p => `<button class="chip ${st.preset === p[0] ? 'on' : ''}" data-v="${p[0]}">${esc(p[1])}</button>`).join('')}</div>
      <div class="grid2" style="margin-top:8px"><label class="f"><span>${esc(t('From'))}</span><input class="in" type="date" id="rf" value="${st.from}"></label><label class="f"><span>${esc(t('To'))}</span><input class="in" type="date" id="rt" value="${st.to}"></label></div></div>
      <div id="rep"><div class="card muted">${esc(t('Loading…'))}</div></div>`;
    $$('#rb .chip').forEach(c => c.onclick = () => { st.biz = c.dataset.v; $$('#rb .chip').forEach(x => x.classList.toggle('on', x === c)); load(); });
    $$('#pr .chip').forEach(c => c.onclick = () => { st.preset = c.dataset.v; [st.from, st.to] = presets[st.preset]; $('#rf').value = st.from; $('#rt').value = st.to; $$('#pr .chip').forEach(x => x.classList.toggle('on', x === c)); load(); });
    $('#rf').onchange = $('#rt').onchange = () => { st.from = $('#rf').value; st.to = $('#rt').value; st.preset = ''; $$('#pr .chip').forEach(x => x.classList.remove('on')); load(); };
    const load = async () => {
      $('#rep').innerHTML = `<div class="card muted">${esc(t('Loading…'))}</div>`;
      try { await A.syncNow(); const r = await api('report', { business: st.biz, from: st.from, to: st.to }); if ($('#rep')) drawReport($('#rep'), r); }
      catch (e) { if ($('#rep')) $('#rep').innerHTML = `<div class="card red">${esc(e.message)}</div>`; }
    };
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
      <div class="col noprint"><button class="btn green block" id="wa">💬 ${esc(t('Send summary on WhatsApp'))}</button>${can('export') ? `<button class="btn block" id="ex">⬇️ ${esc(t('Export to CSV'))}</button>` : ''}</div>`;
    $('#wa', box).onclick = () => A.openWhatsApp(setting('ownerWhatsApp'), summaryText(r));
    if ($('#ex', box)) $('#ex', box).onclick = () => go('export');
  }

  /* ======================= MORE ======================= */
  Screens.more = function (main) {
    const food = S.biz === 'food';
    const items = [
      ['customers', '👥', t('Customers'), can('customers')],
      ['expenses', '💸', t('Expenses'), can('expenses')],
      ['refunds', '↩️', t('Refunds'), true, can('approveRefunds') ? S.data.pendingRefunds : 0],
      ['products', food ? '🍔' : '📦', food ? t('Menu items') : t('Products'), can('viewStock') || can('manageProducts') || can('changePrices')],
      ['ingredients', '🍗', t('Ingredients'), food && (can('ingredients') || can('manageProducts'))],
      ['stockcount', '🔢', t('Stock count'), !food && can('stockCount')],
      ['suppliers', '🚚', t('Suppliers'), can('suppliers')],
      ['reports', '📊', t('Reports'), can('viewReports')],
      ['users', '🔐', t('Users'), can('manageUsers')],
      ['settings', '⚙️', t('Settings'), can('settings')],
      ['audit', '📜', t('Audit log'), can('audit')],
      ['export', '⬇️', t('Export'), can('export')],
      ['sync', '🔄', t('Sync status'), true, S.failed.length],
      ['pin', '🔑', t('My PIN'), true],
      ['lang', '🌐', S.lang === 'so' ? 'English' : 'Soomaali', true],
      ['guide', '📖', t('Guide'), true],
      ['logout', '🚪', t('Log out'), true]
    ].filter(x => x[3]);
    main.innerHTML = head(t('More')) + `<div class="menu-grid">${items.map(x => `<button data-r="${x[0]}"><span class="ic">${x[1]}</span>${esc(x[2])}${x[4] ? `<span class="badge">${x[4]}</span>` : ''}</button>`).join('')}</div>
      <p class="small muted" style="text-align:center;margin-top:16px">${esc(S.user.name)} · ${esc(isOwner() ? t('Owner') : t('Employee'))} · v${A.APP_VERSION}</p>`;
    $$('.menu-grid button').forEach(b => b.onclick = async () => {
      const r = b.dataset.r;
      if (r === 'logout') return A.logout();
      if (r === 'guide') return window.open('guide.html#' + S.lang, '_blank');
      if (r === 'lang') {
        S.lang = S.lang === 'so' ? 'en' : 'so'; A.LS.set('lang', S.lang); S.user.lang = S.lang;
        A.LS.set('session', { token: S.token, expires: S.expires, user: S.user });
        if (S.online) api('me.setLang', { lang: S.lang }).catch(() => {});
        A.drawShell(); return A.render();
      }
      go(r);
    });
  };

  /* ======================= PRODUCTS ======================= */
  Screens.products = function (main, args) {
    if (!(can('viewStock') || can('manageProducts') || can('changePrices'))) return noPerm(main);
    const food = S.biz === 'food';
    let filter = args[0] || 'all';
    main.innerHTML = head((food ? t('Menu items') : t('Products')) + ' · ' + bizLabel(), can('manageProducts') ? `<button class="btn gold" id="np">＋ ${esc(t('New'))}</button>` : '') + `
      <div class="searchbar"><input class="in" id="q" type="search" placeholder="${esc(t('Search or scan barcode'))}"><button class="iconbtn" id="sc">📷</button></div>
      <div class="chips" id="fl" style="margin-bottom:8px">${[['all', t('All')]].concat(food ? [] : [['low', t('Low stock')], ['exp', t('Expiring')]]).concat([['off', t('Hidden')]]).map(f => `<button class="chip ${filter === f[0] ? 'on' : ''}" data-v="${f[0]}">${esc(f[1])}</button>`).join('')}</div>
      <div id="pl"></div>
      ${can('manageProducts') ? `<div class="grid2"><button class="btn" id="imp">⬆️ ${esc(t('Import CSV / Excel'))}</button><button class="btn" id="tpl">📄 ${esc(t('Download template'))}</button></div>` : ''}`;
    const lim = A.addDays(A.today(), num(setting('expiryWarnDays')) || 14);
    const draw = () => {
      const v = $('#q').value.toLowerCase();
      let l = (S.data.products || []).filter(p => p.business === S.biz);
      if (filter === 'off') l = l.filter(p => String(p.active) === '0'); else l = l.filter(p => String(p.active) !== '0');
      if (filter === 'low') l = l.filter(p => num(p.stock) <= num(p.lowStock));
      if (filter === 'exp') l = l.filter(p => p.expiry && p.expiry <= lim);
      if (v) l = l.filter(p => String(p.name).toLowerCase().includes(v) || String(p.barcode).includes(v) || String(p.category || '').toLowerCase().includes(v));
      l.sort((a, b) => String(a.name).localeCompare(b.name));
      $('#pl').innerHTML = `<div class="small muted" style="margin-bottom:4px">${l.length} ${esc(t('items'))}</div><div class="list">${l.slice(0, 300).map(p => `<div class="li tap" data-id="${esc(p.id)}"><div class="main"><div class="name">${num(p.fav) ? '⭐ ' : ''}${esc(p.name)}</div>
        <div class="sub">${esc(p.category || '')} ${p.barcode ? '· ' + esc(p.barcode) : ''} ${p.expiry ? `· <span class="${p.expiry < A.today() ? 'red' : p.expiry <= lim ? 'amber' : ''}">${esc(t('Exp'))} ${esc(p.expiry)}</span>` : ''}</div></div>
        <div class="right"><b>${fmt(p.price)}</b>${!food && can('viewStock') ? `<div class="small ${num(p.stock) <= num(p.lowStock) ? 'red bold' : 'muted'}">${esc(t('Stock'))} ${fmt(p.stock)}</div>` : ''}</div></div>`).join('') || `<div class="empty">${esc(t('Nothing found'))}</div>`}</div>`;
      $$('#pl .li').forEach(r => r.onclick = () => productForm(findProd(r.dataset.id), draw));
    };
    $('#q').oninput = draw;
    $$('#fl .chip').forEach(c => c.onclick = () => { filter = c.dataset.v; $$('#fl .chip').forEach(x => x.classList.toggle('on', x === c)); draw(); });
    $('#sc').onclick = async () => { const code = await A.scanOnce(); if (!code) return; const p = prods().find(x => x.barcode === code); if (p) productForm(p, draw); else if (can('manageProducts')) productForm({ barcode: code }, draw); else toast(t('Barcode not found: {c}', { c: code }), 'err'); };
    if ($('#np')) $('#np').onclick = () => productForm(null, draw);
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
      <label class="f"><span>${esc(t('Barcode'))}</span><div class="row"><input class="in grow" name="barcode" value="${esc(p.barcode || '')}" inputmode="numeric" ${mp ? '' : 'readonly'}>${mp ? `<button type="button" class="iconbtn" id="sb">📷</button>` : ''}</div></label>
      <div class="grid2">${moneyInput('price', t('Selling price (SH)'), p.price, isNew || cp ? 'required' : 'readonly')}${showCost ? moneyInput('cost', t('Cost price (SH)'), p.cost, isNew || cp ? '' : 'readonly') : ''}</div>
      <label class="f"><span>${esc(t('Category'))}</span><input class="in" name="category" list="cats" value="${esc(p.category || '')}" ${mp ? '' : 'readonly'}><datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      ${!food ? `<div class="grid2">${moneyInput('stock', t('Stock now'), isNew ? '' : p.stock, mp ? '' : 'readonly')}${moneyInput('lowStock', t('Warn when stock is at'), isNew ? setting('defaultLowStock') : p.lowStock, mp ? '' : 'readonly')}</div>
      <label class="f"><span>${esc(t('Expiry date (optional)'))}</span><input class="in" type="date" name="expiry" value="${esc(p.expiry || '')}" ${mp ? '' : 'readonly'}></label>` : ''}
      ${mp ? `<label class="chk"><input type="checkbox" name="fav" ${num(p.fav) ? 'checked' : ''}><span class="main">⭐ ${esc(t('Always show on the sell screen'))}</span></label>
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
    main.innerHTML = head(t('Stock count')) + `<p class="small muted">${esc(t('Scan or search each item on the shelf and type how many you really have. Then save.'))}</p>
      <div class="searchbar"><input class="in" id="q" type="search" placeholder="${esc(t('Search or scan barcode'))}"><button class="iconbtn gold" id="sc">📷</button></div>
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

  /* ======================= SUPPLIERS ======================= */
  Screens.suppliers = function (main) {
    if (!can('suppliers')) return noPerm(main);
    main.innerHTML = head(t('Suppliers') + ' · ' + bizLabel(), `<button class="btn gold" id="ns">＋ ${esc(t('New'))}</button>`) + offlineNote() + `<div id="sl"></div>`;
    const draw = () => {
      const l = (S.data.suppliers || []).filter(s => s.business === S.biz);
      $('#sl').innerHTML = `<div class="stats"><div class="stat"><div class="lbl">${esc(t('We owe in total'))}</div><div class="val">${fmt(l.reduce((a, s) => a + Math.max(0, num(s.balance)), 0))}</div></div></div>
        <div class="list">${l.map(s => `<div class="li tap" data-id="${esc(s.id)}"><div class="main"><div class="name">${esc(s.name)}</div><div class="sub">${esc(s.phone || '')}</div></div><b class="${num(s.balance) > 0 ? 'red' : ''}">${fmt(s.balance)}</b></div>`).join('') || `<div class="empty">${esc(t('No suppliers yet'))}</div>`}</div>`;
      $$('#sl .li').forEach(r => r.onclick = () => supplierSheet(S.data.suppliers.find(s => s.id === r.dataset.id), draw));
    };
    $('#ns').onclick = () => supplierForm(null, draw);
    draw();
  };
  function supplierForm(s, done) {
    sheet({ title: s ? t('Edit supplier') : t('New supplier'), body: `<form id="f">${input('name', t('Name'), s && s.name, 'autofocus')}${input('phone', t('Phone / WhatsApp (e.g. 252634000000)'), s && s.phone, 'inputmode="tel"')}${input('note', t('Note'), s && s.note)}</form>`,
      actions: [{ label: t('Cancel') }, { label: t('Save'), cls: 'gold', onClick: async (close, el) => {
        needOnline(); const f = formData($('#f', el));
        const r = await api('sup.save', Object.assign({ id: s ? s.id : '', business: s ? s.business : S.biz }, f));
        A.upsert('suppliers', r.supplier); close(); done && done();
      } }] });
  }
  function supplierSheet(s, done) {
    const sh = sheet({ title: s.name, body: `<div class="totalbox"><div class="u">${esc(t('We owe'))}</div><div class="t">${money(s.balance)}</div></div>
      <div class="grid2"><button class="btn gold" id="pu">🧾 ${esc(t('New purchase'))}</button><button class="btn" id="pay">💵 ${esc(t('Pay supplier'))}</button>
      <button class="btn green" id="ord">💬 ${esc(t('Order on WhatsApp'))}</button><button class="btn" id="ed">✏️ ${esc(t('Edit'))}</button></div>
      <div class="spacer"></div><h3>${esc(t('History'))}</h3><div id="led" class="muted">${esc(t('Loading…'))}</div>` });
    const el = sh.el;
    $('#pu', el).onclick = () => { sh.close(); purchaseForm(s, done); };
    $('#pay', el).onclick = () => { sh.close(); supPayForm(s, done); };
    $('#ord', el).onclick = () => { sh.close(); orderForm(s); };
    $('#ed', el).onclick = () => { sh.close(); supplierForm(s, done); };
    if (!S.online) { $('#led', el).textContent = t('History needs internet.'); return; }
    api('sup.ledger', { supplierId: s.id }).then(r => {
      $('#led', el).innerHTML = `<div class="list">${r.ledger.map(l => { let items = []; try { items = JSON.parse(l.items || '[]'); } catch (e) {} return `<div class="li"><div class="main"><div class="name">${esc(l.type === 'purchase' ? t('Purchase') : t('Payment'))} · ${A.when(l.ts)}</div>
        <div class="sub">${items.map(i => esc(i.name) + ' ×' + fmt(i.qty)).join(', ')}${l.type === 'purchase' ? ' · ' + esc(t('paid')) + ' ' + fmt(l.paid) : ' · ' + esc(A.methodName(l.method))}</div></div><b>${fmt(l.amount)}</b></div>`; }).join('') || '<div class="empty">—</div>'}</div>`;
    }).catch(e => { $('#led', el).textContent = e.message; });
  }
  // item picker shared by purchase and order forms
  function itemPicker(el, lines, onChange, withCost) {
    const food = S.biz === 'food';
    const pool = () => (food ? (S.data.ingredients || []).map(g => ({ kind: 'i', id: g.id, name: g.name + ' (' + g.unit + ')', cost: g.cost, stock: g.stock, low: g.lowLevel })) : [])
      .concat(prods().map(p => ({ kind: 'p', id: p.id, name: p.name, cost: p.cost, stock: p.stock, low: p.lowStock, barcode: p.barcode })).filter(x => !food || x.kind === 'p'));
    const add = x => { if (!lines.find(l => l.refId === x.id)) lines.push({ kind: x.kind, refId: x.id, name: x.name, qty: 1, cost: num(x.cost) }); draw(); onChange(); };
    el.innerHTML = `<div class="row"><input class="in grow" id="iq" placeholder="${esc(t('Search item to add'))}"><button type="button" class="iconbtn" id="isc">📷</button></div><div id="ir"></div><div class="spacer"></div><div id="il"></div>`;
    $('#iq', el).oninput = () => {
      const v = $('#iq', el).value.toLowerCase();
      const l = v ? pool().filter(x => x.name.toLowerCase().includes(v) || String(x.barcode || '').startsWith(v)).slice(0, 12) : [];
      $('#ir', el).innerHTML = l.length ? `<div class="list">${l.map(x => `<div class="li tap" data-id="${esc(x.id)}"><div class="main name">${esc(x.name)}</div><span class="muted small">${esc(t('Stock'))} ${fmt(x.stock)}</span></div>`).join('')}</div>` : '';
      $$('#ir .li', el).forEach(r => r.onclick = () => { add(pool().find(x => x.id === r.dataset.id)); $('#iq', el).value = ''; $('#ir', el).innerHTML = ''; });
    };
    $('#isc', el).onclick = async () => { const c = await A.scanOnce(); if (!c) return; const x = pool().find(y => y.barcode === c); if (x) add(x); else toast(t('Barcode not found: {c}', { c }), 'err'); };
    const draw = () => {
      $('#il', el).innerHTML = lines.length ? `<div class="list">${lines.map((l, i) => `<div class="li"><div class="main"><div class="name">${esc(l.name)}</div>
        <div class="row" style="margin-top:6px"><input class="in" style="max-width:90px" data-i="${i}" data-k="qty" value="${l.qty}" inputmode="decimal" aria-label="qty">
        ${withCost ? `<span class="muted">×</span><input class="in grow" data-i="${i}" data-k="cost" value="${l.cost || ''}" inputmode="numeric" placeholder="${esc(t('Unit cost'))}">` : ''}</div></div>
        <button type="button" class="btn sm ghost" data-del="${i}">✕</button></div>`).join('')}</div>` : `<div class="empty">${esc(t('No items yet'))}</div>`;
      $$('#il input', el).forEach(inp => inp.oninput = () => { lines[inp.dataset.i][inp.dataset.k] = num(inp.value); onChange(); });
      $$('#il [data-del]', el).forEach(b => b.onclick = () => { lines.splice(b.dataset.del, 1); draw(); onChange(); });
    };
    draw();
    return { add, draw, pool };
  }
  function purchaseForm(s, done) {
    const lines = [];
    const sh = sheet({ title: t('Purchase from {n}', { n: s.name }), sticky: true, body: `<div id="pk"></div><div class="totalbox" style="margin-top:12px"><div class="u">${esc(t('Total'))}</div><div class="t" id="tot">0</div></div>
      ${moneyInput('paid', t('Paid now (SH)'), '')}<label class="f"><span>${esc(t('Paid with'))}</span>${methodSeg('method', ['cash', 'zaad', 'edahab'], 'cash')}</label>${input('note', t('Note'), '')}
      <p class="small muted">${esc(t('Stock goes up and the cost price is updated. What is not paid now is added to what we owe this supplier.'))}</p>`,
      actions: [{ label: t('Cancel') }, { label: t('Save purchase'), cls: 'gold', onClick: async (close, el) => {
        needOnline(); if (!lines.length) throw new Error(t('Add at least one item'));
        const r = await api('sup.purchase', { id: A.uid('PU'), supplierId: s.id, items: lines, paid: num($('[name=paid]', el).value), method: $('[data-name=method]', el).dataset.value, note: $('[name=note]', el).value });
        A.upsert('suppliers', r.supplier); await A.refresh(true); close(); toast(t('Purchase saved'), 'ok'); done && done();
      } }] });
    const total = () => lines.reduce((a, l) => a + num(l.qty) * num(l.cost), 0);
    let paidTouched = false;
    $('[name=paid]', sh.el).oninput = () => { paidTouched = true; };
    itemPicker($('#pk', sh.el), lines, () => { $('#tot', sh.el).textContent = money(total()); if (!paidTouched) $('[name=paid]', sh.el).value = total(); }, true);
    seg($('[data-name=method]', sh.el));
  }
  function supPayForm(s, done) {
    sheet({ title: t('Pay {n}', { n: s.name }), body: `<p>${esc(t('We owe'))}: <b>${money(s.balance)}</b></p>${moneyInput('amount', t('Amount (SH)'), '', 'autofocus')}
      <label class="f"><span>${esc(t('Paid with'))}</span>${methodSeg('method', ['cash', 'zaad', 'edahab'], 'cash')}</label>${input('note', t('Note'), '')}`,
      onOpen: el => seg($('[data-name=method]', el)),
      actions: [{ label: t('Cancel') }, { label: t('Save payment'), cls: 'gold', onClick: async (close, el) => {
        needOnline(); const amt = num($('[name=amount]', el).value); if (amt <= 0) throw new Error(t('Enter an amount'));
        const r = await api('sup.pay', { id: A.uid('SPY'), supplierId: s.id, amount: amt, method: $('[data-name=method]', el).dataset.value, note: $('[name=note]', el).value });
        A.upsert('suppliers', r.supplier); close(); toast(t('Payment saved'), 'ok'); done && done();
      } }] });
  }
  function orderForm(s) {
    const lines = [];
    const sh = sheet({ title: t('Order for {n}', { n: s.name }), body: `<button class="btn block" id="low">⚠️ ${esc(t('Add all low-stock items'))}</button><div class="spacer"></div><div id="pk"></div>`,
      actions: [{ label: t('Cancel') }, { label: t('Send PDF on WhatsApp'), cls: 'green', onClick: async () => {
        if (!lines.length) throw new Error(t('Add at least one item'));
        const shopName = S.biz === 'food' ? setting('foodName') : setting('shopName');
        const blob = await A.makeDocPDF({ title: t('PURCHASE ORDER'), lines: [shopName, setting('shopPhone') ? t('Phone') + ': ' + setting('shopPhone') : '', t('To') + ': ' + s.name, t('Date') + ': ' + A.today()].filter(Boolean),
          head: ['#  ' + t('Item'), t('Quantity')], colX: [0, 1150], rows: lines.map((l, i) => [(i + 1) + '.  ' + l.name, fmt(l.qty)]), footer: [t('Please confirm price and delivery time.'), t('Thank you') + ' — ' + shopName] });
        await A.shareFile(blob, 'Saado-order-' + A.today() + '.pdf', t('Order from {s} — {n} items', { s: shopName, n: lines.length }), s.phone);
      } }] });
    const pk = itemPicker($('#pk', sh.el), lines, () => {}, false);
    $('#low', sh.el).onclick = () => {
      pk.pool().filter(x => num(x.stock) <= num(x.low)).forEach(x => { if (!lines.find(l => l.refId === x.id)) lines.push({ kind: x.kind, refId: x.id, name: x.name, qty: Math.max(1, num(x.low) * 2 - num(x.stock)) }); });
      pk.draw(); if (!lines.length) toast(t('Nothing is low on stock'), 'ok');
    };
  }

  /* ======================= INGREDIENTS ======================= */
  Screens.ingredients = function (main) {
    if (!(can('ingredients') || can('manageProducts'))) return noPerm(main);
    const list = () => (S.data.ingredients || []);
    main.innerHTML = head(t('Ingredients'), can('manageProducts') ? `<button class="btn gold" id="ni">＋ ${esc(t('New'))}</button>` : '') + `
      <div class="grid2" style="margin-bottom:12px"><button class="btn gold lg" id="use">🍳 ${esc(t('End of day usage'))}</button><button class="btn lg" id="add">➕ ${esc(t('Add stock'))}</button></div>
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
    if ($('#ni')) $('#ni').onclick = () => ingForm(null, draw);
    draw();
    if (S.online) api('ing.log', { from: A.addDays(A.today(), -6), to: A.today() }).then(r => {
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
    main.innerHTML = head(t('Refunds') + ' · ' + bizLabel()) + `<button class="btn gold block lg" id="req">↩️ ${esc(t('Request a refund'))}</button><div class="spacer"></div>
      ${approver ? `<h3>${esc(t('Waiting for approval'))}</h3><div id="pend"></div>` : ''}<h3>${esc(t('History'))}</h3><div id="hist"></div>`;
    $('#req').onclick = () => refundRequest(load);
    const load = async () => {
      if (!S.online) { $('#hist').innerHTML = `<div class="card muted">${esc(t('Refunds need internet.'))}</div>`; return; }
      try {
        const r = await api('refund.list', { business: S.biz });
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
      } catch (e) { if ($('#hist')) $('#hist').innerHTML = `<div class="card red">${esc(e.message)}</div>`; }
    };
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
    main.innerHTML = head(t('Users'), `<button class="btn gold" id="nu">＋ ${esc(t('New'))}</button>`) + `<div id="ul"><div class="card muted">${esc(t('Loading…'))}</div></div>`;
    const load = async () => {
      try {
        const r = await api('users.list', {});
        if (!$('#ul')) return;
        $('#ul').innerHTML = `<div class="list">${r.users.map(u => `<div class="li tap" data-id="${esc(u.id)}"><div class="main"><div class="name">${esc(u.name)} ${u.active ? '' : `<span class="pill red">${esc(t('Disabled'))}</span>`}</div>
          <div class="sub">${esc(u.role === 'owner' ? t('Owner') : t('Employee'))} · ${esc(A.bizName(u.business))} · ${u.lang === 'en' ? 'English' : 'Soomaali'}${u.afterHours ? ' · ' + esc(t('after hours')) : ''}</div></div><span>›</span></div>`).join('')}</div>`;
        $$('#ul .li').forEach(li => li.onclick = () => userForm(r.users.find(u => u.id === li.dataset.id), r.perms, load));
        $('#nu').onclick = () => userForm(null, r.perms, load);
      } catch (e) { if ($('#ul')) $('#ul').innerHTML = `<div class="card red">${esc(e.message)}</div>`; }
    };
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
      ${!isNew ? `<label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}><span class="main">${esc(t('Account active'))}</span></label><div class="spacer"></div><button type="button" class="btn block" id="rp">🔑 ${esc(t('Make a new PIN'))}</button>` : ''}
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
    main.innerHTML = head(t('Settings')) + `<form id="f">
      <div class="card"><h3>💱 ${esc(t('Money'))}</h3><div class="grid2">${moneyInput('usdRate', t('1 USD = ? SH'), s.usdRate)}${moneyInput('roundStep', t('Round totals to nearest (SH)'), s.roundStep)}</div></div>
      <div class="card"><h3>📱 ${esc(t('Zaad and Edahab accounts'))}</h3><div class="grid2">${input('shop_zaad', t('Shop Zaad'), s.shop_zaad, 'inputmode="numeric"')}${input('shop_edahab', t('Shop Edahab'), s.shop_edahab, 'inputmode="numeric"')}
        ${input('food_zaad', t('Fast Food Zaad'), s.food_zaad, 'inputmode="numeric"')}${input('food_edahab', t('Fast Food Edahab'), s.food_edahab, 'inputmode="numeric"')}</div></div>
      <div class="card"><h3>🧾 ${esc(t('Selling rules'))}</h3>
        <label class="chk"><input type="checkbox" name="shop_credit" ${on('shop_credit')}><span class="main">${esc(t('Allow credit sales in the Shop'))}</span></label>
        <label class="chk"><input type="checkbox" name="food_credit" ${on('food_credit')}><span class="main">${esc(t('Allow credit sales in Fast Food'))}</span></label>
        <label class="chk"><input type="checkbox" name="requireShift" ${on('requireShift')}><span class="main">${esc(t('Require an open shift before selling'))}</span></label>
        <div class="spacer"></div>${input('expenseCats', t('Expense categories (comma separated)'), s.expenseCats)}
        <div class="grid2">${moneyInput('defaultLowStock', t('Default low-stock level'), s.defaultLowStock)}${moneyInput('expiryWarnDays', t('Warn days before expiry'), s.expiryWarnDays)}</div></div>
      <div class="card"><h3>🍔 ${esc(t('Fast Food'))}</h3><label class="f"><span>${esc(t('Order types'))}</span><div class="chips" id="ot"></div></label>
        <div class="row"><input class="in grow" id="otn" placeholder="${esc(t('New order type, e.g. Delivery'))}"><button type="button" class="btn" id="ota">＋</button></div><div class="spacer"></div>
        <div class="grid2"><label class="f"><span>${esc(t('Opens'))}</span><input class="in" type="time" name="food_open" value="${esc(s.food_open)}"></label><label class="f"><span>${esc(t('Closes'))}</span><input class="in" type="time" name="food_close" value="${esc(s.food_close)}"></label></div></div>
      <div class="card"><h3>🕗 ${esc(t('Shop hours'))}</h3>${input('shop_hours', t('Shifts (e.g. 08:00-13:00,16:00-23:00)'), s.shop_hours)}${moneyInput('graceMin', t('Minutes allowed before/after hours'), s.graceMin)}</div>
      <div class="card"><h3>🏪 ${esc(t('Names and phones'))}</h3>${input('shopName', t('Shop name'), s.shopName)}${input('foodName', t('Fast Food name'), s.foodName)}
        ${input('shopPhone', t('Phone shown on supplier orders'), s.shopPhone, 'inputmode="tel"')}${input('ownerWhatsApp', t('WhatsApp number for daily summary (e.g. 252634000000)'), s.ownerWhatsApp, 'inputmode="tel"')}</div>
      <button class="btn gold block lg">${esc(t('Save settings'))}</button></form>
      ${isOwner() ? `<div class="card" style="margin-top:12px"><h3>💾 ${esc(t('Backup'))}</h3><p class="small muted">${esc(t('A copy of the Sheet is saved to Google Drive every night (folder "Saado POS Backups"). You can also make one now.'))}</p><button class="btn block" id="bk">${esc(t('Back up now'))}</button></div>` : ''}`;
    const drawTypes = () => { $('#ot').innerHTML = types.map((x, i) => `<button type="button" class="chip on" data-i="${i}">${esc(t(x))} ✕</button>`).join('') || `<span class="muted">—</span>`; $$('#ot .chip').forEach(c => c.onclick = () => { if (types.length > 1) { types.splice(c.dataset.i, 1); drawTypes(); } else toast(t('Keep at least one order type'), 'warn'); }); };
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
    if ($('#bk')) $('#bk').onclick = e => withBusy(e.target, async () => { needOnline(); const r = await api('backup.now', {}); toast(t('Backup saved: {n}', { n: r.name }), 'ok', 5000); });
  };

  /* ======================= AUDIT, EXPORT, SYNC, PIN ======================= */
  Screens.audit = function (main) {
    if (!can('audit')) return noPerm(main);
    main.innerHTML = head(t('Audit log')) + `<div class="card"><div class="grid2"><label class="f"><span>${esc(t('From'))}</span><input class="in" type="date" id="af" value="${A.addDays(A.today(), -2)}"></label>
      <label class="f"><span>${esc(t('To'))}</span><input class="in" type="date" id="at" value="${A.today()}"></label></div><input class="in" id="aq" placeholder="${esc(t('Search (name, action, item)'))}"></div><div id="al"></div>`;
    let timer;
    const load = async () => {
      try {
        const r = await api('audit.list', { from: $('#af').value, to: $('#at').value, q: $('#aq').value });
        if ($('#al')) $('#al').innerHTML = `<div class="list">${r.audit.map(a => `<div class="li"><div class="main"><div class="name">${esc(a.action)} <span class="muted small">· ${esc(a.userName)}</span></div><div class="sub" style="word-break:break-word">${esc(String(a.details).slice(0, 300))}</div></div><span class="small muted">${A.when(a.ts)}</span></div>`).join('') || '<div class="empty">—</div>'}</div>`;
      } catch (e) { if ($('#al')) $('#al').innerHTML = `<div class="card red">${esc(e.message)}</div>`; }
    };
    $('#af').onchange = $('#at').onchange = load; $('#aq').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    load();
  };
  Screens.export = function (main) {
    if (!can('export')) return noPerm(main);
    const types = [['sales', t('Sales')], ['items', t('Sold items')], ['expenses', t('Expenses')], ['shifts', t('Shifts')], ['refunds', t('Refunds')], ['custledger', t('Customer payments and debts')], ['supledger', t('Supplier purchases')], ['customers', t('Customers')], ['products', t('Products')]];
    const bizs = A.myBiz();
    main.innerHTML = head(t('Export to CSV')) + `<div class="card">${bizs.length > 1 ? `<div class="seg" id="eb" style="margin-bottom:8px">${['all', 'shop', 'food'].map((b, i) => `<button data-v="${b}" class="${i === 0 ? 'on' : ''}">${esc(b === 'all' ? t('All') : A.bizName(b))}</button>`).join('')}</div>` : ''}
      <div class="grid2"><label class="f"><span>${esc(t('From'))}</span><input class="in" type="date" id="ef" value="${A.today().slice(0, 8)}01"></label><label class="f"><span>${esc(t('To'))}</span><input class="in" type="date" id="et" value="${A.today()}"></label></div></div>
      <div class="menu-grid">${types.map(x => `<button data-t="${x[0]}"><span class="ic">⬇️</span>${esc(x[1])}</button>`).join('')}</div>
      <p class="small muted">${esc(t('Files open in Excel or Google Sheets.'))}</p>`;
    if ($('#eb')) seg($('#eb'));
    $$('[data-t]').forEach(b => b.onclick = () => withBusy(b, async () => {
      needOnline();
      const biz = $('#eb') ? $('#eb').dataset.value : bizs[0];
      const r = await api('export', { type: b.dataset.t, business: biz, from: $('#ef').value, to: $('#et').value });
      A.download(`saado-${b.dataset.t}-${$('#ef').value}-to-${$('#et').value}.csv`, A.toCSV(r.headers, r.rows));
      toast(t('{n} rows exported', { n: r.rows.length }), 'ok');
    }));
  };
  Screens.sync = function (main) {
    const mine = S.queue.filter(o => o.userId === S.user.id), others = S.queue.filter(o => o.userId !== S.user.id);
    const label = o => ({ 'sale.create': t('Sale'), 'cust.pay': t('Debt payment'), 'cust.save': t('New customer'), 'exp.create': t('Expense'), 'shift.open': t('Start shift'), 'ing.move': t('Ingredients') }[o.action] || o.action) +
      (o.action === 'sale.create' ? ' · ' + (o.data.items || []).length + ' ' + t('items') : o.data.amount ? ' · ' + fmt(o.data.amount) : '');
    main.innerHTML = head(t('Sync status')) + `<div class="card ${S.online ? '' : 'alert'}"><b>${S.online ? '✓ ' + esc(t('Online')) : '⚠ ' + esc(t('Offline'))}</b>
      <div class="small muted">${esc(t('Sales and payments are saved on this phone first, then sent to the Sheet automatically.'))}</div></div>
      <h3>${esc(t('Waiting to send'))} (${mine.length})</h3><div class="list">${mine.map(o => `<div class="li"><div class="main"><div class="name">${esc(label(o))}</div><div class="sub">${A.when(A.localParts(new Date(o.ts)).date + 'T' + A.localParts(new Date(o.ts)).time)}</div></div><span>⏳</span></div>`).join('') || `<div class="empty">✓ ${esc(t('Everything is sent'))}</div>`}</div>
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
    main.innerHTML = head(t('My PIN')) + `<div class="card"><form id="f">${input('oldPin', t('Current PIN'), '', 'type="password" inputmode="numeric" autocomplete="off"')}
      ${input('newPin', t('New PIN (4–6 digits)'), '', 'type="password" inputmode="numeric" autocomplete="off"')}${input('newPin2', t('New PIN again'), '', 'type="password" inputmode="numeric" autocomplete="off"')}
      <button class="btn gold block lg">${esc(t('Change PIN'))}</button></form></div>`;
    $('#f').onsubmit = e => {
      e.preventDefault();
      withBusy(e.target.querySelector('button'), async () => {
        needOnline(); const f = formData(e.target);
        if (f.newPin !== f.newPin2) throw new Error(t('The two new PINs are different'));
        await api('me.changePin', { oldPin: f.oldPin, newPin: f.newPin });
        S.user.pinChanged = true; toast(t('PIN changed'), 'ok'); go('more');
      });
    };
  };

  function noPerm(main) { main.innerHTML = `<div class="card empty">🔒 ${esc(t('You do not have permission for this.'))}</div>`; }
  Screens.productForm = productForm;
})();
