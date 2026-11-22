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
  function inCart(id) { return S.cart.filter(x => x.productId === id).reduce((a, l) => a + (l.unit === 'pc' ? 0 : l.qty), 0); }
  // badge on a tile: "2", "3 pcs" or "1+3 pcs"
  function inCartTxt(id) {
    const pk = inCart(id), pc = S.cart.filter(x => x.productId === id && x.unit === 'pc').reduce((a, l) => a + l.qty, 0);
    return pc ? (pk ? pk + '+' : '') + pc + ' ' + t('pcs') : pk ? String(pk) : '';
  }
  const piecesInCart = id => { const p = findProd(id); return S.cart.filter(x => x.productId === id).reduce((a, l) => a + A.piecesOf(p, l.qty, l.unit), 0); };
  function stockTxt(p) { return S.biz === 'shop' && can('viewStock') ? ` · ${t('Stock')}: ${A.stockTxt(p)}` : ''; }
  const soldTxt = i => (num(i.qty) ? '×' + fmt(i.qty) : '') + (num(i.pcs) ? (num(i.qty) ? ' + ' : '') + fmt(i.pcs) + ' ' + t('pcs') : '');
  const usdTag = p => p && p.priceCur === 'USD' && num(p.priceUSD) > 0 ? ` <span class="usd">${esc(usdF(p.priceUSD))}</span>` : '';
  const looseTag = p => (A.isLoose(p) ? ` <span class="lz">${esc(t('LOOSE'))}</span>` : '') + usdTag(p);
  function drawResults() {
    const box = $('#results'); if (!box) return;
    const v = ($('#q') || {}).value ? $('#q').value.trim() : '';
    if (!prods().length) {
      box.innerHTML = `<div class="card empty">${esc(t('No products yet.'))}${can('manageProducts') ? `<div class="spacer"></div><button class="btn gold" id="addP">${esc(t('Add products'))}</button>` : ''}</div>`;
      const b = $('#addP'); if (b) b.onclick = () => go('products');
      return;
    }
    if (!v) {
      // every product, most sold first (stars on top), with category chips and the stock left
      const all = prods(), cats = Array.from(new Set(all.map(p => String(p.category || '').trim()).filter(Boolean))).sort();
      if (S.sellCat && cats.indexOf(S.sellCat) < 0) S.sellCat = '';
      const list = all.filter(p => !S.sellCat || String(p.category || '').trim() === S.sellCat)
        .sort((a, b) => (num(b.fav) - num(a.fav)) || (num(b.sold) - num(a.sold)) || String(a.name).localeCompare(b.name));
      const showStock = S.biz === 'shop' && can('viewStock');
      box.innerHTML = (cats.length ? `<div class="chips scroll" id="cats" style="margin-bottom:10px"><button class="chip ${!S.sellCat ? 'on' : ''}" data-c="">${esc(t('All'))} ${all.length}</button>${cats.map(c => `<button class="chip ${S.sellCat === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '') +
        `<div class="tiles">${list.slice(0, 400).map(p => { const low = S.biz === 'shop' && A.isLow(p), q = inCartTxt(p.id); return `<button class="tile ${low ? 'low' : ''}" data-id="${esc(p.id)}">
          <span class="n">${esc(p.name)}${looseTag(p)}</span><span><span class="p">${fmt(p.price)}</span>${showStock ? `<br><span class="s ${low ? 'low' : ''}">${esc(t('Stock'))} ${esc(A.stockTxt(p))}</span>` : ''}</span>${q ? `<span class="q">${esc(q)}</span>` : ''}</button>`; }).join('')}</div>` +
        (list.length > 400 ? `<p class="small muted center">${esc(t('Search to find more products.'))}</p>` : '');
      $$('.tile', box).forEach(b => b.onclick = () => { pick(findProd(b.dataset.id)); });
      $$('#cats .chip', box).forEach(c => c.onclick = () => { S.sellCat = c.dataset.c; drawResults(); });
      return;
    }
    const list = matches(v).slice(0, 50);
    box.innerHTML = list.length ? `<div class="list">${list.map(p => `<div class="li tap" data-id="${esc(p.id)}"><div class="main"><div class="name">${esc(p.name)}${looseTag(p)}</div>
        <div class="sub">${esc(p.barcode || '')}${esc(stockTxt(p))}</div></div><b>${fmt(p.price)}</b>${inCartTxt(p.id) ? `<span class="pill gold">×${esc(inCartTxt(p.id))}</span>` : ''}</div>`).join('')}</div>`
      : `<div class="card empty">${esc(t('Nothing found'))}</div>`;
    $$('.li', box).forEach(r => r.onclick = () => { $('#q').value = ''; pick(findProd(r.dataset.id)); drawResults(); });
  }
  // A tap on a product: loose items ask "packet or pieces"; everything else goes straight into the cart.
  function pick(p) { if (A.isLoose(p)) looseSheet(p); else addToCart(p); }
  function looseSheet(p) {
    const tb = A.looseTable(p), per = num(p.perPack);
    let n = (tb[0] || [1])[0];
    const sh = sheet({ title: p.name, body: `
      <button type="button" class="pk" id="pkBtn"><span class="av">${I('box')}</span><span class="grow"><b>${esc(t('1 packet ({n} pcs)', { n: per }))}</b>${can('viewStock') ? `<span class="small">${esc(t('Stock'))}: ${esc(A.stockTxt(p))}</span>` : ''}</span><b>${fmt(p.price)}</b></button>
      <div class="small muted" style="margin:0 2px 8px;font-weight:700;letter-spacing:.05em">${esc(t('OR PIECES'))}</div>
      ${tb.length ? `<div class="qgrid">${tb.map(r => `<button type="button" class="qb" data-n="${r[0]}"><b>${r[0]}</b><span>${fmt(r[1])}</span></button>`).join('')}</div>` : ''}
      <div class="row" style="align-items:center;margin-top:14px"><span class="grow small muted">${esc(t('Other number of pieces'))}</span><div class="step"><button type="button" data-d="-1">−</button><input id="lzn" inputmode="numeric" value="${n}"><button type="button" data-d="1">+</button></div></div>
      <div class="totalbox" style="margin-top:14px;padding:12px"><div class="u" id="lzu"></div><div class="t" id="lzt" style="font-size:28px"></div></div>`,
      actions: [{ label: t('Cancel') }, { label: t('Add to cart'), cls: 'gold', icon: 'cart', onClick: c => {
        if (!(n > 0)) throw new Error(t('Enter a number'));
        addToCart(p, n, 'pc'); c();
      } }],
      onOpen: (el, close) => {
        const upd = () => {
          n = Math.max(0, Math.floor(num($('#lzn', el).value)));
          $$('.qb', el).forEach(b => b.classList.toggle('on', num(b.dataset.n) === n));
          $('#lzu', el).textContent = n >= per ? t('{n} pieces ({p})', { n, p: A.stockTxt(p, n) }) : t('{n} pieces', { n });
          $('#lzt', el).textContent = n > 0 ? money(A.loosePrice(p, n)) : '—';
        };
        $$('.qb', el).forEach(b => b.onclick = () => { $('#lzn', el).value = b.dataset.n; upd(); });
        $$('.step button', el).forEach(b => b.onclick = () => { $('#lzn', el).value = Math.max(1, num($('#lzn', el).value) + num(b.dataset.d)); upd(); });
        $('#lzn', el).oninput = upd;
        $('#pkBtn', el).onclick = () => { addToCart(p, 1); close(); };
        upd();
      } });
    return sh;
  }
  function addToCart(p, qty, unit) {
    if (!p) return;
    unit = unit === 'pc' && A.isLoose(p) ? 'pc' : '';
    const l = S.cart.find(x => x.productId === p.id && (x.unit || '') === unit);
    if (l) l.qty += qty || 1; else S.cart.push({ productId: p.id, name: p.name, price: num(p.price), qty: qty || 1, unit });
    A.beep();
    if (S.biz === 'shop' && num(p.stock) - piecesInCart(p.id) < 0) toast(t('Warning: {x} shows no stock left', { x: p.name }), 'warn');
    drawCartBar(); if (S.route === 'sell') drawResults();
    return inCart(p.id);
  }
  function cartTotals(discount) {
    const sub = S.cart.reduce((a, l) => a + A.lineTotal(l), 0);
    const d = Math.min(num(discount), sub);
    return { sub, discount: d, total: A.roundStep(sub - d), count: S.cart.reduce((a, l) => a + (l.unit === 'pc' ? 1 : l.qty), 0) };
  }
  const lineName = l => esc(l.name) + (l.unit === 'pc' ? '' : usdTag(findProd(l.productId))) + (l.unit === 'pc' ? ` <span class="lz">${esc(t('{n} PCS', { n: l.qty }))}</span>` : A.isLoose(findProd(l.productId)) ? ` <span class="lz pkt">${esc(t('PACKET'))}</span>` : '');
  function drawCartBar() {
    document.querySelectorAll('.cartbar').forEach(x => x.remove());
    if (S.route !== 'sell' || !S.cart.length) return;
    const tt = cartTotals(0);
    const bar = document.createElement('div'); bar.className = 'cartbar';
    bar.innerHTML = `<div class="inner"><button class="mini x" id="clrBtn" aria-label="${esc(t('Clear'))}">${I('x')}</button><button class="mini" id="parkBtn" aria-label="${esc(t('Park'))}">${I('pause')}</button>
      <button class="sum" id="openCart"><span class="cnt">${tt.count}</span><span class="grow"><b>${money(tt.total)}</b><span>${usd(tt.total)}</span></span></button>
      <button class="btn gold lg pay" id="payBtn">${esc(t('Pay'))}</button></div>`;
    document.body.appendChild(bar);
    $('#openCart').onclick = openCart; $('#payBtn').onclick = openPay; $('#parkBtn').onclick = park;
    $('#clrBtn').onclick = () => {   // clears at once; "Undo" brings the cart back for 5 seconds
      const saved = S.cart; S.cart = []; drawCartBar(); drawResults();
      toast(t('Cart cleared'), '', 5000, { label: t('Undo'), fn: () => { S.cart = saved; drawCartBar(); drawResults(); } });
    };
  }
  function openCart() {
    const sh = sheet({ title: t('Cart'), body: '<div id="cl"></div>', actions: [
      { label: t('Park'), onClick: c => { park(); c(); } },
      { label: t('Clear'), cls: 'ghost', onClick: async c => { if (await confirmBox(t('Remove all items from the cart?'))) { S.cart = []; c(); drawCartBar(); drawResults(); } } },
      { label: t('Pay'), cls: 'gold', onClick: c => { c(); openPay(); } }] });
    const draw = () => {
      const box = $('#cl', sh.el); const tt = cartTotals(0);
      if (!S.cart.length) { sh.close(); drawCartBar(); drawResults(); return; }
      box.innerHTML = `<div class="list">${S.cart.map((l, i) => `<div class="li"><div class="main"><div class="name">${lineName(l)}</div><div class="sub">${l.unit === 'pc' ? esc(t('loose price for {n}', { n: l.qty })) + ` = <b>${fmt(A.lineTotal(l))}</b>` : `${fmt(l.price)} × ${l.qty} = <b>${fmt(A.lineTotal(l))}</b>`}</div></div>
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
    let st = { method: 'cash', discount: 0, tendered: '', cur: 'SH', payCur: 'SH', customerId: '', orderType: types[0] || '' };
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
        const acct = setting(biz + '_' + st.method), usdAmt = (Math.ceil(tt.total / A.rate() * 100) / 100).toFixed(2);
        box.innerHTML = `<label class="f"><span>${esc(t('Paid in'))}</span><div class="seg" id="pcur"><button data-v="SH" class="${st.payCur === 'SH' ? 'on' : ''}">${esc(t('Shillings (SH)'))}</button><button data-v="USD" class="${st.payCur === 'USD' ? 'on' : ''}">${esc(t('Dollars (USD)'))}</button></div></label>
          <div class="acct"><div class="muted">${esc(t('Customer sends to {m} account', { m: A.methodName(st.method) }))}</div><b>${esc(acct || '—')}</b>
          <div class="bold" style="font-size:20px">${st.payCur === 'USD' ? '$' + usdAmt : money(tt.total)}</div></div>
          <label class="f"><span>${esc(t('Customer sent more? Type what arrived'))}</span><div class="row"><input class="in big grow" id="sent" inputmode="decimal" value="${esc(st.sent || '')}" placeholder="${esc(t('Exact amount'))}"></div></label>
          <div id="sentInfo"></div><p class="small muted">${esc(t('Check the money arrived before completing.'))}</p>`;
        const drawSent = () => {
          const v = num(st.sent), usd = st.payCur === 'USD', given = usd ? v * A.rate() : v, ch = Math.round(given - tt.total), acc = A.methodName(st.method);
          $('#sentInfo', el).innerHTML = !v ? '' : ch < 0 ? `<div class="changebox neg">${esc(t('Less than the total'))}</div>`
            : `<div class="changebox">${esc(t('Give {x} change in CASH', { x: money(ch) }))}</div>
               <div class="eff"><div><small>${esc(acc.toUpperCase())}</small><b class="up">+${usd ? usdF(v) : fmt(v)}</b></div><div><small>${esc(t('CASH DRAWER'))}</small><b class="dn">−${fmt(ch)}</b></div><div><small>${esc(t('SALE'))}</small><b>${fmt(tt.total)}</b></div></div>`;
        };
        $('#sent', el).oninput = e => { st.sent = e.target.value; drawSent(); };
        drawSent();
        seg($('#pcur', el), v => { st.payCur = v; st.sent = ''; drawMethod(); });
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
    seg($('[data-name=method]', el), v => { st.method = v; st.sent = ''; drawMethod(); });
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
      const acctSent = (st.method === 'zaad' || st.method === 'edahab') && num(st.sent) > 0;
      if (acctSent) {
        change = Math.round(num(st.sent) * (st.payCur === 'USD' ? A.rate() : 1) - tt.total);
        if (change < 0) throw new Error(t('The amount sent is less than the total'));
      }
      const data = { id: A.uid('S'), business: biz, method: st.method, discount: tt.discount,
        tendered: st.method === 'cash' ? num(st.tendered) : acctSent ? num(st.sent) : 0, tenderCur: st.method === 'cash' ? st.cur : st.payCur,
        payCur: st.method === 'zaad' || st.method === 'edahab' ? st.payCur : 'SH',
        customerId: st.method === 'credit' ? st.customerId : '', orderType: biz === 'food' ? st.orderType : '', ts: new Date().toISOString(),
        items: S.cart.map(l => ({ productId: l.productId, qty: l.qty, name: l.name, unit: l.unit || '' })) };
      enqueue('sale.create', data);
      // update this phone right away (the server checks again)
      S.cart.forEach(l => { const p = findProd(l.productId); if (p) { const pcs = A.piecesOf(p, l.qty, l.unit); if (biz === 'shop') p.stock = num(p.stock) - pcs; p.sold = num(p.sold) + (A.isLoose(p) ? pcs / num(p.perPack) : l.qty); } });
      if (st.method === 'credit') { const c = S.data.customers.find(x => x.id === st.customerId); if (c) c.balance = num(c.balance) + tt.total; }
      A.saveData();
      S.cart = []; close(); drawCartBar(); drawResults();
      S.lastSale = data;
      toast((st.method === 'cash' || acctSent) && change > 0 ? t('Sale saved · Change {x}', { x: money(change) }) : t('Sale saved · {x}', { x: money(tt.total) }), 'ok', 3500);
      const qi = $('#q'); if (qi && window.matchMedia('(min-width: 700px)').matches) qi.focus();
    }
  }

  /* ======================= SHIFT ======================= */
  // Expected money per account and currency. srv = totals from the server (or null); queued items still on this phone are added.
  function liveTotals(sh, srv, moves) {
    const k0 = ['cashInSH', 'cashInUSD', 'zaadInSH', 'zaadInUSD', 'edInSH', 'edInUSD', 'custPayCash', 'custPayZaad', 'custPayEd', 'expCash', 'expZaad', 'expEd', 'expCashUSD', 'expZaadUSD', 'expEdUSD', 'refCash', 'refZaad', 'refEd',
      'cashOutSH', 'cashOutUSD', 'zaadOutSH', 'zaadOutUSD', 'edOutSH', 'edOutUSD', 'cashSales', 'zaadSales', 'edSales', 'creditSales', 'saleCount', 'undoneCount',
      'excashSH', 'excashUSD', 'exzaadSH', 'exzaadUSD', 'exedSH', 'exedUSD', 'exCount', 'exFees'];
    const x = {}; k0.forEach(k => x[k] = srv ? num(srv[k]) : 0);
    let waiting = 0;
    S.queue.forEach(o => {
      if (!o.data || o.data.business && o.data.business !== sh.business) return;
      if (o.action === 'sale.create' && o.userId === S.user.id) {
        const d = o.data, sub = d.items.reduce((a, it) => { const p = findProd(it.productId); return a + (p ? A.lineTotal(Object.assign({ price: p.price }, it)) : 0); }, 0);
        const tot = A.roundStep(sub - num(d.discount)); x.saleCount++; waiting++;
        if (d.method === 'credit') { x.creditSales += tot; return; }
        x[{ cash: 'cashSales', zaad: 'zaadSales', edahab: 'edSales' }[d.method]] += tot;
        const k = { cash: 'cash', zaad: 'zaad', edahab: 'ed' }[d.method];
        if (d.method === 'cash' && d.tenderCur === 'USD' && num(d.tendered) > 0) { x.cashInUSD += num(d.tendered); x.cashInSH -= num(d.tendered) * A.rate() - tot; }
        else if (d.method !== 'cash' && num(d.tendered) > 0) {   // sent more by Zaad/Edahab: all of it into the account, change out of the cash drawer
          x[k + (d.tenderCur === 'USD' ? 'InUSD' : 'InSH')] += num(d.tendered); x.cashInSH -= Math.round(num(d.tendered) * (d.tenderCur === 'USD' ? A.rate() : 1) - tot);
        }
        else if (d.method !== 'cash' && d.payCur === 'USD') x[k + 'InUSD'] += Math.ceil(tot / A.rate() * 100) / 100;
        else x[k + 'InSH'] += tot;
      } else if (o.action === 'cust.pay' && o.userId === S.user.id) { const k = { cash: 'Cash', zaad: 'Zaad', edahab: 'Ed' }[o.data.method]; if (k) { x['custPay' + k] += num(o.data.amount); waiting++; } }
      else if (o.action === 'exp.create' && o.userId === S.user.id) { const k = { cash: 'Cash', zaad: 'Zaad', edahab: 'Ed' }[o.data.method]; if (k) { x['exp' + k + (o.data.currency === 'USD' ? 'USD' : '')] += num(o.data.amount); waiting++; } }
      else if (o.action === 'cash.out') { const k = o.data.account === 'zaad' ? 'zaadOut' : o.data.account === 'edahab' ? 'edOut' : 'cashOut'; x[k + (o.data.currency === 'USD' ? 'USD' : 'SH')] += num(o.data.amount); waiting++; }
      else if (o.action === 'exch.create') {
        const d = o.data, acct = d.account === 'edahab' ? 'ed' : 'zaad', rIn = d.dir === 'out' ? 'cash' : acct, gOut = d.dir === 'out' ? acct : 'cash';
        x['ex' + rIn + (d.recvCur === 'USD' ? 'USD' : 'SH')] += num(d.recvAmount); x['ex' + gOut + (d.giveCur === 'USD' ? 'USD' : 'SH')] -= num(d.giveAmount); x.exCount++; waiting++;
      }
    });
    const r2 = v => Math.round(v * 100) / 100;
    x.eCashSH = num(sh.openCash) + x.cashInSH + x.custPayCash - x.expCash - x.refCash - x.cashOutSH + x.excashSH;
    x.eCashUSD = r2(num(sh.openCashUSD) + x.cashInUSD - x.cashOutUSD - x.expCashUSD + x.excashUSD);
    x.eZaadSH = num(sh.openZaadSH) + x.zaadInSH + x.custPayZaad - x.expZaad - x.refZaad + x.exzaadSH - x.zaadOutSH; x.eZaadUSD = r2(num(sh.openZaadUSD) + x.zaadInUSD - x.expZaadUSD + x.exzaadUSD - x.zaadOutUSD);
    x.eEdSH = num(sh.openEdSH) + x.edInSH + x.custPayEd - x.expEd - x.refEd + x.exedSH - x.edOutSH; x.eEdUSD = r2(num(sh.openEdUSD) + x.edInUSD - x.expEdUSD + x.exedUSD - x.edOutUSD);
    x.totalSH = x.eCashSH + x.eZaadSH + x.eEdSH; x.totalUSD = r2(x.eCashUSD + x.eZaadUSD + x.eEdUSD);
    x.waiting = waiting; x.rate = num(sh.rate) || A.rate();
    return x;
  }
  const usdF = v => { const n = Math.round(num(v) * 100) / 100; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  Screens.shift = function (main) {
    const sh = myShift();
    const others = (S.data.shifts || []).filter(s => s.status === 'open' && s.business === S.biz && s.userId !== S.user.id);
    if (!sh) {
      main.innerHTML = `<div class="card"><h3 style="margin-top:0">${esc(t('Start shift'))}</h3><p class="small muted">${esc(t('Count the money before you start.'))}</p>
        <form id="of"><div class="grid2">${moneyInput('openCash', t('Cash SH'), '', 'autofocus')}${moneyInput('openCashUSD', t('Cash USD'), '', 'inputmode="decimal"')}
        ${moneyInput('openZaadSH', t('Zaad balance SH'), '')}${moneyInput('openZaadUSD', t('Zaad balance USD'), '', 'inputmode="decimal"')}
        ${moneyInput('openEdSH', t('Edahab balance SH'), '')}${moneyInput('openEdUSD', t('Edahab balance USD'), '', 'inputmode="decimal"')}</div>
        <button class="btn gold block lg">${I('clock')}${esc(t('Start shift'))}</button></form></div>
        ${others.length ? `<div class="card"><h3 style="margin-top:0">${esc(t('Other open shifts'))}</h3>${others.map(s => `<div class="row"><span class="grow">${esc(s.userName)}</span><span class="muted">${esc(t('since'))} ${A.when(s.openTs)}</span></div>`).join('')}</div>` : ''}
        <div id="hist"></div>`;
      $('#of').onsubmit = e => {
        e.preventDefault();
        if (e.target.dataset.done) return; e.target.dataset.done = '1';   // a second tap never opens a second shift
        const f = formData(e.target), lp = A.localParts();
        const data = { id: A.uid('SH'), business: S.biz, openCash: num(f.openCash), openCashUSD: num(f.openCashUSD), openZaadSH: num(f.openZaadSH), openZaadUSD: num(f.openZaadUSD), openEdSH: num(f.openEdSH), openEdUSD: num(f.openEdUSD) };
        enqueue('shift.open', data);
        S.data.shifts.push(Object.assign({ status: 'open', userId: S.user.id, userName: S.user.name, openTs: lp.date + 'T' + lp.time + ':00', date: lp.date, rate: A.rate() }, data));
        A.saveData(); toast(t('Shift started'), 'ok'); go('sell');
      };
    } else {
      main.innerHTML = `<div class="card navy"><div class="row"><div class="grow"><div class="small muted">${esc(t('Expected in the drawer now'))}</div><div class="big" id="expNow" style="color:var(--gold)">…</div></div>
          <span class="pill green">${esc(t('Open'))}</span></div><div class="small muted" style="margin-top:4px">${esc(t('Started'))} ${A.when(sh.openTs)}</div></div>
        ${can('cashOut') || can('exchange') ? `<div class="grid2" style="margin-bottom:6px">${can('cashOut') ? `<button class="btn block" id="co">${I('wallet')}${esc(t('Take money out'))}</button>` : ''}${can('exchange') ? `<button class="btn gold block" id="exb">${I('swap')}${esc(t('Exchange'))}</button>` : ''}</div>` : ''}
        <div id="exch"></div><div id="moves"></div><div id="mysales"></div>
        <div class="card" id="endc"><h3 style="margin-top:0">${esc(t('End shift — count and type'))}</h3><div id="cmp"></div>
          <label class="f" style="margin-top:10px"><span>${esc(t('Note'))}</span><input class="in" name="note" id="cnote"></label>
          <button class="btn red block lg" id="endBtn">${I('lock')}${esc(t('End shift'))}</button></div>`;
      if ($('#co')) $('#co').onclick = () => cashOutSheet(() => loadLive(sh));
      if ($('#exb')) $('#exb').onclick = () => exchangeSheet(() => loadLive(sh));
      $('#endBtn').onclick = e => withBusy(e.target.closest('button'), () => closeShift(sh));
      loadLive(sh);
    }
    if (isOwner() || can('viewReports')) loadShiftHistory();
  };
  // The Shift screen draws at once from what the phone already knows, then asks the server ONE time for fresh numbers.
  let liveReq = null;
  function loadLive(sh, force) {
    const key = { id: sh.id };
    const draw = r => {
      if (!$('#cmp') || S.route !== 'shift') return;
      const srv = r ? r.totals : null, moves = (r && r.moves) || [];
      const x = liveTotals(sh, srv);
      $('#expNow').innerHTML = srv || !S.online || S.queue.some(o => o.data && o.data.id === sh.id) ? esc(money(x.eCashSH) + (x.eCashUSD ? ' · ' + usdF(x.eCashUSD) : '')) : '<span class="skel" style="display:inline-block;width:150px;height:30px;margin:0;opacity:.35"></span>';
      const qMoves = S.queue.filter(o => o.action === 'cash.out' && o.data.business === sh.business).map(o => Object.assign({ pending: 1, ts: o.ts, userName: o.userName }, o.data));
      const allMoves = moves.concat(qMoves);
      drawMoves(sh, allMoves);
      drawExchanges(sh, (r && r.exchanges) || [], x);
      drawCompare(sh, x);
      drawMySales(sh, (r && r.sales) || []);
    };
    const hit = A.cacheGet('shift.live', key);
    draw(hit);
    if (!S.online || S.queue.some(o => o.data && o.data.id === sh.id)) return;   // offline, or the shift itself is not sent yet
    if (!force && liveReq && liveReq.id === sh.id) return liveReq.p.then(draw).catch(() => {});
    const p = (async () => {
      if (S.queue.some(o => o.userId === S.user.id)) await A.syncNow();
      const r = await A.api('shift.live', key);
      A.cachePut('shift.live', key, r);
      return r;
    })();
    liveReq = { id: sh.id, p };
    p.then(draw).catch(() => {}).finally(() => { if (liveReq && liveReq.p === p) liveReq = null; });
  }
  // Each account: expected vs counted with a tick; totals in SH and USD are added up by the app.
  function drawCompare(sh, x) {
    const box = $('#cmp'); if (!box) return;
    if (box.dataset.built) {   // already on screen: only refresh the expected numbers, never touch what the person typed
      const set = { closeCash: x.eCashSH, closeZaadSH: x.eZaadSH, closeEdSH: x.eEdSH, closeCashUSD: x.eCashUSD, closeZaadUSD: x.eZaadUSD, closeEdUSD: x.eEdUSD };
      Object.keys(set).forEach(n => { const i = $(`#cmp [name=${n}]`); i.dataset.exp = set[n]; $(`[data-e="${n}"]`).textContent = i.dataset.cur === 'USD' ? usdF(set[n]) : fmt(set[n]); });
      $('[data-e="totSH"]').textContent = fmt(x.totalSH); $('[data-e="totUSD"]').textContent = usdF(x.totalUSD); $('[data-e="all"]').textContent = fmt(x.totalSH + x.totalUSD * x.rate);
      box._x = x; box._upd(); return;
    }
    box.dataset.built = '1';
    const keep = {};
    const rows = [['SH', [['closeCash', t('Cash'), x.eCashSH], ['closeZaadSH', 'Zaad', x.eZaadSH], ['closeEdSH', 'Edahab', x.eEdSH]]],
                  ['USD', [['closeCashUSD', t('Cash'), x.eCashUSD], ['closeZaadUSD', 'Zaad', x.eZaadUSD], ['closeEdUSD', 'Edahab', x.eEdUSD]]]];
    box.innerHTML = `<table class="tbl cmp"><tr><th></th><th class="n">${esc(t('Expected'))}</th><th class="n">${esc(t('Counted'))}</th><th></th></tr>` +
      rows.map(([cur, list]) => `<tr><td colspan="4" class="small bold" style="color:var(--navy);padding-top:12px">${cur === 'SH' ? esc(t('SHILLING (SH)')) : esc(t('DOLLARS (USD)'))}</td></tr>` +
        list.map(([n, l, e]) => `<tr><td>${esc(l)}</td><td class="n" data-e="${n}">${cur === 'USD' ? usdF(e) : fmt(e)}</td><td class="n" style="width:112px"><input name="${n}" data-exp="${e}" data-cur="${cur}" inputmode="${cur === 'USD' ? 'decimal' : 'numeric'}" value="${esc(keep[n] || '')}" placeholder="0"></td><td class="n" style="width:30px" data-tick="${n}"></td></tr>`).join('') +
        `<tr style="font-weight:750"><td>${esc(t('Total'))} ${cur}</td><td class="n" data-e="tot${cur}">${cur === 'USD' ? usdF(x.totalUSD) : fmt(x.totalSH)}</td><td class="n" data-sum="${cur}"></td><td class="n" data-tick="sum${cur}"></td></tr>`).join('') +
      `</table><div class="card tonal" style="margin:12px 0 0;padding:12px 14px"><div class="small muted bold">${esc(t('EVERYTHING IN SH (1 USD = {r})', { r: fmt(x.rate) }))}</div>
      <div class="row" style="margin-top:6px"><span class="grow">${esc(t('Expected'))}</span><b data-e="all">${fmt(x.totalSH + x.totalUSD * x.rate)}</b></div><div class="row"><span class="grow">${esc(t('Counted'))}</span><b id="allC">0</b></div>
      <div class="row"><span class="grow">${esc(t('Difference'))}</span><span id="allD"></span></div></div>
      <p class="small muted" id="cwait" style="margin:8px 0 0"></p>
      <p class="small muted" style="margin:8px 0 0">${esc(t('Totals are added up by the app. Only type what you counted in each account.'))}</p>`;
    const tick = (ok, empty) => empty ? '' : `<span class="tick ${ok ? '' : 'bad'}">${I(ok ? 'check' : 'x')}</span>`;
    box._x = x;
    const upd = box._upd = () => {
      const x = box._x, sum = { SH: 0, USD: 0 }, any = { SH: false, USD: false };
      $$('#cmp input').forEach(i => {
        const v = num(i.value), e = num(i.dataset.exp), c = i.dataset.cur; sum[c] += v; if (i.value !== '') any[c] = true;
        $(`[data-tick="${i.name}"]`).innerHTML = tick(Math.abs(v - e) < (c === 'USD' ? 0.005 : 0.5), i.value === '');
      });
      sum.USD = Math.round(sum.USD * 100) / 100;
      $('[data-sum="SH"]').textContent = fmt(sum.SH); $('[data-sum="USD"]').textContent = usdF(sum.USD);
      $('[data-tick="sumSH"]').innerHTML = tick(Math.abs(sum.SH - x.totalSH) < 0.5, !any.SH && !any.USD);
      $('[data-tick="sumUSD"]').innerHTML = tick(Math.abs(sum.USD - x.totalUSD) < 0.005, !any.SH && !any.USD);
      const all = sum.SH + sum.USD * x.rate, diff = Math.round(all - (x.totalSH + x.totalUSD * x.rate));
      $('#allC').textContent = fmt(all); $('#allD').innerHTML = diffTxt(diff);
      $('#cwait').textContent = x.waiting ? t('Includes {n} items saved on this phone, not sent yet.', { n: x.waiting }) : '';
    };
    $$('#cmp input').forEach(i => i.oninput = upd); upd();
  }
  // Sales made in this shift, newest first, each with Undo (needs the undoSales permission).
  function drawMySales(sh, srvSales) {
    const box = $('#mysales'); if (!box) return;
    const q = S.queue.filter(o => o.action === 'sale.create' && o.userId === S.user.id && o.data.business === sh.business)
      .map(o => ({ id: o.data.id, ts: o.ts, local: 1, method: o.data.method, items: o.data.items, total: A.roundStep(o.data.items.reduce((a, it) => a + (findProd(it.productId) ? A.lineTotal(Object.assign({ price: findProd(it.productId).price }, it)) : 0), 0) - num(o.data.discount)) }));
    const srv = (srvSales || []).filter(s => s.userId === S.user.id);
    const list = q.reverse().concat(srv.filter(s => !q.some(x => x.id === s.id)));
    const gone = s => s.status === 'undone' || s.status === 'void';
    box.innerHTML = list.length ? `<h3>${esc(t('Sales in my shift'))}</h3><div class="list">${list.slice(0, 40).map(s => `<div class="li" style="${gone(s) ? 'opacity:.55' : ''}"><div class="main">
      <div class="name" style="${gone(s) ? 'text-decoration:line-through' : ''}">${s.local ? esc(t('now')) : String(s.ts).slice(11, 16)} · ${money(s.total)}</div>
      <div class="sub">${(s.items || []).map(i => esc(i.name || (findProd(i.productId) || {}).name || '') + (i.unit === 'pc' ? ' · ' + fmt(i.qty) + ' ' + t('pcs') : ' ×' + fmt(i.qty))).join(', ')} · ${esc(A.methodName(s.method))}${s.local ? ' · ' + esc(t('Waiting to send')) : ''}${gone(s) ? ' · ' + esc(t('Undone')) : ''}</div></div>
      ${!gone(s) && can('undoSales') ? `<button class="btn sm ghost" data-undo="${esc(s.id)}">${I('undo', 'sm')}${esc(t('Undo'))}</button>` : ''}</div>`).join('')}</div>` : '';
    $$('[data-undo]', box).forEach(b => b.onclick = () => undoSheet(list.find(s => s.id === b.dataset.undo), () => loadLive(sh)));
  }
  function undoSheet(s, done) {
    const reasons = ['Wrong item', 'Wrong price', 'Customer changed mind', 'Wrong payment'];
    let reason = '';
    const sh = sheet({ title: t('Undo sale {t}?', { t: s.local ? t('now') : String(s.ts).slice(11, 16) }), body: `<div class="totalbox" style="padding:12px"><div class="u">${esc(A.methodName(s.method))}</div><div class="t" style="font-size:28px">${money(s.total)}</div></div>
      <div class="list"><div class="li lead"><span class="av green" style="width:34px;height:34px">${I('box', 'sm')}</span><div class="main"><div class="name">${esc(t('Stock goes back'))}</div><div class="sub">${(s.items || []).map(i => esc(i.name || (findProd(i.productId) || {}).name || '') + ' +' + fmt(i.qty) + (i.unit === 'pc' ? ' ' + t('pcs') : '')).join(' · ')}</div></div></div>
      <div class="li lead"><span class="av" style="width:34px;height:34px">${I('cash', 'sm')}</span><div class="main"><div class="name">${esc(s.method === 'credit' ? t('Customer debt goes down') : t('Expected money goes down'))}</div><div class="sub">${esc(s.method === 'credit' ? '' : t('Give the money back to the customer'))}</div></div></div></div>
      <label class="f"><span>${esc(t('Reason (required)'))}</span><div class="chips" id="rs">${reasons.map(r => `<button class="chip" data-r="${esc(r)}">${esc(t(r))}</button>`).join('')}</div></label>
      <p class="small muted">${esc(t('Only sales in your own open shift. The owner sees every undo.'))}</p>`,
      actions: [{ label: t('Back'), cls: 'ghost' }, { label: t('Undo sale'), cls: 'red', icon: 'undo', onClick: async close => {
        if (!reason) throw new Error(t('Choose a reason'));
        const qi = S.queue.findIndex(o => o.action === 'sale.create' && o.data.id === s.id);
        if (qi >= 0) {   // not sent yet: simply remove it from this phone
          const op = S.queue.splice(qi, 1)[0]; A.LS.set('queue', S.queue);
          op.data.items.forEach(it => { const p = findProd(it.productId); if (p) { const pcs = A.piecesOf(p, it.qty, it.unit); if (op.data.business === 'shop') p.stock = num(p.stock) + pcs; p.sold = Math.max(0, num(p.sold) - (A.isLoose(p) ? pcs / num(p.perPack) : num(it.qty))); } });
          if (op.data.method === 'credit') { const c = S.data.customers.find(x => x.id === op.data.customerId); if (c) c.balance = num(c.balance) - s.total; }
          A.saveData(); A.updateTop();
        } else {
          needOnline();
          const r = await api('sale.undo', { id: s.id, reason });
          if (r.stock) r.stock.forEach(x => { const p = findProd(x.id); if (p) { p.stock = x.stock; p.sold = x.sold; } });
          if (r.customer) A.upsert('customers', r.customer);
          A.saveData();
        }
        close(); toast(t('Sale undone'), 'ok'); done && done();
      } }] });
    $$('#rs .chip', sh.el).forEach(c => c.onclick = () => { reason = c.dataset.r; $$('#rs .chip', sh.el).forEach(x => x.classList.toggle('on', x === c)); });
  }
  /* ---------- Take money out: list (with undo) and form ---------- */
  const WHO_ICON = { owner: 'star', customer: 'user', supplier: 'truck', other: 'dots' };
  function moveRow(m, undoBtn) {
    const gone = m.status === 'undone', acc = A.methodName(m.account || 'cash'), wt = m.whoType || 'other';
    const what = wt === 'customer' ? t('Added to their balance') : wt === 'supplier' ? t('Paid supplier') : t(m.reason || '');
    return `<div class="li lead mv ${gone ? 'gone' : ''}" data-id="${esc(m.id)}"><span class="av ${wt === 'customer' ? 'amber' : wt === 'supplier' ? 'green' : 'gold'}">${I(WHO_ICON[wt] || 'wallet')}</span>
      <div class="main"><div class="name ${gone ? 'strike' : ''}">${esc(m.takenBy)} · ${m.currency === 'USD' ? usdF(m.amount) : money(m.amount)} · ${esc(acc)}${gone ? ` <span class="pill red">${esc(t('Undone'))}</span>` : ''}</div>
      <div class="sub">${m.pending ? esc(t('Waiting to send')) : A.when(m.ts)} · ${esc(what)}${m.note ? ' · ' + esc(m.note) : ''}${m.userName ? ' · ' + esc(t('recorded by {n}', { n: m.userName })) : ''}</div>
      ${gone ? `<div class="sub red">${esc(t('Undone by {n}: {r}', { n: m.undoneBy || '', r: t(m.undoReason || '') }))}</div>` : ''}</div>
      ${undoBtn && !gone ? `<button class="btn sm text" data-mvu>${I('undo', 'sm')}${esc(t('Undo'))}</button>` : ''}</div>`;
  }
  function drawMoves(sh, list) {
    const box = $('#moves'); if (!box) return;
    if (!list.length) { box.innerHTML = ''; return; }
    const sum = {}; list.filter(m => m.status !== 'undone').forEach(m => { const k = (m.account || 'cash').toUpperCase() + (m.currency === 'USD' ? ' USD' : ''); sum[k] = (sum[k] || 0) + num(m.amount); });
    box.innerHTML = `<h3>${esc(t('Money taken out'))}</h3><div class="list">${list.map(m => moveRow(m, m.pending || m.userName === S.user.name || isOwner())).join('')}</div>
      ${Object.keys(sum).length ? `<div class="eff">${Object.keys(sum).map(k => `<div><small>${esc(t(k.replace('EDAHAB', 'EDAHAB')))}</small><b class="dn">−${/USD/.test(k) ? usdF(sum[k]) : fmt(sum[k])}</b></div>`).join('')}</div>` : ''}`;
    $$('#moves [data-mvu]').forEach(b => b.onclick = () => moveUndo(list.find(m => m.id === b.closest('[data-id]').dataset.id), () => loadLive(sh, true)));
  }
  function moveUndo(m, done) {
    if (!m) return;
    const reasons = ['Wrong amount', 'Wrong person', 'Entered twice', 'Not taken after all'];
    sheet({ title: t('Undo money taken out'), body: `<p style="margin-top:0"><b>${esc(m.takenBy)}</b> · ${m.currency === 'USD' ? usdF(m.amount) : money(m.amount)} · ${esc(A.methodName(m.account || 'cash'))}</p>
        <label class="f"><span>${esc(t('Why'))}</span><div class="chips" id="rs">${reasons.map(r => `<button type="button" class="chip" data-r="${esc(r)}">${esc(t(r))}</button>`).join('')}</div></label>
        <p class="small muted">${esc(m.whoType === 'customer' ? t('The money goes back into the expected total, and it comes off the customer’s balance. The record stays, marked “undone”.')
          : m.whoType === 'supplier' ? t('The money goes back into the expected total, and we owe the supplier that amount again. The record stays, marked “undone”.')
          : t('The money goes back into the expected total. The record stays, marked “undone”.'))}</p>`,
      onOpen: el => $$('#rs .chip', el).forEach(c => c.onclick = () => $$('#rs .chip', el).forEach(x => x.classList.toggle('on', x === c))),
      actions: [{ label: t('Back') }, { label: t('Undo'), cls: 'red', onClick: async (close, el) => {
        const on = $('#rs .chip.on', el); if (!on) throw new Error(t('Choose a reason'));
        const qi = S.queue.findIndex(o => o.action === 'cash.out' && o.data.id === m.id);
        if (qi >= 0) {   // still on this phone: take it out and put the local balance back
          const d = S.queue[qi].data; S.queue.splice(qi, 1); A.LS.set('queue', S.queue);
          if (d.whoType === 'customer') { const c = (S.data.customers || []).find(x => x.id === d.refId); if (c) { c.balance = num(c.balance) - shOf(d); A.saveData(); } }
        } else {
          needOnline(); const r = await api('cash.undo', { id: m.id, reason: on.dataset.r });
          if (r.customer) A.upsert('customers', r.customer); if (r.supplier) A.upsert('suppliers', r.supplier);
        }
        close(); toast(t('Undone'), 'ok'); done && done();
      } }] });
  }
  const shOf = d => d.currency === 'USD' ? Math.round(num(d.amount) * A.rate()) : num(d.amount);

  /* ---------- Exchange: Zaad/Edahab <-> cash, no sale ---------- */
  const exAmt = (v, cur) => cur === 'USD' ? usdF(v) : money(v);
  function exTitle(x) {
    const acc = A.methodName(x.account);
    return (x.dir === 'out' ? t('Cash → {a}', { a: acc }) : t('{a} → Cash', { a: acc })) + ' · ' + exAmt(x.recvAmount, x.recvCur);
  }
  function drawExchanges(sh, srv, x) {
    const box = $('#exch'); if (!box) return;
    const q = S.queue.filter(o => o.action === 'exch.create' && o.data.business === sh.business).map(o => Object.assign({ pending: 1, ts: o.ts, userName: o.userName, status: 'done' }, o.data));
    const list = q.reverse().concat(srv.filter(e => !q.some(z => z.id === e.id)));
    if (!list.length) { box.innerHTML = ''; return; }
    const net = [['CASH SH', x.excashSH, 'SH'], ['CASH USD', x.excashUSD, 'USD'], ['ZAAD', x.exzaadSH, 'SH'], ['ZAAD USD', x.exzaadUSD, 'USD'], ['EDAHAB', x.exedSH, 'SH'], ['EDAHAB USD', x.exedUSD, 'USD']].filter(n => Math.abs(num(n[1])) > 0.001);
    box.innerHTML = `<h3>${esc(t('Exchanges'))}</h3><div class="list">${list.map(e => {
      const gone = e.status === 'undone', acc = A.methodName(e.account);
      const got = e.dir === 'out' ? t('Got {a} cash, sent {b} {c}', { a: exAmt(e.recvAmount, e.recvCur), b: exAmt(e.giveAmount, e.giveCur), c: acc }) : t('Got {a} {c}, gave {b} cash', { a: exAmt(e.recvAmount, e.recvCur), b: exAmt(e.giveAmount, e.giveCur), c: acc });
      const mine = e.userName === S.user.name || isOwner();
      return `<div class="li lead ${gone ? 'gone' : ''}" data-id="${esc(e.id)}"><span class="av ${e.dir === 'out' ? 'green' : 'gold'}">${I('swap')}</span><div class="main"><div class="name ${gone ? 'strike' : ''}">${esc(exTitle(e))}${gone ? ` <span class="pill red">${esc(t('Undone'))}</span>` : ''}</div>
        <div class="sub">${e.pending ? esc(t('Waiting to send')) : A.when(e.ts)} · ${esc(got)}${num(e.fee) > 0 ? ' · ' + esc(t('shop kept {x}', { x: fmt(e.fee) })) : ''}${e.customer ? ' · ' + esc(e.customer) : ''}</div></div>
        ${!gone && mine ? `<button class="btn sm text" data-exu>${I('undo', 'sm')}${esc(t('Undo'))}</button>` : ''}</div>`; }).join('')}</div>
      ${net.length ? `<div class="eff">${net.map(n => `<div><small>${esc(t(n[0]))}</small><b class="${n[1] > 0 ? 'up' : 'dn'}">${n[1] > 0 ? '+' : '−'}${n[2] === 'USD' ? usdF(Math.abs(n[1])) : fmt(Math.abs(n[1]))}</b></div>`).join('')}</div>` : ''}`;
    $$('#exch [data-exu]').forEach(b => b.onclick = async () => {
      const id = b.closest('[data-id]').dataset.id, e = list.find(z => z.id === id);
      if (!(await confirmBox(t('Undo this exchange?') + '\n' + exTitle(e), t('Undo'), 'red'))) return;
      const qi = S.queue.findIndex(o => o.action === 'exch.create' && o.data.id === id);
      try {
        if (qi >= 0) { S.queue.splice(qi, 1); A.LS.set('queue', S.queue); }
        else { needOnline(); await api('exch.undo', { id }); }
        toast(t('Exchange undone'), 'ok'); loadLive(sh, true);
      } catch (err) { toast(err.message, 'err'); }
    });
  }
  function exchangeSheet(done) {
    let dir = 'in', acct = 'zaad', rc = 'SH', gc = 'SH', giveTouched = false;
    const sh = sheet({ title: t('Exchange'), body: `
      <div class="opt on" data-dir="in"><span class="rd"></span><div><b>${esc(t('Customer sends Zaad / Edahab, takes cash'))}</b><span class="s">${esc(t('Money comes into the account, cash leaves the drawer'))}</span></div></div>
      <div class="opt" data-dir="out"><span class="rd"></span><div><b>${esc(t('Customer gives cash, gets Zaad / Edahab'))}</b><span class="s">${esc(t('Cash comes into the drawer, we send from the account'))}</span></div></div>
      <label class="f" style="margin-top:6px"><span>${esc(t('Account'))}</span><div class="seg" id="xacc"><button data-v="zaad" class="on">Zaad</button><button data-v="edahab">Edahab</button></div></label>
      <label class="f"><span id="xrl"></span><div class="row"><input class="in big grow" id="xr" inputmode="decimal" placeholder="0" autofocus><div class="seg" id="xrc" style="flex:0 0 130px;flex-wrap:nowrap"><button data-v="SH" class="on">SH</button><button data-v="USD">USD</button></div></div></label>
      <label class="f"><span id="xgl"></span><div class="row"><input class="in big grow" id="xg" inputmode="decimal" placeholder="0"><div class="seg" id="xgc" style="flex:0 0 130px;flex-wrap:nowrap"><button data-v="SH" class="on">SH</button><button data-v="USD">USD</button></div></div></label>
      <div class="eq" id="xfee"></div>
      ${input('customer', t('Customer (optional)'), '', 'placeholder="' + esc(t('Name or phone')) + '"')}
      <div class="eff" id="xeff"></div>`,
      actions: [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Save exchange'), cls: 'gold', onClick: close => {
        const r = num($('#xr', sh.el).value), g = num($('#xg', sh.el).value);
        if (!(r > 0) || !(g > 0)) throw new Error(t('Enter both amounts'));
        if (fee() < -Math.max(100, A.rate() * 0.01)) throw new Error(t('You would give more than you received'));
        enqueue('exch.create', { id: A.uid('EX'), business: S.biz, dir, account: acct, recvAmount: r, recvCur: rc, giveAmount: g, giveCur: gc, customer: $('[name=customer]', sh.el).value.trim() });
        close(); toast(t('Exchange saved'), 'ok'); done && done();
      } }] });
    const el = sh.el, val = (v, c) => num(v) * (c === 'USD' ? A.rate() : 1);
    const fee = () => Math.round(val($('#xr', el).value, rc) - val($('#xg', el).value, gc));
    const upd = () => {
      const acc = acct === 'edahab' ? 'Edahab' : 'Zaad';
      $('#xrl', el).textContent = dir === 'in' ? t('{a} received', { a: acc }) : t('Cash received');
      $('#xgl', el).textContent = dir === 'in' ? t('Cash given') : t('{a} sent', { a: acc });
      if (!giveTouched) { const r = num($('#xr', el).value); $('#xg', el).value = r ? (rc === gc ? r : gc === 'USD' ? Math.round(r / A.rate() * 100) / 100 : Math.round(r * A.rate())) : ''; }
      const f = fee(), r = num($('#xr', el).value), g = num($('#xg', el).value);
      $('#xfee', el).innerHTML = !r || !g ? esc(t('Leave the same amount for no fee.')) : f > 0 ? t('Shop keeps <b>{x}</b> (fee)', { x: esc(money(f)) }) : f < -Math.max(100, A.rate() * 0.01) ? `<span class="red">${esc(t('You would give more than you received'))}</span>` : esc(t('No fee'));
      const into = dir === 'in' ? acc.toUpperCase() : t('CASH DRAWER'), outOf = dir === 'in' ? t('CASH DRAWER') : acc.toUpperCase();
      $('#xeff', el).innerHTML = r && g ? `<div><small>${esc(into)}</small><b class="up">+${rc === 'USD' ? usdF(r) : fmt(r)}</b></div><div><small>${esc(outOf)}</small><b class="dn">−${gc === 'USD' ? usdF(g) : fmt(g)}</b></div>` : '';
    };
    $$('.opt', el).forEach(o => o.onclick = () => { dir = o.dataset.dir; $$('.opt', el).forEach(x => x.classList.toggle('on', x === o)); upd(); });
    seg($('#xacc', el), v => { acct = v; upd(); });
    seg($('#xrc', el), v => { rc = v; upd(); });
    seg($('#xgc', el), v => { gc = v; giveTouched = false; upd(); });
    $('#xr', el).oninput = upd; $('#xg', el).oninput = () => { giveTouched = true; upd(); };
    upd();
  }
  function cashOutSheet(done) {
    const owners = A.LS.get('names', []).filter(u => u.business === 'both').map(u => u.name);
    let account = 'cash', cur = 'SH', whoType = 'owner', who = owners[0] || '', reason = 'Owner took', pick = null;
    const custs = () => (S.data.customers || []).filter(c => c.business === S.biz && num(c.active) !== 0);
    const sups = () => (S.data.suppliers || []).filter(c => c.business === S.biz && num(c.active) !== 0);
    const sh = sheet({ title: t('Take money out'), body: `
      <label class="f"><span>${esc(t('Taken from'))}</span><div class="seg" id="cacc"><button data-v="cash" class="on">${esc(A.methodName('cash'))}</button><button data-v="zaad">Zaad</button><button data-v="edahab">Edahab</button></div></label>
      <label class="f"><span>${esc(t('Amount'))}</span><div class="row"><input class="in big grow" name="amt" inputmode="decimal" autofocus placeholder="0">
        <div class="seg" id="ccur" style="flex:0 0 130px;flex-wrap:nowrap"><button data-v="SH" class="on">SH</button><button data-v="USD">USD</button></div></div></label>
      <label class="f"><span>${esc(t('Who took it'))}</span><div class="who" id="wt">${[['owner', 'Owner', 'star'], ['customer', 'Customer', 'user'], ['supplier', 'Supplier', 'truck'], ['other', 'Other', 'dots']].map(([k, l, ic]) => `<button type="button" data-w="${k}" class="${k === 'owner' ? 'on' : ''}">${I(ic)}${esc(t(l))}</button>`).join('')}</div></label>
      <div id="wbox"></div>
      ${input('note', t('Note'), '')}
      <div class="eff" id="ceff"></div>`,
      actions: [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Save'), cls: 'gold', onClick: close => {
        const amt = num($('[name=amt]', sh.el).value); if (!(amt > 0)) throw new Error(t('Enter an amount'));
        const d = { id: A.uid('CO'), business: S.biz, amount: amt, currency: cur, account, whoType, reason, note: $('[name=note]', sh.el).value.trim() };
        if (whoType === 'customer' || whoType === 'supplier') {
          if (!pick) throw new Error(whoType === 'customer' ? t('Choose a customer') : t('Choose a supplier'));
          d.refId = pick.id; d.takenBy = pick.name; d.reason = whoType === 'customer' ? 'Customer took' : 'Paid supplier';
        } else {
          d.takenBy = whoType === 'owner' && who ? who : ($('#whoO', sh.el) || {}).value ? $('#whoO', sh.el).value.trim() : who;
          if (!d.takenBy) throw new Error(t('Who took the money?'));
        }
        if (whoType === 'supplier') needOnline();   // supplier balances live on the server
        enqueue('cash.out', d);
        if (whoType === 'customer') { pick.balance = num(pick.balance) + shOf(d); A.saveData(); }
        close(); toast(t('Saved'), 'ok'); done && done();
      } }] });
    const el = sh.el;
    const drawWho = () => {
      const w = $('#wbox', el); pick = whoType === 'customer' || whoType === 'supplier' ? pick : null;
      if (whoType === 'owner' || whoType === 'other') {
        const reasons = whoType === 'owner' ? ['Owner took', 'Bank deposit', 'Other'] : ['Rent', 'Worker pay', 'Transport', 'Other'];
        if (reasons.indexOf(reason) < 0) reason = reasons[0];
        w.innerHTML = (whoType === 'owner' && owners.length ? `<div class="chips" id="who" style="margin-bottom:10px">${owners.map(n => `<button type="button" class="chip ${n === who ? 'on' : ''}" data-w="${esc(n)}">${esc(n)}</button>`).join('')}</div>`
            : `<input class="in" id="whoO" placeholder="${esc(t('Name'))}" style="margin-bottom:10px">`) +
          `<label class="f"><span>${esc(t('Why'))}</span><div class="chips" id="why">${reasons.map(r => `<button type="button" class="chip ${r === reason ? 'on' : ''}" data-r="${esc(r)}">${esc(t(r))}</button>`).join('')}</div></label>`;
        $$('#who .chip', el).forEach(c => c.onclick = () => { who = c.dataset.w; $$('#who .chip', el).forEach(x => x.classList.toggle('on', x === c)); });
        $$('#why .chip', el).forEach(c => c.onclick = () => { reason = c.dataset.r; $$('#why .chip', el).forEach(x => x.classList.toggle('on', x === c)); });
        if (whoType === 'other') who = '';
      } else if (pick) {
        const bal = num(pick.balance);
        w.innerHTML = `<div class="pickc"><span class="av">${I(whoType === 'customer' ? 'user' : 'truck')}</span><div class="grow"><b>${esc(pick.name)}</b><span class="s">${esc(whoType === 'customer' ? t('Owes now: {x}', { x: money(bal) }) : t('We owe: {x}', { x: money(bal) }))}${pick.phone ? ' · ' + esc(pick.phone) : ''}</span></div><button type="button" class="btn sm text" id="chg">${esc(t('Change'))}</button></div><div id="bal"></div>`;
        $('#chg', el).onclick = () => { pick = null; drawWho(); };
      } else {
        const list = whoType === 'customer' ? custs() : sups();
        w.innerHTML = `<label class="search" style="margin-bottom:8px">${I('search')}<input id="ps" placeholder="${esc(whoType === 'customer' ? t('Search customer') : t('Search supplier'))}"></label><div class="list" id="pl" style="max-height:220px;overflow:auto"></div>`;
        const drawL = () => {
          const q = ($('#ps', el).value || '').toLowerCase();
          const l = list.filter(c => !q || (c.name + ' ' + (c.phone || '')).toLowerCase().includes(q)).slice(0, 40);
          $('#pl', el).innerHTML = l.map(c => `<div class="li tap" data-id="${esc(c.id)}"><div class="main"><div class="name">${esc(c.name)}</div><div class="sub">${esc(c.phone || '')}</div></div><span class="small ${num(c.balance) > 0 ? 'red' : 'muted'}">${fmt(c.balance)}</span></div>`).join('') || `<div class="empty small">${esc(t('Nothing found'))}</div>`;
          $$('#pl .li', el).forEach(r => r.onclick = () => { pick = list.find(c => c.id === r.dataset.id); drawWho(); upd(); });
        };
        $('#ps', el).oninput = drawL; drawL();
      }
      upd();
    };
    const upd = () => {
      const amt = num($('[name=amt]', el).value), sh2 = cur === 'USD' ? Math.round(amt * A.rate()) : amt, accN = A.methodName(account);
      const a = amt ? `<div><small>${esc(account === 'cash' ? t('CASH DRAWER') : accN.toUpperCase())}${cur === 'USD' ? ' USD' : ''}</small><b class="dn">−${cur === 'USD' ? usdF(amt) : fmt(amt)}</b></div>` : '';
      let b = '';
      if (amt && pick && whoType === 'customer') b = `<div><small>${esc(t('{n} OWES', { n: pick.name.split(' ')[0].toUpperCase() }))}</small><b style="color:#8A4B00">+${fmt(sh2)}</b></div>`;
      if (amt && pick && whoType === 'supplier') b = `<div><small>${esc(t('OWED TO {n}', { n: pick.name.split(' ')[0].toUpperCase() }))}</small><b class="up">−${fmt(sh2)}</b></div>`;
      $('#ceff', el).innerHTML = a + b;
      const bb = $('#bal', el);
      if (bb) bb.innerHTML = amt && pick ? `<div class="bal ${whoType === 'supplier' ? 'sup' : ''}">${esc(whoType === 'customer' ? t('{n}’s balance: {a} → {b}', { n: pick.name.split(' ')[0], a: fmt(pick.balance), b: money(num(pick.balance) + sh2) })
        : t('We owe {n}: {a} → {b}', { n: pick.name.split(' ')[0], a: fmt(pick.balance), b: money(num(pick.balance) - sh2) }))}${cur === 'USD' ? ` <span class="small">(${esc(usdF(amt))} = ${fmt(sh2)})</span>` : ''}</div>` : '';
    };
    seg($('#cacc', el), v => { account = v; upd(); });
    seg($('#ccur', el), v => { cur = v; upd(); });
    $$('#wt button', el).forEach(b => b.onclick = () => { whoType = b.dataset.w; pick = null; who = whoType === 'owner' ? owners[0] || '' : ''; $$('#wt button', el).forEach(x => x.classList.toggle('on', x === b)); drawWho(); });
    $('[name=amt]', el).oninput = upd;
    drawWho();
  }
  async function closeShift(sh) {
    needOnline();
    await A.syncNow();
    if (S.queue.some(o => o.userId === S.user.id)) throw new Error(t('Some sales are not sent yet. Connect to the internet and try again.'));
    if (!(await confirmBox(t('End the shift now?'), t('End shift'), 'red'))) return;
    const v = n => num(($(`#cmp [name=${n}]`) || {}).value);
    const r = await api('shift.close', { id: sh.id, closeCash: v('closeCash'), closeCashUSD: v('closeCashUSD'), closeZaadSH: v('closeZaadSH'), closeZaadUSD: v('closeZaadUSD'),
      closeEdSH: v('closeEdSH'), closeEdUSD: v('closeEdUSD'), note: ($('#cnote') || {}).value || '' });
    A.upsert('shifts', r.shift);
    go('shift');
    shiftResult(r.shift);
  }
  function diffTxt(d) { d = Math.round(num(d)); return d === 0 ? `<span class="pill green">${I('check', 'sm')}${esc(t('Correct'))}</span>` : d > 0 ? `<span class="pill gold">+${fmt(d)} ${esc(t('extra'))}</span>` : `<span class="pill red">${fmt(d)} ${esc(t('short'))}</span>`; }
  function shiftResult(s) {
    const tk = (a, b, usd) => `<span class="tick ${Math.abs(num(a) - num(b)) < (usd ? 0.005 : 0.5) ? '' : 'bad'}">${I(Math.abs(num(a) - num(b)) < (usd ? 0.005 : 0.5) ? 'check' : 'x')}</span>`;
    if (s.eCashSH === undefined || s.eCashSH === '') {   // shifts closed before v1.2
      return A.alertBox(t('Shift ended'), `<table class="tbl"><tr><th></th><th class="n">${esc(t('Expected'))}</th><th class="n">${esc(t('Counted'))}</th><th class="n">${esc(t('Difference'))}</th></tr>
        <tr><td>${esc(t('Cash'))}</td><td class="n">${fmt(s.expectedCash)}</td><td class="n">${fmt(s.closeCash)}</td><td class="n">${diffTxt(s.diffCash)}</td></tr>
        <tr><td>Zaad</td><td class="n">${fmt(s.expectedZaad)}</td><td class="n">${fmt(num(s.closeZaadSH) + num(s.closeZaadUSD) * num(s.rate))}</td><td class="n">${diffTxt(s.diffZaad)}</td></tr>
        <tr><td>Edahab</td><td class="n">${fmt(s.expectedEd)}</td><td class="n">${fmt(num(s.closeEdSH) + num(s.closeEdUSD) * num(s.rate))}</td><td class="n">${diffTxt(s.diffEd)}</td></tr></table>`);
    }
    const row = (l, e, c, usd, b) => `<tr${b ? ' style="font-weight:750"' : ''}><td>${l}</td><td class="n">${usd ? usdF(e) : fmt(e)}</td><td class="n">${usd ? usdF(c) : fmt(c)}</td><td class="n">${tk(e, c, usd)}</td></tr>`;
    A.alertBox(t('Shift ended'), `<table class="tbl cmp"><tr><th></th><th class="n">${esc(t('Expected'))}</th><th class="n">${esc(t('Counted'))}</th><th></th></tr>
      <tr><td colspan="4" class="small bold" style="color:var(--navy)">SH</td></tr>${row(esc(t('Cash')), s.eCashSH, s.closeCash)}${row('Zaad', s.eZaadSH, s.closeZaadSH)}${row('Edahab', s.eEdSH, s.closeEdSH)}${row(esc(t('Total')) + ' SH', s.totalExpSH, s.totalCountSH, false, 1)}
      <tr><td colspan="4" class="small bold" style="color:var(--navy)">USD</td></tr>${row(esc(t('Cash')), s.eCashUSD, s.closeCashUSD, 1)}${row('Zaad', s.eZaadUSD, s.closeZaadUSD, 1)}${row('Edahab', s.eEdUSD, s.closeEdUSD, 1)}${row(esc(t('Total')) + ' USD', s.totalExpUSD, s.totalCountUSD, 1, 1)}</table>
      <div class="row" style="margin-top:12px"><b class="grow">${esc(t('Everything in SH'))}</b>${diffTxt(s.diffAll)}</div>
      <p class="small muted">${esc(t('USD is counted at {r} SH.', { r: fmt(s.rate) }))}</p>`);
  }
  async function loadShiftHistory() {
    const box = $('#hist') || (() => { const d = document.createElement('div'); d.id = 'hist'; $('#main').appendChild(d); return d; })();
    A.cachedCall('shift.list', { business: S.biz, from: A.addDays(A.today(), -7), to: A.today() }, r => {
      if (!$('#hist')) return;
      box.innerHTML = `<h3>${esc(t('Recent shifts'))}</h3><div class="list">${r.shifts.map(s => `<div class="li tap" data-id="${esc(s.id)}"><div class="main"><div class="name">${esc(s.userName)} · ${A.when(s.openTs)}</div>
        <div class="sub">${s.status === 'open' ? esc(t('Open')) : esc(t('Cash')) + ' ' + fmt(s.closeCash) + (num(s.closeCashUSD) ? ' + ' + usdF(s.closeCashUSD) : '')}</div></div>${s.status === 'closed' ? diffTxt(s.diffAll !== '' && s.diffAll !== undefined ? s.diffAll : s.diffCash) : '<span class="pill green">' + esc(t('Open')) + '</span>'}</div>`).join('') || `<div class="empty">${esc(t('No shifts'))}</div>`}</div>`;
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
      ${c.phone ? `<a class="btn" href="tel:${esc(c.phone)}">${I('phone')}${esc(t('Call'))}</a><button class="btn" id="wa">${I('chat')}WhatsApp</button>` : ''}${can('deleteCustomers') ? `<button class="btn ghost red" id="del" style="color:var(--red)">${I('trash')}${esc(t('Delete'))}</button>` : ''}</div>
      <div class="spacer"></div><h3>${esc(t('History'))}</h3><div id="led">${skel(2)}</div>` });
    const el = sh.el;
    $('#pay', el).onclick = () => { sh.close(); paymentForm(c, redraw); };
    $('#ed', el).onclick = () => { sh.close(); customerForm(c, redraw); };
    if ($('#del', el)) $('#del', el).onclick = () => withBusy($('#del', el), async () => {
      needOnline();
      if (!(await confirmBox(t('Delete {n}?', { n: c.name }), t('Delete'), 'red'))) return;
      await api('cust.delete', { id: c.id });
      S.data.customers = S.data.customers.filter(x => x.id !== c.id); A.saveData(); sh.close(); toast(t('Deleted'), 'ok'); if (redraw) redraw();
    });
    const wa = $('#wa', el); if (wa) wa.onclick = () => A.openWhatsApp(c.phone, t('Hello {n}, your balance at {b} is {x}. Thank you.', { n: c.name, b: biz, x: money(c.balance) }));
    A.cachedCall('cust.ledger', { customerId: c.id }, r => {
      $('#led', el).innerHTML = `<div class="list">${r.ledger.map(l => `<div class="li"><div class="main"><div class="name">${esc(t({ sale: 'Credit sale', payment: 'Payment', refund: 'Refund', void: 'Undone sale', reset: 'Balance reset', opening: 'Carried forward', loan: 'Money taken', loanundo: 'Money taken — undone' }[l.type] || l.type))}${(l.type === 'loan' || l.type === 'loanundo') && l.method ? ' · ' + esc(A.methodName(l.method)) : ''}</div>
        <div class="sub">${A.when(l.ts)} · ${esc(l.userName)} ${l.method && l.type === 'payment' ? '· ' + esc(A.methodName(l.method)) : ''}${l.note && (l.type === 'loan' || l.type === 'loanundo') ? ' · ' + esc(l.note) : ''}</div></div>${(() => { const v = l.type === 'sale' || l.type === 'loan' ? num(l.amount) : (l.type === 'reset' || l.type === 'opening') ? num(l.amount) : -num(l.amount); return `<b class="${v > 0 ? 'red' : 'green'}">${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}</b>`; })()}</div>`).join('') || `<div class="empty">—</div>`}</div>`;
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
  // Expenses: category from a dropdown, amount in SH or USD, what it was for, and a note. Undo only on the same day.
  Screens.expenses = function (main) {
    if (!can('expenses')) return noPerm(main);
    const cats = String(setting('expenseCats') || 'Other').split(',').map(x => x.trim()).filter(Boolean);
    if (cats.indexOf('Other') < 0) cats.push('Other');
    S.expDay = S.expDay && can('viewReports') ? S.expDay : A.today();
    main.innerHTML = `<div class="card"><form id="f" autocomplete="off">
      <label class="f"><span>${esc(t('Category'))}</span><select class="in" name="category" id="ecat"><option value="">${esc(t('Choose a category…'))}</option>${cats.map(c => `<option value="${esc(c)}">${esc(t(c))}</option>`).join('')}</select></label>
      <label class="f"><span>${esc(t('Currency'))}</span><div class="seg" data-name="currency" id="ecur"><button data-v="SH" class="on">${esc(t('Shillings (SH)'))}</button><button data-v="USD">${esc(t('Dollars (USD)'))}</button></div></label>
      <label class="f"><span id="eamtL">${esc(t('Amount (SH)'))}</span><input class="in big" name="amount" inputmode="decimal" placeholder="0"><span class="small muted" id="eeq"></span></label>
      <label class="f"><span>${esc(t('Paid with'))}</span>${methodSeg('method', ['cash', 'zaad', 'edahab'], 'cash')}</label>
      <label class="f"><span id="edescL">${esc(t('What was it for?'))}</span><textarea class="in" name="description" rows="2" maxlength="200" placeholder="${esc(t('e.g. Electricity bill for October'))}"></textarea></label>
      <label class="f"><span>${esc(t('Note (optional)'))}</span><input class="in" name="note" maxlength="120" placeholder="${esc(t('e.g. receipt is in the drawer'))}"></label>
      <button class="btn gold block lg">${I('check')}${esc(t('Save expense'))}</button>
      <p class="small muted center" style="margin:8px 0 0">${esc(t('You can undo an expense only on the same day.'))}</p></form></div>
      <div class="row" style="align-items:center;margin:14px 2px 6px"><h3 class="grow" style="margin:0">${esc(S.expDay === A.today() ? t('Today') : S.expDay)}</h3>
        ${can('viewReports') ? `<input type="date" class="in" id="eday" value="${S.expDay}" max="${A.today()}" style="width:auto">` : ''}</div><div id="el"></div>`;
    $$('#f .seg').forEach(x => seg(x, () => upd()));
    const f = $('#f'), cur = () => $('#ecur').dataset.value;
    const upd = () => {
      const usd = cur() === 'USD', v = num($('[name=amount]', f).value);
      $('#eamtL').textContent = usd ? t('Amount ($)') : t('Amount (SH)');
      $('#eeq').textContent = usd && v > 0 ? '= ' + money(Math.round(v * A.rate())) + ' (1 USD = ' + fmt(A.rate()) + ')' : '';
      $('#edescL').textContent = $('#ecat').value === 'Other' ? t('What was it for? (needed for “Other”)') : t('What was it for?');
    };
    $('[name=amount]', f).oninput = upd; $('#ecat').onchange = upd;
    if ($('#eday')) $('#eday').onchange = e => { S.expDay = e.target.value || A.today(); A.render(); };
    f.onsubmit = e => {
      e.preventDefault();
      const cat = $('#ecat').value; if (!cat) return toast(t('Choose a category'), 'err');
      const usd = cur() === 'USD', amt = usd ? Math.round(parseFloat(String($('[name=amount]', f).value).replace(/,/g, '')) * 100) / 100 : num($('[name=amount]', f).value);
      if (!(amt > 0)) return toast(t('Enter an amount'), 'err');
      const desc = $('[name=description]', f).value.trim();
      if (cat === 'Other' && !desc) { $('[name=description]', f).focus(); return toast(t('Write what the money was for'), 'err'); }
      const d = { id: A.uid('E'), business: S.biz, category: cat, amount: amt, currency: usd ? 'USD' : 'SH', method: $('[data-name=method]', f).dataset.value, description: desc, note: $('[name=note]', f).value.trim() };
      enqueue('exp.create', d);
      S.localExp = (S.localExp || []).concat([Object.assign({ ts: new Date().toISOString(), date: A.today(), userName: S.user.name, pending: 1, usdAmount: usd ? amt : '' }, d, { amount: usd ? Math.round(amt * A.rate()) : amt })]);
      toast(t('Expense saved'), 'ok');
      $('[name=amount]', f).value = ''; $('[name=description]', f).value = ''; $('[name=note]', f).value = ''; $('#ecat').value = ''; upd();
      if (S.expDay !== A.today()) { S.expDay = A.today(); A.render(); } else loadExp();
    };
    upd(); loadExp();
  };
  function expRow(e) {
    const gone = e.status === 'undone', mine = e.userName === S.user.name || isOwner();
    const canUndo = !gone && !e.ref && mine && (e.date || A.today()) === A.today();
    const amt = e.currency === 'USD' ? usdF(e.usdAmount) + ` <span class="small muted">(${fmt(e.amount)})</span>` : fmt(e.amount);
    return `<div class="li lead exp ${gone ? 'gone' : ''}" data-id="${esc(e.id)}"><span class="av ${gone ? 'gray' : e.currency === 'USD' ? 'green' : 'gold'}">${I('wallet')}</span>
      <div class="main"><div class="name">${esc(t(e.category))}${e.currency === 'USD' ? ' <span class="pill">USD</span>' : ''}${gone ? ` <span class="pill red">${esc(t('Undone'))}</span>` : ''}</div>
        ${e.description ? `<div class="desc">${esc(e.description)}</div>` : ''}${e.note ? `<div class="sub">${I('edit', 'sm')} ${esc(e.note)}</div>` : ''}
        <div class="sub">${esc(A.methodName(e.method))} · ${esc(e.userName || '')}${e.ts ? ' · ' + esc(A.when(e.ts)) : ''}${e.pending ? ' · ' + esc(t('Waiting to send')) : ''}</div>
        ${gone ? `<div class="sub red">${esc(t('Undone by {n}: {r}', { n: e.undoneBy || '', r: t(e.undoReason || '') }))}</div>` : ''}</div>
      <div class="end"><b class="${gone ? 'strike' : ''}">${amt}</b>${canUndo ? `<button class="btn sm text" data-undo>${I('undo', 'sm')}${esc(t('Undo'))}</button>` : ''}</div></div>`;
  }
  async function loadExp() {
    const day = S.expDay || A.today();
    const draw = (srv) => {
      const box = $('#el'); if (!box) return;
      const local = day === A.today() ? (S.localExp || []).filter(e => e.business === S.biz && S.queue.some(o => o.data && o.data.id === e.id)) : [];
      const list = local.concat((srv || []).filter(e => !local.some(l => l.id === e.id)));
      const total = list.filter(e => e.status !== 'undone').reduce((a, e) => a + num(e.amount), 0);
      box.innerHTML = list.length ? `<div class="list">${list.map(expRow).join('')}</div><p class="small muted" style="text-align:right;margin:8px 4px">${esc(t('Total'))}: <b>${money(total)}</b></p>`
        : `<div class="empty">${esc(day === A.today() ? t('No expenses today') : t('No expenses on this day'))}</div>`;
      $$('#el [data-undo]').forEach(b => b.onclick = () => expUndo(list.find(e => e.id === b.closest('[data-id]').dataset.id)));
    };
    const q = { business: S.biz, from: day, to: day };
    const hit = A.cacheGet('exp.list', q); draw(hit ? hit.expenses : []);
    A.cachedCall('exp.list', q, r => draw(r.expenses)).catch(() => {});
  }
  function expUndo(e) {
    if (!e) return;
    const reasons = ['Wrong amount', 'Wrong category', 'Entered twice', 'Not paid after all'];
    sheet({ title: t('Undo expense'), body: `<p style="margin-top:0"><b>${esc(t(e.category))}</b> · ${e.currency === 'USD' ? usdF(e.usdAmount) : money(e.amount)}${e.description ? '<br><span class="muted">' + esc(e.description) + '</span>' : ''}</p>
        <label class="f"><span>${esc(t('Why'))}</span><div class="chips" id="rs">${reasons.map(r => `<button type="button" class="chip" data-r="${esc(r)}">${esc(t(r))}</button>`).join('')}</div></label>
        <p class="small muted">${esc(t('The money goes back into the expected drawer. The record stays, marked “undone”.'))}</p>`,
      onOpen: el => $$('#rs .chip', el).forEach(c => c.onclick = () => { $$('#rs .chip', el).forEach(x => x.classList.toggle('on', x === c)); }),
      actions: [{ label: t('Back') }, { label: t('Undo expense'), cls: 'red', onClick: async (close, el) => {
        const on = $('#rs .chip.on', el); if (!on) return toast(t('Choose a reason'), 'err');
        const qi = S.queue.findIndex(o => o.action === 'exp.create' && o.data.id === e.id);
        if (qi >= 0) {   // still on this phone: just take it out
          S.queue.splice(qi, 1); A.LS.set('queue', S.queue); S.localExp = (S.localExp || []).filter(x => x.id !== e.id);
        } else {
          needOnline(); await api('exp.undo', { id: e.id, reason: on.dataset.r });
        }
        close(); toast(t('Expense undone'), 'ok'); loadExp();
      } }] });
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
    if ((r.undone || []).length) alerts.push([can('viewInsights') ? 'insights' : 'reports', 'undo', t('{n} sales undone today', { n: r.undone.length }), 'red']);
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
      ${(r.shifts || []).length ? `<h3>${esc(t('Shifts today'))}</h3><div class="list">${r.shifts.slice().reverse().map(x => `<div class="li lead"><span class="av ${x.status === 'open' ? 'green' : 'gray'}">${I(x.status === 'open' ? 'clock' : 'lock')}</span><div class="main">
        <div class="name">${esc(x.userName)} · ${esc(A.bizName(x.business))}</div><div class="sub">${esc(t('Started'))} <b>${String(x.openTs).slice(11, 16)}</b>${x.scheduled ? ' · ' + esc(t('scheduled {t}', { t: x.scheduled })) : ''}${x.closeTs ? ' · ' + esc(t('ended')) + ' ' + String(x.closeTs).slice(11, 16) + (x.worked !== '' ? ' · ' + Math.floor(x.worked / 60) + 'h ' + (x.worked % 60) + 'm' : '') : ''}</div>
        <div style="margin-top:4px">${x.lateBy ? `<span class="pill gold">${esc(t('{n} min late', { n: x.lateBy }))}</span>` : `<span class="pill green">${esc(t('On time'))}</span>`} ${x.status === 'open' ? `<span class="pill green">${esc(t('Open'))}</span>` : diffTxt(x.diffAll !== '' && x.diffAll !== undefined ? x.diffAll : x.diffCash)}</div></div></div>`).join('')}</div>` : ''}
      ${(r.exchanges || []).length ? `<h3>${esc(t('Exchanges'))}</h3><div class="list">${r.exchanges.map(e => `<div class="li lead"><span class="av ${e.dir === 'out' ? 'green' : 'gold'}">${I('swap')}</span><div class="main"><div class="name">${esc(exTitle(e))}</div><div class="sub">${A.when(e.ts)} · ${esc(e.userName)}${num(e.fee) > 0 ? ' · ' + esc(t('shop kept {x}', { x: fmt(e.fee) })) : ''}${e.customer ? ' · ' + esc(e.customer) : ''}</div></div></div>`).join('')}</div>` : ''}
      ${(r.cashMoves || []).length ? `<h3>${esc(t('Money taken out'))}</h3><div class="list">${r.cashMoves.map(m => moveRow(m, false)).join('')}</div>` : ''}
      <h3>${esc(t('Money in shifts'))}</h3><div class="list">${r.balances.map(b => `
        ${b.open.map(o => `<div class="li lead"><span class="av green">${I('clock')}</span><div class="main"><div class="name">${esc(A.bizName(b.business))} · ${esc(o.userName)}</div>
          <div class="sub" style="white-space:normal">${esc(t('Expected now'))}: ${esc(t('Cash'))} ${fmt(o.expectedCash)} · Zaad ${fmt(o.expectedZaad)} · Edahab ${fmt(o.expectedEd)}</div></div><span class="pill green">${esc(t('Open'))}</span></div>`).join('')}
        ${b.last ? `<div class="li lead"><span class="av gray">${I('lock')}</span><div class="main"><div class="name">${esc(A.bizName(b.business))} · ${esc(t('last closed'))} ${A.when(b.last.closeTs)}</div>
          <div class="sub" style="white-space:normal">${esc(b.last.userName)} · ${esc(t('Cash'))} ${fmt(b.last.cash)} · Zaad ${fmt(b.last.zaad)} · Edahab ${fmt(b.last.edahab)}</div></div>${diffTxt(b.last.diffCash)}</div>` : ''}`).join('') || `<div class="empty">${I('clock')}${esc(t('No shifts'))}</div>`}</div>
      <div class="grid2"><div><h3>${esc(t('Best sellers'))}</h3><div class="list">${r.topItems.slice(0, 5).map((i, n) => `<div class="li"><span class="av gold" style="width:28px;height:28px;border-radius:9px;font-size:13px">${n + 1}</span><div class="main name">${esc(i.name)}</div><span class="muted small">${soldTxt(i)}</span></div>`).join('') || `<div class="empty small">—</div>`}</div></div>
        <div><h3>${esc(t('Top debtors'))}</h3><div class="list">${r.debts.slice(0, 5).map(c => `<div class="li"><div class="main name">${esc(c.name)}</div><b class="red small">${fmt(c.balance)}</b></div>`).join('') || `<div class="empty small">—</div>`}</div></div></div>
      <div class="col" style="margin-top:4px">${can('viewInsights') ? `<button class="btn block" id="ins">${I('chart')}${esc(t('Insights'))}</button>` : ''}<button class="btn block" id="rep">${I('file')}${esc(t('Full reports'))}</button></div>`;
    $$('[data-go]', box).forEach(x => x.onclick = () => go(x.dataset.go));
    $('#rep', box).onclick = () => go('reports');
    if ($('#ins', box)) $('#ins', box).onclick = () => go('insights');
  }

  /* ======================= REPORTS ======================= */
  Screens.reports = function (main) {
    if (!can('viewReports')) return noPerm(main);
    const bizs = A.myBiz();
    const st = S.repState || (S.repState = { biz: bizs.length > 1 ? 'all' : bizs[0], from: A.today(), to: A.today(), preset: 'today' });
    const presets = { today: [A.today(), A.today()], yesterday: [A.addDays(A.today(), -1), A.addDays(A.today(), -1)], week: [A.addDays(A.today(), -6), A.today()], month: [A.today().slice(0, 8) + '01', A.today()] };
    main.innerHTML = head(t('Choose business and dates'), `${can('viewInsights') ? `<button class="btn sm noprint" id="goIns">${I('chart', 'sm')}${esc(t('Insights'))}</button>` : ''}<button class="iconbtn tonal round noprint" onclick="window.print()" aria-label="print">${I('printer', 'sm')}</button>`) + `<div class="card noprint">
      ${bizs.length > 1 ? `<div class="chips" id="rb" style="margin-bottom:8px">${['all', 'shop', 'food'].map(b => `<button class="chip ${st.biz === b ? 'on' : ''}" data-v="${b}">${esc(b === 'all' ? t('Shop + Fast Food') : A.bizName(b))}</button>`).join('')}</div>` : ''}
      <div class="chips" id="pr">${[['today', t('Today')], ['yesterday', t('Yesterday')], ['week', t('7 days')], ['month', t('This month')]].map(p => `<button class="chip ${st.preset === p[0] ? 'on' : ''}" data-v="${p[0]}">${esc(p[1])}</button>`).join('')}</div>
      <div class="grid2" style="margin-top:8px"><label class="f"><span>${esc(t('From'))}</span><input class="in" type="date" id="rf" value="${st.from}"></label><label class="f"><span>${esc(t('To'))}</span><input class="in" type="date" id="rt" value="${st.to}"></label></div></div>
      <div id="rep">${skel(3)}</div>`;
    $$('#rb .chip').forEach(c => c.onclick = () => { st.biz = c.dataset.v; $$('#rb .chip').forEach(x => x.classList.toggle('on', x === c)); load(); });
    $$('#pr .chip').forEach(c => c.onclick = () => { st.preset = c.dataset.v; [st.from, st.to] = presets[st.preset]; $('#rf').value = st.from; $('#rt').value = st.to; $$('#pr .chip').forEach(x => x.classList.toggle('on', x === c)); load(); });
    $('#rf').onchange = $('#rt').onchange = () => { st.from = $('#rf').value; st.to = $('#rt').value; st.preset = ''; $$('#pr .chip').forEach(x => x.classList.remove('on')); load(); };
    if ($('#goIns')) $('#goIns').onclick = () => go('insights');
    const load = () => {
      const q = { business: st.biz, from: st.from, to: st.to };
      const until = setting('archivedUntil');
      const note = until && st.from < until ? archiveNote(until) : '';
      if (!A.cacheGet('report', q) && $('#rep')) $('#rep').innerHTML = skel(3);
      return A.cachedCall('report', q, r => { if ($('#rep')) { drawReport($('#rep'), r); if (note) $('#rep').insertAdjacentHTML('afterbegin', note); } }).catch(e => { if ($('#rep')) $('#rep').innerHTML = notYet(e); });
    };
    if (S.queue.length) A.syncNow().then(load);
    load();
  };
  function archiveNote(until) {
    let links = []; try { links = JSON.parse(setting('archiveLinks') || '[]'); } catch (e) {}
    return `<div class="card alert amber small">${I('box', 'sm')} ${esc(t('Data before {d} is in the Archive.', { d: until }))} ${links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener"><b>${esc(l.name)}</b></a>`).join(' · ')}</div>`;
  }
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
        r.topItems.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${soldTxt(i)}</td><td class="n">${fmt(i.revenue)}</td>${P ? `<td class="n">${fmt(i.profit)}</td>` : ''}</tr>`))}</div>
      ${(r.looseSales || []).length ? `<div class="card"><h3>${esc(t('Loose sales'))}</h3>${tbl([t('Item'), t('Packets'), t('Pieces'), t('Money')].concat(P ? [t('Profit')] : []),
        r.looseSales.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${fmt(i.qty)}</td><td class="n">${fmt(i.pcs)}</td><td class="n">${fmt(i.revenue)}</td>${P ? `<td class="n green">${fmt(i.profit)}</td>` : ''}</tr>`))}
        <p class="small muted" style="margin:8px 2px 0">${esc(t('Profit counts each piece at its real cost (packet cost ÷ pieces in a packet).'))}</p></div>` : ''}
      <div class="card"><h3>${esc(t('Sales by employee'))}</h3>${tbl([t('Name'), t('Business'), t('Sales'), t('Total')], r.employees.map(e => `<tr><td>${esc(e.name)}</td><td class="n">${esc(A.bizName(e.business))}</td><td class="n">${e.count}</td><td class="n">${fmt(e.total)}</td></tr>`))}</div>
      <div class="card"><h3>${esc(t('Expenses by category'))}</h3>${tbl([t('Category'), t('Business'), t('Amount')], r.expenses.map(e => `<tr><td>${esc(t(e.category))}</td><td class="n">${esc(A.bizName(e.business))}</td><td class="n">${fmt(e.amount)}</td></tr>`))}</div>
      <div class="card"><h3>${esc(t('Money balances from shifts'))}</h3>${tbl([t('Business'), t('Cash'), 'Zaad', 'Edahab', t('Cash difference')], r.balances.map(b => b.last ? `<tr><td>${esc(A.bizName(b.business))} <span class="small muted">${A.when(b.last.closeTs)}</span></td><td class="n">${fmt(b.last.cash)}</td><td class="n">${fmt(b.last.zaad)}</td><td class="n">${fmt(b.last.edahab)}</td><td class="n">${diffTxt(b.last.diffCash)}</td></tr>` : ''))}
        ${r.shifts.length ? `<div class="spacer"></div>${tbl([t('Shift'), t('Cash'), t('Expected'), t('Difference')], r.shifts.map(s => `<tr><td>${esc(s.userName)} ${A.when(s.openTs)}</td><td class="n">${s.status === 'closed' ? fmt(s.closeCash) : esc(t('Open'))}</td><td class="n">${s.status === 'closed' ? fmt(s.expectedCash) : ''}</td><td class="n">${s.status === 'closed' ? diffTxt(s.diffCash) : ''}</td></tr>`))}` : ''}</div>
      <div class="card"><h3>${esc(t('Customer debts'))} · ${money(r.totalDebt)}</h3>${tbl([t('Customer'), t('Phone'), t('Owes')], r.debts.map(c => `<tr><td>${esc(c.name)}</td><td class="n">${esc(c.phone || '')}</td><td class="n red">${fmt(c.balance)}</td></tr>`))}</div>
      ${r.suppliersOwed.length ? `<div class="card"><h3>${esc(t('We owe suppliers'))}</h3>${tbl([t('Supplier'), t('Amount')], r.suppliersOwed.map(s => `<tr><td>${esc(s.name)}</td><td class="n">${fmt(s.balance)}</td></tr>`))}</div>` : ''}
      <div class="card"><h3>${esc(t('Low stock'))}</h3>${tbl([t('Item'), t('Stock'), t('Low level')], r.lowStock.map(p => `<tr><td>${esc(p.name)}</td><td class="n red">${esc(p.stockTxt || fmt(p.stock))}</td><td class="n">${fmt(p.lowStock)}${p.loose ? ' ' + esc(t('pk')) : ''}</td></tr>`).concat(r.lowIngredients.map(g => `<tr><td>${esc(t(g.name))} (${esc(t(g.unit))})</td><td class="n red">${fmt(g.stock)}</td><td class="n">${fmt(g.lowLevel)}</td></tr>`)))}</div>
      ${r.expiring.length ? `<div class="card"><h3>${esc(t('Expired / expiring'))}</h3>${tbl([t('Item'), t('Expiry'), t('Stock')], r.expiring.map(p => `<tr><td>${esc(p.name)}</td><td class="n ${p.expired ? 'red' : 'amber'}">${esc(p.expiry)}</td><td class="n">${esc(findProd(p.id) ? A.stockTxt(findProd(p.id), p.stock) : fmt(p.stock))}</td></tr>`))}</div>` : ''}
`;
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
        ['reports', 'file', t('Reports'), t('Sales, profit, debts, balances'), can('viewReports'), 'gold'],
        ['insights', 'chart', t('Insights'), t('This month vs last, busy hours, attendance'), can('viewInsights'), 'gold'],
        ['users', 'shield', t('Users'), t('Accounts, PINs and permissions'), can('manageUsers'), 'gold'],
        ['settings', 'sliders', t('Settings'), t('Rates, accounts, hours, install'), can('settings'), 'gold'],
        ['audit', 'file', t('Audit log'), t('Who did what and when'), can('audit'), 'gold']]],
      [t('App'), [
        ['sync', 'sync', t('Sync status'), t('Sales waiting to be sent'), true, 'gray', S.failed.length],
        ['emails', 'bell', t('My email reports'), t('Daily, weekly or monthly'), can('emailReports'), 'gray'],
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
      if (filter === 'low') l = l.filter(p => A.isLow(p));
      if (filter === 'exp') l = l.filter(p => p.expiry && p.expiry <= lim);
      if (v) l = l.filter(p => String(p.name).toLowerCase().includes(v) || String(p.barcode).includes(v) || String(p.category || '').toLowerCase().includes(v));
      l.sort((a, b) => String(a.name).localeCompare(b.name));
      $('#pl').innerHTML = `<div class="small muted" style="margin:0 4px 6px">${l.length} ${esc(t('items'))}</div><div class="list">${l.slice(0, 300).map(p => `<div class="li tap lead" data-id="${esc(p.id)}"><span class="av ${!food && A.isLow(p) ? 'red' : 'gold'}">${I(food ? 'food' : 'box')}</span><div class="main"><div class="name">${num(p.fav) ? I('star', 'sm') + ' ' : ''}${esc(p.name)}${looseTag(p)}</div>
        <div class="sub">${esc(p.category || '')} ${p.barcode ? '· ' + esc(p.barcode) : ''} ${p.expiry ? `· <span class="${p.expiry < A.today() ? 'red' : p.expiry <= lim ? 'amber' : ''}">${esc(t('Exp'))} ${esc(p.expiry)}</span>` : ''}</div></div>
        <div class="right"><b>${fmt(p.price)}</b>${!food && can('viewStock') ? `<div class="small ${A.isLow(p) ? 'red bold' : 'muted'}">${esc(t('Stock'))} ${esc(A.stockTxt(p))}</div>` : ''}</div></div>`).join('') || `<div class="empty">${esc(t('Nothing found'))}</div>`}</div>`;
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
      <label class="f"><span>${esc(t('Price in'))}</span><div class="seg" id="pcurP"><button type="button" data-v="SH" class="${p.priceCur === 'USD' ? '' : 'on'}" ${isNew || cp ? '' : 'disabled'}>${esc(t('Shillings (SH)'))}</button><button type="button" data-v="USD" class="${p.priceCur === 'USD' ? 'on' : ''}" ${isNew || cp ? '' : 'disabled'}>${esc(t('Dollars (USD)'))}</button></div></label>
      <div id="shP" class="grid2">${moneyInput('price', t('Selling price (SH)'), p.price, isNew || cp ? '' : 'readonly')}${showCost ? moneyInput('cost', t('Cost price (SH)'), p.cost, isNew || cp ? '' : 'readonly') : ''}</div>
      <div id="usdP" class="hidden"><div class="grid2">${input('priceUSD', t('Selling price ($)'), p.priceUSD || '', 'inputmode="decimal" ' + (isNew || cp ? '' : 'readonly'))}${showCost ? input('costUSD', t('Cost price ($)'), p.costUSD || '', 'inputmode="decimal" ' + (isNew || cp ? '' : 'readonly')) : ''}</div>
        <div class="eq" id="usdEq"></div></div>
      <label class="f"><span>${esc(t('Category'))}</span><input class="in" name="category" list="cats" value="${esc(p.category || '')}" ${mp ? '' : 'readonly'}><datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      ${!food ? `<div class="card ring lzcard"><label class="row lzsw" style="align-items:center;gap:12px;margin:0"><div class="grow"><b>${esc(t('Sell loose (pieces)'))}</b><div class="small muted" id="lzd"></div></div>
          <input type="checkbox" class="sw" name="loose" ${A.isLoose(p) ? 'checked' : ''} ${mp ? '' : 'disabled'}></label><div id="lzb"></div></div>
      <div id="stk"></div>
      <label class="f"><span>${esc(t('Expiry date (optional)'))}</span><input class="in" type="date" name="expiry" value="${esc(p.expiry || '')}" ${mp ? '' : 'readonly'}></label>` : ''}
      ${mp ? `<label class="chk"><input type="checkbox" name="fav" ${num(p.fav) ? 'checked' : ''}><span class="main">${esc(t('Always show on the sell screen'))}</span></label>
      ${!isNew ? `<label class="chk"><input type="checkbox" name="active" ${String(p.active) !== '0' ? 'checked' : ''}><span class="main">${esc(t('Active (can be sold)'))}</span></label>` : ''}` : ''}
      ${!isNew ? `<p class="small muted">${esc(t('Sold so far'))}: ${fmt(p.sold)}</p>` : ''}</form>`,
      onOpen: el => { const sb = $('#sb', el); if (sb) sb.onclick = async () => { const c = await A.scanOnce(); if (c) $('[name=barcode]', el).value = c; }; usdPriceForm(el, p, showCost); if (!food) looseForm(el, p, isNew, mp, cp, showCost); },
      actions: [!isNew && can('deleteProducts') ? { label: t('Delete'), cls: 'red', icon: 'trash', onClick: async close => {
        needOnline();
        if (!(await confirmBox(t('Delete {n}? Old sales and reports keep its name.', { n: p.name }), t('Delete'), 'red'))) return;
        const r = await api('prod.delete', { id: p.id });
        S.data.products = S.data.products.filter(x => x.id !== p.id); A.saveData(); close();
        toast(r.removed === 'deleted' ? t('Deleted') : t('Removed from lists (kept in old sales)'), 'ok'); if (done) done();
      } } : { label: t('Cancel') }].concat(mp || cp ? [{ label: t('Save'), cls: 'gold', onClick: async (close, el) => {
        needOnline();
        const f = formData($('#f', el));
        const d = { id: isNew ? '' : p.id, business: p.business || S.biz, name: f.name, barcode: f.barcode, price: num(f.price), category: f.category, lowStock: f.lowStock, expiry: f.expiry || '', fav: f.fav, active: isNew ? 1 : f.active };
        if (showCost) d.cost = num(f.cost);
        if (el._usd()) {
          const pu = Math.round(parseFloat(String(f.priceUSD).replace(/,/g, '')) * 100) / 100;
          if (!(pu > 0)) throw new Error(t('Enter the price in dollars'));
          Object.assign(d, { priceCur: 'USD', priceUSD: pu, price: Math.round(pu * A.rate()) });
          if (showCost) d.costUSD = f.costUSD === '' ? '' : Math.round(parseFloat(String(f.costUSD).replace(/,/g, '')) * 100) / 100;
        } else d.priceCur = 'SH';
        if (!food) {
          const lz = el._lz();
          Object.assign(d, { loose: lz.on ? 1 : 0, perPack: lz.per, looseTable: lz.rows, stock: lz.stock });
          if (lz.on && !(lz.per >= 2)) throw new Error(t('Pieces in one packet must be 2 or more'));
        }
        if (!d.name || !(d.price > 0)) throw new Error(t('Name and price are required'));
        const r = await api('prod.save', d);
        A.upsert('products', r.product); toast(t('Saved'), 'ok'); close(); if (done) done();
      } }] : []) });
    return sh;
  }
  // "Price in SH / USD": a dollar price is turned into shillings at today's rate (and again by the server when the rate changes).
  function usdPriceForm(el, p, showCost) {
    let usd = p.priceCur === 'USD';
    const put = (n, v) => { const i = $(`[name=${n}]`, el); if (i) { i.value = v; i.dispatchEvent(new Event('input')); } };
    const upd = () => {
      $('#shP', el).classList.toggle('hidden', usd); $('#usdP', el).classList.toggle('hidden', !usd);
      if (!usd) return;
      const rate = A.rate(), pu = parseFloat(String($('[name=priceUSD]', el).value).replace(/,/g, '')) || 0, cu = showCost ? parseFloat(String($('[name=costUSD]', el).value).replace(/,/g, '')) || 0 : 0;
      if (pu) put('price', Math.round(pu * rate)); if (cu) put('cost', Math.round(cu * rate));
      $('#usdEq', el).innerHTML = pu ? t('Today: <b>{u} = {s}</b>', { u: esc(usdF(pu)), s: esc(money(Math.round(pu * rate))) }) + (cu ? ' · ' + esc(t('cost {c} · profit {p}', { c: fmt(Math.round(cu * rate)), p: fmt(Math.round((pu - cu) * rate)) })) : '') +
        `<br>${esc(t('(1 USD = {r} — from Settings). When the rate changes, this price changes by itself.', { r: fmt(rate) }))}` : esc(t('1 USD = {r} (from Settings)', { r: fmt(rate) }));
    };
    seg($('#pcurP', el), v => { usd = v === 'USD'; if (usd && !$('[name=priceUSD]', el).value && num($('[name=price]', el).value)) { $('[name=priceUSD]', el).value = Math.round(num($('[name=price]', el).value) / A.rate() * 100) / 100; } upd(); });
    ['priceUSD', 'costUSD'].forEach(n => { const i = $(`[name=${n}]`, el); if (i) i.oninput = upd; });
    el._usd = () => usd;
    upd();
  }
  // The "Sell loose" part of the product form: switch, pieces per packet, price list for pieces, and stock as packets + pieces.
  function looseForm(el, p, isNew, mp, cp, showCost) {
    let on = A.isLoose(p), per = num(p.perPack) || 20;
    let rows = A.looseTable(p); if (!rows.length) rows = [[1, Math.round(num(p.price) / per) || 0]];
    let stockUnits = isNew ? '' : num(p.stock);   // pieces when loose, otherwise units/packets
    const price = () => num($('[name=price]', el).value), cost = () => num(($('[name=cost]', el) || {}).value || p.cost);
    const readStock = () => {
      if ($('[name=stockPk]', el)) { const pk = $('[name=stockPk]', el).value, pc = $('[name=stockPc]', el).value; stockUnits = pk === '' && pc === '' ? '' : num(pk) * per + num(pc); }
      else if ($('[name=stock]', el)) stockUnits = $('[name=stock]', el).value === '' ? '' : num($('[name=stock]', el).value);
    };
    const readRows = () => { if ($('#lzt', el)) rows = $$('#lzt tr[data-i]', el).map(tr => [num($('[data-k=q]', tr).value), num($('[data-k=p]', tr).value)]); };
    const drawStock = () => {
      const ro = mp ? '' : 'readonly';
      $('#stk', el).innerHTML = on
        ? `<div class="grid2">${moneyInput('stockPk', t('Stock — packets'), stockUnits === '' ? '' : Math.floor(stockUnits / per), ro)}${moneyInput('stockPc', t('+ loose pieces'), stockUnits === '' ? '' : stockUnits % per, ro)}</div>
           <div class="grid2">${moneyInput('lowStock', t('Warn when packets are at'), isNew ? setting('defaultLowStock') : p.lowStock, ro)}<div></div></div>`
        : `<div class="grid2">${moneyInput('stock', t('Stock now'), stockUnits, ro)}${moneyInput('lowStock', t('Warn when stock is at'), isNew ? setting('defaultLowStock') : p.lowStock, ro)}</div>`;
    };
    const drawRows = () => {
      const pc = cost() / per, ro = cp || isNew ? '' : 'readonly';
      $('#lzt', el).innerHTML = `<tr><th style="width:68px">${esc(t('Pieces'))}</th><th class="n">${esc(t('Price (SH)'))}</th>${showCost ? `<th class="n">${esc(t('Profit'))}</th>` : ''}<th></th></tr>` +
        rows.map((r, i) => { const pf = Math.round(num(r[1]) - num(r[0]) * pc); return `<tr data-i="${i}"><td><input data-k="q" inputmode="numeric" value="${r[0] || ''}" style="text-align:center" ${ro}></td><td><input data-k="p" inputmode="numeric" value="${r[1] || ''}" ${ro}></td>
          ${showCost ? `<td class="pf ${pf < 0 ? 'red' : ''}">${r[0] && r[1] ? (pf > 0 ? '+' : '') + fmt(pf) : ''}</td>` : ''}<td>${ro ? '' : `<button type="button" class="iconbtn sm" data-del="${i}" aria-label="remove">${I('x', 'sm')}</button>`}</td></tr>`; }).join('');
      $$('#lzt input', el).forEach(x => x.onchange = () => { readRows(); drawRows(); });
      $$('#lzt [data-del]', el).forEach(b => b.onclick = () => { readRows(); rows.splice(num(b.dataset.del), 1); drawRows(); });
      $('#pcost', el).innerHTML = showCost ? esc(t('Cost of 1 piece: {c} ÷ {n} = {x}', { c: fmt(cost()), n: per, x: money(Math.round(pc)) })) : '';
    };
    const draw = () => {
      $('#lzd', el).textContent = on ? t('On — sold as a packet or in pieces') : t('Off — this item is only sold whole. Most items stay like this.');
      el.querySelector('.lzcard').classList.toggle('on', on);
      $('#lzb', el).innerHTML = on ? `<div class="grid2" style="margin-top:12px">${moneyInput('perPack', t('Pieces in one packet'), per, mp ? '' : 'readonly')}<div></div></div>
        <div class="small muted" id="pcost" style="margin:-4px 0 8px"></div>
        <table class="ptab" id="lzt"></table>${cp || isNew ? `<button type="button" class="btn sm text" id="lzadd" style="padding-left:0">+ ${esc(t('Add a row'))}</button>` : ''}
        <div class="note">${esc(t('Amounts not in the list are added up from it, and never cost more than a packet. A full packet is always the packet price.'))}</div>` : '';
      if (on) {
        drawRows();
        $('[name=perPack]', el).onchange = e => { readStock(); per = Math.max(2, Math.floor(num(e.target.value))) || 20; drawRows(); drawStock(); };
        if ($('#lzadd', el)) $('#lzadd', el).onclick = () => { readRows(); const last = rows[rows.length - 1] || [0, 0]; rows.push([Math.min(per - 1, num(last[0]) + 1), '']); drawRows(); };
      }
      drawStock();
    };
    $('[name=loose]', el).onchange = e => {
      readStock();
      if (e.target.checked && !on && stockUnits !== '') stockUnits = num(stockUnits) * per;            // packets → pieces
      if (!e.target.checked && on && stockUnits !== '') stockUnits = Math.floor(num(stockUnits) / per);  // pieces → whole packets
      on = e.target.checked; draw();
    };
    ['price', 'cost'].forEach(n => { const x = $(`[name=${n}]`, el); if (x) x.addEventListener('input', () => { if (on) { readRows(); drawRows(); } }); });
    el._lz = () => { readStock(); readRows(); return { on, per, rows: rows.filter(r => r[0] > 0 && r[1] > 0), stock: stockUnits }; };
    draw();
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
      const lz = A.isLoose(p), per = num(p.perPack);
      sheet({ title: p.name, body: `<p>${esc(t('System stock'))}: <b>${esc(A.stockTxt(p))}</b></p>` + (lz
          ? `<div class="grid2">${moneyInput('pk', t('Full packets'), prev ? Math.floor(prev.counted / per) : '', 'autofocus')}${moneyInput('pc', t('+ loose pieces'), prev ? prev.counted % per : '')}</div>`
          : moneyInput('n', t('Real count'), prev ? prev.counted : '', 'autofocus')),
        actions: [{ label: t('Cancel') }, { label: t('OK'), cls: 'gold', onClick: (close, el) => {
          let v;
          if (lz) { const a = $('[name=pk]', el).value, b = $('[name=pc]', el).value; if (a === '' && b === '') throw new Error(t('Enter a number')); v = num(a) * per + num(b); }
          else { v = $('[name=n]', el).value; if (v === '') throw new Error(t('Enter a number')); }
          S.count = S.count.filter(c => c.productId !== p.id); S.count.unshift({ productId: p.id, name: p.name, system: num(p.stock), counted: num(v) }); save(); close(); draw();
        } }] });
    };
    const draw = () => {
      $('#cl').innerHTML = `<div class="list">${S.count.map(c => { const d = c.counted - c.system, p = findProd(c.productId) || {}; return `<div class="li tap" data-id="${esc(c.productId)}"><div class="main"><div class="name">${esc(c.name)}</div><div class="sub">${esc(t('System'))} ${esc(A.stockTxt(p, c.system))} → ${esc(t('Real'))} ${esc(A.stockTxt(p, c.counted))}</div></div>
        <b class="${d < 0 ? 'red' : d > 0 ? 'amber' : 'green'}">${d > 0 ? '+' : ''}${A.isLoose(p) ? esc(A.stockTxt(p, d)) : fmt(d)}</b></div>`; }).join('') || `<div class="empty">${esc(t('Nothing counted yet'))}</div>`}</div>`;
      $$('#cl .li').forEach(r => r.onclick = () => ask(findProd(r.dataset.id)));
    };
    $('#q').oninput = () => {
      const v = $('#q').value.trim().toLowerCase();
      const l = v ? prods('shop').filter(p => String(p.name).toLowerCase().includes(v) || String(p.barcode).startsWith(v)).slice(0, 20) : [];
      $('#res').innerHTML = l.length ? `<div class="list">${l.map(p => `<div class="li tap" data-id="${esc(p.id)}"><div class="main name">${esc(p.name)}</div><span class="muted">${esc(A.stockTxt(p))}</span></div>`).join('')}</div>` : '';
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
      ${s.phone ? `<a class="btn" href="tel:${esc(s.phone)}">${I('phone')}${esc(t('Call'))}</a><button class="btn" id="wa">${I('chat')}WhatsApp</button>` : ''}<button class="btn ghost" id="ed">${I('edit')}${esc(t('Edit'))}</button>${can('deleteSuppliers') ? `<button class="btn ghost" id="sdel" style="color:var(--red)">${I('trash')}${esc(t('Delete'))}</button>` : ''}</div>
      <h3>${esc(t('Purchase orders'))}</h3><div class="list">${orders.map(o => `<div class="li tap" data-id="${esc(o.id)}"><div class="main"><div class="name">${esc(o.poNo)}</div><div class="sub">${A.when(o.createdTs)} · ${esc(t(PST[o.status][0]))}</div></div><b>${fmt(o.total)}</b></div>`).join('') || `<div class="empty small">—</div>`}</div>
      <h3>${esc(t('Payments and deliveries'))}</h3><div id="led">${skel(2)}</div>` });
    const el = sh.el;
    $('#no', el).onclick = () => { sh.close(); poForm(null, { supplierId: s.id }, done); };
    $('#pay', el).onclick = () => { sh.close(); supPayForm(s, done); };
    $('#ed', el).onclick = () => { sh.close(); supplierForm(s, done); };
    if ($('#sdel', el)) $('#sdel', el).onclick = () => withBusy($('#sdel', el), async () => {
      needOnline();
      if (!(await confirmBox(t('Delete {n}?', { n: s.name }), t('Delete'), 'red'))) return;
      await api('sup.delete', { id: s.id });
      S.data.suppliers = S.data.suppliers.filter(x => x.id !== s.id); A.saveData(); sh.close(); toast(t('Deleted'), 'ok'); done && done();
    });
    const wa = $('#wa', el); if (wa) wa.onclick = () => A.openWhatsApp(s.phone, t('Hello {n},', { n: s.name }));
    $$('.li[data-id]', el).forEach(r => r.onclick = () => { sh.close(); poSheet(orders.find(o => o.id === r.dataset.id), done); });
    A.cachedCall('sup.ledger', { supplierId: s.id }, r => {
      $('#led', el).innerHTML = `<div class="list">${r.ledger.map(l => { const isPay = l.type === 'payment' || ((l.type === 'opening' || l.type === 'adjust') && num(l.amount) < 0); return `<div class="li"><span class="av ${isPay ? 'green' : 'gold'}" style="width:34px;height:34px">${I(isPay ? 'cash' : 'inbox', 'sm')}</span><div class="main"><div class="name">${esc(l.type === 'opening' ? t('Carried forward') : l.type === 'adjust' && /^Undo payment/.test(l.note || '') ? t('Payment undone') : l.type === 'adjust' ? t('Balance reset') : isPay ? t('Payment') : t('Goods received'))}${l.note ? ' · ' + esc(l.note) : ''}</div>
        <div class="sub">${A.when(l.ts)} · ${esc(l.userName)}${isPay ? ' · ' + esc(A.methodName(l.method)) : ''}</div></div><b class="${isPay ? 'green' : ''}">${isPay ? '−' : '+'}${fmt(Math.abs(l.type === 'purchase' ? num(l.amount) - num(l.paid) : num(l.amount)))}</b></div>`; }).join('') || '<div class="empty small">—</div>'}</div>`;
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
      .concat(prods().map(p => ({ kind: 'p', id: p.id, name: p.name, cost: p.cost, stock: A.isLoose(p) ? num(p.stock) / num(p.perPack) : p.stock, stockTxt: A.stockTxt(p), low: p.lowStock, barcode: p.barcode, loose: A.isLoose(p) })));
    const add = x => { if (!lines.find(l => l.refId === x.id)) lines.push({ kind: x.kind, refId: x.id, name: x.name, qty: 1, cost: num(x.cost) }); draw(); onChange(); };
    el.innerHTML = `<div class="row"><label class="search" style="box-shadow:inset 0 0 0 1px var(--line);background:var(--surface-2)">${I('search', 'sm')}<input id="iq" placeholder="${esc(t('Search item to add'))}"></label><button type="button" class="iconbtn tonal" id="isc">${I('scan')}</button></div><div id="ir" style="margin-top:8px"></div><div id="il" style="margin-top:8px"></div>`;
    $('#iq', el).oninput = () => {
      const v = $('#iq', el).value.toLowerCase();
      const l = v ? pool().filter(x => x.name.toLowerCase().includes(v) || String(x.barcode || '').startsWith(v)).slice(0, 12) : [];
      $('#ir', el).innerHTML = l.length ? `<div class="list">${l.map(x => `<div class="li tap" data-id="${esc(x.id)}"><div class="main name">${esc(x.name)}</div><span class="muted small">${x.kind === 'i' || S.biz === 'shop' ? esc(t('Stock')) + ' ' + esc(x.stockTxt || fmt(x.stock)) : ''}</span>${I('plus', 'sm')}</div>`).join('')}</div>` : '';
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
    $('#low', el).onclick = () => { pk.pool().filter(x => (x.kind === 'i' || S.biz === 'shop') && num(x.stock) <= num(x.low)).forEach(x => { if (!lines.find(l => l.refId === x.id)) lines.push({ kind: x.kind, refId: x.id, name: x.name, qty: Math.max(1, Math.ceil(num(x.low) * 2 - num(x.stock))), cost: num(x.cost) }); }); pk.draw(); upd(); if (!lines.length) toast(t('Nothing is low on stock'), 'ok'); };
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
          <div class="small">${items.map(i => esc(i.name) + (i.unit === 'pc' ? ' · ' + fmt(i.qty) + ' ' + t('pcs') : ' ×' + fmt(i.qty))).join(', ')}</div><div class="small muted">${esc(t('Reason'))}: ${esc(x.reason)} · ${esc(x.requestedBy)} · ${A.when(x.ts)}${x.decidedBy ? ' · ' + esc(x.decidedBy) : ''}</div>
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
      const l = r.sales.filter(s => s.status !== 'refunded' && s.status !== 'undone' && s.status !== 'void' && (!v || JSON.stringify(s).toLowerCase().includes(v))).slice(0, 60);
      $('#sl', sh.el).innerHTML = `<div class="list">${l.map(s => `<div class="li tap" data-id="${esc(s.id)}"><div class="main"><div class="name">${money(s.total)} · ${esc(A.methodName(s.method))}${s.customerName ? ' · ' + esc(s.customerName) : ''}</div>
        <div class="sub">${A.when(s.ts)} · ${esc(s.userName)} · ${s.items.map(i => esc(i.name) + (i.unit === 'pc' ? ' · ' + fmt(i.qty) + ' ' + t('pcs') : ' ×' + fmt(i.qty))).join(', ')}</div></div></div>`).join('') || `<div class="empty">${esc(t('No sales found'))}</div>`}</div>`;
      $$('#sl .li', sh.el).forEach(li => li.onclick = () => { sh.close(); refundItems(r.sales.find(s => s.id === li.dataset.id), done); });
    };
    $('#q', sh.el).oninput = draw; draw();
  }
  function refundItems(sale, done) {
    const key = i => i.productId + '|' + (i.unit === 'pc' ? 'pc' : '');   // a packet line and a pieces line are separate
    const q = {}; sale.items.forEach(i => { q[key(i)] = num(i.qty); });
    const sh = sheet({ title: t('Refund') + ' · ' + money(sale.total), body: `<div id="it"></div><label class="f"><span>${esc(t('Reason (required)'))}</span><textarea class="in" name="reason"></textarea></label>
      <p class="small muted">${esc(t('An owner must approve before money or stock changes.'))}</p>`,
      actions: [{ label: t('Cancel') }, { label: t('Send request'), cls: 'gold', onClick: async (close, el) => {
        const reason = $('[name=reason]', el).value.trim(); if (!reason) throw new Error(t('Write a reason'));
        const items = Object.keys(q).filter(k => q[k] > 0).map(k => ({ productId: k.split('|')[0], unit: k.split('|')[1], qty: q[k] }));
        if (!items.length) throw new Error(t('Choose at least one item'));
        await api('refund.request', { id: A.uid('RF'), saleId: sale.id, items, reason });
        toast(t('Refund request sent to the owner'), 'ok'); close(); done && done();
      } }] });
    const draw = () => {
      $('#it', sh.el).innerHTML = `<div class="list">${sale.items.map(i => `<div class="li"><div class="main"><div class="name">${esc(i.name)}${i.unit === 'pc' ? ` <span class="lz">${esc(t('PIECES'))}</span>` : ''}</div><div class="sub">${i.unit === 'pc' ? fmt(i.lineTotal) + ' · ' + esc(t('sold')) + ' ' + fmt(i.qty) + ' ' + esc(t('pcs')) : fmt(i.price) + ' · ' + esc(t('sold')) + ' ' + fmt(i.qty)}</div></div>
        <div class="qty"><button data-k="${esc(key(i))}" data-d="-1">−</button><b>${q[key(i)]}</b><button data-k="${esc(key(i))}" data-d="1">+</button></div></div>`).join('')}</div>`;
      $$('#it .qty button', sh.el).forEach(b => b.onclick = () => { const it = sale.items.find(i => key(i) === b.dataset.k); q[b.dataset.k] = Math.max(0, Math.min(num(it.qty), q[b.dataset.k] + num(b.dataset.d))); draw(); });
    };
    draw();
  }

  /* ======================= USERS ======================= */
  const PERM_LABELS = {
    viewReports: 'See dashboard and reports', viewProfit: 'See cost and profit', viewStock: 'See stock quantities', changePrices: 'Change prices',
    manageProducts: 'Add and edit products and ingredients', discount: 'Give discounts', customers: 'Credit customers and debt payments', suppliers: 'Suppliers and purchases',
    expenses: 'Expenses tab (see and add expenses)', ingredients: 'Enter ingredient usage', stockCount: 'Do stock counts', approveRefunds: 'Approve refunds',
    manageUsers: 'Manage users and PINs', settings: 'Change settings', export: 'Export data (CSV)', audit: 'See the audit log',
    undoSales: 'Undo own sales in their shift', cashOut: 'Record cash taken out of the drawer', exchange: 'Exchange Zaad/Edahab ↔ cash', voidSales: 'Void any sale (any time)',
    deleteProducts: 'Delete products', deleteCustomers: 'Delete customers (no debt only)', deleteSuppliers: 'Delete suppliers (nothing owed only)',
    viewInsights: 'See the Insights page', emailReports: 'Get email reports (and choose how often)'
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
    u = u || { role: 'employee', business: S.biz, lang: 'so', afterHours: false, active: true, perms: ['viewStock', 'customers', 'expenses', 'ingredients', 'undoSales', 'cashOut'] };
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
      <div class="card"><h3 style="margin-top:0">${esc(t('Businesses'))}</h3>
        <div class="chk"><span class="av">${I('store')}</span><span class="main"><b>${esc(s.shopName || t('Shop'))}</b><div class="small muted">${esc(t('Always open'))}</div></span></div>
        <label class="chk"><span class="av ${s.food_enabled === '0' ? 'gray' : ''}">${I('food')}</span><span class="main"><b>${esc(s.foodName || t('Fast Food'))}</b><div class="small ${s.food_enabled === '0' ? 'red bold' : 'muted'}">${esc(s.food_enabled === '0' ? t('Closed') : t('Open'))}</div></span><input type="checkbox" name="food_enabled" ${s.food_enabled === '0' ? '' : 'checked'}></label>
        <p class="small muted" style="margin:6px 2px 0">${esc(t('Switch off while Fast Food is closed: its menu, ingredients, reports and staff are hidden. Nothing is deleted; switch on again to bring it all back.'))}</p></div>
      <div class="card" id="whenC"><h3 style="margin-top:0">${esc(t('When emails are sent'))}</h3>
        <div class="when"><span class="av">${I('calendar')}</span><div class="grow"><b>${esc(t('Daily report'))}</b><div class="grid2"><label class="f"><span>${esc(t('Time'))}</span>${timeSel('emailDailyTime', s.emailDailyTime || '23:30')}</label></div></div></div>
        <div class="when"><span class="av">${I('calendar')}</span><div class="grow"><b>${esc(t('Weekly report'))}</b><div class="grid2"><label class="f"><span>${esc(t('Day'))}</span><select class="in" name="weeklyDay">${['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => `<option value="${d}" ${(s.weeklyDay || 'Thu') === d ? 'selected' : ''}>${esc(t(DAYNAME[d]))}</option>`).join('')}</select></label>
          <label class="f"><span>${esc(t('Time'))}</span>${timeSel('emailWeeklyTime', s.emailWeeklyTime || '23:30')}</label></div></div></div>
        <div class="when"><span class="av">${I('calendar')}</span><div class="grow"><b>${esc(t('Monthly report'))}</b><div class="grid2"><label class="f"><span>${esc(t('Day'))}</span><select class="in" name="monthlyWhen"><option value="last" ${s.monthlyWhen !== 'first' ? 'selected' : ''}>${esc(t('Last day of the month'))}</option><option value="first" ${s.monthlyWhen === 'first' ? 'selected' : ''}>${esc(t('1st of the next month'))}</option></select></label>
          <label class="f"><span>${esc(t('Time'))}</span>${timeSel('emailMonthlyTime', s.emailMonthlyTime || '23:30')}</label></div></div></div>
        <div class="when"><span class="av gold">${I('box')}</span><div class="grow"><b>${esc(t('Low-stock alert'))}</b><div class="grid2"><label class="f"><span>${esc(t('When'))}</span><select class="in" id="lsm"><option value="now" ${s.lowStockEmail !== '0' && s.lowStockMode !== 'daily' ? 'selected' : ''}>${esc(t('At once'))}</option><option value="daily" ${s.lowStockEmail !== '0' && s.lowStockMode === 'daily' ? 'selected' : ''}>${esc(t('Once a day (one list)'))}</option><option value="off" ${s.lowStockEmail === '0' ? 'selected' : ''}>${esc(t('Off'))}</option></select></label>
          <label class="f" id="lstW"><span>${esc(t('Time'))}</span>${timeSel('lowStockTime', s.lowStockTime || '08:00')}</label></div></div></div>
        <p class="small muted" style="margin:4px 2px 0">${esc(t('A time before 12:00 sends the report for the day or week that ended yesterday. Each person picks which emails they get in “Email reports” below.'))}</p></div>
      <div class="card"><h3 style="margin-top:0">${esc(t('Shifts'))}</h3>${moneyInput('lateMin', t('Late after (minutes)'), s.lateMin || '10')}</div>
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
        ${input('shopPhone', t('Phone shown on supplier orders'), s.shopPhone, 'inputmode="tel"')}</div>
      <button class="btn gold block lg">${esc(t('Save settings'))}</button></form>
      <div class="card" id="emc" style="margin-top:12px"></div>
      ${isOwner() ? `<div class="card" style="margin-top:12px"><h3>${esc(t('Backup'))}</h3><p class="small muted">${esc(t('A copy of the Sheet is saved to Google Drive every night (folder "Saado POS Backups"). You can also make one now.'))}</p><button class="btn block" id="bk">${esc(t('Back up now'))}</button></div><div class="card" id="arc"></div><div class="card danger" id="dz"></div>` : ''}`;
    const drawTypes = () => { $('#ot').innerHTML = types.map((x, i) => `<button type="button" class="chip on" data-i="${i}">${esc(t(x))} ${I('x', 'sm')}</button>`).join('') || `<span class="muted">—</span>`; $$('#ot .chip').forEach(c => c.onclick = () => { if (types.length > 1) { types.splice(c.dataset.i, 1); drawTypes(); } else toast(t('Keep at least one order type'), 'warn'); }); };
    $('#ota').onclick = () => { const v = $('#otn').value.trim().replace(/,/g, ' '); if (v && types.indexOf(v) < 0) { types.push(v); $('#otn').value = ''; drawTypes(); } };
    drawTypes();
    $('#f').onsubmit = e => {
      e.preventDefault();
      withBusy(e.target.querySelector('button.gold.lg'), async () => {
        needOnline(); const f = formData(e.target), values = {};
        Object.keys(f).forEach(k => { values[k] = typeof f[k] === 'boolean' ? (f[k] ? '1' : '0') : f[k]; });
        values.food_orderTypes = types.join(',');
        const lsm = $('#lsm').value; values.lowStockEmail = lsm === 'off' ? '0' : '1'; if (lsm !== 'off') values.lowStockMode = lsm;
        if (values.food_enabled === '0' && S.data.settings.food_enabled !== '0' && !(await confirmBox(t('Close Fast Food? Its menu, reports and staff are hidden until you switch it on again. Nothing is deleted.'), t('Close Fast Food'), 'red'))) return;
        const r = await api('settings.save', { values });
        S.data.settings = r.settings; A.saveData(); toast(t('Settings saved'), 'ok');
        if (A.myBiz().indexOf(S.biz) < 0) { S.biz = A.myBiz()[0]; A.LS.set('biz_' + S.user.id, S.biz); }
        A.drawShell(); A.render();
      });
    };
    $('#inst').onclick = () => A.installApp();
    const lsw = () => { $('#lstW').style.visibility = $('#lsm').value === 'daily' ? '' : 'hidden'; }; $('#lsm').onchange = lsw; lsw();
    emailCard($('#emc'));
    if ($('#arc')) dataCards($('#arc'), $('#dz'));
    if ($('#bk')) $('#bk').onclick = e => withBusy(e.target, async () => { needOnline(); const r = await api('backup.now', {}); toast(t('Backup saved: {n}', { n: r.name }), 'ok', 5000); });
  };

  /* ======================= INSIGHTS (this month vs last month, days, hours, attendance) ======================= */
  Screens.insights = function (main) {
    if (!can('viewInsights')) return noPerm(main);
    const bizs = A.myBiz(), mNow = A.today().slice(0, 7);
    const st = S.insState || (S.insState = { month: mNow, biz: bizs.length > 1 ? 'all' : bizs[0] });
    const months = []; for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(+mNow.slice(0, 4), +mNow.slice(5, 7) - 1 - i, 1)); months.push(d.toISOString().slice(0, 7)); }
    const mName = m => { const so = S.lang === 'so'; const n = (so ? ['Janaayo', 'Febraayo', 'Maarso', 'Abriil', 'May', 'Juun', 'Luulyo', 'Agoosto', 'Sebtembar', 'Oktoobar', 'Nofembar', 'Desembar'] : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])[+m.slice(5, 7) - 1]; return n + ' ' + m.slice(0, 4); };
    main.innerHTML = `<div class="row" style="margin:4px 0 10px"><select class="in grow" id="im">${months.map(m => `<option value="${m}" ${m === st.month ? 'selected' : ''}>${esc(mName(m))}</option>`).join('')}</select></div>
      ${bizs.length > 1 ? `<div class="chips scroll" id="ib" style="margin-bottom:12px">${['all', 'shop', 'food'].map(b => `<button class="chip ${st.biz === b ? 'on' : ''}" data-v="${b}">${esc(b === 'all' ? t('Shop + Fast Food') : A.bizName(b))}</button>`).join('')}</div>` : ''}
      <div id="ins">${skel(4)}</div>`;
    $('#im').onchange = () => { st.month = $('#im').value; load(); };
    $$('#ib .chip').forEach(c => c.onclick = () => { st.biz = c.dataset.v; $$('#ib .chip').forEach(x => x.classList.toggle('on', x === c)); load(); });
    const load = () => A.cachedCall('insights', { month: st.month, business: st.biz }, r => { if ($('#ins')) drawInsights($('#ins'), r, mName); })
      .catch(e => { if ($('#ins')) $('#ins').innerHTML = notYet(e); });
    load();
  };
  function drawInsights(box, r, mName) {
    const tr = (cur, prev, goodUp) => {
      if (!prev) return `<span class="trend" style="background:var(--surface-3);color:var(--muted)">${esc(t('no data last month'))}</span>`;
      const pct = Math.round((cur - prev) * 100 / Math.abs(prev)), up = pct >= 0, good = goodUp ? up : !up;
      return `<span class="trend ${good ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(pct)}% ${esc(t('vs {m}', { m: mName(r.prev).split(' ')[0] }))}</span>`;
    };
    const max = Math.max(1, ...r.dailyCur, ...r.dailyPrev);
    const dowOrder = [6, 0, 1, 2, 3, 4, 5], dn = S.lang === 'so' ? ['Axad', 'Isn', 'Tal', 'Arb', 'Kha', 'Jim', 'Sab'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dmax = Math.max(1, ...r.dow), hmax = Math.max(1, ...r.heat.flat());
    const hours = []; for (let h = 8; h < 24; h++) hours.push(h);
    let best = { v: 0 }; r.heat.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { v, d, h }; }));
    const undoneTotal = r.undone.reduce((a, x) => a + x.count, 0);
    box.innerHTML = `
      <div class="stats"><div class="stat"><div class="lbl">${I('chart')}${esc(t('Sales'))}</div><div class="val">${fmt(r.cur.sales)}</div>${tr(r.cur.sales, r.last.sales, true)}</div>
        ${r.profitVisible ? `<div class="stat"><div class="lbl">${I('cash')}${esc(t('Profit'))}</div><div class="val" style="color:${num(r.cur.profit) < 0 ? 'var(--red)' : 'var(--green)'}">${fmt(r.cur.profit)}</div>${tr(r.cur.profit, r.last.profit, true)}</div>` : ''}
        <div class="stat"><div class="lbl">${I('wallet')}${esc(t('Expenses'))}</div><div class="val">${fmt(r.cur.expenses)}</div>${tr(r.cur.expenses, r.last.expenses, false)}</div>
        <div class="stat"><div class="lbl">${I('undo')}${esc(t('Undone sales'))}</div><div class="val">${undoneTotal}</div>${r.undone.length ? `<span class="trend dn">${r.undone.map(x => esc(x.name) + ' ' + x.count).join(' · ')}</span>` : ''}</div></div>
      ${r.cur.fromArchive ? `<div class="card alert amber small">${esc(t('This month is in the Archive — only the totals are shown.'))}</div>` : ''}
      <div class="card"><h3 style="margin-top:0">${esc(t('Sales per day'))} <span class="small muted" style="text-transform:none;letter-spacing:0">${esc(t('gold = {m}, gray = {p}', { m: mName(r.month).split(' ')[0], p: mName(r.prev).split(' ')[0] }))}</span></h3>
        <div class="bars">${r.dailyCur.map((v, i) => `<i style="height:${Math.round(v * 100 / max)}%" title="${i + 1}: ${fmt(v)}"></i><i class="prev" style="height:${Math.round((r.dailyPrev[i] || 0) * 100 / max)}%;flex:.45"></i>`).join('')}</div>
        <div class="row small muted" style="justify-content:space-between;margin-top:4px"><span>1</span><span>15</span><span>${r.dailyCur.length}</span></div></div>
      <div class="card"><h3 style="margin-top:0">${esc(t('Best days of the week'))} <span class="small muted" style="text-transform:none;letter-spacing:0">${esc(t('last 90 days'))}</span></h3>
        ${dowOrder.map(d => { const pct = Math.round(r.dow[d] * 100 / dmax); return `<div class="row small" style="gap:8px;margin:4px 0"><span style="width:34px">${dn[d]}</span><span style="flex:1;background:var(--surface-2);border-radius:6px;height:12px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:${pct >= 90 ? 'var(--gold)' : 'var(--navy-2)'};border-radius:6px"></span></span><span style="width:70px;text-align:right">${fmt(r.dow[d] / 13)}</span></div>`; }).join('')}
        <p class="small muted" style="margin:6px 0 0">${esc(t('Average sales per day of the week.'))}</p></div>
      <div class="card"><h3 style="margin-top:0">${esc(t('Busiest hours'))}</h3><div class="hm"><span></span>${hours.map(h => `<span style="text-align:center">${h % 2 === 0 ? h : ''}</span>`).join('')}
        ${dowOrder.map(d => `<span>${dn[d]}</span>${hours.map(h => `<b style="background:rgba(0,51,102,${(0.05 + 0.9 * r.heat[d][h] / hmax).toFixed(2)})"></b>`).join('')}`).join('')}</div>
        ${best.v ? `<p class="small muted" style="margin:8px 0 0">${esc(t('Busiest: {d} around {h}:00.', { d: dn[best.d], h: best.h }))}</p>` : ''}</div>
      <div class="card"><h3 style="margin-top:0">${esc(t('Attendance'))}</h3>${r.attendance.length ? `<div class="tblwrap"><table class="tbl"><tr><th>${esc(t('Name'))}</th><th class="n">${esc(t('Shifts'))}</th><th class="n">${esc(t('Avg start'))}</th><th class="n">${esc(t('Late'))}</th><th class="n">${esc(t('Hours'))}</th></tr>
        ${r.attendance.map(a => `<tr><td>${esc(a.name)}</td><td class="n">${a.shifts}</td><td class="n">${a.avgStart}</td><td class="n"><span class="pill ${a.late ? 'gold' : 'green'}">${a.late}</span></td><td class="n">${a.hours}</td></tr>`).join('')}</table></div>` : `<div class="empty small">—</div>`}</div>
      ${r.foodTip ? `<div class="card tonal"><b>${esc(t('Fast Food closing time'))}</b><div class="small muted">${esc(t('{p}% of Fast Food sales come after 23:00 (about {x} SH a day). Closing time now: {c}.', { p: r.foodTip.sharePct, x: fmt(r.foodTip.perDay), c: r.foodTip.close }))}</div></div>` : ''}`;
  }

  /* ======================= MY EMAIL REPORTS ======================= */
  const DAYNAME = { Sat: 'Saturday', Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };
  // A time picker in half-hour steps (the email timer checks every 15 minutes)
  function timeSel(name, v) {
    const opts = []; for (let m = 0; m < 1440; m += 30) opts.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
    if (v && opts.indexOf(v) < 0) opts.push(v), opts.sort();
    return `<select class="in" name="${name}">${opts.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  }
  // "Daily 23:30 · Weekly Thursday 23:30 · Monthly last day 23:30 · Low stock at once"
  function schedTxt(withLow) {
    const g = k => setting(k) || '', mo = g('monthlyWhen') === 'first' ? t('1st of the next month') : t('Last day of the month');
    let x = t('Daily: {a} · Weekly: {d} {b} · Monthly: {m} {c}', { a: g('emailDailyTime') || '23:30', d: t(DAYNAME[g('weeklyDay') || 'Thu']), b: g('emailWeeklyTime') || '23:30', m: mo, c: g('emailMonthlyTime') || '23:30' });
    if (withLow) x += ' · ' + t('Low stock') + ': ' + (g('lowStockEmail') === '0' ? t('Off') : g('lowStockMode') === 'daily' ? t('once a day at {t}', { t: g('lowStockTime') || '08:00' }) : t('at once'));
    return x;
  }
  Screens.emails = function (main) {
    main.innerHTML = `<div id="me">${skel(1)}</div>`;
    A.cachedCall('recip.mine', {}, r => {
      if (!$('#me')) return;
      if (!r.recipients.length) { $('#me').innerHTML = `<div class="card empty">${I('bell')}${esc(t('You are not on the email list yet. Ask the owner to add you in Settings → Email reports.'))}</div>`; return; }
      $('#me').innerHTML = r.recipients.map(x => `<div class="card" data-id="${esc(x.id)}"><b>${esc(x.email)}</b><div class="small muted" style="margin:2px 0 10px">${esc(t('Choose how often you get the report'))}</div>
        <div class="togs">${['daily', 'weekly', 'monthly'].map(k => `<button data-k="${k}" class="${num(x[k]) ? 'on' : ''}">${esc(t({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[k]))}</button>`).join('')}</div></div>`).join('') +
        `<p class="small muted">${esc(schedTxt(false))}</p>`;
      $$('#me .togs button').forEach(b => b.onclick = () => withBusy(b, async () => {
        needOnline(); const card = b.closest('[data-id]'); b.classList.toggle('on');
        const v = {}; $$('.togs button', card).forEach(x => v[x.dataset.k] = x.classList.contains('on') ? 1 : 0);
        await api('recip.save', Object.assign({ id: card.dataset.id }, v)); toast(t('Saved'), 'ok');
      }));
    }).catch(e => { if ($('#me')) $('#me').innerHTML = notYet(e); });
  };

  /* ======================= SETTINGS: email reports, archive, reset ======================= */
  function emailCard(box) {
    A.cachedCall('recip.list', {}, r => {
      if (!box.isConnected) return;
      box.innerHTML = `<h3 style="margin-top:0">${esc(t('Email reports'))}</h3>${r.recipients.map(x => `<div class="li" style="padding:10px 0;align-items:flex-start" data-id="${esc(x.id)}"><span class="av ${x.userId ? 'gold' : ''}">${esc(String(x.name || x.email).slice(0, 1).toUpperCase())}</span>
        <div class="main"><div class="name">${esc(x.name || x.email)}</div><div class="sub">${esc(x.email)}</div>
        <div class="togs" style="margin-top:8px">${['daily', 'weekly', 'monthly', 'lowStock'].map(k => `<button data-k="${k}" class="${num(x[k]) ? 'on' : ''}">${esc(t({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', lowStock: 'Low stock' }[k]))}</button>`).join('')}</div>
        <div class="row" style="margin-top:6px"><button class="btn sm text" data-test>${I('send', 'sm')}${esc(t('Send test'))}</button><button class="btn sm text" data-del style="color:var(--red)">${I('trash', 'sm')}${esc(t('Remove'))}</button></div></div></div>`).join('') || `<p class="small muted">${esc(t('Nobody gets email reports yet.'))}</p>`}
        <button class="btn block ghost" id="addR" style="margin-top:8px">${I('plus')}${esc(t('Add person'))}</button>
        <p class="small muted">${esc(schedTxt(true))}</p>`;
      $$('[data-id] .togs button', box).forEach(b => b.onclick = () => withBusy(b, async () => {
        needOnline(); const row = b.closest('[data-id]'); b.classList.toggle('on');
        const v = {}; $$('.togs button', row).forEach(x => v[x.dataset.k] = x.classList.contains('on') ? 1 : 0);
        await api('recip.save', Object.assign({ id: row.dataset.id }, v)); toast(t('Saved'), 'ok');
      }));
      $$('[data-test]', box).forEach(b => b.onclick = () => withBusy(b, async () => { needOnline(); await api('recip.test', { id: b.closest('[data-id]').dataset.id }); toast(t('Test email sent'), 'ok'); }));
      $$('[data-del]', box).forEach(b => b.onclick = () => withBusy(b, async () => {
        needOnline(); if (!(await confirmBox(t('Stop sending emails to this person?'), t('Remove'), 'red'))) return;
        await api('recip.delete', { id: b.closest('[data-id]').dataset.id }); emailCard(box);
      }));
      $('#addR', box).onclick = () => {
        const sh = sheet({ title: t('Add person'), body: `<form id="rf">${input('name', t('Name'), '')}${input('email', t('Email'), '', 'type="email" inputmode="email" autocomplete="off"')}
          <label class="f"><span>${esc(t('Link to an app user (they can then change how often)'))}</span><select class="in" name="userId"><option value="">${esc(t('No — just email'))}</option>${r.users.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></label>
          <div class="togs">${['daily', 'weekly', 'monthly', 'lowStock'].map(k => `<button type="button" data-k="${k}" class="${k === 'daily' ? 'on' : ''}">${esc(t({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', lowStock: 'Low stock' }[k]))}</button>`).join('')}</div></form>`,
          actions: [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Save'), cls: 'gold', onClick: async (close, el) => {
            needOnline(); const f = formData($('#rf', el)), v = {}; $$('.togs button', el).forEach(x => v[x.dataset.k] = x.classList.contains('on') ? 1 : 0);
            if (!f.name && f.userId) f.name = (r.users.find(u => u.id === f.userId) || {}).name;
            await api('recip.save', Object.assign(f, v)); close(); toast(t('Saved'), 'ok'); emailCard(box);
          } }] });
        $$('.togs button', sh.el).forEach(b => b.onclick = () => b.classList.toggle('on'));
      };
    }).catch(e => { if (box.isConnected) box.innerHTML = `<h3 style="margin-top:0">${esc(t('Email reports'))}</h3>` + notYet(e); });
  }
  function dataCards(arch, danger) {
    A.cachedCall('admin.counts', {}, c => {
      if (!arch.isConnected) return;
      const pct = Math.min(100, Math.round(c.salesRows * 100 / c.limit)), color = pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--gold)' : 'var(--green)';
      arch.innerHTML = `<h3 style="margin-top:0">${esc(t('Archive old data'))}</h3><div class="row small"><span class="grow">${esc(t('Sheet size'))}</span><b>${fmt(c.salesRows)} ${esc(t('sales rows'))}</b></div>
        <div class="meter" style="margin:8px 0 4px"><i style="width:${Math.max(2, pct)}%;background:${color}"></i></div>
        <div class="small muted">${esc(t('The app stays fast up to about {n} rows. Archive when the bar turns red.', { n: fmt(c.limit) }))}</div>
        <div class="row small" style="margin-top:10px"><span class="grow">${esc(t('Last archive'))}</span><b>${c.archiveLinks.length ? esc(c.archiveLinks[c.archiveLinks.length - 1].name) : esc(t('Never'))}</b></div>
        ${c.archiveLinks.map(l => `<div class="small"><a href="${esc(l.url)}" target="_blank" rel="noopener">${I('file', 'sm')} ${esc(l.name)}</a></div>`).join('')}
        <button class="btn gold block" id="arcBtn" style="margin-top:12px">${I('box')}${esc(t('Archive old data…'))}</button>`;
      $('#arcBtn', arch).onclick = () => archiveSheet(c);
      danger.innerHTML = `<h3 style="margin-top:0;color:var(--red)">${esc(t('Danger zone'))}</h3><p class="small muted" style="margin:0 0 10px">${esc(t('Delete chosen data for good. A safety copy is always saved in the Archive first.'))}</p>
        <button class="btn red block" id="rstBtn">${I('trash')}${esc(t('Reset data…'))}</button>`;
      $('#rstBtn', danger).onclick = () => resetSheet(c);
      if (pct > 85 && !A.LS.get('archNag_' + A.today().slice(0, 7))) { A.LS.set('archNag_' + A.today().slice(0, 7), 1); toast(t('The Sheet is getting big. Time to archive old data.'), 'warn', 6000); }
    }).catch(e => { if (arch.isConnected) arch.innerHTML = notYet(e); });
  }
  function archiveSheet(c) {
    const first = (y, m) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), td = A.today(), y = +td.slice(0, 4), m = +td.slice(5, 7) - 1;
    const opts = [['3', t('3 months (recommended)'), first(y, m - 2)], ['6', t('6 months'), first(y, m - 5)], ['12', t('1 year'), first(y, m - 11)]];
    let cutoff = opts[0][2], prev = null;
    const sh = sheet({ title: t('Archive old data'), sticky: true, body: `<label class="f"><span>${esc(t('Move data older than'))}</span><div class="chips" id="ao">${opts.map((o, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-d="${o[2]}">${esc(o[1])}</button>`).join('')}</div>
      <input class="in" type="date" id="ad" value="${cutoff}" max="${td}" style="margin-top:8px"></label><div id="ap">${skel(2)}</div>`,
      actions: [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Archive now'), cls: 'gold', icon: 'box', onClick: async close => {
        needOnline(); if (!prev || !prev.total) throw new Error(t('There is no data older than this date'));
        if (!(await confirmBox(t('Move {n} rows to the archive "{p}"? They leave the app but stay in Google Drive.', { n: fmt(prev.total), p: prev.name }), t('Archive now'), 'gold'))) return;
        const r = await api('admin.archive', { cutoff }, { timeout: 330000 });
        close(); await A.refresh(true);
        A.alertBox(t('Archive done'), `<p>${esc(t('{n} rows moved to the archive.', { n: fmt(r.total) }))}</p><p><a class="btn block" href="${esc(r.url)}" target="_blank" rel="noopener">${I('file')}${esc(t('Open the archive sheet'))}</a></p>`);
        if (S.route === 'settings') A.render();
      } }] });
    const preview = () => { $('#ap', sh.el).innerHTML = skel(2); prev = null;
      api('admin.archivePreview', { cutoff }).then(p => {
        prev = p; const lbl = { Sales: t('Sales'), SaleItems: t('Sold items'), Shifts: t('Shifts'), CashMoves: t('Cash taken out'), Expenses: t('Expenses'), Refunds: t('Refunds'), CustLedger: t('Customer history'), SupLedger: t('Supplier history'), PurchaseOrders: t('Finished purchase orders'), StockLog: t('Stock history'), IngLog: t('Ingredient history'), Audit: t('Audit log') };
        $('#ap', sh.el).innerHTML = !p.total ? `<div class="card empty small">${esc(t('There is no data older than this date'))}</div>` :
          `<div class="card tonal" style="padding:12px 14px"><div class="small muted bold">${esc(t('PERIOD THAT WILL BE ARCHIVED'))}</div><div style="font-size:18px;font-weight:750;margin-top:4px">${esc(p.name)}</div><div class="small muted">${esc(p.from)} → ${esc(p.to)}</div></div>
          <div class="grp">${esc(t('Moves to the archive'))}</div><div class="list">${Object.keys(p.counts).filter(k => p.counts[k]).map(k => `<div class="li"><div class="main name">${esc(lbl[k] || k)}</div><b>${fmt(p.counts[k])}</b></div>`).join('')}</div>
          <div class="grp">${esc(t('Stays in the app'))}</div><p class="small" style="margin:4px 2px">${esc(t('Products, stock, customers, suppliers, employees, settings, all balances (carried forward), open orders, and monthly totals for Insights.'))}</p>
          <div class="list"><div class="li lead"><span class="av gold">${I('box')}</span><div class="main"><div class="name">${esc(t('Saved in Google Drive'))}</div><div class="sub" style="white-space:normal">Saado POS Archive / ${esc(p.name)}</div></div></div></div>`;
      }).catch(e => { $('#ap', sh.el).innerHTML = notYet(e); }); };
    $$('#ao .chip', sh.el).forEach(b => b.onclick = () => { cutoff = b.dataset.d; $('#ad', sh.el).value = cutoff; $$('#ao .chip', sh.el).forEach(x => x.classList.toggle('on', x === b)); preview(); });
    $('#ad', sh.el).onchange = () => { cutoff = $('#ad', sh.el).value; $$('#ao .chip', sh.el).forEach(x => x.classList.remove('on')); preview(); };
    preview();
  }
  function resetSheet(c) {
    const n = c.counts, groups = [
      [t('Selling'), [['sales', t('Sales, sold items & refunds'), fmt(n.Sales)], ['shifts', t('Shifts & cash taken out'), fmt(n.Shifts)], ['expenses', t('Expenses'), fmt(n.Expenses)]]],
      [t('Customers'), [['customers', t('Customers (names & history)'), fmt(n.Customers)], ['custBalances', t('Customer balances only'), money(c.customerDebt), t('Sets every debt to 0, keeps the customers')]]],
      [t('Suppliers'), [['suppliers', t('Suppliers & purchase orders'), fmt(n.Suppliers)], ['supBalances', t('Supplier balances only'), money(c.supplierOwed), t('Sets what we owe to 0')]]],
      [t('Stock'), [['products', t('Products'), fmt(n.Products)], ['stockQty', t('Stock quantities only'), '', t('Sets every product to 0 (before a full count)')], ['ingredients', t('Ingredients stock'), fmt(n.Ingredients)]]],
      [t('Team & records'), [['employees', t('Employee logins'), c.employees.join(', '), t('Your own owner login is never deleted')], ['audit', t('Audit log'), fmt(n.Audit)], ['settings', t('Settings back to default'), '']]],
      [t('Google Drive'), [['backups', t('Old nightly backups'), fmt(c.backups) + ' ' + t('files'), t('The Archive folder can never be reset')]]]];
    const all = {}; groups.forEach(g => g[1].forEach(x => all[x[0]] = x));
    sheet({ title: t('Reset data — step 1 of 2'), sticky: true, body: `<p class="small muted" style="margin:0 2px 4px">${esc(t('Tick what to delete. Everything not ticked stays.'))}</p>` +
      groups.map(g => `<div class="grp">${esc(g[0])}</div>` + g[1].map(x => `<label class="chk"><input type="checkbox" data-p="${x[0]}"><span class="main"><b style="font-weight:600">${esc(x[1])}</b>${x[3] ? `<div class="cnt">${esc(x[3])}</div>` : ''}</span><span class="cnt">${esc(x[2])}</span></label>`).join('')).join(''),
      actions: [{ label: t('Cancel'), cls: 'ghost' }, { label: t('Next'), cls: 'red', onClick: (close, el) => {
        const parts = $$('[data-p]', el).filter(i => i.checked).map(i => i.dataset.p);
        if (!parts.length) throw new Error(t('Tick at least one thing to reset'));
        close(); setTimeout(() => resetConfirm(parts, all), 200);
      } }] });
  }
  function resetConfirm(parts, all) {
    const waiting = S.queue.length;
    sheet({ title: t('Reset data — step 2 of 2'), sticky: true, body: `<div class="card danger" style="padding:14px"><b class="red">${esc(t('This will delete for good:'))}</b>
      <ul style="margin:8px 0 0;padding-left:18px;line-height:1.7">${parts.map(p => `<li>${esc(all[p][1])}${all[p][2] ? ' (' + esc(all[p][2]) + ')' : ''}</li>`).join('')}</ul></div>
      <div class="list"><div class="li lead"><span class="av green">${I('shield')}</span><div class="main"><div class="name">${esc(t('Safety copy first'))}</div><div class="sub" style="white-space:normal">${esc(t('A full copy is saved to Saado POS Archive / Resets before anything is deleted.'))}</div></div></div>
      <div class="li lead"><span class="av gold">${I('alert')}</span><div class="main"><div class="name" style="white-space:normal">${esc(t('Phones with unsent sales'))}</div><div class="sub" style="white-space:normal">${esc(t('Anything still waiting on a phone is thrown away after the reset.'))}${waiting ? ' ' + esc(t('This phone: {n}.', { n: waiting })) : ''}</div></div></div></div>
      <label class="f"><span>${esc(t('Type RESET to confirm'))}</span><input class="in" id="rc" autocomplete="off" style="font-weight:800;letter-spacing:3px" placeholder="RESET"></label>
      <label class="f"><span>${esc(t('Your PIN'))}</span><input class="in" id="rp" type="password" inputmode="numeric" autocomplete="off" style="letter-spacing:6px"></label>
      <p class="small muted">${esc(t('A line “Reset by {n}” is always kept in the audit log.', { n: S.user.name }))}</p>`,
      actions: [{ label: t('Back'), cls: 'ghost' }, { label: t('Delete'), cls: 'red', icon: 'trash', onClick: async (close, el) => {
        needOnline();
        if ($('#rc', el).value.trim().toUpperCase() !== 'RESET') throw new Error(t('Type RESET to confirm'));
        const r = await api('admin.reset', { parts, confirm: $('#rc', el).value, pin: $('#rp', el).value }, { timeout: 330000 });
        close();
        A.LS.set('dataVersion', String(r.dataVersion));
        S.queue = []; S.failed = []; A.LS.set('queue', []); A.LS.set('failed', []);
        await A.refresh(true); A.drawShell(); A.render();
        A.alertBox(t('Reset done'), `<p>${esc(t('The chosen data was deleted.'))}</p><p class="small muted">${esc(t('Safety copy:'))} <a href="${esc(r.safetyCopy.url)}" target="_blank" rel="noopener">${esc(r.safetyCopy.name)}</a></p>`);
      } }] });
  }

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
  Screens.onSync = function () {
    if (S.route === 'sync' && !document.querySelector('.ov')) A.render();
    if (S.route === 'shift' && $('#cmp')) { const sh = myShift(); if (sh) loadLive(sh, true); }
  };
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
