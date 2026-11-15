/**
 * Saado POS — the WHOLE backend in this one file (Google Apps Script bound to the "Saado POS" Sheet).
 *
 * How to use:
 *   1. Run setup() once from the editor (safe to run again). It creates every tab, header, default
 *      setting, the 4 default ingredients and the daily Drive backup trigger.
 *   2. Deploy > New deployment > Web app.  Execute as: Me.  Who has access: Anyone.
 *   3. Put the /exec URL in config.js of the app (GitHub).
 *
 * The app talks to doPost() with JSON (Content-Type text/plain to avoid CORS preflight).
 * Every action except "ping", "names" and "login" needs a valid login token (6 hours).
 * The server never trusts prices from the phone: totals are recalculated from the Products tab.
 */

var VERSION = '1.0.0';
var TZ = 'Africa/Mogadishu';          // Somaliland time (UTC+3)
var TOKEN_HOURS = 6;
var MAX_FAILS = 5, LOCK_MINUTES = 5;  // wrong-PIN lockout

var SCHEMA = {
  Settings:   ['key', 'value', 'note'],
  Users:      ['id', 'name', 'role', 'business', 'pinHash', 'salt', 'active', 'lang', 'afterHours', 'perms', 'createdAt', 'pinChanged'],
  Products:   ['id', 'business', 'name', 'barcode', 'category', 'price', 'cost', 'stock', 'lowStock', 'expiry', 'active', 'fav', 'sold', 'updatedAt'],
  Sales:      ['id', 'ts', 'date', 'business', 'userId', 'userName', 'shiftId', 'method', 'orderType', 'customerId', 'customerName', 'subtotal', 'discount', 'total', 'cost', 'tendered', 'tenderCur', 'change', 'status', 'refunded', 'note'],
  SaleItems:  ['saleId', 'date', 'business', 'productId', 'name', 'qty', 'price', 'cost', 'lineTotal'],
  Shifts:     ['id', 'business', 'userId', 'userName', 'status', 'openTs', 'closeTs', 'date', 'openCash', 'openZaadSH', 'openZaadUSD', 'openEdSH', 'openEdUSD',
               'closeCash', 'closeZaadSH', 'closeZaadUSD', 'closeEdSH', 'closeEdUSD', 'rate',
               'cashSales', 'zaadSales', 'edSales', 'creditSales', 'custPayCash', 'custPayZaad', 'custPayEd', 'expCash', 'expZaad', 'expEd', 'refCash', 'refZaad', 'refEd',
               'expectedCash', 'diffCash', 'expectedZaad', 'diffZaad', 'expectedEd', 'diffEd', 'note'],
  Customers:  ['id', 'business', 'name', 'phone', 'balance', 'note', 'createdAt', 'active'],
  CustLedger: ['id', 'ts', 'date', 'business', 'customerId', 'type', 'amount', 'method', 'ref', 'shiftId', 'userName', 'note'],
  Suppliers:  ['id', 'business', 'name', 'phone', 'balance', 'note', 'createdAt', 'active'],
  SupLedger:  ['id', 'ts', 'date', 'business', 'supplierId', 'type', 'amount', 'paid', 'method', 'items', 'userName', 'note'],
  Expenses:   ['id', 'ts', 'date', 'business', 'category', 'amount', 'method', 'shiftId', 'ref', 'userName', 'note'],
  Refunds:    ['id', 'ts', 'date', 'business', 'saleId', 'items', 'amount', 'cost', 'method', 'reason', 'status', 'requestedBy', 'decidedBy', 'decidedTs', 'note', 'shiftId'],
  Ingredients:['id', 'name', 'unit', 'stock', 'lowLevel', 'cost', 'active', 'updatedAt'],
  IngLog:     ['id', 'ts', 'date', 'ingredientId', 'name', 'type', 'qty', 'userName', 'note'],
  StockLog:   ['id', 'ts', 'date', 'business', 'productId', 'name', 'type', 'before', 'after', 'diff', 'userName', 'note'],
  Audit:      ['ts', 'userName', 'action', 'details']
};

// key: [default, note].  Only these keys can be changed from the app.
var DEFAULT_SETTINGS = {
  usdRate:        ['11850', 'SH per 1 USD'],
  roundStep:      ['500', 'Sale total rounded to nearest (SH)'],
  shop_zaad:      ['436908', 'Shop Zaad account'],
  shop_edahab:    ['93051', 'Shop Edahab account'],
  food_zaad:      ['473389', 'Fast Food Zaad account'],
  food_edahab:    ['98379', 'Fast Food Edahab account'],
  shop_credit:    ['1', 'Credit sales allowed in Shop (1/0)'],
  food_credit:    ['0', 'Credit sales allowed in Fast Food (1/0)'],
  food_orderTypes:['Take away', 'Comma separated'],
  shop_hours:     ['08:00-13:00,16:00-23:00', 'Shop shifts'],
  food_open:      ['17:00', 'Fast Food opens'],
  food_close:     ['00:00', 'Fast Food closes (editable)'],
  graceMin:       ['30', 'Minutes allowed before/after hours'],
  requireShift:   ['1', 'Must open a shift before selling (1/0)'],
  expenseCats:    ['Electricity,Deliveries,Supplier purchases,Ingredients,Salaries,Rent,Other', 'Expense categories'],
  expiryWarnDays: ['14', 'Warn this many days before expiry'],
  defaultLowStock:['5', 'Default low-stock level for new products'],
  shopName:       ['Saado Shop', ''],
  foodName:       ['Saado Fast Food', ''],
  shopPhone:      ['', 'Shown on supplier orders'],
  ownerWhatsApp:  ['', 'Number for the daily summary, e.g. 252634000000']
};

var PERMS = ['viewReports', 'viewProfit', 'viewStock', 'changePrices', 'manageProducts', 'discount', 'customers', 'suppliers',
             'expenses', 'ingredients', 'stockCount', 'approveRefunds', 'manageUsers', 'settings', 'export', 'audit'];
var EMPLOYEE_DEFAULT_PERMS = ['viewStock', 'customers', 'expenses', 'ingredients'];
var BIZ = ['shop', 'food'];
var METHODS = ['cash', 'zaad', 'edahab', 'credit'];
var PAY_METHODS = ['cash', 'zaad', 'edahab'];

/* ============================== entry points ============================== */

function doGet() {
  return out_({ ok: true, app: 'saado-pos', version: VERSION, time: nowIso_() });
}

function doPost(e) {
  var res;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = handle_(req);
  } catch (err) {
    res = { ok: false, error: String(err && err.message || err) };
  }
  return out_(res);
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

var PUBLIC = { ping: 1, names: 1, login: 1 };
var READS = { boot: 1, report: 1, 'sales.list': 1, 'cust.ledger': 1, 'sup.ledger': 1, 'refund.list': 1, 'users.list': 1, 'audit.list': 1,
              'export': 1, 'shift.list': 1, 'ing.log': 1, 'exp.list': 1, 'stock.log': 1, logout: 1 };

function handle_(req) {
  T_ = {};
  var a = String(req.action || '');
  if (a === 'ping') return { ok: true, version: VERSION, time: nowIso_() };
  if (a === 'names') return { ok: true, users: table_('Users').rows.filter(function (u) { return isOn_(u.active); })
                                 .map(function (u) { return { id: u.id, name: u.name, business: u.business }; }) };
  if (a === 'login') return withLock_(function () { return login_(req.data || {}); });

  var user = auth_(req.token);
  var fn = ACTIONS[a];
  if (a === 'sync') fn = sync_;
  if (!fn) throw new Error('Unknown action: ' + a);
  if (READS[a]) return fn(user, req.data || {});
  return withLock_(function () { return fn(user, req.data || {}); });
}

function withLock_(f) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Server is busy, try again');
  try { return f(); } finally { lock.releaseLock(); }
}

// Offline queue: many writes in one request. Each op result is reported separately.
function sync_(user, data) {
  var ops = data.ops || [], results = [];
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    try {
      var fn = ACTIONS[op.action];
      if (!fn || READS[op.action]) throw new Error('Unknown action: ' + op.action);
      results.push({ qid: op.qid, ok: true, result: fn(user, op.data || {}, true) });
    } catch (err) {
      results.push({ qid: op.qid, ok: false, error: String(err && err.message || err) });
    }
  }
  return { ok: true, results: results };
}

/* ============================== sheet helpers ============================== */

var T_ = {}; // per-request table cache

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function table_(name) {
  if (T_[name]) return T_[name];
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run setup() in Apps Script.');
  var headers = SCHEMA[name];
  var last = sh.getLastRow(), rows = [];
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, headers.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var o = { _r: i + 2 };
      for (var j = 0; j < headers.length; j++) o[headers[j]] = norm_(vals[i][j]);
      if (o[headers[0]] === '' && o[headers[1]] === '') continue;
      rows.push(o);
    }
  }
  T_[name] = { sh: sh, headers: headers, rows: rows };
  return T_[name];
}

function norm_(v) {
  if (v instanceof Date) {
    var h = v.getHours() + v.getMinutes() + v.getSeconds();
    return Utilities.formatDate(v, TZ, h ? "yyyy-MM-dd'T'HH:mm:ss" : 'yyyy-MM-dd');
  }
  return v;
}

function cellVal_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string' && /^[=+@]/.test(v)) return "'" + v;          // never let text become a formula
  if (typeof v === 'string' && /^-[^0-9]/.test(v)) return "'" + v;
  return v;
}

function rowArr_(t, o) { return t.headers.map(function (h) { return cellVal_(o[h]); }); }

function insert_(name, o) {
  var t = table_(name);
  var r = t.sh.getLastRow() + 1;
  t.sh.getRange(r, 1, 1, t.headers.length).setValues([rowArr_(t, o)]);
  o._r = r; t.rows.push(o);
  return o;
}

function insertMany_(name, list) {
  if (!list.length) return;
  var t = table_(name);
  var r = t.sh.getLastRow() + 1;
  t.sh.getRange(r, 1, list.length, t.headers.length).setValues(list.map(function (o) { return rowArr_(t, o); }));
  list.forEach(function (o, i) { o._r = r + i; t.rows.push(o); });
}

function update_(name, o) {
  var t = table_(name);
  t.sh.getRange(o._r, 1, 1, t.headers.length).setValues([rowArr_(t, o)]);
  return o;
}

function find_(name, id) {
  var rows = table_(name).rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === String(id)) return rows[i];
  return null;
}

function exists_(name, id) {
  if (!id) return false;
  return !!find_(name, id);
}

function clean_(o) { var c = {}; for (var k in o) if (k !== '_r' && k !== 'pinHash' && k !== 'salt') c[k] = o[k]; return c; }

/* ============================== small utils ============================== */

function num_(v) { var n = Number(String(v === undefined || v === null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
function isOn_(v) { return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes'; }
function nowIso_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function dateOf_(iso) { return String(iso).slice(0, 10); }
function uid_(p) { return p + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase(); }
function str_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 200); }
function setting_(k) { var s = settingsMap_(); return k in s ? s[k] : (DEFAULT_SETTINGS[k] || [''])[0]; }
function settingsMap_() {
  if (T_._settings) return T_._settings;
  var m = {};
  table_('Settings').rows.forEach(function (r) { m[r.key] = String(r.value); });
  return (T_._settings = m);
}
function rate_() { return num_(setting_('usdRate')) || 11850; }
function roundTo_(x, step) { step = num_(step) || 1; return Math.max(0, Math.round(x / step) * step); }

function audit_(user, action, details) {
  try { insert_('Audit', { ts: nowIso_(), userName: user ? user.name : '-', action: action, details: typeof details === 'string' ? details : JSON.stringify(details) }); } catch (e) {}
}

function hash_(salt, pin) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join('');
}
function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }
function randomPin_() {
  var bad = /^(\d)\1+$|^(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)$/;
  while (true) {
    var p = String(Math.floor(Math.random() * 10000)); while (p.length < 4) p = '0' + p;
    if (!bad.test(p)) return p;
  }
}
function checkPin_(p) {
  p = String(p || '');
  if (!/^\d{4,6}$/.test(p)) throw new Error('PIN must be 4 to 6 digits');
  if (/^(\d)\1+$/.test(p) || '0123456789'.indexOf(p) >= 0 || '9876543210'.indexOf(p) >= 0) throw new Error('PIN is too easy, choose another');
  return p;
}

/* ============================== auth & permissions ============================== */

function login_(d) {
  var u = find_('Users', d.userId);
  if (!u || !isOn_(u.active)) throw new Error('User not found or disabled');
  var cache = CacheService.getScriptCache();
  var lockKey = 'lock_' + u.id, failKey = 'fail_' + u.id;
  if (cache.get(lockKey)) throw new Error('LOCKED: too many wrong PINs. Wait ' + LOCK_MINUTES + ' minutes.');
  if (hash_(u.salt, String(d.pin || '')) !== u.pinHash) {
    var f = num_(cache.get(failKey)) + 1;
    cache.put(failKey, String(f), LOCK_MINUTES * 60);
    if (f >= MAX_FAILS) { cache.put(lockKey, '1', LOCK_MINUTES * 60); cache.remove(failKey); audit_(u, 'login.locked', ''); throw new Error('LOCKED: too many wrong PINs. Wait ' + LOCK_MINUTES + ' minutes.'); }
    throw new Error('Wrong PIN (' + (MAX_FAILS - f) + ' tries left)');
  }
  cache.remove(failKey);
  checkHours_(u, null, new Date());
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('tok_' + token, u.id, TOKEN_HOURS * 3600);
  audit_(u, 'login', '');
  var b = boot_(u, {});
  b.token = token;
  b.expires = Date.now() + TOKEN_HOURS * 3600 * 1000;
  return b;
}

function auth_(token) {
  if (!token) throw new Error('AUTH: please log in');
  var id = CacheService.getScriptCache().get('tok_' + token);
  if (!id) throw new Error('AUTH: session expired, please log in again');
  var u = find_('Users', id);
  if (!u || !isOn_(u.active)) throw new Error('AUTH: account disabled');
  u._token = token;
  return u;
}

function isOwner_(u) { return u.role === 'owner'; }
function perms_(u) {
  if (isOwner_(u)) return PERMS.slice();
  try { return JSON.parse(u.perms || '[]'); } catch (e) { return []; }
}
function can_(u, p) { return isOwner_(u) || perms_(u).indexOf(p) >= 0; }
function need_(u, p) { if (!can_(u, p)) throw new Error('NOPERM: you do not have permission (' + p + ')'); }
function bizList_(u) { return (isOwner_(u) || u.business === 'both') ? BIZ.slice() : [u.business]; }
function needBiz_(u, b) {
  if (BIZ.indexOf(b) < 0) throw new Error('Choose Shop or Fast Food');
  if (bizList_(u).indexOf(b) < 0) throw new Error('NOPERM: you cannot use this business');
}

// Hours check: employees without "after hours" access can only work inside their business hours (+ grace).
function checkHours_(u, biz, when) {
  if (isOwner_(u) || isOn_(u.afterHours)) return;
  var list = biz ? [biz] : bizList_(u);
  for (var i = 0; i < list.length; i++) if (inHours_(list[i], when)) return;
  throw new Error('HOURS: outside working hours. Ask an owner for access.');
}
function inHours_(biz, when) {
  var ranges = biz === 'shop' ? String(setting_('shop_hours')) : setting_('food_open') + '-' + setting_('food_close');
  var hm = Utilities.formatDate(when, TZ, 'HH:mm').split(':');
  var m = num_(hm[0]) * 60 + num_(hm[1]), g = num_(setting_('graceMin'));
  return ranges.split(',').some(function (r) {
    var p = r.split('-'); if (p.length < 2) return false;
    var s = toMin_(p[0]) - g, e = toMin_(p[1]) + g;
    if (toMin_(p[1]) <= toMin_(p[0])) e += 1440;            // passes midnight
    return (m >= s && m <= e) || (m + 1440 >= s && m + 1440 <= e);
  });
}
function toMin_(t) { var p = String(t).trim().split(':'); return num_(p[0]) * 60 + num_(p[1]); }

/* ============================== boot ============================== */

function publicUser_(u) {
  return { id: u.id, name: u.name, role: u.role, business: u.business, lang: u.lang || 'so', afterHours: isOn_(u.afterHours),
           perms: perms_(u), active: isOn_(u.active), pinChanged: isOn_(u.pinChanged) };
}

function boot_(u, d) {
  var biz = bizList_(u);
  var s = settingsMap_(), settings = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { settings[k] = k in s ? s[k] : DEFAULT_SETTINGS[k][0]; });
  var products = table_('Products').rows.filter(function (p) { return biz.indexOf(p.business) >= 0; }).map(function (p) {
    var c = clean_(p);
    if (!can_(u, 'viewProfit') && !can_(u, 'changePrices')) delete c.cost;
    return c;
  });
  var res = {
    ok: true, version: VERSION, serverTime: nowIso_(), today: today_(),
    user: publicUser_(u), settings: settings, products: products,
    customers: table_('Customers').rows.filter(function (c) { return biz.indexOf(c.business) >= 0 && isOn_(c.active); }).map(clean_),
    shifts: table_('Shifts').rows.filter(function (x) { return x.status === 'open' && biz.indexOf(x.business) >= 0; }).map(clean_),
    pendingRefunds: table_('Refunds').rows.filter(function (r) { return r.status === 'pending' && biz.indexOf(r.business) >= 0; }).length
  };
  if (can_(u, 'suppliers')) res.suppliers = table_('Suppliers').rows.filter(function (c) { return biz.indexOf(c.business) >= 0 && isOn_(c.active); }).map(clean_);
  if (biz.indexOf('food') >= 0) res.ingredients = table_('Ingredients').rows.filter(function (i) { return isOn_(i.active); }).map(clean_);
  return res;
}

/* ============================== actions ============================== */

var ACTIONS = {
  boot: function (u, d) { return boot_(u, d); },
  logout: function (u) { CacheService.getScriptCache().remove('tok_' + u._token); return { ok: true }; },

  'me.changePin': function (u, d) {
    if (hash_(u.salt, String(d.oldPin || '')) !== u.pinHash) throw new Error('Old PIN is wrong');
    var p = checkPin_(d.newPin);
    u.salt = newSalt_(); u.pinHash = hash_(u.salt, p); u.pinChanged = 1;
    update_('Users', u); audit_(u, 'pin.change', '');
    return { ok: true };
  },
  'me.setLang': function (u, d) {
    u.lang = d.lang === 'en' ? 'en' : 'so'; update_('Users', u); return { ok: true, lang: u.lang };
  },

  /* ---------- sales ---------- */
  'sale.create': function (u, d) {
    var id = str_(d.id, 60);
    if (!id) throw new Error('Missing sale id');
    var dup = find_('Sales', id);
    if (dup) return { ok: true, dup: true, sale: clean_(dup) };
    var biz = d.business; needBiz_(u, biz);
    var ts = clientTs_(d.ts);
    checkHours_(u, biz, isoToDate_(ts));
    var method = d.method; if (METHODS.indexOf(method) < 0) throw new Error('Choose a payment method');
    var shift = openShift_(u, biz);
    if (!shift) {   // offline sale synced after its shift was closed: attach it to the shift that covered its time
      shift = table_('Shifts').rows.filter(function (s) { return s.userId === u.id && s.business === biz && s.openTs <= ts && (!s.closeTs || s.closeTs >= ts); })[0] || null;
    }
    if (!shift && isOn_(setting_('requireShift'))) throw new Error('SHIFT: start a shift before selling');
    var items = d.items || [];
    if (!items.length) throw new Error('Cart is empty');

    var lines = [], subtotal = 0, cost = 0, touched = [];
    items.forEach(function (it) {
      var p = find_('Products', it.productId);
      if (!p || p.business !== biz) throw new Error('Product not found: ' + (it.name || it.productId));
      var q = num_(it.qty); if (q <= 0) throw new Error('Wrong quantity for ' + p.name);
      var price = num_(p.price), c = num_(p.cost);
      lines.push({ saleId: id, date: dateOf_(ts), business: biz, productId: p.id, name: p.name, qty: q, price: price, cost: c, lineTotal: price * q });
      subtotal += price * q; cost += c * q;
      if (biz === 'shop') p.stock = num_(p.stock) - q;
      p.sold = num_(p.sold) + q; touched.push(p);
    });
    var discount = Math.max(0, Math.min(num_(d.discount), subtotal));
    if (discount > 0) need_(u, 'discount');
    var total = roundTo_(subtotal - discount, setting_('roundStep'));

    var cust = null;
    if (method === 'credit') {
      if (!isOn_(setting_(biz + '_credit'))) throw new Error('Credit is turned off for this business');
      cust = find_('Customers', d.customerId);
      if (!cust || cust.business !== biz) throw new Error('Choose a credit customer');
    }
    var tendered = num_(d.tendered), cur = d.tenderCur === 'USD' ? 'USD' : 'SH', change = 0;
    if (method === 'cash' && tendered > 0) {
      change = (cur === 'USD' ? tendered * rate_() : tendered) - total;
      if (change < 0) throw new Error('Cash given is less than the total');
    }
    var orderType = biz === 'food' ? str_(d.orderType || 'Take away', 40) : '';
    var sale = { id: id, ts: ts, date: dateOf_(ts), business: biz, userId: u.id, userName: u.name, shiftId: shift ? shift.id : '',
                 method: method, orderType: orderType, customerId: cust ? cust.id : '', customerName: cust ? cust.name : '',
                 subtotal: subtotal, discount: discount, total: total, cost: cost, tendered: tendered, tenderCur: cur, change: change,
                 status: 'ok', refunded: 0, note: str_(d.note, 200) };
    insert_('Sales', sale);
    insertMany_('SaleItems', lines);
    var now = nowIso_();
    touched.forEach(function (p) { p.updatedAt = now; update_('Products', p); });
    if (cust) {
      cust.balance = num_(cust.balance) + total; update_('Customers', cust);
      insert_('CustLedger', { id: uid_('CL'), ts: ts, date: dateOf_(ts), business: biz, customerId: cust.id, type: 'sale', amount: total, method: 'credit',
                              ref: id, shiftId: sale.shiftId, userName: u.name, note: '' });
    }
    if (discount > 0) audit_(u, 'sale.discount', { sale: id, discount: discount });
    return { ok: true, sale: clean_(sale), stock: touched.map(function (p) { return { id: p.id, stock: p.stock, sold: p.sold }; }),
             customer: cust ? clean_(cust) : null };
  },

  'sales.list': function (u, d) {
    var biz = bizFilter_(u, d.business);
    var from = d.from || today_(), to = d.to || today_();
    var mine = !can_(u, 'viewReports');
    var sales = table_('Sales').rows.filter(function (s) {
      return biz.indexOf(s.business) >= 0 && s.date >= from && s.date <= to && (!mine || s.userId === u.id);
    });
    var ids = {}; sales.forEach(function (s) { ids[s.id] = []; });
    table_('SaleItems').rows.forEach(function (i) { if (ids[i.saleId]) ids[i.saleId].push(clean_(i)); });
    return { ok: true, sales: sales.slice(-300).reverse().map(function (s) { var c = clean_(s); c.items = ids[s.id]; if (!can_(u, 'viewProfit')) delete c.cost; return c; }) };
  },

  /* ---------- shifts ---------- */
  'shift.open': function (u, d) {
    var biz = d.business; needBiz_(u, biz); checkHours_(u, biz, new Date());
    var id = str_(d.id, 60) || uid_('SH');
    var ex = find_('Shifts', id); if (ex) return { ok: true, dup: true, shift: clean_(ex) };
    if (openShift_(u, biz)) throw new Error('You already have an open shift here');
    var s = { id: id, business: biz, userId: u.id, userName: u.name, status: 'open', openTs: nowIso_(), date: today_(),
              openCash: num_(d.openCash), openZaadSH: num_(d.openZaadSH), openZaadUSD: num_(d.openZaadUSD), openEdSH: num_(d.openEdSH), openEdUSD: num_(d.openEdUSD),
              rate: rate_(), note: str_(d.note) };
    insert_('Shifts', s); audit_(u, 'shift.open', { id: id, biz: biz, cash: s.openCash });
    return { ok: true, shift: clean_(s) };
  },

  'shift.preview': function (u, d) {
    var s = find_('Shifts', d.id); if (!s) throw new Error('Shift not found');
    if (s.userId !== u.id && !isOwner_(u)) throw new Error('NOPERM: not your shift');
    return { ok: true, totals: shiftTotals_(s) };
  },

  'shift.close': function (u, d) {
    var s = find_('Shifts', d.id); if (!s) throw new Error('Shift not found');
    if (s.status !== 'open') return { ok: true, dup: true, shift: clean_(s) };
    if (s.userId !== u.id && !isOwner_(u)) throw new Error('NOPERM: not your shift');
    var rate = num_(s.rate) || rate_();
    var t = shiftTotals_(s);
    s.closeCash = num_(d.closeCash); s.closeZaadSH = num_(d.closeZaadSH); s.closeZaadUSD = num_(d.closeZaadUSD);
    s.closeEdSH = num_(d.closeEdSH); s.closeEdUSD = num_(d.closeEdUSD);
    for (var k in t) s[k] = t[k];
    s.diffCash = s.closeCash - t.expectedCash;
    s.diffZaad = s.closeZaadSH + s.closeZaadUSD * rate - t.expectedZaad;
    s.diffEd = s.closeEdSH + s.closeEdUSD * rate - t.expectedEd;
    s.status = 'closed'; s.closeTs = nowIso_(); s.note = str_(d.note || s.note);
    update_('Shifts', s); audit_(u, 'shift.close', { id: s.id, diffCash: s.diffCash });
    return { ok: true, shift: clean_(s) };
  },

  'shift.list': function (u, d) {
    var biz = bizFilter_(u, d.business), from = d.from || today_(), to = d.to || today_();
    var list = table_('Shifts').rows.filter(function (s) { return biz.indexOf(s.business) >= 0 && s.date >= from && s.date <= to && (isOwner_(u) || can_(u, 'viewReports') || s.userId === u.id); });
    return { ok: true, shifts: list.reverse().map(clean_) };
  },

  /* ---------- customers ---------- */
  'cust.save': function (u, d) {
    need_(u, 'customers');
    var c = d.id ? find_('Customers', d.id) : null;
    var biz = c ? c.business : d.business; needBiz_(u, biz);
    var name = str_(d.name, 80); if (!name) throw new Error('Name is required');
    if (!c) {
      c = { id: d.id || uid_('C'), business: biz, name: name, phone: str_(d.phone, 30), balance: 0, note: str_(d.note), createdAt: nowIso_(), active: 1 };
      insert_('Customers', c); audit_(u, 'cust.add', c.name);
    } else {
      c.name = name; c.phone = str_(d.phone, 30); c.note = str_(d.note); if (d.active !== undefined) c.active = isOn_(d.active) ? 1 : 0;
      update_('Customers', c); audit_(u, 'cust.edit', c.name);
    }
    return { ok: true, customer: clean_(c) };
  },

  'cust.pay': function (u, d) {
    need_(u, 'customers');
    if (exists_('CustLedger', d.id)) return { ok: true, dup: true };
    var c = find_('Customers', d.customerId); if (!c) throw new Error('Customer not found');
    needBiz_(u, c.business);
    var amt = num_(d.amount); if (amt <= 0) throw new Error('Enter an amount');
    var m = PAY_METHODS.indexOf(d.method) >= 0 ? d.method : 'cash';
    var shift = openShift_(u, c.business);
    c.balance = num_(c.balance) - amt; update_('Customers', c);
    insert_('CustLedger', { id: d.id || uid_('CL'), ts: nowIso_(), date: today_(), business: c.business, customerId: c.id, type: 'payment', amount: amt,
                            method: m, ref: '', shiftId: shift ? shift.id : '', userName: u.name, note: str_(d.note) });
    audit_(u, 'cust.pay', { customer: c.name, amount: amt, method: m });
    return { ok: true, customer: clean_(c) };
  },

  'cust.ledger': function (u, d) {
    var c = find_('Customers', d.customerId); if (!c) throw new Error('Customer not found');
    needBiz_(u, c.business);
    return { ok: true, customer: clean_(c), ledger: table_('CustLedger').rows.filter(function (l) { return l.customerId === c.id; }).reverse().map(clean_) };
  },

  /* ---------- suppliers ---------- */
  'sup.save': function (u, d) {
    need_(u, 'suppliers');
    var s = d.id ? find_('Suppliers', d.id) : null;
    var biz = s ? s.business : d.business; needBiz_(u, biz);
    var name = str_(d.name, 80); if (!name) throw new Error('Name is required');
    if (!s) {
      s = { id: d.id || uid_('SP'), business: biz, name: name, phone: str_(d.phone, 30), balance: 0, note: str_(d.note), createdAt: nowIso_(), active: 1 };
      insert_('Suppliers', s);
    } else {
      s.name = name; s.phone = str_(d.phone, 30); s.note = str_(d.note); if (d.active !== undefined) s.active = isOn_(d.active) ? 1 : 0;
      update_('Suppliers', s);
    }
    audit_(u, 'sup.save', s.name);
    return { ok: true, supplier: clean_(s) };
  },

  // Purchase: items add stock (products or ingredients) and update cost. Paid part becomes an expense.
  'sup.purchase': function (u, d) {
    need_(u, 'suppliers');
    if (exists_('SupLedger', d.id)) return { ok: true, dup: true };
    var s = find_('Suppliers', d.supplierId); if (!s) throw new Error('Supplier not found');
    needBiz_(u, s.business);
    var items = d.items || [], total = 0, desc = [], now = nowIso_();
    items.forEach(function (it) {
      var q = num_(it.qty), c = num_(it.cost); if (q <= 0) return;
      if (it.kind === 'i') {
        var g = find_('Ingredients', it.refId); if (!g) throw new Error('Ingredient not found');
        g.stock = num_(g.stock) + q; if (c > 0) g.cost = c; g.updatedAt = now; update_('Ingredients', g);
        insert_('IngLog', { id: uid_('IL'), ts: now, date: today_(), ingredientId: g.id, name: g.name, type: 'purchase', qty: q, userName: u.name, note: s.name });
        desc.push({ kind: 'i', id: g.id, name: g.name, qty: q, cost: c });
      } else {
        var p = find_('Products', it.refId); if (!p || p.business !== s.business) throw new Error('Product not found');
        var before = num_(p.stock); p.stock = before + q; if (c > 0) p.cost = c; p.updatedAt = now; update_('Products', p);
        insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: p.business, productId: p.id, name: p.name, type: 'purchase',
                              before: before, after: p.stock, diff: q, userName: u.name, note: s.name });
        desc.push({ kind: 'p', id: p.id, name: p.name, qty: q, cost: c });
      }
      total += q * c;
    });
    if (num_(d.total) > 0 && !items.length) total = num_(d.total);
    var paid = Math.min(Math.max(0, num_(d.paid)), total);
    var m = PAY_METHODS.indexOf(d.method) >= 0 ? d.method : 'cash';
    var id = d.id || uid_('PU');
    s.balance = num_(s.balance) + total - paid; update_('Suppliers', s);
    insert_('SupLedger', { id: id, ts: now, date: today_(), business: s.business, supplierId: s.id, type: 'purchase', amount: total, paid: paid,
                           method: m, items: desc, userName: u.name, note: str_(d.note) });
    if (paid > 0) addExpense_(u, s.business, supCat_(s), paid, m, id, 'Paid to ' + s.name);
    audit_(u, 'sup.purchase', { supplier: s.name, total: total, paid: paid });
    return { ok: true, supplier: clean_(s), total: total };
  },

  'sup.pay': function (u, d) {
    need_(u, 'suppliers');
    if (exists_('SupLedger', d.id)) return { ok: true, dup: true };
    var s = find_('Suppliers', d.supplierId); if (!s) throw new Error('Supplier not found');
    needBiz_(u, s.business);
    var amt = num_(d.amount); if (amt <= 0) throw new Error('Enter an amount');
    var m = PAY_METHODS.indexOf(d.method) >= 0 ? d.method : 'cash';
    var id = d.id || uid_('SPY');
    s.balance = num_(s.balance) - amt; update_('Suppliers', s);
    insert_('SupLedger', { id: id, ts: nowIso_(), date: today_(), business: s.business, supplierId: s.id, type: 'payment', amount: amt, paid: amt,
                           method: m, items: '', userName: u.name, note: str_(d.note) });
    addExpense_(u, s.business, supCat_(s), amt, m, id, 'Paid to ' + s.name);
    audit_(u, 'sup.pay', { supplier: s.name, amount: amt });
    return { ok: true, supplier: clean_(s) };
  },

  'sup.ledger': function (u, d) {
    need_(u, 'suppliers');
    var s = find_('Suppliers', d.supplierId); if (!s) throw new Error('Supplier not found');
    return { ok: true, supplier: clean_(s), ledger: table_('SupLedger').rows.filter(function (l) { return l.supplierId === s.id; }).reverse().map(clean_) };
  },

  /* ---------- expenses ---------- */
  'exp.create': function (u, d) {
    need_(u, 'expenses');
    if (exists_('Expenses', d.id)) return { ok: true, dup: true };
    needBiz_(u, d.business);
    var amt = num_(d.amount); if (amt <= 0) throw new Error('Enter an amount');
    var e = addExpense_(u, d.business, str_(d.category, 40) || 'Other', amt, d.method, '', str_(d.note), d.id);
    return { ok: true, expense: clean_(e) };
  },

  'exp.list': function (u, d) {
    var biz = bizFilter_(u, d.business), from = d.from || today_(), to = d.to || today_();
    var list = table_('Expenses').rows.filter(function (e) { return biz.indexOf(e.business) >= 0 && e.date >= from && e.date <= to && (can_(u, 'viewReports') || e.userName === u.name); });
    return { ok: true, expenses: list.reverse().map(clean_) };
  },

  /* ---------- refunds ---------- */
  'refund.request': function (u, d) {
    if (exists_('Refunds', d.id)) return { ok: true, dup: true };
    var sale = find_('Sales', d.saleId); if (!sale) throw new Error('Sale not found (it may still be syncing)');
    needBiz_(u, sale.business);
    var reason = str_(d.reason, 200); if (!reason) throw new Error('Write a reason');
    var items = table_('SaleItems').rows.filter(function (i) { return i.saleId === sale.id; });
    var already = {};
    table_('Refunds').rows.forEach(function (r) {
      if (r.saleId !== sale.id || r.status === 'rejected') return;
      JSON.parse(r.items || '[]').forEach(function (x) { already[x.productId] = (already[x.productId] || 0) + num_(x.qty); });
    });
    var want = d.items && d.items.length ? d.items : items.map(function (i) { return { productId: i.productId, qty: num_(i.qty) - (already[i.productId] || 0) }; });
    var list = [], lineSum = 0, cost = 0;
    want.forEach(function (w) {
      var q = num_(w.qty); if (q <= 0) return;
      var line = items.filter(function (i) { return i.productId === w.productId; })[0];
      if (!line) throw new Error('Item not in this sale');
      if (q > num_(line.qty) - (already[line.productId] || 0)) throw new Error('Too many returned for ' + line.name);
      list.push({ productId: line.productId, name: line.name, qty: q, price: num_(line.price) });
      lineSum += q * num_(line.price); cost += q * num_(line.cost);
    });
    if (!list.length) throw new Error('Nothing left to refund on this sale');
    var sub = num_(sale.subtotal) || 1;
    var amount = Math.min(Math.round(lineSum * num_(sale.total) / sub), num_(sale.total) - num_(sale.refunded));
    var r = { id: d.id || uid_('RF'), ts: nowIso_(), date: today_(), business: sale.business, saleId: sale.id, items: list, amount: amount, cost: cost,
              method: sale.method, reason: reason, status: 'pending', requestedBy: u.name, decidedBy: '', decidedTs: '', note: '', shiftId: '' };
    insert_('Refunds', r); audit_(u, 'refund.request', { sale: sale.id, amount: amount, reason: reason });
    return { ok: true, refund: clean_(r) };
  },

  'refund.decide': function (u, d) {
    need_(u, 'approveRefunds');
    var r = find_('Refunds', d.id); if (!r) throw new Error('Refund not found');
    if (r.status !== 'pending') return { ok: true, dup: true, refund: clean_(r) };
    needBiz_(u, r.business);
    r.decidedBy = u.name; r.decidedTs = nowIso_(); r.note = str_(d.note);
    if (!d.approve) { r.status = 'rejected'; update_('Refunds', r); audit_(u, 'refund.reject', r.id); return { ok: true, refund: clean_(r) }; }
    var sale = find_('Sales', r.saleId);
    var items = JSON.parse(r.items || '[]'), now = nowIso_();
    if (r.business === 'shop') items.forEach(function (x) {
      var p = find_('Products', x.productId); if (!p) return;
      var before = num_(p.stock); p.stock = before + num_(x.qty); p.sold = Math.max(0, num_(p.sold) - num_(x.qty)); p.updatedAt = now; update_('Products', p);
      insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: p.business, productId: p.id, name: p.name, type: 'refund', before: before, after: p.stock, diff: num_(x.qty), userName: u.name, note: r.id });
    });
    if (r.method === 'credit' && sale && sale.customerId) {
      var c = find_('Customers', sale.customerId);
      if (c) {
        c.balance = num_(c.balance) - num_(r.amount); update_('Customers', c);
        insert_('CustLedger', { id: uid_('CL'), ts: now, date: today_(), business: c.business, customerId: c.id, type: 'refund', amount: num_(r.amount), method: 'credit', ref: r.id, shiftId: '', userName: u.name, note: '' });
      }
    }
    var sh = anyOpenShift_(r.business);
    r.shiftId = sh ? sh.id : '';
    r.status = 'approved'; update_('Refunds', r);
    if (sale) { sale.refunded = num_(sale.refunded) + num_(r.amount); sale.status = sale.refunded >= num_(sale.total) ? 'refunded' : 'partial'; update_('Sales', sale); }
    audit_(u, 'refund.approve', { id: r.id, amount: r.amount });
    return { ok: true, refund: clean_(r) };
  },

  'refund.list': function (u, d) {
    var biz = bizFilter_(u, d.business);
    var list = table_('Refunds').rows.filter(function (r) { return biz.indexOf(r.business) >= 0 && (d.status ? r.status === d.status : true) && (can_(u, 'approveRefunds') || r.requestedBy === u.name); });
    return { ok: true, refunds: list.slice(-200).reverse().map(clean_) };
  },

  /* ---------- products & stock ---------- */
  'prod.save': function (u, d) {
    var p = d.id ? find_('Products', d.id) : null;
    var biz = p ? p.business : d.business; needBiz_(u, biz);
    var name = str_(d.name, 100); if (!name) throw new Error('Name is required');
    var barcode = str_(d.barcode, 60);
    if (barcode) table_('Products').rows.forEach(function (x) { if (x.barcode === barcode && x.business === biz && (!p || x.id !== p.id)) throw new Error('Barcode already used by ' + x.name); });
    var now = nowIso_();
    if (!p) {
      need_(u, 'manageProducts');
      p = { id: d.id || uid_('P'), business: biz, name: name, barcode: barcode, category: str_(d.category, 40), price: num_(d.price), cost: num_(d.cost),
            stock: biz === 'shop' ? num_(d.stock) : '', lowStock: d.lowStock === '' || d.lowStock === undefined ? num_(setting_('defaultLowStock')) : num_(d.lowStock),
            expiry: str_(d.expiry, 10), active: 1, fav: isOn_(d.fav) ? 1 : 0, sold: 0, updatedAt: now };
      insert_('Products', p);
      if (biz === 'shop' && num_(p.stock)) insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: biz, productId: p.id, name: p.name, type: 'new', before: 0, after: p.stock, diff: p.stock, userName: u.name, note: '' });
      audit_(u, 'prod.add', { name: name, price: p.price });
    } else {
      var priceChange = num_(d.price) !== num_(p.price) || (d.cost !== undefined && num_(d.cost) !== num_(p.cost));
      if (priceChange) need_(u, 'changePrices');
      if (!priceChange && !can_(u, 'manageProducts') && !can_(u, 'changePrices')) need_(u, 'manageProducts');
      var log = { name: p.name };
      if (priceChange) { log.oldPrice = p.price; log.newPrice = num_(d.price); }
      p.name = name; p.barcode = barcode; p.price = num_(d.price);
      if (d.cost !== undefined) p.cost = num_(d.cost);
      if (can_(u, 'manageProducts')) {
        p.category = str_(d.category, 40); p.lowStock = num_(d.lowStock); p.expiry = str_(d.expiry, 10);
        if (d.active !== undefined) p.active = isOn_(d.active) ? 1 : 0;
        if (d.fav !== undefined) p.fav = isOn_(d.fav) ? 1 : 0;
        if (biz === 'shop' && d.stock !== undefined && d.stock !== '' && num_(d.stock) !== num_(p.stock)) {
          insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: biz, productId: p.id, name: p.name, type: 'edit', before: num_(p.stock), after: num_(d.stock), diff: num_(d.stock) - num_(p.stock), userName: u.name, note: '' });
          log.stock = [p.stock, num_(d.stock)]; p.stock = num_(d.stock);
        }
      }
      p.updatedAt = now; update_('Products', p); audit_(u, priceChange ? 'prod.price' : 'prod.edit', log);
    }
    return { ok: true, product: clean_(p) };
  },

  'prod.import': function (u, d) {
    need_(u, 'manageProducts');
    var biz = d.business; needBiz_(u, biz);
    var rows = d.rows || [], added = 0, updated = 0, skipped = 0, now = nowIso_(), fresh = [];
    var all = table_('Products').rows.filter(function (p) { return p.business === biz; });
    rows.forEach(function (r) {
      var name = str_(r.name, 100); if (!name || !(num_(r.price) > 0)) { skipped++; return; }
      var bc = str_(r.barcode, 60);
      var p = all.filter(function (x) { return (bc && x.barcode === bc) || (!bc && String(x.name).toLowerCase() === name.toLowerCase()); })[0];
      if (p) {
        p.name = name; p.price = num_(r.price); if (r.cost !== '' && r.cost !== undefined) p.cost = num_(r.cost);
        if (r.category) p.category = str_(r.category, 40);
        if (biz === 'shop' && r.stock !== '' && r.stock !== undefined) p.stock = num_(r.stock);
        if (r.lowStock !== '' && r.lowStock !== undefined) p.lowStock = num_(r.lowStock);
        if (r.expiry) p.expiry = str_(r.expiry, 10);
        p.updatedAt = now; update_('Products', p); updated++;
      } else {
        p = { id: uid_('P'), business: biz, name: name, barcode: bc, category: str_(r.category, 40), price: num_(r.price), cost: num_(r.cost),
              stock: biz === 'shop' ? num_(r.stock) : '', lowStock: r.lowStock === '' || r.lowStock === undefined ? num_(setting_('defaultLowStock')) : num_(r.lowStock),
              expiry: str_(r.expiry, 10), active: 1, fav: 0, sold: 0, updatedAt: now };
        fresh.push(p); all.push(p); added++;
      }
    });
    insertMany_('Products', fresh);
    audit_(u, 'prod.import', { business: biz, added: added, updated: updated, skipped: skipped });
    return { ok: true, added: added, updated: updated, skipped: skipped };
  },

  'stock.count': function (u, d) {
    need_(u, 'stockCount');
    if (d.id && table_('StockLog').rows.some(function (l) { return l.note === d.id; })) return { ok: true, dup: true };
    var now = nowIso_(), changed = 0, logs = [];
    (d.counts || []).forEach(function (c) {
      var p = find_('Products', c.productId); if (!p || p.business !== 'shop') return;
      needBiz_(u, p.business);
      var before = num_(p.stock), after = num_(c.counted);
      if (before === after) return;
      p.stock = after; p.updatedAt = now; update_('Products', p); changed++;
      logs.push({ id: uid_('SL'), ts: now, date: today_(), business: p.business, productId: p.id, name: p.name, type: 'count', before: before, after: after, diff: after - before, userName: u.name, note: d.id || '' });
    });
    insertMany_('StockLog', logs);
    audit_(u, 'stock.count', { changed: changed });
    return { ok: true, changed: changed, logs: logs.map(clean_) };
  },

  'stock.log': function (u, d) {
    need_(u, 'viewStock');
    var from = d.from || today_(), to = d.to || today_();
    return { ok: true, logs: table_('StockLog').rows.filter(function (l) { return l.date >= from && l.date <= to; }).slice(-500).reverse().map(clean_) };
  },

  /* ---------- ingredients (Fast Food) ---------- */
  'ing.save': function (u, d) {
    need_(u, 'manageProducts');
    var g = d.id ? find_('Ingredients', d.id) : null;
    var name = str_(d.name, 60); if (!name) throw new Error('Name is required');
    if (!g) {
      g = { id: uid_('I'), name: name, unit: str_(d.unit, 20), stock: num_(d.stock), lowLevel: num_(d.lowLevel), cost: num_(d.cost), active: 1, updatedAt: nowIso_() };
      insert_('Ingredients', g);
    } else {
      g.name = name; g.unit = str_(d.unit, 20); g.lowLevel = num_(d.lowLevel); g.cost = num_(d.cost);
      if (d.active !== undefined) g.active = isOn_(d.active) ? 1 : 0;
      g.updatedAt = nowIso_(); update_('Ingredients', g);
    }
    audit_(u, 'ing.save', g.name);
    return { ok: true, ingredient: clean_(g) };
  },

  // type 'use' = end of day usage (subtract), 'add' = new stock bought (add), 'set' = correct the count
  'ing.move': function (u, d) {
    need_(u, 'ingredients'); needBiz_(u, 'food');
    if (d.id && table_('IngLog').rows.some(function (l) { return l.note === d.id; })) return { ok: true, dup: true };
    var type = ['use', 'add', 'set'].indexOf(d.type) >= 0 ? d.type : 'use';
    if (type === 'set') need_(u, 'manageProducts');
    var now = nowIso_(), logs = [], low = [];
    (d.entries || []).forEach(function (e) {
      var g = find_('Ingredients', e.ingredientId); if (!g) return;
      var q = num_(e.qty); if (q < 0 || (q === 0 && type !== 'set')) return;
      var before = num_(g.stock);
      g.stock = type === 'use' ? before - q : type === 'add' ? before + q : q;
      g.updatedAt = now; update_('Ingredients', g);
      logs.push({ id: uid_('IL'), ts: now, date: today_(), ingredientId: g.id, name: g.name, type: type, qty: type === 'set' ? q - before : q, userName: u.name, note: d.id || '' });
      if (num_(g.stock) <= num_(g.lowLevel)) low.push(g.name);
    });
    insertMany_('IngLog', logs);
    audit_(u, 'ing.' + type, logs.map(function (l) { return l.name + ' ' + l.qty; }).join(', '));
    return { ok: true, ingredients: table_('Ingredients').rows.filter(function (i) { return isOn_(i.active); }).map(clean_), low: low };
  },

  'ing.log': function (u, d) {
    var from = d.from || today_(), to = d.to || today_();
    return { ok: true, logs: table_('IngLog').rows.filter(function (l) { return l.date >= from && l.date <= to; }).slice(-500).reverse().map(clean_) };
  },

  /* ---------- users ---------- */
  'users.list': function (u) {
    need_(u, 'manageUsers');
    return { ok: true, users: table_('Users').rows.map(publicUser_), perms: PERMS };
  },

  'users.save': function (u, d) {
    need_(u, 'manageUsers');
    var x = d.id ? find_('Users', d.id) : null;
    var name = str_(d.name, 40); if (!name) throw new Error('Name is required');
    table_('Users').rows.forEach(function (o) { if (String(o.name).toLowerCase() === name.toLowerCase() && (!x || o.id !== x.id)) throw new Error('Name already exists'); });
    var role = d.role === 'owner' ? 'owner' : 'employee';
    var business = role === 'owner' ? 'both' : (BIZ.indexOf(d.business) >= 0 ? d.business : 'shop');
    var perms = (d.perms || []).filter(function (p) { return PERMS.indexOf(p) >= 0; });
    var pin = null;
    if (!x) {
      pin = d.pin ? checkPin_(d.pin) : randomPin_();
      var salt = newSalt_();
      x = { id: uid_('U'), name: name, role: role, business: business, pinHash: hash_(salt, pin), salt: salt, active: 1, lang: d.lang === 'en' ? 'en' : 'so',
            afterHours: d.afterHours === undefined ? (role === 'owner' ? 1 : 0) : (isOn_(d.afterHours) ? 1 : 0), perms: JSON.stringify(perms), createdAt: nowIso_(), pinChanged: 0 };
      insert_('Users', x); audit_(u, 'user.add', { name: name, role: role, business: business });
    } else {
      if (x.id === u.id && (role !== 'owner' || !isOn_(d.active === undefined ? 1 : d.active))) throw new Error('You cannot remove your own owner access');
      if (x.role === 'owner' && (role !== 'owner' || (d.active !== undefined && !isOn_(d.active)))) {
        var owners = table_('Users').rows.filter(function (o) { return o.role === 'owner' && isOn_(o.active); });
        if (owners.length <= 1) throw new Error('There must be at least one active owner');
      }
      x.name = name; x.role = role; x.business = business; x.lang = d.lang === 'en' ? 'en' : 'so';
      x.afterHours = isOn_(d.afterHours) ? 1 : 0; x.perms = JSON.stringify(perms);
      if (d.active !== undefined) x.active = isOn_(d.active) ? 1 : 0;
      update_('Users', x); audit_(u, 'user.edit', { name: name, role: role, business: business, perms: perms, active: x.active });
    }
    return { ok: true, user: publicUser_(x), pin: pin };
  },

  'users.resetPin': function (u, d) {
    need_(u, 'manageUsers');
    var x = find_('Users', d.id); if (!x) throw new Error('User not found');
    var pin = d.pin ? checkPin_(d.pin) : randomPin_();
    x.salt = newSalt_(); x.pinHash = hash_(x.salt, pin); x.pinChanged = 0; update_('Users', x);
    var cache = CacheService.getScriptCache(); cache.remove('lock_' + x.id); cache.remove('fail_' + x.id);
    audit_(u, 'user.resetPin', x.name);
    return { ok: true, pin: pin };
  },

  /* ---------- settings ---------- */
  'settings.save': function (u, d) {
    need_(u, 'settings');
    var t = table_('Settings'), changed = [];
    Object.keys(d.values || {}).forEach(function (k) {
      if (!(k in DEFAULT_SETTINGS)) return;
      var v = str_(d.values[k], 500);
      if (k === 'usdRate' && !(num_(v) > 0)) throw new Error('USD rate must be a number');
      if (k === 'roundStep' && !(num_(v) >= 1)) throw new Error('Rounding step must be at least 1');
      var row = t.rows.filter(function (r) { return r.key === k; })[0];
      if (row) { if (String(row.value) === v) return; changed.push(k + ': ' + row.value + ' → ' + v); row.value = v; update_('Settings', row); }
      else { insert_('Settings', { key: k, value: v, note: DEFAULT_SETTINGS[k][1] }); changed.push(k + ': ' + v); }
    });
    T_._settings = null;
    if (changed.length) audit_(u, 'settings', changed.join('; '));
    return boot_(u, {});
  },

  /* ---------- reports ---------- */
  report: function (u, d) { need_(u, 'viewReports'); return report_(u, d); },

  'export': function (u, d) {
    need_(u, 'export');
    var biz = bizFilter_(u, d.business), from = d.from || today_(), to = d.to || today_();
    var name = { sales: 'Sales', items: 'SaleItems', expenses: 'Expenses', shifts: 'Shifts', customers: 'Customers', products: 'Products', custledger: 'CustLedger', supledger: 'SupLedger', refunds: 'Refunds' }[d.type];
    if (!name) throw new Error('Unknown export');
    var t = table_(name), headers = t.headers.filter(function (h) { return h !== 'pinHash' && h !== 'salt' && (h !== 'cost' || can_(u, 'viewProfit')); });
    var rows = t.rows.filter(function (r) {
      if (r.business && biz.indexOf(r.business) < 0) return false;
      if (r.date && (name !== 'Customers' && name !== 'Products')) return r.date >= from && r.date <= to;
      return true;
    }).map(function (r) { return headers.map(function (h) { return r[h]; }); });
    audit_(u, 'export', { type: d.type, from: from, to: to, rows: rows.length });
    return { ok: true, headers: headers, rows: rows };
  },

  'audit.list': function (u, d) {
    need_(u, 'audit');
    var from = d.from || today_(), to = d.to || today_(), q = String(d.q || '').toLowerCase();
    var list = table_('Audit').rows.filter(function (a) { var dt = dateOf_(a.ts); return dt >= from && dt <= to && (!q || JSON.stringify(a).toLowerCase().indexOf(q) >= 0); });
    return { ok: true, audit: list.slice(-500).reverse().map(clean_) };
  },

  'backup.now': function (u) {
    if (!isOwner_(u)) throw new Error('NOPERM: owners only');
    var f = backup_('manual');
    audit_(u, 'backup', f);
    return { ok: true, name: f };
  }
};

/* ============================== business helpers ============================== */

function clientTs_(ts) {
  var now = new Date();
  if (ts) {
    var t = new Date(ts);
    if (!isNaN(t) && t.getTime() <= now.getTime() + 10 * 60000 && t.getTime() >= now.getTime() - 3 * 86400000)
      return Utilities.formatDate(t, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return nowIso_();
}
function isoToDate_(iso) {   // iso is local TZ time without offset
  var m = String(iso).match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/);
  if (!m) return new Date();
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5]));   // TZ is UTC+3
}

function openShift_(u, biz) {
  return table_('Shifts').rows.filter(function (s) { return s.status === 'open' && s.userId === u.id && s.business === biz; })[0] || null;
}
function anyOpenShift_(biz) {
  var l = table_('Shifts').rows.filter(function (s) { return s.status === 'open' && s.business === biz; });
  return l[l.length - 1] || null;
}

function bizFilter_(u, b) {
  var all = bizList_(u);
  if (!b || b === 'all') return all;
  needBiz_(u, b); return [b];
}

function supCat_(s) { return s.business === 'food' ? 'Ingredients' : 'Supplier purchases'; }

function addExpense_(u, biz, cat, amt, method, ref, note, id) {
  var shift = openShift_(u, biz);
  var e = { id: id || uid_('EX'), ts: nowIso_(), date: today_(), business: biz, category: cat, amount: num_(amt),
            method: PAY_METHODS.indexOf(method) >= 0 ? method : 'cash', shiftId: shift ? shift.id : '', ref: ref || '', userName: u.name, note: note || '' };
  insert_('Expenses', e);
  audit_(u, 'expense', { cat: cat, amount: e.amount, method: e.method });
  return e;
}

function shiftTotals_(s) {
  var t = { cashSales: 0, zaadSales: 0, edSales: 0, creditSales: 0, custPayCash: 0, custPayZaad: 0, custPayEd: 0, expCash: 0, expZaad: 0, expEd: 0, refCash: 0, refZaad: 0, refEd: 0, saleCount: 0 };
  var key = { cash: 'Cash', zaad: 'Zaad', edahab: 'Ed' };
  table_('Sales').rows.forEach(function (x) {
    if (x.shiftId !== s.id) return;
    t.saleCount++;
    if (x.method === 'credit') t.creditSales += num_(x.total); else t[{ cash: 'cashSales', zaad: 'zaadSales', edahab: 'edSales' }[x.method]] += num_(x.total);
  });
  table_('CustLedger').rows.forEach(function (x) { if (x.shiftId === s.id && x.type === 'payment' && key[x.method]) t['custPay' + key[x.method]] += num_(x.amount); });
  table_('Expenses').rows.forEach(function (x) { if (x.shiftId === s.id && key[x.method]) t['exp' + key[x.method]] += num_(x.amount); });
  table_('Refunds').rows.forEach(function (x) { if (x.shiftId === s.id && x.status === 'approved' && key[x.method]) t['ref' + key[x.method]] += num_(x.amount); });
  var rate = num_(s.rate) || rate_();
  t.expectedCash = num_(s.openCash) + t.cashSales + t.custPayCash - t.expCash - t.refCash;
  t.expectedZaad = num_(s.openZaadSH) + num_(s.openZaadUSD) * rate + t.zaadSales + t.custPayZaad - t.expZaad - t.refZaad;
  t.expectedEd = num_(s.openEdSH) + num_(s.openEdUSD) * rate + t.edSales + t.custPayEd - t.expEd - t.refEd;
  return t;
}

function report_(u, d) {
  var biz = bizFilter_(u, d.business), from = d.from || today_(), to = d.to || today_();
  var profitOk = can_(u, 'viewProfit');
  var inR = function (x) { return biz.indexOf(x.business) >= 0 && x.date >= from && x.date <= to; };
  var blank = function () { return { count: 0, subtotal: 0, discount: 0, sales: 0, cost: 0, refunds: 0, refundCost: 0, expenses: 0, stockPurchases: 0, cash: 0, zaad: 0, edahab: 0, credit: 0, custPay: 0 }; };
  var byBiz = { shop: blank(), food: blank() }, days = {}, emp = {}, items = {};
  var sales = table_('Sales').rows.filter(inR), saleIds = {};
  sales.forEach(function (s) {
    var b = byBiz[s.business]; saleIds[s.id] = 1;
    b.count++; b.subtotal += num_(s.subtotal); b.discount += num_(s.discount); b.sales += num_(s.total); b.cost += num_(s.cost); b[s.method] += num_(s.total);
    var k = s.date + '|' + s.business;
    var dd = days[k] || (days[k] = { date: s.date, business: s.business, count: 0, total: 0, cash: 0, zaad: 0, edahab: 0, credit: 0 });
    dd.count++; dd.total += num_(s.total); dd[s.method] += num_(s.total);
    var e = emp[s.userName + '|' + s.business] || (emp[s.userName + '|' + s.business] = { name: s.userName, business: s.business, count: 0, total: 0 });
    e.count++; e.total += num_(s.total);
  });
  table_('SaleItems').rows.forEach(function (i) {
    if (!saleIds[i.saleId]) return;
    var it = items[i.productId] || (items[i.productId] = { productId: i.productId, name: i.name, business: i.business, qty: 0, revenue: 0, profit: 0 });
    it.qty += num_(i.qty); it.revenue += num_(i.lineTotal); it.profit += num_(i.lineTotal) - num_(i.cost) * num_(i.qty);
  });
  table_('Refunds').rows.forEach(function (r) {
    if (r.status !== 'approved' || biz.indexOf(r.business) < 0) return;
    var dt = dateOf_(r.decidedTs || r.ts); if (dt < from || dt > to) return;
    byBiz[r.business].refunds += num_(r.amount); byBiz[r.business].refundCost += num_(r.cost);
  });
  var expCats = {};
  table_('Expenses').rows.filter(inR).forEach(function (e) {
    var b = byBiz[e.business];
    if (e.category === 'Supplier purchases') b.stockPurchases += num_(e.amount); else b.expenses += num_(e.amount);
    var k = e.category + '|' + e.business; expCats[k] = expCats[k] || { category: e.category, business: e.business, amount: 0 }; expCats[k].amount += num_(e.amount);
  });
  table_('CustLedger').rows.filter(inR).forEach(function (l) { if (l.type === 'payment') byBiz[l.business].custPay += num_(l.amount); });
  var totals = blank();
  BIZ.forEach(function (b) {
    var x = byBiz[b];
    x.netSales = x.sales - x.refunds;
    x.profit = x.netSales - (x.cost - x.refundCost) - x.expenses;
    if (biz.indexOf(b) >= 0) for (var k in x) totals[k] = (totals[k] || 0) + x[k];
    if (!profitOk) { delete x.cost; delete x.profit; delete x.refundCost; }
  });
  if (!profitOk) { delete totals.cost; delete totals.profit; delete totals.refundCost; }

  var warn = num_(setting_('expiryWarnDays')), lim = Utilities.formatDate(new Date(Date.now() + warn * 86400000), TZ, 'yyyy-MM-dd');
  var prods = table_('Products').rows.filter(function (p) { return biz.indexOf(p.business) >= 0 && isOn_(p.active); });
  var lowStock = prods.filter(function (p) { return p.business === 'shop' && num_(p.stock) <= num_(p.lowStock); }).map(function (p) { return { id: p.id, name: p.name, stock: num_(p.stock), lowStock: num_(p.lowStock) }; });
  var expiring = prods.filter(function (p) { return p.expiry && String(p.expiry) <= lim; }).map(function (p) { return { id: p.id, name: p.name, expiry: p.expiry, expired: String(p.expiry) < today_(), stock: p.stock }; });
  var lowIng = biz.indexOf('food') >= 0 ? table_('Ingredients').rows.filter(function (g) { return isOn_(g.active) && num_(g.stock) <= num_(g.lowLevel); }).map(clean_) : [];
  var debts = table_('Customers').rows.filter(function (c) { return biz.indexOf(c.business) >= 0 && num_(c.balance) > 0; })
               .map(function (c) { return { id: c.id, name: c.name, phone: c.phone, business: c.business, balance: num_(c.balance) }; }).sort(function (a, b) { return b.balance - a.balance; });
  var supOwed = table_('Suppliers').rows.filter(function (s) { return biz.indexOf(s.business) >= 0 && num_(s.balance) > 0; })
               .map(function (s) { return { id: s.id, name: s.name, business: s.business, balance: num_(s.balance) }; });
  // Latest money balances: last closed shift per business, plus live expected for open shifts.
  var balances = BIZ.filter(function (b) { return biz.indexOf(b) >= 0; }).map(function (b) {
    var sh = table_('Shifts').rows.filter(function (s) { return s.business === b; });
    var closed = sh.filter(function (s) { return s.status === 'closed'; }).pop();
    var open = sh.filter(function (s) { return s.status === 'open'; }).map(function (s) { var t = shiftTotals_(s); return { id: s.id, userName: s.userName, openTs: s.openTs, expectedCash: t.expectedCash, expectedZaad: t.expectedZaad, expectedEd: t.expectedEd, saleCount: t.saleCount }; });
    var rate = closed ? num_(closed.rate) || rate_() : rate_();
    return { business: b, last: closed ? { closeTs: closed.closeTs, userName: closed.userName, cash: num_(closed.closeCash), zaad: num_(closed.closeZaadSH) + num_(closed.closeZaadUSD) * rate,
             edahab: num_(closed.closeEdSH) + num_(closed.closeEdUSD) * rate, diffCash: num_(closed.diffCash), diffZaad: num_(closed.diffZaad), diffEd: num_(closed.diffEd) } : null, open: open };
  });
  var shifts = table_('Shifts').rows.filter(inR).map(clean_);
  var top = Object.keys(items).map(function (k) { var i = items[k]; if (!profitOk) delete i.profit; return i; });
  return {
    ok: true, from: from, to: to, business: biz, byBiz: byBiz, totals: totals,
    days: Object.keys(days).sort().map(function (k) { return days[k]; }),
    employees: Object.keys(emp).map(function (k) { return emp[k]; }).sort(function (a, b) { return b.total - a.total; }),
    topItems: top.sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 20),
    slowItems: prods.filter(function (p) { return !items[p.id]; }).slice(0, 20).map(function (p) { return { id: p.id, name: p.name, stock: p.stock }; }),
    expenses: Object.keys(expCats).map(function (k) { return expCats[k]; }),
    lowStock: lowStock, lowIngredients: lowIng, expiring: expiring, debts: debts, totalDebt: debts.reduce(function (a, c) { return a + c.balance; }, 0),
    suppliersOwed: supOwed, balances: balances, shifts: shifts,
    pendingRefunds: table_('Refunds').rows.filter(function (r) { return r.status === 'pending' && biz.indexOf(r.business) >= 0; }).length,
    profitVisible: profitOk
  };
}

/* ============================== setup, menu, backups ============================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Saado POS')
    .addItem('1. Run setup (safe to repeat)', 'setup')
    .addItem('2. Back up now', 'backupNow')
    .addItem('3. Reset an owner PIN (shows new PIN)', 'emergencyResetOwnerPin')
    .addToUi();
}

/** Creates every tab/header/setting, default users and ingredients, and the daily backup trigger. Safe to run twice. */
function setup() {
  var ss = ss_();
  try { ss.setSpreadsheetTimeZone(TZ); } catch (e) {}
  Object.keys(SCHEMA).forEach(function (name) {
    var h = SCHEMA[name], sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getMaxColumns() < h.length) sh.insertColumnsAfter(sh.getMaxColumns(), h.length - sh.getMaxColumns());
    var cur = sh.getRange(1, 1, 1, h.length).getValues()[0];
    if (cur.join('|') !== h.join('|')) sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#003366').setFontColor('#FFFFFF');
    sh.getRange(1, 1, sh.getMaxRows(), h.length).setNumberFormat('@');   // plain text: keeps barcodes, dates and leading zeros exact
    sh.setFrozenRows(1);
  });
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  T_ = {};
  var have = settingsMap_();
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { if (!(k in have)) insert_('Settings', { key: k, value: DEFAULT_SETTINGS[k][0], note: DEFAULT_SETTINGS[k][1] }); });
  if (!table_('Ingredients').rows.length) {
    [['Flour', 'kg', 10], ['Oil', 'liters', 5], ['Potatoes', 'bags', 2], ['Chicken', 'units', 10]].forEach(function (g) {
      insert_('Ingredients', { id: uid_('I'), name: g[0], unit: g[1], stock: 0, lowLevel: g[2], cost: 0, active: 1, updatedAt: nowIso_() });
    });
  }
  var shown = [];
  if (!table_('Users').rows.length) {
    [['Zakariye', 'owner', 'both'], ['Hussein', 'owner', 'both'], ['Raxma', 'employee', 'shop'], ['Sacad', 'employee', 'food']].forEach(function (x) {
      var pin = randomPin_(), salt = newSalt_();
      insert_('Users', { id: uid_('U'), name: x[0], role: x[1], business: x[2], pinHash: hash_(salt, pin), salt: salt, active: 1, lang: 'so',
                         afterHours: x[1] === 'owner' ? 1 : 0, perms: JSON.stringify(x[1] === 'owner' ? [] : EMPLOYEE_DEFAULT_PERMS), createdAt: nowIso_(), pinChanged: 0 });
      shown.push(x[0] + ': ' + pin);
    });
  }
  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyBackup'; });
  if (!hasTrigger) ScriptApp.newTrigger('dailyBackup').timeBased().atHour(3).everyDays(1).inTimezone(TZ).create();
  var msg = 'Saado POS setup done (version ' + VERSION + ').' + (shown.length ? '\n\nNew PINs (write them down, they are not shown again):\n' + shown.join('\n') : '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function dailyBackup() { T_ = {}; backup_('daily'); }
function backupNow() { var n = backup_('manual'); try { SpreadsheetApp.getUi().alert('Backup saved: ' + n); } catch (e) {} }

function backup_(kind) {
  var ss = ss_();
  var it = DriveApp.getFoldersByName('Saado POS Backups');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('Saado POS Backups');
  var name = 'Saado POS backup ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm') + ' (' + kind + ')';
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  // keep: last 30 daily copies, every copy made on the 1st of a month (monthly) for 24 months, all manual copies
  var files = folder.getFiles(), list = [];
  while (files.hasNext()) { var f = files.next(); list.push(f); }
  var daily = list.filter(function (f) { return /\(daily\)$/.test(f.getName()) && !/-01 \d{4} /.test(f.getName()); })
                  .sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  daily.slice(30).forEach(function (f) { f.setTrashed(true); });
  var monthly = list.filter(function (f) { return /\(daily\)$/.test(f.getName()) && /-01 \d{4} /.test(f.getName()); })
                  .sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  monthly.slice(24).forEach(function (f) { f.setTrashed(true); });
  return name;
}

/** Emergency: if every owner forgets the PIN. Run from the editor; it shows a new PIN for the first owner. */
function emergencyResetOwnerPin() {
  T_ = {};
  var o = table_('Users').rows.filter(function (u) { return u.role === 'owner'; })[0];
  if (!o) throw new Error('No owner');
  var pin = randomPin_(); o.salt = newSalt_(); o.pinHash = hash_(o.salt, pin); o.active = 1; update_('Users', o);
  CacheService.getScriptCache().remove('lock_' + o.id);
  var msg = 'New PIN for ' + o.name + ': ' + pin;
  Logger.log(msg); try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}
