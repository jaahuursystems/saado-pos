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
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        setValues(vals) {
          if (vals.length !== nr || vals[0].length !== nc) throw new Error(`range size mismatch ${nr}x${nc} vs ${vals.length}x${vals[0].length}`);
          for (let i = 0; i < nr; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < nc; j++) { let v = vals[i][j]; if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); data[r - 1 + i][c - 1 + j] = v; } }
          return this;
        },
        setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; }
      };
    }
  };
  return sh;
}

function makeEnv(opts = {}) {
  const sheets = {};
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: s => delete sheets[s.name],
    setSpreadsheetTimeZone() {}, getId: () => 'SHEET'
  };
  const cache = new Map();
  let clock = opts.now ? new Date(opts.now).getTime() : null;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0 && clock !== null) super(clock); else super(...a); }
    static now() { return clock !== null ? clock : RealDate.now(); }
  }
  const tzFmt = (d, tz, fmt) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return fmt.replace("yyyy", g('year')).replace('MM', g('month')).replace('dd', g('day')).replace('HH', g('hour')).replace('mm', g('minute')).replace('ss', g('second')).replace(/'T'/, 'T');
  };
  const ctx = {
    console, JSON, Math, isNaN, isFinite, Number, String, Object, Array, RegExp, Error,
    Date: FakeDate, Intl,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => { throw new Error('no ui'); } },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, String(v)), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      getUuid: () => crypto.randomUUID(),
      formatDate: tzFmt
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ inTimezone: () => ({ create() {} }) }) }) }) }) },
    DriveApp: { getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({ getFiles: () => ({ hasNext: () => false }) }), getFileById: () => ({ makeCopy() {} }) },
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return {
    ctx, sheets, cache,
    setNow: t => { clock = new RealDate(t).getTime(); },
    call(action, data, token) {
      const res = ctx.doPost({ postData: { contents: JSON.stringify({ action, data, token }) } });
      return JSON.parse(res.getContent());
    }
  };
}

module.exports = { makeEnv };
