/**
 * Test helper: a small in-memory imitation of Google Apps Script (SpreadsheetApp, CacheService, LockService,
 * Utilities, ContentService, ScriptApp, DriveApp) so Code.gs can run unchanged in Node for testing.
 * Not shipped to phones. Sheets behave like plain-text formatted cells (values kept as written).
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function makeSheet(name) {
  const data = []; // array of row arrays
  const sh = {
    name, data,
    getName: () => name,
    getLastRow: () => { for (let i = data.length - 1; i >= 0; i--) if (data[i] && data[i].some(v => v !== '' && v !== undefined)) return i + 1; return 0; },
    getMaxColumns: () => 26, getMaxRows: () => 1000,
    insertColumnsAfter() {},
    setFrozenRows() {},
    deleteRow(r) { data.splice(r - 1, 1); },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        setValues(vals) {
          if (vals.length !== nr || vals[0].length !== nc) throw new Error(`range size mismatch ${nr}x${nc} vs ${vals.length}x${vals[0].length}`);
          for (let i = 0; i < nr; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < nc; j++) { let v = vals[i][j]; if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); data[r - 1 + i][c - 1 + j] = v; } }
          return this;
        },
        clearContent() { for (let i = 0; i < nr; i++) { const row = data[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = ''; } return this; },
        setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; }
      };
    }
  };
  return sh;
}

function makeSS(id) {
  const sheets = {};
  return { sheets,
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: s => delete sheets[s.name],
    setSpreadsheetTimeZone() {}, getId: () => id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id };
}
function makeFolder(name, drive) {
  const f = { name, folders: [], files: [], getName: () => name, getId: () => 'F' + name, getUrl: () => 'https://drive.google.com/drive/folders/' + encodeURIComponent(name),
    createFolder: n => { const x = makeFolder(n, drive); f.folders.push(x); return x; },
    getFoldersByName: n => iter(f.folders.filter(x => x.name === n)),
    getFilesByName: n => iter(f.files.filter(x => x.name === n && !x.trashed)),
    getFiles: () => iter(f.files.filter(x => !x.trashed)),
    createFile: (a, b) => { const x = makeFile(typeof a === 'string' ? a : a.name, b); f.files.push(x); return x; } };
  return f;
}
function makeFile(name, content) { const x = { name, content, trashed: false, getName: () => x.name, getUrl: () => 'https://drive.google.com/file/' + encodeURIComponent(x.name), setTrashed: v => { x.trashed = v; } }; return x; }
function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }

function makeEnv(opts = {}) {
  const ss = makeSS('SHEET'), sheets = ss.sheets;
  const created = {}, mail = [], rootFolders = [];
  const drive = {
    getFoldersByName: n => iter(rootFolders.filter(x => x.name === n)),
    createFolder: n => { const f = makeFolder(n); rootFolders.push(f); return f; },
    getFileById: id => ({ makeCopy: (n, folder) => { const x = makeFile(n); (folder || { files: [] }).files.push(x); return x; },
                          moveTo: folder => { folder.files.push(makeFile(created[id] ? created[id].name : id)); }, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id })
  };
  const cache = new Map();
  let clock = opts.now ? new Date(opts.now).getTime() : null;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0 && clock !== null) super(clock); else super(...a); }
    static now() { return clock !== null ? clock : RealDate.now(); }
  }
  const tzFmt = (d, tz, fmt) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'long' }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const map = { yyyy: g('year'), MMMM: months[+g('month') - 1], MM: g('month'), dd: g('day'), d: String(+g('day')), HH: g('hour'), mm: g('minute'), ss: g('second'), EEEE: g('weekday'), EEE: g('weekday').slice(0, 3) };
    return fmt.replace(/'T'/g, 'T').replace(/yyyy|MMMM|MM|dd|EEEE|EEE|HH|mm|ss|d/g, k => map[k]);
  };
  const ctx = {
    console, JSON, Math, isNaN, isFinite, Number, String, Object, Array, RegExp, Error,
    Date: FakeDate, Intl,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => { throw new Error('no ui'); },
      create: name => { const id = 'ARCH' + Object.keys(created).length; const x = makeSS(id); x.name = name; x.insertSheet('Sheet1'); created[id] = x; return x; } },
    MailApp: { sendEmail: o => mail.push(o), getRemainingDailyQuota: () => 100 },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, String(v)), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      getUuid: () => crypto.randomUUID(),
      formatDate: tzFmt,
      newBlob: (c, t, n) => ({ name: n, getAs: () => ({ name: n, setName(x) { this.name = x; return this; } }) })
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { const ch = { timeBased: () => ch, atHour: () => ch, nearMinute: () => ch, everyDays: () => ch, inTimezone: () => ch, create() {} }; return ch; } },
    DriveApp: drive,
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return {
    ctx, sheets, cache, mail, created, rootFolders,
    setNow: t => { clock = new RealDate(t).getTime(); },
    call(action, data, token) {
      const res = ctx.doPost({ postData: { contents: JSON.stringify({ action, data, token }) } });
      return JSON.parse(res.getContent());
    }
  };
}

module.exports = { makeEnv };
