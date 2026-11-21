/**
 * Saado POS — the WHOLE backend in this one file (Google Apps Script bound to the "Saado POS" Sheet).
 *
 * How to use:
 *   1. Run setup() once from the editor (safe to run again). It creates every tab, header, default
 *      setting, the 4 default ingredients, the nightly Drive backup and the nightly email-report triggers.
 *   2. Deploy > New deployment > Web app.  Execute as: Me.  Who has access: Anyone.
 *   3. Put the /exec URL in config.js of the app (GitHub).
 *
 * The app talks to doPost() with JSON (Content-Type text/plain to avoid CORS preflight).
 * Every action except "ping", "names" and "login" needs a valid login token (6 hours).
 * The server never trusts prices from the phone: totals are recalculated from the Products tab.
 */

var VERSION = '1.4.0';
var TZ = 'Africa/Mogadishu';          // Somaliland time (UTC+3)
var TOKEN_HOURS = 6;
var MAX_FAILS = 5, LOCK_MINUTES = 5;  // wrong-PIN lockout

var SCHEMA = {
  Settings:   ['key', 'value', 'note'],
  Users:      ['id', 'name', 'role', 'business', 'pinHash', 'salt', 'active', 'lang', 'afterHours', 'perms', 'createdAt', 'pinChanged'],
  Products:   ['id', 'business', 'name', 'barcode', 'category', 'price', 'cost', 'stock', 'lowStock', 'expiry', 'active', 'fav', 'sold', 'updatedAt', 'lowAlerted', 'deleted', 'loose', 'perPack', 'looseTable'],
  Sales:      ['id', 'ts', 'date', 'business', 'userId', 'userName', 'shiftId', 'method', 'orderType', 'customerId', 'customerName', 'subtotal', 'discount', 'total', 'cost', 'tendered', 'tenderCur', 'change', 'status', 'refunded', 'note',
               'payCur', 'usdAmount', 'undoneBy', 'undoneTs', 'undoReason'],
  SaleItems:  ['saleId', 'date', 'business', 'productId', 'name', 'qty', 'price', 'cost', 'lineTotal', 'unit'],
  Shifts:     ['id', 'business', 'userId', 'userName', 'status', 'openTs', 'closeTs', 'date', 'openCash', 'openZaadSH', 'openZaadUSD', 'openEdSH', 'openEdUSD',
               'closeCash', 'closeZaadSH', 'closeZaadUSD', 'closeEdSH', 'closeEdUSD', 'rate',
               'cashSales', 'zaadSales', 'edSales', 'creditSales', 'custPayCash', 'custPayZaad', 'custPayEd', 'expCash', 'expZaad', 'expEd', 'refCash', 'refZaad', 'refEd',
               'expectedCash', 'diffCash', 'expectedZaad', 'diffZaad', 'expectedEd', 'diffEd', 'note',
               'openCashUSD', 'closeCashUSD', 'cashOutSH', 'cashOutUSD', 'eCashSH', 'eCashUSD', 'eZaadSH', 'eZaadUSD', 'eEdSH', 'eEdUSD',
               'totalExpSH', 'totalExpUSD', 'totalCountSH', 'totalCountUSD', 'diffSH', 'diffUSD', 'diffAll'],
  Customers:  ['id', 'business', 'name', 'phone', 'balance', 'note', 'createdAt', 'active'],
  CustLedger: ['id', 'ts', 'date', 'business', 'customerId', 'type', 'amount', 'method', 'ref', 'shiftId', 'userName', 'note'],
  Suppliers:  ['id', 'business', 'name', 'phone', 'balance', 'note', 'createdAt', 'active'],
  SupLedger:  ['id', 'ts', 'date', 'business', 'supplierId', 'type', 'amount', 'paid', 'method', 'items', 'userName', 'note', 'ref'],
  PurchaseOrders: ['id', 'poNo', 'date', 'business', 'supplierId', 'supplierName', 'status', 'items', 'total', 'paid', 'terms', 'notes',
                   'createdTs', 'createdBy', 'sentTs', 'receivedTs', 'receivedBy', 'cancelReason'],
  Expenses:   ['id', 'ts', 'date', 'business', 'category', 'amount', 'method', 'shiftId', 'ref', 'userName', 'note', 'currency', 'usdAmount', 'description', 'status', 'undoneBy', 'undoneTs', 'undoReason'],
  Refunds:    ['id', 'ts', 'date', 'business', 'saleId', 'items', 'amount', 'cost', 'method', 'reason', 'status', 'requestedBy', 'decidedBy', 'decidedTs', 'note', 'shiftId'],
  Ingredients:['id', 'name', 'unit', 'stock', 'lowLevel', 'cost', 'active', 'updatedAt'],
  IngLog:     ['id', 'ts', 'date', 'ingredientId', 'name', 'type', 'qty', 'userName', 'note'],
  StockLog:   ['id', 'ts', 'date', 'business', 'productId', 'name', 'type', 'before', 'after', 'diff', 'userName', 'note'],
  Audit:      ['ts', 'userName', 'action', 'details'],
  CashMoves:  ['id', 'ts', 'date', 'business', 'shiftId', 'amount', 'currency', 'takenBy', 'reason', 'note', 'userName'],
  Recipients: ['id', 'name', 'email', 'userId', 'daily', 'weekly', 'monthly', 'lowStock', 'active', 'createdAt'],
  MonthlySummary: ['month', 'business', 'count', 'sales', 'refunds', 'netSales', 'cost', 'expenses', 'profit', 'cash', 'zaad', 'edahab', 'credit', 'updatedAt']
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
  food_enabled:   ['1', 'Fast Food open (1) or closed (0). Closed hides everything Fast Food; nothing is deleted'],
  lateMin:        ['10', 'Minutes after the shift start that count as late'],
  lowStockEmail:  ['1', 'Low-stock emails on (1) or off (0)'],
  lowStockMode:   ['now', 'Low-stock email: now = at once, daily = one list a day'],
  lowStockTime:   ['08:00', 'Time of the daily low-stock list'],
  emailDailyTime: ['23:30', 'Time of the daily report (before 12:00 = report on yesterday)'],
  weeklyDay:      ['Thu', 'Day the weekly email report is sent'],
  emailWeeklyTime:['23:30', 'Time of the weekly report (before 12:00 = the 7 days up to yesterday)'],
  monthlyWhen:    ['last', 'Monthly report: last = last day of the month, first = 1st of the next month'],
  emailMonthlyTime:['23:30', 'Time of the monthly report'],
  appUrl:         ['https://jaahuursystems.github.io/saado-pos/', 'App link used in emails'],
  dataVersion:    ['1', 'Changes after a reset (do not edit)'],
  archivedUntil:  ['', 'Data before this date is in the Archive (do not edit)'],
  archiveLinks:   ['[]', 'Archive sheets (do not edit)'],
  permsV2:        ['0', 'Internal (do not edit)'],
  emailSent:      ['{}', 'When each email was last sent (do not edit)']
};
var PROTECTED_SETTINGS = { dataVersion: 1, archivedUntil: 1, archiveLinks: 1, permsV2: 1, emailSent: 1 };

var PERMS = ['viewReports', 'viewProfit', 'viewStock', 'changePrices', 'manageProducts', 'discount', 'customers', 'suppliers',
             'undoSales', 'cashOut', 'voidSales', 'deleteProducts', 'deleteCustomers', 'deleteSuppliers', 'viewInsights', 'emailReports',
             'expenses', 'ingredients', 'stockCount', 'approveRefunds', 'manageUsers', 'settings', 'export', 'audit'];
var EMPLOYEE_DEFAULT_PERMS = ['viewStock', 'customers', 'expenses', 'ingredients', 'undoSales', 'cashOut'];
var GONE = { undone: 1, void: 1 };   // sale status that no longer counts
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
var READS = { 'shift.live': 1, 'shift.preview': 1, boot: 1, 'po.list': 1, insights: 1, 'recip.list': 1, 'recip.mine': 1, 'admin.counts': 1, 'admin.archivePreview': 1, report: 1, 'sales.list': 1, 'cust.ledger': 1, 'sup.ledger': 1, 'refund.list': 1, 'users.list': 1, 'audit.list': 1,
              'export': 1, 'shift.list': 1, 'ing.log': 1, 'exp.list': 1, 'stock.log': 1, logout: 1 };

function handle_(req) {
  T_ = {};
  var a = String(req.action || '');
  if (a === 'ping') return { ok: true, version: VERSION, time: nowIso_() };
  if (a === 'names') return { ok: true, users: table_('Users').rows.filter(function (u) { return isOn_(u.active) && bizList_(u).length; })
                                 .map(function (u) { return { id: u.id, name: u.name, business: u.business }; }) };
  if (a === 'login') return withLock_(function () { return login_(req.data || {}); });

  var user = auth_(req.token);
  var fn = ACTIONS[a];
  if (a === 'sync') fn = sync_;
  if (!fn) throw new Error('Unknown action: ' + a);
  if (a === 'sync' && req.data && req.data.dataVersion && String(req.data.dataVersion) !== String(setting_('dataVersion')))
    return { ok: true, reset: true, dataVersion: setting_('dataVersion'), results: [] };   // phone has data from before a reset
  if (READS[a]) return fn(user, req.data || {});
  var res = withLock_(function () { return fn(user, req.data || {}); });
  if (T_._lowAlerts && T_._lowAlerts.length) { try { sendLowStock_(T_._lowAlerts); } catch (e) {} }
  return res;
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

// Rows dated on or after `since`, read from the bottom of the tab only (new rows are always added at the bottom).
// Much faster than reading a whole tab that has months of history. Falls back to the full tab when it is already loaded.
function recent_(name, since) {
  var key = '~' + name + '|' + since;
  if (T_[key]) return T_[key];
  if (T_[name]) return (T_[key] = T_[name].rows.filter(function (r) { return String(r.date) >= since; }));
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run setup() in Apps Script.');
  var headers = SCHEMA[name], di = headers.indexOf('date'), last = sh.getLastRow(), stop = addDaysIso_(since, -3);
  var n = 400, vals = [];
  while (last > 1) {
    var start = Math.max(2, last - n + 1);
    vals = sh.getRange(start, 1, last - start + 1, headers.length).getValues();
    if (start === 2 || String(norm_(vals[0][di])).slice(0, 10) < stop) break;
    n *= 4;
  }
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    var o = {};
    for (var j = 0; j < headers.length; j++) o[headers[j]] = norm_(vals[i][j]);
    if (o[headers[0]] === '' && o[headers[1]] === '') continue;
    if (String(o.date).slice(0, 10) >= since) rows.push(o);
  }
  return (T_[key] = rows);
}

/* ---------- selling loose (pieces) ----------
   A product with "loose" on (Shop only) keeps its stock in PIECES. price and cost stay per packet; lowStock is in packets.
   looseTable is the owner's price list for pieces, e.g. [[1,1000],[2,2000],[3,2500]]. */
function isLoose_(p) { return !!p && p.business === 'shop' && isOn_(p.loose) && num_(p.perPack) > 1; }
function pieces_(p, qty, unit) { return isLoose_(p) ? (unit === 'pc' ? num_(qty) : num_(qty) * num_(p.perPack)) : num_(qty); }
function lowAt_(p) { return isLoose_(p) ? num_(p.lowStock) * num_(p.perPack) : num_(p.lowStock); }
function soldDelta_(p, qty, unit) { return isLoose_(p) ? Math.round(pieces_(p, qty, unit) / num_(p.perPack) * 100) / 100 : num_(qty); }
function stockTxt_(p, n) {
  n = n === undefined ? num_(p.stock) : num_(n);
  if (!isLoose_(p)) return fmt_(n);
  var per = num_(p.perPack), neg = n < 0, a = Math.abs(n), pk = Math.floor(a / per), pc = a % per;
  return (neg ? '−' : '') + (pk ? pk + ' pk' : '') + (pk && pc ? ' + ' : '') + (pc || !pk ? pc + ' pcs' : '');
}
function looseTable_(p) {
  var t = []; try { t = JSON.parse(p.looseTable || '[]'); } catch (e) {}
  return (Array.isArray(t) ? t : []).map(function (r) { return [Math.floor(num_(r[0])), num_(r[1])]; })
    .filter(function (r) { return r[0] > 0 && r[1] > 0 && r[0] < num_(p.perPack); }).sort(function (a, b) { return a[0] - b[0]; });
}
// Price of n pieces: whole packets at the packet price, the rest from the price list (added up from the biggest rows), never more than a packet.
function loosePrice_(p, n) {
  var per = num_(p.perPack), pack = num_(p.price), tab = looseTable_(p);
  var total = Math.floor(n / per) * pack, rest = n % per;
  if (!rest) return total;
  var exact = tab.filter(function (r) { return r[0] === rest; })[0], part = 0;
  if (exact) part = exact[1];
  else {
    var left = rest, desc = tab.slice().reverse();
    while (left > 0) {
      var r = desc.filter(function (x) { return x[0] <= left; })[0];
      if (!r) { part += Math.round(pack / per * left); break; }
      part += r[1]; left -= r[0];
    }
  }
  return total + Math.min(part, pack);
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

// Adding rows never reads the whole tab (that is what made saving slow on a big Sheet).
function appendTab_(name) {
  if (T_[name]) return T_[name];
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run setup() in Apps Script.');
  return { sh: sh, headers: SCHEMA[name], rows: null };
}
function afterInsert_(name, list) {
  if (T_[name]) list.forEach(function (o) { T_[name].rows.push(o); });
  Object.keys(T_).forEach(function (k) {
    if (k.indexOf('~' + name + '|') !== 0) return;
    var since = k.split('|')[1];
    list.forEach(function (o) { if (String(o.date || '').slice(0, 10) >= since) T_[k].push(o); });
  });
}
function insert_(name, o) {
  var t = appendTab_(name);
  var r = t.sh.getLastRow() + 1;
  t.sh.getRange(r, 1, 1, t.headers.length).setValues([rowArr_(t, o)]);
  o._r = r; afterInsert_(name, [o]);
  return o;
}

function insertMany_(name, list) {
  if (!list.length) return;
  var t = appendTab_(name);
  var r = t.sh.getLastRow() + 1;
  t.sh.getRange(r, 1, list.length, t.headers.length).setValues(list.map(function (o) { return rowArr_(t, o); }));
  list.forEach(function (o, i) { o._r = r + i; });
  afterInsert_(name, list);
}

function update_(name, o) {
  if (name === 'Products' && isOn_(o.lowAlerted) && num_(o.stock) > lowAt_(o)) o.lowAlerted = 0;
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
  if (!bizList_(u).length) throw new Error('CLOSED: Fast Food is closed. Ask the owner.');
  checkHours_(u, null, new Date());
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('tok_' + token, u.id + '|' + Date.now(), TOKEN_HOURS * 3600);
  audit_(u, 'login', '');
  var b = boot_(u, {});
  b.token = token;
  b.expires = Date.now() + TOKEN_HOURS * 3600 * 1000;
  return b;
}

function auth_(token) {
  if (!token) throw new Error('AUTH: please log in');
  var cache = CacheService.getScriptCache(), v = cache.get('tok_' + token);
  if (!v) throw new Error('AUTH: session expired, please log in again');
  // A session stays alive while it is used: every 20 minutes of use gives it another full 6 hours (long Fast Food shifts).
  var parts = String(v).split('|'), id = parts[0], at = Number(parts[1] || 0), nowMs = Date.now();
  if (nowMs - at > 20 * 60 * 1000) cache.put('tok_' + token, id + '|' + nowMs, TOKEN_HOURS * 3600);
  var u = find_('Users', id);
  if (!u || !isOn_(u.active)) throw new Error('AUTH: account disabled');
  if (!bizList_(u).length) throw new Error('AUTH: Fast Food is closed');
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
function foodOn_() { return setting_('food_enabled') !== '0'; }
function bizList_(u) {
  var l = (isOwner_(u) || u.business === 'both') ? BIZ.slice() : [u.business];
  return foodOn_() ? l : l.filter(function (b) { return b !== 'food'; });
}
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
  var products = table_('Products').rows.filter(function (p) { return biz.indexOf(p.business) >= 0 && !isOn_(p.deleted); }).map(function (p) {
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
    var d0 = dateOf_(clientTs_(d.ts)), t2 = addDaysIso_(today_(), -2);
    var dup = recent_('Sales', addDaysIso_(d0 < t2 ? d0 : t2, -1)).filter(function (x) { return x.id === id; })[0];
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
      var unit = it.unit === 'pc' && isLoose_(p) ? 'pc' : '';
      var price = num_(p.price), c = num_(p.cost), line = price * q;
      if (unit === 'pc') { q = Math.floor(q); line = loosePrice_(p, q); price = Math.round(line / q * 100) / 100; c = Math.round(num_(p.cost) / num_(p.perPack) * 100) / 100; }
      lines.push({ saleId: id, date: dateOf_(ts), business: biz, productId: p.id, name: p.name, qty: q, price: price, cost: c, lineTotal: line, unit: unit });
      subtotal += line; cost += c * q;
      if (biz === 'shop') p.stock = num_(p.stock) - pieces_(p, q, unit);
      p.sold = Math.round((num_(p.sold) + soldDelta_(p, q, unit)) * 100) / 100; if (touched.indexOf(p) < 0) touched.push(p);
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
    var tendered = num_(d.tendered), cur = d.tenderCur === 'USD' ? 'USD' : 'SH', change = 0, payCur = 'SH', usdAmount = 0;
    if (method === 'cash' && tendered > 0) {
      change = (cur === 'USD' ? tendered * rate_() : tendered) - total;
      if (change < 0) throw new Error('Cash given is less than the total');
      if (cur === 'USD') { payCur = 'USD'; usdAmount = tendered; }       // dollars go in the drawer, change comes out in SH
    }
    if ((method === 'zaad' || method === 'edahab') && d.payCur === 'USD') { payCur = 'USD'; usdAmount = Math.ceil(total / rate_() * 100) / 100; }
    var orderType = biz === 'food' ? str_(d.orderType || 'Take away', 40) : '';
    var sale = { id: id, ts: ts, date: dateOf_(ts), business: biz, userId: u.id, userName: u.name, shiftId: shift ? shift.id : '',
                 method: method, orderType: orderType, customerId: cust ? cust.id : '', customerName: cust ? cust.name : '',
                 subtotal: subtotal, discount: discount, total: total, cost: cost, tendered: tendered, tenderCur: cur, change: change,
                 status: 'ok', refunded: 0, note: str_(d.note, 200), payCur: payCur, usdAmount: usdAmount };
    insert_('Sales', sale);
    insertMany_('SaleItems', lines);
    var now = nowIso_();
    touched.forEach(function (p) {
      p.updatedAt = now;
      if (p.business === 'shop' && num_(p.lowStock) > 0 && num_(p.stock) <= lowAt_(p) && !isOn_(p.lowAlerted)) {
        p.lowAlerted = 1; (T_._lowAlerts = T_._lowAlerts || []).push({ name: p.name, stock: stockTxt_(p), lowStock: num_(p.lowStock) + (isLoose_(p) ? ' pk' : '') });
      }
      update_('Products', p);
    });
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
    var sales = recent_('Sales', from).filter(function (s) {
      return biz.indexOf(s.business) >= 0 && s.date >= from && s.date <= to && (!mine || s.userId === u.id);
    });
    var ids = {}; sales.forEach(function (s) { ids[s.id] = []; });
    recent_('SaleItems', from).forEach(function (i) { if (ids[i.saleId]) ids[i.saleId].push(clean_(i)); });
    return { ok: true, sales: sales.slice(-300).reverse().map(function (s) { var c = clean_(s); c.items = ids[s.id]; if (!can_(u, 'viewProfit')) delete c.cost; return c; }) };
  },

  /* ---------- shifts ---------- */
  'shift.open': function (u, d) {
    var biz = d.business; needBiz_(u, biz); checkHours_(u, biz, new Date());
    var id = str_(d.id, 60) || uid_('SH');
    var ex = find_('Shifts', id); if (ex) return { ok: true, dup: true, shift: clean_(ex) };
    if (openShift_(u, biz)) throw new Error('You already have an open shift here');
    var s = { id: id, business: biz, userId: u.id, userName: u.name, status: 'open', openTs: nowIso_(), date: today_(),
              openCash: num_(d.openCash), openCashUSD: num_(d.openCashUSD), openZaadSH: num_(d.openZaadSH), openZaadUSD: num_(d.openZaadUSD), openEdSH: num_(d.openEdSH), openEdUSD: num_(d.openEdUSD),
              rate: rate_(), note: str_(d.note) };
    insert_('Shifts', s); audit_(u, 'shift.open', { id: id, biz: biz, cash: s.openCash });
    return { ok: true, shift: clean_(s) };
  },

  'shift.preview': function (u, d) {
    var s = find_('Shifts', d.id); if (!s) throw new Error('Shift not found');
    if (s.userId !== u.id && !isOwner_(u)) throw new Error('NOPERM: not your shift');
    var moves = table_('CashMoves').rows.filter(function (m) { return m.shiftId === s.id; }).map(clean_);
    return { ok: true, totals: shiftTotals_(s), moves: moves, shift: clean_(s) };
  },

  // Everything the Shift screen needs in ONE quick read: totals, cash taken out, and the sales of this shift.
  'shift.live': function (u, d) {
    var s = find_('Shifts', d.id); if (!s) throw new Error('Shift not found');
    if (s.userId !== u.id && !isOwner_(u)) throw new Error('NOPERM: not your shift');
    var since = String(s.date || dateOf_(s.openTs)).slice(0, 10);
    var moves = recent_('CashMoves', since).filter(function (m) { return m.shiftId === s.id; }).map(clean_);
    var sales = recent_('Sales', since).filter(function (x) { return x.shiftId === s.id; });
    var ids = {}; sales.forEach(function (x) { ids[x.id] = []; });
    recent_('SaleItems', since).forEach(function (i) { if (ids[i.saleId]) ids[i.saleId].push({ productId: i.productId, name: i.name, qty: i.qty, unit: i.unit }); });
    var list = sales.slice(-60).reverse().map(function (x) {
      return { id: x.id, ts: x.ts, method: x.method, total: x.total, status: x.status, customerName: x.customerName, userId: x.userId, items: ids[x.id] };
    });
    return { ok: true, totals: shiftTotals_(s), moves: moves, shift: clean_(s), sales: list };
  },

  'shift.close': function (u, d) {
    var s = find_('Shifts', d.id); if (!s) throw new Error('Shift not found');
    if (s.status !== 'open') return { ok: true, dup: true, shift: clean_(s) };
    if (s.userId !== u.id && !isOwner_(u)) throw new Error('NOPERM: not your shift');
    var rate = num_(s.rate) || rate_();
    var t = shiftTotals_(s);
    s.closeCash = num_(d.closeCash); s.closeCashUSD = num_(d.closeCashUSD); s.closeZaadSH = num_(d.closeZaadSH); s.closeZaadUSD = num_(d.closeZaadUSD);
    s.closeEdSH = num_(d.closeEdSH); s.closeEdUSD = num_(d.closeEdUSD);
    for (var k in t) s[k] = t[k];
    s.diffCash = s.closeCash + s.closeCashUSD * rate - t.expectedCash;
    s.diffZaad = s.closeZaadSH + s.closeZaadUSD * rate - t.expectedZaad;
    s.diffEd = s.closeEdSH + s.closeEdUSD * rate - t.expectedEd;
    s.totalCountSH = s.closeCash + s.closeZaadSH + s.closeEdSH;
    s.totalCountUSD = Math.round((s.closeCashUSD + s.closeZaadUSD + s.closeEdUSD) * 100) / 100;
    s.diffSH = s.totalCountSH - t.totalExpSH;
    s.diffUSD = Math.round((s.totalCountUSD - t.totalExpUSD) * 100) / 100;
    s.diffAll = s.diffSH + s.diffUSD * rate;
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
        var add = pieces_(p, q, 'pk');   // bought in packets
        var before = num_(p.stock); p.stock = before + add; if (c > 0) p.cost = c; p.updatedAt = now; update_('Products', p);
        insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: p.business, productId: p.id, name: p.name, type: 'purchase',
                              before: before, after: p.stock, diff: add, userName: u.name, note: s.name });
        desc.push({ kind: 'p', id: p.id, name: p.name, qty: q, cost: c });
      }
      total += q * c;
    });
    if (num_(d.total) > 0 && !items.length) total = num_(d.total);
    var paid = Math.min(Math.max(0, num_(d.paid)), total);
    var m = PAY_METHODS.indexOf(d.method) >= 0 ? d.method : 'cash';
    var id = d.id || uid_('PU');
    insert_('SupLedger', { id: id, ts: now, date: today_(), business: s.business, supplierId: s.id, type: 'purchase', amount: total, paid: paid,
                           method: m, items: desc, userName: u.name, note: str_(d.note), ref: '' });
    supBalance_(s);
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
    insert_('SupLedger', { id: id, ts: nowIso_(), date: today_(), business: s.business, supplierId: s.id, type: 'payment', amount: amt, paid: amt,
                           method: m, items: '', userName: u.name, note: str_(d.note), ref: '' });
    supBalance_(s);
    addExpense_(u, s.business, supCat_(s), amt, m, id, 'Paid to ' + s.name);
    audit_(u, 'sup.pay', { supplier: s.name, amount: amt });
    return { ok: true, supplier: clean_(s) };
  },

  'sup.ledger': function (u, d) {
    need_(u, 'suppliers');
    var s = find_('Suppliers', d.supplierId); if (!s) throw new Error('Supplier not found');
    return { ok: true, supplier: clean_(s), ledger: table_('SupLedger').rows.filter(function (l) { return l.supplierId === s.id; }).reverse().map(clean_) };
  },

  /* ---------- purchase orders (like Adam Nokia): DRAFT -> SENT -> RECEIVED, or CANCELLED ----------
     Stock goes up only when the order is RECEIVED. Payments can be made any time (now, part, or later on credit). */
  'po.list': function (u, d) {
    need_(u, 'suppliers');
    var biz = bizFilter_(u, d.business);
    return { ok: true, orders: table_('PurchaseOrders').rows.filter(function (o) { return biz.indexOf(o.business) >= 0 && (!d.supplierId || o.supplierId === d.supplierId); })
                                 .slice(-300).reverse().map(clean_) };
  },

  'po.save': function (u, d) {
    need_(u, 'suppliers');
    var po = d.id ? find_('PurchaseOrders', d.id) : null;
    if (po && d.isNew) return { ok: true, dup: true, order: clean_(po) };          // offline retry
    if (po && ['DRAFT', 'SENT'].indexOf(po.status) < 0) throw new Error('Only draft or sent orders can be changed');
    var s = find_('Suppliers', d.supplierId || (po && po.supplierId)); if (!s) throw new Error('Supplier not found');
    needBiz_(u, s.business);
    var items = [], total = 0;
    (d.items || []).forEach(function (it) {
      var q = num_(it.qty), c = Math.max(0, num_(it.cost)); if (q <= 0) return;
      var ref = it.kind === 'i' ? find_('Ingredients', it.refId) : find_('Products', it.refId);
      if (!ref || (it.kind !== 'i' && ref.business !== s.business)) throw new Error('Item not found: ' + (it.name || ''));
      var name = it.kind === 'i' ? ref.name + ' (' + ref.unit + ')' : ref.name;
      items.push({ kind: it.kind === 'i' ? 'i' : 'p', refId: ref.id, name: name, qty: q, cost: c });
      total += q * c;
    });
    if (!items.length) throw new Error('Add at least one item');
    var now = nowIso_();
    if (!po) {
      var prefix = s.business === 'food' ? 'FF-PO-' : 'SH-PO-';
      var n = table_('PurchaseOrders').rows.filter(function (o) { return o.business === s.business; }).length + 1;
      po = { id: d.id || uid_('PO'), poNo: prefix + ('000' + n).slice(-4), date: today_(), business: s.business, supplierId: s.id, supplierName: s.name, status: 'DRAFT',
             items: items, total: total, paid: 0, terms: str_(d.terms, 80), notes: str_(d.notes, 300), createdTs: now, createdBy: u.name, sentTs: '', receivedTs: '', receivedBy: '', cancelReason: '' };
      insert_('PurchaseOrders', po); audit_(u, 'po.create', { po: po.poNo, supplier: s.name, total: total });
    } else {
      if (num_(po.paid) > total) throw new Error('Paid amount is more than the new total');
      po.supplierId = s.id; po.supplierName = s.name; po.items = items; po.total = total; po.terms = str_(d.terms, 80); po.notes = str_(d.notes, 300);
      update_('PurchaseOrders', po); audit_(u, 'po.edit', { po: po.poNo, total: total });
    }
    if (d.markSent && po.status === 'DRAFT') { po.status = 'SENT'; po.sentTs = now; update_('PurchaseOrders', po); }
    if (d.payNow > 0) payPo_(u, po, s, num_(d.payNow), d.payMethod, d.id ? d.id + '-PAY' : '');
    if (d.receiveNow) receivePo_(u, po, s, null);
    return { ok: true, order: clean_(po), supplier: clean_(s) };
  },

  'po.status': function (u, d) {
    need_(u, 'suppliers');
    var po = find_('PurchaseOrders', d.id); if (!po) throw new Error('Order not found');
    needBiz_(u, po.business);
    var to = d.status;
    if (to === po.status) return { ok: true, dup: true, order: clean_(po) };
    var flow = { DRAFT: ['SENT', 'CANCELLED'], SENT: ['CANCELLED', 'DRAFT'] };
    if ((flow[po.status] || []).indexOf(to) < 0) throw new Error('This order cannot be changed now');
    if (to === 'CANCELLED') {
      if (num_(po.paid) > 0) throw new Error('This order has payments. It cannot be cancelled.');
      po.cancelReason = str_(d.reason, 200);
    }
    if (to === 'SENT') po.sentTs = nowIso_();
    po.status = to; update_('PurchaseOrders', po); audit_(u, 'po.' + to.toLowerCase(), po.poNo);
    return { ok: true, order: clean_(po) };
  },

  'po.receive': function (u, d) {
    need_(u, 'suppliers');
    var po = find_('PurchaseOrders', d.id); if (!po) throw new Error('Order not found');
    if (po.status === 'RECEIVED') return { ok: true, dup: true, order: clean_(po) };
    needBiz_(u, po.business);
    var s = find_('Suppliers', po.supplierId);
    receivePo_(u, po, s, d.lines || null);
    return { ok: true, order: clean_(po), supplier: s ? clean_(s) : null };
  },

  'po.pay': function (u, d) {
    need_(u, 'suppliers');
    if (d.payId && exists_('SupLedger', d.payId)) return { ok: true, dup: true };
    var po = find_('PurchaseOrders', d.id); if (!po) throw new Error('Order not found');
    needBiz_(u, po.business);
    if (po.status === 'CANCELLED') throw new Error('This order is cancelled');
    var s = find_('Suppliers', po.supplierId);
    payPo_(u, po, s, num_(d.amount), d.method, d.payId);
    return { ok: true, order: clean_(po), supplier: s ? clean_(s) : null };
  },

  /* ---------- undo / void a sale ----------
     Staff: only sales in their own OPEN shift (permission undoSales). Owners / voidSales: any sale, any time.
     The sale stays in the Sheet marked "undone"/"void" (with who, when, why) so nothing disappears silently. */
  'sale.undo': function (u, d) {
    var s = find_('Sales', d.id); if (!s) throw new Error('Sale not found (it may still be syncing)');
    if (GONE[s.status]) return { ok: true, dup: true, sale: clean_(s) };
    needBiz_(u, s.business);
    var reason = str_(d.reason, 120); if (!reason) throw new Error('Choose a reason');
    var sh = s.shiftId ? find_('Shifts', s.shiftId) : null;
    var own = s.userId === u.id && sh && sh.status === 'open';
    if (!can_(u, 'voidSales')) {
      if (!own) throw new Error('NOPERM: you can only undo sales in your own open shift');
      need_(u, 'undoSales');
    }
    if (num_(s.refunded) > 0 || table_('Refunds').rows.some(function (r) { return r.saleId === s.id && r.status !== 'rejected'; }))
      throw new Error('This sale has a refund. It cannot be undone.');
    var now = nowIso_(), touched = [];
    table_('SaleItems').rows.filter(function (i) { return i.saleId === s.id; }).forEach(function (i) {
      var p = find_('Products', i.productId); if (!p) return;
      var back = pieces_(p, i.qty, i.unit);
      p.sold = Math.max(0, Math.round((num_(p.sold) - soldDelta_(p, i.qty, i.unit)) * 100) / 100);
      if (p.business === 'shop') {
        var before = num_(p.stock); p.stock = before + back;
        insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: p.business, productId: p.id, name: p.name, type: 'undo', before: before, after: p.stock, diff: back, userName: u.name, note: s.id });
      }
      p.updatedAt = now; update_('Products', p); if (touched.indexOf(p) < 0) touched.push(p);
    });
    var cust = null;
    if (s.method === 'credit' && s.customerId) {
      cust = find_('Customers', s.customerId);
      if (cust) {
        cust.balance = num_(cust.balance) - num_(s.total); update_('Customers', cust);
        insert_('CustLedger', { id: uid_('CL'), ts: now, date: today_(), business: s.business, customerId: cust.id, type: 'void', amount: num_(s.total), method: 'credit', ref: s.id, shiftId: s.shiftId, userName: u.name, note: reason });
      }
    }
    s.status = own ? 'undone' : 'void'; s.undoneBy = u.name; s.undoneTs = now; s.undoReason = reason; update_('Sales', s);
    audit_(u, own ? 'sale.undo' : 'sale.void', { sale: s.id, total: s.total, method: s.method, by: s.userName, reason: reason });
    return { ok: true, sale: clean_(s), stock: touched.map(function (p) { return { id: p.id, stock: p.stock, sold: p.sold }; }), customer: cust ? clean_(cust) : null };
  },

  /* ---------- cash taken out of the drawer ---------- */
  'cash.out': function (u, d) {
    need_(u, 'cashOut');
    if (exists_('CashMoves', d.id)) return { ok: true, dup: true };
    var biz = d.business; needBiz_(u, biz);
    var amt = num_(d.amount); if (!(amt > 0)) throw new Error('Enter an amount');
    var who = str_(d.takenBy, 40); if (!who) throw new Error('Who took the money?');
    var shift = openShift_(u, biz) || anyOpenShift_(biz);
    var m = { id: d.id || uid_('CO'), ts: nowIso_(), date: today_(), business: biz, shiftId: shift ? shift.id : '', amount: amt, currency: d.currency === 'USD' ? 'USD' : 'SH',
              takenBy: who, reason: str_(d.reason, 60), note: str_(d.note, 200), userName: u.name };
    insert_('CashMoves', m); audit_(u, 'cash.out', { amount: amt, currency: m.currency, takenBy: who, reason: m.reason });
    return { ok: true, move: clean_(m) };
  },

  /* ---------- delete (owner, or users with the delete permissions) ----------
     Anything with history is hidden instead of erased, so old sales and reports stay correct. */
  'prod.delete': function (u, d) {
    need_(u, 'deleteProducts');
    var p = find_('Products', d.id); if (!p) throw new Error('Product not found');
    needBiz_(u, p.business);
    var used = num_(p.sold) > 0 || table_('SaleItems').rows.some(function (i) { return i.productId === p.id; }) ||
               table_('PurchaseOrders').rows.some(function (o) { return String(o.items).indexOf(p.id) >= 0; });
    audit_(u, 'prod.delete', { name: p.name, kept: used });
    if (used) { p.active = 0; p.deleted = 1; p.lowAlerted = 0; p.updatedAt = nowIso_(); update_('Products', p); return { ok: true, removed: 'hidden' }; }
    deleteRow_('Products', p); return { ok: true, removed: 'deleted' };
  },
  'cust.delete': function (u, d) {
    need_(u, 'deleteCustomers');
    var c = find_('Customers', d.id); if (!c) throw new Error('Customer not found');
    needBiz_(u, c.business);
    if (num_(c.balance) !== 0) throw new Error('This customer still has a balance. Settle it first.');
    var used = table_('CustLedger').rows.some(function (l) { return l.customerId === c.id; });
    audit_(u, 'cust.delete', { name: c.name, kept: used });
    if (used) { c.active = 0; update_('Customers', c); return { ok: true, removed: 'hidden' }; }
    deleteRow_('Customers', c); return { ok: true, removed: 'deleted' };
  },
  'sup.delete': function (u, d) {
    need_(u, 'deleteSuppliers');
    var s = find_('Suppliers', d.id); if (!s) throw new Error('Supplier not found');
    needBiz_(u, s.business);
    if (Math.abs(supBalance_(s)) > 0) throw new Error('This supplier still has a balance. Settle it first.');
    if (table_('PurchaseOrders').rows.some(function (o) { return o.supplierId === s.id && (o.status === 'DRAFT' || o.status === 'SENT'); })) throw new Error('This supplier has open orders.');
    var used = table_('SupLedger').rows.some(function (l) { return l.supplierId === s.id; }) || table_('PurchaseOrders').rows.some(function (o) { return o.supplierId === s.id; });
    audit_(u, 'sup.delete', { name: s.name, kept: used });
    if (used) { s.active = 0; update_('Suppliers', s); return { ok: true, removed: 'hidden' }; }
    deleteRow_('Suppliers', s); return { ok: true, removed: 'deleted' };
  },

  /* ---------- insights: this month vs last month, days, hours, attendance ---------- */
  insights: function (u, d) { need_(u, 'viewInsights'); return insights_(u, d); },

  /* ---------- email report recipients ---------- */
  'recip.list': function (u) {
    need_(u, 'settings');
    return { ok: true, recipients: table_('Recipients').rows.filter(function (r) { return isOn_(r.active); }).map(clean_),
             users: table_('Users').rows.filter(function (x) { return isOn_(x.active); }).map(function (x) { return { id: x.id, name: x.name }; }) };
  },
  'recip.mine': function (u) { return { ok: true, recipients: table_('Recipients').rows.filter(function (r) { return r.userId === u.id && isOn_(r.active); }).map(clean_) }; },
  'recip.save': function (u, d) {
    var r = d.id ? find_('Recipients', d.id) : null;
    var admin = can_(u, 'settings');
    if (!admin) {   // a person may only change how often THEY get reports
      need_(u, 'emailReports');
      if (!r || r.userId !== u.id) throw new Error('NOPERM: you can only change your own email reports');
    }
    var email = str_(d.email !== undefined ? d.email : r && r.email, 120).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address');
    var f = function (k) { return d[k] !== undefined ? (isOn_(d[k]) ? 1 : 0) : (r ? num_(r[k]) : 0); };
    if (!r) {
      if (!admin) throw new Error('NOPERM');
      r = { id: uid_('RC'), name: str_(d.name, 60), email: email, userId: str_(d.userId, 40), daily: f('daily'), weekly: f('weekly'), monthly: f('monthly'), lowStock: f('lowStock'), active: 1, createdAt: nowIso_() };
      insert_('Recipients', r);
    } else {
      if (admin) { r.name = str_(d.name !== undefined ? d.name : r.name, 60); r.email = email; r.userId = str_(d.userId !== undefined ? d.userId : r.userId, 40); r.lowStock = f('lowStock'); }
      r.daily = f('daily'); r.weekly = f('weekly'); r.monthly = f('monthly');
      update_('Recipients', r);
    }
    audit_(u, 'recip.save', { email: r.email, daily: r.daily, weekly: r.weekly, monthly: r.monthly });
    return { ok: true, recipient: clean_(r) };
  },
  'recip.delete': function (u, d) {
    need_(u, 'settings');
    var r = find_('Recipients', d.id); if (!r) throw new Error('Not found');
    r.active = 0; update_('Recipients', r); audit_(u, 'recip.delete', r.email);
    return { ok: true };
  },
  'recip.test': function (u, d) {
    need_(u, 'settings');
    var r = find_('Recipients', d.id); if (!r) throw new Error('Not found');
    sendReport_('daily', [r], true);
    return { ok: true };
  },

  /* ---------- owner tools: data size, reset, archive ---------- */
  'admin.counts': function (u) { needOwner_(u); return adminCounts_(); },
  'admin.reset': function (u, d) { needOwner_(u); return reset_(u, d); },
  'admin.archivePreview': function (u, d) { needOwner_(u); return archive_(u, d.cutoff, true); },
  'admin.archive': function (u, d) { needOwner_(u); return archive_(u, d.cutoff, false); },

  /* ---------- expenses ---------- */
  // Expenses can be paid in shillings or dollars. "amount" is always kept in SH (dollars × rate) so reports add up;
  // the dollars are kept in usdAmount and come out of the dollar drawer.
  'exp.create': function (u, d) {
    need_(u, 'expenses');
    if (exists_('Expenses', d.id)) return { ok: true, dup: true };
    needBiz_(u, d.business);
    var usd = d.currency === 'USD', amt = num_(d.amount); if (amt <= 0) throw new Error('Enter an amount');
    var cat = str_(d.category, 40) || 'Other', desc = str_(d.description, 200);
    if (cat === 'Other' && !desc) throw new Error('Write what the money was for');
    var shAmt = usd ? Math.round(amt * rate_()) : amt;
    var e = addExpense_(u, d.business, cat, shAmt, d.method, '', str_(d.note), d.id,
                        { currency: usd ? 'USD' : 'SH', usdAmount: usd ? Math.round(amt * 100) / 100 : '', description: desc, status: 'done' });
    return { ok: true, expense: clean_(e) };
  },

  'exp.list': function (u, d) {
    need_(u, 'expenses');
    var biz = bizFilter_(u, d.business), from = d.from || today_(), to = d.to || today_();
    var list = recent_('Expenses', from).filter(function (e) { return biz.indexOf(e.business) >= 0 && e.date >= from && e.date <= to && (can_(u, 'viewReports') || e.userName === u.name); });
    return { ok: true, expenses: list.reverse().map(clean_), today: today_() };
  },

  // Undo an expense: only on the same day it was written, by the person who wrote it or an owner. The row stays, marked "undone".
  'exp.undo': function (u, d) {
    need_(u, 'expenses');
    var e = find_('Expenses', d.id); if (!e) throw new Error('Expense not found (it may still be syncing)');
    if (e.status === 'undone') return { ok: true, dup: true };
    if (e.userName !== u.name && !isOwner_(u)) throw new Error('NOPERM: only the person who wrote it or the owner can undo it');
    if (e.date !== today_()) throw new Error('Expenses can only be undone on the same day');
    if (e.ref) throw new Error('This came from a purchase order. Change it there.');
    var reason = str_(d.reason, 120); if (!reason) throw new Error('Choose a reason');
    e.status = 'undone'; e.undoneBy = u.name; e.undoneTs = nowIso_(); e.undoReason = reason;
    update_('Expenses', e);
    audit_(u, 'exp.undo', { cat: e.category, amount: e.amount, reason: reason });
    return { ok: true, expense: clean_(e) };
  },

  /* ---------- refunds ---------- */
  'refund.request': function (u, d) {
    if (exists_('Refunds', d.id)) return { ok: true, dup: true };
    var sale = find_('Sales', d.saleId); if (!sale) throw new Error('Sale not found (it may still be syncing)');
    if (GONE[sale.status]) throw new Error('This sale was undone');
    needBiz_(u, sale.business);
    var reason = str_(d.reason, 200); if (!reason) throw new Error('Write a reason');
    var items = table_('SaleItems').rows.filter(function (i) { return i.saleId === sale.id; });
    var already = {};
    table_('Refunds').rows.forEach(function (r) {
      if (r.saleId !== sale.id || r.status === 'rejected') return;
      JSON.parse(r.items || '[]').forEach(function (x) { var k = x.productId + '|' + (x.unit || ''); already[k] = (already[k] || 0) + num_(x.qty); });
    });
    var key = function (x) { return x.productId + '|' + (x.unit === 'pc' ? 'pc' : ''); };   // a packet line and a pieces line of the same item are separate
    var want = d.items && d.items.length ? d.items : items.map(function (i) { return { productId: i.productId, unit: i.unit, qty: num_(i.qty) - (already[key(i)] || 0) }; });
    var list = [], lineSum = 0, cost = 0;
    want.forEach(function (w) {
      var q = num_(w.qty); if (q <= 0) return;
      var line = items.filter(function (i) { return key(i) === key(w); })[0];
      if (!line) throw new Error('Item not in this sale');
      if (q > num_(line.qty) - (already[key(line)] || 0)) throw new Error('Too many returned for ' + line.name);
      list.push({ productId: line.productId, name: line.name, qty: q, price: num_(line.price), unit: line.unit === 'pc' ? 'pc' : '' });
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
      var back = pieces_(p, x.qty, x.unit);
      var before = num_(p.stock); p.stock = before + back; p.sold = Math.max(0, Math.round((num_(p.sold) - soldDelta_(p, x.qty, x.unit)) * 100) / 100); p.updatedAt = now; update_('Products', p);
      insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: p.business, productId: p.id, name: p.name, type: 'refund', before: before, after: p.stock, diff: back, userName: u.name, note: r.id });
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
            expiry: str_(d.expiry, 10), active: 1, fav: isOn_(d.fav) ? 1 : 0, sold: 0, updatedAt: now, loose: '', perPack: '', looseTable: '' };
      setLoose_(p, d);
      insert_('Products', p);
      if (biz === 'shop' && num_(p.stock)) insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: biz, productId: p.id, name: p.name, type: 'new', before: 0, after: p.stock, diff: p.stock, userName: u.name, note: '' });
      audit_(u, 'prod.add', { name: name, price: p.price });
    } else {
      var lz = { loose: p.loose, perPack: p.perPack, looseTable: p.looseTable }; if (d.loose !== undefined) setLoose_(lz, Object.assign({ business: biz }, d));
      var looseChange = String(lz.loose) !== String(p.loose) || String(lz.perPack) !== String(p.perPack);
      var priceChange = num_(d.price) !== num_(p.price) || (d.cost !== undefined && num_(d.cost) !== num_(p.cost)) || String(lz.looseTable) !== String(p.looseTable);
      if (looseChange) need_(u, 'manageProducts');
      if (priceChange) need_(u, 'changePrices');
      if (!priceChange && !can_(u, 'manageProducts') && !can_(u, 'changePrices')) need_(u, 'manageProducts');
      var log = { name: p.name };
      if (priceChange) { log.oldPrice = p.price; log.newPrice = num_(d.price); }
      p.name = name; p.barcode = barcode; p.price = num_(d.price);
      if (d.cost !== undefined) p.cost = num_(d.cost);
      p.loose = lz.loose; p.perPack = lz.perPack; p.looseTable = lz.looseTable;
      if (looseChange) log.loose = isOn_(p.loose) ? 'on (' + p.perPack + ' pcs)' : 'off';
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
      if (!(k in DEFAULT_SETTINGS) || PROTECTED_SETTINGS[k]) return;
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
    var name = { sales: 'Sales', items: 'SaleItems', expenses: 'Expenses', shifts: 'Shifts', customers: 'Customers', products: 'Products', custledger: 'CustLedger', supledger: 'SupLedger', refunds: 'Refunds', orders: 'PurchaseOrders' }[d.type];
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

// What we owe a supplier = goods received - payments. Negative = we paid a deposit before delivery.
function supBalance_(s) {
  var bal = 0;
  table_('SupLedger').rows.forEach(function (l) {
    if (l.supplierId !== s.id) return;
    if (l.type === 'purchase') bal += num_(l.amount) - num_(l.paid);
    else if (l.type === 'receipt') bal += num_(l.amount);
    else if (l.type === 'payment') bal -= num_(l.amount);
    else if (l.type === 'opening' || l.type === 'adjust') bal += num_(l.amount);
  });
  s.balance = bal; update_('Suppliers', s);
  return bal;
}

function payPo_(u, po, s, amount, method, payId) {
  var left = num_(po.total) - num_(po.paid);
  if (!(amount > 0)) throw new Error('Enter an amount');
  if (left <= 0) throw new Error('This order is already fully paid');
  amount = Math.min(amount, left);
  var m = PAY_METHODS.indexOf(method) >= 0 ? method : 'cash', id = payId || uid_('SPY');
  insert_('SupLedger', { id: id, ts: nowIso_(), date: today_(), business: po.business, supplierId: po.supplierId, type: 'payment', amount: amount, paid: amount,
                         method: m, items: '', userName: u.name, note: po.poNo, ref: po.id });
  po.paid = num_(po.paid) + amount; update_('PurchaseOrders', po);
  addExpense_(u, po.business, s ? supCat_(s) : 'Supplier purchases', amount, m, id, 'Paid to ' + po.supplierName + ' (' + po.poNo + ')');
  if (s) supBalance_(s);
  audit_(u, 'po.pay', { po: po.poNo, amount: amount, method: m });
}

function receivePo_(u, po, s, lines) {
  if (['DRAFT', 'SENT'].indexOf(po.status) < 0) throw new Error('Only open orders can be received');
  var items = typeof po.items === 'string' ? JSON.parse(po.items || '[]') : po.items, now = nowIso_(), total = 0;
  items.forEach(function (it, i) {
    var l = lines && lines[i] ? lines[i] : null;
    if (l) { it.qty = Math.max(0, num_(l.qty)); it.cost = Math.max(0, num_(l.cost)); }
    total += num_(it.qty) * num_(it.cost);
    if (!(num_(it.qty) > 0)) return;
    if (it.kind === 'i') {
      var g = find_('Ingredients', it.refId); if (!g) return;
      g.stock = num_(g.stock) + num_(it.qty); if (num_(it.cost) > 0) g.cost = num_(it.cost); g.updatedAt = now; update_('Ingredients', g);
      insert_('IngLog', { id: uid_('IL'), ts: now, date: today_(), ingredientId: g.id, name: g.name, type: 'purchase', qty: num_(it.qty), userName: u.name, note: po.poNo });
    } else {
      var p = find_('Products', it.refId); if (!p) return;
      var add = pieces_(p, it.qty, 'pk');   // ordered in packets
      var before = num_(p.stock); if (p.business === 'shop') p.stock = before + add;
      if (num_(it.cost) > 0) p.cost = num_(it.cost); p.updatedAt = now; update_('Products', p);
      if (p.business === 'shop') insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: p.business, productId: p.id, name: p.name, type: 'purchase',
                                   before: before, after: p.stock, diff: add, userName: u.name, note: po.poNo });
    }
  });
  if (num_(po.paid) > total) throw new Error('Paid amount is more than the received total');
  po.items = items; po.total = total; po.status = 'RECEIVED'; po.receivedTs = now; po.receivedBy = u.name; update_('PurchaseOrders', po);
  insert_('SupLedger', { id: uid_('SR'), ts: now, date: today_(), business: po.business, supplierId: po.supplierId, type: 'receipt', amount: total, paid: 0,
                         method: '', items: items, userName: u.name, note: po.poNo, ref: po.id });
  if (s) supBalance_(s);
  audit_(u, 'po.receive', { po: po.poNo, total: total });
}

// Reads the "sell loose" fields sent by the product form into product p.
function setLoose_(p, d) {
  var on = isOn_(d.loose) && (d.business || p.business) === 'shop';
  if (!on) { p.loose = ''; return p; }
  var per = Math.floor(num_(d.perPack)); if (per < 2 || per > 1000) throw new Error('Pieces in one packet must be 2 or more');
  var tab = (Array.isArray(d.looseTable) ? d.looseTable : []).map(function (r) { return [Math.floor(num_(r[0])), Math.round(num_(r[1]))]; })
    .filter(function (r) { return r[0] > 0 && r[0] < per && r[1] > 0; });
  var seen = {}; tab = tab.filter(function (r) { if (seen[r[0]]) return false; seen[r[0]] = 1; return true; }).sort(function (a, b) { return a[0] - b[0]; });
  p.loose = 1; p.perPack = per; p.looseTable = JSON.stringify(tab);
  return p;
}

function addExpense_(u, biz, cat, amt, method, ref, note, id, more) {
  var shift = openShift_(u, biz);
  var e = { id: id || uid_('EX'), ts: nowIso_(), date: today_(), business: biz, category: cat, amount: num_(amt),
            method: PAY_METHODS.indexOf(method) >= 0 ? method : 'cash', shiftId: shift ? shift.id : '', ref: ref || '', userName: u.name, note: note || '',
            currency: 'SH', usdAmount: '', description: '', status: 'done' };
  if (more) Object.keys(more).forEach(function (k) { e[k] = more[k]; });
  insert_('Expenses', e);
  audit_(u, 'expense', { cat: cat, amount: e.amount, method: e.method });
  return e;
}

// Money a sale brought in, per account and currency (works for old sales too).
function saleMoney_(x) {
  var cur = x.payCur || (x.method === 'cash' && x.tenderCur === 'USD' && num_(x.tendered) > 0 ? 'USD' : 'SH');
  var usd = num_(x.usdAmount) || (cur === 'USD' && x.method === 'cash' ? num_(x.tendered) : 0);
  if (x.method === 'cash' && cur === 'USD') return { sh: -num_(x.change), usd: usd };   // dollars in, change out in SH
  if (cur === 'USD') return { sh: 0, usd: usd };
  return { sh: num_(x.total), usd: 0 };
}
function shiftTotals_(s) {
  var t = { cashSales: 0, zaadSales: 0, edSales: 0, creditSales: 0, custPayCash: 0, custPayZaad: 0, custPayEd: 0, expCash: 0, expZaad: 0, expEd: 0, expCashUSD: 0, expZaadUSD: 0, expEdUSD: 0, refCash: 0, refZaad: 0, refEd: 0, saleCount: 0,
            cashInSH: 0, cashInUSD: 0, zaadInSH: 0, zaadInUSD: 0, edInSH: 0, edInUSD: 0, cashOutSH: 0, cashOutUSD: 0, undoneCount: 0 };
  var key = { cash: 'Cash', zaad: 'Zaad', edahab: 'Ed' }, inKey = { cash: 'cash', zaad: 'zaad', edahab: 'ed' };
  var since = String(s.date || dateOf_(s.openTs)).slice(0, 10);
  recent_('Sales', since).forEach(function (x) {
    if (x.shiftId !== s.id) return;
    if (GONE[x.status]) { t.undoneCount++; return; }
    t.saleCount++;
    if (x.method === 'credit') { t.creditSales += num_(x.total); return; }
    t[{ cash: 'cashSales', zaad: 'zaadSales', edahab: 'edSales' }[x.method]] += num_(x.total);
    var m = saleMoney_(x), k = inKey[x.method];
    t[k + 'InSH'] += m.sh; t[k + 'InUSD'] += m.usd;
  });
  recent_('CustLedger', since).forEach(function (x) { if (x.shiftId === s.id && x.type === 'payment' && key[x.method]) t['custPay' + key[x.method]] += num_(x.amount); });
  recent_('Expenses', since).forEach(function (x) {
    if (x.shiftId !== s.id || !key[x.method] || x.status === 'undone') return;
    if (x.currency === 'USD') t['exp' + key[x.method] + 'USD'] += num_(x.usdAmount); else t['exp' + key[x.method]] += num_(x.amount);
  });
  recent_('Refunds', since).forEach(function (x) { if (x.shiftId === s.id && x.status === 'approved' && key[x.method]) t['ref' + key[x.method]] += num_(x.amount); });
  recent_('CashMoves', since).forEach(function (x) { if (x.shiftId === s.id) t[x.currency === 'USD' ? 'cashOutUSD' : 'cashOutSH'] += num_(x.amount); });
  var rate = num_(s.rate) || rate_(), r2 = function (v) { return Math.round(v * 100) / 100; };
  t.eCashSH = num_(s.openCash) + t.cashInSH + t.custPayCash - t.expCash - t.refCash - t.cashOutSH;
  t.eCashUSD = r2(num_(s.openCashUSD) + t.cashInUSD - t.cashOutUSD - t.expCashUSD);
  t.eZaadSH = num_(s.openZaadSH) + t.zaadInSH + t.custPayZaad - t.expZaad - t.refZaad;
  t.eZaadUSD = r2(num_(s.openZaadUSD) + t.zaadInUSD - t.expZaadUSD);
  t.eEdSH = num_(s.openEdSH) + t.edInSH + t.custPayEd - t.expEd - t.refEd;
  t.eEdUSD = r2(num_(s.openEdUSD) + t.edInUSD - t.expEdUSD);
  t.totalExpSH = t.eCashSH + t.eZaadSH + t.eEdSH;
  t.totalExpUSD = r2(t.eCashUSD + t.eZaadUSD + t.eEdUSD);
  // same money counted in SH (older screens and reports use these)
  t.expectedCash = t.eCashSH + t.eCashUSD * rate;
  t.expectedZaad = t.eZaadSH + t.eZaadUSD * rate;
  t.expectedEd = t.eEdSH + t.eEdUSD * rate;
  t.rate = rate;
  return t;
}

function report_(u, d) {
  var biz = bizFilter_(u, d.business), from = d.from || today_(), to = d.to || today_();
  var profitOk = can_(u, 'viewProfit');
  var inR = function (x) { return biz.indexOf(x.business) >= 0 && x.date >= from && x.date <= to; };
  var blank = function () { return { count: 0, subtotal: 0, discount: 0, sales: 0, cost: 0, refunds: 0, refundCost: 0, expenses: 0, stockPurchases: 0, cash: 0, zaad: 0, edahab: 0, credit: 0, custPay: 0 }; };
  var byBiz = { shop: blank(), food: blank() }, days = {}, emp = {}, items = {};
  var sales = table_('Sales').rows.filter(function (x) { return inR(x) && !GONE[x.status]; }), saleIds = {};
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
    var it = items[i.productId] || (items[i.productId] = { productId: i.productId, name: i.name, business: i.business, qty: 0, pcs: 0, revenue: 0, profit: 0 });
    if (i.unit === 'pc') it.pcs += num_(i.qty); else it.qty += num_(i.qty);
    it.revenue += num_(i.lineTotal); it.profit += num_(i.lineTotal) - num_(i.cost) * num_(i.qty);
  });
  table_('Refunds').rows.forEach(function (r) {
    if (r.status !== 'approved' || biz.indexOf(r.business) < 0) return;
    var dt = dateOf_(r.decidedTs || r.ts); if (dt < from || dt > to) return;
    byBiz[r.business].refunds += num_(r.amount); byBiz[r.business].refundCost += num_(r.cost);
  });
  var expCats = {};
  table_('Expenses').rows.filter(inR).forEach(function (e) {
    if (e.status === 'undone') return;
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
  var lowStock = prods.filter(function (p) { return p.business === 'shop' && num_(p.stock) <= lowAt_(p); }).map(function (p) { return { id: p.id, name: p.name, stock: num_(p.stock), lowStock: num_(p.lowStock), stockTxt: stockTxt_(p), loose: isLoose_(p) ? 1 : 0 }; });
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
    var open = sh.filter(function (s) { return s.status === 'open'; }).map(function (s) { var t = shiftTotals_(s); return { id: s.id, userName: s.userName, openTs: s.openTs, expectedCash: t.expectedCash, expectedZaad: t.expectedZaad, expectedEd: t.expectedEd, saleCount: t.saleCount, eCashSH: t.eCashSH, eCashUSD: t.eCashUSD }; });
    var rate = closed ? num_(closed.rate) || rate_() : rate_();
    return { business: b, last: closed ? { closeTs: closed.closeTs, userName: closed.userName, cash: num_(closed.closeCash), zaad: num_(closed.closeZaadSH) + num_(closed.closeZaadUSD) * rate,
             edahab: num_(closed.closeEdSH) + num_(closed.closeEdUSD) * rate, diffCash: num_(closed.diffCash), diffZaad: num_(closed.diffZaad), diffEd: num_(closed.diffEd) } : null, open: open };
  });
  var shifts = table_('Shifts').rows.filter(inR).map(function (x) { return Object.assign(clean_(x), lateInfo_(x)); });
  var cashMoves = table_('CashMoves').rows.filter(inR).map(clean_);
  var undone = table_('Sales').rows.filter(function (x) { return inR(x) && GONE[x.status]; })
    .map(function (x) { return { id: x.id, ts: x.ts, userName: x.userName, total: num_(x.total), method: x.method, status: x.status, undoneBy: x.undoneBy, reason: x.undoReason }; });
  var top = Object.keys(items).map(function (k) { var i = items[k]; if (!profitOk) delete i.profit; return i; });
  var looseSales = top.filter(function (i) { return i.pcs > 0; }).sort(function (a, b) { return b.revenue - a.revenue; });
  return {
    ok: true, from: from, to: to, business: biz, byBiz: byBiz, totals: totals,
    days: Object.keys(days).sort().map(function (k) { return days[k]; }),
    employees: Object.keys(emp).map(function (k) { return emp[k]; }).sort(function (a, b) { return b.total - a.total; }),
    topItems: top.sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 20),
    slowItems: prods.filter(function (p) { return !items[p.id]; }).slice(0, 20).map(function (p) { return { id: p.id, name: p.name, stock: p.stock, stockTxt: stockTxt_(p) }; }),
    looseSales: looseSales,
    expenses: Object.keys(expCats).map(function (k) { return expCats[k]; }),
    lowStock: lowStock, lowIngredients: lowIng, expiring: expiring, debts: debts, totalDebt: debts.reduce(function (a, c) { return a + c.balance; }, 0),
    suppliersOwed: supOwed, balances: balances, shifts: shifts, cashMoves: cashMoves, undone: undone,
    pendingRefunds: table_('Refunds').rows.filter(function (r) { return r.status === 'pending' && biz.indexOf(r.business) >= 0; }).length,
    openOrders: table_('PurchaseOrders').rows.filter(function (o) { return o.status === 'SENT' && biz.indexOf(o.business) >= 0; }).length,
    profitVisible: profitOk
  };
}

/* ============================== setup, menu, backups ============================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Saado POS')
    .addItem('1. Run setup (safe to repeat)', 'setup')
    .addItem('2. Back up now', 'backupNow')
    .addItem('3. Reset an owner PIN (shows new PIN)', 'emergencyResetOwnerPin')
    .addItem('4. Send email reports now (test)', 'sendAllReportsNow')
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
    [['Hussein', 'owner', 'both'], ['Raxma', 'employee', 'shop'], ['Sacad', 'employee', 'food']].forEach(function (x) {
      var pin = randomPin_(), salt = newSalt_();
      insert_('Users', { id: uid_('U'), name: x[0], role: x[1], business: x[2], pinHash: hash_(salt, pin), salt: salt, active: 1, lang: 'so',
                         afterHours: x[1] === 'owner' ? 1 : 0, perms: JSON.stringify(x[1] === 'owner' ? [] : EMPLOYEE_DEFAULT_PERMS), createdAt: nowIso_(), pinChanged: 0 });
      shown.push(x[0] + ': ' + pin);
    });
  }
  var trig = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (trig.indexOf('dailyBackup') < 0) ScriptApp.newTrigger('dailyBackup').timeBased().atHour(3).everyDays(1).inTimezone(TZ).create();
  // v1.3: one small timer every 15 minutes sends emails at the times chosen in Settings (replaces the fixed 23:30 timer)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyEmails') ScriptApp.deleteTrigger(t); });
  if (trig.indexOf('emailTick') < 0) ScriptApp.newTrigger('emailTick').timeBased().everyMinutes(15).create();
  // v1.2: employees get "undo own sales" and "take cash out" by default (once)
  if (setting_('permsV2') !== '1') {
    table_('Users').rows.forEach(function (x) {
      if (x.role === 'owner') return;
      var p = []; try { p = JSON.parse(x.perms || '[]'); } catch (e) {}
      ['undoSales', 'cashOut'].forEach(function (k) { if (p.indexOf(k) < 0) p.push(k); });
      x.perms = JSON.stringify(p); update_('Users', x);
    });
    setSetting_('permsV2', '1');
  }
  try { MailApp.getRemainingDailyQuota(); } catch (e) {}   // asks for permission to send email reports
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

/* ============================== v1.2 helpers: owner tools, shift times, insights, emails, reset, archive ============================== */

function needOwner_(u) { if (!isOwner_(u)) throw new Error('NOPERM: owners only'); }
function forget_(name) { T_[name] = null; Object.keys(T_).forEach(function (k) { if (k.indexOf('~' + name + '|') === 0) delete T_[k]; }); }
function deleteRow_(name, o) { table_(name).sh.deleteRow(o._r); forget_(name); }
function clear_(name) {
  var t = table_(name), last = t.sh.getLastRow();
  if (last > 1) t.sh.getRange(2, 1, last - 1, t.headers.length).clearContent();
  forget_(name);
}
function rewrite_(name, rows) {
  var t = table_(name), last = t.sh.getLastRow();
  if (last > 1) t.sh.getRange(2, 1, last - 1, t.headers.length).clearContent();
  if (rows.length) t.sh.getRange(2, 1, rows.length, t.headers.length).setValues(rows.map(function (o) { return rowArr_(t, o); }));
  forget_(name);
}
function setSetting_(k, v) {
  var row = table_('Settings').rows.filter(function (r) { return r.key === k; })[0];
  if (row) { row.value = String(v); update_('Settings', row); } else insert_('Settings', { key: k, value: String(v), note: (DEFAULT_SETTINGS[k] || ['', ''])[1] });
  T_._settings = null;
}
function fmt_(n) { return String(Math.round(num_(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function esc_(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function addDaysIso_(ds, n) { var d = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10) + n, 12)); return d.toISOString().slice(0, 10); }
function daysIn_(m) { return new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); }
function shiftMonth_(m, n) { var d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); }
var MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel_(ds) { return MONTHS_[+ds.slice(5, 7) - 1] + ' ' + ds.slice(0, 4); }
function isoMinutes_(iso) { var m = String(iso).match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : 0; }
function hhmm_(mins) { mins = ((mins % 1440) + 1440) % 1440; return ('0' + Math.floor(mins / 60)).slice(-2) + ':' + ('0' + mins % 60).slice(-2); }

// When a shift should have started, and how late it was.
function lateInfo_(s) {
  var open = String(s.openTs || '').slice(11, 16); if (!open) return {};
  var om = toMin_(open);
  var starts = s.business === 'food' ? [toMin_(setting_('food_open'))] : String(setting_('shop_hours')).split(',').map(function (r) { return toMin_(r.split('-')[0]); });
  var sched = starts.reduce(function (b, x) { return Math.abs(x - om) < Math.abs(b - om) ? x : b; }, starts[0]);
  var late = om - sched, lm = num_(setting_('lateMin')) || 10;
  return { scheduled: hhmm_(sched), lateBy: late > lm ? late : 0, onTime: late <= lm, worked: s.closeTs ? Math.max(0, isoMinutes_(s.closeTs) - isoMinutes_(s.openTs)) : '' };
}

/* ---------- insights ---------- */
function monthTotals_(u, bizParam, m) {
  var r = report_(u, { business: bizParam, from: m + '-01', to: m + '-' + ('0' + daysIn_(m)).slice(-2) }), t = r.totals;
  var out = { sales: t.netSales, profit: t.profit, expenses: t.expenses, count: t.count, fromArchive: false };
  if (!t.count) {   // month already archived: use the saved monthly totals
    var biz = bizFilter_(u, bizParam), rows = table_('MonthlySummary').rows.filter(function (x) { return x.month === m && biz.indexOf(x.business) >= 0; });
    if (rows.length) {
      out = { sales: 0, profit: 0, expenses: 0, count: 0, fromArchive: true };
      rows.forEach(function (x) { out.sales += num_(x.netSales); out.profit += num_(x.profit); out.expenses += num_(x.expenses); out.count += num_(x.count); });
      if (!can_(u, 'viewProfit')) delete out.profit;
    }
  }
  return out;
}
function insights_(u, d) {
  var biz = bizFilter_(u, d.business);
  var month = /^\d{4}-\d{2}$/.test(d.month || '') ? d.month : today_().slice(0, 7), prev = shiftMonth_(month, -1);
  var cur = monthTotals_(u, d.business, month), last = monthTotals_(u, d.business, prev);
  var dailyCur = [], dailyPrev = [], i;
  for (i = 0; i < daysIn_(month); i++) dailyCur.push(0);
  for (i = 0; i < daysIn_(prev); i++) dailyPrev.push(0);
  var since = addDaysIso_(today_(), -90), dow = [0, 0, 0, 0, 0, 0, 0], heat = [], late = {}, food = { all: 0, after23: 0, days: {} };
  for (i = 0; i < 7; i++) { heat.push([]); for (var h = 0; h < 24; h++) heat[i].push(0); }
  var undone = {};
  table_('Sales').rows.forEach(function (x) {
    if (biz.indexOf(x.business) < 0) return;
    if (GONE[x.status]) { if (x.date.slice(0, 7) === month) undone[x.userName] = (undone[x.userName] || 0) + 1; return; }
    var tot = num_(x.total) - num_(x.refunded), m = x.date.slice(0, 7), day = +x.date.slice(8, 10);
    if (m === month) dailyCur[day - 1] += tot; else if (m === prev) dailyPrev[day - 1] += tot;
    if (x.date >= since) {
      var wd = new Date(x.date + 'T12:00:00Z').getUTCDay(), hr = +String(x.ts).slice(11, 13);
      dow[wd] += tot; heat[wd][hr] += tot;
      if (x.business === 'food') { food.all += tot; if (hr >= 23 || hr < 5) { food.after23 += tot; food.days[x.date] = 1; } }
    }
  });
  var att = {};
  table_('Shifts').rows.forEach(function (s) {
    if (biz.indexOf(s.business) < 0 || String(s.date).slice(0, 7) !== month) return;
    var a = att[s.userName] || (att[s.userName] = { name: s.userName, shifts: 0, startSum: 0, late: 0, minutes: 0 });
    var li = lateInfo_(s); a.shifts++; a.startSum += toMin_(String(s.openTs).slice(11, 16)); if (li.lateBy) a.late++; a.minutes += num_(li.worked);
  });
  var attendance = Object.keys(att).map(function (k) { var a = att[k]; return { name: a.name, shifts: a.shifts, avgStart: hhmm_(Math.round(a.startSum / a.shifts)), late: a.late, hours: Math.round(a.minutes / 60) }; });
  var foodTip = null;
  if (biz.indexOf('food') >= 0 && food.all > 0) foodTip = { sharePct: Math.round(food.after23 * 100 / food.all), perDay: Math.round(food.after23 / 90), close: setting_('food_close') };
  return { ok: true, month: month, prev: prev, cur: cur, last: last, dailyCur: dailyCur, dailyPrev: dailyPrev, dow: dow, heat: heat, attendance: attendance,
           undone: Object.keys(undone).map(function (k) { return { name: k, count: undone[k] }; }), foodTip: foodTip, profitVisible: can_(u, 'viewProfit') };
}

/* ---------- emails (sent from the owner's Gmail by Apps Script) ---------- */
function recipientsFor_(kind) { return table_('Recipients').rows.filter(function (r) { return isOn_(r.active) && isOn_(r[kind]) && r.email; }); }
function emailWrap_(title, inner) {
  var url = setting_('appUrl');
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1d2733">' +
    '<div style="text-align:center;padding:16px 0"><img src="' + esc_(url) + 'icons/logo.png" alt="Saado" style="height:84px"></div>' +
    '<h2 style="color:#003366;margin:0 0 12px;font-size:20px">' + esc_(title) + '</h2>' + inner +
    '<p style="color:#888;font-size:12px;margin-top:24px">Open the app: <a href="' + esc_(url) + '">' + esc_(url) + '</a><br>Change how often you get this: Saado POS → More → My email reports</p></div>';
}
function sendLowStock_(items, scheduled) {
  if (!isOn_(setting_('lowStockEmail'))) return;
  if (!scheduled && setting_('lowStockMode') === 'daily') return;   // daily mode: the list goes out once a day instead
  var rs = recipientsFor_('lowStock'); if (!rs.length) return;
  var subj = items.length === 1 ? 'Low stock: ' + items[0].name + ' — ' + items[0].stock + ' left' : 'Low stock: ' + items.length + ' items need ordering';
  var rows = items.map(function (x) { return '<tr><td style="padding:8px;border-bottom:1px solid #eee">' + esc_(x.name) + '</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:#C62828;font-weight:bold">' + (typeof x.stock === 'number' ? fmt_(x.stock) : esc_(x.stock)) + ' left</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:#888">warn at ' + (typeof x.lowStock === 'number' ? fmt_(x.lowStock) : esc_(x.lowStock)) + '</td></tr>'; }).join('');
  var html = emailWrap_('Low stock', '<table style="width:100%;border-collapse:collapse;font-size:15px">' + rows + '</table><p>Make a purchase order in Saado POS → More → Purchasing → "Add low-stock items".</p>');
  MailApp.sendEmail({ to: rs.map(function (r) { return r.email; }).join(','), subject: subj, htmlBody: html, name: 'Saado POS' });
}
/* ---------- email schedule ----------
   A small timer runs every 15 minutes (made by setup) and sends whatever is due, using the times the owner picked in Settings.
   Times before 12:00 report on the period that ended yesterday (e.g. a 08:00 daily email = yesterday's full day). */
function emailClock_() {
  var now = new Date();
  return { td: today_(), hm: Utilities.formatDate(now, TZ, 'HH:mm'), wd: Utilities.formatDate(now, TZ, 'EEE') };
}
function hm_(v, dflt) { v = String(v || ''); return /^\d{2}:\d{2}$/.test(v) ? v : dflt; }
// The period an email covers when it is sent on day td at time hm.
function emailPeriod_(kind, td, hm) {
  var end = hm < '12:00' ? addDaysIso_(td, -1) : td;
  if (kind === 'daily') return { from: end, to: end };
  if (kind === 'weekly') return { from: addDaysIso_(end, -6), to: end };
  if (setting_('monthlyWhen') === 'first') { var pm = shiftMonth_(td.slice(0, 7), -1); return { from: pm + '-01', to: pm + '-' + ('0' + daysIn_(pm)).slice(-2) }; }
  return { from: td.slice(0, 8) + '01', to: td };
}
function emailTick() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return;
  try {
    T_ = {};
    var c = emailClock_(), sent = {}; try { sent = JSON.parse(setting_('emailSent') || '{}'); } catch (e) {}
    var due = [], dT = hm_(setting_('emailDailyTime'), '23:30'), wT = hm_(setting_('emailWeeklyTime'), '23:30'), mT = hm_(setting_('emailMonthlyTime'), '23:30');
    if (c.hm >= dT && sent.daily !== c.td) due.push(['daily', dT]);
    if (c.wd === String(setting_('weeklyDay') || 'Thu') && c.hm >= wT && sent.weekly !== c.td) due.push(['weekly', wT]);
    var lastDay = c.td.slice(8) === ('0' + daysIn_(c.td.slice(0, 7))).slice(-2), first = c.td.slice(8) === '01';
    if ((setting_('monthlyWhen') === 'first' ? first : lastDay) && c.hm >= mT && sent.monthly !== c.td) due.push(['monthly', mT]);
    var low = setting_('lowStockMode') === 'daily' && isOn_(setting_('lowStockEmail')) && c.hm >= hm_(setting_('lowStockTime'), '08:00') && sent.low !== c.td;
    if (!due.length && !low) return;
    // mark first, so a slow send is never repeated by the next run
    due.forEach(function (x) { sent[x[0]] = c.td; }); if (low) sent.low = c.td;
    setSetting_('emailSent', JSON.stringify(sent));
    due.forEach(function (x) { try { sendReport_(x[0], null, false, emailPeriod_(x[0], c.td, x[1])); } catch (e) { console.error(e); } });
    if (low) { var items = lowStockNow_(); if (items.length) sendLowStock_(items, true); }
  } finally { lock.releaseLock(); }
}
function lowStockNow_() {
  return table_('Products').rows.filter(function (p) {
    return isOn_(p.active) && !isOn_(p.deleted) && p.business === 'shop' && num_(p.lowStock) > 0 && num_(p.stock) <= lowAt_(p);
  }).map(function (p) { return { name: p.name, stock: stockTxt_(p), lowStock: num_(p.lowStock) + (isLoose_(p) ? ' pk' : '') }; });
}
// Old timer name (from v1.2.0) still works.
function dailyEmails() { emailTick(); }
// Menu: send every report right now (to check they arrive).
function sendAllReportsNow() {
  T_ = {}; var c = emailClock_();
  ['daily', 'weekly', 'monthly'].forEach(function (k) { sendReport_(k, null, true, emailPeriod_(k, c.td, c.hm)); });
  var items = lowStockNow_(); if (items.length) sendLowStock_(items, true);
}
function sendReport_(kind, only, test, period) {
  var rs = only || recipientsFor_(kind); if (!rs.length) return 0;
  if (!period) { var c = emailClock_(); period = emailPeriod_(kind, c.td, hm_(setting_(kind === 'daily' ? 'emailDailyTime' : kind === 'weekly' ? 'emailWeeklyTime' : 'emailMonthlyTime'), '23:30')); }
  var from = period.from, to = period.to;
  var label = kind === 'daily' ? Utilities.formatDate(new Date(to + 'T12:00:00Z'), 'UTC', 'EEEE d MMMM') : kind === 'weekly' ? from + ' to ' + to : monthLabel_(from);
  var title = (kind === 'daily' ? 'Daily report — ' : kind === 'weekly' ? 'Weekly report — ' : 'Monthly report — ') + label;
  var owner = table_('Users').rows.filter(function (x) { return x.role === 'owner' && isOn_(x.active); })[0];
  rs.forEach(function (r) {
    var viewer = r.userId ? find_('Users', r.userId) : owner;
    if (!viewer || !isOn_(viewer.active)) viewer = owner;
    var rep = report_(viewer, { business: 'all', from: from, to: to });
    MailApp.sendEmail({ to: r.email, subject: (test ? '[Test] ' : '') + 'Saado · ' + title, htmlBody: reportEmailHtml_(title, rep, kind), name: 'Saado POS' });
  });
  return rs.length;
}
function reportEmailHtml_(title, r, kind) {
  var T = r.totals, td = 'padding:7px 0;border-bottom:1px solid #eee', tr = function (a, b) { return '<tr><td style="' + td + '">' + a + '</td><td style="' + td + ';text-align:right">' + b + '</td></tr>'; };
  var bizNames = { shop: setting_('shopName') || 'Shop', food: setting_('foodName') || 'Fast Food' };
  var h = '<div style="background:#003366;color:#fff;border-radius:14px;padding:16px;text-align:center"><div style="opacity:.8">Sales · ' + r.business.map(function (b) { return esc_(bizNames[b]); }).join(' + ') + '</div>' +
    '<div style="font-size:30px;font-weight:800;color:#FFBF00">' + fmt_(T.netSales) + ' SH</div><div style="opacity:.8">' + T.count + ' sales' + (r.profitVisible ? ' · Profit ' + fmt_(T.profit) + ' SH' : '') + '</div></div>';
  h += '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">' + tr('Cash', fmt_(T.cash)) + tr('Zaad', fmt_(T.zaad)) + tr('Edahab', fmt_(T.edahab)) + tr('Credit', fmt_(T.credit)) +
    tr('Expenses', '−' + fmt_(T.expenses + T.stockPurchases)) + tr('Refunds', '−' + fmt_(T.refunds)) + tr('Debt payments received', fmt_(T.custPay));
  var out = {}; (r.cashMoves || []).forEach(function (m) { var k = m.takenBy + ' ' + m.currency; out[k] = (out[k] || 0) + num_(m.amount); });
  Object.keys(out).forEach(function (k) { var p = k.split(' '); h += tr('Cash taken out (' + esc_(p[0]) + ')', (p[1] === 'USD' ? '$' : '') + fmt_(out[k]) + (p[1] === 'USD' ? '' : ' SH')); });
  h += '</table>';
  if (r.business.length > 1) h += '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">' + r.business.map(function (b) { return tr(esc_(bizNames[b]), fmt_(r.byBiz[b].netSales) + ' SH · ' + r.byBiz[b].count + ' sales'); }).join('') + '</table>';
  var sh = (r.shifts || []).map(function (s) {
    var diff = s.status === 'closed' ? (Math.round(num_(s.diffAll !== '' && s.diffAll !== undefined ? s.diffAll : s.diffCash)) === 0 ? 'money correct ✔' : '<span style="color:#C62828">' + (num_(s.diffAll || s.diffCash) < 0 ? fmt_(-num_(s.diffAll || s.diffCash)) + ' short' : fmt_(s.diffAll || s.diffCash) + ' extra') + '</span>') : 'open';
    return esc_(s.userName) + ' ' + String(s.openTs).slice(11, 16) + (s.closeTs ? '–' + String(s.closeTs).slice(11, 16) : '') + ' · ' + diff + (s.lateBy ? ' · ' + s.lateBy + ' min late' : '');
  });
  if (sh.length && kind === 'daily') h += '<h3 style="color:#003366;font-size:15px;margin:18px 0 6px">Shifts</h3><div style="font-size:14px;line-height:1.7">' + sh.join('<br>') + '</div>';
  var att = [];
  if (r.lowStock.length) att.push('Low stock: ' + r.lowStock.slice(0, 12).map(function (p) { return esc_(p.name) + ' (' + esc_(p.stockTxt || fmt_(p.stock)) + ')'; }).join(', '));
  if ((r.undone || []).length) att.push('Undone sales: ' + r.undone.length + ' (' + r.undone.slice(0, 5).map(function (x) { return esc_(x.userName) + ', “' + esc_(x.reason) + '”'; }).join('; ') + ')');
  if (r.pendingRefunds) att.push('Refund requests waiting: ' + r.pendingRefunds);
  if (r.openOrders) att.push('Purchase orders waiting for delivery: ' + r.openOrders);
  att.push('Customer debts: ' + fmt_(r.totalDebt) + ' SH');
  h += '<h3 style="color:#003366;font-size:15px;margin:18px 0 6px">Needs attention</h3><div style="font-size:14px;line-height:1.7">' + att.join('<br>') + '</div>';
  if (r.topItems.length) h += '<h3 style="color:#003366;font-size:15px;margin:18px 0 6px">Best sellers</h3><div style="font-size:14px;line-height:1.7">' + r.topItems.slice(0, 5).map(function (i) { return esc_(i.name) + ' ×' + fmt_(i.qty); }).join('<br>') + '</div>';
  return emailWrap_(title, h);
}

/* ---------- data size, reset, archive ---------- */
var HISTORY_ = ['Sales', 'SaleItems', 'Shifts', 'CashMoves', 'Expenses', 'Refunds', 'CustLedger', 'SupLedger', 'PurchaseOrders', 'StockLog', 'IngLog', 'Audit'];
function folder_(parent, name) {
  var it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : (parent ? parent.createFolder(name) : DriveApp.createFolder(name));
}
function archiveRoot_() {
  var root = folder_(null, 'Saado POS Archive');
  if (!root.getFilesByName('README — do not delete.txt').hasNext())
    root.createFile('README — do not delete.txt', 'Saado POS Archive.\nOld data moved out of the live Sheet, and safety copies made before every reset.\nThe app never deletes anything in this folder.');
  return root;
}
function safetyCopy_(label) {
  var sub = folder_(archiveRoot_(), 'Resets');
  var name = 'Saado POS · ' + label + ' ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm');
  var f = DriveApp.getFileById(ss_().getId()).makeCopy(name, sub);
  return { name: name, url: f.getUrl() };
}
function adminCounts_() {
  var c = {}; Object.keys(SCHEMA).forEach(function (n) { c[n] = table_(n).rows.length; });
  var debt = table_('Customers').rows.reduce(function (a, x) { return a + Math.max(0, num_(x.balance)); }, 0);
  var owed = table_('Suppliers').rows.reduce(function (a, x) { return a + Math.max(0, num_(x.balance)); }, 0);
  var backups = 0;
  try { var it = DriveApp.getFoldersByName('Saado POS Backups'); if (it.hasNext()) { var f = it.next().getFiles(); while (f.hasNext()) { f.next(); backups++; } } } catch (e) {}
  var hist = HISTORY_.reduce(function (a, n) { return a + c[n]; }, 0), first = '';
  table_('Sales').rows.forEach(function (x) { if (!first || x.date < first) first = x.date; });
  var links = []; try { links = JSON.parse(setting_('archiveLinks') || '[]'); } catch (e) {}
  return { ok: true, counts: c, customerDebt: debt, supplierOwed: owed, backups: backups, historyRows: hist, salesRows: c.Sales + c.SaleItems, limit: 30000,
           firstDate: first, archivedUntil: setting_('archivedUntil'), archiveLinks: links,
           employees: table_('Users').rows.filter(function (x) { return x.role !== 'owner'; }).map(function (x) { return x.name; }) };
}
function reset_(u, d) {
  if (String(d.confirm || '').trim().toUpperCase() !== 'RESET') throw new Error('Type RESET to confirm');
  if (hash_(u.salt, String(d.pin || '')) !== u.pinHash) throw new Error('Wrong PIN');
  var parts = (d.parts || []).filter(function (p) { return RESET_PARTS_[p]; });
  if (!parts.length) throw new Error('Tick at least one thing to reset');
  var copy = safetyCopy_('Before reset');
  parts.forEach(function (p) { RESET_PARTS_[p](u); });
  setSetting_('dataVersion', num_(setting_('dataVersion')) + 1);
  audit_(u, 'reset', { parts: parts, safetyCopy: copy.name });
  return { ok: true, parts: parts, safetyCopy: copy, dataVersion: setting_('dataVersion') };
}
var RESET_PARTS_ = {
  sales: function () { clear_('Sales'); clear_('SaleItems'); clear_('Refunds'); clear_('MonthlySummary'); table_('Products').rows.forEach(function (p) { if (num_(p.sold)) { p.sold = 0; update_('Products', p); } }); },
  shifts: function () { clear_('Shifts'); clear_('CashMoves'); },
  expenses: function () { clear_('Expenses'); },
  customers: function () { clear_('Customers'); clear_('CustLedger'); },
  custBalances: function (u) {
    table_('Customers').rows.forEach(function (c) {
      var b = num_(c.balance); if (!b) return;
      insert_('CustLedger', { id: uid_('CL'), ts: nowIso_(), date: today_(), business: c.business, customerId: c.id, type: 'reset', amount: -b, method: '', ref: '', shiftId: '', userName: u.name, note: 'Balance reset' });
      c.balance = 0; update_('Customers', c);
    });
  },
  suppliers: function () { clear_('Suppliers'); clear_('SupLedger'); clear_('PurchaseOrders'); },
  supBalances: function (u) {
    table_('Suppliers').rows.forEach(function (s) {
      var b = supBalance_(s); if (!b) return;
      insert_('SupLedger', { id: uid_('SA'), ts: nowIso_(), date: today_(), business: s.business, supplierId: s.id, type: 'adjust', amount: -b, paid: 0, method: '', items: '', userName: u.name, note: 'Balance reset', ref: '' });
      supBalance_(s);
    });
  },
  products: function () { clear_('Products'); clear_('StockLog'); },
  stockQty: function (u) {
    var now = nowIso_();
    table_('Products').rows.forEach(function (p) {
      if (p.business !== 'shop' || !num_(p.stock)) return;
      insert_('StockLog', { id: uid_('SL'), ts: now, date: today_(), business: p.business, productId: p.id, name: p.name, type: 'reset', before: num_(p.stock), after: 0, diff: -num_(p.stock), userName: u.name, note: '' });
      p.stock = 0; update_('Products', p);
    });
  },
  ingredients: function (u) {
    table_('Ingredients').rows.forEach(function (g) {
      if (!num_(g.stock)) return;
      insert_('IngLog', { id: uid_('IL'), ts: nowIso_(), date: today_(), ingredientId: g.id, name: g.name, type: 'set', qty: -num_(g.stock), userName: u.name, note: 'reset' });
      g.stock = 0; update_('Ingredients', g);
    });
  },
  employees: function () {
    var keep = table_('Users').rows.filter(function (x) { return x.role === 'owner'; }), gone = {};
    table_('Users').rows.forEach(function (x) { if (x.role !== 'owner') gone[x.id] = 1; });
    rewrite_('Users', keep);
    table_('Recipients').rows.forEach(function (r) { if (gone[r.userId]) { r.active = 0; update_('Recipients', r); } });
  },
  audit: function () { clear_('Audit'); },
  settings: function () {
    table_('Settings').rows.forEach(function (r) { if (DEFAULT_SETTINGS[r.key] && !PROTECTED_SETTINGS[r.key]) { r.value = DEFAULT_SETTINGS[r.key][0]; update_('Settings', r); } });
    T_._settings = null;
  },
  backups: function () {
    var it = DriveApp.getFoldersByName('Saado POS Backups');
    if (it.hasNext()) { var f = it.next().getFiles(); while (f.hasNext()) f.next().setTrashed(true); }
  }
};

var ARCHIVE_RULES_ = {
  Sales: function (r, c) { return r.date < c; }, SaleItems: function (r, c) { return r.date < c; },
  Shifts: function (r, c) { return r.status === 'closed' && r.date < c; }, CashMoves: function (r, c) { return r.date < c; },
  Expenses: function (r, c) { return r.date < c; }, Refunds: function (r, c) { return r.status !== 'pending' && r.date < c; },
  CustLedger: function (r, c) { return r.date < c && r.type !== 'opening'; }, SupLedger: function (r, c) { return r.date < c && r.type !== 'opening'; },
  PurchaseOrders: function (r, c) { return (r.status === 'RECEIVED' || r.status === 'CANCELLED') && r.date < c; },
  StockLog: function (r, c) { return r.date < c; }, IngLog: function (r, c) { return r.date < c; }, Audit: function (r, c) { return dateOf_(r.ts) < c; }
};
function monthlySummary_(sales, expenses, refunds) {
  var m = {}, row = function (mon, b) { var k = mon + '|' + b; return m[k] || (m[k] = { month: mon, business: b, count: 0, sales: 0, refunds: 0, refundCost: 0, netSales: 0, cost: 0, expenses: 0, profit: 0, cash: 0, zaad: 0, edahab: 0, credit: 0 }); };
  sales.forEach(function (x) { if (GONE[x.status]) return; var r = row(x.date.slice(0, 7), x.business); r.count++; r.sales += num_(x.total); r.cost += num_(x.cost); r[x.method] = (r[x.method] || 0) + num_(x.total); });
  refunds.forEach(function (x) { if (x.status !== 'approved') return; var r = row(dateOf_(x.decidedTs || x.ts).slice(0, 7), x.business); r.refunds += num_(x.amount); r.refundCost += num_(x.cost); });
  expenses.forEach(function (x) { if (x.category === 'Supplier purchases' || x.status === 'undone') return; row(x.date.slice(0, 7), x.business).expenses += num_(x.amount); });
  return Object.keys(m).sort().map(function (k) { var r = m[k]; r.netSales = r.sales - r.refunds; r.profit = r.netSales - (r.cost - r.refundCost) - r.expenses; r.updatedAt = nowIso_(); return r; });
}
function writeTab_(ss, name, headers, rows) {
  var sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#003366').setFontColor('#FFFFFF');
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setNumberFormat('@').setValues(rows);
  sh.setFrozenRows(1);
  return sh;
}
function archive_(u, cutoff, dry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff || '')) throw new Error('Choose a date');
  if (cutoff > today_()) throw new Error('The date cannot be in the future');
  var moved = {}, kept = {}, counts = {}, total = 0, first = '';
  Object.keys(ARCHIVE_RULES_).forEach(function (n) {
    var rows = table_(n).rows, test = ARCHIVE_RULES_[n];
    moved[n] = rows.filter(function (r) { return test(r, cutoff); }); kept[n] = rows.filter(function (r) { return !test(r, cutoff); });
    counts[n] = moved[n].length; total += moved[n].length;
    moved[n].forEach(function (r) { var dt = r.date || dateOf_(r.ts); if (dt && (!first || dt < first)) first = dt; });
  });
  if (!total) { if (dry) return { ok: true, total: 0, counts: counts }; throw new Error('There is no data older than this date'); }
  var lastDay = addDaysIso_(cutoff, -1), name = monthLabel_(first) + ' – ' + monthLabel_(lastDay);
  if (dry) return { ok: true, total: total, counts: counts, name: name, from: first, to: lastDay };

  backup_('before-archive');
  var folder = folder_(archiveRoot_(), name);
  var arch = SpreadsheetApp.create('Saado POS Archive · ' + name);
  DriveApp.getFileById(arch.getId()).moveTo(folder);
  var summary = monthlySummary_(moved.Sales, moved.Expenses, moved.Refunds), SH = SCHEMA.MonthlySummary;
  writeTab_(arch, 'Summary', SH, summary.map(function (r) { return SH.map(function (h) { return cellVal_(r[h]); }); }));
  Object.keys(moved).forEach(function (n) { if (moved[n].length) writeTab_(arch, n, SCHEMA[n], moved[n].map(function (r) { return SCHEMA[n].map(function (h) { return cellVal_(r[h]); }); })); });
  var bal = [['type', 'name', 'business', 'phone', 'balance / stock']];
  table_('Customers').rows.forEach(function (c) { bal.push(['customer', c.name, c.business, c.phone, num_(c.balance)]); });
  table_('Suppliers').rows.forEach(function (s) { bal.push(['supplier', s.name, s.business, s.phone, num_(s.balance)]); });
  table_('Products').rows.forEach(function (p) { if (!isOn_(p.deleted)) bal.push(['product', p.name, p.business, '', p.business === 'shop' ? num_(p.stock) : '']); });
  writeTab_(arch, 'Balances', bal[0], bal.slice(1).map(function (r) { return r.map(cellVal_); }));
  arch.getSheets().forEach(function (sh) { if (!SCHEMA[sh.getName()] && ['Summary', 'Balances'].indexOf(sh.getName()) < 0 && arch.getSheets().length > 1) arch.deleteSheet(sh); });

  // carry balances forward, so every customer and supplier balance stays exactly the same
  var ts = cutoff + 'T00:00:00', cOpen = {}, sOpen = {};
  moved.CustLedger.forEach(function (l) {
    var a = num_(l.amount), k = l.customerId; cOpen[k] = cOpen[k] || { biz: l.business, amt: 0 };
    cOpen[k].amt += l.type === 'sale' ? a : (l.type === 'reset' || l.type === 'opening') ? a : -a;
  });
  moved.SupLedger.forEach(function (l) {
    var k = l.supplierId; sOpen[k] = sOpen[k] || { biz: l.business, amt: 0 };
    sOpen[k].amt += l.type === 'purchase' ? num_(l.amount) - num_(l.paid) : l.type === 'receipt' ? num_(l.amount) : l.type === 'payment' ? -num_(l.amount) : num_(l.amount);
  });
  var cRows = Object.keys(cOpen).filter(function (k) { return cOpen[k].amt; }).map(function (k) { return { id: uid_('CL'), ts: ts, date: cutoff, business: cOpen[k].biz, customerId: k, type: 'opening', amount: cOpen[k].amt, method: '', ref: '', shiftId: '', userName: u.name, note: 'Carried forward from archive ' + name }; });
  var sRows = Object.keys(sOpen).filter(function (k) { return sOpen[k].amt; }).map(function (k) { return { id: uid_('SO'), ts: ts, date: cutoff, business: sOpen[k].biz, supplierId: k, type: 'opening', amount: sOpen[k].amt, paid: 0, method: '', items: '', userName: u.name, note: 'Carried forward from archive ' + name, ref: '' }; });
  Object.keys(kept).forEach(function (n) { rewrite_(n, n === 'CustLedger' ? cRows.concat(kept[n]) : n === 'SupLedger' ? sRows.concat(kept[n]) : kept[n]); });

  // keep monthly totals in the app for Insights
  var ms = table_('MonthlySummary').rows.filter(function (r) { return !summary.some(function (x) { return x.month === r.month && x.business === r.business; }); });
  rewrite_('MonthlySummary', ms.concat(summary));

  var pdfHtml = '<h1 style="font-family:Arial;color:#003366">Saado POS — ' + esc_(name) + '</h1><table style="font-family:Arial;border-collapse:collapse;font-size:12px" border="1" cellpadding="5"><tr><th>Month</th><th>Business</th><th>Sales</th><th>Refunds</th><th>Expenses</th><th>Profit</th><th>Sales #</th></tr>' +
    summary.map(function (r) { return '<tr><td>' + r.month + '</td><td>' + r.business + '</td><td>' + fmt_(r.netSales) + '</td><td>' + fmt_(r.refunds) + '</td><td>' + fmt_(r.expenses) + '</td><td>' + fmt_(r.profit) + '</td><td>' + r.count + '</td></tr>'; }).join('') + '</table>';
  try { folder.createFile(Utilities.newBlob(pdfHtml, 'text/html', 'summary.html').getAs('application/pdf').setName('Summary ' + name + '.pdf')); } catch (e) {}

  if (!setting_('archivedUntil') || cutoff > setting_('archivedUntil')) setSetting_('archivedUntil', cutoff);
  var links = []; try { links = JSON.parse(setting_('archiveLinks') || '[]'); } catch (e) {}
  links.push({ name: name, url: arch.getUrl(), from: first, to: lastDay, at: nowIso_() });
  setSetting_('archiveLinks', JSON.stringify(links));
  audit_(u, 'archive', { period: name, rows: total });
  return { ok: true, total: total, counts: counts, name: name, url: arch.getUrl() };
}
