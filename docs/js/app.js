import * as store from './store.js';
import { mergeStates } from './store.js';
import * as G from './google.js';
import { parseRotaFile, serializeRota } from './rota-parser.js';
import { dayInfo, myDay, allPeople, isMe, sharedShifts, monthSummary, shiftWindow, UNIT_LABEL } from './model.js';
import { suggest, dayBusy, learn, weekStartOf, weekProgress } from './planner.js';
import { normalizeStatus, validateStatus, CONTRACT } from './inbound.js';
import * as M from './mind.js';
import * as MU from './mind-ui.js';
import { constellation } from './apps-ui.js';
import { boardModel, overlapModel } from './board.js';
import * as SU from './social-ui.js';
import * as CU from './chores-ui.js';
import * as PU from './people-ui.js';
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
  applyTheme();
  rt.rotaMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  for (const b of document.querySelectorAll('nav.tabs button')) b.addEventListener('click', () => show(b.dataset.view));
  $('#btnRefresh').addEventListener('click', () => refreshAll(true));
  $('#btnMore').addEventListener('click', () => show('more'));
  $('#btnSearch').addEventListener('click', () => openSearch());
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if (e.key === 'Escape') { document.querySelector('.search')?.remove(); document.querySelector('.sheet-bg')?.remove(); return; }
    if (typing) return;
    const tabs = ['today', 'rota', 'plan', 'mind', 'social', 'apps'];
    if (/^[1-6]$/.test(e.key)) { show(tabs[+e.key - 1]); e.preventDefault(); }
    else if (e.key === '/') { openSearch(); e.preventDefault(); }
    else if (e.key === 'r') refreshAll(true);
    else if (e.key === ',') show('more');
  });
  window.addEventListener('online', () => { rt.online = true; renderSync(); flushOutbox().then(render).catch(() => {}); });
  window.addEventListener('offline', () => { rt.online = false; renderSync(); });
  const addEventFn = async (it) => { const cal = S().settings.calendarIds?.[0] || 'primary'; const d = fromKey(it.date), hm = (v) => { const [a, b] = String(v).split(':').map(Number); return a * 60 + b; }, st = hm(it.start); await calendarCreate(cal, { title: it.title, start: atMin(d, st), end: atMin(d, it.end ? hm(it.end) : st + (it.minutes || 30)), description: it.text || '', reminders: planAlarm() }, { src: 'inbox' }); };
  MU.initMind({
    S, update: (fn) => store.update(fn), sheet, apps: mergedApps, appMeta: (n) => appMeta(n, mergedApps()[n] || {}), render: () => render(), regenerate: () => { regenerate(); render(); },
    go: (v, sub) => { if (v === 'rota' && sub) rt.workSeg = sub; show(v); }, launch: (app, id) => launch(app, id), appUrl: (n) => launchUrl(n, mergedApps()[n] || {}, null),
    addEvent: addEventFn,
  });
  const sub = { S, update: (fn) => store.update(fn), sheet, render: () => render(), go: (v, sub) => { if (v === 'rota' && sub) rt.workSeg = sub; show(v); }, busyOf: (d) => (rt.events[keyOf(d)] || []).filter(e => !e.allDay && e.start && e.end).map(e => [Math.max(0, Math.round((e.start - startOfDay(d)) / 60000)), Math.min(1440, Math.round((e.end - startOfDay(d)) / 60000))]), addEvent: addEventFn };
  SU.initSocial(sub); CU.initChores(sub); PU.initPeople({ ...sub, openDay: (d) => daySheet(d), personSheet, personKeyOf, shiftChip, importButton });
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
    if (!inc && q.get('from')) { const from = q.get('from'); history.replaceState(null, '', location.pathname + (location.hash || '#today')); const nm = appMeta(from, mergedApps()[from] || {}).title; toast(`Back from ${nm}`); setTimeout(() => refreshAll(false), 400); return; }
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
function show(view) {
  if (view === 'team') { rt.workSeg = 'team'; view = 'rota'; }   // the old Team tab lives inside Work now
  if (!VIEWS.includes(view)) view = 'today';
  rt.view = view;
  for (const s of document.querySelectorAll('section.view')) s.classList.toggle('active', s.id === `view-${view}`);
  for (const b of document.querySelectorAll('nav.tabs button')) b.classList.toggle('active', b.dataset.view === view);
  history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo(0, 0);
}

function render() {
  ingestApps();   // numbers the apps report become history before anything is drawn
  const fn = { today: renderToday, rota: renderWork, plan: renderPlan, mind: MU.renderMind, social: SU.renderSocial, apps: renderApps, more: renderMore }[rt.view] || renderToday;
  const el = $(`#view-${rt.view}`);
  el.replaceChildren(...[authBanner(), fn()].flat().filter(Boolean));
}

function applyTheme() { document.documentElement.dataset.theme = S().settings.theme || 'dark'; }

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
          const j = await G.readBackup(b.id); if (!j || !j.rotas) throw new Error('That backup is unreadable');
          store.replaceState({ ...j, outbox: S().outbox, google: S().google, apps: S().apps }, { bump: true });
          regenerate(); close(); toast(`Restored ${fmtDate(fromKey(b.date))}`, 'ok'); render();
        } catch (e) { toast(e.message, 'err'); }
      } }, 'Restore')))) : h('div', { class: 'muted small' }, 'No backups yet — the first is made after today\'s sync.')]);
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
      store.update(s => ({ ...s, rotas: { ...s.rotas, [rota.id]: rota } }), { silent: true });
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
async function calendarCreate(calendarId, payload, meta = {}) {
  if (!rt.online || !G.isSignedIn()) { queueOutbox({ type: 'create', calendarId, payload, meta }); return null; }
  try { return await G.createEvent(calendarId, payload); }
  catch (e) { if (e.network || /expired|not signed/i.test(e.message)) { queueOutbox({ type: 'create', calendarId, payload, meta }); return null; } throw e; }
}
function queueOutbox(op) { store.update(s => ({ ...s, outbox: [...(s.outbox || []), { ...op, id: uid(), at: Date.now() }] }), { silent: true, remote: false }); toast('Saved — will reach your calendar when online'); }
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

function autoPickMe() {
  if (S().me) return;
  const people = allPeople(S()).filter(p => p.units.includes('gp'));
  const guess = people.find(p => /amro/i.test(p.name));
  if (guess) store.update(s => ({ ...s, me: { name: guess.name, id: guess.id } }));
}

// ---------------- import ----------------
async function importFiles(fileList) {
  let ok = 0;
  for (const f of fileList) {
    try {
      const rota = serializeRota(await parseRotaFile(await f.arrayBuffer(), f.name));
      if (!rota.weekdayOk) toast(`${f.name}: the weekdays don't match ${MONTHS[rota.month - 1]} ${rota.year} — check the month cell`, 'err');
      store.update(s => { const deleted = { ...(s.deleted || {}) }; delete deleted[`rota:${rota.id}`]; return { ...s, rotas: { ...s.rotas, [rota.id]: rota }, deleted }; }, { silent: true });
      ok++;
    } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
  if (ok) { toast(`Imported ${ok} rota${ok > 1 ? 's' : ''}`, 'ok'); autoPickMe(); regenerate(); render(); }
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
function sheet(content) {
  const bg = h('div', { class: 'sheet-bg', onClick: (e) => { if (e.target === bg) close(); } });
  const box = h('div', { class: 'sheet' }, h('div', { class: 'handle' }), ...[content].flat());
  bg.append(box); document.body.append(bg);
  const close = () => bg.remove();
  return { close, box };
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
  const shared = sharedShifts(s, key);
  const months = Object.values(s.rotas).filter(r => r.people.some(x => personKeyOf(x) === key)).sort((a, b) => a.year - b.year || a.month - b.month);
  const content = [
    h('div', { class: 'row' }, h('div', { class: 'avatar', style: { width: '44px', height: '44px', borderRadius: '50%', background: 'var(--orange-soft)', color: 'var(--orange2)', display: 'grid', placeItems: 'center', fontWeight: '700' } }, initials(p.name)),
      h('div', { class: 'grow' }, h('h2', {}, p.name), h('div', { class: 'small muted' }, [p.title, p.id ? `ID ${p.id}` : ''].filter(Boolean).join(' · ')))),
    h('div', { style: { height: '10px' } }),
    p.mobile ? h('div', { class: 'small muted' }, telLink(p.mobile)?.display || p.mobile) : null,
    ...PU.personBlock(p),
    isMe(s, p) ? null : h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'title' }, `Shifts with you (${shared.length})`),
      shared.length ? h('div', { class: 'chips' }, ...shared.map(x => h('span', { class: `chip ${x.shift.type}` }, `${fmtDateShort(x.date)} ${x.shift.type}`))) : h('div', { class: 'muted small' }, 'None in the loaded rotas')),
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
    grid.append(h('div', { class: 'day', onClick: () => { rt.rotaMonth = first; rt.rotaSel = new Date(rota.year, rota.month - 1, d); show('rota'); document.querySelector('.sheet-bg')?.remove(); daySheet(rt.rotaSel); } },
      h('span', { class: 'n' }, d), h('span', { class: `code ${cls}` }, shift.kind === 'off' ? '·' : shift.kind === 'leave' ? 'L' : code)));
  }
  return [h('div', { class: 'cal-head' }, ...DAY_SHORT.map(x => h('span', {}, x[0]))), grid];
}
import { interpretCode } from './rota-parser.js';
function interpretFor(rota, code) { return interpretCode(code, rota.legend, rota.unitKind); }

// ---------------- TODAY ----------------
function renderToday() {
  const s = S();
  const now = new Date();
  const main = [], side = [];
  if (!Object.keys(s.rotas).length) main.push(onboardingCard());
  const nudge = rotaReminderCard(); if (nudge) main.push(nudge);
  const { info, today, overnightTail, afterNight } = myDay(s, now);
  const tomorrow = myDay(s, addDays(now, 1));

  // hero: words on the left, the day dial on the right
  const hero = h('div', { class: 'card hero', style: today?.shift.type === 'N' ? { '--accent-soft': 'var(--night-soft)' } : afterNight ? { '--accent-soft': 'var(--night-soft)' } : {} });
  const words = h('div', {});
  const say = (...kids) => words.append(...kids.filter(Boolean));   // raw append() would print "null"
  say(h('div', { class: 'title' }, `${DAY_NAMES[now.getDay()]} ${fmtDate(now)}`));
  if (!info.hasRota && overnightTail) say(h('div', { class: 'big' }, 'Off, after a night'), h('div', { class: 'sub' }, `Your night ends ${fmtTime(overnightTail.window.end)}. No rota for ${MONTHS[now.getMonth()]} yet — import it to see the rest of the month.`));
  else if (!info.hasRota) say(h('div', { class: 'big' }, 'No rota for this month'), h('div', { class: 'sub' }, 'Import the Excel files, or drop them in Drive › My Apps › Rotas.'));
  else if (!s.me) say(h('div', { class: 'big' }, 'Who are you?'), h('div', { class: 'sub' }, 'Pick your row in Settings › Me.'));
  else if (today) {
    const w = today.window;
    say(h('div', { class: 'big' }, today.shift.label),
      h('div', { class: 'sub' }, `${fmtTime(w.start)}–${fmtTime(w.end)}${today.shift.hours.overnight ? ', overnight' : ''} · ${fmtDur(today.shift.hours.durationMin)} · ${today.code}`),
      shiftProgress(w),
      today.mci ? h('div', { style: { marginTop: '6px' } }, mciBadge()) : null);
  } else if (info.mine && info.mine.shift.kind === 'leave') say(h('div', { class: 'big' }, info.mine.shift.label), h('div', { class: 'sub' }, 'Enjoy it.'));
  else say(h('div', { class: 'big' }, afterNight ? 'Off, after a night' : 'Day off'), h('div', { class: 'sub' }, afterNight ? `Your night ends ${fmtTime(overnightTail.window.end)}. Recover first; the plan stays light.` : 'A free day. The planner has ideas below.'));
  if (overnightTail && today) say(h('div', { class: 'small muted', style: { marginTop: '6px' } }, `Night from yesterday ends ${fmtTime(overnightTail.window.end)}`));
  const tmr = tomorrow.today ? `${tomorrow.today.shift.label} ${fmtMin(tomorrow.today.shift.hours.start)}–${fmtMin(tomorrow.today.shift.hours.end)}` : tomorrow.info.mine?.shift.kind === 'leave' ? tomorrow.info.mine.shift.label : (info.hasRota && s.me ? 'off' : '');
  if (tmr) say(h('div', { class: 'small', style: { marginTop: '10px' } }, h('span', { class: 'muted' }, 'Tomorrow '), tmr));
  hero.append(h('div', { class: 'hero-grid' }, words, info.hasRota && s.me ? dayDial(now) : null));
  const nu = nextUp(now); if (nu) hero.append(nu);
  hero.append(weekStrip(now));
  main.push(hero);
  const board = shiftBoard(info, today); if (board) main.push(board);
  main.push(MU.mindCard());
  { const nc = PU.todayCard(); if (nc) main.push(nc); }
  { const hc = CU.todayCard(); if (hc) main.push(hc); }
  if (info.hasRota) main.push(onCallCard(info));
  main.push(planCard(now));
  side.push(eventsCard(now));
  { const fc = SU.todayCard(); if (fc) side.push(fc); }
  if (Object.keys(mergedApps()).length) side.push(appsCard());
  side.push(briefCard(now));
  side.push(noteCard(now));
  return h('div', { class: 'cols' }, h('div', {}, ...main), h('div', {}, ...side));
}

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
  const centre = today ? [el('text', { x: C, y: C - 4, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 800, fill: 'var(--text)' }, today.code), el('text', { x: C, y: C + 14, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)' }, `${fmtMin(today.shift.hours.start)}–${fmtMin(today.shift.hours.end)}`)]
    : [el('text', { x: C, y: C + 5, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: 'var(--muted)' }, overnightTail ? 'post-night' : 'free')];
  const svg = el('svg', { viewBox: `0 0 ${2 * C} ${2 * C}`, class: 'dial', role: 'img', 'aria-label': 'Your day as a 24-hour ring' }, ...paths, ...ticks, ...labels, marker, ...centre);
  return svg;
}

// next 7 days at a glance
function weekStrip(from) {
  const s = S();
  const strip = h('div', { class: 'week', style: { marginTop: '14px' } });
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i); const info = dayInfo(s, d); const sh = info.mine?.shift;
    const cls = !sh || sh.kind === 'off' ? 'off' : sh.kind === 'leave' ? 'leave' : (/^[DNE]$/.test(sh.type) ? sh.type : 'other');
    strip.append(h('div', { class: `wd ${i === 0 ? 'today' : ''}`, onClick: () => { rt.rotaSel = d; daySheet(d); } },
      h('div', { class: 'd' }, DAY_SHORT[d.getDay()]), h('div', { class: 'n' }, d.getDate()),
      h('span', { class: `code ${cls}`, style: cls === 'off' ? { color: 'var(--dim)' } : {} }, !info.mine || sh.kind === 'off' ? '·' : sh.kind === 'leave' ? 'L' : info.mine.code)));
  }
  return strip;
}

// a plain-language brief you can copy or share (also what a morning notification would say)
function briefText(date) {
  const s = S();
  const { info, today, overnightTail } = myDay(s, date);
  const lines = [`${DAY_NAMES[date.getDay()]} ${fmtDate(date)}`];
  if (today) {
    lines.push(`${today.shift.label}, ${fmtTime(today.window.start)}–${fmtTime(today.window.end)} (${today.code})${today.mci ? ' (MCI 2nd)' : ''}`);
    if (info.withMe.length) lines.push(`With you: ${info.withMe.map(e => firstName(e.person.name)).join(', ')}`);
  } else if (overnightTail) lines.push(`Off after your night (ends ${fmtTime(overnightTail.window.end)})`);
  else if (info.mine?.shift.kind === 'leave') lines.push(info.mine.shift.label);
  else if (info.hasRota) lines.push('Day off');
  const fsed = info.fsed.map(e => `${firstName(e.person.name)} ${e.code}`).join(', '); if (fsed) lines.push(`FSED: ${fsed}`);
  const uv = info.uv.map(e => firstName(e.person.name)).join(', '); if (uv) lines.push(`Upper Village specialist: ${uv}`);
  const evs = (rt.events[keyOf(date)] || []).sort((a, b) => a.start - b.start).map(e => `${e.allDay ? 'all day' : fmtTime(e.start)} ${e.title}`); if (evs.length) lines.push(`Calendar: ${evs.join('; ')}`);
  const plan = [...(s.plan[keyOf(date)] || []).filter(p => p.status === 'accepted' || p.status === 'done'), ...(rt.suggestions[keyOf(date)] || [])].sort((a, b) => a.start - b.start).map(p => `${fmtMin(p.start)} ${p.title}${p.status === 'suggested' ? ' (suggested)' : ''}`);
  if (plan.length) lines.push(`Plan: ${plan.join('; ')}`);
  const tmr = myDay(s, addDays(date, 1)); if (tmr.today) lines.push(`Tomorrow: ${tmr.today.shift.label} ${fmtMin(tmr.today.shift.hours.start)}`);
  return lines.join('\n');
}
function briefCard(date) {
  const text = briefText(date);
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Brief'),
      navigator.share ? h('button', { class: 'btn sm ghost', onClick: () => navigator.share({ title: 'Today', text }).catch(() => {}) }, 'Share') : null,
      h('button', { class: 'btn sm ghost', onClick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied', 'ok'); } catch { toast('Could not copy'); } } }, 'Copy')),
    h('div', { class: 'brief muted' }, text));
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
let boardSite = '';
/** Who is in, hour by hour. Day, evening and night shifts overlap on one axis, so handovers and thin hours are obvious. */
function shiftBoard(info, today) {
  const sites = Object.keys(info.bySite).sort((a, b) => info.bySite[b].length - info.bySite[a].length); if (!sites.length) return null;
  const mine = today?.shift.site; if (!sites.includes(boardSite)) boardSite = sites.includes(mine) ? mine : sites[0];
  const site = boardSite, meKey = info.mine ? personKeyOf(info.mine.person) : '', now = new Date(), nowMin = sameDay(info.date, now) ? minsOf(now) : null;
  const m = boardModel(info.bySite[site], { nowMin, meKey, keyOf: personKeyOf }); if (!m.rows.length) return null;
  const span = m.axisEnd - m.axisStart, pct = (t) => `${((t - m.axisStart) / span * 100).toFixed(2)}%`, MAXROWS = 14, rows = m.rows.slice(0, MAXROWS);
  const grid = [];
  for (let t = Math.ceil(m.axisStart / 180) * 180; t <= m.axisEnd; t += 180) grid.push(h('span', { class: 'bd-tick', style: { left: pct(t) } }, h('small', {}, pad2(Math.floor(t / 60) % 24))));
  const heat = h('div', { class: 'bd-heat', 'aria-hidden': 'true' }, m.hours.map(x => h('i', { title: `${pad2(Math.floor(x.t / 60) % 24)}:00 · ${x.n} in`, style: { opacity: m.peak ? (0.12 + 0.88 * x.n / m.peak).toFixed(2) : 0.12 } })));
  const summary = m.now == null ? `${m.rows.length} doctors across the day` : `${m.nowCount} in now${m.next ? ` · ${pad2(Math.floor(m.next.t / 60) % 24)}:${pad2(m.next.t % 60)}: ${[m.next.arrive ? `${m.next.arrive} arrive${m.next.arrive === 1 ? 's' : ''}` : '', m.next.leave ? `${m.next.leave} leave${m.next.leave === 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}` : ''}`;
  return h('div', { class: 'card board' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Who’s in'), h('span', { class: 'dim tiny' }, summary)),
    sites.length > 1 ? h('div', { class: 'bd-sites' }, sites.map(x => h('button', { class: `c-chip ${x === site ? 'on' : ''}`, style: { '--c': 'var(--orange)' }, onClick: () => { boardSite = x; render(); } }, x.length > 18 ? x.slice(0, 17) + '…' : x, h('small', {}, info.bySite[x].length)))) : null,
    h('div', { class: 'bd-plot' },
      h('div', { class: 'bd-axis' }, h('div', { class: 'bd-name' }), h('div', { class: 'bd-track bd-top' }, heat, ...grid)),
      ...rows.map(r => { const wide = (r.end - r.start) / span > 0.2;
        return h('button', { class: `bd-row ${r.me ? 'me' : ''}`, onClick: () => personSheet(r.entry.person), title: `${r.name} · ${r.label} ${fmtMin(r.start)}–${fmtMin(r.end)}` },
          h('span', { class: 'bd-name' }, h('span', { class: 'av' }, initials(r.name)), h('span', { class: 'ellipsis' }, r.me ? 'You' : firstName(r.name))),
          h('span', { class: 'bd-track' }, h('i', { class: `bd-bar ${r.type}`, style: { left: pct(r.start), width: `${((r.end - r.start) / span * 100).toFixed(2)}%` } }, wide ? `${r.code || r.type} ${pad2(Math.floor(r.start / 60) % 24)}–${pad2(Math.floor(r.end / 60) % 24)}` : r.code || r.type))); }),
      m.now != null ? h('div', { class: 'bd-overlay' }, h('i', { class: 'bd-now', style: { left: pct(m.now) } })) : null),
    m.rows.length > MAXROWS ? h('div', { class: 'dim tiny' }, `+${m.rows.length - MAXROWS} more at ${site}`) : null);
}
function countdown(w) {
  const now = Date.now();
  if (now < w.start) return h('div', { class: 'small orange', style: { marginTop: '4px' } }, `Starts in ${fmtDur(Math.round((w.start - now) / 60000))}`);
  if (now < w.end) return h('div', { class: 'small orange', style: { marginTop: '4px' } }, `${fmtDur(Math.round((w.end - now) / 60000))} left`);
  return h('div', { class: 'small muted', style: { marginTop: '4px' } }, 'Shift done ✓');
}

function onboardingCard() {
  const dz = h('div', { class: 'dropzone' }, h('div', {}, 'Drop your rota .xlsx files here'), h('div', { class: 'small', style: { marginTop: '8px' } }, importButton()));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); importFiles([...e.dataTransfer.files]); });
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Get started'), dz,
    h('div', { class: 'small muted', style: { marginTop: '10px' } }, 'Or sign in with Google in Settings and put the files in Drive › My Apps › Rotas — they import automatically.'));
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
  } }, h('input', { name: 'q', 'aria-label': 'Quick add an event', placeholder: 'Quick add: "Dentist Tue 3pm 1h"', style: { flex: 1, minWidth: '0', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '9px 12px' } }), h('button', { class: 'btn sm primary' }, '+'));
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

function planCard(date) {
  const s = S();
  const k = keyOf(date);
  const accepted = (s.plan[k] || []).filter(p => p.status === 'accepted' || p.status === 'done');
  const sugg = (rt.suggestions[k] || []).filter(b => !accepted.some(a => a.id === b.id));
  const body = [];
  const { busy } = dayBusy(s, date, rt.events[k] || []);
  const shiftBlocks = busy.filter(b => b.kind === 'shift');
  const items = [...accepted.map(p => ({ ...p, _acc: true })), ...sugg].sort((a, b) => a.start - b.start);
  if (!items.length && !shiftBlocks.length) body.push(h('div', { class: 'muted small' }, 'No plan yet — open Plan to generate suggestions.'));
  for (const b of items) body.push(blockRow(b, date));
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `Plan · ${relDay(date)}`), h('button', { class: 'btn sm ghost', onClick: () => { regenerate(); show('plan'); } }, 'Open planner')), ...body);
}

function blockRow(b, date) {
  const k = keyOf(date);
  const s = S();
  const goal = s.goals.find(g => g.id === b.goalId);
  const row = h('div', { class: `tl-row` }, h('div', { class: 'tl-time' }, fmtMin(b.start)),
    h('div', { class: `tl-block ${b._acc ? '' : 'suggested'}`, style: { '--c': goal?.color || b.color || 'var(--orange)' } },
      h('div', { class: 'row' }, h('span', { class: 't grow' }, b.title), h('span', { class: 'small muted' }, `${fmtMin(b.start)}–${fmtMin(b.end)} · ${fmtDur(b.end - b.start)}`)),
      b.reason ? h('div', { class: 'r' }, b.reason) : null,
      h('div', { class: 'actions' },
        blockOpen(b),
        b._acc ? [
          b.status === 'done' ? h('span', { class: 'chip off' }, '✓ done') : h('button', { class: 'btn sm', onClick: () => setBlockStatus(k, b, 'done') }, '✓ Done'),
          h('button', { class: 'btn sm ghost', onClick: () => moveBlock(k, b) }, 'Move'),
          h('button', { class: 'btn sm ghost danger', onClick: () => removeBlock(k, b) }, 'Remove'),
        ] : [
          h('button', { class: 'btn sm primary', onClick: () => acceptBlock(k, b) }, 'Accept'),
          h('button', { class: 'btn sm', onClick: () => moveBlock(k, b, true) }, 'Move'),
          h('button', { class: 'btn sm ghost', onClick: () => rejectBlock(k, b) }, 'Skip'),
        ])));
  return row;
}

function blockOpen(b) {
  if (/^app:(task|habit)-/.test(b.goalId || '')) return null;
  const app = b.app || guessApp(b.title); if (!app) return null; const st = mergedApps()[app] || {}, url = launchUrl(app, st, (st.actions || [])[0]);
  return url ? h('button', { class: 'btn sm', onClick: () => launch(app, (st.actions || [])[0]?.id) }, `Open ${appMeta(app, st).title} ▸`) : null;
}
async function acceptBlock(k, b, { silent = false } = {}) {
  const block = { ...b, status: 'accepted', at: Date.now() }; delete block._acc;
  store.update(s => ({ ...s, plan: { ...s.plan, [k]: [...(s.plan[k] || []).filter(p => p.id !== b.id), block] }, prefs: learn(s, b, +1) }), { silent: true });
  rt.suggestions[k] = (rt.suggestions[k] || []).filter(x => x.id !== b.id);
  if (G.isSignedIn() && S().settings.pushPlan !== false) {
    try {
      const date = fromKey(k);
      const ev = await calendarCreate(S().settings.calendarIds?.[0] || 'primary', { title: b.title, start: atMin(date, b.start), end: atMin(date, b.end), description: b.reason, tag: 'plan', reminders: planAlarm() }, { blockId: b.id, dateKey: k });
      if (ev) store.update(s => ({ ...s, plan: { ...s.plan, [k]: (s.plan[k] || []).map(p => p.id === b.id ? { ...p, eventId: ev.id, calendarId: ev.calendarId } : p) } }), { silent: true });
    } catch (e) { if (!silent) toast('Saved locally; calendar: ' + e.message, 'err'); }
  }
  publishPlanSoon();
  if (!silent) { toast(`${b.title} planned`, 'ok'); render(); }
}
async function rejectBlock(k, b) {
  store.update(s => ({ ...s, plan: { ...s.plan, [k]: [...(s.plan[k] || []).filter(p => p.id !== b.id), { ...b, status: 'rejected', at: Date.now() }] }, prefs: learn(s, b, -2) }), { silent: true });
  rt.suggestions[k] = (rt.suggestions[k] || []).filter(x => x.id !== b.id);
  regenerate(); render();
}
async function removeBlock(k, b) {
  if (b.eventId) {
    const op = { type: 'delete', calendarId: b.calendarId || 'primary', eventId: b.eventId };
    if (!rt.online || !G.isSignedIn()) queueOutbox(op);
    else try { await G.deleteEvent(op.calendarId, op.eventId); } catch (e) { if (e.network || /expired/i.test(e.message)) queueOutbox(op); }
  }
  store.update(s => ({ ...s, plan: { ...s.plan, [k]: (s.plan[k] || []).filter(p => p.id !== b.id) }, deleted: store.tombstone(s, `plan:${b.id}`) }));
  publishPlanSoon();
}
function setBlockStatus(k, b, status) {
  store.update(s => { const n = { ...s, plan: { ...s.plan, [k]: (s.plan[k] || []).map(p => p.id === b.id ? { ...p, status, at: Date.now() } : p) } }; return status === 'done' ? M.completeFromBlock(n, b.goalId, k) : n; });
}
function moveBlock(k, b, isSuggestion = false) {
  const st = h('input', { type: 'time', value: fmtMin(b.start) }), en = h('input', { type: 'time', value: fmtMin(b.end % 1440) }), dt = h('input', { type: 'date', value: k });
  const { close } = sheet([
    h('h2', {}, `Move “${b.title}”`),
    h('div', { class: 'field' }, h('label', {}, 'Date'), dt),
    h('div', { class: 'field' }, h('label', {}, 'Start / end'), h('div', { class: 'inline' }, st, en)),
    h('button', { class: 'btn primary block', onClick: async () => {
      const [sh, sm] = st.value.split(':').map(Number), [eh, em] = en.value.split(':').map(Number);
      const ns = sh * 60 + sm, ne = eh * 60 + em; if (ne <= ns) return toast('End must be after start');
      const nk = dt.value || k;
      const moved = { ...b, start: ns, end: ne, date: nk, id: isSuggestion ? `${nk}-${b.goalId}-${ns}` : b.id, reason: 'Moved by you' };
      if (isSuggestion) { await acceptBlock(nk, moved); close(); return; }
      if (b.eventId && G.isSignedIn()) { try { await G.patchEvent(b.calendarId || 'primary', b.eventId, { start: atMin(fromKey(nk), ns), end: atMin(fromKey(nk), ne) }); } catch (e) { toast('Calendar: ' + e.message, 'err'); } }
      store.update(s => { const plan = { ...s.plan }; plan[k] = (plan[k] || []).filter(p => p.id !== b.id); plan[nk] = [...(plan[nk] || []), moved]; return { ...s, plan }; });
      close();
    } }, 'Save'),
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
  const apps = mergedApps();
  const age = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const today = keyOf(new Date());
  const rows = Object.entries(apps).map(([name, st]) => {
    const meta = appMeta(name, st);
    const asksToday = (st.asks || []).filter(a => a.date === today);
    const minutes = asksToday.reduce((a, x) => a + (+x.minutes || 0), 0) || st.next?.minutes || st.estimatedMinutes || 0;
    const pending = (st.pending || []).slice(0, 2);
    const done = st.today?.done;
    return { name, st, meta, minutes, pending, done, asksToday };
  }).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.minutes - a.minutes);
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your apps'),
    h('div', { class: 'list' }, ...rows.map(({ name, st, meta, minutes, pending, done, asksToday }) => h('div', { class: 'item' },
      h('div', { class: 'avatar', style: { background: meta.color + '33', color: meta.color } }, meta.icon),
      h('div', { class: 'grow' },
        h('div', { class: 'name row' }, meta.title,
          done ? h('span', { class: 'chip off', style: { padding: '1px 7px', fontSize: '10px' } }, 'done today') : minutes ? h('span', { class: 'chip', style: { padding: '1px 7px', fontSize: '10px' } }, `~${minutes} min`) : null),
        h('div', { class: 'meta' }, st.summary || st.next?.title || 'no summary'),
        pending.length ? h('div', { class: 'tiny', style: { color: meta.color } }, pending.join(' · ')) : null,
        actionChips(name, st, 3),
        h('div', { class: 'tiny dim' }, [age(st.updatedAt), asksToday.length ? `asks for ${asksToday.map(a => a.slot === 'before' ? 'time before your shift' : fmtDur(+a.minutes || 0)).join(', ')}` : ''].filter(Boolean).join(' · '))),
      meta.url ? h('a', { class: 'btn sm', href: meta.url, target: '_blank', rel: 'noopener' }, 'Open') : null))));
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
  const seg = rt.workSeg || workSegDefault, SEG = [['calendar', 'Calendar'], ['team', 'People'], ['nurses', 'Nurses'], ['home', 'Home']];
  const bar = h('div', { class: 'seg work-seg', role: 'tablist' }, SEG.map(([id, l]) => h('button', { class: seg === id ? 'active' : '', role: 'tab', 'aria-selected': seg === id ? 'true' : 'false', onClick: () => { rt.workSeg = id; render(); window.scrollTo(0, 0); } }, l)));
  const body = seg === 'team' ? PU.renderDirectory() : seg === 'nurses' ? PU.renderNurses() : seg === 'home' ? CU.renderHome() : renderRota();
  return [h('h1', {}, 'Work'), bar, ...[body].flat()];
}
function renderRota() {
  const s = S();
  const m = rt.rotaMonth;
  const y = m.getFullYear(), mo = m.getMonth() + 1;
  const out = [];
  const rotas = Object.values(s.rotas).filter(r => r.year === y && r.month === mo);
  const head = h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('button', { class: 'btn icon', onClick: () => { rt.rotaMonth = new Date(y, mo - 2, 1); render(); } }, '‹'),
    h('h2', { class: 'grow', style: { textAlign: 'center', fontSize: '20px', margin: 0 } }, `${MONTHS[mo - 1]} ${y}`),
    h('button', { class: 'btn icon', onClick: () => { rt.rotaMonth = new Date(y, mo, 1); render(); } }, '›'));
  out.push(head);
  if (!rotas.length) {
    out.push(h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, '🗓'), `No rota loaded for ${MONTHS[mo - 1]} ${y}`), h('div', { class: 'row', style: { justifyContent: 'center' } }, importButton())));
    const loaded = Object.values(s.rotas).sort((a, b) => b.year - a.year || b.month - a.month);
    if (loaded.length) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Loaded rotas'), h('div', { class: 'chips' }, ...loaded.map(r => h('button', { class: 'chip', onClick: () => { rt.rotaMonth = new Date(r.year, r.month - 1, 1); render(); } }, `${MONTHS[r.month - 1].slice(0, 3)} ${r.year} · ${UNIT_LABEL[r.unitKind]}`)))));
    return out;
  }
  const sum = s.me ? monthSummary(s, y, mo) : null;
  const grid = h('div', { class: 'cal' });
  const first = new Date(y, mo - 1, 1);
  for (let i = 0; i < first.getDay(); i++) grid.append(h('div', { class: 'day pad' }));
  const today = keyOf(new Date());
  const days = new Date(y, mo, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, mo - 1, d);
    const info = dayInfo(s, date);
    const mine = info.mine;
    const shift = mine?.shift;
    const cls = !shift ? 'off' : shift.kind === 'leave' ? 'leave' : shift.kind === 'off' ? 'off' : (/^[DNE]$/.test(shift.type) ? shift.type : 'other');
    const evs = rt.events[keyOf(date)] || [];
    const plan = (s.plan[keyOf(date)] || []).filter(p => p.status === 'accepted');
    const cell = h('div', { class: `day ${keyOf(date) === today ? 'today' : ''} ${[5, 6].includes(date.getDay()) ? 'weekend' : ''} ${rt.rotaSel && keyOf(rt.rotaSel) === keyOf(date) ? 'sel' : ''} ${mine?.mci ? 'mci' : ''} ${mine?.swap ? 'swap' : ''}`, onClick: () => { rt.rotaSel = date; daySheet(date); } },
      h('span', { class: 'n' }, d),
      h('span', { class: `code ${cls}` }, !mine ? '·' : shift.kind === 'off' ? '·' : shift.kind === 'leave' ? 'L' : mine.code),
      mine && shift.kind === 'work' && overlapCount(info) ? h('span', { class: 'tiny dim with' }, `+${overlapCount(info)}`) : null,
      (evs.length || plan.length) ? h('span', { class: 'dots' }, ...Array.from({ length: Math.min(3, evs.length + plan.length) }, () => h('i'))) : null);
    grid.append(cell);
  }
  out.push(h('div', { class: 'card' }, h('div', { class: 'cal-head' }, ...DAY_SHORT.map(x => h('span', {}, x))), grid,
    h('div', { class: 'chips', style: { marginTop: '10px' } }, h('span', { class: 'chip D' }, 'D day'), h('span', { class: 'chip N' }, 'N night'), h('span', { class: 'chip E' }, 'E evening'), h('span', { class: 'chip SF' }, 'other'), h('span', { class: 'chip leave' }, 'L leave'), h('span', { class: 'chip mci' }, '🚨 MCI 2nd'))));
  if (sum) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your month'),
    h('div', { class: 'grid2' }, stat(sum.work, 'shifts'), stat(sum.nights, 'nights'), stat(`${sum.hours}h`, 'rostered hours'), stat(sum.off, 'days off')),
    h('div', { class: 'chips', style: { marginTop: '10px' } }, ...Object.entries(sum.siteCount).map(([k, v]) => h('span', { class: 'chip' }, `${k} × ${v}`)))));
  // legend + sources
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Sources'),
    h('div', { class: 'list' }, ...rotas.map(r => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, UNIT_LABEL[r.unitKind] || r.unit), h('div', { class: 'meta' }, `${r.people.length} people · ${r.sourceName || 'imported'} · ${new Date(r.importedAt).toLocaleDateString('en-GB')}`)),
      h('button', { class: 'btn sm ghost danger', onClick: () => { if (confirm(`Remove ${UNIT_LABEL[r.unitKind]} ${MONTHS[r.month - 1]}?`)) store.update(x => { const rotas = { ...x.rotas }; delete rotas[r.id]; let deleted = store.tombstone(x, `rota:${r.id}`); if (r.driveId) deleted = { ...deleted, [`drive:${r.driveId}`]: Date.now() }; return { ...x, rotas, deleted }; }); } }, 'Remove')))),
    h('div', { class: 'row wrap', style: { marginTop: '10px' } }, importButton('Import / update files'), G.isSignedIn() ? h('button', { class: 'btn', onClick: () => refreshAll(true) }, '☁ Pull from Drive') : null)));
  const gp = rotas.find(r => r.unitKind === 'gp');
  if (gp) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Shift codes'), h('div', { class: 'kv' }, ...gp.legendList.filter(e => e.code).flatMap(e => [h('b', {}, e.code), h('span', {}, [e.desc, e.hoursText].filter(Boolean).join(' · '))]))));
  // desktop: month grid on the left, everything else on the right
  return [head, h('div', { class: 'cols' }, h('div', {}, out[1]), h('div', {}, ...out.slice(2)))];
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
  return h('div', { class: 'card ov' }, h('div', { class: 'title' }, 'Who shares your shift'), h('div', { class: `ov-head ${full ? 'ok' : 'warn'}` }, headline),
    h('div', { class: 'ov-plot' },
      h('div', { class: 'ov-band', style: { left: pct(m.me[0]), width: wpct(m.me[0], m.me[1]) }, 'aria-hidden': 'true' }),
      h('div', { class: 'ov-axis' }, h('span', { class: 'ov-name' }), h('span', { class: 'ov-track' }, ...ticks)),
      h('div', { class: 'ov-row me' }, h('span', { class: 'ov-name' }, h('span', { class: 'av' }, 'You')), h('span', { class: 'ov-track' }, h('i', { class: `ov-in ${today.shift.type}`, style: { left: pct(m.me[0]), width: wpct(m.me[0], m.me[1]) } }, `${hm(m.me[0])}–${hm(m.me[1])}`)), h('span', { class: 'ov-pct' }, fmtDur(m.len))),
      h('div', { class: 'ov-row cov' }, h('span', { class: 'ov-name' }, h('span', { class: 'tiny dim' }, 'cover')), h('span', { class: 'ov-track' }, ...cov), h('span', { class: 'ov-pct' })),
      ...rows),
    m.rows.length > 12 ? h('div', { class: 'tiny dim' }, `+${m.rows.length - 12} more`) : null,
    h('div', { class: 'chips ov-key' }, h('span', { class: 'chip' }, h('i', { class: 'ov-sw in' }), 'with you'), h('span', { class: 'chip' }, h('i', { class: 'ov-sw ghost' }), 'their time outside your shift'), h('span', { class: 'chip' }, h('i', { class: 'ov-sw n1' }), '1', h('i', { class: 'ov-sw n2' }), '2', h('i', { class: 'ov-sw n3' }), '3+ others in')));
}
/** People who share at least two hours of your shift (same shift, or evening/early staff overlapping it). */
function overlapCount(info) { const m = info.mine && info.mine.shift.kind === 'work' ? overlapModel(info.mine, [...info.withMe, ...info.alsoAtSite]) : null; return m ? m.rows.filter(r => r.overlap >= 120).length : 0; }
function stat(v, l) { return h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l)); }

function daySheet(date) {
  const s = S();
  const info = dayInfo(s, date);
  const { today, overnightTail } = myDay(s, date);
  const k = keyOf(date);
  const content = [h('div', { class: 'row' }, h('h2', { class: 'grow' }, `${DAY_NAMES[date.getDay()]} ${fmtDate(date)}`), h('span', { class: 'small muted' }, relDay(date)))];
  if (today) content.push(h('div', { class: 'card hero' }, h('div', { class: 'title' }, 'Your shift'), h('div', { class: 'big' }, today.shift.label), h('div', { class: 'sub' }, `${fmtTime(today.window.start)} – ${fmtTime(today.window.end)} · ${fmtDur(today.shift.hours.durationMin)} · ${today.code}`),
    today.mci ? h('div', { style: { marginTop: '6px' } }, mciBadge()) : null,
    null));
  if (today) { const oc = overlapCard(info, today); if (oc) content.push(oc); const nc = PU.withMeCard(info.date, info.mine); if (nc) content.push(nc); }
  else if (info.mine?.shift.kind === 'leave') content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, info.mine.shift.label)));
  else if (s.me && info.hasRota) content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, overnightTail ? 'Off after night' : 'Day off'), overnightTail ? h('div', { class: 'sub' }, `Night ends ${fmtTime(overnightTail.window.end)}`) : null));
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
  if (info.mine?.swap) content.splice(1, 0, h('div', { class: 'row small', style: { margin: '6px 0 10px' } }, h('span', { class: 'chip swap' }, 'corrected'), h('span', { class: 'muted' }, [info.mine.swap.with ? `swapped with ${info.mine.swap.with}` : '', info.mine.swap.note].filter(Boolean).join(' · '))));
  content.push(h('div', { class: 'row wrap' }, h('button', { class: 'btn grow', onClick: () => { document.querySelector('.sheet-bg')?.remove(); rt.planFrom = startOfDay(date); regenerate(); show('plan'); } }, 'Plan this day'),
    h('button', { class: 'btn grow', onClick: () => { document.querySelector('.sheet-bg')?.remove(); swapHelper(date); } }, 'Who could cover?'),
    h('button', { class: 'btn grow', onClick: () => { document.querySelector('.sheet-bg')?.remove(); swapSheet(date); } }, info.mine?.swap ? 'Edit correction' : 'Correct this day')));
  sheet(content);
}

// Swap helper: who is off on this date, and which of my days they could take
function swapHelper(date) {
  const s = S();
  const info = dayInfo(s, date);
  const candidates = info.off.filter(e => !isMe(s, e.person));
  const prevN = dayInfo(s, addDays(date, -1)).entries.filter(e => e.shift.type === 'N').map(e => personKeyOf(e.person));
  sheet([h('h2', {}, `Cover for ${fmtDateShort(date)}`), h('div', { class: 'small muted', style: { margin: '6px 0 12px' } }, `GP colleagues who are off that day${info.mine ? ` (you: ${info.mine.code || 'off'})` : ''}. Night-before is flagged.`),
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
  rt.suggestions = suggest(s, from, 10, rt.events, { ...mergedApps(), ...M.mindAsks(s, from, 10) }, appMeta);
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

function renderPlan() {
  const s = S();
  const from = rt.planFrom || startOfDay(new Date());
  if (!Object.keys(rt.suggestions).length) regenerate();
  const horizon = planHorizon();
  const out = [h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Plan'), h('button', { class: 'btn sm', onClick: () => { rt.planFrom = startOfDay(new Date()); regenerate(); render(); } }, 'Regenerate')),
    h('div', { class: 'seg', style: { marginTop: '10px' }, role: 'group', 'aria-label': 'How far ahead' }, ...[[3, '3 days'], [7, 'Plan my week'], [10, '10 days']].map(([n, label]) => h('button', { class: horizon === n ? 'active' : '', 'aria-pressed': String(horizon === n), onClick: () => { setPlanHorizon(n); render(); } }, label)))];
  if (!Object.keys(s.rotas).length || !s.me) out.push(h('div', { class: 'banner' }, h('span', { class: 'grow' }, !Object.keys(s.rotas).length ? 'No rota loaded, so every day is planned as a free day. Import your rota first.' : 'Pick your row in Settings › Me so the plan can work around your shifts.'),
    h('button', { class: 'btn sm', onClick: () => show(!Object.keys(s.rotas).length ? 'rota' : 'more') }, !Object.keys(s.rotas).length ? 'Import' : 'Settings')));
  // goals progress this week
  const ws = weekStartOf(new Date());
  const prog = weekProgress(s, ws);
  out.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `This week · ${fmtDateShort(ws)} – ${fmtDateShort(addDays(ws, 6))}`), h('button', { class: 'btn sm ghost', onClick: goalsSheet }, 'Edit goals')),
    ...s.goals.map(g => { const have = prog[g.id] || 0, target = g.hoursPerWeek * 60; return h('div', { style: { margin: '8px 0' } }, h('div', { class: 'row small' }, h('span', { class: 'grow', style: { fontWeight: 600 } }, g.name), h('span', { class: 'muted' }, `${fmtDur(have)} / ${fmtDur(target)}`)), h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, Math.round(have / target * 100))}%`, '--c': g.color } }))); }),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: rulesSheet }, 'Rules'), h('button', { class: 'btn sm', onClick: acceptAllVisible }, `Accept ${planHorizon() === 3 ? 'these 3 days' : planHorizon() === 7 ? 'the week' : 'all 10 days'}`))));
  const rv = reviewCard(); if (rv) out.push(rv);
  // days
  for (let i = 0; i < horizon; i++) {
    const date = addDays(from, i); const k = keyOf(date);
    const { today, afterNight, busy } = dayBusy(s, date, rt.events[k] || []);
    const accepted = (s.plan[k] || []).filter(p => p.status === 'accepted' || p.status === 'done').map(p => ({ ...p, _acc: true }));
    const sugg = (rt.suggestions[k] || []);
    const fixed = busy.filter(b => b.kind === 'shift' || b.kind === 'event' || b.kind === 'protected').map(b => ({ ...b, _fixed: true }));
    const items = [...fixed, ...accepted, ...sugg].sort((a, b) => a.start - b.start);
    const card = h('div', { class: 'card' }, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('div', { class: 'title grow', style: { marginBottom: 0 } }, `${relDay(date)} · ${DAY_NAMES[date.getDay()]} ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`),
      today ? shiftChip(today.shift, today.code) : afterNight ? h('span', { class: 'chip N' }, 'post-night') : h('span', { class: 'chip off' }, 'off')));
    if (!items.length) card.append(h('div', { class: 'muted small' }, 'Nothing planned.'));
    for (const b of items) {
      if (b._fixed) card.append(h('div', { class: 'tl-row' }, h('div', { class: 'tl-time' }, fmtMin(b.start)), h('div', { class: 'tl-block', style: { '--c': b.kind === 'shift' ? 'var(--day)' : b.kind === 'event' ? 'var(--blue)' : 'var(--dim)', opacity: .85 } }, h('div', { class: 'row' }, h('span', { class: 't grow' }, b.label), h('span', { class: 'small muted' }, `${fmtMin(b.start)}–${fmtMin(Math.min(b.end, 1439))}`)))));
      else card.append(blockRow(b, date));
    }
    out.push(card);
  }
  return out;
}
// How many days the Plan tab shows (suggestions and plan.json still cover 10, so other apps see the full picture)
function planHorizon() { if (!rt.planDays) { try { rt.planDays = +localStorage.getItem('citrus.planDays') || 3; } catch { rt.planDays = 3; } } return rt.planDays; }
function setPlanHorizon(n) { rt.planDays = n; try { localStorage.setItem('citrus.planDays', String(n)); } catch {} }
function acceptAllVisible() {
  const shown = new Set(Array.from({ length: planHorizon() }, (_, i) => keyOf(addDays(rt.planFrom || startOfDay(new Date()), i))));
  const all = Object.entries(rt.suggestions).filter(([k]) => shown.has(k)).flatMap(([k, list]) => list.map(b => [k, b]));
  if (!all.length) return toast('No suggestions to accept');
  const days = new Set(all.map(([k]) => k)).size;
  const toCal = G.isSignedIn() && S().settings.pushPlan !== false;
  const { close } = sheet([h('h2', {}, `Accept ${all.length} blocks?`),
    h('p', { class: 'small muted' }, `${all.length} suggestions across ${days} days${toCal ? ' will be added to your Google Calendar' : ''}. You can remove any of them later from Plan.`),
    h('div', { class: 'row' }, h('button', { class: 'btn primary grow', onClick: async () => { close(); for (const [k, b] of all) await acceptBlock(k, b, { silent: true }); toast(`Planned ${all.length} blocks`, 'ok'); render(); } }, `Accept ${all.length}`),
      h('button', { class: 'btn grow', onClick: () => close() }, 'Cancel'))]);
}

function goalsSheet() {
  const s = S();
  const rows = s.goals.map(g => goalRow(g));
  const list = h('div', {}, ...rows);
  const { close } = sheet([h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Goals'), h('button', { class: 'btn sm', onClick: () => { list.append(goalRow({ id: store.newId('g-'), name: '', kind: 'study', hoursPerWeek: 2, minBlock: 30, maxBlock: 90, priority: s.goals.length + 1, color: '#ff7a1a' })); } }, '+ Add')),
    h('div', { class: 'small muted', style: { margin: '4px 0 10px' } }, 'Weekly budgets drive the planner. Name a goal after an app (Yuzu, Mephisto…) and its Drive status will steer the block length.'),
    list,
    h('button', { class: 'btn primary block', style: { marginTop: '10px' }, onClick: () => {
      const goals = [...list.querySelectorAll('.goal-row')].map(r => ({
        id: r.dataset.id, name: r.querySelector('[name=name]').value.trim() || 'Goal', kind: r.querySelector('[name=kind]').value,
        hoursPerWeek: +r.querySelector('[name=hpw]').value || 0, minBlock: +r.querySelector('[name=min]').value || 30, maxBlock: +r.querySelector('[name=max]').value || 90,
        priority: +r.querySelector('[name=prio]').value || 5, color: r.querySelector('[name=color]').value, deadline: r.querySelector('[name=deadline]').value, daily: r.querySelector('[name=daily]').checked,
      }));
      store.update(x => ({ ...x, goals })); regenerate(); close(); render();
    } }, 'Save goals')]);
  function goalRow(g) {
    const row = h('div', { class: 'card goal-row', dataset: { id: g.id } },
      h('div', { class: 'row' }, h('input', { name: 'color', type: 'color', value: g.color || '#ff7a1a', style: { width: '36px', height: '36px', border: 0, background: 'none', padding: 0 } }), h('input', { name: 'name', value: g.name, placeholder: 'Goal name', style: { flex: 1, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '8px 10px' } }),
        h('button', { class: 'btn sm ghost danger', onClick: () => row.remove() }, '✕')),
      h('div', { class: 'field', style: { marginTop: '8px' } }, h('div', { class: 'inline' },
        lab('Type', h('select', { name: 'kind' }, ...['study', 'habit', 'fitness', 'social', 'rest', 'other'].map(k => h('option', { value: k, selected: g.kind === k }, k)))),
        lab('h / week', h('input', { name: 'hpw', type: 'number', step: '0.5', min: 0, value: g.hoursPerWeek })),
        lab('Priority', h('input', { name: 'prio', type: 'number', min: 1, max: 9, value: g.priority })))),
      h('div', { class: 'field' }, h('div', { class: 'inline' }, lab('Min block (min)', h('input', { name: 'min', type: 'number', value: g.minBlock })), lab('Max block', h('input', { name: 'max', type: 'number', value: g.maxBlock })), lab('Deadline', h('input', { name: 'deadline', type: 'date', value: g.deadline || '' })))),
      h('label', { class: 'row small' }, h('input', { name: 'daily', type: 'checkbox', checked: !!g.daily }), 'Every day (habit)'));
    return row;
  }
}
function lab(l, input) { return h('div', { class: 'col' }, h('label', { class: 'tiny muted' }, l), input); }

function rulesSheet() {
  const r = S().rules;
  const f = (name, label, value, type = 'number') => lab(label, h('input', { name, type, value }));
  const prot = h('div', {}, ...(r.protectedBlocks || []).map(protRow));
  function protRow(b) {
    return h('div', { class: 'row prot-row', dataset: { id: b.id || uid() }, style: { marginBottom: '6px' } }, h('input', { name: 'label', value: b.label, placeholder: 'Label', style: { flex: 1, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: '8px', padding: '6px 8px' } }),
      h('input', { name: 'start', type: 'time', value: fmtMin(b.start) }), h('input', { name: 'end', type: 'time', value: fmtMin(b.end) }),
      h('select', { name: 'days' }, h('option', { value: '', selected: !b.days?.length }, 'daily'), ...DAY_SHORT.map((d, i) => h('option', { value: i, selected: b.days?.length === 1 && b.days[0] === i }, d)), h('option', { value: 'wk', selected: b.days?.length === 2 }, 'Fri+Sat')),
      h('button', { class: 'btn sm ghost danger', onClick: (e) => e.target.closest('.prot-row').remove() }, '✕'));
  }
  const form = h('div', {},
    h('div', { class: 'field' }, h('div', { class: 'inline' }, f('sleepHours', 'Sleep hours', r.sleepHours), lab('Lights out (free days)', h('input', { name: 'sleepStart', type: 'time', value: fmtMin(r.sleepStart) })), lab('Wake (free days)', h('input', { name: 'wakeMin', type: 'time', value: fmtMin(r.wakeMin) })))),
    h('div', { class: 'field' }, h('div', { class: 'inline' }, lab('After a night, free from', h('input', { name: 'postNightRecoveryUntil', type: 'time', value: fmtMin(r.postNightRecoveryUntil) })), f('preShiftBufferMin', 'Before shift (min)', r.preShiftBufferMin), f('postShiftBufferMin', 'After shift (min)', r.postShiftBufferMin))),
    h('div', { class: 'field' }, h('div', { class: 'inline' }, f('maxStudyOnWorkday', 'Max study on a work day (min)', r.maxStudyOnWorkday), f('maxStudyOnFreeDay', 'Max study on a free day (min)', r.maxStudyOnFreeDay))),
    h('div', { class: 'field' }, h('div', { class: 'inline' }, lab('Plan from', h('input', { name: 'earliestPlan', type: 'time', value: fmtMin(r.earliestPlan) })), lab('Plan until', h('input', { name: 'latestPlan', type: 'time', value: fmtMin(r.latestPlan) })))),
    h('div', { class: 'field' }, h('label', {}, 'Commute (minutes) per site'), h('div', { class: 'inline', style: { flexWrap: 'wrap' } }, ...Object.entries(r.commute).map(([k, v]) => lab(k, h('input', { name: 'commute:' + k, type: 'number', value: v, style: { minWidth: '70px' } }))))),
    h('div', { class: 'field' }, h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Protected time (never planned over)'), h('button', { class: 'btn sm', onClick: () => prot.append(protRow({ id: uid(), label: '', start: 19 * 60, end: 21 * 60, days: [] })) }, '+')), prot));
  const { close } = sheet([h('h2', {}, 'Planner rules'), h('div', { style: { height: '10px' } }), form,
    h('button', { class: 'btn primary block', onClick: () => {
      const v = (n) => form.querySelector(`[name="${n}"]`).value;
      const tmin = (n) => { const [a, b] = v(n).split(':').map(Number); return a * 60 + b; };
      const commute = {}; for (const el of form.querySelectorAll('[name^="commute:"]')) commute[el.name.slice(8)] = +el.value || 0;
      const protectedBlocks = [...form.querySelectorAll('.prot-row')].map(row => { const g = (n) => row.querySelector(`[name=${n}]`).value; const [a, b] = g('start').split(':').map(Number), [c, d] = g('end').split(':').map(Number); const dv = g('days'); return { id: row.dataset.id, label: g('label') || 'Protected', start: a * 60 + b, end: c * 60 + d, days: dv === '' ? [] : dv === 'wk' ? [5, 6] : [+dv] }; });
      store.update(s => ({ ...s, rules: { ...s.rules, sleepHours: +v('sleepHours'), sleepStart: tmin('sleepStart'), wakeMin: tmin('wakeMin'), postNightRecoveryUntil: tmin('postNightRecoveryUntil'), preShiftBufferMin: +v('preShiftBufferMin'), postShiftBufferMin: +v('postShiftBufferMin'), maxStudyOnWorkday: +v('maxStudyOnWorkday'), maxStudyOnFreeDay: +v('maxStudyOnFreeDay'), earliestPlan: tmin('earliestPlan'), latestPlan: tmin('latestPlan'), commute, protectedBlocks } }));
      regenerate(); close(); render();
    } }, 'Save rules')]);
}

// ---------------- MORE / SETTINGS ----------------
let appSel = '';
const ago = (min) => min == null ? 'not reporting yet' : min < 60 ? `${Math.max(1, min)} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
function renderApps() {
  const apps = mergedApps(), today = keyOf(new Date()), names = [...new Set([...Object.keys(APP_META), ...Object.keys(apps)])];
  const info = names.map(name => {
    const st = apps[name] || apps[name.toLowerCase()] || {}, meta = appMeta(name, st), ageMin = st.updatedAt ? Math.round((Date.now() - new Date(st.updatedAt)) / 60000) : null;
    const asks = (st.asks || []).filter(x => x.date === today), minutes = Math.round(asks.reduce((x, y) => x + (+y.minutes || 0), 0)), waiting = (st.pending || []).length + (st.due || 0);
    return { name, st, meta, ageMin, fresh: ageMin != null && ageMin <= 36 * 60, done: !!st.today?.done, asks, minutes, badge: minutes || st.due || 0, waiting, url: meta.url ? `${meta.url}${meta.url.includes('?') ? '&' : '?'}from=citrus` : '' };
  });
  const need = info.find(i => i.fresh && !i.done && (i.minutes || i.waiting)) || info.find(i => i.fresh) || info[0];
  if (!info.some(i => i.name === appSel)) appSel = need?.name || '';
  const cur = info.find(i => i.name === appSel), reporting = info.filter(i => i.fresh).length, totalMin = info.reduce((t, i) => t + i.minutes, 0), totalWait = info.reduce((t, i) => t + i.waiting, 0);
  const pick = (name) => { appSel = name; render(); };
  const hero = h('div', { class: 'card constel' },
    h('div', { class: 'c-stats' }, [[`${reporting}/${info.length}`, 'reporting'], [totalMin ? `${totalMin}m` : '–', 'asked today'], [totalWait || '–', 'waiting']].map(([v, l]) => h('div', {}, h('b', {}, String(v)), h('span', {}, l)))),
    constellation(info.map(i => ({ key: i.name, icon: i.meta.icon, color: i.meta.color, badge: i.badge, fresh: i.fresh, done: i.done, label: i.meta.title })), appSel, pick),
    h('div', { class: 'c-chips', role: 'tablist' }, info.map(i => h('button', { class: `c-chip ${i.name === appSel ? 'on' : ''} ${i.fresh ? '' : 'stale'}`, style: { '--c': i.meta.color }, role: 'tab', 'aria-selected': i.name === appSel ? 'true' : 'false', onClick: () => pick(i.name) }, h('span', {}, i.meta.icon), i.meta.title))));
  const detail = !cur ? null : (() => {
    const { st, meta } = cur, status = cur.done ? 'Done today' : cur.fresh ? `Updated ${ago(cur.ageMin)}` : cur.ageMin == null ? 'Not reporting yet' : `Quiet for ${ago(cur.ageMin).replace(' ago', '')}`;
    return h('div', { class: `card app-detail ${cur.fresh ? '' : 'stale'}`, style: { '--c': meta.color, '--c-soft': meta.color + '26' } },
      h('div', { class: 'ad-head' }, h('div', { class: 'ic' }, meta.icon), h('div', { class: 'grow' }, h('div', { class: 'nm' }, meta.title), h('div', { class: `ad-status ${cur.done ? 'ok' : cur.fresh ? '' : 'dim'}` }, h('i', {}), status)),
        cur.url ? h('a', { class: 'btn primary', href: cur.url, target: '_blank', rel: 'noopener' }, 'Open ▸') : null),
      st.summary || st.next?.title ? h('div', { class: 'ad-sum' }, st.summary || st.next.title) : null,
      !cur.fresh && cur.ageMin == null ? h('div', { class: 'dim small' }, 'Open it once and sign in with Google. It will then write its status to Drive, and Citrus picks it up here.') : null,
      (st.actions || []).length ? [h('div', { class: 'ad-h' }, 'Jump straight in'), actionChips(cur.name, st, 6)] : null,
      cur.asks.length ? [h('div', { class: 'ad-h' }, 'Asked of you today'), h('div', { class: 'ad-asks' }, cur.asks.map(a => h('div', { class: 'ad-ask' }, h('span', { class: 'grow' }, a.title || meta.title), a.minutes ? h('b', {}, `${Math.round(a.minutes)} min`) : null, a.slot ? h('small', {}, a.slot) : null)))] : null,
      (st.pending || []).length ? [h('div', { class: 'ad-h' }, 'Waiting on you'), h('div', { class: 'tags' }, (st.pending || []).slice(0, 8).map(p => h('span', { class: 'chip' }, String(p).slice(0, 60))))] : null,
      (st.metrics || []).length ? [h('div', { class: 'ad-h' }, 'Numbers it reports'), h('div', { class: 'tags' }, st.metrics.slice(0, 6).map(m => h('span', { class: 'chip' }, `${m.label || m.id}: ${m.value}${m.unit ? ' ' + m.unit : ''}`)))] : null);
  })();
  return [h('h1', {}, 'Apps'), hero, detail, MU.receivedCard(), issuesCard(apps),
    h('details', { class: 'card how' }, h('summary', {}, 'How the apps talk to Citrus'),
      h('div', { class: 'small muted' }, 'Each app writes hub/<app>/status.json to Drive › My Apps › hub (summary, what it needs today as “asks”, pending items, numbers, deep links). Citrus places the asks in your plan around shifts, keeps the numbers as history for habits and objectives, and writes hub/citrus/plan.json back for the apps. Stars glow when an app reported in the last 36 hours; the number is minutes asked today or items due.'))];
}

function renderMore() {
  const s = S();
  const out = [h('h1', {}, 'Settings')];
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
  const people = allPeople(s).filter(p => p.units.includes('gp'));
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Me'),
    people.length ? h('div', { class: 'field' }, h('label', {}, 'Which row is you in the GP rota?'), h('select', { onChange: (e) => { const p = people.find(x => x.key === e.target.value); store.update(x => ({ ...x, me: p ? { name: p.name, id: p.id } : null })); } },
      h('option', { value: '' }, '— choose —'), ...people.map(p => h('option', { value: p.key, selected: isMe(s, p) }, `${p.name}${p.title ? ' · ' + p.title : ''}`)))) : h('div', { class: 'muted small' }, 'Import a rota first')));
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
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'App'),
    toggleRow('Light theme', s.settings.theme === 'light', (on) => { store.update(x => ({ ...x, settings: { ...x.settings, theme: on ? 'light' : 'dark' } }), { silent: true }); applyTheme(); }),
    h('div', { class: 'row wrap', style: { marginTop: '10px' } },
      h('button', { class: 'btn', onClick: () => { const blob = new Blob([store.exportJSON()], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `citrus-maxima-backup-${keyOf(new Date())}.json` }); a.click(); } }, '⬇ Backup'),
      (() => { const inp = h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onChange: async (e) => { try { const j = JSON.parse(await e.target.files[0].text()); if (!j || typeof j !== 'object' || !j.rotas) throw new Error('bad'); store.replaceState(j, { bump: true }); regenerate(); toast('Restored', 'ok'); } catch (err) { toast('Bad backup file', 'err'); } } }); return h('span', {}, inp, h('button', { class: 'btn', onClick: () => inp.click() }, '⬆ Restore')); })(),
      h('button', { class: 'btn danger', onClick: () => { if (confirm('Erase all local data?')) { localStorage.clear(); location.reload(); } } }, 'Erase')),
    h('div', { class: 'tiny dim', style: { marginTop: '10px' } }, 'Citrus Maxima · personal scheduler & hub · data lives in your browser and your own Google Drive.')));
  return out;
}
function toggleRow(label, on, cb) {
  const t = h('button', { class: `toggle ${on ? 'on' : ''}`, onClick: () => { on = !on; t.classList.toggle('on', on); cb(on); } });
  return h('div', { class: 'switch' }, h('span', { class: 'small' }, label), t);
}

// ---------------- search (people, days, apps, goals) ----------------
function openSearch() {
  document.querySelector('.search')?.remove();
  const s = S();
  const input = h('input', { placeholder: 'Search people, a date (21/11), an app, a goal…', autofocus: true });
  const res = h('div', { class: 'res' });
  const wrap = h('div', { class: 'search', onClick: (e) => { if (e.target === wrap) wrap.remove(); } }, h('div', { class: 'box' }, input, res));
  let items = [];
  const build = (q) => {
    q = q.trim().toLowerCase(); items = [];
    if (!q) { res.replaceChildren(); return; }
    const dm = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/.exec(q);
    if (dm) { const y = dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : new Date().getFullYear(); const d = new Date(y, +dm[2] - 1, +dm[1]); if (!isNaN(d)) items.push({ label: `${DAY_NAMES[d.getDay()]} ${fmtDate(d)}`, meta: dayInfo(s, d).mine?.shift.label || 'day', run: () => { rt.rotaSel = d; rt.rotaMonth = new Date(d.getFullYear(), d.getMonth(), 1); show('rota'); daySheet(d); } }); }
    for (const p of allPeople(s)) if (p.name.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q)) items.push({ label: p.name, meta: p.title, run: () => personSheet(p) });
    for (const [name, st] of Object.entries(mergedApps())) {
      const m = appMeta(name, st); if (m.title.toLowerCase().includes(q) || /^open\b/.test(q) && q.includes(m.title.toLowerCase())) items.push({ label: `${m.icon} Open ${m.title}`, meta: st.summary || 'open', run: () => launch(name) });
      for (const a of st.actions || []) if (`${m.title} ${a.label}`.toLowerCase().includes(q)) items.push({ label: `${m.icon} ${m.title}: ${a.label}`, meta: 'jump straight in', run: () => launch(name, a.id) });
    }
    for (const g of s.goals) if (g.name.toLowerCase().includes(q)) items.push({ label: g.name, meta: `${g.hoursPerWeek} h/week`, run: () => { show('plan'); goalsSheet(); } });
    for (const [k, t] of Object.entries(s.notes || {})) if (t && t.toLowerCase().includes(q)) items.push({ label: t.slice(0, 60), meta: `note · ${fmtDate(fromKey(k))}`, run: () => { rt.rotaSel = fromKey(k); show('rota'); daySheet(fromKey(k)); } });
    for (const it of MU.searchItems()) if (`${it.title} ${it.kind}`.toLowerCase().includes(q)) items.push({ label: it.title, meta: `${it.kind} · ${it.sub}`, run: () => { show('mind'); it.run(); } });
    items = items.slice(0, 12);
    res.replaceChildren(...items.map((it, i) => h('div', { class: `item ${i === 0 ? 'hl' : ''}`, onClick: () => { wrap.remove(); it.run(); } }, h('div', { class: 'grow' }, h('div', { class: 'name' }, it.label), it.meta ? h('div', { class: 'meta' }, it.meta) : null))));
  };
  input.addEventListener('input', () => build(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && items[0]) { wrap.remove(); items[0].run(); } });
  document.body.append(wrap); input.focus();
}

// ---------------- swaps: your own corrections on top of the imported rota ----------------
function swapSheet(date) {
  const s = S(); const k = keyOf(date);
  const info = dayInfo(s, date);
  const gp = info.rotas.find(r => r.unitKind === 'gp');
  const codes = gp ? [...new Set(gp.legendList.map(e => e.code).flatMap(c => c.split(/\s*[\\\/]\s*/)).filter(c => c && c.length <= 4))] : ['D1', 'D2', 'N1', 'N2'];
  const cur = s.swaps?.[k];
  const code = h('select', {}, h('option', { value: '' }, 'Off (no shift)'), ...codes.map(c => h('option', { value: c, selected: cur ? cur.code === c : info.mine?.code === c }, c)));
  const people = allPeople(s).filter(p => p.units.includes('gp') && !isMe(s, p));
  const withSel = h('select', {}, h('option', { value: '' }, '— nobody / not a swap —'), ...people.map(p => h('option', { value: p.name, selected: cur?.with === p.name }, p.name)));
  const note = h('input', { placeholder: 'Note (optional)', value: cur?.note || '' });
  const { close } = sheet([h('h2', {}, `Correct ${fmtDateShort(date)}`), h('p', { class: 'small muted' }, `The rota says ${info.mine?.code || 'off'}. Record what actually happens — a swap, a cover, a cancelled shift. Imports never overwrite this.`),
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

window.__citrus = { refreshAll, publishPlan, saveStateNow, store, G, rt };   // for the console and the tests
boot();
