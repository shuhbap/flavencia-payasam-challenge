# Payasam Challenge (Firebase)
Static frontend (Firebase Hosting) + Cloud Functions (every write) + Firestore (live data). Passwords live only in Firebase Auth (team login = hash of team name used as a synthetic email).

## Setup
1. Create a project at console.firebase.google.com and upgrade to **Blaze** (required for Functions).
2. **Authentication** > enable **Email/Password**. **Firestore Database** > create in production mode, location `asia-south1` (Mumbai).
3. Project settings > Your apps > add a **Web app**; paste its config into `public/firebase-config.js`.
4. `npm i -g firebase-tools && firebase login && firebase use --add`
5. `cd functions && npm install && cd ..`
6. `firebase deploy` (rules, functions, hosting).
7. Create the admin: Authentication > Add user (email + password). Download a service-account key (Project settings > Service accounts) to a safe place **outside the repo**, then:
   `cd functions && GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node setAdmin.js you@example.com`
8. Open `/admin.html`, log in, save **price per litre**, UPI ID and payee name, then tick *Enable UPI*.
9. Place a test order to initialise the public leaderboard document.

## How it works
- Browsers cannot write to Firestore (rules block it). Prices, totals, balances and statuses are computed in Cloud Functions.
- Orders never auto-pay. Only an admin records **verified** payments (cash or UPI) after checking cash in hand or the bank app. A static UPI QR cannot self-verify; automatic verification needs a payment gateway with webhooks.
- Cancelling an order that has verified payments requires an explicit refund, stored as a negative payment record.
- Rankings count non-cancelled orders; Sales = order total value. Tie-break: litres, orders, name.
- Public leaderboard/stats come from one document (`public/board`) rebuilt by triggers, which keeps reads low.

## Test checklist
Register (member fields = count) · logout/login · edit/add/remove member (old orders stay) · order with empty C/O · UPI shows QR and QR changes with litres · disabling UPI hides it · order stays Pending · partial payment gives Partially Paid · remainder gives Paid · status change keeps payments · cancel with refund removes order from rankings · another team's data unreadable · CSV exports · mobile layout.

No `.env` is needed: Firebase web config is public. Never commit service-account keys.
