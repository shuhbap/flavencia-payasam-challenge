# Payasam Challenge

Team registration, team login, order and payment tracking, a live homepage leaderboard and a secure admin panel.
Frontend: HTML/CSS/JS (`Index.html`). Backend: Google Apps Script (`Code.gs`). Database: Google Sheets. Free to host.

## Setup (about 10 minutes)
1. Create a new Google Sheet (sheets.google.com).
2. Open **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with the supplied `Code.gs`.
4. Click **+ → HTML**, name it exactly `Index`, and paste the supplied `Index.html`.
5. (Optional) Project Settings → "Show appsscript.json" and paste the supplied `appsscript.json` to set your time zone.
6. Select `setupApp` in the function dropdown and click **Run**. Approve the permissions. It creates the `Teams`, `Orders` and `Settings` sheets and a private random secret.
7. **Project Settings → Script Properties**, edit:
   - `ADMIN_ID` – your admin login ID
   - `ADMIN_PASSWORD` – a strong password
   - `PRICE_PER_LITRE` – starting price (admins can change it later in the admin panel; the Settings sheet is then the source of truth)
8. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone** (so participants without Google accounts can use it).
9. Open the Web app URL. Admin panel: `YOUR_DEPLOYED_URL?page=admin` (not linked anywhere on the site).
10. After editing code later, use **Deploy → Manage deployments → Edit → New version** so changes go live.

## How it works
| Area | Approach |
|---|---|
| Passwords | Random salt + server-side secret, 200 rounds of SHA-256, stored as `salt$hash`. Never shown or returned. |
| Sessions | Random 3×UUID token; only its SHA-256 is stored in server-side CacheService; 6-hour expiry; checked on every private call; logout deletes it. |
| Admin | `ADMIN_ID` and `ADMIN_PASSWORD` live in Script Properties and both are verified server-side. Admin login refuses to work while they are still `CHANGE_ME`. |
| Rate limits | 5 failed logins per team (or admin) locks login for 10 minutes; registrations and individual orders are throttled. |
| Concurrency | `LockService` wraps every write. |
| Duplicate submits | Each form carries a request ID; a repeat returns the original order instead of creating a second one. |
| Money | Total = litres × price, computed on the server. The price is stored with each order, so later price changes never alter old orders. Received cannot exceed total; status changes never touch payment. |
| Rankings | Cancelled orders and deactivated teams are excluded. Tie-break: chosen metric → orders → litres → sales → earliest registration → name. |
| Privacy | Public endpoints return only team names and aggregate numbers. Phones and order records are only returned to the owning team (session-verified) or the admin. |
| Sheet safety | Text columns use plain-text format; input strips control chars and `<>`; the UI escapes all output; CSV export neutralises formula-leading cells. |

Notes: sessions live in CacheService, so Google may occasionally evict one early (the user simply logs in again). A person who repeatedly guesses a team's name with wrong passwords can temporarily lock that team's login; this is the trade-off of per-team throttling.

## Testing checklist
- [ ] Register a team; registering the same name (any letter case) is rejected.
- [ ] Mismatched passwords, short passwords and blank fields show clear errors.
- [ ] Log in, log out; a wrong password 5 times locks login for 10 minutes.
- [ ] Teams sheet shows `salt$hash`, never the plain password.
- [ ] Quick order: total = litres × price; balance = total − received; Pending forces received to 0; received > total is rejected.
- [ ] Double-click Save: only one row is added.
- [ ] Individual order for a team; confirmation shows the Order ID; team sees it in its dashboard.
- [ ] Change status to Confirmed/Delivered: received amount is unchanged. Cancel: the order leaves all stats and rankings.
- [ ] Admin changes the price: old orders keep their price; new orders use the new one.
- [ ] Homepage stats match the Orders sheet (excluding Cancelled).
- [ ] All three ranking tabs work; podium and table update within 30 seconds or after a reload of data.
- [ ] Set the default ranking in Admin → Overview and reload the homepage.
- [ ] Wrong admin ID with right password (and the reverse) is rejected; `?page=admin` is the only admin entry.
- [ ] Admin: team search, activate/deactivate, order filters/search/edit, all 9 reports, CSV export opens correctly in Excel/Sheets.
- [ ] Test on a phone: layout, forms, tables scroll, podium stacks.

## Files
`Code.gs` backend · `Index.html` frontend · `appsscript.json` optional manifest · `README.md` this guide
