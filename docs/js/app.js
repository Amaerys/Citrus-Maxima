import * as store from './store.js';
import { mergeStates } from './store.js';
import * as G from './google.js';
import { parseRotaFile, serializeRota } from './rota-parser.js';
import { dayInfo, myDay, allPeople, isMe, isNurseRota, sharedShifts, monthSummary, shiftWindow, UNIT_LABEL } from './model.js';
import { legendRows, codeOptions, codeText, hoursShort } from './rota-codes.js';
import { suggest, dayBusy, learn, weekStartOf, PLANNER_DEFAULTS } from './planner.js';
import * as PV from './plan-view.js';
import { normalizeStatus, validateStatus, CONTRACT } from './inbound.js';
import * as M from './mind.js';
import * as MU from './mind-ui.js';
import { constellation, appTabs } from './apps-ui.js';
import { boardModel, overlapModel } from './board.js';
import * as SU from './social-ui.js';
import * as CU from './chores-ui.js';
import * as LU from './labor-ui.js';
import * as RU from './career-ui.js';
import * as XU from './plans-ui.js';
import * as EU from './extras-ui.js';
import * as DU from './daily-ui.js';
import * as DY from './daily.js';
import * as RC from './changes.js';
import * as CHU from './changes-ui.js';
import * as PU from './people-ui.js';
import * as N from './nurses.js';
import * as L from './labor.js';
import * as TM from './today-model.js';
import { checkBackup, describeCounts } from './backup-check.js';
import { contactOf } from './social.js';
import { h, toast, safeUrl, keyOf, fromKey, addDays, startOfDay, sameDay, fmtDate, fmtDateShort, fmtTime, fmtMin, fmtDur, relDay, pad2, DAY_SHORT, DAY_NAMES, MONTHS, telLink, firstName, atMin, minsOf, uid } from './util.js';

// ---------------- runtime state (not persisted) ----------------
const rt = {
  view: 'today',
  rotaMonth: null,        // Date (1st of month)
  rotaSel: null,          // selected date in rota view
  events: {},             // dateKey -> events[] (from Google Calendar)
  eventsLoaded: {},       // monthKey -> true
  suggestions: {},        // dateKey -> blocks
  calendars: [],
  syncing: false,
  online: navigator.onLine,
};

const $ = (s, el = document) => el.querySelector(s);
const views = {};
const S = () => store.get();

// ---------------- boot ----------------
async function boot() {
  applyTheme(); watchSheets();
  rt.rotaMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  for (const b of document.querySelectorAll('nav.tabs button')) b.addEventListener('click', () => show(b.dataset.view));
  $('#btnRefresh').addEventListener('click', () => refreshAll(true));
  $('#btnMore').addEventListener('click', () => show('more'));
  $('#btnSearch').addEventListener('click', () => openSearch());
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    // Escape closes only the top layer: the search box sits above any sheet (beta T09-11)
    if (e.key === 'Escape') { const sr = document.querySelector('.search'); if (sr) { sr.remove(); e.stopImmediatePropagation(); return; } closeTopSheet(); return; }
    if (typing) return;
    if (e.key === '/' && !document.querySelector('.search')) { openSearch(); e.preventDefault(); return; }   // search opens above a sheet too
    // tab shortcuts never switch the page behind an open sheet or search (beta T09-11)
    if (document.querySelector('.sheet-bg, .search')) return;
    const tabs = ['today', 'rota', 'plan', 'mind', 'social', 'apps'];
    if (/^[1-6]$/.test(e.key)) { show(tabs[+e.key - 1]); e.preventDefault(); }
    else if (e.key === '/') { openSearch(); e.preventDefault(); }
    else if (e.key === 'r') { if (!rt.online) toast('Offline — Citrus syncs when you are back online'); else refreshAll(true); }   // beta T09-25
    else if (e.key === ',') show('more');
    else if (e.key === '?') { shortcutsSheet(); e.preventDefault(); }
  });
  window.addEventListener('online', () => { rt.online = true; renderSync(); flushOutbox().then(render).catch(() => {}); });
  window.addEventListener('offline', () => { rt.online = false; renderSync(); });
  // → { how: 'cal', event } or { how: 'queued' }. With { quiet: true } the caller says it in its own single toast (FOLLOWUPS: double toast).
  const addEventFn = async (it, opt = {}) => { const cal = S().settings.calendarIds?.[0] || 'primary'; const d = fromKey(it.date), hm = (v) => { const [a, b] = String(v).split(':').map(Number); return a * 60 + b; }, st = hm(it.start); return calendarCreate(cal, { title: it.title, start: atMin(d, st), end: atMin(d, it.end ? hm(it.end) : st + (it.minutes || 30)), description: it.text || '', reminders: planAlarm() }, { src: 'inbox' }, { quiet: !!opt.quiet }); };
  MU.initMind({
    S, update: (fn) => store.update(fn), sheet, apps: mergedApps, appMeta: (n) => appMeta(n, mergedApps()[n] || {}), render: () => render(), regenerate: () => { regenerate(); render(); },
    go: (v, sub) => { if (v === 'rota' && sub) rt.workSeg = sub; show(v); }, launch: (app, id) => launch(app, id), appUrl: (n) => launchUrl(n, mergedApps()[n] || {}, null),
    addEvent: addEventFn,
  });
  const sub = { S, update: (fn) => store.update(fn), sheet, render: () => render(), go: (v, sub) => { if (v === 'rota' && sub) rt.workSeg = sub; show(v); }, busyOf: busyOfDay, addEvent: addEventFn };
  SU.initSocial({ ...sub, allPeople: () => allPeople(S()), isMeKey: (k) => { const m = S().me; return !!m && (k === `id:${m.id}` || k === `name:${String(m.name || '').toLowerCase()}`); } }); CU.initChores(sub); LU.initLabor(sub); RU.initCareer(sub); XU.initPlans(sub); CHU.initChanges(sub); DU.initDaily({ ...sub, planned: plannedOn, hasApp: (n) => !!mergedApps()[n], launchApp: (n) => launch(n, null) }); EU.initExtras({ ...sub, invite: (ids, what, slot = null) => SU.inviteSheet(ids, slot, what) /* the picked slot travels with it */ }); PU.initPeople({ ...sub, openDay: (d) => daySheet(d), personSheet, personKeyOf, shiftChip, importButton });
  store.subscribe(() => { render(); remindSoon(); });
  store.onRemoteSync(scheduleRemoteSave);
  loadCachedEvents();
  if (S().me && Object.keys(S().rotas).length) regenerate();
  const hashView = location.hash.replace('#', '');
  show(hashView.startsWith('capture=') ? 'today' : hashView || 'today');
  handleIncoming();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const cid = S().settings.clientId;
  G.onAuthChange(() => { renderSync(); render(); });
  G.renewOnTap(() => { render(); refreshAll(false); });   // the hourly token renews on your next tap (phones only allow Google's window inside a tap)
  if (cid && rt.online) {
    try { await G.init(cid); } catch (e) { console.warn(e); }
    if (G.isSignedIn()) refreshAll(false);
    else if (G.wasSignedIn()) { G.auth.needsSignIn = true; render(); }
  }
  // ask the browser not to clear Citrus's storage under pressure (granted silently for installed apps)
  navigator.storage?.persist?.().then(ok => { rt.storagePersisted = ok; }).catch(() => {});
  navigator.storage?.estimate?.().then(e => { rt.storageEst = e; }).catch(() => {});
  setInterval(() => {
    const busy = document.querySelector('.sheet-bg, .search') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (rt.view === 'today' && document.visibilityState === 'visible' && !busy) render();
  }, 60000);
  // keep fresh: a cheap changes check when the app comes back to the foreground (one request if nothing moved),
  // and every few minutes while it's open; save right away when it goes to the background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushRemoteSave(); return; }
    if (G.isSignedIn() && Date.now() - (S().google.lastSync || 0) > 2 * 60000) refreshAll(false);
  });
  window.addEventListener('pagehide', flushRemoteSave);
  setInterval(() => { if (document.visibilityState === 'visible' && G.isSignedIn() && rt.online && Date.now() - (S().google.lastSync || 0) > 5 * 60000) refreshAll(false); }, 60000);
  renderSync();
}

// Things sent to Citrus: the phone's Share menu (manifest share_target: ?title&text&url) and links like #capture=Buy%20milk
function handleIncoming() {
  try {
    const q = new URLSearchParams(location.search), hash = location.hash;
    let inc = null;
    if (q.get('title') || q.get('text') || q.get('url')) inc = { title: q.get('title') || '', text: q.get('text') || '', url: safeUrl(q.get('url') || (/^https?:\/\/\S+$/.test(q.get('text') || '') ? q.get('text') : '')), source: q.get('from') || '' };
    else if (hash.startsWith('#capture=')) inc = { title: decodeURIComponent(hash.slice(9)), source: new URLSearchParams(location.search).get('from') || '' };
    if (!inc && q.get('from')) { const from = q.get('from'); history.replaceState(null, '', location.pathname + (location.hash || '#today')); const key = String(from).toLowerCase(), known = APP_META[key] || mergedApps()[key]; if (known) toast(`Back from ${appMeta(key, mergedApps()[key] || {}).title}`); /* only real app names are echoed (beta T09-27) */ setTimeout(() => refreshAll(false), 400); return; }
    if (!inc) return;
    history.replaceState(null, '', location.pathname + '#today');
    setTimeout(() => MU.captureSheet(inc), 300);
  } catch (e) { console.warn('incoming', e); }
}

// Shown at the top of every screen when the Google session needs a tap to come back
function authBanner() {
  if (!G.auth.needsSignIn || !rt.online) return null;
  return h('div', { class: 'banner' }, h('span', { class: 'grow' }, 'Google needs a tap to reconnect — nothing is lost, sync resumes after.'),
    h('button', { class: 'btn sm primary', onClick: async () => { try { await G.signIn({ renew: G.wasSignedIn() }); refreshAll(true); } catch (e) { try { await G.signIn(); refreshAll(true); } catch (e2) { toast(e2.message, 'err'); } } } }, 'Reconnect'));
}

const VIEWS = ['today', 'rota', 'plan', 'mind', 'social', 'apps', 'more'];
const VIEW_NAMES = { today: 'Today', rota: 'Work', plan: 'Plan', mind: 'Mind', social: 'Social', apps: 'Apps', more: 'Settings' };
function show(view) {
  if (view === 'team') { rt.workSeg = 'team'; view = 'rota'; }   // the old Team tab lives inside Work now
  if (!VIEWS.includes(view)) view = 'today';
  rt.view = view;
  for (const s of document.querySelectorAll('section.view')) s.classList.toggle('active', s.id === `view-${view}`);
  for (const b of document.querySelectorAll('nav.tabs button')) { b.classList.toggle('active', b.dataset.view === view); if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }   // beta T10-23

  history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo(0, 0);
}

function render() {
  ingestApps();   // numbers the apps report become history before anything is drawn
  const fn = { today: renderToday, rota: renderWork, plan: renderPlan, mind: MU.renderMind, social: SU.renderSocial, apps: renderApps, more: renderMore }[rt.view] || renderToday;
  const el = $(`#view-${rt.view}`);
  el.replaceChildren(...[authBanner(), fn()].flat().filter(Boolean));
  // every view gets a heading for screen readers, even the ones whose design has no visible title (beta T10-23)
  if (!el.querySelector('h1')) el.prepend(h('h1', { class: 'sr-only' }, VIEW_NAMES[rt.view] || 'Citrus'));
  const pt = document.getElementById('pageTitle'), d = new Date(); if (pt) pt.textContent = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;   // the rail's top bar: today's date, not an orphan sync dot (beta T09-20)
}

// Interfaces (Orange 8.12 pattern): Arcade / Clean / Paper + text size, chosen per device (localStorage, never synced); index.html applies them before first paint.
const UI_KEY = 'citrus.ui';
function getUi() { let u = {}; try { u = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch {} if (!u.ui) u.ui = S().settings.theme === 'light' ? 'paper' : 'clean'; if (!u.size) u.size = 'normal'; return u; }
function setUi(patch) {
  const u = { ...getUi(), ...patch }; try { localStorage.setItem(UI_KEY, JSON.stringify(u)); } catch {} applyTheme(); render();
  // the control you just tapped stays where your finger is, even when a bigger text size grows the page (beta T09-18)
  if (rt.view === 'more') document.querySelector('#view-more .ui-pick')?.scrollIntoView({ block: 'nearest' });
}
function applyTheme() { const u = getUi(), r = document.documentElement; r.dataset.ui = u.ui; r.dataset.size = u.size; r.dataset.theme = u.ui === 'paper' ? 'light' : 'dark'; const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = u.ui === 'paper' ? '#F3F4F9' : u.ui === 'arcade' ? '#12141F' : '#0e0f13'; }

// ---------------- sync ----------------
function renderSync() {
  const dot = $('#syncDot'), txt = $('#syncText');
  const signed = G.isSignedIn();
  dot.className = 'sync ' + (rt.syncing ? 'busy' : signed && rt.online ? 'on' : '');
  txt.textContent = !rt.online ? 'offline' : rt.syncing ? 'syncing…' : signed ? (S().google.email || 'Google') : '';
}

// ---------------- Drive sync ----------------
// state.json is written at most every 2.5 s, only when its content changed, and only if no other device wrote it since we
// read it — otherwise Citrus pulls, merges and writes the merged copy. Drive answers "anything new?" through its changes
// feed, so a sync where nothing moved is a single request; only what changed is read again.
let saveTimer = null, saving = null;
function scheduleRemoteSave() {
  if (!G.wasSignedIn()) return;
  rt.saveDirty = true;
  clearTimeout(saveTimer);
  if (!G.isSignedIn() || !rt.online) return;   // stays dirty: the next sync saves it
  saveTimer = setTimeout(() => saveStateNow().catch(e => console.warn('remote save failed', e.message)), 2500);
}
function flushRemoteSave() { if (rt.saveDirty && G.isSignedIn() && rt.online) { clearTimeout(saveTimer); saveStateNow().catch(() => {}); } }
async function saveStateNow() {
  if (saving) { await saving.catch(() => {}); if (!rt.saveDirty) return; }
  saving = (async () => {
    const root = S().settings.driveFolder;
    rt.saveDirty = false;
    try { await G.saveRemoteState(root, stripForRemote(S())); }
    catch (e) {
      if (!e.conflict) { rt.saveDirty = true; throw e; }
      await pullState(true);                                   // someone else saved first: take theirs in, then write the union
      try { await G.saveRemoteState(root, stripForRemote(S()), { force: true }); } catch (e2) { rt.saveDirty = true; throw e2; }
    }
    rt.lastSave = Date.now();
  })().finally(() => { saving = null; });
  return saving;
}
// what goes to Drive: everything except what belongs to this device (sync bookkeeping, calendar outbox, app cache)
function stripForRemote(s) { const { apps, outbox, google, ...rest } = s; return rest; }
const comparable = (s) => G.fingerprint(stripForRemote(s || {}), ['updatedAt']);

/** Read state.json and merge it in. Writes back only if the merged copy holds something Drive doesn't. */
async function pullState(fromConflict = false) {
  const remote = await G.loadRemoteState(S().settings.driveFolder);
  if (!remote) { scheduleRemoteSave(); return false; }
  if (!remote.rotas || typeof remote.rotas !== 'object') throw new Error('state.json on Drive is unreadable — kept your copy (backups are in hub/citrus/backups)');
  // same content, or the same edit time (this copy already holds that save; device-only tweaks don't bump the time,
  // and two devices must never bounce those back and forth)
  // (after a conflict the merge always runs: someone else's save is known to be missing here)
  if ((!fromConflict && (remote.updatedAt || 0) === (S().updatedAt || 0)) || comparable(remote) === comparable(S())) return false;
  const merged = mergeStates(S(), remote);
  merged.updatedAt = Math.max(S().updatedAt || 0, remote.updatedAt || 0);
  store.replaceState(merged);
  if (comparable(merged) !== comparable(remote)) { if (fromConflict) rt.saveDirty = true; else scheduleRemoteSave(); }
  rt.lastPull = Date.now();
  return true;
}

// where Citrus listens in the changes feed (persisted, so the first sync after a reload can be incremental too)
const WATCH_KEY = 'citrus.drive.watch';
function loadWatch() { try { const w = JSON.parse(localStorage.getItem(WATCH_KEY) || 'null'); return w && w.root === S().settings.driveFolder ? w : null; } catch { return null; } }
function saveWatch(w) { rt.watch = w; try { w ? localStorage.setItem(WATCH_KEY, JSON.stringify(w)) : localStorage.removeItem(WATCH_KEY); } catch {} }

async function syncApps(only = null) {
  const root = S().settings.driveFolder;
  let drive = { ...(S().apps || {}) }, maps = null;
  if (only) { for (const [fileId, app] of only) { const st = await G.readStatusFile(fileId, app); if (st) drive[app] = st; } }
  else { const r = await G.listAppStatus(root); drive = r.apps; maps = { fileToApp: r.fileToApp, folderToApp: r.folderToApp }; }
  const local = localAppStatuses();                 // apps on this site that can't reach Drive themselves: mirror them up
  for (const [name, st] of Object.entries(local)) {
    const d = drive[name];
    if (!d || (st.updatedAt || '') > (d.updatedAt || '')) { try { await G.uploadAppStatus(root, name, st); drive[name] = st; } catch (e) { console.warn('mirror', name, e.message); } }
  }
  store.update(s => ({ ...s, apps: drive }), { remote: false, silent: true });
  ingestApps();
  return maps;
}
// What the apps report becomes history (numbers, progress) so habits can follow them and aims can read them
function ingestApps() {
  const s = S(), next = M.recordMetrics(s, mergedApps());
  if (next !== s) store.update(() => next, { silent: true });
}
async function syncCalendar(force) {
  if (!force && Date.now() - (rt.calendarAt || 0) < 4 * 60000) return;   // calendar has no cheap "anything new?", so it's throttled
  rt.calendars = await G.listCalendars();
  const now = new Date();
  await Promise.all([loadEvents(new Date(now.getFullYear(), now.getMonth(), 1), true), loadEvents(new Date(now.getFullYear(), now.getMonth() + 1, 1), true)]);
  rt.calendarAt = Date.now();
}

async function refreshAll(manual, { full = false } = {}) {
  if (!rt.online && manual) { toast('Offline — Citrus syncs when you are back online'); return; }   // the real problem first (beta T09-25)
  if (!G.isSignedIn()) { if (manual) toast(G.wasSignedIn() ? 'Google needs a tap to reconnect' : S().settings.clientId ? 'Sign in to Google in Settings' : 'Add your Google client ID in Settings'); render(); return; }
  if (!rt.online) { if (manual) toast('You are offline'); return; }
  if (rt.syncing) { if (manual) toast('Already syncing…'); return; }   // one sync at a time (r key, foreground, timer can overlap)
  rt.syncing = true; renderSync();
  const root = S().settings.driveFolder;
  const problems = [];
  const step = async (label, fn) => { try { await fn(); } catch (e) { problems.push(`${label}: ${e.message}`); } };
  const t0 = performance.now();
  try {
    // 1. what moved on Drive since last time?
    let watch = loadWatch(), plan = null, newToken = '';
    const stale = !watch?.token || Date.now() - (watch.fullAt || 0) > 12 * 3600000;   // a full pass at least twice a day, whatever the feed says
    if (!full && !manual && !stale) {
      try {
        const ch = await G.changesSince(watch.token);
        if (ch) { newToken = ch.token; plan = classifyChanges(ch.changes, watch); if (ch.more) plan = null; }
      } catch (e) { if (e.auth) throw e; }
    }
    if (!plan) {   // full pass: mark "now" in the feed first so nothing that changes during the pass is missed
      G.reverify();
      newToken = await G.startToken().catch(() => '');
      plan = { full: true, state: true, rotas: true, apps: true };
    }
    if (!G.seenStateRev() && !rt.stateLoaded) plan.state = true;   // read state.json once per app session at least
    rt.syncMode = plan.full ? 'full' : plan.state || plan.rotas || plan.apps || plan.appFiles?.size ? 'changes' : 'nothing new';
    // 2. state first (the merge decides what everything else shows), then the rest in parallel
    if (plan.state) await step('state', async () => { await pullState(); rt.stateLoaded = true; });
    let maps = null;
    await Promise.all([
      step('account', async () => { if (!S().google.email) { const u = await G.userInfo(); store.update(s => ({ ...s, google: { ...s.google, email: u.email } }), { remote: false, silent: true }); } }),
      plan.rotas ? step('rotas', pullRotasFromDrive) : null,
      plan.apps ? step('apps', async () => { maps = await syncApps(); }) : plan.appFiles?.size ? step('apps', () => syncApps(plan.appFiles)) : null,
      step('calendar', () => syncCalendar(manual || plan.full)),
    ]);
    // 3. queued calendar writes, unsaved local changes, shift mirror
    await step('outbox', flushOutbox);
    if (rt.saveDirty) await step('save', saveStateNow);
    if (S().settings.pushShifts && (plan.full || plan.rotas || plan.state)) await step('shift push', pushShiftsToCalendar);
    // 4. remember where we are in the feed — only when everything worked, so a failed step is retried next time
    if (!problems.length && newToken) {
      const next = { ...(watch || {}), root, token: newToken };
      if (plan.full) { Object.assign(next, await G.watchedFolders(root).catch(() => ({})), { fullAt: Date.now() }); }
      if (maps) Object.assign(next, maps);
      saveWatch(next);
    }
    // 5. a daily snapshot of your state on Drive (14 kept) — the undo for a bad merge or a wrong tap
    if (!problems.length) G.backupDaily(root, stripForRemote(S()), keyOf(new Date())).catch(e => console.warn('backup', e.message));
    store.update(s => ({ ...s, google: { ...s.google, lastSync: Date.now() } }), { remote: false, silent: true });
    regenerate();
    rt.lastProblems = problems; rt.lastSyncMs = Math.round(performance.now() - t0);
    if (manual) toast(problems.length ? 'Synced with issues — see Settings › Diagnostics' : 'Synced', problems.length ? 'err' : 'ok');
    else if (problems.length) console.warn(problems);
  } catch (e) {
    rt.lastProblems = [e.message];
    if (manual) toast(e.message, 'err');
  } finally { rt.syncing = false; renderSync(); render(); remindSoon(); }
}

/** Turn a page of Drive changes into the smallest sync that covers them. null = can't tell, do a full pass. */
function classifyChanges(changes, w) {
  const plan = { state: false, rotas: false, apps: false, appFiles: new Map() };
  const roots = new Set([w.rotas, w.hub, w.citrus].filter(Boolean));
  const knownRotas = new Set(Object.values(S().rotas).map(r => r.driveId).filter(Boolean));
  for (const c of changes) {
    if (roots.has(c.id) && (c.removed || c.trashed || !(c.parents || []).length)) { G.forgetFolders(); return null; }   // one of our folders vanished: rebuild
    const par = c.parents || [];
    if (par.includes(w.rotas) || knownRotas.has(c.id)) plan.rotas = true;
    if (par.includes(w.citrus) && c.name === 'state.json' && (c.props?.rev || '') !== G.seenStateRev()) plan.state = true;
    if (par.includes(w.hub) && c.mimeType === 'application/vnd.google-apps.folder' && c.id !== w.citrus && c.name !== 'citrus' && !w.folderToApp?.[c.id]) plan.apps = true;   // a new app joined
    const app = par.map(p => w.folderToApp?.[p]).find(Boolean);
    if (app && c.name === 'status.json') { if (c.trashed) plan.apps = true; else plan.appFiles.set(c.id, app); }
    if (c.removed && w.fileToApp?.[c.id]) plan.apps = true;
  }
  return plan;
}

// ---------------- backups, scan & repair (Settings › Drive) ----------------
async function backupsSheet() {
  let list = [];
  try { list = await G.listBackups(S().settings.driveFolder); } catch (e) { return toast(e.message, 'err'); }
  const { close } = sheet([h('h2', {}, 'Restore a daily backup'),
    h('p', { class: 'small muted' }, 'Citrus keeps one snapshot of your rotas, plan, swaps, goals and notes per day on Drive (hub/citrus/backups, newest 14). Restoring replaces this copy and syncs it to your other devices.'),
    list.length ? h('div', { class: 'list' }, ...list.map(b => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, fmtDate(fromKey(b.date))), h('div', { class: 'meta' }, `${Math.max(1, Math.round(b.size / 1024))} KB`)),
      h('button', { class: 'btn sm', onClick: async () => {
        try {
          const j = await G.readBackup(b.id); close(); restoreSheet(j, { source: `Drive backup of ${fmtDate(fromKey(b.date))}` });
        } catch (e) { toast(e.message, 'err'); }
      } }, 'Restore')))) : h('div', { class: 'muted small' }, 'No backups yet — the first is made after today\'s sync.')]);
}
// ---------------- restore: check, show, confirm, keep an undo copy (beta T09-02, T10-11, T10-12) ----------------
const PRE_KEY = 'citrus.preRestore';
function preRestore() { if (rt.preRestore) return rt.preRestore; try { return JSON.parse(localStorage.getItem(PRE_KEY) || 'null'); } catch { return null; } }
/** The copy taken just before a restore. On this device only; if storage is full it lives in memory until the app closes. */
function keepPreRestore() { const snap = { at: Date.now(), state: S() }; rt.preRestore = snap; try { localStorage.setItem(PRE_KEY, JSON.stringify(snap)); return true; } catch { return false; } }
function dropPreRestore() { rt.preRestore = null; try { localStorage.removeItem(PRE_KEY); } catch {} }
/** Draw every main screen off-page; a restored state that throws anywhere is rolled back before anyone sees an empty app. */
function smokeRender() { for (const fn of [renderToday, renderRota, renderPlan, MU.renderMind, SU.renderSocial, renderApps, PU.renderDirectory, CU.renderHome, RU.renderCareer]) fn(); }
const when = (t) => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'unknown date';
function restoreSheet(json, { source = 'Backup file' } = {}) {
  const chk = checkBackup(json); if (!chk.ok) { toast(`${source}: ${chk.error}`, 'err'); return; }
  const sm = chk.summary, cur = checkBackup(S()).summary, older = sm.savedAt && (S().updatedAt || 0) > sm.savedAt;
  const kv = (rows) => h('div', { class: 'kv' }, ...rows.flatMap(([a, b]) => [h('b', {}, a), h('span', {}, b)]));
  const { close } = sheet([h('h2', {}, 'Restore this backup?'), h('div', { class: 'small muted', style: { marginBottom: '10px' } }, source),
    h('div', { class: 'rs-cols' },
      h('div', { class: 'card rs-in' }, h('div', { class: 'title' }, 'In the backup'), kv([['Saved', when(sm.savedAt)], ['Holds', describeCounts(sm.counts)], ['Rotas', sm.rotas.join(', ') || 'none'], ['Me', sm.me || 'not set']])),
      h('div', { class: 'card' }, h('div', { class: 'title' }, 'On this device now'), kv([['Saved', when(S().updatedAt)], ['Holds', describeCounts(cur.counts)], ['Me', cur.me || 'not set']]))),
    older ? h('div', { class: 'small late', style: { margin: '8px 0' } }, 'This backup is older than the data on this device.') : null,
    chk.dropped.length ? h('div', { class: 'card warn' }, h('div', { class: 'title' }, `Left out: ${chk.dropped.length} damaged part${chk.dropped.length > 1 ? 's' : ''}`), h('div', { class: 'tiny' }, chk.dropped.slice(0, 8).join(' · '), chk.dropped.length > 8 ? ` · +${chk.dropped.length - 8} more` : '')) : null,
    h('p', { class: 'small muted' }, 'Replace puts the backup in place of everything here, then on your other devices. Merge keeps both: for each item the newest edit wins. Either way Citrus keeps a copy of your data as it is now, so you can undo.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn danger grow', onClick: () => { close(); applyRestore(chk.state, { merge: false }); } }, 'Replace everything'),
      h('button', { class: 'btn primary grow', onClick: () => { close(); applyRestore(chk.state, { merge: true }); } }, 'Merge into mine'),
      h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
}
function applyRestore(next, { merge = false } = {}) {
  const before = S(), kept = keepPreRestore();
  const target = merge ? { ...mergeStates(before, next), updatedAt: Math.max(before.updatedAt || 0, next.updatedAt || 0) } : { ...next, outbox: before.outbox, google: before.google, apps: before.apps };
  try { store.replaceState(target); regenerate(); smokeRender(); }
  catch (e) { console.warn('restore rolled back', e); store.replaceState(before); dropPreRestore(); regenerate(); render(); toast(`That backup would break the app (${String(e.message).slice(0, 60)}). Nothing was changed.`, 'err'); return false; }
  store.replaceState(S(), { bump: true });   // only a state that draws is sent on to your other devices
  render();
  toast(h('span', {}, merge ? 'Merged' : 'Restored', kept ? '' : ' (undo copy kept until you close the app)', ' · ', h('button', { class: 'linkish', onClick: undoRestore }, 'Undo')), 'ok');
  return true;
}
function undoRestore() {
  const snap = preRestore(); if (!snap?.state) { toast('Nothing to undo'); return; }
  store.replaceState(snap.state, { bump: true }); dropPreRestore(); regenerate(); render(); toast(`Back to your data from ${when(snap.at)}`, 'ok');
}
async function repairSheet() {
  const body = h('div', {}, h('div', { class: 'muted small' }, 'Looking through Drive › ' + S().settings.driveFolder + '…'));
  const { close } = sheet([h('h2', {}, 'Check Drive'), body]);
  let rep;
  try { rep = await G.scanDrive(S().settings.driveFolder); } catch (e) { body.replaceChildren(h('div', { class: 'small' }, e.message)); return; }
  const issues = [...rep.twinFolders, ...rep.twinFiles].filter(t => t.fixable).length;
  body.replaceChildren(...[
    h('div', { class: 'small' }, `${rep.folders} folders · ${rep.files} files · ${issues ? `${issues} duplicate${issues > 1 ? 's' : ''}` : 'no duplicates'}`),
    ...rep.twinFolders.map(t => h('div', { class: 'small', style: { marginTop: '6px' } }, t.fixable ? `▸ ${t.path} ×${t.items.length} — contents will be merged into the oldest` : `▸ ${t.path} ×${t.items.length} — belongs to its own app; open that app to tidy it`)),
    ...rep.twinFiles.filter(t => t.fixable).map(t => h('div', { class: 'small', style: { marginTop: '6px' } }, `· ${t.path} ×${t.items.length} — newest kept, others to the trash`)),
    rep.strayRoots.length ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, `Old folder “${rep.strayRoots.map(r => r.name).join(', ')}” is still in My Drive. Citrus no longer uses it — check it and delete it yourself if it's empty.`) : null,
    h('pre', { class: 'tiny', style: { background: 'var(--bg2)', padding: '10px', borderRadius: '10px', overflow: 'auto', marginTop: '10px', maxHeight: '40vh' } }, rep.tree.join('\n') || '(empty)'),
    issues ? h('button', { class: 'btn primary', style: { marginTop: '10px' }, onClick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Fixing…';
      try { const r = await G.repairDrive(rep); saveWatch(null); close(); toast(`Fixed: ${r.moved} moved, ${r.trashed} to the trash (restorable for 30 days)`, 'ok'); refreshAll(false, { full: true }); }
      catch (err) { toast(err.message, 'err'); e.target.disabled = false; e.target.textContent = 'Fix duplicates'; }
    } }, 'Fix duplicates') : null].filter(Boolean));
}

async function loadEvents(monthDate, force = false) {
  const mk = `${monthDate.getFullYear()}-${pad2(monthDate.getMonth() + 1)}`;
  if (rt.eventsLoaded[mk] && !force) return;
  if (!G.isSignedIn()) return;
  const from = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1), to = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
  const ids = S().settings.calendarIds?.length ? S().settings.calendarIds : ['primary'];
  const all = [];
  for (const id of ids) { try { all.push(...await G.listEvents(id, from, to)); } catch (e) { console.warn('cal', id, e.message); } }
  // clear month then fill
  for (const k of Object.keys(rt.events)) if (k.startsWith(mk)) delete rt.events[k];
  for (const ev of all) {
    if (ev.citrus === 'shift') continue; // our own shift mirror
    const k = keyOf(ev.start);
    (rt.events[k] ||= []).push(ev);
  }
  rt.eventsLoaded[mk] = true;
  cacheEvents();
}
function cacheEvents() {
  try { localStorage.setItem('citrus.events', JSON.stringify(rt.events, (k, v) => v instanceof Date ? v.toISOString() : v)); } catch {}
}
function loadCachedEvents() {
  try {
    const raw = JSON.parse(localStorage.getItem('citrus.events') || '{}');
    for (const [k, list] of Object.entries(raw)) rt.events[k] = list.map(e => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
  } catch {}
}

async function pullRotasFromDrive() {
  const files = await G.listRotaFiles(S().settings.driveFolder);
  const known = S().rotas;
  let added = 0;
  for (const f of files) {
    const already = Object.values(known).find(r => r.driveId === f.id && r.driveModified === f.modifiedTime);
    if (already) continue;
    const removedAt = S().deleted?.[`drive:${f.id}`];
    if (removedAt && removedAt >= Date.parse(f.modifiedTime)) continue;   // you removed this rota; only a newer version of the file brings it back
    try {
      const buf = await G.downloadRota(f);
      const rota = serializeRota(await parseRotaFile(buf, f.name));
      rota.driveId = f.id; rota.driveModified = f.modifiedTime;
      if (!rota.weekdayOk) toast(`${f.name}: the weekdays don't match ${MONTHS[rota.month - 1]} ${rota.year} — check the month cell`, 'err');
      const prev = S().rotas[rota.id], diff = prev ? RC.diffRota(S(), prev, rota) : null;
      store.update(s => { const st = { ...s, rotas: { ...s.rotas, [rota.id]: rota } }; return diff ? RC.recordChanges(st, diff) : st; }, { silent: true });
      if (diff && (diff.total || diff.added.length || diff.removed.length)) toast(`${f.name} updated: ${RC.headline(diff)}`, 'ok');
      added++;
    } catch (e) { console.warn('rota parse failed', f.name, e.message); toast(`Could not read ${f.name}: ${e.message}`, 'err'); }
  }
  if (added) { toast(`Imported ${added} rota file${added > 1 ? 's' : ''} from Drive`, 'ok'); autoPickMe(); regenerate(); }
}

async function pushShiftsToCalendar() {
  const s = S();
  if (!s.me) return;
  let calId = s.settings.shiftCalendarId;
  if (!calId) { calId = await G.ensureCalendar('Citrus Maxima Shifts'); store.update(x => ({ ...x, settings: { ...x.settings, shiftCalendarId: calId } }), { remote: false, silent: true }); }
  for (const r of Object.values(s.rotas)) {
    if (r.unitKind !== 'gp') continue;
    const from = new Date(r.year, r.month - 1, 1), to = new Date(r.year, r.month, 1, 12);   // the month, plus the morning end of a last-night shift
    const wanted = [];
    for (let d = 1; d <= r.daysInMonth; d++) {
      const date = new Date(r.year, r.month - 1, d);
      const info = dayInfo(s, date);
      if (!info.mine || info.mine.shift.kind !== 'work') continue;
      const w = shiftWindow(date, info.mine.shift);
      if (!w) continue;
      const with_ = info.withMe.map(e => firstName(e.person.name)).join(', ');
      wanted.push({ title: `${info.mine.code} · ${info.mine.shift.label}`, start: w.start, end: w.end, location: info.mine.shift.site, description: with_ ? `With: ${with_}` : '', reminders: shiftAlarm() });
    }
    await G.syncTaggedEvents(calId, 'shift', from, to, wanted);
  }
}

// Other apps on this origin publish `citrus.status.<app>` in localStorage (see citrus-bridge in each app)
function localAppStatuses() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('citrus.status.')) continue;
      try { const st = normalizeStatus(JSON.parse(localStorage.getItem(k)), k.slice(14)); if (st) out[st.app] = st; } catch {}
    }
  } catch {}
  return out;
}
// Drive copies merged with fresher same-device copies, all normalized
function mergedApps() {
  const apps = {};
  for (const [name, st] of Object.entries(S().apps || {})) { const n = normalizeStatus(st, name); if (n) apps[n.app] = n; }
  for (const st of Object.values(localAppStatuses())) if (!apps[st.app] || st.updatedAt > apps[st.app].updatedAt) apps[st.app] = st;
  return apps;
}

// Calendar writes that could not be sent are kept and retried on the next sync / when back online
/** → { how: 'cal', event } when Google has it, { how: 'queued' } when it waits in the outbox. quiet: the caller toasts once itself. */
async function calendarCreate(calendarId, payload, meta = {}, { quiet = false } = {}) {
  const queue = () => { queueOutbox({ type: 'create', calendarId, payload, meta }, { quiet }); return { how: 'queued', event: null }; };
  if (!rt.online || !G.isSignedIn()) return queue();
  try { return { how: 'cal', event: await G.createEvent(calendarId, payload) }; }
  catch (e) { if (e.network || /expired|not signed/i.test(e.message)) return queue(); throw e; }
}
const QUEUED_TXT = 'will reach your calendar when online';
function queueOutbox(op, { quiet = false } = {}) { store.update(s => ({ ...s, outbox: [...(s.outbox || []), { ...op, id: uid(), at: Date.now() }] }), { silent: true, remote: false }); if (!quiet) toast(`Saved — ${QUEUED_TXT}`); }
let flushing = null;
function flushOutbox() { if (!flushing) flushing = flushOutboxOnce().finally(() => { flushing = null; }); return flushing; }
async function flushOutboxOnce() {
  const ops = S().outbox || []; if (!ops.length || !G.isSignedIn() || !rt.online) return;
  const done = new Set();
  for (const op of ops) {
    try {
      if (op.type === 'create') {
        // a create whose answer was lost may already be in the calendar: look for it by its key before sending it again
        const payload = { ...op.payload, start: new Date(op.payload.start), end: new Date(op.payload.end), key: op.id };
        let ev = op.tried ? await G.findEventByKey(op.calendarId, op.id, addDays(payload.start, -1), addDays(payload.end, 1)).catch(() => null) : null;
        if (!ev) { store.update(s => ({ ...s, outbox: (s.outbox || []).map(o => o.id === op.id ? { ...o, tried: true } : o) }), { silent: true, remote: false }); ev = await G.createEvent(op.calendarId, payload); }
        if (op.meta?.blockId && op.meta?.dateKey) store.update(s => ({ ...s, plan: { ...s.plan, [op.meta.dateKey]: (s.plan[op.meta.dateKey] || []).map(p => p.id === op.meta.blockId ? { ...p, eventId: ev.id, calendarId: ev.calendarId } : p) } }), { silent: true });
      } else if (op.type === 'delete') await G.deleteEvent(op.calendarId, op.eventId);
      done.add(op.id);
    } catch (e) {
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) done.add(op.id);   // rejected for good: don't retry forever
    }
  }
  // remove only what was sent — anything queued during the flush stays
  store.update(s => ({ ...s, outbox: (s.outbox || []).filter(op => !done.has(op.id)) }), { silent: true, remote: false });
}

// Who "me" is decides every shift Citrus calls yours, so it is never guessed (the old code silently took anyone matching /amro/, beta T10-01):
// after the first import Citrus asks, and keeps the answer.
function autoPickMe() {
  if (S().me || !mePeople().length || topSheet()?.querySelector('.me-pick')) return;
  mePicker({ first: true });
}
/** Everyone who can be "me": people in the doctor rotas (GP, FSED, specialists), grouped by unit. Nurses' rows don't drive shifts, so they're left out. */
function mePeople() {
  const order = ['gp', 'fsed', 'uv', 'lv'];
  return allPeople(S()).filter(p => p.units.some(u => order.includes(u))).map(p => ({ ...p, unit: order.find(u => p.units.includes(u)) }))
    .sort((a, b) => order.indexOf(a.unit) - order.indexOf(b.unit) || a.name.localeCompare(b.name));
}
function setMe(p) {
  store.update(s => ({ ...s, me: p ? { name: p.name, id: p.id || '' } : null }));
  regenerate(); render();
  if (p) toast(`Hi ${firstName(p.name)}: Today now shows your shifts`, 'ok');
}
/** "Which one is you?": a searchable list of the rota rows, grouped by unit. */
function mePicker({ first = false } = {}) {
  const s = S(), all = mePeople(); if (!all.length) { toast('Import a rota first'); return; }
  const q = h('input', { type: 'search', placeholder: 'Type your name or staff ID', 'aria-label': 'Search the rota for your name', autocomplete: 'off', 'data-nodirty': '' });
  const list = h('div', { class: 'me-list', role: 'list' });
  const paint = () => {
    const t = q.value.trim().toLowerCase(), hits = all.filter(p => !t || p.name.toLowerCase().includes(t) || String(p.id || '').includes(t) || (p.title || '').toLowerCase().includes(t));
    const groups = {}; for (const p of hits) (groups[p.unit] ||= []).push(p);
    list.replaceChildren(...Object.entries(groups).flatMap(([u, ps]) => [h('div', { class: 'me-unit tiny dim' }, `${UNIT_LABEL[u] || u} · ${ps.length}`),
      ...ps.map(p => h('button', { class: `me-row ${isMe(s, p) ? 'sel' : ''}`, role: 'listitem', onClick: () => { topSheet()?.remove(); setMe(p); } },
        h('span', { class: 'av' }, initials(p.name)), h('span', { class: 'grow' }, h('b', {}, p.name), h('small', {}, [p.title, p.id ? `ID ${p.id}` : ''].filter(Boolean).join(' · '))), isMe(s, p) ? h('span', { class: 'chip sel' }, 'you') : null))]),
      hits.length ? null : h('div', { class: 'muted small', style: { padding: '10px 2px' } }, 'Nobody by that name in the loaded rotas.'));
  };
  q.addEventListener('input', paint); paint();
  sheet(h('div', { class: 'me-pick' }, h('h2', {}, 'Which one is you?'),
    h('p', { class: 'small muted' }, first ? 'Citrus needs to know your row before it can show your shifts. Pick it once; it stays picked on all your devices.' : 'The row Citrus treats as yours, in every rota.'),
    q, list,
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn ghost grow', onClick: () => topSheet()?.remove() }, first ? 'Later' : 'Close'), s.me && !first ? h('button', { class: 'btn ghost danger', onClick: () => { topSheet()?.remove(); setMe(null); } }, 'Not me: clear') : null)));
}
/** You're set as someone the month's GP rota doesn't have (new staff ID, typo). A row with exactly your name is offered back. */
function meMissing(info) {
  const s = S(); if (!s.me || info.mine || !TM.hasGpRota(info)) return null;
  const gp = info.rotas.find(r => r.unitKind === 'gp'), nm = String(s.me.name || '').toLowerCase(), twin = gp.people.find(p => p.name.toLowerCase() === nm);
  return { gp, twin };
}

// ---------------- import ----------------
async function importFiles(fileList) {
  let ok = 0; const briefs = [];
  for (const f of fileList) {
    try {
      const rota = serializeRota(await parseRotaFile(await f.arrayBuffer(), f.name));
      if (!rota.weekdayOk) toast(`${f.name}: the weekdays don't match ${MONTHS[rota.month - 1]} ${rota.year} — check the month cell`, 'err');
      const prev = S().rotas[rota.id], diff = prev ? RC.diffRota(S(), prev, rota) : null;
      store.update(s => { const deleted = { ...(s.deleted || {}) }; delete deleted[`rota:${rota.id}`]; const st = { ...s, rotas: { ...s.rotas, [rota.id]: rota }, deleted }; return diff ? RC.recordChanges(st, diff) : st; }, { silent: true });
      if (diff) briefs.push(diff.rotaId);
      ok++;
    } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
  if (ok) { toast(`Imported ${ok} rota${ok > 1 ? 's' : ''}`, 'ok'); autoPickMe(); regenerate(); render(); }
  if (briefs.length) { const list = RC.unseen(S()).filter(d => briefs.includes(d.rotaId)); if (list.length) CHU.briefSheet(list); else toast('Same schedule as before: nothing changed', 'ok'); }
  if (ok && G.isSignedIn() && rt.online) uploadRotas(fileList).catch(e => console.warn('rota upload', e.message));
}
// Rotas imported on this device go to Drive › My Apps › Rotas too, named "YYYY-MM Unit.xlsx", so every device and Orange get them
async function uploadRotas(fileList) {
  const existing = await G.listRotaFiles(S().settings.driveFolder);
  let up = 0;
  for (const f of fileList) {
    let rota; try { rota = await parseRotaFile(await f.arrayBuffer(), f.name); } catch { continue; }
    const name = `${rota.year}-${pad2(rota.month)} ${({ gp: 'GP rota', fsed: 'FSED', uv: 'Upper Village', lv: 'Lower Village', nurse: 'Nurses' })[rota.unitKind] || rota.unit}.xlsx`;
    const same = existing.find(x => x.name === name || x.name === f.name);
    if (same && +same.size === f.size) continue;   // already there
    const r = await G.uploadRota(S().settings.driveFolder, name, f, same?.id);
    store.update(s => ({ ...s, rotas: { ...s.rotas, [rota.id]: { ...s.rotas[rota.id], driveId: r.id, driveModified: r.modifiedTime } } }), { silent: true });
    up++;
  }
  if (up) toast(`Saved ${up} rota file${up > 1 ? 's' : ''} to Drive › ${S().settings.driveFolder} › Rotas`, 'ok');
}

function importButton(label = 'Import rota files') {
  const input = h('input', { type: 'file', accept: '.xlsx', multiple: true, style: { display: 'none' }, onChange: (e) => importFiles([...e.target.files]) });
  return h('span', {}, input, h('button', { class: 'btn', onClick: () => input.click() }, '📄 ', label));
}


// ---------------- seamless hops between apps ----------------
// An app opened from Citrus gets ?from=citrus (and &do=<action id> for a deep link) so it can jump straight to the thing and offer "← Citrus".
function launchUrl(app, st, action) {
  const base = action?.url || appMeta(app, st).url; if (!base) return '';
  try { const u = new URL(base); u.searchParams.set('from', 'citrus'); if (action) u.searchParams.set('do', action.id); return u.href; } catch { return ''; }
}
function launch(app, actionId) {
  const st = mergedApps()[app] || {}, a = (st.actions || []).find(x => x.id === actionId), url = launchUrl(app, st, a);
  if (url) window.open(url, '_blank', 'noopener'); else toast('No link for that app yet');
}
function actionChips(app, st, limit = 4) {
  const meta = appMeta(app, st), list = (st.actions || []).slice(0, limit);
  return h('div', { class: 'act-row' }, list.map(a => h('button', { class: 'act', style: { '--c': meta.color }, onClick: (e) => { e.preventDefault(); e.stopPropagation(); launch(app, a.id); } }, a.icon ? `${a.icon} ` : '', a.label, a.minutes ? h('small', {}, ` ${a.minutes}m`) : null)));
}
function actionsCard(apps) {
  const rows = Object.entries(apps).filter(([, st]) => (st.actions || []).length); if (!rows.length) return null;
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Jump straight in'), rows.map(([name, st]) => { const m = appMeta(name, st); return h('div', { class: 'jump' }, h('div', { class: 'recv-h' }, h('span', { style: { color: m.color } }, m.icon), h('b', {}, m.title)), actionChips(name, st, 6)); }));
}

// ---------------- alarms: Google Calendar pop-up reminders (your phone rings them even when Citrus is closed) ----------------
const planAlarm = () => { const m = S().settings.alarmPlan ?? 10; return m > 0 ? [m] : null; };
const shiftAlarm = () => { const m = S().settings.alarmShift ?? 0; return m > 0 ? [m] : null; };
const hashOf = (t) => { let x = 5381; for (let i = 0; i < t.length; i++) x = ((x << 5) + x + t.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };
const RR_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// What should currently be ringing: tasks with an alarm time, habits with a daily alarm time
function wantedReminders(s, now = new Date()) {
  const want = {};
  for (const t of Object.values(s.tasks || {})) {
    if (t.done || !t.remindAt) continue; const d = new Date(t.remindAt); if (isNaN(d) || d < now) continue;
    const sig = `${t.remindAt}|${t.title}`; want[`task:${t.id}`] = { title: `⏰ ${t.title}`, start: d, end: new Date(d.getTime() + 15 * 60000), desc: t.notes || '', sig, window: [addDays(d, -1), addDays(d, 1)] };
  }
  for (const hb of M.activeHabits(s)) {
    if (!/^\d\d:\d\d$/.test(hb.remindTime || '')) continue; const [hh, mm] = hb.remindTime.split(':').map(Number), f = hb.freq || {};
    const days = f.type === 'days' && (f.days || []).length ? f.days : [0, 1, 2, 3, 4, 5, 6];
    let d = new Date(now); d.setHours(hh, mm, 0, 0); if (d < now) d = addDays(d, 1); for (let i = 0; i < 8 && !days.includes(d.getDay()); i++) d = addDays(d, 1);
    const rule = days.length === 7 ? 'RRULE:FREQ=DAILY' : `RRULE:FREQ=WEEKLY;BYDAY=${days.map(x => RR_DAYS[x]).join(',')}`;
    const sig = `${hb.remindTime}|${hb.name}|${days.join('')}`;
    want[`habit:${hb.id}`] = { title: `${hb.emoji || '●'} ${hb.name}`, start: d, end: new Date(d.getTime() + 10 * 60000), desc: 'Habit reminder from Citrus', sig, recurrence: [rule], window: [addDays(d, -1), addDays(d, 8)] };
  }
  return want;
}
let remBusy = false, remTimer = null;
function reminderDrift() { const s = S(), want = wantedReminders(s), have = s.reminders || {}; return Object.keys(want).some(k => have[k]?.sig !== want[k].sig) || Object.keys(have).some(k => !want[k]); }
function remindSoon() { if (!G.isSignedIn() || !rt.online) return; clearTimeout(remTimer); remTimer = setTimeout(() => { if (reminderDrift()) reconcileReminders(); }, 2500); }
async function reconcileReminders() {
  if (remBusy || !G.isSignedIn() || !rt.online) return; remBusy = true;
  try {
    const s = S(), cal = s.settings.calendarIds?.[0] || 'primary', want = wantedReminders(s), cur = { ...(s.reminders || {}) }; let changed = false;
    for (const [k, r] of Object.entries(cur)) if (!want[k] || want[k].sig !== r.sig) {
      if (r.eventId) { try { await G.deleteEvent(r.calendarId || cal, r.eventId); } catch (e) { if (e.network) return; } }
      delete cur[k]; changed = true;
    }
    for (const [k, w] of Object.entries(want)) {
      if (cur[k]) continue;
      const key = `rem-${k}-${hashOf(w.sig)}`;
      try {
        let ev = await G.findEventByKey(cal, key, w.window[0], w.window[1]).catch(() => null);   // another device may have made it
        if (!ev) ev = await G.createEvent(cal, { title: w.title, start: w.start, end: w.end, description: w.desc, tag: 'reminder', key, reminders: [0], recurrence: w.recurrence || null });
        cur[k] = { eventId: ev.id, sig: w.sig, calendarId: cal, at: Date.now() }; changed = true;
      } catch (e) { console.warn('reminder', k, e.message); }
    }
    if (changed) store.update(x => ({ ...x, reminders: cur }), { silent: true });
  } finally { remBusy = false; }
}
function alarmsCard() {
  const s = S(), sel = (key, opts, def) => { const el = h('select', { onChange: () => store.update(x => ({ ...x, settings: { ...x.settings, [key]: +el.value } })) }, opts.map(([v, l]) => h('option', { value: v }, l))); el.value = String(s.settings[key] ?? def); return el; };
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Alarms'),
    h('div', { class: 'small muted' }, 'A web page cannot ring a closed phone, so Citrus puts reminders on Google Calendar and your Calendar app rings them. Needs Google sign-in.'),
    h('div', { class: 'field' }, h('label', {}, 'Before plan blocks you accept'), sel('alarmPlan', [[0, 'No alarm'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes']], 10)),
    h('div', { class: 'field' }, h('label', {}, 'Before shifts Citrus puts on your calendar (applies to shifts added from now)'), sel('alarmShift', [[0, 'No alarm'], [60, '1 hour'], [90, '90 minutes'], [120, '2 hours'], [180, '3 hours']], 0)),
    h('div', { class: 'tiny dim' }, 'Task alarms and habit alarms are set on the task / habit itself. Active now: ' + Object.keys(s.reminders || {}).length));
}

// ---------------- sheets (bottom modals) ----------------
// Each sheet is a modal dialog: focus moves in and is trapped, Escape / Back close the TOP sheet only, focus returns to what opened it,
// and the page behind stops scrolling. Sheets are also removed directly (`.sheet-bg` .remove()) all over the app, so the
// bookkeeping (focus, scroll lock, history) runs from a MutationObserver instead of from close().
const sheetOpeners = new WeakMap();
const topSheet = () => [...document.querySelectorAll('.sheet-bg')].pop() || null;
function sheet(content) {
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const bg = h('div', { class: 'sheet-bg', onClick: (e) => { if (e.target === bg) close(); } });
  // a visible ✕: on a desktop or an Arcade screen nothing said that the backdrop closes the sheet (beta T02-08); it warns like Escape
  const x = h('button', { class: 'sheet-x', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onClick: () => { if (topSheet() === bg) closeTopSheet(); else close(); } }, '✕');
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, h('div', { class: 'handle' }), x, ...[content].flat());
  const title = box.querySelector('h2'); if (title) { title.id ||= 'sh-' + uid(); box.setAttribute('aria-labelledby', title.id); } else box.setAttribute('aria-label', 'Details');
  // remember typed edits, so Escape asks before throwing them away
  box.addEventListener('input', (e) => { if (e.target.matches?.('textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=search]):not([type=file]):not([data-nodirty])')) bg.dataset.dirty = '1'; });
  bg.append(box); document.body.append(bg); sheetOpeners.set(bg, opener);
  const close = () => bg.remove();
  // focus the first field (or the dialog itself) without scrolling the page; a sheet that already put focus inside keeps it
  queueMicrotask(() => { if (!bg.isConnected || box.contains(document.activeElement)) return; const f = box.querySelector('input:not([type=hidden]):not([type=file]), textarea, select'); (f && !matchMedia('(hover: none)').matches ? f : box).focus({ preventScroll: true }); });
  return { close, box };
}
/** Escape: close the top sheet; with unsaved typing, the first Escape only warns. */
function closeTopSheet() {
  const bg = topSheet(); if (!bg) return false;
  if (bg.dataset.dirty && !bg.dataset.warned) { bg.dataset.warned = '1'; toast('Unsaved changes: press Esc again to discard'); setTimeout(() => { delete bg.dataset.warned; }, 4000); return true; }
  bg.remove(); return true;
}
/** "?" — every keyboard shortcut in one place (beta T09-24). */
function shortcutsSheet() {
  const rows = [['1 – 6', 'Today, Work, Plan, Mind, Social, Apps'], [',', 'Settings'], ['/', 'Search people, days, codes, apps'], ['↑ ↓ Enter', 'move through search results and open one'], ['r', 'Sync with Google now'], ['Esc', 'close the top sheet or the search'], ['?', 'this list']];
  sheet([h('h2', {}, 'Keyboard shortcuts'), h('div', { class: 'kv keys' }, rows.flatMap(([k, v]) => [h('kbd', {}, k), h('span', {}, v)]))]);
}
// Back button closes the top sheet: one history entry guards all open sheets.
let sheetGuard = false, sheetSelfBack = false;
function watchSheets() {
  new MutationObserver((muts) => {
    const removed = muts.flatMap(m => [...m.removedNodes]).filter(n => n.classList?.contains('sheet-bg')), open = document.querySelectorAll('.sheet-bg').length;
    document.documentElement.classList.toggle('sheet-open', open > 0);
    for (const bg of removed) { const o = sheetOpeners.get(bg); if (o?.isConnected && !topSheet()) o.focus({ preventScroll: true }); }
    // the calendar's selected-day ring belongs to the open day sheet; it goes when the sheet does (beta T02-27)
    if (removed.some(bg => bg.dataset.daySheet) && !document.querySelector('.sheet-bg[data-day-sheet]')) { rt.rotaSel = null; document.querySelectorAll('.cal .day.sel').forEach(c => c.classList.remove('sel')); }
    if (open && !sheetGuard) { history.pushState({ citrusSheet: 1 }, '', location.href); sheetGuard = true; }
    else if (!open && sheetGuard && !sheetSelfBack && history.state?.citrusSheet) { sheetSelfBack = true; history.back(); }
  }).observe(document.body, { childList: true });
  addEventListener('popstate', () => {
    if (sheetSelfBack) { sheetSelfBack = false; sheetGuard = false; if (topSheet()) { history.pushState({ citrusSheet: 1 }, '', location.href); sheetGuard = true; } return; }
    sheetGuard = false; const bg = topSheet(); if (bg) { bg.remove(); if (topSheet()) { history.pushState({ citrusSheet: 1 }, '', location.href); sheetGuard = true; } }
  });
  // keep Tab inside the top sheet
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return; const bg = topSheet(); if (!bg) return;
    const f = [...bg.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) { e.preventDefault(); return; }
    const i = f.indexOf(document.activeElement);
    if (!bg.contains(document.activeElement) || (e.shiftKey && i <= 0) || (!e.shiftKey && i === f.length - 1)) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
  });
}

// ---------------- shared bits ----------------
function shiftChip(shift, code) {
  const cls = shift.kind === 'leave' ? 'leave' : shift.kind === 'off' ? 'off' : (shift.type || 'other');
  return h('span', { class: `chip ${cls}` }, code || shift.label);
}
function personPill(entry, onClick) {
  const p = entry.person;
  return h('button', { class: `pill ${isMe(S(), p) ? 'me' : ''}`, onClick: () => onClick ? onClick(entry) : personSheet(p) },
    h('span', { class: 'av' }, initials(p.name)), firstName(p.name), entry.code ? h('span', { class: 'dim tiny' }, entry.code) : null);
}
function initials(name) { const parts = String(name).replace(/^Dr\.?\s*/i, '').split(/\s+/).filter(Boolean); return (parts[0]?.[0] || '') + (parts[1]?.[0] || ''); }
function personKeyOf(p) { return p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`; }

function contactButtons(mobile) {
  const t = telLink(mobile);
  if (!t) return null;
  return h('div', { class: 'row' },
    h('a', { class: 'btn sm', href: t.tel }, '📞 Call'),
    h('a', { class: 'btn sm', href: t.wa, target: '_blank', rel: 'noopener' }, '💬 WhatsApp'),
    h('span', { class: 'small muted' }, t.display));
}

function personSheet(p) {
  const s = S();
  const key = personKeyOf(p);
  const units = [...new Set(Object.values(s.rotas).filter(r => r.people.some(x => personKeyOf(x) === key)).map(r => r.unitKind))], isGp = units.includes('gp');
  const months = Object.values(s.rotas).filter(r => r.people.some(x => personKeyOf(x) === key)).sort((a, b) => a.year - b.year || a.month - b.month);
  // the number the call / WhatsApp buttons use: your saved one first, the rota's as a footnote when they differ (beta T03-17)
  const saved = contactOf(s, key).phone, num = saved || p.mobile, digits = (x) => String(x || '').replace(/\D/g, '').replace(/^(966|0)/, '');
  const phoneLine = num ? h('div', { class: 'small muted' }, telLink(num)?.display || num, saved && p.mobile && digits(saved) !== digits(p.mobile) ? h('span', { class: 'dim' }, ` · rota: ${telLink(p.mobile)?.display || p.mobile}`) : null) : null;
  // days on together: GP colleagues share your site and shift; specialists cover your site; nurses can be posted with you (beta T01-26, T03-18)
  const myCode = (d) => dayInfo(s, d).mine?.code || '';
  const together = isGp ? sharedShifts(s, key).map(x => ({ date: x.date, label: myCode(x.date) || x.shift.type, how: '' }))
    : TM.daysWithMe(s, key, { nursesWithMe: (d, mine) => N.workingWithMe(s, d, mine) });
  const heading = isGp ? 'Shifts with you' : units.includes('nurse') ? 'On with you' : 'Covers your shifts';
  const how = [...new Set(together.map(x => x.how).filter(Boolean))];
  const chip = (x) => h('button', { class: `chip sw-day ${x.how === 'could be with you' || x.how === 'guess (last time)' ? 'maybe' : ''}`, title: x.how || 'same site and shift', 'aria-label': `${DAY_NAMES[x.date.getDay()]} ${fmtDate(x.date)}, your ${x.label}${x.how ? ', ' + x.how : ''}`, onClick: () => daySheet(x.date) }, `${fmtDateShort(x.date)} `, h('b', {}, x.label));
  const content = [
    h('div', { class: 'row' }, h('div', { class: 'avatar', style: { width: '44px', height: '44px', borderRadius: '50%', background: 'var(--orange-soft)', color: 'var(--orange2)', display: 'grid', placeItems: 'center', fontWeight: '700' } }, initials(p.name)),
      h('div', { class: 'grow' }, h('h2', {}, p.name), h('div', { class: 'small muted' }, [p.title, p.id ? `ID ${p.id}` : ''].filter(Boolean).join(' · ')))),
    h('div', { style: { height: '10px' } }),
    phoneLine,
    ...PU.personBlock(p),
    isMe(s, p) || !s.me ? null : h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `${heading} (${together.length})`), how.length > 1 ? h('span', { class: 'tiny dim' }, how.map(w => `${together.filter(x => x.how === w).length} ${w}`).join(' · ')) : null),
      together.length ? h('div', { class: 'chips' }, ...together.map(chip)) : h('div', { class: 'muted small' }, isGp ? 'No shared shifts in the loaded rotas' : units.includes('nurse') && !N.nurseRotas(s).length ? 'Load the nurses’ schedule to see this' : 'None in the loaded rotas')),
    months.length ? PU.personRota(p) : null,
  ];
  sheet(content);
}

function miniMonth(rota, person) {
  const grid = h('div', { class: 'cal' });
  const first = new Date(rota.year, rota.month - 1, 1);
  for (let i = 0; i < first.getDay(); i++) grid.append(h('div', { class: 'day pad' }));
  for (let d = 1; d <= rota.daysInMonth; d++) {
    const code = person.days[d] || '';
    const shift = interpretFor(rota, code);
    const cls = shift.kind === 'leave' ? 'leave' : shift.kind === 'off' ? 'off' : (shift.type && /^[DNE]$/.test(shift.type) ? shift.type : 'other');
    grid.append(h('div', { class: 'day', onClick: () => { rt.rotaMonth = first; rt.rotaSel = new Date(rota.year, rota.month - 1, d); show('rota'); topSheet()?.remove(); daySheet(rt.rotaSel); } },
      h('span', { class: 'n' }, d), h('span', { class: `code ${cls}` }, shift.kind === 'off' ? '·' : shift.kind === 'leave' ? 'L' : code)));
  }
  return [h('div', { class: 'cal-head' }, ...DAY_SHORT.map(x => h('span', {}, x[0]))), grid];
}
import { interpretCode } from './rota-parser.js';
function interpretFor(rota, code) { return interpretCode(code, rota.legend, rota.unitKind); }

// ---------------- TODAY ----------------
const UI_MORE = 'moreOpen';   // "More for today" open/closed, remembered per device in citrus.ui (beta T01-23)
function renderToday() {
  const s = S();
  const now = new Date();
  const main = [], side = [], loaded = Object.keys(s.rotas).length > 0, wide = cockpitWide() && loaded;
  // a fresh install gets one "get started" card, not a hero and week strip that say "no rota" again (beta T01-28, T10-17)
  if (!loaded) main.push(onboardingCard());
  const nudge = rotaReminderCard(); if (nudge) main.push(nudge);
  const md = myDay(s, now), { info, today } = md;
  if (loaded) main.push(heroCard(now, md));
  // Everything below the hero is ranked by what matters right now; the top few stay open, the rest fold into "More for today".
  const tailLive = md.overnightTail && now < md.overnightTail.window.end;
  const working = (!!today && now >= today.window.start && now < today.window.end) || !!tailLive, soon = !!today && now < today.window.end, ranked = [];
  const add = (el, score, label) => { if (el) ranked.push({ el, score, label }); };
  add(shiftBoard(info, md), working ? 92 : soon ? 60 : 30, 'Shift board');
  add(CHU.updatesCard({ today: true }), 100, 'Schedule update');
  for (const c of DU.todayCards(now)) add(c.el, c.score, c.label);
  // people-ui scores its own card: the evening "tomorrow's postings not set" nudge stays above the fold (beta T04-05)
  add(PU.todayCard(), PU.todayScore(working), 'Nurses');
  add(RU.todayCard(), 80, 'Contract dates');
  if (!wide) add(planCard(now), 70, 'Plan');   // the wide cockpit has its own Plan column
  add(CU.todayCard(), CU.todayScore(), 'Home');   // an overdue chore moves above Plan (beta T05-29)
  add(MU.mindCard(), 58, 'Mind');
  if (info.hasRota) add(onCallCard(info), working ? 40 : 22, 'On call');
  ranked.sort((x, y) => y.score - x.score);
  const TOP = 5, top = ranked.slice(0, TOP), rest = ranked.slice(TOP);
  main.push(...top.map(r => r.el));
  if (rest.length) main.push(h('details', { class: 'more-today', open: getUi()[UI_MORE] ? '' : null, onToggle: (e) => { try { localStorage.setItem(UI_KEY, JSON.stringify({ ...getUi(), [UI_MORE]: e.currentTarget.open })); } catch {} } }, h('summary', {}, h('span', { class: 'title' }, 'More for today'), h('span', { class: 'chips' }, rest.map(r => h('span', { class: 'chip' }, r.label)))), ...rest.map(r => r.el)));
  side.push(eventsCard(now));
  { const fc = SU.todayCard(); if (fc) side.push(fc); }
  if (Object.keys(mergedApps()).length) side.push(appsCard());
  side.push(noteCard(now));
  if (wide) return h('div', { class: 'cockpit' }, h('div', { class: 'ck-col' }, ...main, ...side),
    h('div', { class: 'ck-col' }, h('div', { class: 'ck-head' }, h('h2', {}, 'Work'), h('button', { class: 'btn sm ghost', onClick: () => show('rota') }, 'Open')), ...[renderRota()].flat().filter(Boolean)),
    h('div', { class: 'ck-col ck-plan' }, ...[renderPlan()].flat().filter(Boolean)));
  return h('div', { class: 'cols' }, h('div', {}, ...main), h('div', {}, ...side));
}
/** "Day · Upper Village 08:00–20:00", without saying the hours twice when the rota's label already has them ("SF shift (13:00–01:00)", beta T01-25). */
function shiftText(sh) { return /\d\d:\d\d/.test(sh.label) ? sh.label : `${sh.label} ${fmtMin(sh.hours.start)}–${fmtMin(sh.hours.end)}`; }
/** Text with its "08:00–20:00" ranges in no-wrap spans, so a 320px hero never breaks inside a time range (beta T01-21). Same text content. */
const nbTimes = (t) => String(t).split(/(\d\d:\d\d–\d\d:\d\d)/).map((x, i) => i % 2 ? h('span', { class: 'nowrap' }, x) : x).filter(Boolean);
/** What tomorrow holds, or that it isn't known yet: a missing month is not a day off (beta T01-08, T10-04). */
function tomorrowText(now, tmr) {
  if (!S().me) return '';
  if (!TM.hasGpRota(tmr.info) && !tmr.info.mine) { const d = addDays(now, 1); return h('span', { class: 'unk-txt' }, `no rota yet (${MONTHS[d.getMonth()]} not loaded)`); }
  if (tmr.today) return shiftText(tmr.today.shift);
  if (tmr.info.mine?.shift.kind === 'leave') return tmr.info.mine.shift.label;
  return tmr.info.mine ? 'off' : 'not in the rota';
}
/**
 * The hero describes the shift that matters NOW (today-model.js heroFocus): the night you are still on after midnight,
 * today's shift until it ends, then tomorrow's. Its team, progress bar and dial all follow that shift (beta T01-02, T01-18, T10-02).
 */
function heroCard(now, md = myDay(S(), now)) {
  const s = S(), { info } = md, tmr = myDay(s, addDays(now, 1)), prevInfo = dayInfo(s, addDays(now, -1));
  const f = TM.heroFocus(now, md, tmr, prevInfo), missing = s.me ? meMissing(info) : null, gpNow = TM.hasGpRota(info) || !!info.mine;
  const night = f.entry?.shift.type === 'N' || f.kind === 'tail' || (f.kind === 'none' && md.afterNight);
  const hero = h('div', { class: `card hero hero-${f.kind}`, style: night ? { '--accent-soft': 'var(--night-soft)' } : {} });
  const words = h('div', {});
  const say = (...kids) => words.append(...kids.filter(Boolean));   // raw append() would print "null"
  const times = (e) => `${fmtTime(e.window.start)}–${fmtTime(e.window.end)} · ${fmtDur(e.shift.hours.durationMin)} · ${e.code}`;
  say(h('div', { class: 'title' }, `${DAY_NAMES[now.getDay()]} ${fmtDate(now)}`, f.kind === 'tomorrow' && f.doneToday ? h('span', { class: 'hero-done' }, ' · today’s shift done ✓') : null));
  if (!s.me && info.hasRota) say(h('div', { class: 'big' }, 'Who are you?'), h('div', { class: 'sub' }, 'Pick your row once and Citrus shows your shifts everywhere.'), h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary sm', onClick: () => mePicker({ first: true }) }, 'Pick your row')));
  else if (missing) {
    // you're set as someone this month's GP rota doesn't have: say so, instead of a cheerful "Day off" (beta T10-03)
    const { twin } = missing;
    say(h('div', { class: 'big' }, `You’re not in the ${MONTHS[now.getMonth()]} GP rota`),
      h('div', { class: 'sub' }, twin ? `It has ${twin.name} with ID ${twin.id || '—'}; Citrus has you as ID ${s.me.id || '—'}.` : `Citrus has you as ${s.me.name}${s.me.id ? ` (ID ${s.me.id})` : ''}, and no row matches. Until you pick yours, no day here is really off.`),
      h('div', { class: 'row wrap', style: { marginTop: '10px', gap: '6px' } }, twin ? h('button', { class: 'btn primary sm', onClick: () => setMe(twin) }, 'That’s me') : null, h('button', { class: `btn sm ${twin ? '' : 'primary'}`, onClick: () => mePicker() }, 'Pick your row')));
  } else if (f.kind === 'tail' || f.kind === 'today' || f.kind === 'done') {
    const e = f.entry;
    say(h('div', { class: 'big' }, e.shift.label), h('div', { class: 'sub' }, nbTimes(times(e)), f.kind === 'tail' ? ' · since yesterday' : ''), shiftProgress(e.window), e.mci ? h('div', { style: { marginTop: '6px' } }, mciBadge()) : null);
  } else if (f.kind === 'tomorrow') {
    const e = f.entry;
    say(h('div', { class: 'big' }, h('span', { class: 'muted' }, 'Tomorrow · '), e.shift.label), h('div', { class: 'sub' }, nbTimes(times(e))), shiftProgress(e.window), e.mci ? h('div', { style: { marginTop: '6px' } }, mciBadge()) : null);
  } else if (!info.hasRota && md.overnightTail) say(h('div', { class: 'big' }, 'Off, after a night'), h('div', { class: 'sub' }, `Your night ended ${fmtTime(md.overnightTail.window.end)}. No rota for ${MONTHS[now.getMonth()]} yet: import it to see the rest of the month.`));
  else if (!info.hasRota) say(h('div', { class: 'big' }, `No rota for ${MONTHS[now.getMonth()]} yet`), h('div', { class: 'sub' }, 'Import the Excel files, or drop them in Drive › My Apps › Rotas.'), h('div', { style: { marginTop: '10px' } }, importButton()));
  else if (!gpNow) say(h('div', { class: 'big' }, `No GP rota for ${MONTHS[now.getMonth()]}`), h('div', { class: 'sub' }, 'Other schedules are loaded, but your shifts come from the GP rota.'), h('div', { style: { marginTop: '10px' } }, importButton()));
  else if (info.mine && info.mine.shift.kind === 'leave') say(h('div', { class: 'big' }, info.mine.shift.label), h('div', { class: 'sub' }, 'Enjoy it.'));
  else say(h('div', { class: 'big' }, md.afterNight ? 'Off, after a night' : 'Day off'), h('div', { class: 'sub' }, md.afterNight ? `Your night ended ${fmtTime(md.overnightTail.window.end)}. Recover first; the plan stays light.` : 'A free day. The planner has ideas below.'));
  // what comes next: tonight's shift while you're still on last night's; otherwise tomorrow
  if (f.kind === 'tail' && md.today) say(h('div', { class: 'small hero-next' }, h('span', { class: 'muted' }, 'Next '), nbTimes(shiftText(md.today.shift)), ` · in ${fmtDur(Math.max(1, Math.round((md.today.window.start - now) / 60000)))}`));
  else if (f.kind !== 'tomorrow' && !missing) { const t = tomorrowText(now, tmr); if (t) say(h('div', { class: 'small hero-next' }, h('span', { class: 'muted' }, 'Tomorrow '), typeof t === 'string' ? nbTimes(t) : t)); }
  hero.append(h('div', { class: 'hero-grid' }, words, gpNow && s.me && !missing ? dayDial(now) : null));
  const nu = nextUp(now); if (nu) hero.append(nu);
  if (!missing && f.kind !== 'done' && f.kind !== 'none') { const tm = heroTeam(f); if (tm) hero.append(tm); }
  if (s.me) hero.append(weekStrip(now));
  return hero;
}
function uiPicker() {
  const u = getUi(), opt = (id, name, note) => h('button', { class: `ui-opt ${u.ui === id ? 'sel' : ''}`, 'aria-pressed': u.ui === id ? 'true' : 'false', onClick: () => setUi({ ui: id }) }, h('span', { class: `ui-thumb ui-${id}` }, h('i'), h('i'), h('b', {}, 'Aa')), h('b', {}, name), h('small', {}, note));
  return h('div', { class: 'ui-pick' }, h('div', { class: 'title' }, 'Interface on this device'), h('div', { class: 'ui-opts' }, opt('arcade', 'Arcade', '8-bit, the family look'), opt('clean', 'Clean', 'Calm, rounded, dark'), opt('paper', 'Paper', 'Light, for daylight')),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'small grow' }, 'Text size'), h('div', { class: 'seg ui-size' }, [['small', 'S'], ['normal', 'M'], ['large', 'L']].map(([k, l]) => h('button', { class: u.size === k ? 'active' : '', 'aria-label': `Text size ${k}`, onClick: () => setUi({ size: k }) }, l)))),
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'small grow' }, 'Wide-screen cockpit (Today, Work, Plan side by side)'), h('input', { type: 'checkbox', 'aria-label': 'Wide-screen cockpit', checked: u.cockpit !== false, onChange: (e) => setUi({ cockpit: e.target.checked }) })));
}
/** Wide screens (27" monitor, Steam Deck docked) show Today, Work and Plan side by side. */
const cockpitWide = () => window.innerWidth >= 1400 && getUi().cockpit !== false;
let wideWas = window.innerWidth >= 1400; addEventListener('resize', () => { const w = cockpitWide(); if (w !== wideWas && rt.view === 'today') render(); wideWas = w; });

// ---- the day dial: 24 hours around a ring; shift, commute, sleep, calendar and plan drawn as arcs ----
function dayDial(date) {
  const s = S();
  const k = keyOf(date);
  const { busy, today, overnightTail } = dayBusy(s, date, rt.events[k] || []);
  const R = 100, C = 110, rOuter = 92, w = 14;
  const ang = (min) => (min / 1440) * 2 * Math.PI - Math.PI / 2;
  const pt = (r, min) => [C + r * Math.cos(ang(min)), C + r * Math.sin(ang(min))];
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(svgNS, tag); for (const [k2, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k2, v); for (const c of kids.flat()) if (c) e.append(c); return e; };
  const arc = (r, a, b, cls, extra = {}) => {
    a = Math.max(0, Math.min(1440, a)); b = Math.max(0, Math.min(1440, b)); if (b - a < 2) return null;
    if (b - a >= 1439) return el('circle', { cx: C, cy: C, r, fill: 'none', 'stroke-width': w, ...extra });
    const [x1, y1] = pt(r, a), [x2, y2] = pt(r, b);
    const large = b - a > 720 ? 1 : 0;
    return el('path', { d: `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`, fill: 'none', 'stroke-width': w, 'stroke-linecap': 'butt', ...extra });
  };
  const paths = [];
  const push = (r, a, b, stroke, extra = {}) => { const p = arc(r, a, b, '', extra); if (p) { p.setAttribute('stroke', stroke); paths.push(p); } };
  // base ring
  paths.push(el('circle', { cx: C, cy: C, r: rOuter, fill: 'none', stroke: 'var(--line)', 'stroke-width': w }));
  for (const b of busy) {
    const color = b.kind === 'shift' ? (today?.shift.type === 'N' || overnightTail && b.start === 0 ? 'var(--night)' : 'var(--day)') : b.kind === 'sleep' ? 'var(--line2)' : b.kind === 'event' ? 'var(--blue)' : b.kind === 'protected' ? 'var(--dim)' : 'var(--orange)';
    push(rOuter, b.start, Math.min(1440, b.end), color, b.kind === 'sleep' ? { 'stroke-dasharray': '2 3' } : {});
  }
  // commute = thin inner marks around shift
  for (const p of [...(rt.suggestions[k] || [])]) push(rOuter - w - 4, p.start, p.end, p.color || 'var(--orange)', { 'stroke-width': 5, 'stroke-dasharray': '3 2' });
  for (const p of (s.plan[k] || []).filter(x => x.status === 'accepted' || x.status === 'done')) push(rOuter - w - 4, p.start, p.end, s.goals.find(g => g.id === p.goalId)?.color || p.color || 'var(--orange)', { 'stroke-width': 5 });
  // hour ticks
  const ticks = [];
  for (let hh = 0; hh < 24; hh += 3) { const [x1, y1] = pt(rOuter + w / 2 + 3, hh * 60), [x2, y2] = pt(rOuter + w / 2 + (hh % 6 ? 6 : 9), hh * 60); ticks.push(el('line', { x1, y1, x2, y2, stroke: 'var(--dim)', 'stroke-width': 1.5 })); }
  const labels = [0, 6, 12, 18].map(hh => { const [x, y] = pt(rOuter - w - 16, hh * 60); return el('text', { x, y: y + 3.5, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--dim)' }, String(hh)); });
  // now marker
  const nowMin = sameDay(date, new Date()) ? minsOf(new Date()) : null;
  const marker = nowMin == null ? null : (() => { const [x1, y1] = pt(rOuter - w / 2 - 3, nowMin), [x2, y2] = pt(rOuter + w / 2 + 3, nowMin); return el('line', { x1, y1, x2, y2, stroke: 'var(--orange)', 'stroke-width': 3, 'stroke-linecap': 'round', class: 'now' }); })();
  // the centre names the shift you are on now: last night's until it ends, then today's (beta T10-02: 03:00 mid-night said "post-night")
  const nowD = new Date(), tailLive = overnightTail && sameDay(date, nowD) && nowD < overnightTail.window.end, cur = tailLive ? overnightTail : today;
  const centre = cur ? [el('text', { x: C, y: C - 4, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 800, fill: 'var(--text)' }, cur.code), el('text', { x: C, y: C + 14, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)' }, tailLive ? `until ${fmtTime(overnightTail.window.end)}` : `${fmtMin(today.shift.hours.start)}–${fmtMin(today.shift.hours.end)}`)]
    : [el('text', { x: C, y: C + 5, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: 'var(--muted)' }, overnightTail ? 'post-night' : 'free')];
  const w0 = cur ? (tailLive ? overnightTail.window : shiftWindow(date, today.shift)) : null;
  const said = !cur ? (overnightTail ? 'off after a night' : 'no shift') : nowD < w0.start ? `${cur.code} ${fmtTime(w0.start)}–${fmtTime(w0.end)}, starts in ${fmtDur(Math.round((w0.start - nowD) / 60000))}` : nowD < w0.end ? `${cur.code} until ${fmtTime(w0.end)}, ${fmtDur(Math.round((w0.end - nowD) / 60000))} left` : `${cur.code} done`;
  const svg = el('svg', { viewBox: `0 0 ${2 * C} ${2 * C}`, class: 'dial', role: 'img', 'aria-label': `Your day as a 24-hour ring: ${said}${nowMin != null ? `; now ${fmtTime(nowD)}` : ''}` }, ...paths, ...ticks, ...labels, marker, ...centre);
  return svg;
}

// next 7 days at a glance
const hh24 = (m) => pad2(Math.floor((((m % 1440) + 1440) % 1440) / 60));
/** People from the day's rotas → short names that stay unique ("Ahmed A." / "Ahmed E."), used by the hero, the board and the brief (beta T01-05). */
function namerFor(...infos) { const names = TM.shortNames(infos.flatMap(i => (i?.entries || []).map(e => e.person))); return (p) => names.get(personKeyOf(p)) || firstName(p.name); }
/**
 * Hero names: unique among everyone on that day (doctors AND nurses), your saved nickname for a friend linked to the row,
 * a surname initial when a first name is also a friend's ("Fatima K." next to your friend Fatima M.), and never a 1–2 letter stub
 * like "Al" (beta T04-09).
 */
function teamNamer(s, info, date) {
  const nurses = N.nurseRotas(s).filter(r => r.year === date.getFullYear() && r.month === date.getMonth() + 1).flatMap(r => r.people);
  const people = [...(info?.entries || []).map(e => e.person), ...nurses], names = TM.shortNames(people);
  const friends = Object.values(s.friends || {}).filter(f => f && f.name), byKey = new Map(friends.filter(f => f.rotaKey).map(f => [f.rotaKey, f]));
  const bare = (n) => String(n || '').replace(/^Dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean), friendFirst = new Set(friends.filter(f => !f.rotaKey).map(f => (bare(f.nick || f.name)[0] || '').toLowerCase()));
  return (p) => {
    const k = personKeyOf(p), fr = byKey.get(k); if (fr) return fr.nick || bare(fr.name)[0] || fr.name;
    let n = names.get(k) || firstName(p.name); const w = bare(p.name);
    if (n.length <= 2 && w.length > 1) n = `${w[0]} ${w[1]}`;
    else if (!n.includes(' ') && w.length > 1 && friendFirst.has(n.toLowerCase())) n = `${n} ${w[w.length - 1][0]}.`;
    return n;
  };
}
/**
 * Above the fold: who you are with on the shift the hero describes (f from heroFocus) — colleagues at YOUR site who share part of
 * your shift (the same list as the day sheet), nurses only when posted or tipped, and the specialist covering your site with their hours.
 */
function heroTeam(f) {
  const info = f.info, mine = info?.mine; if (!f.entry || !mine || mine.shift.kind !== 'work') return null;
  const s = S(), site = mine.shift.site || '', team = TM.teamAtSite(info), nm = teamNamer(s, info, f.date), MAX = 8;
  const pill = (name, sub, onClick, cls = '', label = '') => h('button', { class: `tm-pill ${cls}`, onClick, 'aria-label': label || null }, name, sub ? h('small', {}, sub) : null);
  const line = (label, kids) => kids.filter(Boolean).length ? h('div', { class: 'tm-line' }, h('span', { class: 'tm-lab' }, label), h('div', { class: 'tm-pills' }, kids)) : null;
  const span = (e) => { const x = e.shift.hours; return `${hh24(x.start)}–${hh24(x.end)}`; };
  const shortSite = site.replace(/ office clinic/i, ' clinic');
  const docs = team.rows.slice(0, MAX).map(r => pill(nm(r.entry.person), r.same ? '' : span(r.entry), () => personSheet(r.entry.person), r.same ? 'same' : '', `${r.entry.person.name}, ${r.entry.shift.label} ${span(r.entry)}`));
  if (team.rows.length > MAX) docs.push(pill(`+${team.rows.length - MAX}`, '', () => daySheet(f.date), 'more', 'Everyone at your site'));
  if (!team.rows.length) docs.push(h('span', { class: 'tm-alone' }, `Alone at ${shortSite || 'your site'}`));
  if (team.otherSites) docs.push(pill(`${team.otherSites} at other sites`, '', () => daySheet(f.date), 'ghost', 'See every site in the day sheet'));
  // nurses: a 25% guess on three of fourteen nurses is noise; show who is confirmed (or heard), and the rest as one count (beta T01-16)
  let nurses = [];
  if (N.nurseRotas(s).length) {
    // the board opens on the shift's own day (yesterday's for a night after midnight), not wherever it was left (beta T04-15)
    const w = N.workingWithMe(s, f.date, mine), goN = () => { PU.goNurses(f.date); rt.workSeg = 'nurses'; show('rota'); };
    if (w?.hasNurses) {
      // a pill that names a nurse opens that nurse
      // confirmed, then heard, then a guess from last time (labelled as a guess, never as "heard"), then the ones history points at you
      const tip = (r) => r.guess ? pill(nm(r.person), 'last time?', () => personSheet(r.person), 'maybe guess', `${r.person.name}, a guess from where they went last time`) : pill(nm(r.person), 'heard', () => personSheet(r.person), 'maybe', `${r.person.name}, heard to be with you`);
      nurses = [...w.confirmed.map(r => pill(nm(r.person), '', () => personSheet(r.person), 'same', `${r.person.name}, posted with you`)), ...(w.tipped || []).map(tip),
        ...(w.likely || []).slice(0, 2).map(r => pill(nm(r.person), 'likely', () => personSheet(r.person), 'maybe guess', `${r.person.name}, likely with you from past postings`))].slice(0, 5);
      const rest = w.possible.length - Math.min(2, (w.likely || []).length);
      if (rest > 0) nurses.push(pill(`${rest} could be sent`, nurses.length ? '' : 'post them', goN, 'ghost', `${rest} nurses could be posted with you: open the Nurses board`));
      else if (!nurses.length) nurses.push(pill('Nurses board', '', goN, 'ghost', 'Open the Nurses board'));
    }
  }
  // the specialist who covers your site; on a site with no specialist rota loaded, say so instead of showing nothing (beta T01-17)
  const kind = /upper/i.test(site) ? 'uv' : /lower/i.test(site) ? 'lv' : '', loadedKind = kind && info.rotas.some(r => r.unitKind === kind);
  const overl = (list) => { const m = overlapModel(mine, list); return (m?.rows || []).map(r => r.entry); };
  let spec = kind ? overl(info[kind]) : [], specLab = 'Specialist';
  if (!spec.length) { const fs = overl(info.fsed); if (fs.length) { spec = fs; specLab = 'FSED on call'; } }
  const specPills = spec.slice(0, 2).map(e => pill(nm(e.person), span(e), () => personSheet(e.person), '', `${e.person.name}, ${e.shift.label} ${span(e)}`));
  if (kind && !loadedKind) specPills.push(h('span', { class: 'tm-note' }, `${kind === 'uv' ? 'Upper' : 'Lower'} Village specialist rota not loaded`));
  const rows = [line('Doctors', docs), line('Nurses', nurses), line(specLab, specPills)].filter(Boolean);
  return rows.length ? h('div', { class: 'tm' }, rows) : null;
}

/** "Tue 10 Nov, D1 Day · Upper Village 08:00–20:00" — the name a screen reader gives a day button. */
function dayLabel(d, info = dayInfo(S(), d)) {
  const sh = info.mine?.shift, base = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (!info.mine && (!info.hasRota || !S().me && !TM.hasGpRota(info))) return `${base}, no rota loaded`;
  if (!info.mine) return `${base}, ${S().me ? 'you are not in this rota' : 'pick your row to see your shift'}`;   // unknown, not off (beta T02-05)
  if (!sh || sh.kind === 'off') { const t = myDay(S(), d).overnightTail; return t ? `${base}, off after your night (${t.code} until ${fmtTime(t.window.end)})` : `${base}, off`; }
  if (sh.kind === 'leave') return `${base}, ${sh.label}`;
  return `${base}, ${info.mine.code} ${sh.hours ? shiftText(sh) : sh.label}`;
}
function weekStrip(from) {
  const s = S();
  const strip = h('div', { class: 'week', style: { marginTop: '14px' } });
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i); const info = dayInfo(s, d); const sh = info.mine?.shift, unknown = !info.mine && !TM.hasGpRota(info);
    // a month with no rota is unknown, not a week of days off (beta T01-08, T10-05)
    const cls = unknown ? 'unk' : !sh || sh.kind === 'off' ? 'off' : sh.kind === 'leave' ? 'leave' : (/^[DNE]$/.test(sh.type) ? sh.type : 'other');
    strip.append(h('button', { class: `wd ${i === 0 ? 'today' : ''} ${unknown ? 'unk' : ''}`, 'aria-label': dayLabel(d, info), title: unknown ? `No rota for ${MONTHS[d.getMonth()]} yet` : null, onClick: () => { rt.rotaSel = d; daySheet(d); } },
      h('div', { class: 'd' }, DAY_SHORT[d.getDay()]), h('div', { class: 'n' }, d.getDate()),
      h('span', { class: `code ${cls}`, style: cls === 'off' ? { color: 'var(--dim)' } : {} }, unknown ? '?' : !info.mine || sh.kind === 'off' ? '·' : sh.kind === 'leave' ? 'L' : info.mine.code),
      sh?.kind === 'work' && sh.hours ? h('small', { class: 'wh' }, `${Math.round(sh.hours.durationMin / 60)}h`) : null));
  }
  // this Sunday–Saturday week (the labour-law week) against the weekly limit; the strip above runs from today, so the bar names its own dates (beta T01-15)
  const ws = addDays(startOfDay(from), -startOfDay(from).getDay()), we = addDays(ws, 7), cap = L.settings(s).weeklyH || 48; let mins = 0;
  for (const w of L.windows(s, ws, we)) mins += Math.max(0, Math.min(w.end, we) - Math.max(w.start, ws)) / 60000;
  const missing = [...new Set(Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter(d => { const x = dayInfo(s, d); return !x.mine && !TM.hasGpRota(x); }).map(d => MONTHS[d.getMonth()].slice(0, 3)))];
  if (!mins) return strip; const hrs = Math.round(mins / 6) / 10, pct = Math.min(100, hrs / cap * 100), over = hrs - cap;
  const range = `${DAY_SHORT[ws.getDay()]} ${ws.getDate()}–${DAY_SHORT[addDays(we, -1).getDay()]} ${addDays(we, -1).getDate()}`;
  const said = missing.length && over <= 0 ? ` so far · ${missing.join(', ')} not loaded` : ` this week · ${over > 0 ? `${Math.round(over * 10) / 10}h over ${cap}h` : `${Math.round(-over * 10) / 10}h left of ${cap}h`}`;
  return h('div', {}, strip, h('div', { class: 'wk-hours', title: `Week ${range}` }, h('div', { class: 'wk-bar' }, h('i', { class: over > 0 ? 'over' : '', style: { width: `${pct}%` } })), h('span', { class: 'small' }, h('b', {}, `${hrs}h`), said, h('span', { class: 'dim' }, ` · ${range}`))));
}

function mciBadge() {
  return h('span', { class: 'mci-quiet', title: 'MCI 2nd physician: if a mass-casualty incident happens near FSED (Six Flags, Aqua Arabia…) you are moved there immediately' }, 'MCI 2nd');
}
/** Shift as a progress bar: how far through, time left, when it ends. */
function shiftProgress(w) {
  const now = Date.now(), total = Math.max(1, w.end - w.start), pct = Math.max(0, Math.min(1, (now - w.start) / total)), left = Math.round((w.end - now) / 60000);
  const label = now < w.start ? `Starts in ${fmtDur(Math.round((w.start - now) / 60000))}` : now < w.end ? `${fmtDur(left)} left · ends ${fmtTime(w.end)}` : 'Shift done ✓';
  return h('div', { class: 'sp-wrap' }, h('div', { class: 'sp-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct * 100), 'aria-label': 'Shift progress' }, h('i', { style: { width: `${Math.round(pct * 100)}%` } })), h('div', { class: `small ${now < w.end ? 'orange' : 'muted'}` }, label));
}
/** The next calendar event or accepted plan block today. */
function nextUp(date) {
  const k = keyOf(date), now = Date.now(), items = [];
  for (const ev of rt.events[k] || []) { if (ev.allDay) continue; const t = +new Date(ev.start); if (t > now) items.push({ t, title: ev.title, src: 'calendar' }); }
  for (const p of (S().plan[k] || []).filter(x => x.status === 'accepted')) { const t = +atMin(date, p.start); if (t > now) items.push({ t, title: p.title || p.label || 'Plan block', src: 'plan' }); }
  items.sort((a, b) => a.t - b.t); const n = items[0]; if (!n) return null;
  return h('div', { class: 'next-up' }, h('span', { class: 'nu-dot' }), h('span', { class: 'grow ellipsis' }, h('b', {}, n.title)), h('span', { class: 'dim small' }, `${fmtTime(new Date(n.t))} · in ${fmtDur(Math.round((n.t - now) / 60000))}`));
}
let boardPick = '';   // the site you tapped; otherwise the board follows the shift you're on
/**
 * Who is in, hour by hour. Day, evening and night shifts overlap on one axis, so handovers and thin hours are obvious.
 * Before last night's shifts end, their crew is on the board (left of 00:00) and counted "in now"; tonight's crew is not (beta T01-01).
 */
function shiftBoard(info, md = null) {
  const s = S(), now = new Date(), isToday = sameDay(info.date, now), nowMin = isToday ? minsOf(now) : null;
  const prev = isToday ? dayInfo(s, addDays(info.date, -1)) : null, bySite = { ...info.bySite };
  if (prev) for (const [site, list] of Object.entries(prev.bySite)) { const all = TM.withLastNight(bySite[site] || [], list, nowMin); if (all.length) bySite[site] = all; }
  const sites = Object.keys(bySite).sort((a, b) => bySite[b].length - bySite[a].length); if (!sites.length) return null;
  const tail = md?.overnightTail && now < md.overnightTail.window.end ? md.overnightTail : null, mine = (tail || md?.today || info.mine)?.shift.site;
  const site = sites.includes(boardPick) ? boardPick : sites.includes(mine) ? mine : sites[0], meKey = s.me ? personKeyOf({ id: s.me.id, name: String(s.me.name || '') }) : '', nm = namerFor(info, prev);
  const m = boardModel(bySite[site], { nowMin, meKey, keyOf: personKeyOf, wrap: false }); if (!m.rows.length) return null;
  const span = m.axisEnd - m.axisStart, pct = (t) => `${((t - m.axisStart) / span * 100).toFixed(2)}%`, MAXROWS = 14, rows = m.rows.slice(0, MAXROWS);
  const grid = [];
  for (let t = Math.ceil(m.axisStart / 180) * 180; t <= m.axisEnd; t += 180) grid.push(h('span', { class: `bd-tick ${((t % 1440) + 1440) % 1440 === 0 ? 'mid' : ''}`, style: { left: pct(t) } }, h('small', {}, hh24(t))));
  const heat = h('div', { class: 'bd-heat', 'aria-hidden': 'true' }, m.hours.map(x => h('i', { title: `${hh24(x.t)}:00 · ${x.n} in`, style: { opacity: m.peak ? (0.12 + 0.88 * x.n / m.peak).toFixed(2) : 0.12 } })));
  const hmm = (t) => `${hh24(t)}:${pad2(((t % 60) + 60) % 60)}`;
  const summary = m.now == null ? `${m.rows.length} doctors across the day` : `${m.nowCount} in now${m.next ? ` · ${hmm(m.next.t)}: ${[m.next.arrive ? `${m.next.arrive} arrive${m.next.arrive === 1 ? 's' : ''}` : '', m.next.leave ? `${m.next.leave} leave${m.next.leave === 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}` : ''}`;
  return h('div', { class: 'card board' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Who’s in'), h('span', { class: 'dim tiny' }, summary)),
    sites.length > 1 ? h('div', { class: 'bd-sites' }, sites.map(x => h('button', { class: `c-chip ${x === site ? 'on' : ''}`, 'aria-pressed': x === site ? 'true' : 'false', style: { '--c': 'var(--orange)' }, onClick: () => { boardPick = x; render(); } }, x.length > 18 ? x.slice(0, 17) + '…' : x, h('small', {}, bySite[x].length)))) : null,
    h('div', { class: 'bd-plot' },
      h('div', { class: 'bd-axis' }, h('div', { class: 'bd-name' }), h('div', { class: 'bd-track bd-top' }, heat, ...grid)),
      ...rows.map(r => { const w = (r.x1 - r.x0) / span, wide = w > 0.2, txt = `${r.code || r.type} ${hh24(r.start)}–${hh24(r.end)}`;
        return h('button', { class: `bd-row ${r.me ? 'me' : ''} ${r.prev ? 'prev' : ''}`, onClick: () => personSheet(r.entry.person), title: `${r.name} · ${r.label} ${hmm(r.start)}–${hmm(r.end)}${r.prev ? ' (since yesterday)' : ''}` },
          h('span', { class: 'bd-name' }, h('span', { class: 'av' }, initials(r.name)), h('span', { class: 'ellipsis' }, r.me ? 'You' : nm(r.entry.person))),
          h('span', { class: 'bd-track' }, h('i', { class: `bd-bar ${r.type}`, style: { left: pct(r.x0), width: `${(w * 100).toFixed(2)}%` } }, wide ? txt : r.code || r.type))); }),
      m.now != null ? h('div', { class: 'bd-overlay' }, h('i', { class: 'bd-now', style: { left: pct(m.now) } })) : null),
    m.rows.length > MAXROWS ? h('div', { class: 'dim tiny' }, `+${m.rows.length - MAXROWS} more at ${site}`) : null,
    m.rows.some(r => r.prev) ? h('div', { class: 'tiny dim bd-foot' }, 'Hatched bars started yesterday evening.') : null);
}
function countdown(w) {
  const now = Date.now();
  if (now < w.start) return h('div', { class: 'small orange', style: { marginTop: '4px' } }, `Starts in ${fmtDur(Math.round((w.start - now) / 60000))}`);
  if (now < w.end) return h('div', { class: 'small orange', style: { marginTop: '4px' } }, `${fmtDur(Math.round((w.end - now) / 60000))} left`);
  return h('div', { class: 'small muted', style: { marginTop: '4px' } }, 'Shift done ✓');
}

/** First run: one card, three steps (import → pick your row → sign in), instead of four "import" calls on one screen (beta T10-17). */
function onboardingCard() {
  const dz = h('div', { class: 'dropzone' }, h('div', {}, 'Drop your rota .xlsx files here'), h('div', { class: 'small', style: { marginTop: '8px' } }, importButton()));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); importFiles([...e.dataTransfer.files]); });
  const step = (n, title, sub, done = false) => h('li', { class: `ob-step ${done ? 'done' : ''}` }, h('span', { class: 'ob-n' }, done ? '✓' : n), h('div', {}, h('b', {}, title), h('div', { class: 'tiny dim' }, sub)));
  return h('div', { class: 'card onboard' }, h('div', { class: 'title' }, 'Get started'),
    h('ol', { class: 'ob-steps' }, step(1, 'Import your rota', 'The GP rota .xlsx; add FSED, Upper Village and nurses if you have them.'), step(2, 'Pick your row', 'Citrus asks which person in the rota is you.'), step(3, 'Sign in with Google (optional)', 'Settings › Google: rotas in Drive › My Apps › Rotas then import by themselves.', G.isSignedIn())),
    dz);
}

function onCallCard(info) {
  const groups = [];
  const fsedD = info.fsed.filter(e => e.shift.type === 'D'), fsedN = info.fsed.filter(e => e.shift.type === 'N');
  if (info.fsed.length) groups.push(h('div', { class: 'site-group' }, h('h3', {}, 'FSED on call'),
    h('div', { class: 'people' }, ...fsedD.map(e => personPill(e)), ...fsedN.map(e => personPill(e)))));
  if (info.uv.length) groups.push(h('div', { class: 'site-group' }, h('h3', {}, 'Upper Village specialist'), h('div', { class: 'people' }, ...info.uv.map(e => personPill(e)))));
  if (info.lv.length) groups.push(h('div', { class: 'site-group' }, h('h3', {}, 'Lower Village specialist'), h('div', { class: 'people' }, ...info.lv.map(e => personPill(e)))));
  if (!groups.length) groups.push(h('div', { class: 'muted small' }, 'No specialist rota loaded for this month'));
  if (info.mci.length) groups.push(h('div', { class: 'mci-line' }, h('span', { class: 'dim tiny', title: 'Moved to the incident site if a mass-casualty incident happens near FSED' }, 'MCI 2nd: '), info.mci.map(e => h('button', { class: 'mci-name', onClick: () => personSheet(e.person) }, firstName(e.person.name)))));
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'On call'), ...groups);
}

function eventsCard(date) {
  const k = keyOf(date);
  const evs = (rt.events[k] || []).sort((a, b) => a.start - b.start);
  const quick = h('form', { class: 'row', style: { marginTop: '8px' }, onSubmit: async (e) => {
    e.preventDefault(); const v = quick.q.value.trim(); if (!v) return;
    const parsed = parseQuick(v, date);
    if (!G.isSignedIn()) return toast('Sign in to Google (Settings) to add events');
    try { const ev = await G.createEvent(S().settings.calendarIds?.[0] || 'primary', { ...parsed, tag: 'quick' }); (rt.events[keyOf(ev.start)] ||= []).push(ev); cacheEvents(); quick.reset(); toast('Added to calendar', 'ok'); render(); }
    catch (err) { toast(err.message, 'err'); }
  } }, h('input', { name: 'q', 'aria-label': 'Quick add an event', placeholder: 'Quick add: "Dentist Tue 3pm 1h"', style: { flex: 1, minWidth: '0', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '9px 12px' } }), h('button', { class: 'btn sm primary', 'aria-label': 'Add event' }, '+'));
  return h('div', { class: 'card' }, h('div', { class: 'title' }, `Calendar · ${relDay(date)}`),
    evs.length ? h('div', { class: 'list' }, ...evs.map(ev => h('div', { class: 'item' },
      h('div', { class: 'col', style: { minWidth: '52px' } }, h('b', { class: 'small' }, ev.allDay ? 'all day' : fmtTime(ev.start)), ev.allDay ? null : h('span', { class: 'tiny dim' }, fmtTime(ev.end))),
      h('div', { class: 'grow' }, h('div', { class: 'name ellipsis' }, ev.title), ev.location ? h('div', { class: 'meta ellipsis' }, ev.location) : null),
      ev.htmlLink ? h('a', { href: ev.htmlLink, target: '_blank', class: 'btn sm ghost' }, '↗') : null)))
      : h('div', { class: 'muted small' }, G.isSignedIn() ? 'Nothing in your calendar' : 'Sign in to Google (Settings) to see your calendar here'),
    quick);
}

// "Dentist Tue 3pm 1h" / "Call mum 18:30" / "Gym tomorrow 7am 90m"
function parseQuick(text, base) {
  let t = text, date = startOfDay(base), start = 9 * 60, dur = 60;
  const dayRe = (i) => new RegExp(`\\b(${DAY_NAMES[i]}|${DAY_SHORT[i]})\\b`, 'i');   // whole words: "Wedding" is not Wednesday
  const dayIdx = DAY_SHORT.findIndex((d, i) => dayRe(i).test(t));
  if (/\btomorrow\b/i.test(t)) { date = addDays(date, 1); t = t.replace(/\btomorrow\b/i, ''); }
  else if (dayIdx >= 0) { let diff = (dayIdx - date.getDay() + 7) % 7; if (diff === 0) diff = 7; date = addDays(date, diff); t = t.replace(dayRe(dayIdx), ''); }
  const dm = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(t);
  if (dm) { date = new Date(dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : date.getFullYear(), +dm[2] - 1, +dm[1]); t = t.replace(dm[0], ''); }
  const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(t);
  if (tm) { let hh = +tm[1]; const mm = +(tm[2] || 0); const ap = (tm[3] || '').toLowerCase(); if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; if (!ap && hh < 7) hh += 12; start = hh * 60 + mm; t = t.replace(tm[0], ''); }
  const du = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins)\b/i.exec(t);
  if (du) { dur = /^h/i.test(du[2]) ? Math.round(+du[1] * 60) : +du[1]; t = t.replace(du[0], ''); }
  const title = t.replace(/\s+/g, ' ').replace(/\bat\b\s*$/i, '').trim() || 'Event';
  return { title, start: atMin(date, start), end: atMin(date, start + dur) };
}

// ---------------- PLAN: blocks (Today card + Plan tab share these) ----------------
const todayKey = () => keyOf(new Date());
/** Today's plan, compact: only the blocks (the hero already shows the shift) and the planner's notes. */
function planCard(date) {
  const d = planDay(date), blocks = d.rows.filter(r => r.type === 'block');
  const empty = d.info.mode === 'unknown' ? 'No rota for this month yet, so nothing is planned.'
    : d.ctx.today || d.ctx.afterNight ? 'Nothing extra today: rest after your shift.' : 'Nothing planned today.';   // beta T06-28
  return h('div', { class: 'card plan-card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `Plan · ${relDay(date)}`), h('button', { class: 'btn sm ghost', onClick: () => show('plan') }, 'Open planner')),
    d.info.label ? h('div', { class: 'pl-mode' }, capFirst(d.info.label)) : null,
    ...d.notes.map(n => h('div', { class: 'pl-note' }, n)),
    blocks.length ? h('div', { class: 'pl-rows' }, ...blocks.map(r => blockRow(r.block, date, d.info.label))) : h('div', { class: 'muted small' }, empty));
}
const capFirst = (t) => t ? t[0].toUpperCase() + t.slice(1) : '';
/** Everything one day card needs: the planner's busy map, accepted / suggested / study-plan blocks, notes and the day's label. */
function planDay(date) {
  const s = S(), k = keyOf(date), ctx = dayBusy(s, date, rt.events[k] || []), list = s.plan[k] || [];
  const accepted = list.filter(p => (p.status === 'accepted' || p.status === 'done') && Number.isFinite(p.start) && Number.isFinite(p.end)).map(p => ({ ...p, _acc: true }));
  const sugg = (rt.suggestions[k] || []).filter(b => !accepted.some(a => a.id === b.id));
  // the Study planner's blocks (daily.js) live on the same timeline, marked "Study plan" (beta T06-22)
  let study = [];
  if (k >= todayKey()) try {
    study = DY.studyBlocksOn(s, date, { busyOf: busyOfDay, planned: plannedOn })
      .filter(b => ![...accepted, ...sugg].some(x => x.start < b.end && x.end > b.start))
      .map(b => ({ ...b, _study: true, goalId: `study:${b.subject}`, date: k, reason: 'From your study plan' }));
  } catch (e) { console.warn('study plan', e); }
  const items = [...accepted, ...sugg, ...study], info = rt.suggestions.days?.[k] || { mode: ctx.profile?.mode, label: ctx.profile?.label };
  const rows = PV.dayRows(s, ctx, { items, rejected: list.filter(p => p.status === 'rejected'), bed: PV.dailyBed(s, date) });
  return { k, date, ctx, rows, items, info: info || {}, notes: rt.suggestions.notes?.[k] || [] };
}
/** Calendar events of a day as [start, end] minutes (for the study, chores and social planners). */
function busyOfDay(d) { return (rt.events[keyOf(d)] || []).filter(e => !e.allDay && e.start && e.end).map(e => [Math.max(0, Math.round((e.start - startOfDay(d)) / 60000)), Math.min(1440, Math.round((e.end - startOfDay(d)) / 60000))]); }
/** The planner's blocks of a day (accepted first, then suggestions). */
function plannedOn(d) { const k = keyOf(d), acc = (S().plan[k] || []).filter(p => p.status === 'accepted' || p.status === 'done'); return [...acc, ...(rt.suggestions[k] || []).filter(b => !acc.some(x => x.id === b.id))]; }

/** One block. Same order everywhere (beta T06-25): Accept · Move · Skip, then the app as a small icon at the end; the time is said once. */
function blockRow(b, date, dayLabel = '') {
  const k = keyOf(date), s = S(), goal = s.goals.find(g => g.id === b.goalId);
  const acc = !!b._acc, done = b.status === 'done', rest = b.kind === 'rest' || /^rest:/.test(b.goalId || ''), started = k <= todayKey();
  const why = PV.trimReason(b.reason, dayLabel), tag = b._study ? 'Study plan' : rest ? 'Rest' : null;
  const actions = acc ? [
    // Done only once the day has come (beta T06-20); a done block can be un-done, which takes its study minutes back (T06-18)
    done ? h('button', { class: 'btn sm pl-done', title: 'Tap to undo', 'aria-label': `Undo done: ${b.title}`, onClick: () => setBlockStatus(k, b, 'accepted') }, '✓ done')
      : started ? h('button', { class: 'btn sm', onClick: () => setBlockStatus(k, b, 'done') }, '✓ Done') : null,
    h('button', { class: 'btn sm ghost', onClick: () => moveBlock(k, b) }, 'Move'),
    h('button', { class: 'btn sm ghost danger', onClick: () => removeBlock(k, b) }, 'Remove'),
  ] : [
    h('button', { class: 'btn sm primary', onClick: () => acceptBlock(k, b) }, 'Accept'),
    h('button', { class: 'btn sm', onClick: () => moveBlock(k, b, true) }, 'Move'),
    b._study ? null : h('button', { class: 'btn sm ghost', onClick: () => rejectBlock(k, b) }, 'Skip'),
  ];
  return h('div', { class: 'tl-row pl-b' },
    h('div', { class: `tl-block ${acc ? 'acc' : 'suggested'}${done ? ' done' : ''}${rest ? ' rest' : ''}${b._study ? ' studyp' : ''}`, style: { '--c': goal?.color || b.color || (rest ? 'var(--night)' : 'var(--orange)') } },
      h('div', { class: 'pl-top' }, h('span', { class: 'pl-time' }, `${fmtMin(b.start)}–${fmtMin(b.end)}`), h('span', { class: 't' }, b.title), tag ? h('span', { class: 'pl-tag' }, tag) : null, h('span', { class: 'pl-dur' }, fmtDur(b.end - b.start))),
      h('div', { class: 'pl-bot' }, h('span', { class: 'r' }, why), h('span', { class: 'actions' }, ...actions, (rest ? null : blockOpen(b)) || h('span', { class: 'pl-open ph', 'aria-hidden': 'true' })))));
}

function blockOpen(b) {
  if (/^app:(task|habit)-/.test(b.goalId || '')) return null;
  const app = b.app || guessApp(b.title); if (!app) return null; const st = mergedApps()[app] || {}, url = launchUrl(app, st, (st.actions || [])[0]), m = appMeta(app, st);
  return url ? h('button', { class: 'btn sm ghost pl-open', title: `Open ${m.title}`, 'aria-label': `Open ${m.title}`, onClick: () => launch(app, (st.actions || [])[0]?.id) }, m.icon || '▸', h('span', { class: 'pl-open-t' }, m.title), ' ▸') : null;
}
const dayWord = (k) => { const r = relDay(fromKey(k)); return r === 'Today' || r === 'Tomorrow' ? r.toLowerCase() : fmtDateShort(fromKey(k)); };
async function acceptBlock(k, b, { silent = false } = {}) {
  const block = { ...b, date: k, status: 'accepted', at: Date.now() }; delete block._acc; delete block._study; let queued = false;
  store.update(s => ({ ...s, plan: { ...s.plan, [k]: [...(s.plan[k] || []).filter(p => p.id !== b.id), block] }, prefs: learn(s, b, +1) }), { silent: true });
  if (rt.suggestions[k]) rt.suggestions[k] = rt.suggestions[k].filter(x => x.id !== b.id);
  // naps and rest windows stay in Citrus: they would only clutter the calendar
  if (G.isSignedIn() && S().settings.pushPlan !== false && block.kind !== 'rest') {
    try {
      const date = fromKey(k);
      const r = await calendarCreate(S().settings.calendarIds?.[0] || 'primary', { title: b.title, start: atMin(date, b.start), end: atMin(date, b.end), description: b.reason, tag: 'plan', reminders: planAlarm() }, { blockId: b.id, dateKey: k }, { quiet: true }), ev = r.event;
      queued = r.how === 'queued';
      if (ev) store.update(s => ({ ...s, plan: { ...s.plan, [k]: (s.plan[k] || []).map(p => p.id === b.id ? { ...p, eventId: ev.id, calendarId: ev.calendarId } : p) } }), { silent: true });
    } catch (e) { if (!silent) toast('Saved locally; calendar: ' + e.message, 'err'); }
  }
  publishPlanSoon();
  if (!silent) { toast(queued ? `${b.title} planned · ${QUEUED_TXT}` : `${b.title} planned`, 'ok'); render(); }
}
/** Skip: the planner moves the goal to another time that day, or drops it after a second Skip; the toast says which (beta T06-02). */
async function rejectBlock(k, b) {
  store.update(s => ({ ...s, plan: { ...s.plan, [k]: [...(s.plan[k] || []).filter(p => p.id !== b.id), { ...b, date: k, status: 'rejected', at: Date.now() }] }, prefs: learn(s, b, -2) }), { silent: true });
  regenerate(); render();
  const again = (rt.suggestions[k] || []).find(x => x.goalId === b.goalId);
  toast(again ? `${b.title} moved to ${fmtMin(again.start)}` : `${b.title} dropped for ${dayWord(k)}`);
}
/** Remove an accepted block; a done one gives back the study minutes it logged (beta T06-18). */
async function removeBlock(k, b) {
  if (b.eventId) {
    const op = { type: 'delete', calendarId: b.calendarId || 'primary', eventId: b.eventId };
    if (!rt.online || !G.isSignedIn()) queueOutbox(op);
    else try { await G.deleteEvent(op.calendarId, op.eventId); } catch (e) { if (e.network || /expired/i.test(e.message)) queueOutbox(op); }
  }
  let back = 0;
  store.update(s => { const cur = (s.plan[k] || []).find(p => p.id === b.id); let n = s; if (cur?.logged) { n = DY.logStudy(n, k, cur.logged.id, -cur.logged.mins); back = cur.logged.mins; } return { ...n, plan: { ...n.plan, [k]: (n.plan[k] || []).filter(p => p.id !== b.id) }, deleted: store.tombstone(n, `plan:${b.id}`) }; });
  toast(back ? `${b.title} removed · ${fmtDur(back)} of study taken back` : `${b.title} removed`);
  publishPlanSoon();
}
/** Done logs the block's minutes to its Study subject every time, remembered on the block so Undo / Remove can take exactly that back (T06-19). */
function setBlockStatus(k, b, status) {
  let msg = '';
  store.update(s => {
    const cur = (s.plan[k] || []).find(p => p.id === b.id); if (!cur) return s;
    let n = s; const upd = { ...cur, status, at: Date.now() };
    if (status === 'done' && !cur.logged) { const sj = DY.subjectOf(n, cur.title), mins = Math.max(0, (cur.end || 0) - (cur.start || 0)); if (sj && mins) { n = DY.logStudy(n, k, sj.id, mins); upd.logged = { id: sj.id, mins }; msg = ` · ${fmtDur(mins)} logged to ${sj.name}`; } }
    if (status !== 'done' && cur.logged) { n = DY.logStudy(n, k, cur.logged.id, -cur.logged.mins); delete upd.logged; msg = ` · ${fmtDur(cur.logged.mins)} taken back from ${DY.subjects(n).find(x => x.id === cur.logged.id)?.name || 'study'}`; }
    n = { ...n, plan: { ...n.plan, [k]: (n.plan[k] || []).map(p => p.id === b.id ? upd : p) } };
    return status === 'done' ? M.completeFromBlock(n, b.goalId, k) : n;
  });
  toast(status === 'done' ? `${b.title} done${msg}` : `${b.title} not done${msg}`, status === 'done' ? 'ok' : undefined);
}
/** 24-hour time field (the native picker shows "11:30 PM" on an en-US desktop, beta T06-26). */
const t24 = (name, min, extra = {}) => h('input', { name, type: 'text', inputmode: 'numeric', class: 't24', placeholder: 'HH:MM', maxlength: 5, autocomplete: 'off', spellcheck: 'false', value: Number.isFinite(min) ? fmtMin(min) : '', ...extra });
function moveBlock(k, b, isSuggestion = false) {
  const id = uid(), st = t24('start', b.start, { id: `mv-s-${id}`, 'aria-label': 'Start' }), en = t24('end', b.end % 1440, { id: `mv-e-${id}`, 'aria-label': 'End' }), dt = h('input', { type: 'date', value: k, id: `mv-d-${id}` }), err = h('div', { class: 'fe', role: 'alert' });
  const fail = (m) => { err.textContent = m; };
  const { close } = sheet([
    h('h2', {}, `Move “${b.title}”`),
    h('div', { class: 'rs-grid' }, h('div', { class: 'rs-f' }, h('label', { for: dt.id }, 'Date'), dt), h('div', { class: 'rs-f' }, h('label', { for: st.id }, 'Start'), st), h('div', { class: 'rs-f' }, h('label', { for: en.id }, 'End'), en)),
    err,
    h('div', { class: 'row sh-foot' }, h('button', { class: 'btn primary grow', onClick: async () => {
      // never save a blank or broken time (beta T06-04)
      const ns = PV.parseHM(st.value), ne = PV.parseHM(en.value), nk = dt.value;
      if (ns == null || ne == null) return fail('Pick a start and an end (24-hour, e.g. 18:30).');
      if (!/^\d{4}-\d\d-\d\d$/.test(nk)) return fail('Pick a date.');
      if (ne <= ns) return fail('End must be after start.');
      const moved = { ...b, start: ns, end: ne, date: nk, id: isSuggestion ? `${nk}-${b.goalId}-${ns}` : b.id, reason: 'Moved by you' }; delete moved._acc; delete moved._study;
      if (isSuggestion) {
        // the suggestion leaves its old day for good (a "moved" marker the planner's results are filtered by), then the plan is redone around it (T06-03)
        if (rt.suggestions[k]) rt.suggestions[k] = rt.suggestions[k].filter(x => x.id !== b.id);
        if (nk !== k) store.update(s => ({ ...s, plan: { ...s.plan, [k]: [...(s.plan[k] || []).filter(p => p.id !== b.id), { id: b.id, goalId: b.goalId, title: b.title, start: b.start, end: b.end, status: 'moved', to: nk, at: Date.now() }] } }), { silent: true });
        close(); await acceptBlock(nk, moved, { silent: true }); regenerate(); render(); toast(`${b.title} planned for ${dayWord(nk)} ${fmtMin(ns)}`, 'ok'); return;
      }
      if (b.eventId && G.isSignedIn()) { try { await G.patchEvent(b.calendarId || 'primary', b.eventId, { start: atMin(fromKey(nk), ns), end: atMin(fromKey(nk), ne) }); } catch (e) { toast('Calendar: ' + e.message, 'err'); } }
      store.update(s => { const plan = { ...s.plan }; plan[k] = (plan[k] || []).filter(p => p.id !== b.id); plan[nk] = [...(plan[nk] || []).filter(p => p.id !== b.id), moved]; return { ...s, plan }; });
      close(); toast(`${b.title} moved to ${dayWord(nk)} ${fmtMin(ns)}`, 'ok');
    } }, 'Save'), h('button', { class: 'btn grow', onClick: () => close() }, 'Cancel')),
  ]);
}

// Known apps: display defaults when a status file does not carry them
const APP_META = {
  yuzu: { title: 'Yuzu', icon: '🍋', color: '#f2d34b', url: 'https://yuzu-cards.github.io/Yuzu/' },
  mephisto: { title: 'Mephisto', icon: '🇩🇪', color: '#c58cff', url: 'https://mephisto-deutsch.github.io/Mephisto/' },
  orange: { title: 'Orange', icon: '🍊', color: '#ff7a1a', url: 'https://orange-fitness.github.io/Orange/' },
  sinus: { title: 'Sinus', icon: '💓', color: '#ff5f6d', url: 'https://sinus-ekg.github.io/Sinus-EKG/' },
  kumquat: { title: 'Kumquat', icon: '📊', color: '#ff6a13', url: 'https://kumquat-evidence.github.io/Kumquat/' },
  embergine: { title: 'Embergine', icon: '🔥', color: '#f26a1b', url: 'https://embergine.github.io/embergine/' },
};
function appMeta(name, st = {}) {
  const key = String(st.app || name || '').toLowerCase();
  const m = APP_META[key] || {};
  const mind = /^task-/.test(key) ? '◆' : /^habit-/.test(key) ? '●' : '';
  return { key, title: st.title || m.title || name, icon: st.icon || m.icon || mind || (name[0] || '?').toUpperCase(), color: st.color || m.color || '#9aa0b1', url: safeUrl(st.url || st.extra?.url) || m.url || '' };
}
function appsCard() {
  const age = (min) => min == null ? 'time unreadable' : min < 2 ? 'just now' : ago(min);
  const rows = appInfos().filter(i => i.has).map(i => ({ ...i, minutes: i.minutes || i.st.next?.minutes || i.st.estimatedMinutes || 0 }))
    .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.minutes - a.minutes);
  return h('div', { class: 'card apps-today' }, h('div', { class: 'title' }, 'Your apps'),
    h('div', { class: 'list' }, ...rows.map(({ name, st, meta, minutes, done, asks, ageMin, url }) => h('div', { class: 'item' },
      h('div', { class: 'avatar app-av', style: { '--c': meta.color }, 'aria-hidden': 'true' }, meta.icon),
      h('div', { class: 'grow' },
        h('div', { class: 'name row' }, meta.title,
          done ? h('span', { class: 'chip off mini' }, 'done today') : minutes ? h('span', { class: 'chip mini' }, `~${minutes} min`) : null),
        h('div', { class: 'meta' }, st.summary || st.next?.title || 'no summary'),
        (st.pending || []).length ? h('div', { class: 'tiny app-pend', style: { '--c': meta.color } }, st.pending.slice(0, 2).join(' · ')) : null,
        actionChips(name, st, 3),
        h('div', { class: 'tiny dim' }, [age(ageMin), asks.length ? `asks for ${asks.map(a => a.slot === 'before' ? 'time before your shift' : fmtDur(+a.minutes || 0)).join(', ')}` : ''].filter(Boolean).join(' · '))),
      url ? h('a', { class: 'btn sm', href: url, target: '_blank', rel: 'noopener', 'aria-label': `Open ${meta.title}` }, 'Open') : null))));
}

function noteCard(date) {
  const k = keyOf(date);
  const ta = h('textarea', { rows: 2, placeholder: 'Notes for today…', style: { width: '100%', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '9px 12px', resize: 'vertical' },
    onChange: (e) => store.update(s => { const v = e.target.value.trim(); const notes = { ...s.notes }; if (v) notes[k] = e.target.value; else delete notes[k]; return { ...s, notes, deleted: v ? s.deleted : store.tombstone(s, `note:${k}`) }; }, { silent: true }) }, S().notes[k] || '');
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Notes'), ta);
}

// ---------------- ROTA ----------------
let workSegDefault = 'calendar';
function renderWork() {
  const seg = rt.workSeg || workSegDefault, SEG = [['calendar', 'Calendar'], ['team', 'People'], ['nurses', 'Nurses'], ['home', 'Home'], ['career', 'Career']];
  const bar = h('div', { class: 'seg work-seg', role: 'tablist' }, SEG.map(([id, l]) => h('button', { class: seg === id ? 'active' : '', role: 'tab', 'aria-selected': seg === id ? 'true' : 'false', onClick: () => { rt.workSeg = id; render(); window.scrollTo(0, 0); } }, l)));
  const body = seg === 'team' ? PU.renderDirectory() : seg === 'nurses' ? PU.renderNurses() : seg === 'home' ? CU.renderHome() : seg === 'career' ? RU.renderCareer() : renderRota();
  return [h('h1', {}, 'Work'), bar, ...[body].flat()];
}
/** Is "me" a row in any of these (non-nurse) rotas? Without it every day would read "off" (beta T02-05). */
function meInRotas(rotas, s = S()) { return !!s.me && rotas.some(r => !isNurseRota(r) && r.people.some(p => isMe(s, p))); }
/** "Nov 2026 · GP rota, FSED, Upper Village, Nurses" chips, one per month (beta T02-18). */
function loadedMonths(s = S()) {
  const by = new Map(); for (const r of Object.values(s.rotas)) { const k = `${r.year}-${pad2(r.month)}`; (by.get(k) || by.set(k, []).get(k)).push(r); }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, rs]) => { const [y, m] = k.split('-').map(Number);
    return h('button', { class: 'chip', title: rs.map(r => UNIT_LABEL[r.unitKind] || r.unit).join(', '), onClick: () => { rt.rotaMonth = new Date(y, m - 1, 1); render(); } }, `${MONTHS[m - 1].slice(0, 3)} ${y} · ${rs.length} file${rs.length > 1 ? 's' : ''}`); });
}
/** The planned leave you pencilled in for a month that has no rota yet still shows (it lives in your corrections). */
const pencilled = (s, k) => { const x = s.swaps?.[k]; return x && interpretCode(x.code || '', {}, 'gp').kind === 'leave' ? x : null; };
/** One calendar cell. known: the month has a rota that has you in it; otherwise a day is "?" (unknown), never "off". */
function calCell(date, info, known, todayK) {
  const s = S(), k = keyOf(date), mine = known ? info.mine : null, shift = mine?.shift, pen = !mine ? pencilled(s, k) : null;
  const tail = known && (!shift || shift.kind === 'off') ? myDay(s, date).overnightTail : null;
  const cls = pen ? 'leave' : !known ? 'unk' : !shift || shift.kind === 'off' ? 'off' : shift.kind === 'leave' ? 'leave' : (/^[DNE]$/.test(shift.type) ? shift.type : 'other');
  const txt = pen ? 'L' : !known ? '?' : !shift || shift.kind === 'off' ? '·' : shift.kind === 'leave' ? 'L' : mine.code;
  const evs = rt.events[k] || [], plan = (s.plan[k] || []).filter(p => p.status === 'accepted'), withN = mine && shift.kind === 'work' ? overlapCount(info) : 0, site = mine && shift.kind === 'work' ? siteNoOf(mine.code) : 0;
  const open = () => { rt.rotaSel = date; daySheet(date); };
  const flags = [k === todayK ? 'today' : '', k < todayK ? 'past' : '', [5, 6].includes(date.getDay()) ? 'weekend' : '', rt.rotaSel && keyOf(rt.rotaSel) === k ? 'sel' : '', mine?.mci ? 'mci' : '', mine?.swap || pen ? 'swap' : '', tail ? 'tail' : ''].filter(Boolean).join(' ');
  return h('div', { class: `day ${flags}`, role: 'button', tabindex: '0', 'aria-label': dayLabel(date, info), onClick: open, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
    h('span', { class: 'n' }, date.getDate()),
    h('span', { class: `code ${cls}${site ? ` s${site}` : ''}` }, txt),
    withN ? h('span', { class: 'tiny dim with', title: `${withN} colleague${withN > 1 ? 's' : ''} at your site for at least half of your shift` }, `+${withN}`) : null,
    (evs.length || plan.length) ? h('span', { class: 'dots' }, ...Array.from({ length: Math.min(3, evs.length + plan.length) }, () => h('i'))) : null);
}
const siteNoOf = (code) => { const m = /^[DNE]([1-9])$/i.exec(String(code || '').trim()); return m ? Math.min(+m[1], 5) : 0; };
function renderRota() {
  const s = S();
  const m = rt.rotaMonth;
  const y = m.getFullYear(), mo = m.getMonth() + 1, MON = MONTHS[mo - 1];
  const rotas = Object.values(s.rotas).filter(r => r.year === y && r.month === mo), known = meInRotas(rotas, s);
  const head = h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('button', { class: 'btn icon', 'aria-label': 'Previous month', onClick: () => { rt.rotaMonth = new Date(y, mo - 2, 1); render(); } }, '‹'),
    h('h2', { class: 'grow', style: { textAlign: 'center', fontSize: '20px', margin: 0 } }, `${MON} ${y}`),
    h('button', { class: 'btn icon', 'aria-label': 'Next month', onClick: () => { rt.rotaMonth = new Date(y, mo, 1); render(); } }, '›'));
  // the grid is always drawn: events, plans and pencilled leave show in a month with no rota too, and a day can be opened (beta T02-18)
  const grid = h('div', { class: 'cal' });
  const first = new Date(y, mo - 1, 1), todayK = keyOf(new Date()), days = new Date(y, mo, 0).getDate();
  for (let i = 0; i < first.getDay(); i++) grid.append(h('div', { class: 'day pad' }));
  for (let d = 1; d <= days; d++) { const date = new Date(y, mo - 1, d); grid.append(calCell(date, dayInfo(s, date), known, todayK)); }
  // why days show "?": no rota for the month, nobody picked as you, or you're not a row in what's loaded
  const others = rotas.map(r => UNIT_LABEL[r.unitKind] || r.unit).join(', ');
  const banner = !rotas.length ? h('div', { class: 'cal-note' }, h('div', { class: 'grow' }, h('b', {}, `No rota for ${MON} ${y} yet`), h('span', { class: 'tiny dim' }, 'Days show “?” until it is imported. Events, plans and planned leave still show.')),
      h('div', { class: 'row wrap' }, importButton('Import'), h('button', { class: 'btn', onClick: () => XU.leaveSheet() }, '🌴 Plan leave')))
    : !s.me ? h('div', { class: 'cal-note' }, h('div', { class: 'grow' }, h('b', {}, 'Which row is you?'), h('span', { class: 'tiny dim' }, 'Pick it once and the calendar shows your shifts.')), h('button', { class: 'btn primary', onClick: () => mePicker() }, 'Pick your row'))
    : !known ? h('div', { class: 'cal-note warn' }, h('div', { class: 'grow' }, h('b', {}, `You’re not in the ${MON} rotas loaded`), h('span', { class: 'tiny dim' }, `Loaded: ${others}. Citrus has you as ${s.me.name}${s.me.id ? ` (ID ${s.me.id})` : ''}: import the GP rota, or pick your row. No day here counts as off until then.`)),
      h('div', { class: 'row wrap' }, importButton('Import GP rota'), h('button', { class: 'btn', onClick: () => mePicker() }, 'Pick your row')))
    : null;
  const used = new Set([...grid.querySelectorAll('.code')].map(c => c.classList[1]));
  const key = [['D', 'D day'], ['N', 'N night'], ['E', 'E evening'], ['other', 'other', 'SF'], ['leave', 'L leave'], ['unk', '? unknown']].filter(([c]) => c !== 'unk' || used.has('unk'));
  const calCard = h('div', { class: 'card cal-card' }, banner, h('div', { class: 'cal-head' }, ...DAY_SHORT.map(x => h('span', {}, x))), grid,
    h('div', { class: 'chips cal-key', style: { marginTop: '10px' } }, ...key.map(([c, l, chipCls]) => h('span', { class: `chip ${chipCls || c}` }, l)), h('span', { class: 'chip mci' }, '🚨 MCI 2nd'), known ? h('span', { class: 'chip tail-key' }, h('i'), 'after a night') : null));
  const out = [];
  if (!rotas.length) {
    const loaded = loadedMonths(s);
    if (loaded.length) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Loaded rotas'), h('div', { class: 'chips' }, ...loaded)));
    return [head, h('div', { class: 'cols' }, h('div', {}, calCard), h('div', {}, ...out))];
  }
  // month numbers and the labor verdict only mean something when you are in the rota: "30 days off · All clear" was a lie (beta T02-05)
  const sum = known ? monthSummary(s, y, mo) : null;
  const monthNum = known ? XU.monthCard(y, mo) : null;   // its numbers repeat "Your month", so only one of the two is drawn (beta T01-27, T02-16)
  if (sum && !monthNum) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your month'),
    h('div', { class: 'grid2' }, stat(sum.work, 'shifts'), stat(sum.nights, 'nights'), stat(`${sum.hours}h`, 'rostered hours'), stat(sum.off, 'days off')),
    h('div', { class: 'chips', style: { marginTop: '10px' } }, ...Object.entries(sum.siteCount).map(([k, v]) => h('span', { class: 'chip' }, `${k} × ${v}`)))));
  { const uc = CHU.updatesCard(); if (uc) out.push(uc); }
  if (monthNum) out.push(monthNum);
  if (known) { const lc = LU.laborCard(y, mo); if (lc) out.push(lc); }
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Sources'),
    h('div', { class: 'list' }, ...rotas.map(r => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, UNIT_LABEL[r.unitKind] || r.unit), h('div', { class: 'meta' }, `${r.people.length} people · ${r.sourceName || 'imported'} · ${new Date(r.importedAt).toLocaleDateString('en-GB')}`)),
      h('button', { class: 'btn sm ghost danger', onClick: () => { if (confirm(`Remove ${UNIT_LABEL[r.unitKind]} ${MONTHS[r.month - 1]}?`)) store.update(x => { const rotas = { ...x.rotas }; delete rotas[r.id]; let deleted = store.tombstone(x, `rota:${r.id}`); if (r.driveId) deleted = { ...deleted, [`drive:${r.driveId}`]: Date.now() }; return { ...x, rotas, deleted }; }); } }, 'Remove')))),
    h('div', { class: 'row wrap', style: { marginTop: '10px' } }, importButton('Import / update files'), G.isSignedIn() ? h('button', { class: 'btn', onClick: () => refreshAll(true) }, '☁ Pull from Drive') : null)));
  const gp = rotas.find(r => r.unitKind === 'gp');
  if (gp) { const lg = legendRows(gp); out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Shift codes'),
    h('div', { class: 'lg-rows' }, ...lg.rows.map(r => h('div', { class: `lg-row ${r.kind}` }, h('b', {}, r.codes), h('span', { class: 'grow' }, r.what), r.hours ? h('span', { class: 'tiny dim lg-h' }, r.hours) : null))),
    lg.marks.length ? h('div', { class: 'tiny dim', style: { marginTop: '8px' } }, `Also marked in the rota by colour: ${lg.marks.join(' · ')}`) : null)); }
  // desktop: month grid on the left, everything else on the right
  return [head, h('div', { class: 'cols' }, h('div', {}, calCard), h('div', {}, ...out))];
}
const hh = (m) => pad2(Math.floor(m / 60) % 24);
const hm = (m) => `${hh(m)}:${pad2(m % 60)}`;
/** Your shift with everyone who shares part of it: bars on one axis, solid where they overlap yours, faded where they don't. */
function overlapCard(info, today) {
  const others = [...info.withMe, ...info.alsoAtSite], m = overlapModel(info.mine, others); if (!m) return null;
  const [a0, a1] = m.axis, W = a1 - a0, pct = (t) => `${((t - a0) / W * 100).toFixed(2)}%`, wpct = (x, y) => `${((y - x) / W * 100).toFixed(2)}%`;
  const same = new Set(info.withMe.map(e => personKeyOf(e.person)));
  const dup = (e) => m.rows.filter(r => firstName(r.entry.person.name) === firstName(e.person.name)).length > 1, label = (e) => { if (!dup(e)) return firstName(e.person.name); const w = e.person.name.replace(/^Dr\.?\s*/i, '').split(/\s+/); return `${w[0]} ${w[1]?.[0] || ''}.`.trim(); };
  const full = m.alone.length === 0, soloMin = m.alone.reduce((t, [x, y]) => t + (y - x), 0);
  const headline = !m.rows.length ? 'Nobody else overlaps your shift' : full ? `Someone is with you the whole shift` : `You’re on your own ${m.alone.map(([x, y]) => `${hm(x)}–${hm(y % 1440 || 1440)}`).join(', ')} (${fmtDur(soloMin)})`;
  const ticks = []; for (let t = Math.ceil(a0 / 180) * 180; t <= a1; t += 180) ticks.push(h('span', { class: 'ov-tick', style: { left: pct(t) } }, h('small', {}, hh(t))));
  // how many others are in with you, minute by minute → a coverage strip under your own bar
  const edges = [...new Set([m.me[0], m.me[1], ...m.rows.flatMap(r => [r.from, r.to])])].sort((x, y) => x - y), cov = [];
  for (let i = 0; i < edges.length - 1; i++) { const mid = (edges[i] + edges[i + 1]) / 2, n = m.rows.filter(r => r.from <= mid && mid < r.to).length; cov.push(h('i', { class: `ov-cv n${Math.min(n, 4)}`, title: `${hm(edges[i])}–${hm(edges[i + 1])}: ${n} with you`, style: { left: pct(edges[i]), width: wpct(edges[i], edges[i + 1]) } })); }
  const rows = m.rows.slice(0, 12).map(r => { const e = r.entry, sameShift = same.has(personKeyOf(e.person)), kind = e.shift.type;
    return h('button', { class: `ov-row ${sameShift ? 'same' : 'part'}`, onClick: () => personSheet(e.person), title: `${e.person.name} · ${e.shift.label} ${hm(r.start)}–${hm(r.end)}` },
      h('span', { class: 'ov-name' }, h('span', { class: 'av' }, initials(e.person.name)), h('span', { class: 'ellipsis' }, label(e))),
      h('span', { class: 'ov-track' }, h('i', { class: `ov-ghost ${kind}`, style: { left: pct(r.start), width: wpct(r.start, r.end) } }), h('i', { class: `ov-in ${kind}`, style: { left: pct(r.from), width: wpct(r.from, r.to) } })),
      h('span', { class: 'ov-pct' }, r.pct >= 0.995 ? 'all' : `${Math.round(r.pct * 100)}%`, h('small', {}, sameShift ? 'same shift' : `${fmtDur(r.overlap)} · ${kind}`)));
  });
  const type = today.shift.type;
  return h('div', { class: 'card ov' }, h('div', { class: 'title' }, 'Who shares your shift'), h('div', { class: `ov-head ${full ? 'ok' : 'warn'}` }, headline),
    h('div', { class: 'ov-plot' },
      // the band sits in a copy of the rows' own grid, so it lines up with the tracks at any width (it used to start late and run off, beta T02-09)
      h('div', { class: 'ov-row ov-bandrow', 'aria-hidden': 'true' }, h('span'), h('span', { class: 'ov-track' }, h('i', { class: 'ov-band2', style: { left: pct(m.me[0]), width: wpct(m.me[0], m.me[1]) } })), h('span')),
      h('div', { class: 'ov-axis' }, h('span', { class: 'ov-name' }), h('span', { class: 'ov-track' }, ...ticks)),
      h('div', { class: 'ov-row me' }, h('span', { class: 'ov-name' }, h('span', { class: 'av' }, 'You')), h('span', { class: 'ov-track' }, h('i', { class: `ov-in ${type}`, style: { left: pct(m.me[0]), width: wpct(m.me[0], m.me[1]) } }, `${hm(m.me[0])}–${hm(m.me[1])}`)), h('span', { class: 'ov-pct' }, fmtDur(m.len))),
      h('div', { class: 'ov-row cov' }, h('span', { class: 'ov-name' }, h('span', { class: 'tiny dim' }, 'cover')), h('span', { class: 'ov-track' }, ...cov), h('span', { class: 'ov-pct' })),
      ...rows),
    m.rows.length > 12 ? h('div', { class: 'tiny dim' }, `+${m.rows.length - 12} more`) : null,
    h('div', { class: 'chips ov-key' }, h('span', { class: 'chip' }, h('i', { class: `ov-sw in ${type}` }), 'with you'), h('span', { class: 'chip' }, h('i', { class: `ov-sw ghost ${type}` }), 'their time outside your shift'),
      h('span', { class: 'chip' }, h('i', { class: 'ov-sw n0' }), '0 alone', h('i', { class: 'ov-sw n1' }), '1', h('i', { class: 'ov-sw n2' }), '2', h('i', { class: 'ov-sw n3' }), '3+ others in')));
}
/** Colleagues at your site who share at least half of your shift: 2h of a 12h night is not company (beta T02-10). */
function overlapCount(info) { const m = info.mine && info.mine.shift.kind === 'work' ? overlapModel(info.mine, [...info.withMe, ...info.alsoAtSite]) : null; return m ? m.rows.filter(r => r.pct >= 0.5).length : 0; }
function stat(v, l) { return h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l)); }
/** "Today" / "Tomorrow" / "in 5 days" / "9 days ago": the header already shows the date, so this says how far (beta T02-26). */
function relWord(date, now = new Date()) { const n = Math.round((startOfDay(date) - startOfDay(now)) / 864e5); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`; }
/** The rota's own code for your day, before your correction. */
const rawCode = (info) => info.mine ? String(info.mine.person.days[info.date.getDate()] || '') : '';

function daySheet(date) {
  const s = S();
  const info = dayInfo(s, date);
  const { today, overnightTail } = myDay(s, date);
  const k = keyOf(date), known = meInRotas(info.rotas, s), past = k < keyOf(new Date()), swap = info.mine?.swap || pencilled(s, k);
  const raw = rawCode(info), rawSh = info.mine ? interpretFor(info.mine.rota, raw) : null;
  const tailLine = (t) => h('div', { class: 'sub ds-tail' }, `Until ${fmtTime(t.window.end)} you’re still on last night’s ${t.code} (${t.shift.label})`);
  const content = [h('div', { class: 'row ds-head' }, h('h2', { class: 'grow' }, `${DAY_NAMES[date.getDay()]} ${fmtDate(date)}`), h('span', { class: 'small muted' }, relWord(date)))];
  if (today) content.push(h('div', { class: 'card hero' }, h('div', { class: 'title' }, 'Your shift'), h('div', { class: 'big' }, today.shift.label), h('div', { class: 'sub' }, `${fmtTime(today.window.start)} – ${fmtTime(today.window.end)}${today.shift.hours.overnight ? ' (next morning)' : ''} · ${fmtDur(today.shift.hours.durationMin)} · ${today.code}`),
    overnightTail ? tailLine(overnightTail) : null,
    today.mci ? h('div', { style: { marginTop: '6px' } }, mciBadge()) : null));
  if (today) { const oc = overlapCard(info, today); if (oc) content.push(oc); const nc = PU.withMeCard(info.date, info.mine); if (nc) content.push(nc); }
  else if (info.mine?.shift.kind === 'leave' || (!info.mine && swap)) {
    // planned leave is your correction (VL): say so, and what it replaces (beta T02-22)
    const planned = /^VL$/i.test(swap?.code || '') || /planned leave/i.test(swap?.note || '');
    content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, planned ? 'On leave (planned)' : (info.mine?.shift.label || 'On leave')),
      swap && rawSh?.kind === 'work' ? h('div', { class: 'sub' }, `Instead of ${raw} · ${rawSh.label}${rawSh.hours ? ` ${hoursShort(rawSh)}` : ''}`) : !info.hasRota ? h('div', { class: 'sub' }, `No rota for ${MONTHS[date.getMonth()]} yet, so Citrus can’t tell which shift it replaces`) : null));
  }
  else if (!info.hasRota) content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, overnightTail ? 'After your night' : 'Not known yet'), h('div', { class: 'sub' }, overnightTail ? `Your ${overnightTail.code} ends ${fmtTime(overnightTail.window.end)}. ` : '', `No rota for ${MONTHS[date.getMonth()]} ${date.getFullYear()} is loaded.`), h('div', { class: 'row', style: { marginTop: '10px' } }, importButton('Import'))));
  else if (s.me && !known) content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, 'You’re not in these rotas'), h('div', { class: 'sub' }, `Loaded for ${MONTHS[date.getMonth()]}: ${info.rotas.map(r => UNIT_LABEL[r.unitKind] || r.unit).join(', ')}. Import the GP rota or pick your row; until then this day is unknown, not off.`), h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: () => { topSheet()?.remove(); mePicker(); } }, 'Pick your row'))));
  else if (s.me) content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, overnightTail ? 'Off after night' : 'Day off'), overnightTail ? h('div', { class: 'sub' }, `Your ${overnightTail.code} ends ${fmtTime(overnightTail.window.end)}; the rest of the day is yours`) : null));
  // all sites
  const siteOrder = Object.keys(info.bySite).sort();
  if (siteOrder.length) content.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'GP coverage'),
    ...siteOrder.map(site => {
      const list = info.bySite[site].sort((a, b) => (a.shift.type > b.shift.type ? 1 : -1));
      return h('div', { class: 'site-group' }, h('h3', {}, site, h('span', { class: 'tiny dim' }, `${list.length}`)), h('div', { class: 'people' }, ...list.map(e => personPill(e))));
    })));
  if (info.fsed.length || info.uv.length || info.lv.length) content.push(onCallCard(info));
  if (info.leave.length) content.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'On leave'), h('div', { class: 'people' }, ...info.leave.map(e => personPill(e)))));
  if (info.off.length) content.push(h('div', { class: 'card' }, h('div', { class: 'title' }, `Off today (${info.off.length})`), h('div', { class: 'people' }, ...info.off.map(e => personPill(e)))));
  const evs = rt.events[k] || [];
  const plan = (s.plan[k] || []).filter(p => p.status === 'accepted' || p.status === 'done');
  if (evs.length || plan.length) content.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Calendar & plan'),
    ...evs.map(ev => h('div', { class: 'row small', style: { padding: '4px 0' } }, h('b', {}, ev.allDay ? 'all day' : fmtTime(ev.start)), h('span', {}, ev.title))),
    ...plan.map(p => h('div', { class: 'row small', style: { padding: '4px 0' } }, h('b', {}, fmtMin(p.start)), h('span', { style: { color: s.goals.find(g => g.id === p.goalId)?.color } }, p.title), p.status === 'done' ? '✓' : null))));
  if (info.mine?.swap) content.splice(1, 0, h('div', { class: 'row small', style: { margin: '6px 0 10px' } }, h('span', { class: 'chip swap' }, 'corrected'), h('span', { class: 'muted' }, [`rota: ${raw || 'off'}`, info.mine.swap.with ? `swapped with ${info.mine.swap.with}` : '', info.mine.swap.note].filter(Boolean).join(' · '))));
  // cover is for days ahead (beta T02-02); a correction needs your row in the rota
  content.push(h('div', { class: 'row wrap' }, h('button', { class: 'btn grow', onClick: () => { topSheet()?.remove(); rt.planFrom = startOfDay(date); regenerate(); show('plan'); } }, 'Plan this day'),
    known && !past && info.hasRota ? h('button', { class: 'btn grow', onClick: () => { topSheet()?.remove(); swapHelper(date); } }, 'Who could cover?') : null,
    known ? h('button', { class: 'btn grow', onClick: () => { topSheet()?.remove(); swapSheet(date); } }, info.mine?.swap ? 'Edit correction' : 'Correct this day') : null));
  const r = sheet(content); r.box.parentElement.dataset.daySheet = k;
}

// Swap helper: who is off on this date, and which of my days they could take
function swapHelper(date) {
  const s = S();
  const info = dayInfo(s, date);
  const candidates = info.off.filter(e => !isMe(s, e.person));
  const prevN = dayInfo(s, addDays(date, -1)).entries.filter(e => e.shift.type === 'N').map(e => personKeyOf(e.person));
  // a day that has started is history: nobody can cover it now, so say that instead of listing who was off (D13 follow-up)
  if (startOfDay(date) < startOfDay(new Date())) { sheet([h('h2', {}, `Cover for ${fmtDateShort(date)}`), h('p', { class: 'small muted' }, 'This day is in the past. To record what really happened, use “Correct this day” in the day sheet.')]); return; }
  const sw = XU.swapBlock(date, personSheet);
  sheet([h('h2', {}, `Cover for ${fmtDateShort(date)}`), h('div', { class: 'small muted', style: { margin: '6px 0 12px' } }, `GP colleagues who are off that day${info.mine ? ` (you: ${info.mine.code || 'off'})` : ''}. Night-before is flagged.`),
    sw,
    h('div', { class: 'title', style: { margin: '10px 0 4px' } }, 'Anyone who is off'),
    h('div', { class: 'list' }, ...candidates.map(e => h('div', { class: 'item clickable', onClick: () => personSheet(e.person) },
      h('div', { class: 'avatar' }, initials(e.person.name)), h('div', { class: 'grow' }, h('div', { class: 'name' }, e.person.name), h('div', { class: 'meta' }, [e.person.title, prevN.includes(personKeyOf(e.person)) ? '⚠ night before' : '', sharedShifts(s, personKeyOf(e.person)).length + ' shared shifts'].filter(Boolean).join(' · '))),
      telLink(e.person.mobile) ? h('a', { class: 'btn sm', href: telLink(e.person.mobile).wa, target: '_blank', onClick: ev => ev.stopPropagation() }, '💬') : null)))]);
}

// ---------------- TEAM ----------------
// ---------------- next month's rota reminder ----------------
// From the 22nd, if no rota for next month is loaded, say so (the files arrive late in the month).
function rotaReminder(now = new Date()) {
  const s = S();
  if (now.getDate() < 22 || !Object.keys(s.rotas).length) return null;
  const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const have = Object.values(s.rotas).some(r => r.year === nm.getFullYear() && r.month === nm.getMonth() + 1);
  if (have) return null;
  const key = `citrus.rotaNudge.${nm.getFullYear()}-${nm.getMonth() + 1}`;
  try { if (localStorage.getItem(key)) return null; } catch {}
  return { month: nm, key };
}
function rotaReminderCard() {
  const r = rotaReminder(); if (!r) return null;
  const folder = G.knownFolderIds()[`${S().settings.driveFolder}/Rotas`];
  return h('div', { class: 'banner' }, h('span', { class: 'grow' }, `${MONTHS[r.month.getMonth()]}'s rota isn't here yet. Drop the files in Drive › Rotas (or import them) and Citrus picks them up.`),
    folder ? h('a', { class: 'btn sm', href: `https://drive.google.com/drive/folders/${folder}`, target: '_blank', rel: 'noopener' }, 'Open Rotas') : h('button', { class: 'btn sm', onClick: () => show('rota') }, 'Import'),
    h('button', { class: 'btn sm ghost', 'aria-label': 'Dismiss', onClick: () => { try { localStorage.setItem(r.key, '1'); } catch {} render(); } }, '✕'));
}

// ---------------- PLAN ----------------
function regenerate() {
  const s = S();
  const from = rt.planFrom || startOfDay(new Date());
  const sg = suggest(s, from, 10, rt.events, { ...mergedApps(), ...M.mindAsks(s, from, 10) }, appMeta);
  // your own moves and the Tonight card's bedtime win over the planner (beta T06-03, T01-19); the result keeps its .days / .notes
  for (const k of Object.keys(sg)) {
    const moved = new Set((s.plan[k] || []).filter(p => p.status === 'moved').map(p => p.goalId));
    const bed = PV.dailyBed(s, fromKey(k)), cut = bed != null && bed < 1440 ? bed - 30 : null;
    const kept = sg[k].filter(b => !moved.has(b.goalId)), fits = kept.filter(b => cut == null || b.kind === 'rest' || b.end <= cut);
    if (fits.length < kept.length) (sg.notes[k] ||= []).push(`${kept.filter(b => !fits.includes(b)).map(b => b.title).join(', ')} left out: be asleep by ${fmtMin(bed)} for tomorrow's start.`);
    if (fits.length) sg[k] = fits; else delete sg[k];
  }
  rt.suggestions = sg;
  publishPlanSoon();
}
// hub/citrus/plan.json: what Citrus planned for the next days, per app, plus your shifts — read by Mephisto & co.
let planTimer = null;
function publishPlanSoon() { clearTimeout(planTimer); planTimer = setTimeout(publishPlan, 4000); }
async function publishPlan() {
  if (!G.isSignedIn() || !rt.online) return;
  const s = S();
  const from = startOfDay(new Date());
  const days = {}, blocks = [];
  for (let i = 0; i < 10; i++) {
    const date = addDays(from, i); const k = keyOf(date);
    const { today } = myDay(s, date);
    const shift = today ? { code: today.code, label: today.shift.label, site: today.shift.site, start: fmtMin(today.shift.hours.start), end: fmtMin(today.shift.hours.end), overnight: !!today.shift.hours.overnight, mci: !!today.mci } : null;
    const list = [...(s.plan[k] || []).filter(p => p.status === 'accepted' || p.status === 'done'), ...(rt.suggestions[k] || [])].sort((a, b) => a.start - b.start)
      .map(p => ({ app: /^app:(task|habit)-/.test(p.goalId || '') ? 'citrus' : (p.app || guessApp(p.title)), title: p.title, date: k, start: fmtMin(p.start), end: fmtMin(p.end), minutes: p.end - p.start, status: p.status, goalId: p.goalId }));
    days[k] = { shift, blocks: list };
    blocks.push(...list);
  }
  try { await G.writePlan(s.settings.driveFolder, { app: 'citrus', contract: CONTRACT, updatedAt: new Date().toISOString(), from: keyOf(from), days, blocks, mind: M.mindSummary(s, new Date(), mergedApps()) }); } catch (e) { console.warn('plan.json', e.message); }
}
function guessApp(title) { const t = String(title || '').toLowerCase(); for (const k of Object.keys(APP_META)) if (t.includes(k)) return k; if (/german|deutsch/.test(t)) return 'mephisto'; if (/gym|workout|lift/.test(t)) return 'orange'; if (/ecg|ekg/.test(t)) return 'sinus'; if (/card|review|anki/.test(t)) return 'yuzu'; return ''; }

/** The Plan tab: a weekly cockpit (balance of rest / study / gym / social, goals, a day strip), then one card per day.
 *  Day cards sit side by side on wide screens (beta T06-25). */
function renderPlan() {
  const s = S(), now = new Date(), from = rt.planFrom || startOfDay(now);
  if (!rt.suggestions.days) regenerate();   // the planner's day labels and notes come with a run
  const horizon = planHorizon(), days = Array.from({ length: horizon }, (_, i) => planDay(addDays(from, i)));
  const offToday = keyOf(from) !== keyOf(now);
  const out = [h('div', { class: 'pl-head' }, h('h1', {}, 'Plan'),
    h('div', { class: 'seg pl-seg', role: 'group', 'aria-label': 'How far ahead' }, ...[[3, '3 days'], [7, 'Week'], [10, '10 days']].map(([n, label]) => h('button', { class: horizon === n ? 'active' : '', 'aria-pressed': String(horizon === n), onClick: () => { setPlanHorizon(n); render(); } }, label))),
    offToday ? h('button', { class: 'btn sm ghost', onClick: () => { rt.planFrom = null; regenerate(); render(); } }, 'From today') : null,
    h('button', { class: 'btn sm', title: 'Plan again from now', onClick: () => { rt.planFrom = null; regenerate(); render(); toast('Plan redone from now'); } }, 'Regenerate'))];
  if (!Object.keys(s.rotas).length || !s.me) out.push(h('div', { class: 'banner' }, h('span', { class: 'grow' }, !Object.keys(s.rotas).length ? 'No rota loaded, so every day is planned as a free day. Import your rota first.' : 'Pick your row in Settings › Me so the plan can work around your shifts.'),
    h('button', { class: 'btn sm', onClick: () => show(!Object.keys(s.rotas).length ? 'rota' : 'more') }, !Object.keys(s.rotas).length ? 'Import' : 'Settings')));
  out.push(planWeekCard(days, now));
  const rv = reviewCard(); if (rv) out.push(rv);
  out.push(h('div', { class: 'plan-days' }, ...days.map(d => planDayCard(d, now))));
  return out;
}

/** This week at a glance: four balance tiles, each goal's done / planned / suggested bar, the day strip and the actions. */
function planWeekCard(days, now) {
  const s = S(), ws = weekStartOf(now), we = addDays(ws, 6), goals = s.goals || [];
  const wk = goals.map(g => ({ g, ...PV.goalWeek(s, g, ws, rt.suggestions, now) }));
  // work this week, against the 48h limit
  let work = 0, off = 0; for (let i = 0; i < 7; i++) { const t = myDay(s, addDays(ws, i)).today; if (t) work += t.shift.hours?.durationMin || (t.shift.hours ? (t.shift.hours.overnight ? t.shift.hours.end + 1440 - t.shift.hours.start : t.shift.hours.end - t.shift.hours.start) : 0); else off++; }
  // rest: naps / rest windows planned this week, plus the days off
  let restMin = 0; for (let i = 0; i < 7; i++) { const k = keyOf(addDays(ws, i)); for (const b of [...(s.plan[k] || []).filter(p => p.status === 'accepted' || p.status === 'done'), ...(rt.suggestions[k] || [])]) if (PV.pillarOf(b, goals) === 'rest') restMin += Math.max(0, b.end - b.start) || 0; }
  const tiles = PV.PILLARS.map(p => {
    if (p.id === 'rest') return h('div', { class: 'pl-pill', style: { '--c': p.color } }, h('div', { class: 'k' }, p.label), h('div', { class: 'v' }, `${off}`, h('small', {}, ` day${off === 1 ? '' : 's'} off`)), h('div', { class: 's' }, restMin ? `${fmtDur(restMin)} naps & rest` : 'no naps planned'));
    const mine = wk.filter(x => PV.pillarOf({ kind: x.g.kind }, goals) === p.id && !x.paused), target = mine.reduce((a, x) => a + x.target, 0), done = mine.reduce((a, x) => a + x.done, 0), acc = mine.reduce((a, x) => a + x.acc, 0), sugg = mine.reduce((a, x) => a + x.sugg, 0);
    const pct = (v) => `${target ? Math.min(100, v / target * 100) : 0}%`;
    return h('div', { class: `pl-pill${!target ? ' none' : done + acc + sugg < target ? ' short' : ''}`, style: { '--c': p.color } }, h('div', { class: 'k' }, p.label),
      h('div', { class: 'v' }, fmtDur(done + acc + sugg), h('small', {}, target ? ` / ${fmtDur(target)}` : ' · no goal')),
      h('div', { class: 'pl-bar', 'aria-hidden': 'true' }, h('i', { class: 'd', style: { width: pct(done) } }), h('i', { class: 'a', style: { width: pct(acc) } }), h('i', { class: 's', style: { width: pct(sugg) } })),
      h('div', { class: 's' }, done ? `${fmtDur(done)} done` : acc ? `${fmtDur(acc)} accepted` : sugg ? 'suggested only' : target ? 'nothing planned' : ''));
  });
  const goalRows = wk.map(({ g, done, acc, sugg, target, subject, paused }) => h('div', { class: `pl-goal${paused ? ' paused' : ''}`, style: { '--c': g.color || 'var(--orange)' } },
    h('span', { class: 'dot' }), h('span', { class: 'n' }, g.name, subject ? h('small', {}, ` + ${subject} log`) : null),
    h('span', { class: 'pl-bar', 'aria-hidden': 'true' }, ...(paused ? [] : [h('i', { class: 'd', style: { width: `${Math.min(100, done / target * 100)}%` } }), h('i', { class: 'a', style: { width: `${Math.min(100, acc / target * 100)}%` } }), h('i', { class: 's', style: { width: `${Math.min(100, sugg / target * 100)}%` } })])),
    h('span', { class: 'm' }, paused ? 'paused' : `${fmtDur(done + acc)}${sugg ? ` +${fmtDur(sugg)}` : ''} / ${fmtDur(target)}`)));
  // the strip: one cell per visible day, work and each pillar stacked
  const strip = h('div', { class: 'pl-strip', style: { '--n': days.length } }, ...days.map(d => {
    const load = PV.dayLoad(d.rows, goals), tot = Math.max(1, 16 * 60), t = d.ctx.today, sh = (v) => `${Math.min(100, v / tot * 100)}%`;
    const code = t ? (t.code || t.shift.label) : d.info.mode === 'unknown' ? '?' : d.ctx.afterNight ? 'post-N' : 'off';
    return h('button', { class: `pl-cell${d.k === keyOf(now) ? ' today' : ''}`, title: `${DAY_NAMES[d.date.getDay()]}: ${d.info.label || ''}`, onClick: () => document.getElementById(`pd-${d.k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      h('span', { class: 'dn' }, DAY_SHORT[d.date.getDay()]), h('span', { class: 'dd' }, String(d.date.getDate())),
      h('span', { class: `cd ${t ? (t.shift.hours?.overnight ? 'N' : 'D') : d.ctx.afterNight ? 'N' : 'off'}` }, code),
      h('span', { class: 'stack', 'aria-hidden': 'true' }, h('i', { class: 'w', style: { height: sh(load.work) } }), h('i', { class: 'rest', style: { height: sh(load.rest) } }), h('i', { class: 'study', style: { height: sh(load.study) } }), h('i', { class: 'gym', style: { height: sh(load.gym) } }), h('i', { class: 'social', style: { height: sh(load.social) } })));
  }));
  const nSugg = days.reduce((a, d) => a + (rt.suggestions[d.k] || []).length, 0);
  return h('div', { class: 'card plan-week' },
    h('div', { class: 'row' }, h('div', { class: 'title grow' }, `This week · ${pad2(ws.getDate())}/${pad2(ws.getMonth() + 1)}–${pad2(we.getDate())}/${pad2(we.getMonth() + 1)}`), work ? h('span', { class: `chip${work > 48 * 60 ? ' warn' : ''}` }, `work ${fmtDur(work)}${work > 48 * 60 ? ` · ${fmtDur(work - 48 * 60)} over 48h` : ''}`) : null),
    h('div', { class: 'pl-pills' }, ...tiles),
    h('div', { class: 'pl-goals' }, ...goalRows),
    h('div', { class: 'pl-key tiny dim' }, h('i', { class: 'd' }), 'done', h('i', { class: 'a' }), 'accepted', h('i', { class: 's' }), 'suggested'),
    strip,
    h('div', { class: 'row pl-acts' }, h('button', { class: 'btn sm', onClick: goalsSheet }, 'Edit goals'), h('button', { class: 'btn sm', onClick: rulesSheet }, 'Rules'), h('span', { class: 'grow' }),
      h('button', { class: 'btn sm primary', disabled: nSugg ? null : true, onClick: acceptAllVisible }, nSugg ? `Accept ${nSugg} in ${planHorizon() === 7 ? 'the week' : `${planHorizon()} days`}` : 'All accepted')));
}

/** A 24-hour ribbon: sleep, shift and blocks at a glance, with a "now" tick on today. */
function dayRibbon(d, nowMin) {
  const seg = (a, b, cls, c) => h('i', { class: cls, style: { left: `${Math.max(0, a) / 14.4}%`, width: `${Math.max(0.4, (Math.min(1440, b) - Math.max(0, a)) / 14.4)}%`, '--c': c } });
  const parts = [];
  for (const b of d.ctx.busy) if (b.kind === 'sleep') parts.push(seg(b.start, b.end, b.rest && b.rest !== 'winddown' ? 'rest' : 'sl'));
  for (const r of d.rows) {
    if (r.type === 'shift') parts.push(seg(r.start, r.end, r.night ? 'sh n' : 'sh'));
    else if (r.type === 'event') parts.push(seg(r.start, r.end, 'ev'));
    else if (r.type === 'block') parts.push(seg(r.block.start, r.block.end, `bk${r.block._acc ? '' : ' sg'}`, S().goals.find(g => g.id === r.block.goalId)?.color || r.block.color || 'var(--orange)'));
  }
  if (nowMin != null) parts.push(h('b', { class: 'now', style: { left: `${nowMin / 14.4}%` } }));
  return h('div', { class: 'pl-rib', 'aria-hidden': 'true' }, ...parts);
}

function planDayCard(d, now) {
  const { k, date, ctx, rows, info, notes } = d, rel = relDay(date, now);
  // "Today · Friday 13/11", but just "Sunday 15/11" further out (beta T06-27, T10-28)
  const name = `${DAY_NAMES[date.getDay()]} ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`, title = rel === 'Today' || rel === 'Tomorrow' ? `${rel} · ${name}` : name;
  const chip = ctx.today ? shiftChip(ctx.today.shift, ctx.today.code) : info.mode === 'unknown' ? h('span', { class: 'chip' }, 'rota unknown') : ctx.afterNight ? h('span', { class: 'chip N' }, 'post-night') : h('span', { class: 'chip off' }, info.mode === 'recovery' ? 'recovery' : 'off');
  const blocks = rows.filter(r => r.type === 'block');
  const empty = info.mode === 'unknown' ? null : ctx.today && /rest/.test(info.label || '') ? 'Evening kept for rest.' : ctx.today || ctx.afterNight ? 'Nothing extra: rest around your shift.' : 'Nothing planned.';
  const planned = blocks.reduce((a, r) => a + (r.block.end - r.block.start), 0);
  return h('div', { class: `card plan-day mode-${info.mode || 'free'}${k < keyOf(now) ? ' past' : ''}`, id: `pd-${k}` },
    h('div', { class: 'pd-head' }, h('div', { class: 'title' }, title), blocks.length ? h('span', { class: 'tiny dim' }, `${blocks.length} · ${fmtDur(planned)}`) : null, chip),
    info.label ? h('div', { class: 'pl-mode' }, capFirst(info.label)) : null,
    dayRibbon(d, k === keyOf(now) ? now.getHours() * 60 + now.getMinutes() : null),
    ...notes.map(n => h('div', { class: 'pl-note' }, n)),
    h('div', { class: 'pl-rows' }, ...rows.map(r => r.type === 'block' ? blockRow(r.block, date, info.label) : h('div', { class: `pl-fix ${r.type}${r.night ? ' night' : ''}${r.lights ? ' lights' : ''}` }, h('span', { class: 'pl-time' }, r.time), h('span', { class: 't' }, r.label), r.sub ? h('span', { class: 'pl-sub' }, r.sub) : null))),
    !blocks.length && empty ? h('div', { class: 'pl-empty' }, empty) : null);
}
// How many days the Plan tab shows (suggestions and plan.json still cover 10, so other apps see the full picture)
function planHorizon() { if (!rt.planDays) { try { rt.planDays = +localStorage.getItem('citrus.planDays') || 3; } catch { rt.planDays = 3; } } if (![3, 7, 10].includes(rt.planDays)) rt.planDays = 3; return rt.planDays; }
function setPlanHorizon(n) { rt.planDays = n; try { localStorage.setItem('citrus.planDays', String(n)); } catch {} }
function acceptAllVisible() {
  const shown = new Set(Array.from({ length: planHorizon() }, (_, i) => keyOf(addDays(rt.planFrom || startOfDay(new Date()), i))));
  const all = Object.entries(rt.suggestions).filter(([k]) => shown.has(k)).flatMap(([k, list]) => list.map(b => [k, b]));
  if (!all.length) return toast('No suggestions to accept');
  const days = new Set(all.map(([k]) => k)).size, toCal = G.isSignedIn() && S().settings.pushPlan !== false, nCal = all.filter(([, b]) => b.kind !== 'rest').length;
  const { close } = sheet([h('h2', {}, `Accept ${all.length} blocks?`),
    h('p', { class: 'small muted' }, `${all.length} suggestions across ${days} day${days > 1 ? 's' : ''}${toCal ? `; ${nCal} go to your Google Calendar (naps and rest stay in Citrus)` : ''}. You can remove any of them later from Plan.`),
    h('div', { class: 'row' }, h('button', { class: 'btn primary grow', onClick: async () => { close(); for (const [k, b] of all) await acceptBlock(k, b, { silent: true }); toast(`Planned ${all.length} blocks`, 'ok'); render(); } }, `Accept ${all.length}`),
      h('button', { class: 'btn grow', onClick: () => close() }, 'Cancel'))]);
}

/** A labelled field with an error line under it (labels left-aligned, beta T06-26). */
function fld(label, input, key) { input.id ||= `f-${uid()}`; return h('div', { class: 'rs-f', dataset: { k: key || input.name || '' } }, h('label', { for: input.id }, label), input, h('div', { class: 'fe', role: 'alert' })); }
function showErrors(root, errors) {
  for (const f of root.querySelectorAll('.rs-f')) { const m = errors[f.dataset.k] || ''; f.querySelector('.fe').textContent = m; f.classList.toggle('bad', !!m); f.querySelector('input,select')?.setAttribute('aria-invalid', m ? 'true' : 'false'); }
}

function goalsSheet() {
  const s = S();
  const list = h('div', { class: 'gs-list' }, ...s.goals.map(g => goalRow(g)));
  const { close } = sheet([h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Goals'), h('button', { class: 'btn sm', onClick: () => { const r = goalRow({ id: store.newId('g-'), name: '', kind: 'study', hoursPerWeek: 2, minBlock: 30, maxBlock: 90, priority: s.goals.length + 1, color: '#ff7a1a' }); list.append(r); r.querySelector('[name=name]').focus(); } }, '+ Add')),
    h('div', { class: 'small muted', style: { margin: '4px 0 10px' } }, 'Weekly budgets drive the planner. 0 h pauses a goal. Name a goal after an app (Yuzu, Mephisto…) and its Drive status steers the block length.'),
    list,
    h('div', { class: 'row sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => {
      let bad = 0;
      const goals = [...list.querySelectorAll('.goal-row')].map(r => {
        const v = (n) => r.querySelector(`[name=${n}]`)?.value;
        const { goal, errors } = PV.checkGoal({ id: r.dataset.id, name: v('name'), kind: v('kind'), hoursPerWeek: v('hoursPerWeek'), minBlock: v('minBlock'), maxBlock: v('maxBlock'), priority: v('priority'), color: v('color'), deadline: v('deadline'), daily: r.querySelector('[name=daily]').checked });
        showErrors(r, errors); if (Object.keys(errors).length) bad++;
        return goal;
      });
      if (bad) { list.querySelector('.rs-f.bad input, .rs-f.bad select')?.focus(); return toast(`Fix the marked field${bad > 1 ? 's' : ''} first`, 'err'); }
      store.update(x => ({ ...x, goals })); regenerate(); close(); render(); toast('Goals saved', 'ok');
    } }, 'Save goals'), h('button', { class: 'btn grow', onClick: () => close() }, 'Cancel'))]);
  function goalRow(g) {
    const row = h('div', { class: 'card goal-row', dataset: { id: g.id } },
      h('div', { class: 'gs-top' }, h('input', { name: 'color', type: 'color', value: g.color || '#ff7a1a', 'aria-label': 'Colour' }),
        fld('Name', h('input', { name: 'name', value: g.name, placeholder: 'e.g. USMLE Step 1', maxlength: 60 })),
        h('button', { class: 'btn sm ghost danger', 'aria-label': `Delete ${g.name || 'goal'}`, onClick: () => row.remove() }, '✕')),
      h('div', { class: 'rs-grid' },
        fld('Type', h('select', { name: 'kind' }, ...[['study', 'Study'], ['habit', 'Habit'], ['fitness', 'Fitness'], ['social', 'Social'], ['rest', 'Rest'], ['other', 'Other']].map(([k, l]) => h('option', { value: k, selected: g.kind === k }, l)))),
        fld('Hours a week', h('input', { name: 'hoursPerWeek', type: 'number', step: '0.5', min: 0, max: 80, inputmode: 'decimal', value: g.hoursPerWeek })),
        fld('Priority (1 first)', h('input', { name: 'priority', type: 'number', min: 1, max: 9, inputmode: 'numeric', value: g.priority })),
        fld('Shortest block (min)', h('input', { name: 'minBlock', type: 'number', min: 5, max: 480, inputmode: 'numeric', value: g.minBlock })),
        fld('Longest block (min)', h('input', { name: 'maxBlock', type: 'number', min: 5, max: 720, inputmode: 'numeric', value: g.maxBlock })),
        fld('Deadline', h('input', { name: 'deadline', type: 'date', value: g.deadline || '' }))),
      h('label', { class: 'row small gs-daily' }, h('input', { name: 'daily', type: 'checkbox', checked: !!g.daily }), 'Every day (habit)'));
    return row;
  }
}
function lab(l, input) { return h('div', { class: 'col' }, h('label', { class: 'tiny muted' }, l), input); }

/** Planner rules, in 24-hour time, checked field by field; a blank field keeps its value (beta T06-14, T06-15, T06-26). */
function rulesSheet() {
  const r = { ...PLANNER_DEFAULTS, ...S().rules };
  const F = PV.RULE_FIELDS;
  const f = (k) => { const [label, lo, hi, unit] = F[k]; const inp = unit === 'time' ? t24(k, r[k]) : h('input', { name: k, type: 'number', inputmode: 'decimal', min: lo, max: hi, step: unit === 'h' ? '0.5' : '5', value: r[k], placeholder: String(r[k]) }); return fld(unit === 'time' ? label : `${label} (${unit})`, inp, k); };
  const prot = h('div', { class: 'rs-prot' }, ...(r.protectedBlocks || []).map(protRow));
  function protRow(b) {
    return h('div', { class: 'prot-row', dataset: { id: b.id || uid() } }, h('input', { name: 'label', value: b.label || '', placeholder: 'Label', 'aria-label': 'Label' }),
      t24('start', b.start, { 'aria-label': 'From' }), t24('end', b.end, { 'aria-label': 'Until' }),
      h('select', { name: 'days', 'aria-label': 'Days' }, h('option', { value: '', selected: !b.days?.length }, 'Daily'), ...DAY_SHORT.map((d, i) => h('option', { value: i, selected: b.days?.length === 1 && b.days[0] === i }, d)), h('option', { value: 'wk', selected: b.days?.length === 2 }, 'Fri+Sat')),
      h('button', { class: 'btn sm ghost danger', 'aria-label': 'Delete', onClick: (e) => e.target.closest('.prot-row').remove() }, '✕'));
  }
  const after12 = h('select', { name: 'after12h' }, ...[['rest', 'Rest only'], ['light', 'One light item'], ['normal', 'Plan as normal']].map(([v, l]) => h('option', { value: v, selected: r.after12h === v }, l)));
  const sect = (t, ...kids) => h('fieldset', { class: 'rs-sec' }, h('legend', {}, t), h('div', { class: 'rs-grid' }, ...kids));
  const form = h('div', { class: 'rs-form' },
    sect('Sleep', f('sleepHours'), f('sleepStart'), f('wakeMin'), f('windDownMin')),
    sect('Around shifts', f('preShiftBufferMin'), f('postShiftBufferMin'), fld('After a 12h shift', after12, 'after12h'), f('postNightRecoveryUntil'), f('recoveryWeekHours'),
      h('label', { class: 'row small rs-check' }, h('input', { name: 'napBeforeNight', type: 'checkbox', checked: r.napBeforeNight !== false }), 'Nap before the first night')),
    sect('Planning', f('earliestPlan'), f('latestPlan'), f('breakMin'), f('maxStudyOnWorkday'), f('maxStudyOnFreeDay')),
    sect('Commute (min) per site', ...Object.entries(r.commute || {}).map(([k, v]) => fld(k === 'default' ? 'Other sites' : k, h('input', { name: 'commute:' + k, type: 'number', min: 0, max: 180, inputmode: 'numeric', value: v }), 'commute:' + k))),
    h('fieldset', { class: 'rs-sec' }, h('legend', {}, 'Protected time (never planned over)'), prot, h('button', { class: 'btn sm', onClick: () => prot.append(protRow({ id: uid(), label: '', start: 19 * 60, end: 21 * 60, days: [] })) }, '+ Add protected time')));
  const { close } = sheet([h('h2', {}, 'Planner rules'), h('div', { class: 'small muted', style: { margin: '2px 0 8px' } }, 'Times are 24-hour (HH:MM). A blank field keeps its current value.'), form,
    h('div', { class: 'row sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => {
      const raw = {}; for (const k of Object.keys(F)) raw[k] = form.querySelector(`[name="${k}"]`).value;
      raw.after12h = after12.value; raw.napBeforeNight = form.querySelector('[name=napBeforeNight]').checked;
      const { rules, errors } = PV.checkRules(raw, r);
      const commute = {}; for (const el of form.querySelectorAll('[name^="commute:"]')) { const v = el.value.trim() === '' ? r.commute[el.name.slice(8)] : +el.value; if (!(v >= 0 && v <= 180)) errors[el.name] = '0–180 min'; else commute[el.name.slice(8)] = Math.round(v); }
      let protBad = false;
      const protectedBlocks = [...form.querySelectorAll('.prot-row')].map(row => { const g = (n) => row.querySelector(`[name=${n}]`).value; const a = PV.parseHM(g('start')), b = PV.parseHM(g('end')); const ok = a != null && b != null && b > a; row.classList.toggle('bad', !ok); if (!ok) protBad = true; const dv = g('days'); return { id: row.dataset.id, label: g('label').trim() || 'Protected', start: a, end: b, days: dv === '' ? [] : dv === 'wk' ? [5, 6] : [+dv] }; });
      showErrors(form, errors);
      if (Object.keys(errors).length || protBad) { form.querySelector('.rs-f.bad input, .rs-f.bad select, .prot-row.bad input')?.focus(); return toast(protBad && !Object.keys(errors).length ? 'Protected time: “until” must be after “from”' : 'Fix the marked fields first', 'err'); }
      store.update(s => ({ ...s, rules: { ...s.rules, ...rules, commute, protectedBlocks } }));
      regenerate(); close(); render(); toast('Rules saved', 'ok');
    } }, 'Save rules'), h('button', { class: 'btn grow', onClick: () => close() }, 'Cancel'))]);
}

// ---------------- MORE / SETTINGS ----------------
let appSel = '';
const ago = (min) => min == null ? 'not reporting yet' : min < 60 ? `${Math.max(1, min)} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
/** "Done" only counts for today: yesterday's completion is not today's (beta T09-01). A status without its own date uses the day it was written. */
function doneOn(st, day = keyOf(new Date())) {
  if (!st?.today?.done) return false;
  const d = st.today.date || (st.updatedAt ? keyOf(new Date(st.updatedAt)) : '');
  return d === day;
}
/** One model of each app for the Apps tab and the Today card: known apps (APP_META) plus every app that reports. */
function appInfos() {
  const apps = mergedApps(), today = keyOf(new Date()), names = [...new Set([...Object.keys(APP_META), ...Object.keys(apps)])];
  return names.map(name => {
    const st = apps[name] || {}, has = !!apps[name], meta = appMeta(name, st), ageMin = st.updatedAt ? Math.max(0, Math.round((Date.now() - new Date(st.updatedAt)) / 60000)) : null;
    const asks = (st.asks || []).filter(x => x.date === today), minutes = Math.round(asks.reduce((x, y) => x + (+y.minutes || 0), 0));
    // the badge counts ITEMS waiting (pending + due); minutes asked are their own number (beta T09-04)
    const waiting = Math.min(999, (st.pending || []).length + (st.due || 0));
    return { name, st, has, meta, ageMin, fresh: ageMin != null && ageMin <= 36 * 60, done: doneOn(st, today), doneBefore: !!st.today?.done && !doneOn(st, today), asks, minutes, waiting, url: launchUrl(name, st, null) };
  });
}
function renderApps() {
  const apps = mergedApps(), info = appInfos();
  const need = info.find(i => i.fresh && !i.done && (i.minutes || i.waiting)) || info.find(i => i.fresh) || info[0];
  if (!info.some(i => i.name === appSel)) appSel = need?.name || '';
  const cur = info.find(i => i.name === appSel), reporting = info.filter(i => i.fresh).length, totalMin = info.reduce((t, i) => t + i.minutes, 0), totalWait = info.reduce((t, i) => t + i.waiting, 0);
  const pick = (name) => { appSel = name; render(); };
  const hero = h('div', { class: 'card constel' },
    h('div', { class: 'c-stats' }, [[`${reporting}/${info.length}`, 'reporting'], [totalMin ? fmtDur(totalMin) : '–', 'asked today'], [totalWait || '–', 'items waiting']].map(([v, l]) => h('div', {}, h('b', {}, String(v)), h('span', {}, l)))),
    constellation(info.map(i => ({ key: i.name, icon: i.meta.icon, color: i.meta.color, badge: i.waiting, fresh: i.fresh, done: i.done, label: i.meta.title })), appSel, pick),
    // one keyboard picker (roving tabindex, arrow keys); the stars above are a pointer shortcut only (beta T09-06, T09-23)
    appTabs(info.map(i => ({ key: i.name, icon: i.meta.icon, color: i.meta.color, title: i.meta.title, fresh: i.fresh })), appSel, pick, 'app-panel'));
  const detail = !cur ? null : (() => {
    const { st, meta } = cur;
    const status = cur.done ? 'Done today' : cur.fresh ? `Updated ${ago(cur.ageMin)}${cur.doneBefore ? ' · done on an earlier day' : ''}`
      : cur.has && cur.ageMin == null ? 'Reporting, but its time is unreadable' : cur.ageMin == null ? 'Not reporting yet' : `Quiet for ${ago(cur.ageMin).replace(' ago', '')}`;
    const counts = [cur.minutes ? `${fmtDur(cur.minutes)} asked today` : '', cur.waiting ? `${cur.waiting} item${cur.waiting === 1 ? '' : 's'} waiting` : ''].filter(Boolean).join(' · ');
    return h('div', { class: `card app-detail ${cur.fresh ? '' : 'stale'}`, id: 'app-panel', role: 'tabpanel', 'aria-labelledby': `app-tab-${String(cur.name).replace(/[^\w-]/g, '_')}`, style: { '--c': meta.color, '--c-soft': meta.color + '26' } },
      h('div', { class: 'ad-head' }, h('div', { class: 'ic', 'aria-hidden': 'true' }, meta.icon), h('div', { class: 'grow' }, h('div', { class: 'nm' }, meta.title), h('div', { class: `ad-status ${cur.done ? 'ok' : cur.fresh ? '' : 'dim'}` }, h('i', {}), status), counts ? h('div', { class: 'tiny muted' }, counts) : null),
        cur.url ? h('a', { class: 'btn primary', href: cur.url, target: '_blank', rel: 'noopener' }, 'Open ▸') : null),
      st.summary || st.next?.title ? h('div', { class: 'ad-sum' }, st.summary || st.next.title) : null,
      !cur.has ? h('div', { class: 'dim small' }, 'Open it once and sign in with Google. It will then write its status to Drive, and Citrus picks it up here.') : null,
      (st.actions || []).length ? [h('div', { class: 'ad-h' }, 'Jump straight in'), actionChips(cur.name, st, 6)] : null,
      cur.asks.length ? [h('div', { class: 'ad-h' }, 'Asked of you today'), h('div', { class: 'ad-asks' }, cur.asks.map(a => h('div', { class: 'ad-ask' }, h('span', { class: 'grow' }, a.title || meta.title), a.minutes ? h('b', {}, `${Math.round(a.minutes)} min`) : null, a.slot ? h('small', {}, a.slot === 'before' ? 'before your shift' : 'free time') : null)))] : null,
      (st.pending || []).length ? [h('div', { class: 'ad-h' }, 'Waiting on you'), h('div', { class: 'tags' }, (st.pending || []).slice(0, 8).map(p => h('span', { class: 'chip' }, String(p).slice(0, 60))))] : null,
      (st.metrics || []).length ? [h('div', { class: 'ad-h' }, 'Numbers it reports'), h('div', { class: 'tags' }, st.metrics.slice(0, 6).map(m => h('span', { class: 'chip' }, `${m.label || m.key}: ${m.value}${m.unit ? ' ' + m.unit : ''}`)))] : null);
  })();
  return [h('h1', {}, 'Apps'), hero, detail, MU.receivedCard(), issuesCard(apps),
    h('details', { class: 'card how' }, h('summary', {}, 'How the apps talk to Citrus'),
      h('div', { class: 'small muted' }, 'Each app writes hub/<app>/status.json to Drive › My Apps › hub (summary, what it needs today as “asks”, pending items, numbers, deep links). Citrus places the asks in your plan around shifts, keeps the numbers as history for habits and objectives, and writes hub/citrus/plan.json back for the apps. A star glows when its app reported in the last 36 hours; a solid ring means done today, a dashed one that the app has gone quiet; the small number is items waiting.'))];
}

function renderMore() {
  const s = S();
  // the look of the app comes first: it is what people open Settings for most (beta T09-18)
  const out = [h('h1', {}, 'Settings'), h('div', { class: 'card' }, uiPicker())];
  // Google
  const signed = G.isSignedIn();
  const cid = h('input', { type: 'text', value: s.settings.clientId, placeholder: '1234567890-xxxx.apps.googleusercontent.com', spellcheck: false });
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Google'),
    h('div', { class: 'field' }, h('label', {}, 'OAuth client ID (from your Google Cloud project)'), cid, h('div', { class: 'tiny dim' }, 'Only the client ID — never the secret. Add this site to "Authorized JavaScript origins" in the Cloud console.')),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onClick: async () => { store.update(x => ({ ...x, settings: { ...x.settings, clientId: cid.value.trim() } }), { remote: false }); try { await G.init(cid.value.trim()); toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Save ID'),
      signed ? h('button', { class: 'btn', onClick: () => { G.signOut(); saveWatch(null); render(); } }, 'Sign out') : h('button', { class: 'btn primary', onClick: async () => { try { if (cid.value.trim() !== s.settings.clientId) { store.update(x => ({ ...x, settings: { ...x.settings, clientId: cid.value.trim() } }), { remote: false }); await G.init(cid.value.trim()); } await G.signIn({ renew: G.wasSignedIn() }).catch(() => G.signIn()); toast('Signed in', 'ok'); refreshAll(true); } catch (e) { toast(e.message, 'err'); } } }, G.wasSignedIn() ? 'Reconnect Google' : 'Sign in with Google'),
      signed ? h('button', { class: 'btn', onClick: () => refreshAll(true) }, '↻ Sync now') : null),
    signed ? h('div', { class: 'small muted', style: { marginTop: '8px' } }, `${s.google.email || 'signed in'}${s.google.lastSync ? ` · last sync ${new Date(s.google.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`) : null));
  if (signed) {
    const cals = rt.calendars;
    out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Calendars to show'),
      cals.length ? h('div', {}, ...cals.map(c => toggleRow(`${c.name}${c.primary ? ' (primary)' : ''}`, s.settings.calendarIds.includes(c.id), (on) => store.update(x => ({ ...x, settings: { ...x.settings, calendarIds: on ? [...new Set([...x.settings.calendarIds, c.id])] : x.settings.calendarIds.filter(i => i !== c.id) } }), { silent: true })))) : h('div', { class: 'muted small' }, 'Sync to load calendars'),
      h('div', { class: 'divider' }),
      toggleRow('Mirror my shifts into a "Citrus Maxima Shifts" calendar', !!s.settings.pushShifts, (on) => { store.update(x => ({ ...x, settings: { ...x.settings, pushShifts: on } })); if (on) refreshAll(true); }),
      toggleRow('Add accepted plan blocks to my calendar', s.settings.pushPlan !== false, (on) => store.update(x => ({ ...x, settings: { ...x.settings, pushPlan: on } }))),
      h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', {}, 'Drive folder'), h('input', { value: s.settings.driveFolder, onChange: (e) => store.update(x => ({ ...x, settings: { ...x.settings, driveFolder: e.target.value.trim() || 'My Apps' } })) }), h('div', { class: 'tiny dim' }, 'Rotas go in <folder>/Rotas; every app keeps its files in <folder>/hub/<app>/.')),
      h('div', { class: 'row wrap', style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', onClick: backupsSheet }, '⟲ Daily backups'),
        h('button', { class: 'btn sm', onClick: repairSheet }, '🩺 Check Drive'))));
  }
  // Me
  const people = mePeople(), byUnit = {}; for (const p of people) (byUnit[p.unit] ||= []).push(p);
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Me'),
    people.length ? h('div', { class: 'field' }, h('label', { for: 'me-select' }, 'Which row is yours?'), h('select', { id: 'me-select', onChange: (e) => { const p = people.find(x => x.key === e.target.value); setMe(p || null); } },
      h('option', { value: '' }, '— choose —'), ...Object.entries(byUnit).map(([u, ps]) => h('optgroup', { label: UNIT_LABEL[u] || u }, ...ps.map(p => h('option', { value: p.key, selected: isMe(s, p) }, `${p.name}${p.title ? ' · ' + p.title : ''}${p.id ? ' · ' + p.id : ''}`))))),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm', onClick: () => mePicker() }, '🔎 Find my row'), s.me ? h('span', { class: 'tiny dim grow' }, `Now: ${s.me.name}${s.me.id ? ` · ID ${s.me.id}` : ''}`) : null)) : h('div', { class: 'muted small' }, Object.keys(s.rotas).length ? 'Only the nurses’ schedule is loaded: import the GP rota to pick your row.' : 'Import a rota first')));
  // Apps protocol
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Connected apps'),
    h('div', { class: 'small muted' }, 'Each app writes hub/<app>/status.json under Drive › ', s.settings.driveFolder, '. Citrus shows it on Today, places the asks in your plan, and writes hub/citrus/plan.json back for the apps.'),
    h('pre', { class: 'tiny', style: { background: 'var(--bg2)', padding: '10px', borderRadius: '10px', overflow: 'auto', marginTop: '8px' } }, `hub/yuzu/status.json
{
  "app": "yuzu", "updatedAt": "2026-11-02T12:00:00Z",
  "summary": "120 cards due · 14-day streak",
  "next": { "title": "Review 120 cards", "minutes": 25 },
  "asks": [{ "date": "2026-11-02", "title": "Yuzu: reviews", "minutes": 25, "slot": "free" }],
  "pending": ["120 cards due"],
  "extra": { "streak": 14, "url": "https://yuzu-cards.github.io/Yuzu/" }
}`),
    Object.keys(mergedApps()).length ? h('div', { class: 'small', style: { marginTop: '8px' } }, 'Seen: ', Object.keys(mergedApps()).join(', ')) : null));
  out.push(alarmsCard());
  out.push(receiveTesterCard());
  out.push(diagnosticsCard());
  // Appearance + backup
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Backup and data'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onClick: downloadBackup }, '⬇ Backup'),
      (() => { const inp = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; let j; try { j = JSON.parse(await f.text()); } catch { return toast(`${f.name} is not a backup file (it isn’t JSON)`, 'err'); } restoreSheet(j, { source: f.name }); } }); return h('span', {}, inp, h('button', { class: 'btn', onClick: () => inp.click() }, '⬆ Restore')); })(),
      preRestore() ? h('button', { class: 'btn', title: `Your data as it was before the restore on ${new Date(preRestore().at).toLocaleString('en-GB')}`, onClick: undoRestore }, '↶ Undo restore') : null,
      h('button', { class: 'btn danger', onClick: eraseSheet }, 'Erase this device…')),
    h('div', { class: 'tiny dim', style: { marginTop: '10px' } }, 'Citrus Maxima · personal scheduler & hub · data lives in your browser and your own Google Drive.')));
  return out;
}
function downloadBackup() { const blob = new Blob([store.exportJSON()], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `citrus-maxima-backup-${keyOf(new Date())}.json` }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
/** Citrus's own keys on this origin. Other apps share a github.io origin, and their bridge statuses (citrus.status.*) are theirs, so they stay (beta T09-19). */
const citrusKeys = () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('citrus.') && !k.startsWith('citrus.status.')) out.push(k); } } catch {} return out; };
function eraseSheet() {
  const signed = G.isSignedIn() || G.wasSignedIn();
  const { close } = sheet([h('h2', {}, 'Erase Citrus on this device?'),
    h('p', { class: 'small' }, `This removes Citrus's data from this browser only: rotas, plan, Mind, friends, settings and the interface choice (${citrusKeys().length} saved items). Other apps on this site keep theirs.`),
    h('p', { class: 'small muted' }, signed ? 'Your Google Drive copy is not touched. If you sign in again here, the next sync brings everything back from Drive.' : 'You are not using Google sync, so nothing else holds a copy: download a backup first if you may want it back.'),
    h('div', { class: 'row wrap sh-foot' },
      h('button', { class: 'btn', onClick: downloadBackup }, '⬇ Backup first'),
      h('button', { class: 'btn danger grow', onClick: () => { for (const k of citrusKeys()) try { localStorage.removeItem(k); } catch {} close(); location.reload(); } }, 'Erase this device'),
      h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
}
function toggleRow(label, on, cb) {
  const t = h('button', { class: `toggle ${on ? 'on' : ''}`, onClick: () => { on = !on; t.classList.toggle('on', on); cb(on); } });
  return h('div', { class: 'switch' }, h('span', { class: 'small' }, label), t);
}

// ---------------- search (people, days, codes, apps, goals) ----------------
/** "21/11", "21/11/26" → a real date, or null: 31/02 and 99/99 are rejected instead of rolling over (beta T09-09). */
function parseDayQuery(q, now = new Date()) {
  const dm = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/.exec(q); if (!dm) return null;
  const y = dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : now.getFullYear(), d = new Date(y, +dm[2] - 1, +dm[1]);
  return d.getDate() === +dm[1] && d.getMonth() === +dm[2] - 1 && d.getFullYear() === y ? d : null;
}
/** A day word inside the query: today / tomorrow / yesterday / a weekday name (the next one, today included) → { date, word }. */
function dayWordIn(q, now = new Date()) {
  const t = startOfDay(now), m = /\b(today|tonight|tomorrow|tmrw|yesterday|sun|mon|tue|wed|thu|fri|sat)(?:day|s|sday|nesday|rs|rsday|urday)?\b/.exec(q); if (!m) return null;
  const w = m[1], idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(w);
  const date = w === 'today' || w === 'tonight' ? t : w === 'tomorrow' || w === 'tmrw' ? addDays(t, 1) : w === 'yesterday' ? addDays(t, -1) : addDays(t, (idx - t.getDay() + 7) % 7);
  return { date, word: m[0] };
}
const UNIT_WORDS = { nurse: 'nurse', nurses: 'nurse', gp: 'gp', doctor: 'gp', doctors: 'gp', fsed: 'fsed', specialist: 'uv', specialists: 'uv', uv: 'uv', lv: 'lv' };
function openSearch() {
  document.querySelector('.search')?.remove();
  const s = S(), now = new Date();
  const input = h('input', { placeholder: 'People, a date (21/11), N2 tomorrow, an ID, an app, a goal…', autofocus: true, role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'search-res', 'aria-autocomplete': 'list', 'aria-label': 'Search' });
  const res = h('div', { class: 'res', id: 'search-res', role: 'listbox', 'aria-label': 'Results' });
  const wrap = h('div', { class: 'search', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search', onClick: (e) => { if (e.target === wrap) wrap.remove(); } }, h('div', { class: 'box' }, input, res));
  let items = [], hl = 0;
  // who works what on a day, by person key (doctors from dayInfo, nurses from their schedule); cached per day while the box is open
  const dayCache = new Map();
  const codesOn = (d) => { const k = keyOf(d); if (!dayCache.has(k)) { const m = new Map(); for (const e of dayInfo(s, d).entries) if (e.shift.kind === 'work') m.set(personKeyOf(e.person), e); try { for (const r of N.rowsFor(s, d)) m.set(r.key, { person: r.person, code: r.code, shift: r.shift }); } catch {} dayCache.set(k, m); } return dayCache.get(k); };
  // "D1 today · N2 Sat" — the useful cockpit meta for a person (beta T09-29)
  const personMeta = (p) => {
    const k = personKeyOf(p), today = codesOn(now).get(k), bits = [isMe(s, p) ? 'you' : '', p.title || UNIT_LABEL[p.units?.[0]] || ''];
    bits.push(today ? `${today.code} today` : 'off today');
    for (let i = 1; i <= 14; i++) { const d = addDays(startOfDay(now), i), e = codesOn(d).get(k); if (e) { bits.push(`${e.code} ${i === 1 ? 'tomorrow' : fmtDateShort(d)}`); break; } }
    return bits.filter(Boolean).join(' · ');
  };
  const openDay = (d) => { rt.rotaSel = d; rt.rotaMonth = new Date(d.getFullYear(), d.getMonth(), 1); show('rota'); daySheet(d); };
  const paint = () => {
    res.replaceChildren(...items.map((it, i) => h('div', { class: `item ${i === hl ? 'hl' : ''}`, id: `sr-${i}`, role: 'option', 'aria-selected': i === hl ? 'true' : 'false', onClick: () => { wrap.remove(); it.run(); } }, h('div', { class: 'grow' }, h('div', { class: 'name' }, it.label), it.meta ? h('div', { class: 'meta' }, it.meta) : null))));
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    if (items[hl]) { input.setAttribute('aria-activedescendant', `sr-${hl}`); res.children[hl]?.scrollIntoView?.({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  };
  const build = (raw) => {
    const q = raw.trim().toLowerCase(); items = []; hl = 0;
    if (!q) { paint(); return; }
    const people = allPeople(s), seen = new Set(), addPerson = (p, meta) => { const k = personKeyOf(p); if (seen.has(k)) return; seen.add(k); items.push({ label: p.name, meta: meta ?? personMeta(p), run: () => personSheet(p) }); };
    // a date, or a day word ("tomorrow", "sat")
    const exact = parseDayQuery(q, now), dw = exact ? null : dayWordIn(q, now), day = exact || dw?.date || null;
    const rest = (dw ? q.replace(dw.word, '') : q).replace(/\b(who'?s|who is|on|at|works?|working)\b/g, ' ').trim();
    if (day && (exact || !rest)) items.push({ label: `${DAY_NAMES[day.getDay()]} ${fmtDate(day)}`, meta: dayInfo(s, day).mine?.shift.label || 'day', run: () => openDay(day) });
    // a shift code ("N2", "who's on D1 tomorrow"): everyone on it that day
    const code = /^[a-z]{1,3}\d{0,2}\+?$/i.test(rest) && rest.length <= 4 ? rest.toUpperCase() : '';
    if (code && !UNIT_WORDS[rest]) {
      const d = day || startOfDay(now), on = [...codesOn(d).values()].filter(e => String(e.code).toUpperCase() === code);
      if (on.length) {
        items.push({ label: `${code} ${dw?.word || (exact ? fmtDateShort(d) : 'today')}: ${on.length} ${on.length === 1 ? 'person' : 'people'}`, meta: on.slice(0, 4).map(e => firstName(e.person.name)).join(', ') + (on.length > 4 ? '…' : ''), run: () => openDay(d) });
        for (const e of on.slice(0, 8)) addPerson(e.person, `${e.code} ${dw?.word || (exact ? fmtDateShort(d) : 'today')} · ${e.shift.label || ''}`);
      }
    }
    // a unit or role word ("nurse", "fsed"), a name, a title or a staff ID
    const unit = UNIT_WORDS[rest];
    for (const p of people) {
      const nm = p.name.toLowerCase();
      if (unit ? p.units.includes(unit) || (unit === 'uv' && p.units.includes('lv')) : (rest && (nm.includes(rest) || (p.title || '').toLowerCase().includes(rest) || (p.id && String(p.id).includes(rest) && rest.length >= 3)))) addPerson(p);
      if (items.length > 40) break;
    }
    // every known app, reporting or not (beta T09-08)
    const apps = mergedApps();
    for (const name of new Set([...Object.keys(APP_META), ...Object.keys(apps)])) {
      const st = apps[name] || {}, m = appMeta(name, st), t = m.title.toLowerCase(), qq = rest.replace(/^open\s+/, '');
      if (qq && (t.includes(qq) || name.includes(qq))) items.push({ label: `${m.icon} Open ${m.title}`, meta: st.summary || (apps[name] ? 'open' : 'not reporting yet · open'), run: () => launch(name) });
      for (const a of st.actions || []) if (qq && `${m.title} ${a.label}`.toLowerCase().includes(qq)) items.push({ label: `${m.icon} ${m.title}: ${a.label}`, meta: 'jump straight in', run: () => launch(name, a.id) });
    }
    if (rest) {
      for (const g of s.goals) if (g.name.toLowerCase().includes(rest)) items.push({ label: g.name, meta: `goal · ${g.hoursPerWeek} h/week`, run: () => { show('plan'); goalsSheet(); } });
      for (const [k, t] of Object.entries(s.notes || {})) if (t && t.toLowerCase().includes(rest)) items.push({ label: t.slice(0, 60), meta: `note · ${fmtDate(fromKey(k))}`, run: () => openDay(fromKey(k)) });
      for (const it of MU.searchItems()) if (`${it.title} ${it.kind}`.toLowerCase().includes(rest)) items.push({ label: it.title, meta: `${it.kind} · ${it.sub}`, run: () => { show('mind'); it.run(); } });
    }
    items = items.slice(0, 14);
    if (!items.length) items = [];
    paint();
    if (!items.length) res.replaceChildren(h('div', { class: 'item empty-res', role: 'option', 'aria-disabled': 'true' }, h('div', { class: 'meta' }, 'Nothing found. Try a name, 21/11, N2 tomorrow, an ID or an app.')));
  };
  input.addEventListener('input', () => build(input.value));
  // arrow keys move the highlight, Enter opens the highlighted result (beta T09-10, T10-23)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!items.length) return; e.preventDefault(); hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; paint(); }
    else if (e.key === 'Enter' && items[hl]) { e.preventDefault(); const it = items[hl]; wrap.remove(); it.run(); }
  });
  document.body.append(wrap); input.focus();
}

// ---------------- swaps: your own corrections on top of the imported rota ----------------
function swapSheet(date) {
  const s = S(); const k = keyOf(date);
  const info = dayInfo(s, date);
  const gp = info.rotas.find(r => r.unitKind === 'gp') || info.mine?.rota || null;
  const cur = s.swaps?.[k], raw = rawCode(info), now = cur ? (cur.code || '') : raw;
  // codes from the parsed legend, grouped, with site and hours; leave is there, and the day's current code is always selectable (beta T02-06, T02-23)
  const groups = codeOptions(gp, [raw, cur?.code].filter(Boolean)), same = (c) => String(c).toUpperCase() === String(now).toUpperCase();
  const code = h('select', { 'aria-label': 'Your shift that day' }, h('option', { value: '', selected: !now }, 'Off (no shift)'), ...groups.map(g => h('optgroup', { label: g.group }, ...g.items.map(it => h('option', { value: it.code, selected: same(it.code) }, it.text)))));
  const people = allPeople(s).filter(p => p.units.includes('gp') && !isMe(s, p));
  const withSel = h('select', { 'aria-label': 'Swapped with' }, h('option', { value: '' }, '— nobody / not a swap —'), ...people.map(p => h('option', { value: p.name, selected: cur?.with === p.name }, p.name)));
  const note = h('input', { placeholder: 'Note (optional)', value: cur?.note || '' });
  const says = h('p', { class: 'small muted' }, h('b', {}, 'Rota: '), raw ? codeText(gp, raw) : 'off', cur ? [' · ', h('b', {}, 'your correction: '), cur.code ? codeText(gp, cur.code) : 'off'] : null, '. Record what actually happens — a swap, a cover, a cancelled shift, leave. Imports never overwrite this.');
  const { close } = sheet([h('h2', {}, `Correct ${fmtDateShort(date)}`), says,
    h('div', { class: 'field' }, h('label', {}, 'Your shift that day'), code),
    h('div', { class: 'field' }, h('label', {}, 'Swapped with'), withSel),
    h('div', { class: 'field' }, h('label', {}, 'Note'), note),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', onClick: () => { store.update(x => ({ ...x, swaps: { ...(x.swaps || {}), [k]: { code: code.value, with: withSel.value, note: note.value.trim(), at: Date.now() } } })); regenerate(); close(); toast('Saved', 'ok'); render(); } }, 'Save'),
      cur ? h('button', { class: 'btn danger', onClick: () => { store.update(x => { const swaps = { ...(x.swaps || {}) }; delete swaps[k]; return { ...x, swaps, deleted: store.tombstone(x, `swap:${k}`) }; }); regenerate(); close(); render(); } }, 'Remove') : null)]);
}

// ---------------- weekly review ----------------
function reviewCard() {
  const s = S();
  const ws = weekStartOf(addDays(new Date(), -7)), we = addDays(ws, 6);
  const rows = s.goals.map(g => { let planned = 0, done = 0; for (let i = 0; i < 7; i++) for (const p of s.plan[keyOf(addDays(ws, i))] || []) if (p.goalId === g.id) { if (p.status === 'accepted' || p.status === 'done') planned += p.end - p.start; if (p.status === 'done') done += p.end - p.start; } return { g, planned, done, target: g.hoursPerWeek * 60 }; });
  if (!rows.some(r => r.planned)) return null;
  return h('div', { class: 'card' }, h('div', { class: 'title' }, `Last week · ${fmtDateShort(ws)} – ${fmtDateShort(we)}`),
    ...rows.map(r => h('div', { style: { margin: '8px 0' } }, h('div', { class: 'row small' }, h('span', { class: 'grow', style: { fontWeight: 600 } }, r.g.name), h('span', { class: 'muted' }, `${fmtDur(r.done)} done of ${fmtDur(r.planned)} planned · target ${fmtDur(r.target)}`)),
      h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, Math.round(r.done / Math.max(1, r.target) * 100))}%`, '--c': r.g.color } })))));
}

// ---------------- diagnostics ----------------
// Problems found in what apps send (so you can tell the app's session what to fix)
function issuesCard(apps) {
  const rows = Object.values(apps).flatMap(a => (a.issues || []).map(i => ({ a, i }))); if (!rows.length) return null;
  return h('div', { class: 'card warn' }, h('div', { class: 'title' }, 'Apps sending something Citrus can\'t fully read'), h('div', { class: 'list' }, rows.slice(0, 8).map(({ a, i }) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, appMeta(a.app, a).title), h('div', { class: 'meta' }, i))))), h('div', { class: 'tiny dim' }, 'The rest of that app\'s status still works. HUB.md has the contract.'));
}
// Paste a status.json to see exactly what Citrus would read from it — for the app sessions building the other side
function receiveTesterCard() {
  const ta = h('textarea', { rows: 5, placeholder: 'Paste an app\'s status.json here…', spellcheck: false }), out = h('div', { class: 'tester-out' });
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Receive tester'), h('div', { class: 'tiny dim' }, `Contract v${CONTRACT}. Checks a status file the way Citrus reads it.`), ta,
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => {
      const r = validateStatus(ta.value); out.replaceChildren();
      if (r.error) { out.append(h('div', { class: 'late' }, r.error)); return; }
      const p = r.parsed, bits = [`${p.asks.length} asks`, `${p.metrics.length} metrics`, `${p.progress.length} progress`, `${p.inbox.length} inbox items`, `${p.pending.length} pending`];
      out.append(h('div', { class: r.ok ? 'ok' : 'warnc' }, r.ok ? `✓ ${p.app}: ${bits.join(' · ')}` : `${p.app}: ${bits.join(' · ')}`), ...r.issues.map(i => h('div', { class: 'tiny late' }, i)));
    } }, 'Check')), out);
}

function diagnosticsCard() {
  const s = S();
  const rows = [
    ['Google', G.isSignedIn() ? `signed in as ${G.accountEmail() || s.google.email || '?'}` : G.wasSignedIn() ? 'session expired — tap Sign in' : 'not signed in'],
    ['Session', G.isSignedIn() ? `${G.tokenMinutesLeft()} min left · renews on your next tap` : '—'],
    ['Last sync', s.google.lastSync ? `${new Date(s.google.lastSync).toLocaleString('en-GB')}${rt.syncMode ? ` · ${rt.syncMode}` : ''}${rt.lastSyncMs ? ` · ${(rt.lastSyncMs / 1000).toFixed(1)} s` : ''}` : 'never'],
    ['Drive requests', `${G.stats.requests} sent · ${G.stats.retries} retried · ${G.stats.errors} failed · ${G.stats.skippedWrites} unchanged writes skipped${G.stats.healed ? ` · ${G.stats.healed} duplicate file(s) tidied` : ''}`],
    ['Last Google error', G.stats.lastError ? `${G.stats.lastError} (${new Date(G.stats.lastErrorAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})` : 'none'],
    ['Unsaved to Drive', rt.saveDirty ? 'yes — saves on the next sync' : 'no'],
    ['This device', `${store.persistence.ok ? 'saved' : '⚠ ' + store.persistence.lastError} · ${Math.round(store.persistence.bytes / 1024)} KB${rt.storagePersisted ? ' · protected from clean-up' : ''}${rt.storageEst ? ` · ${Math.round(rt.storageEst.usage / 1048576)} of ${Math.round(rt.storageEst.quota / 1048576)} MB used` : ''}`],
    ['Sync issues', (rt.lastProblems || []).length ? rt.lastProblems.join(' · ') : 'none'],
    ['Queued calendar writes', String((s.outbox || []).length)],
    ['Rotas loaded', Object.keys(s.rotas).length ? Object.values(s.rotas).map(r => `${UNIT_LABEL[r.unitKind]} ${MONTHS[r.month - 1].slice(0, 3)}`).join(', ') : 'none'],
    ['Apps reporting', Object.keys(mergedApps()).join(', ') || 'none'],
    ['Mind', `${Object.keys(s.tasks || {}).length} tasks · ${Object.keys(s.habits || {}).length} habits · ${Object.keys(s.aims || {}).length} objectives · ${Object.keys(s.reflections || {}).length} reflections · ${Object.keys(s.metricLog || {}).length} app series`],
    ['App contract problems', Object.values(mergedApps()).flatMap(a => (a.issues || []).map(i => `${a.app}: ${i}`)).slice(0, 4).join(' · ') || 'none'],
    ['Online', rt.online ? 'yes' : 'no'],
    ['Installed', window.matchMedia('(display-mode: standalone)').matches ? 'yes (home screen)' : 'browser tab'],
  ];
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Diagnostics'), h('div', { class: 'kv' }, ...rows.flatMap(([a, b]) => [h('b', {}, a), h('span', {}, b)])),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: () => refreshAll(true) }, 'Sync now'), h('button', { class: 'btn sm', onClick: async () => { const regs = await navigator.serviceWorker?.getRegistrations?.() || []; for (const r of regs) await r.unregister(); const ks = await caches.keys(); for (const k of ks) await caches.delete(k); location.reload(); } }, 'Reinstall app files')));
}

window.__citrus = { refreshAll, publishPlan, saveStateNow, store, G, rt, calendarCreate };   // for the console and the tests
boot();
