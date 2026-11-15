/**
 * Test server: serves the app and answers /exec with the real Code.gs running on the in-memory Google imitation.
 * Run: node tests/server.js 8787   (then open http://localhost:8787)
 * Extra test-only endpoints: /__pins (PINs made by setup), /__time?t=ISO (freeze the clock), /__sheet?name=Sales
 */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const { makeEnv } = require('./gas-mock');
const root = path.join(__dirname, '..');
const port = +process.argv[2] || 8787;
const env = makeEnv({ now: process.env.SAADO_NOW || null });
const pins = {};
env.ctx.setup().split('\n').forEach(l => { const m = l.match(/^(\w+): (\d{4})$/); if (m) pins[m[1]] = m[2]; });
let delay = +(process.env.SAADO_DELAY || 0);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname === '/exec' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => setTimeout(() => {
      const out = env.ctx.doPost({ postData: { contents: body } });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(out.getContent());
    }, delay));
    return;
  }
  if (u.pathname === '/__pins') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(pins)); }
  if (u.pathname === '/__time') { env.setNow(u.query.t); res.writeHead(200); return res.end('ok'); }
  if (u.pathname === '/__delay') { delay = +u.query.ms; res.writeHead(200); return res.end('ok'); }
  if (u.pathname === '/__sheet') { const s = env.sheets[u.query.name]; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(s ? s.data : null)); }
  if (u.pathname.startsWith('/config.js')) {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(`window.SAADO_CONFIG = { API_URL: 'http://localhost:${port}/exec', TEST_MODE: true };`);
  }
  let f = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('Saado test server on http://localhost:' + port, JSON.stringify(pins)));
