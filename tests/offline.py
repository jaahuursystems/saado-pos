"""
Offline-first test (real headless Chrome, phone screen, service worker on):
1. Owner logs in online; the app quietly pre-loads every tab.
2. Internet OFF: every tab opens at once with saved data (no loading placeholders, no errors).
3. Internet OFF: closing and re-opening the app still works (service worker), even after the 6-hour session ran out.
4. Internet OFF: log out, log back in with the PIN (checked on the phone), sell; internet ON: the sale is sent.
Run: node tests/server.js 8787 &  then  python3 tests/offline.py
"""
import json, sys, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8787'
pins = json.load(urllib.request.urlopen(BASE + '/__pins'))
sheet = lambda n: [r for r in json.load(urllib.request.urlopen(BASE + '/__sheet?name=' + n))[1:] if r and r[0]]
errors, n = [], [0]
def ok(m): n[0] += 1; print('  ok ', m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 393, 'height': 851}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/'); page.wait_for_selector('#dd')
    page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller", timeout=15000) if page.evaluate("!!navigator.serviceWorker.controller") else page.reload()
    page.wait_for_selector('#dd'); page.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000); ok('service worker controls the page')
    page.click('#dd'); page.click('.ddlist button:has-text("Hussein")')
    for d in pins['Hussein']: page.click(f'.pad button[data-k="{d}"]')
    page.click('.pad button.go'); page.wait_for_selector('#herokpi .kpi')
    # one product + an open shift so screens have data
    page.goto(BASE + '/#products'); page.wait_for_selector('.fab'); page.click('.fab')
    page.fill('[name=name]', 'Coca-Cola 330ml'); page.fill('[name=barcode]', '5449000000996'); page.fill('[name=price]', '3000'); page.fill('[name=cost]', '2500'); page.fill('[name=stock]', '40')
    page.click('.ft .btn.gold'); page.wait_for_selector('#pl .name:has-text("Coca")')
    page.goto(BASE + '/#shift'); page.fill('[name=openCash]', '50000'); page.click('#of button'); page.wait_for_selector('.tile')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    page.evaluate("App.prefetch()"); page.wait_for_timeout(2500)
    keys = page.evaluate("JSON.parse(localStorage.getItem('saado_ckeys')||'[]').length"); assert keys >= 6, keys; ok(f'pre-loaded {keys} screens in the background')

    ctx.set_offline(True); page.evaluate("window.dispatchEvent(new Event('offline'))")
    for route, sel in [('home', '#dash .stat'), ('reports', '#rep .card h3'), ('shift', '#live table'), ('refunds', '#hist'), ('users', '#ul .li'), ('purchasing', '#pbody .stats'),
                       ('expenses', '#el .list'), ('products', '#pl .li'), ('sell', '.tile'), ('customers', '#cl'), ('settings', '#f'), ('guide', '.guide h4'), ('audit', '#al .li'), ('more', '.list .li')]:
        page.goto(BASE + '/#' + route); page.wait_for_selector(sel, timeout=3000); page.wait_for_timeout(250)
        assert page.locator('.skel').count() == 0, route + ': placeholder shown offline'
        assert page.locator('.toast.err').count() == 0, route + ': error shown'
        assert 'ready after it opens once' not in page.inner_text('#main'), route + ': not cached'
    page.screenshot(path='/tmp/shots/30-offline-more.png'); ok('OFFLINE: all 14 tabs open instantly with saved data, no loading, no errors')

    page.goto(BASE + '/#reports'); page.wait_for_selector('#rep .card h3'); page.screenshot(path='/tmp/shots/31-offline-reports.png')
    page.reload(); page.wait_for_selector('#nav:not(.hidden)', timeout=5000); ok('OFFLINE: app re-opens from the phone (service worker)')
    page.evaluate("const s = JSON.parse(localStorage.getItem('saado_session')); s.expires = 1; localStorage.setItem('saado_session', JSON.stringify(s))")
    page.reload(); page.wait_for_selector('#nav:not(.hidden)', timeout=5000); ok('OFFLINE: still works after the 6-hour session ran out')

    page.evaluate("localStorage.removeItem('saado_session')"); page.reload(); page.wait_for_selector('#dd')
    page.click('#dd'); page.click('.ddlist button:has-text("Hussein")')
    for d in '0000': page.click(f'.pad button[data-k="{d}"]')
    page.click('.pad button.go'); page.wait_for_selector('#lgerr:has-text("PIN")'); ok('OFFLINE: wrong PIN refused on the phone')
    for d in pins['Hussein']: page.click(f'.pad button[data-k="{d}"]')
    page.click('.pad button.go'); page.wait_for_selector('#nav:not(.hidden)'); ok('OFFLINE: log in with PIN checked on the phone')
    page.goto(BASE + '/#sell'); page.click('.tile:has-text("Coca")'); page.click('#payBtn'); page.click('.ov .ft .btn.gold'); page.wait_for_selector('.toast.ok')
    assert page.evaluate("JSON.parse(localStorage.getItem('saado_queue')||'[]').length") == 1; ok('OFFLINE: sale saved on the phone')
    page.screenshot(path='/tmp/shots/32-offline-sell.png')
    ctx.set_offline(False); page.evaluate("window.dispatchEvent(new Event('online'))")
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=10000)
    assert len(sheet('Sales')) == 1; ok('internet back: sale sent to the Sheet')
    page.goto(BASE + '/#home'); page.wait_for_selector('#dash .stat'); page.wait_for_timeout(2500)
    assert '3,000' in page.inner_text('#herokpi'), page.inner_text('#herokpi'); ok('home updated quietly with the new sale')
    b.close()
print('errors:', errors or 'none'); print(n[0], 'steps passed'); sys.exit(1 if errors else 0)
