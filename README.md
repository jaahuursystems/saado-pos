# Saado POS

Point of sale and shop management for **Saado Shop** and **Saado Fast Food** (Hargeisa).
A phone app (PWA on GitHub Pages) that saves to a private Google Sheet through one Google Apps Script file.

| Part | Where |
|---|---|
| App (what staff open) | `https://jaahuursystems.github.io/saado-pos/` |
| Database | Google Sheet **Saado POS** (private, in the owner's Drive) |
| Backend | `apps-script/Code.gs` — the only backend file, pasted into the Sheet's Apps Script |
| Script address | `config.js` → `API_URL` |

## Files
| File | What it does |
|---|---|
| `index.html` | The page; loads the files below |
| `config.js` | The Apps Script `/exec` address. Kept alone so updates never overwrite it |
| `app.js` | Core: login, server calls, offline queue, scanner, PDF/CSV/Excel tools |
| `screens.js` | All screens (Sell, Shift, Customers, Reports, Products, Purchasing, Users, Settings…) |
| `i18n.js` | Somali text for every English text |
| `app.css` | Design system: native-app look, Inter font, navy `#003366` + gold `#FFBF00` |
| `sw.js` | Offline support. **Raise `VERSION` on every release** |
| `guide.js` | Owner guide + one-page staff guide (Somali / English), shown in the app under More → Guide |
| `apps-script/Code.gs` | Whole backend: `setup()`, login, sales, shifts, reports, backups |
| `tests/` | Automatic tests (not used by phones) |

## First-time setup (owner)
1. Open the Google Sheet **Saado POS** → **Extensions → Apps Script**.
2. Delete everything in `Code.gs`, paste the whole of `apps-script/Code.gs`, press **Save** (💾).
3. In the function list at the top choose **setup**, press **Run**, and allow access (Advanced → Go to project → Allow).
4. **Deploy → New deployment →** ⚙️ **Web app**. *Execute as:* **Me**. *Who has access:* **Anyone**. **Deploy**. Copy the **Web app URL** (ends with `/exec`).
5. Put that URL in `config.js` on GitHub (`API_URL: '…/exec'`).

## Purchasing
Purchase orders go **Draft → Sent to supplier → Received** (or Cancelled). Stock goes up only when an order is marked received.
Pay now, part now, or on credit; every payment is also an expense. Orders are shared as a PDF on WhatsApp. Supplier balance = goods received − payments.

## Updating the app later
* **App (screens, text):** edit the file on GitHub, then raise `VERSION` in `sw.js` (e.g. `saado-v1.0.1`). Phones get it the next time the app is opened.
* **Backend (`Code.gs`):** paste the new code into Apps Script, Save, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
  Never make a *new deployment* — that changes the address. If you ever do, paste the new address into `config.js`.
* New tabs/columns: run `setup()` again (safe to repeat).

## Backups
* Automatic: every night 03:00 (Hargeisa) a copy goes to Drive folder **Saado POS Backups** (last 30 days + 1st of each month for 24 months).
* By hand: in the app **Settings → Back up now**, or in the Sheet menu **Saado POS → Back up now**, or **File → Make a copy**.
* Restore: open the backup copy, open its Apps Script, deploy it, and put its address in `config.js` (or copy the tabs back into the main Sheet).

## Security
* Every action except the list of names needs a login token (6 hours). PINs are stored only as salted SHA-256 hashes.
* 5 wrong PINs lock an account for 5 minutes. Employees are limited to their business, their permissions and (unless allowed) their working hours.
* The server recalculates every price from the Sheet; prices sent by a phone are ignored. Every sale has a unique id, so retries never duplicate.
* No PINs, tokens or Sheet IDs are in this repository.
* Lost all owner PINs: in the Sheet menu **Saado POS → Reset an owner PIN**.

## Tests
`node tests/backend.test.js` (backend rules), `sh tests/run-e2e.sh` (real browser, phone screen, sales, shift, refund, purchasing…) and `python3 tests/offline.py` with `node tests/server.js 8787` running (every tab offline, offline login, re-open offline).


