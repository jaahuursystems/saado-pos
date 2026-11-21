"""
End-to-end test in a real headless Chrome on a phone-sized screen, against tests/server.js.
Covers: login, products, a sale online, a sale OFFLINE then sync (no duplicates), credit customer + payment,
shift start/end, refund request + owner approval, reports, ingredients, users, settings, language switch.
Run: node tests/server.js 8787 &  then  python3 tests/e2e.py
"""
import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = 'http://localhost:8787'
SHOTS = '/tmp/shots/'
pins = json.load(urllib.request.urlopen(BASE + '/__pins'))
TEST_NOW = time.strftime('%Y-%m-%d', time.gmtime(time.time() + 3 * 3600)) + 'T15:00:00Z'
urllib.request.urlopen(BASE + '/__time?t=' + TEST_NOW)  # today 18:00 in Hargeisa: both businesses open
sheet = lambda n, header=False: [r for r in json.load(urllib.request.urlopen(BASE + '/__sheet?name=' + n))[(0 if header else 1):] if r and r[0]]
errors, results = [], []

def step(name):
    results.append(name); print('  ok ', name, flush=True)

def login(page, name):
    page.goto(BASE + '/')
    page.wait_for_selector('#dd')
    page.click('#dd'); page.click(f'.ddlist button:has-text("{name}")')
    for d in pins[name]:
        page.click(f'.pad button[data-k="{d}"]')
    page.click('.pad button.go')
    page.wait_for_selector('#nav:not(.hidden)', timeout=8000)

def logout(page):
    page.evaluate("localStorage.removeItem('saado_session')")

def toast_has(page, text):
    page.wait_for_selector(f'.toast:has-text("{text}")', timeout=6000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 393, 'height': 851}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    # the phone's clock = the server's test clock (18:00 in Hargeisa), so the test works at any real time of day
    page.clock.install(time=TEST_NOW)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text else None)

    # ---------- owner sets up ----------
    page.goto(BASE + '/'); page.wait_for_selector('#dd'); page.wait_for_timeout(400)
    page.screenshot(path=SHOTS + '01-login.png')
    page.click('#dd'); page.wait_for_selector('.ddlist button'); page.screenshot(path=SHOTS + '01b-login-dd.png')
    names = page.locator('.ddlist button').all_inner_texts(); assert names == ['Hussein', 'Raxma', 'Sacad'], names
    step('login: name dropdown (Hussein, Raxma, Sacad — no Zakariye)')
    page.click('.ddlist button:has-text("Hussein")')
    for d in '0000': page.click(f'.pad button[data-k="{d}"]')
    page.click('.pad button.go'); page.wait_for_selector('#lgerr:has-text("PIN")'); step('wrong PIN is refused with a clear message')
    login(page, 'Hussein'); page.wait_for_selector('#herokpi .kpi'); page.wait_for_timeout(600)
    page.screenshot(path=SHOTS + '02-home.png'); step('owner logs in to dashboard')

    page.click('#nav [data-r="more"]'); page.wait_for_selector('.list [data-r="products"]')
    assert page.locator('[data-r="export"]').count() == 0; page.screenshot(path=SHOTS + '02b-more.png'); step('More menu has no Export')
    page.click('.list [data-r="products"]')
    for name, code, price, cost, stock in [('Coca-Cola 330ml', '5449000000996', '3200', '2500', '48'), ('Bariis 5kg', '6001234567890', '52000', '45000', '4'), ('Colgate 100ml', '8714789', '4500', '3500', '12')]:
        page.click('.fab'); page.fill('[name=name]', name); page.fill('[name=barcode]', code); page.fill('[name=price]', price); page.fill('[name=cost]', cost); page.fill('[name=stock]', stock)
        page.click('.ft .btn.gold'); page.wait_for_selector(f'#pl .name:has-text("{name}")'); page.wait_for_selector('.ov', state='detached')
    page.screenshot(path=SHOTS + '03-products.png'); step('owner adds 3 shop products')
    # cigarettes sold loose: 20 pieces in a packet, 1 = 1,000 · 2 = 2,000 · 3 = 2,500
    page.click('.fab'); page.fill('[name=name]', 'Beensal'); page.fill('[name=price]', '16000'); page.fill('[name=cost]', '14000')
    assert page.locator('#lzb .ptab').count() == 0
    page.click('.lzcard input.sw'); page.wait_for_selector('#lzt tr[data-i="0"]')
    page.fill('#lzt tr[data-i="0"] [data-k=p]', '1000')
    for i, (q, pr) in enumerate([('2', '2000'), ('3', '2500')], start=1):
        page.click('#lzadd'); page.fill(f'#lzt tr[data-i="{i}"] [data-k=q]', q); page.fill(f'#lzt tr[data-i="{i}"] [data-k=p]', pr)
    page.fill('[name=stockPk]', '4'); page.fill('[name=stockPc]', '7'); page.fill('[name=lowStock]', '1')
    page.locator('#lzt').click(position={'x': 5, 'y': 5}); page.wait_for_timeout(150)
    page.screenshot(path=SHOTS + '03b-loose-form.png', full_page=True)
    page.click('.ft .btn.gold'); page.wait_for_selector('#pl .name:has-text("Beensal")'); page.wait_for_selector('.ov', state='detached')
    row = [r for r in sheet('Products') if 'Beensal' in r][0]; hdr = sheet('Products', header=True)[0]
    P = dict(zip(hdr, row)); assert P['loose'] in ('1', 1) and str(P['perPack']) == '20' and str(P['stock']) == '87' and json.loads(P['looseTable']) == [[1, 1000], [2, 2000], [3, 2500]], P
    assert '4 baakad + 7 xabbo' in page.inner_text('#pl'), page.inner_text('#pl'); step('owner switches on "sell loose" for Beensal (20 pcs, price list, stock 4 pk + 7 pcs)')
    page.click('.bizswitch button[data-b="food"]'); page.wait_for_timeout(300)
    page.goto(BASE + '/#products'); page.wait_for_selector('.fab')
    for name, price, cost in [('Digaag buuxa', '60000', '35000'), ('Chips', '15000', '6000'), ('Shawarma', '25000', '12000')]:
        page.click('.fab'); page.fill('[name=name]', name); page.fill('[name=price]', price); page.fill('[name=cost]', cost)
        page.click('.ft .btn.gold'); page.wait_for_selector(f'#pl .name:has-text("{name}")'); page.wait_for_selector('.ov', state='detached')
    step('owner adds 3 fast food menu items')
    page.click('.bizswitch button[data-b="shop"]')

    page.goto(BASE + '/#users'); page.wait_for_selector('#ul .li')
    page.wait_for_selector('.fab'); page.click('.fab'); page.fill('[name=name]', 'Hodan'); page.click('.ft .btn.gold')
    page.wait_for_selector('.sheet:has-text("Hodan") .t'); new_pin = page.inner_text('.sheet .t').strip()
    assert len(new_pin) == 4, new_pin
    page.screenshot(path=SHOTS + '04-newpin.png'); page.click('.ft .btn.primary'); step('owner creates a user and sees the new PIN once')

    page.goto(BASE + '/#settings'); page.wait_for_selector('[name=usdRate]')
    assert page.locator('[name=ownerWhatsApp]').count() == 0
    page.select_option('[name=emailDailyTime]', '08:00'); page.select_option('[name=weeklyDay]', 'Sat'); page.select_option('[name=monthlyWhen]', 'first')
    page.select_option('#lsm', 'daily'); assert page.is_visible('[name=lowStockTime]'); page.select_option('[name=lowStockTime]', '07:30')
    page.fill('#otn', 'Delivery'); page.click('#ota')
    page.screenshot(path=SHOTS + '05b-email-times.png', full_page=True)
    page.click('#f button.gold.lg'); page.wait_for_selector('.toast.ok')
    st = {r[0]: r[1] for r in sheet('Settings')}
    assert st['emailDailyTime'] == '08:00' and st['weeklyDay'] == 'Sat' and st['monthlyWhen'] == 'first' and st['lowStockMode'] == 'daily' and st['lowStockTime'] == '07:30' and st['lowStockEmail'] == '1', st
    step('owner saves settings: email times (daily 08:00, weekly Sat, monthly 1st, low stock once a day 07:30) + order type')
    logout(page)

    # ---------- Raxma, shop employee ----------
    # login button shows a clear wait state and ignores extra taps
    urllib.request.urlopen(BASE + '/__delay?ms=1500')
    page.goto(BASE + '/'); page.wait_for_selector('#dd'); page.click('#dd'); page.click('.ddlist button:has-text("Raxma")')
    for d in pins['Raxma']: page.click(f'.pad button[data-k="{d}"]')
    page.click('.pad button.go'); page.wait_for_selector('.pad.busy .go .spin'); page.wait_for_selector('.lgwait')
    page.screenshot(path=SHOTS + '00-login-wait.png')
    page.click('.pad button.go', force=True)
    page.wait_for_selector('#nav:not(.hidden)', timeout=8000); urllib.request.urlopen(BASE + '/__delay?ms=0')
    step('login: Enter button spins, keypad locked, "please wait" shown, double tap ignored')
    page.wait_for_selector('#q')
    assert page.locator('.bizswitch').count() == 0
    assert page.locator('#goShift').count() == 1; step('employee sees only her business and is asked to start a shift')
    page.click('#goShift'); page.fill('[name=openCash]', '100000'); page.fill('[name=openZaadSH]', '20000'); page.click('#of button')
    page.wait_for_selector('#q'); page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000); step('shift started')

    page.click('.tile:has-text("Coca-Cola")'); page.click('.tile:has-text("Coca-Cola")'); page.click('.tile:has-text("Bariis")')
    page.wait_for_selector('.cartbar'); assert '58,500' in page.inner_text('.cartbar .sum'), page.inner_text('.cartbar .sum')
    page.screenshot(path=SHOTS + '05-cart.png'); step('tap tiles: 2 cola + rice = 58,400 → rounded 58,500')
    page.click('#payBtn'); page.wait_for_selector('#tend')
    page.click('#cur button[data-v="USD"]'); page.click('#quick .chip:has-text("$5")')
    assert '750' in page.inner_text('#chg'), page.inner_text('#chg')   # 5*11850-58500 = 750 → "Baaqi: 750 SH"
    page.screenshot(path=SHOTS + '06-pay.png')
    page.click('.ft .btn.gold'); page.wait_for_selector('.toast.ok'); step('cash sale paid in USD, change shown in SH')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    assert len(sheet('Sales')) == 1; step('sale reached the Sheet')

    # barcode typed / USB scanner: type code + Enter adds item
    page.fill('#q', '8714789'); page.press('#q', 'Enter'); page.wait_for_selector('.cartbar'); step('typed barcode + Enter adds item (USB scanner / manual)')
    assert page.locator('.tile .s').count() > 0; step('sell screen shows stock on tiles')
    page.click('#clrBtn'); page.wait_for_selector('.cartbar', state='hidden'); page.click('.toast .tact'); page.wait_for_selector('.cartbar'); step('clear cart (✕) + Undo brings it back')

    # ---------- offline sale ----------
    ctx.set_offline(True); page.evaluate("window.dispatchEvent(new Event('offline'))")
    page.click('#payBtn'); page.click('[data-name=method] button[data-v="zaad"]'); page.wait_for_selector('.acct:has-text("436908")')
    page.screenshot(path=SHOTS + '07-zaad.png')
    page.click('.ft .btn.gold'); page.wait_for_selector('.toast.ok')
    page.wait_for_timeout(500)
    q = page.evaluate("JSON.parse(localStorage.getItem('saado_queue')||'[]').length"); assert q == 1, q
    page.screenshot(path=SHOTS + '08-offline.png'); step('OFFLINE: Zaad sale saved on the phone (shows account 436908)')
    ctx.set_offline(False); page.evaluate("window.dispatchEvent(new Event('online'))")
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=10000)
    assert len(sheet('Sales')) == 2; step('back online: offline sale synced automatically')
    # resend the same sale id → must not duplicate
    page.evaluate("""() => { const s = JSON.parse(localStorage.getItem('saado_data_' + App.S.user.id)); }""")
    r = page.evaluate("""async () => { const r = await App.api('sync', {ops:[{qid:'x', action:'sale.create', data:{id: App.S.lastSale.id, business:'shop', method:'zaad', items: App.S.lastSale.items}}]}); return r.results[0].result.dup }""")
    assert r is True and len(sheet('Sales')) == 2; step('retrying the same sale does not create a duplicate')

    # ---------- credit customer ----------
    page.click('.tile:has-text("Bariis")'); page.click('#payBtn'); page.click('[data-name=method] button[data-v="credit"]')
    page.click('#newc'); page.fill('.ov:last-child [name=name]', 'Cali Xasan'); page.fill('.ov:last-child [name=phone]', '0634000001'); page.click('.ov:last-child .ft .btn.gold')
    page.wait_for_selector('#clist .li:has-text("Cali")'); page.click('.ov .ft .btn.gold'); page.wait_for_selector('.toast.ok')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    cust = sheet('Customers'); assert cust[0][4] in (52000, '52000'), cust; step('new customer created from the pay screen + credit sale (balance 52,000)')
    page.click('#nav [data-r="customers"]'); page.click('#cl .li'); page.click('#pay')
    page.fill('[name=amount]', '20000'); page.click('.ft .btn.gold'); page.wait_for_selector('.toast.ok')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    assert sheet('Customers')[0][4] in (32000, '32000'); page.screenshot(path=SHOTS + '09-customers.png'); step('partial debt payment (balance 32,000)')

    # expense
    page.goto(BASE + '/#expenses'); page.wait_for_selector('#ecat')
    page.click('#f button.gold'); page.wait_for_selector('.toast.err:has-text("Dooro nooca")')   # no category chosen
    page.select_option('#ecat', 'Deliveries'); page.fill('[name=amount]', '5000'); page.fill('[name=description]', 'Gaarsiinta bariiska'); page.click('#f button.gold')
    page.wait_for_selector('.toast.ok'); step('cash expense recorded (category from the dropdown + explanation)')
    page.select_option('#ecat', 'Other'); page.click('#ecur button[data-v="USD"]'); page.fill('[name=amount]', '2'); page.click('#f button.gold')
    page.wait_for_selector('.toast.err'); assert page.input_value('[name=amount]') == '2'   # "Other" needs an explanation
    page.fill('[name=description]', 'Bajaj'); page.fill('[name=note]', 'test'); page.click('#f button.gold'); page.wait_for_selector('.toast.ok')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    page.goto(BASE + '/#more'); page.goto(BASE + '/#expenses'); page.wait_for_selector('#el .li:has-text("Bajaj") [data-undo]'); page.wait_for_timeout(300)
    page.screenshot(path=SHOTS + '09b-expenses.png', full_page=True)
    page.click('#el .li:has-text("Bajaj") [data-undo]'); page.click('#rs .chip[data-r="Entered twice"]'); page.click('.ov .ft .btn.red'); page.wait_for_selector('.toast.ok')
    ex = [r for r in sheet('Expenses') if 'Bajaj' in r]; assert ex and 'undone' in ex[0] and 'USD' in ex[0], ex
    page.wait_for_selector('#el .li.gone:has-text("Bajaj")'); step('$2 expense saved in USD, then undone the same day (kept, marked undone)')

    # ---------- refund request ----------
    page.goto(BASE + '/#refunds'); page.click('#req'); page.wait_for_selector('#sl .li')
    page.click('#sl .li:has-text("Bariis")'); page.fill('[name=reason]', 'Kiishku wuu jeexnaa')
    page.click('.ft .btn.gold'); page.wait_for_selector('.toast.ok'); step('employee requests a refund with a reason')
    perm = page.evaluate("""async () => { try { await App.api('refund.decide', {id: 'x', approve: true}); return 'allowed' } catch (e) { return e.message } }""")
    assert 'permission' in perm.lower() or 'oggolaansho' in perm.lower(), perm; step('employee cannot approve refunds')

    # ---------- selling loose pieces ----------
    page.goto(BASE + '/#sell'); page.wait_for_selector('.tile:has-text("Beensal") .lz')
    page.click('.tile:has-text("Beensal")'); page.wait_for_selector('.qgrid'); page.click('.qb[data-n="3"]')
    assert '2,500' in page.inner_text('#lzt'); page.fill('#lzn', '9'); assert '7,500' in page.inner_text('#lzt'), page.inner_text('#lzt')   # 9 = 3+3+3 from this short list
    page.click('.qb[data-n="3"]'); page.screenshot(path=SHOTS + '05c-loose-pick.png'); page.click('.ov .ft .btn.gold'); page.wait_for_selector('.ov', state='detached')
    page.click('.tile:has-text("Beensal")'); page.click('#pkBtn'); page.wait_for_selector('.ov', state='detached')
    assert '18,500' in page.inner_text('.cartbar'), page.inner_text('.cartbar')
    page.click('#openCart'); page.wait_for_selector('#cl .lz'); page.screenshot(path=SHOTS + '05d-loose-cart.png'); page.click('.ov .ft .btn.gold')
    page.wait_for_selector('#tend'); page.click('[data-name=method] button[data-v="zaad"]'); page.click('.ov .ft .btn.gold'); page.wait_for_selector('.toast.ok')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    items = sheet('SaleItems')[-2:]; assert items[0][-1] == 'pc' and str(items[0][5]) == '3' and str(items[0][8]) == '2500' and items[1][-1] == '', items
    P = dict(zip(sheet('Products', header=True)[0], [r for r in sheet('Products') if 'Beensal' in r][0])); assert str(P['stock']) == '64', P['stock']
    step('sold 3 loose pieces (2,500) + 1 packet (16,000); stock 87 → 64 pieces')
    # ---------- undo a sale in my shift ----------
    page.goto(BASE + '/#sell'); page.click('.tile:has-text("Coca-Cola")'); page.click('#payBtn'); page.wait_for_selector('#tend'); page.click('.ft .btn.gold'); page.wait_for_selector('.toast.ok')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    page.goto(BASE + '/#shift'); page.wait_for_selector('#mysales [data-undo]')
    page.click('#mysales [data-undo] >> nth=0'); page.click('#rs .chip[data-r="Wrong item"]'); page.click('.ov .ft .btn.red'); page.wait_for_selector('.toast.ok')
    rows = sheet('Sales'); assert any('undone' in [str(c) for c in r] for r in rows), rows; step('staff undoes a sale in her own shift (kept as "undone")')
    # ---------- cash out ----------
    page.click('#co'); page.fill('.sheet [name=amt]', '10000'); page.click('#why .chip[data-r="Bank / Zaad deposit"]'); page.click('.ov .ft .btn.gold'); page.wait_for_selector('.toast.ok')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    assert len(sheet('CashMoves')) == 1; step('cash taken out of the drawer (10,000 SH)')
    # ---------- end shift ----------
    page.goto(BASE + '/#sell'); page.wait_for_timeout(2500)
    reqs = []
    page.on('request', lambda r: reqs.append(json.loads(r.post_data or '{}').get('action')) if '/exec' in r.url else None)
    page.goto(BASE + '/#shift'); page.wait_for_selector('#cmp input[name=closeCash]'); page.wait_for_timeout(1500)
    acts = [a for a in reqs if a not in ('sync',)]
    assert acts.count('shift.live') == 1 and 'sales.list' not in acts and 'shift.preview' not in acts, acts; step('shift tab opens at once with ONE server request (%s)' % ','.join(acts))
    page.fill('#cmp [name=closeCash]', '1'); page.focus('#cmp [name=closeCash]')
    page.evaluate("App.syncNow && window.Screens.onSync()"); page.wait_for_timeout(800)
    assert page.evaluate("document.activeElement && document.activeElement.name") == 'closeCash' and page.input_value('#cmp [name=closeCash]') == '1'; step('fresh numbers arrive without interrupting typing')
    page.fill('#cmp [name=closeCash]', '')
    # expected cash SH = 100000 - 750 change + 20000 debt paid - 5000 expense - 10000 cash out = 104,250 ; USD = $5
    exp = page.inner_text('#expNow'); assert '104,250' in exp and '$5' in exp, exp
    page.screenshot(path=SHOTS + '10-shift.png', full_page=True)
    for n in ['closeCash', 'closeZaadSH', 'closeEdSH', 'closeCashUSD', 'closeZaadUSD', 'closeEdUSD']:
        e = page.get_attribute(f'#cmp [name={n}]', 'data-exp'); v = float(e) - (500 if n == 'closeCash' else 0)
        page.fill(f'#cmp [name={n}]', ('%g' % v))
    assert page.locator('#cmp .tick.bad').count() >= 1
    page.click('#endBtn'); page.click('.ov .ft .btn.red'); page.wait_for_selector('.sheet .pill.red')
    page.screenshot(path=SHOTS + '11-shift-end.png'); step('shift ended: SH + USD per account, 500 short in cash')
    sh = sheet('Shifts'); assert any('-500' in [str(c) for c in r] for r in sh), sh
    page.click('.ov .ft .btn.primary')
    logout(page)

    # ---------- Sacad, fast food ----------
    login(page, 'Sacad'); page.wait_for_selector('#goShift'); page.click('#goShift'); page.click('#of button'); page.wait_for_selector('.tile')
    page.click('.tile:has-text("Digaag")'); page.click('.tile:has-text("Chips")'); page.click('#payBtn')
    page.wait_for_selector('#otype button:has-text("Delivery")'); page.click('#otype button[data-v="Delivery"]')
    assert page.locator('[data-name=method] button[data-v="credit"]').count() == 0
    page.wait_for_selector('#pt:has-text("75,000")'); page.click('.ft .btn.gold'); page.wait_for_selector('.toast.ok')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    assert sheet('Sales')[-1][8] == 'Delivery'; step('fast food sale with order type, no credit option')
    page.goto(BASE + '/#ingredients'); page.click('#add'); page.fill('.sheet input[data-id] >> nth=0', '25'); page.click('.ft .btn.gold')
    page.click('#use'); page.fill('.sheet input[data-id] >> nth=0', '18'); page.click('.ft .btn.gold')
    page.wait_for_selector('.toast.warn'); page.wait_for_timeout(300); page.screenshot(path=SHOTS + '12-ingredients.png')
    page.wait_for_function("!JSON.parse(localStorage.getItem('saado_queue')||'[]').length", timeout=8000)
    step('ingredients: add 25 flour, use 18 → low warning (7 ≤ 10)')
    logout(page)

    # ---------- owner approves + reports ----------
    login(page, 'Hussein'); page.wait_for_selector('#herokpi .kpi'); page.wait_for_timeout(500)
    page.screenshot(path=SHOTS + '13-home-owner.png', full_page=True)
    page.goto(BASE + '/#refunds'); page.wait_for_selector('[data-act="1"]'); page.click('[data-act="1"]'); page.click('.ov .ft .btn.primary')
    page.wait_for_selector('.toast.ok'); assert sheet('Refunds')[0][10] == 'approved'; step('owner approves the refund')
    page.goto(BASE + '/#reports'); page.wait_for_selector('#rep .card h3'); page.wait_for_timeout(300)
    txt = page.inner_text('#rep'); assert 'Edahab' in txt
    page.screenshot(path=SHOTS + '14-reports.png', full_page=True); step('reports: combined Shop + Fast Food')
    page.goto(BASE + '/#more'); page.click('.list [data-r="lang"]'); page.wait_for_selector('#nav:has-text("Sell")')
    page.screenshot(path=SHOTS + '15-english.png'); step('language switch to English')
    # ---------- purchasing: new order on credit -> received -> paid ----------
    page.set_viewport_size({'width': 393, 'height': 851})
    page.goto(BASE + '/#purchasing'); page.wait_for_selector('.fab'); page.wait_for_timeout(300)
    page.click('.fab'); page.wait_for_selector('.sheet [name=name]')
    page.fill('.sheet [name=name]', 'Shirkada Cadaani'); page.fill('.sheet [name=phone]', '252634111111'); page.click('.ov .ft .btn.gold')
    page.wait_for_selector('#sp'); page.fill('#iq', 'Coca'); page.click('#ir .li'); page.fill('#il [data-k=qty]', '24'); page.fill('#il [data-k=cost]', '2400')
    page.wait_for_selector('#tot:has-text("57,600")'); page.screenshot(path=SHOTS + '17-po-new.png')
    page.click('.ov .ft .btn.ghost'); page.wait_for_selector('.sheet [data-a=receive]')
    page.wait_for_selector('.sheet .hd:has-text("SH-PO-0001")'); page.wait_for_timeout(300); page.screenshot(path=SHOTS + '18-po-sheet.png'); step('new purchase order on credit (draft), number SH-PO-0001')
    before = int(json.load(urllib.request.urlopen(BASE + '/__sheet?name=Products'))[1][7])
    page.click('.sheet [data-a=receive]'); page.wait_for_selector('.ov .ft .btn.gold:has-text("stock"), .ov .ft .btn.gold'); page.click('.ov .ft .btn.gold')
    page.wait_for_selector('.sheet .pill.green'); after = int(json.load(urllib.request.urlopen(BASE + '/__sheet?name=Products'))[1][7])
    assert after == before + 24, (before, after); step('goods received: stock +24')
    page.click('.sheet [data-a=pay]'); page.fill('[name=amount]', '20000'); page.click('.ov .ft .btn.gold'); page.wait_for_selector('.sheet:has-text("37,600")')
    sup = sheet('Suppliers'); assert sup[0][4] in (37600, '37600'), sup; step('part payment: we owe supplier 37,600')
    page.goto(BASE + '/#purchasing/suppliers'); page.wait_for_selector('#pbody .li'); page.wait_for_timeout(300); page.screenshot(path=SHOTS + '19-suppliers.png')
    page.goto(BASE + '/#purchasing'); page.wait_for_selector('#pf .chip[data-v=all]'); page.click('#pf .chip[data-v=all]'); page.wait_for_timeout(200); page.screenshot(path=SHOTS + '20-orders.png')
    # ---------- guide in-app, install button ----------
    page.goto(BASE + '/#guide'); page.wait_for_selector('.guide h4'); page.screenshot(path=SHOTS + '21-guide.png')
    page.click('#gt button[data-v=owner]'); page.wait_for_selector('.guide:has-text("Purchasing")'); step('guide is an in-app page (staff + owner)')
    page.goto(BASE + '/#settings'); page.click('#inst'); page.wait_for_selector('.sheet:has-text("Chrome")'); page.screenshot(path=SHOTS + '22-install.png'); page.click('.ov .ft .btn')
    step('settings: install-app button')
    page.goto(BASE + '/#stockcount'); page.wait_for_selector('#q'); page.fill('#q', 'Coca'); page.click('#res .li'); page.fill('[name=n]', '40'); page.click('.ov .ft .btn.gold')
    page.click('#sv'); page.wait_for_selector('.sheet:has-text("1 products corrected")'); step('stock count corrects stock')
    # ---------- v1.2 owner tools ----------
    page.goto(BASE + '/#insights'); page.wait_for_selector('.bars, .card h3'); page.wait_for_timeout(500); page.screenshot(path=SHOTS + '23-insights.png', full_page=True); step('insights page')
    page.goto(BASE + '/#home'); page.wait_for_selector('#herokpi .kpi'); page.wait_for_timeout(400); assert 'Raxma' in page.inner_text('#main'); assert page.locator('#wa').count() == 0 and 'WhatsApp' not in page.inner_text('#main'); page.screenshot(path=SHOTS + '24-home-v12.png', full_page=True); step('home shows shifts today / undone / cash out')
    page.goto(BASE + '/#settings'); page.wait_for_selector('#emc'); page.wait_for_timeout(300); page.screenshot(path=SHOTS + '25-settings.png', full_page=True)
    r = page.evaluate("""async () => { await App.api('recip.save', {name:'Hussein', email:'owner@example.com', daily:true, weekly:true, monthly:false}); const l = await App.api('recip.list', {}); await App.api('recip.test', {id: l.recipients[0].id}); return l.recipients.length }""")
    assert r == 1; step('email recipient added + test email sent')
    page.goto(BASE + '/#settings'); page.wait_for_selector('#dz'); page.click('#dz .btn'); page.wait_for_selector('.sheet .chk'); page.wait_for_timeout(200); page.screenshot(path=SHOTS + '26-reset.png'); page.click('.ov .ft .btn.ghost'); step('reset sheet opens with checkboxes')
    page.goto(BASE + '/#settings'); page.wait_for_selector('#arc'); page.click('#arc .btn'); page.wait_for_selector('.sheet'); page.wait_for_timeout(500); page.screenshot(path=SHOTS + '27-archive.png'); page.click('.ov .ft .btn.ghost'); step('archive sheet opens')
    page.evaluate("""async () => { await App.api('settings.save', {values:{food_enabled:'0'}}) }""")
    names = page.evaluate("""async () => (await App.api('names', {})).users.map(u => u.name)""")
    assert 'Sacad' not in names, names
    err = page.evaluate("""async () => { try { const id = JSON.parse(localStorage.getItem('saado_names')).find(u => u.name === 'Sacad').id; await App.api('login', {userId:id, pin:'%s'}); return 'ok' } catch (e) { return e.message } }""" % ''.join(pins['Sacad']))
    assert 'closed' in err.lower(), err
    page.evaluate("""async () => { await App.api('settings.save', {values:{food_enabled:'1'}}) }"""); step('Fast Food switched off: Sacad hidden and blocked; switched back on')
    page.set_viewport_size({'width': 1280, 'height': 900}); page.goto(BASE + '/#home'); page.wait_for_selector('#herokpi .kpi'); page.wait_for_timeout(400)
    page.screenshot(path=SHOTS + '16-laptop.png'); step('laptop layout')
    # ---------- log out while slow requests are still running: clear wait screen, no "session ended" message ----------
    page.set_viewport_size({'width': 393, 'height': 851})
    urllib.request.urlopen(BASE + '/__delay?ms=2000')
    page.goto(BASE + '/#more'); page.wait_for_selector('.list [data-r="logout"]')
    page.evaluate("App.prefetch(); App.refresh(true)")
    page.wait_for_timeout(200); page.click('.list [data-r="logout"]'); page.wait_for_selector('.busyov .spin'); page.screenshot(path=SHOTS + '28-logout.png')
    page.wait_for_selector('#pad'); page.wait_for_timeout(4500)
    assert page.locator('.toast').count() == 0, page.inner_text('#toasts'); assert page.locator('#pad').count() == 1
    assert page.evaluate("localStorage.getItem('saado_session')") is None
    urllib.request.urlopen(BASE + '/__delay?ms=0')
    step('log out: "Logging out…" screen, then login; late answers are ignored (no "session ended")')
    login(page, 'Hussein'); page.wait_for_selector('#nav:not(.hidden)'); page.wait_for_timeout(500); assert page.locator('.toast.warn').count() == 0
    step('log back in straight away works')

    b.close()

bad = [e for e in errors if 'Failed to fetch' not in e and 'ERR_INTERNET_DISCONNECTED' not in e and 'ERR_TUNNEL_CONNECTION_FAILED' not in e]
print('console errors:', bad if bad else 'none')
print(len(results), 'steps passed')
sys.exit(1 if bad else 0)
