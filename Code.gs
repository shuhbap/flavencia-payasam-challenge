/**
 * PAYASAM CHALLENGE - Code.gs (Google Apps Script backend)
 * Database: Google Sheets | Sessions: CacheService (hashed tokens) | Secrets: Script Properties
 */
const T_HEAD = ['Team ID','Team Name','Member Count','Password Hash','Created At','Team Status'];
const O_HEAD = ['Order ID','Team ID','Team Name','Customer Name','Phone Number','Litres','Price Per Litre','Total Price','Amount Received','Balance Due','Payment Method','Order Status','Notes','Created At','Updated At'];
const METHODS = ['Ready Cash','UPI','Pending'];
const STATUSES = ['New','Confirmed','Delivered','Cancelled'];
const MODES = ['orders','litres','sales'];
const SESSION_SECS = 6 * 3600; // CacheService max is 6 hours

/* ============================ SETUP ============================ */
function setupApp() {
  const p = props();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  p.setProperty('SHEET_ID', ss.getId());
  [['Teams', T_HEAD, [1,2,4,5,6]], ['Orders', O_HEAD, [1,2,3,4,5,11,12,13,14,15]], ['Settings', ['Key','Value'], [1,2]]].forEach(function (d) {
    const s = ss.getSheetByName(d[0]) || ss.insertSheet(d[0]);
    if (s.getLastRow() === 0) {
      s.getRange(1, 1, 1, d[1].length).setValues([d[1]]).setFontWeight('bold').setBackground('#f3d28a');
      s.setFrozenRows(1);
    }
    d[2].forEach(function (c) { s.getRange(2, c, s.getMaxRows() - 1, 1).setNumberFormat('@'); }); // text format = no formula injection
  });
  if (!p.getProperty('SECRET')) p.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty('ADMIN_ID')) p.setProperty('ADMIN_ID', 'CHANGE_ME');
  if (!p.getProperty('ADMIN_PASSWORD')) p.setProperty('ADMIN_PASSWORD', 'CHANGE_ME');
  if (!p.getProperty('PRICE_PER_LITRE')) p.setProperty('PRICE_PER_LITRE', '500');
  if (!getSetting('PRICE_PER_LITRE', '')) setSetting('PRICE_PER_LITRE', p.getProperty('PRICE_PER_LITRE'));
  if (!getSetting('DEFAULT_RANKING', '')) setSetting('DEFAULT_RANKING', 'orders');
  Logger.log('Setup complete. Now set ADMIN_ID, ADMIN_PASSWORD and PRICE_PER_LITRE in Project Settings > Script Properties.');
}

/* ============================ WEB APP ============================ */
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.page = (e && e.parameter && e.parameter.page === 'admin') ? 'admin' : 'home';
  return t.evaluate().setTitle('Payasam Challenge')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Single client entry point. Always returns a JSON string {ok,data|error}. */
function api(action, p) {
  try {
    const fn = ROUTES[action];
    if (!fn) fail('Unknown action.');
    return JSON.stringify({ ok: true, data: fn(p || {}) });
  } catch (e) {
    if (!e.user) console.error(action, e && e.stack || e);
    return JSON.stringify({ ok: false, error: e.user ? e.message : 'Something went wrong on the server. Please try again.' });
  }
}

/* ============================ HELPERS ============================ */
function props() { return PropertiesService.getScriptProperties(); }
function fail(m) { const e = new Error(m); e.user = true; throw e; }
function now() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"); }
function r2(x) { return Math.round(x * 100) / 100; }
function clean(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function sha(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function eq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function sheet(n) {
  const id = props().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  const s = ss.getSheetByName(n);
  if (!s) fail('Database is not set up. Run setupApp() first.');
  return s;
}
function table(n) {
  const v = sheet(n).getDataRange().getValues(); const h = v[0];
  return v.slice(1).map(function (r, i) { const o = { _row: i + 2 }; h.forEach(function (k, j) { o[k] = r[j]; }); return o; })
    .filter(function (o) { return o[h[0]] !== ''; });
}
function withLock(fn) {
  const l = LockService.getScriptLock();
  try { l.waitLock(20000); } catch (e) { fail('The server is busy. Please try again in a moment.'); }
  try { return fn(); } finally { l.releaseLock(); }
}
function getSetting(k, d) { const r = table('Settings').filter(function (x) { return x.Key === k; })[0]; return r && r.Value !== '' ? String(r.Value) : d; }
function setSetting(k, v) {
  const r = table('Settings').filter(function (x) { return x.Key === k; })[0];
  if (r) sheet('Settings').getRange(r._row, 2).setValue(String(v)); else sheet('Settings').appendRow([k, String(v)]);
}
function getPrice() {
  const v = parseFloat(getSetting('PRICE_PER_LITRE', props().getProperty('PRICE_PER_LITRE') || '0'));
  if (!(v > 0)) fail('Price per litre is not configured yet.');
  return v;
}
function defaultMode() { const m = getSetting('DEFAULT_RANKING', 'orders'); return MODES.indexOf(m) > -1 ? m : 'orders'; }
function money(x, label) { const v = Number(x); if (!isFinite(v) || v < 0 || v > 10000000) fail(label + ' must be a valid amount (0 or more).'); return r2(v); }
function rlGuard(k, max, secs) { const c = CacheService.getScriptCache(); const n = +(c.get('rl_' + k) || 0); if (n >= max) fail('Too many requests. Please try again later.'); c.put('rl_' + k, String(n + 1), secs); }

/* ============================ PASSWORDS & SESSIONS ============================ */
function hashPw(pw, salt) {
  let h = salt + pw + props().getProperty('SECRET');
  for (let i = 0; i < 200; i++) h = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  return h;
}
function makeHash(pw) { const salt = Utilities.getUuid(); return salt + '$' + hashPw(pw, salt); }
function checkHash(pw, stored) { const p = String(stored || '').split('$'); return p.length === 2 && eq(hashPw(pw, p[0]), p[1]); }
function newSession(role, id) {
  const tok = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('s_' + sha(tok), JSON.stringify({ role: role, id: id, exp: Date.now() + SESSION_SECS * 1000 }), SESSION_SECS);
  return tok;
}
function auth(p, role) {
  const tok = String(p.token || '');
  const raw = tok.length >= 36 && CacheService.getScriptCache().get('s_' + sha(tok));
  const s = raw && JSON.parse(raw);
  if (!s || s.role !== role || s.exp < Date.now()) fail('Session expired. Please log in again.');
  return s;
}
function teamCtx(p) {
  const s = auth(p, 'team');
  const t = table('Teams').filter(function (x) { return x['Team ID'] === s.id; })[0];
  if (!t || t['Team Status'] !== 'Active') fail('Session expired. Please log in again.');
  return t;
}
function adminCtx(p) { auth(p, 'admin'); }
function logout(p) { CacheService.getScriptCache().remove('s_' + sha(String(p.token || ''))); return true; }

/* ============================ AGGREGATION & RANKING ============================ */
function agg() {
  const teams = table('Teams'), orders = table('Orders'), m = {}, list = [];
  teams.forEach(function (t) {
    const o = { teamId: t['Team ID'], name: t['Team Name'], members: +t['Member Count'], status: t['Team Status'], created: String(t['Created At']), orders: 0, litres: 0, sales: 0, cash: 0, due: 0, _ph: {} };
    m[o.teamId] = o; list.push(o);
  });
  const g = { teams: list.length, orders: 0, litres: 0, sales: 0, cash: 0, due: 0, pending: 0, delivered: 0, cancelled: 0 }, ph = {};
  orders.forEach(function (r) {
    const st = r['Order Status'];
    if (st === 'Cancelled') { g.cancelled++; return; }  // cancelled orders never count
    const l = +r['Litres'], tp = +r['Total Price'], ar = +r['Amount Received'], bd = +r['Balance Due'], t = m[r['Team ID']];
    g.orders++; g.litres += l; g.sales += tp; g.cash += ar; g.due += bd; ph[r['Phone Number']] = 1;
    if (st === 'Delivered') g.delivered++; else g.pending++;
    if (t) { t.orders++; t.litres += l; t.sales += tp; t.cash += ar; t.due += bd; t._ph[r['Phone Number']] = 1; }
  });
  list.forEach(function (t) { t.customers = Object.keys(t._ph).length; delete t._ph; ['litres','sales','cash','due'].forEach(function (k) { t[k] = r2(t[k]); }); });
  g.customers = Object.keys(ph).length; ['litres','sales','cash','due'].forEach(function (k) { g[k] = r2(g[k]); });
  return { list: list, g: g, orders: orders };
}
/** Tie-breakers: chosen metric, then orders, litres, sales, earliest registration, name. */
function rankTeams(list, mode) {
  mode = MODES.indexOf(mode) > -1 ? mode : 'orders';
  list.sort(function (a, b) {
    if (b[mode] !== a[mode]) return b[mode] - a[mode];
    for (let i = 0; i < 3; i++) { const k = MODES[i]; if (b[k] !== a[k]) return b[k] - a[k]; }
    if (a.created !== b.created) return a.created < b.created ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const lead = list.length ? list[0][mode] : 0;
  list.forEach(function (t, i) { t.rank = i + 1; t.score = t[mode]; t.progress = lead > 0 ? Math.round(t[mode] / lead * 1000) / 10 : 0; });
  return list;
}
function orderOut(r) {
  return { id: r['Order ID'], teamId: r['Team ID'], team: r['Team Name'], customer: r['Customer Name'], phone: String(r['Phone Number']), litres: +r['Litres'], price: +r['Price Per Litre'], total: +r['Total Price'], received: +r['Amount Received'], due: +r['Balance Due'], method: r['Payment Method'], status: r['Order Status'], notes: r['Notes'], created: String(r['Created At']), updated: String(r['Updated At']) };
}
function newest(a, b) { return a.created < b.created ? 1 : a.created > b.created ? -1 : 0; }

/* ============================ PUBLIC API ============================ */
function publicInfo() {
  const a = agg();
  return { price: getPrice(), defaultRanking: defaultMode(), teams: a.list.filter(function (t) { return t.status === 'Active'; }).map(function (t) { return t.name; }).sort() };
}
function publicStats() {
  const g = agg().g; return { teams: g.teams, orders: g.orders, litres: g.litres, sales: g.sales, customers: g.customers, updatedAt: now() };
}
function leaderboard(p) {
  const a = agg(), mode = MODES.indexOf(p.mode) > -1 ? p.mode : defaultMode();
  const list = rankTeams(a.list.filter(function (t) { return t.status === 'Active'; }), mode);
  return { mode: mode, defaultRanking: defaultMode(), updatedAt: now(),
    teams: list.map(function (t) { return { rank: t.rank, name: t.name, orders: t.orders, litres: t.litres, sales: t.sales, score: t.score, progress: t.progress }; }) };
}

/* ============================ REGISTER / LOGIN ============================ */
function register(p) {
  const name = clean(p.teamName, 40);
  if (name.length < 3) fail('Team name must be 3 to 40 characters.');
  const members = parseInt(p.members, 10);
  if (!(members >= 1 && members <= 100)) fail('Number of members must be between 1 and 100.');
  const pw = String(p.password || '');
  if (pw.length < 6 || pw.length > 64) fail('Password must be 6 to 64 characters.');
  if (pw !== String(p.confirm || '')) fail('Passwords do not match.');
  rlGuard('reg', 40, 3600);
  return withLock(function () {
    const ts = table('Teams');
    if (ts.some(function (t) { return String(t['Team Name']).toLowerCase() === name.toLowerCase(); })) fail('That team name is already taken. Please choose another.');
    const ids = {}; ts.forEach(function (t) { ids[t['Team ID']] = 1; });
    let id; do { id = 'T' + Math.floor(10000 + Math.random() * 90000); } while (ids[id]);
    sheet('Teams').appendRow([id, name, members, makeHash(pw), now(), 'Active']);
    return { teamId: id, teamName: name };
  });
}
function login(p) {
  const name = clean(p.teamName, 40).toLowerCase(), key = 'lf_' + sha(name), c = CacheService.getScriptCache();
  if (+(c.get(key) || 0) >= 5) fail('Too many failed attempts. Please try again in 10 minutes.');
  const t = table('Teams').filter(function (x) { return String(x['Team Name']).toLowerCase() === name; })[0];
  const ok = t ? checkHash(String(p.password || ''), t['Password Hash']) : (hashPw('x', 'x'), false);
  if (!ok) { c.put(key, String(+(c.get(key) || 0) + 1), 600); fail('Invalid team name or password.'); }
  if (t['Team Status'] !== 'Active') fail('This team has been deactivated. Please contact the administrator.');
  c.remove(key);
  return { token: newSession('team', t['Team ID']), teamName: t['Team Name'] };
}

/* ============================ ORDERS ============================ */
function cleanOrder(p) {
  const name = clean(p.customerName, 80); if (name.length < 2) fail('Please enter the customer name.');
  const phone = String(p.phone || '').replace(/[\s\-()]/g, ''); if (!/^\+?\d{10,15}$/.test(phone)) fail('Enter a valid phone number (10 to 15 digits).');
  const litres = Number(p.litres); if (!isFinite(litres) || litres <= 0 || litres > 500) fail('Litres must be more than 0 and at most 500.');
  const method = String(p.method || ''); if (METHODS.indexOf(method) < 0) fail('Choose a valid payment method.');
  const price = getPrice(), total = r2(litres * price);
  const rec = method === 'Pending' ? 0 : money(p.amountReceived || 0, 'Amount received');
  if (rec > total) fail('Amount received cannot be more than the total price (' + total + ').');
  return { name: name, phone: phone, litres: r2(litres), method: method, price: price, total: total, rec: rec, notes: clean(p.notes, 200) };
}
function placeOrder(team, p) {
  const rid = clean(p.requestId, 64); if (rid.length < 8) fail('Invalid request. Please refresh the page and try again.');
  const c = cleanOrder(p);
  return withLock(function () {
    const cache = CacheService.getScriptCache(), hit = cache.get('rq_' + rid);
    if (hit) return JSON.parse(hit); // duplicate submission: return the original order
    const ids = {}; table('Orders').forEach(function (o) { ids[o['Order ID']] = 1; });
    let id; do { id = 'PC-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); } while (ids[id]);
    const ts = now();
    sheet('Orders').appendRow([id, team['Team ID'], team['Team Name'], c.name, c.phone, c.litres, c.price, c.total, c.rec, r2(c.total - c.rec), c.method, 'New', c.notes, ts, ts]);
    const out = { orderId: id, team: team['Team Name'], litres: c.litres, price: c.price, total: c.total, received: c.rec, due: r2(c.total - c.rec), created: ts };
    cache.put('rq_' + rid, JSON.stringify(out), 1800);
    return out;
  });
}
function teamOrder(p) { return placeOrder(teamCtx(p), p); }
function individualOrder(p) {
  const name = clean(p.teamName, 40).toLowerCase();
  const team = table('Teams').filter(function (t) { return String(t['Team Name']).toLowerCase() === name; })[0];
  if (!team || team['Team Status'] !== 'Active') fail('Please select a valid, active team.');
  rlGuard('io_' + String(p.phone || '').replace(/\D/g, ''), 10, 3600);
  return placeOrder(team, p);
}
/** Shared edit logic. Payment is only changed when explicitly supplied, so status changes never reset cash. */
function updateOrder(id, ch, teamId, full) {
  const r = table('Orders').filter(function (o) { return o['Order ID'] === id && (!teamId || o['Team ID'] === teamId); })[0];
  if (!r) fail('Order not found.');
  let st = r['Order Status'], lit = +r['Litres'], rec = +r['Amount Received'], name = r['Customer Name'], phone = String(r['Phone Number']), method = r['Payment Method'], notes = r['Notes'];
  const pr = +r['Price Per Litre']; // historical price is preserved
  if (ch.status !== undefined && ch.status !== '') { if (STATUSES.indexOf(ch.status) < 0) fail('Invalid status.'); st = ch.status; }
  if (ch.amountReceived !== undefined && ch.amountReceived !== '') rec = money(ch.amountReceived, 'Amount received');
  if (full) {
    if (ch.customerName !== undefined) { name = clean(ch.customerName, 80); if (name.length < 2) fail('Please enter the customer name.'); }
    if (ch.phone !== undefined) { phone = String(ch.phone).replace(/[\s\-()]/g, ''); if (!/^\+?\d{10,15}$/.test(phone)) fail('Enter a valid phone number.'); }
    if (ch.litres !== undefined) { lit = Number(ch.litres); if (!isFinite(lit) || lit <= 0 || lit > 500) fail('Litres must be more than 0 and at most 500.'); lit = r2(lit); }
    if (ch.method !== undefined) { if (METHODS.indexOf(ch.method) < 0) fail('Invalid payment method.'); method = ch.method; }
    if (ch.notes !== undefined) notes = clean(ch.notes, 200);
  }
  const total = r2(lit * pr);
  if (rec > total) fail('Amount received cannot be more than the total price (' + total + ').');
  sheet('Orders').getRange(r._row, 1, 1, 15).setValues([[r['Order ID'], r['Team ID'], r['Team Name'], name, phone, lit, pr, total, rec, r2(total - rec), method, st, notes, r['Created At'], now()]]);
  return true;
}
function teamUpdateOrder(p) { const t = teamCtx(p); return withLock(function () { return updateOrder(String(p.orderId || ''), { status: p.status, amountReceived: p.amountReceived }, t['Team ID'], false); }); }
function teamDash(p) {
  const t = teamCtx(p), a = agg(), id = t['Team ID'];
  const me = a.list.filter(function (x) { return x.teamId === id; })[0];
  const active = a.list.filter(function (x) { return x.status === 'Active'; }), rank = {};
  MODES.forEach(function (m) {
    const l = rankTeams(active.map(function (x) { return Object.assign({}, x); }), m);
    const i = l.map(function (x) { return x.teamId; }).indexOf(id);
    rank[m] = { rank: i + 1, total: l.length, progress: l[i].progress, mine: me[m], leader: l[0][m], leaderName: l[0].name };
  });
  return { team: { id: id, name: t['Team Name'], members: +t['Member Count'] }, stats: me, rank: rank, price: getPrice(), defaultRanking: defaultMode(),
    orders: a.orders.filter(function (o) { return o['Team ID'] === id; }).map(orderOut).sort(newest) };
}

/* ============================ ADMIN ============================ */
function adminLogin(p) {
  const c = CacheService.getScriptCache();
  if (+(c.get('lf_admin') || 0) >= 5) fail('Too many failed attempts. Please try again in 10 minutes.');
  const id = props().getProperty('ADMIN_ID'), pw = props().getProperty('ADMIN_PASSWORD');
  if (!id || !pw || id === 'CHANGE_ME' || pw === 'CHANGE_ME') fail('Admin credentials are not configured in Script Properties.');
  const a = eq(sha(String(p.adminId || '')), sha(id)), b = eq(sha(String(p.adminPassword || '')), sha(pw));
  if (!(a && b)) { c.put('lf_admin', String(+(c.get('lf_admin') || 0) + 1), 600); fail('Invalid admin ID or password.'); }
  c.remove('lf_admin');
  return { token: newSession('admin', 'admin') };
}
function adminDash(p) {
  adminCtx(p); const a = agg(), mode = MODES.indexOf(p.mode) > -1 ? p.mode : defaultMode();
  return { stats: a.g, teams: rankTeams(a.list, mode), mode: mode, settings: { price: getPrice(), defaultRanking: defaultMode() } };
}
function adminOrders(p) {
  adminCtx(p); const f = orderFilter(p), q = clean(p.q, 80).toLowerCase();
  return table('Orders').filter(function (o) {
    return f(o) && (!q || String(o['Order ID']).toLowerCase().indexOf(q) > -1 || String(o['Customer Name']).toLowerCase().indexOf(q) > -1);
  }).map(orderOut).sort(newest).slice(0, 1000);
}
function orderFilter(p) {
  return function (o) {
    const d = String(o['Created At']).slice(0, 10);
    return (!p.team || o['Team ID'] === p.team) && (!p.method || o['Payment Method'] === p.method) && (!p.status || o['Order Status'] === p.status) && (!p.from || d >= p.from) && (!p.to || d <= p.to);
  };
}
function adminUpdateOrder(p) {
  adminCtx(p);
  return withLock(function () { return updateOrder(String(p.orderId || ''), { status: p.status, amountReceived: p.amountReceived, customerName: p.customerName, phone: p.phone, litres: p.litres, method: p.method, notes: p.notes }, null, true); });
}
function adminTeamStatus(p) {
  adminCtx(p); const st = p.status === 'Active' ? 'Active' : 'Inactive';
  return withLock(function () {
    const t = table('Teams').filter(function (x) { return x['Team ID'] === p.teamId; })[0]; if (!t) fail('Team not found.');
    sheet('Teams').getRange(t._row, 6).setValue(st); return true;
  });
}
function adminSaveSettings(p) {
  adminCtx(p); const price = Number(p.price);
  if (!isFinite(price) || price <= 0 || price > 100000) fail('Price per litre must be more than 0.');
  if (MODES.indexOf(p.defaultRanking) < 0) fail('Invalid ranking category.');
  return withLock(function () { setSetting('PRICE_PER_LITRE', r2(price)); setSetting('DEFAULT_RANKING', p.defaultRanking); return true; });
}

/* ============================ REPORTS ============================ */
function adminReport(p) {
  adminCtx(p); const f = orderFilter(p), type = String(p.type || '');
  const all = table('Orders').filter(f), valid = all.filter(function (o) { return o['Order Status'] !== 'Cancelled'; });
  const OC = ['Order ID','Date','Team','Customer','Phone','Litres','Total','Received','Balance','Method','Status'];
  const row = function (o) { return [o['Order ID'], String(o['Created At']).replace('T', ' '), o['Team Name'], o['Customer Name'], String(o['Phone Number']), +o['Litres'], +o['Total Price'], +o['Amount Received'], +o['Balance Due'], o['Payment Method'], o['Order Status']]; };
  const withTotal = function (title, cols, rows, idx) {
    if (rows.length) { const t = cols.map(function () { return ''; }); t[0] = 'TOTAL'; idx.forEach(function (i) { t[i] = r2(rows.reduce(function (s, r) { return s + (+r[i] || 0); }, 0)); }); rows.push(t); }
    return { title: title, columns: cols, rows: rows };
  };
  const group = function (list, keyFn, init) { const m = {}; list.forEach(function (o) { const k = keyFn(o); const g = m[k] || (m[k] = init(o)); g.l += +o['Litres']; g.n++; g.s += +o['Total Price']; g.c += +o['Amount Received']; g.d += +o['Balance Due']; }); return Object.keys(m).sort().map(function (k) { return m[k]; }); };
  switch (type) {
    case 'team': return withTotal('Team-wise Report', ['Team','Orders','Litres','Sales','Collected','Outstanding'],
      group(valid, function (o) { return o['Team Name']; }, function (o) { return { name: o['Team Name'], n: 0, l: 0, s: 0, c: 0, d: 0 }; }).map(function (g) { return [g.name, g.n, r2(g.l), r2(g.s), r2(g.c), r2(g.d)]; }), [1,2,3,4,5]);
    case 'customer': return withTotal('Customer-wise Report', ['Customer','Phone','Orders','Litres','Total','Paid','Balance'],
      group(valid, function (o) { return String(o['Phone Number']); }, function (o) { return { name: o['Customer Name'], ph: String(o['Phone Number']), n: 0, l: 0, s: 0, c: 0, d: 0 }; }).map(function (g) { return [g.name, g.ph, g.n, r2(g.l), r2(g.s), r2(g.c), r2(g.d)]; }), [2,3,4,5,6]);
    case 'daily': return withTotal('Daily Orders Report', ['Date','Orders','Litres','Sales','Collected'],
      group(valid, function (o) { return String(o['Created At']).slice(0, 10); }, function (o) { return { name: String(o['Created At']).slice(0, 10), n: 0, l: 0, s: 0, c: 0, d: 0 }; }).map(function (g) { return [g.name, g.n, r2(g.l), r2(g.s), r2(g.c)]; }), [1,2,3,4]);
    case 'sales': return withTotal('Sales Report', OC, valid.map(row), [5,6,7,8]);
    case 'cash': return withTotal('Cash Collection Report', OC, valid.filter(function (o) { return o['Payment Method'] === 'Ready Cash' && +o['Amount Received'] > 0; }).map(row), [5,6,7,8]);
    case 'upi': return withTotal('UPI Report', OC, valid.filter(function (o) { return o['Payment Method'] === 'UPI' && +o['Amount Received'] > 0; }).map(row), [5,6,7,8]);
    case 'pending': return withTotal('Pending Balance Report', OC, valid.filter(function (o) { return +o['Balance Due'] > 0; }).map(row), [5,6,7,8]);
    case 'delivered': return withTotal('Delivered Orders Report', OC, all.filter(function (o) { return o['Order Status'] === 'Delivered'; }).map(row), [5,6,7,8]);
    case 'cancelled': return withTotal('Cancelled Orders Report', OC, all.filter(function (o) { return o['Order Status'] === 'Cancelled'; }).map(row), [5,6,7,8]);
  }
  fail('Unknown report type.');
}

const ROUTES = { publicInfo: publicInfo, stats: publicStats, leaderboard: leaderboard, register: register, login: login, logout: logout,
  individualOrder: individualOrder, teamDash: teamDash, teamOrder: teamOrder, teamUpdateOrder: teamUpdateOrder,
  adminLogin: adminLogin, adminDash: adminDash, adminOrders: adminOrders, adminUpdateOrder: adminUpdateOrder,
  adminTeamStatus: adminTeamStatus, adminSaveSettings: adminSaveSettings, adminReport: adminReport };
