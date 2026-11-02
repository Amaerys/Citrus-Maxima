import * as store from './store.js';
import { mergeStates } from './store.js';
import * as G from './google.js';
import { parseRotaFile, serializeRota } from './rota-parser.js';
import { dayInfo, myDay, allPeople, isMe, sharedShifts, monthSummary, shiftWindow, UNIT_LABEL } from './model.js';
import { suggest, dayBusy, learn, weekStartOf, weekProgress } from './planner.js';
import { h, toast, keyOf, fromKey, addDays, startOfDay, sameDay, fmtDate, fmtDateShort, fmtTime, fmtMin, fmtDur, relDay, pad2, DAY_SHORT, DAY_NAMES, MONTHS, telLink, firstName, atMin, minsOf, uid } from './util.js';

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
    const tabs = ['today', 'rota', 'team', 'plan', 'apps'];
    if (/^[1-5]$/.test(e.key)) { show(tabs[+e.key - 1]); e.preventDefault(); }
    else if (e.key === '/') { openSearch(); e.preventDefault(); }
    else if (e.key === 'r') refreshAll(true);
    else if (e.key === ',') show('more');
  });
  window.addEventListener('online', () => { rt.online = true; renderSync(); flushOutbox().then(render).catch(() => {}); });
  window.addEventListener('offline', () => { rt.online = false; renderSync(); });
  store.subscribe(() => render());
  store.onRemoteSync(scheduleRemoteSave);
  loadCachedEvents();
  if (S().me && Object.keys(S().rotas).length) regenerate();
  show(location.hash.replace('#', '') || 'today');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const cid = S().settings.clientId;
  if (cid && rt.online) {
    try { await G.init(cid); } catch (e) { console.warn(e); }
    if (G.isSignedIn()) refreshAll(false);
    else if (G.wasSignedIn()) G.signIn({ silent: true }).then(() => refreshAll(false)).catch(() => { G.auth.needsSignIn = true; render(); });
  }
  G.onAuthChange(() => { renderSync(); render(); });
  // keep fresh: re-sync when the app comes back to the foreground after a while
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G.isSignedIn() && Date.now() - (S().google.lastSync || 0) > 10 * 60000) refreshAll(false); });
  renderSync();
}

// Shown at the top of every screen when the Google session needs a tap to come back
function authBanner() {
  if (!G.auth.needsSignIn || !rt.online) return null;
  return h('div', { class: 'banner' }, h('span', { class: 'grow' }, 'Google sign-in expired — your calendar and Drive are paused.'),
    h('button', { class: 'btn sm primary', onClick: async () => { try { await G.signIn(); refreshAll(true); } catch (e) { toast(e.message, 'err'); } } }, 'Sign in'));
}

function show(view) {
  rt.view = view;
  for (const s of document.querySelectorAll('section.view')) s.classList.toggle('active', s.id === `view-${view}`);
  for (const b of document.querySelectorAll('nav.tabs button')) b.classList.toggle('active', b.dataset.view === view);
  history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo(0, 0);
}

function render() {
  const fn = { today: renderToday, rota: renderRota, team: renderTeam, plan: renderPlan, apps: renderApps, more: renderMore }[rt.view] || renderToday;
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

let saveTimer = null;
function scheduleRemoteSave() {
  if (!G.isSignedIn() || !rt.online) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await G.saveRemoteState(S().settings.driveFolder, stripForRemote(S())); } catch (e) { console.warn('remote save failed', e.message); }
  }, 2500);
}
function stripForRemote(s) { return { ...s, apps: undefined }; }

async function refreshAll(manual) {
  if (!G.isSignedIn()) { if (manual) toast(S().settings.clientId ? 'Sign in to Google in Settings' : 'Add your Google client ID in Settings'); render(); return; }
  if (!rt.online) { if (manual) toast('You are offline'); return; }
  rt.syncing = true; renderSync();
  const problems = [];
  try {
    // 1. remote state (newer wins, rotas merged)
    try {
      const remote = await G.loadRemoteState(S().settings.driveFolder);
      if (remote && remote.updatedAt !== S().updatedAt) {
        const merged = mergeStates(S(), remote);
        merged.updatedAt = Math.max(S().updatedAt, remote.updatedAt);
        store.replaceState(merged);
        if (remote.updatedAt < S().updatedAt) scheduleRemoteSave();
      } else if (!remote) scheduleRemoteSave();
    } catch (e) { problems.push('state: ' + e.message); }
    // 2–5 run in parallel: email, rota files, app statuses, calendars
    const step = async (label, fn) => { try { await fn(); } catch (e) { problems.push(`${label}: ${e.message}`); } };
    await Promise.all([
      step('account', async () => { if (!S().google.email) { const u = await G.userInfo(); store.update(s => ({ ...s, google: { ...s.google, email: u.email } }), { remote: false, silent: true }); } }),
      step('rotas', pullRotasFromDrive),
      step('apps', async () => {
        const drive = await G.listAppStatus(S().settings.driveFolder);
        const local = localAppStatuses();
        for (const [name, st] of Object.entries(local)) {
          const d = drive[name];
          if (!d || (st.updatedAt || '') > (d.updatedAt || '')) { try { await G.uploadAppStatus(S().settings.driveFolder, name, st); drive[name] = st; } catch (e) { console.warn('mirror', name, e.message); } }
        }
        store.update(s => ({ ...s, apps: drive }), { remote: false, silent: true });
      }),
      step('calendar', async () => {
        rt.calendars = await G.listCalendars();
        const now = new Date();
        await Promise.all([loadEvents(new Date(now.getFullYear(), now.getMonth(), 1), true), loadEvents(new Date(now.getFullYear(), now.getMonth() + 1, 1), true)]);
      }),
    ]);
    // 5b. queued calendar writes
    try { await flushOutbox(); } catch (e) { problems.push('outbox: ' + e.message); }
    // 6. push shifts
    if (S().settings.pushShifts) { try { await pushShiftsToCalendar(); } catch (e) { problems.push('shift push: ' + e.message); } }
    store.update(s => ({ ...s, google: { ...s.google, lastSync: Date.now() } }), { remote: false, silent: true });
    regenerate();
    rt.lastProblems = problems; rt.lastSyncAt = Date.now();
    if (manual) toast(problems.length ? 'Synced with issues — see More › Diagnostics' : 'Synced', problems.length ? 'err' : 'ok');
    else if (problems.length) console.warn(problems);
  } finally { rt.syncing = false; renderSync(); render(); }
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
    try {
      const buf = await G.downloadRota(f);
      const rota = serializeRota(await parseRotaFile(buf, f.name));
      rota.driveId = f.id; rota.driveModified = f.modifiedTime;
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
    const from = new Date(r.year, r.month - 1, 1), to = new Date(r.year, r.month, 2);
    const wanted = [];
    for (let d = 1; d <= r.daysInMonth; d++) {
      const date = new Date(r.year, r.month - 1, d);
      const info = dayInfo(s, date);
      if (!info.mine || info.mine.shift.kind !== 'work') continue;
      const w = shiftWindow(date, info.mine.shift);
      if (!w) continue;
      const with_ = info.withMe.map(e => firstName(e.person.name)).join(', ');
      wanted.push({ title: `${info.mine.code} · ${info.mine.shift.label}`, start: w.start, end: w.end, location: info.mine.shift.site, description: with_ ? `With: ${with_}` : '' });
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
      try { const st = JSON.parse(localStorage.getItem(k)); if (st && typeof st === 'object') out[st.title || st.app || k.slice(14)] = st; } catch {}
    }
  } catch {}
  return out;
}
// Drive copies merged with fresher same-device copies
function mergedApps() {
  const apps = { ...(S().apps || {}) };
  for (const [name, st] of Object.entries(localAppStatuses())) if (!apps[name] || (st.updatedAt || '') > (apps[name].updatedAt || '')) apps[name] = st;
  return apps;
}

// Calendar writes that could not be sent are kept and retried on the next sync / when back online
async function calendarCreate(calendarId, payload, meta = {}) {
  if (!rt.online || !G.isSignedIn()) { queueOutbox({ type: 'create', calendarId, payload, meta }); return null; }
  try { return await G.createEvent(calendarId, payload); }
  catch (e) { if (/network|expired|not signed/i.test(e.message)) { queueOutbox({ type: 'create', calendarId, payload, meta }); return null; } throw e; }
}
function queueOutbox(op) { store.update(s => ({ ...s, outbox: [...(s.outbox || []), { ...op, id: uid(), at: Date.now() }] }), { silent: true, remote: false }); toast('Saved — will reach your calendar when online'); }
async function flushOutbox() {
  const ops = S().outbox || []; if (!ops.length || !G.isSignedIn() || !rt.online) return;
  const left = [];
  for (const op of ops) {
    try {
      if (op.type === 'create') {
        const ev = await G.createEvent(op.calendarId, { ...op.payload, start: new Date(op.payload.start), end: new Date(op.payload.end) });
        if (op.meta?.blockId && op.meta?.dateKey) store.update(s => ({ ...s, plan: { ...s.plan, [op.meta.dateKey]: (s.plan[op.meta.dateKey] || []).map(p => p.id === op.meta.blockId ? { ...p, eventId: ev.id, calendarId: ev.calendarId } : p) } }), { silent: true });
      } else if (op.type === 'delete') await G.deleteEvent(op.calendarId, op.eventId);
    } catch (e) { if (!/404|410/.test(e.message)) left.push(op); }
  }
  store.update(s => ({ ...s, outbox: left }), { silent: true });
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
      store.update(s => ({ ...s, rotas: { ...s.rotas, [rota.id]: rota } }), { silent: true });
      ok++;
    } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
  if (ok) { toast(`Imported ${ok} rota${ok > 1 ? 's' : ''}`, 'ok'); autoPickMe(); regenerate(); render(); }
}

function importButton(label = 'Import rota files') {
  const input = h('input', { type: 'file', accept: '.xlsx', multiple: true, style: { display: 'none' }, onChange: (e) => importFiles([...e.target.files]) });
  return h('span', {}, input, h('button', { class: 'btn', onClick: () => input.click() }, '📄 ', label));
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
    h('span', { class: 'av' }, initials(p.name)), firstName(p.name), entry.code ? h('span', { class: 'dim tiny' }, entry.code) : null, entry.mci ? h('span', { class: 'tiny', title: 'MCI 2nd physician' }, '🚨') : null);
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
    contactButtons(p.mobile),
    isMe(s, p) ? null : h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'title' }, `Shifts with you (${shared.length})`),
      shared.length ? h('div', { class: 'chips' }, ...shared.map(x => h('span', { class: `chip ${x.shift.type}` }, `${fmtDateShort(x.date)} ${x.shift.type}`))) : h('div', { class: 'muted small' }, 'None in the loaded rotas')),
    ...months.map(r => {
      const me = r.people.find(x => personKeyOf(x) === key);
      return h('div', { class: 'card' }, h('div', { class: 'title' }, `${MONTHS[r.month - 1]} ${r.year} · ${UNIT_LABEL[r.unitKind] || r.unit}`), miniMonth(r, me));
    }),
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
  const { info, today, overnightTail, afterNight } = myDay(s, now);
  const tomorrow = myDay(s, addDays(now, 1));

  // hero: words on the left, the day dial on the right
  const hero = h('div', { class: 'card hero', style: today?.shift.type === 'N' ? { '--accent-soft': 'var(--night-soft)' } : afterNight ? { '--accent-soft': 'var(--night-soft)' } : {} });
  const words = h('div', {});
  words.append(h('div', { class: 'title' }, `${DAY_NAMES[now.getDay()]} ${fmtDate(now)}`));
  if (!info.hasRota) words.append(h('div', { class: 'big' }, 'No rota for this month'), h('div', { class: 'sub' }, 'Import the Excel files, or drop them in Drive › My Apps › Rotas.'));
  else if (!s.me) words.append(h('div', { class: 'big' }, 'Who are you?'), h('div', { class: 'sub' }, 'Pick your row in Settings › Me.'));
  else if (today) {
    const w = today.window;
    words.append(h('div', { class: 'big' }, today.shift.label),
      h('div', { class: 'sub' }, `${fmtTime(w.start)}–${fmtTime(w.end)}${today.shift.hours.overnight ? ', overnight' : ''} · ${fmtDur(today.shift.hours.durationMin)} · ${today.code}`),
      countdown(w),
      today.mci ? h('div', { style: { marginTop: '8px' } }, mciBadge()) : null);
  } else if (info.mine && info.mine.shift.kind === 'leave') words.append(h('div', { class: 'big' }, info.mine.shift.label), h('div', { class: 'sub' }, 'Enjoy it.'));
  else words.append(h('div', { class: 'big' }, afterNight ? 'Off, after a night' : 'Day off'), h('div', { class: 'sub' }, afterNight ? `Your night ends ${fmtTime(overnightTail.window.end)}. Recover first; the plan stays light.` : 'A free day. The planner has ideas below.'));
  if (overnightTail && today) words.append(h('div', { class: 'small muted', style: { marginTop: '6px' } }, `Night from yesterday ends ${fmtTime(overnightTail.window.end)}`));
  const tmr = tomorrow.today ? `${tomorrow.today.shift.label} ${fmtMin(tomorrow.today.shift.hours.start)}–${fmtMin(tomorrow.today.shift.hours.end)}` : tomorrow.info.mine?.shift.kind === 'leave' ? tomorrow.info.mine.shift.label : (info.hasRota && s.me ? 'off' : '');
  if (tmr) words.append(h('div', { class: 'small', style: { marginTop: '10px' } }, h('span', { class: 'muted' }, 'Tomorrow '), tmr));
  hero.append(h('div', { class: 'hero-grid' }, words, info.hasRota && s.me ? dayDial(now) : null));
  hero.append(weekStrip(now));
  main.push(hero);

  if (today) {
    main.push(h('div', { class: 'card' }, h('div', { class: 'title' }, `With you at ${today.shift.site || 'your site'}`),
      info.withMe.length ? h('div', { class: 'people' }, ...info.withMe.map(e => personPill(e))) : h('div', { class: 'muted small' }, 'Nobody else on your shift, per the GP rota.'),
      info.alsoAtSite.length ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'tiny dim', style: { marginBottom: '4px' } }, 'Other shift at the same site (handover)'), h('div', { class: 'people' }, ...info.alsoAtSite.map(e => personPill(e)))) : null));
  }
  if (info.hasRota) main.push(onCallCard(info));
  main.push(planCard(now));
  side.push(eventsCard(now));
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
  if (today?.mci) svg.append(el('circle', { cx: C, cy: C, r: rOuter + w / 2 + 2, fill: 'none', stroke: 'var(--cyan)', 'stroke-width': 1.5, opacity: .8 }));
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
    lines.push(`${today.shift.label}, ${fmtTime(today.window.start)}–${fmtTime(today.window.end)} (${today.code})${today.mci ? ' — MCI 2nd physician' : ''}`);
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

function mciBadge(short = false) {
  return h('span', { class: 'chip mci', title: 'MCI 2nd physician: if a mass-casualty incident happens near FSED (Six Flags, Aqua Arabia…) you are moved there immediately' }, '🚨 ', short ? 'MCI' : 'MCI 2nd physician today');
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
  if (info.mci.length) groups.push(h('div', { class: 'site-group' }, h('h3', {}, '🚨 MCI 2nd physicians'), h('div', { class: 'people' }, ...info.mci.map(e => personPill(e))), h('div', { class: 'tiny dim', style: { marginTop: '4px' } }, 'Moved to the incident site immediately if a mass-casualty incident happens near FSED')));
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Specialists & MCI'), ...groups);
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
  } }, h('input', { name: 'q', placeholder: 'Quick add: "Dentist Tue 3pm 1h"', style: { flex: 1, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '9px 12px' } }), h('button', { class: 'btn sm primary' }, '+'));
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
  let t = text, date = startOfDay(base), start = 9 * 60, dur = 60, had = false;
  const dayIdx = DAY_SHORT.findIndex(d => new RegExp(`\\b${d}`, 'i').test(t));
  if (/\btomorrow\b/i.test(t)) { date = addDays(date, 1); t = t.replace(/\btomorrow\b/i, ''); }
  else if (dayIdx >= 0) { let diff = (dayIdx - date.getDay() + 7) % 7; if (diff === 0) diff = 7; date = addDays(date, diff); t = t.replace(new RegExp(`\\b${DAY_SHORT[dayIdx]}\\w*`, 'i'), ''); }
  const dm = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(t);
  if (dm) { date = new Date(dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : date.getFullYear(), +dm[2] - 1, +dm[1]); t = t.replace(dm[0], ''); }
  const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(t);
  if (tm) { let hh = +tm[1]; const mm = +(tm[2] || 0); const ap = (tm[3] || '').toLowerCase(); if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; if (!ap && hh < 7) hh += 12; start = hh * 60 + mm; t = t.replace(tm[0], ''); had = true; }
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

async function acceptBlock(k, b, { silent = false } = {}) {
  const block = { ...b, status: 'accepted', at: Date.now() }; delete block._acc;
  store.update(s => ({ ...s, plan: { ...s.plan, [k]: [...(s.plan[k] || []).filter(p => p.id !== b.id), block] }, prefs: learn(s, b, +1) }), { silent: true });
  rt.suggestions[k] = (rt.suggestions[k] || []).filter(x => x.id !== b.id);
  if (G.isSignedIn() && S().settings.pushPlan !== false) {
    try {
      const date = fromKey(k);
      const ev = await calendarCreate(S().settings.calendarIds?.[0] || 'primary', { title: b.title, start: atMin(date, b.start), end: atMin(date, b.end), description: b.reason, tag: 'plan' }, { blockId: b.id, dateKey: k });
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
  if (b.eventId) { try { if (!rt.online) throw new Error('network'); await G.deleteEvent(b.calendarId || 'primary', b.eventId); } catch (e) { if (/network|expired/i.test(e.message)) queueOutbox({ type: 'delete', calendarId: b.calendarId || 'primary', eventId: b.eventId }); } }
  store.update(s => ({ ...s, plan: { ...s.plan, [k]: (s.plan[k] || []).filter(p => p.id !== b.id) } }));
  publishPlanSoon();
}
function setBlockStatus(k, b, status) {
  store.update(s => ({ ...s, plan: { ...s.plan, [k]: (s.plan[k] || []).map(p => p.id === b.id ? { ...p, status } : p) } }));
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
};
export function appMeta(name, st = {}) {
  const key = String(st.app || name || '').toLowerCase();
  const m = APP_META[key] || {};
  return { key, title: st.title || m.title || name, icon: st.icon || m.icon || (name[0] || '?').toUpperCase(), color: st.color || m.color || '#9aa0b1', url: st.url || st.extra?.url || m.url || '' };
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
        h('div', { class: 'tiny dim' }, [age(st.updatedAt), asksToday.length ? `asks for ${asksToday.map(a => a.slot === 'before' ? 'time before your shift' : fmtDur(+a.minutes || 0)).join(', ')}` : ''].filter(Boolean).join(' · '))),
      meta.url ? h('a', { class: 'btn sm', href: meta.url, target: '_blank', rel: 'noopener' }, 'Open') : null))));
}

function noteCard(date) {
  const k = keyOf(date);
  const ta = h('textarea', { rows: 2, placeholder: 'Notes for today…', style: { width: '100%', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '9px 12px', resize: 'vertical' },
    onChange: (e) => store.update(s => ({ ...s, notes: { ...s.notes, [k]: e.target.value } }), { silent: true }) }, S().notes[k] || '');
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Notes'), ta);
}

// ---------------- ROTA ----------------
function renderRota() {
  const s = S();
  const m = rt.rotaMonth;
  const y = m.getFullYear(), mo = m.getMonth() + 1;
  const out = [];
  const rotas = Object.values(s.rotas).filter(r => r.year === y && r.month === mo);
  const head = h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('button', { class: 'btn icon', onClick: () => { rt.rotaMonth = new Date(y, mo - 2, 1); render(); } }, '‹'),
    h('h1', { class: 'grow', style: { textAlign: 'center', fontSize: '20px' } }, `${MONTHS[mo - 1]} ${y}`),
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
      mine && shift.kind === 'work' && info.withMe.length ? h('span', { class: 'tiny dim with' }, `+${info.withMe.length}`) : null,
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
      h('button', { class: 'btn sm ghost danger', onClick: () => { if (confirm(`Remove ${UNIT_LABEL[r.unitKind]} ${MONTHS[r.month - 1]}?`)) store.update(x => { const rotas = { ...x.rotas }; delete rotas[r.id]; return { ...x, rotas }; }); } }, 'Remove')))),
    h('div', { class: 'row', style: { marginTop: '10px' } }, importButton('Import / update files'), G.isSignedIn() ? h('button', { class: 'btn', onClick: () => refreshAll(true) }, '☁ Pull from Drive') : null)));
  const gp = rotas.find(r => r.unitKind === 'gp');
  if (gp) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Shift codes'), h('div', { class: 'kv' }, ...gp.legendList.filter(e => e.code).flatMap(e => [h('b', {}, e.code), h('span', {}, [e.desc, e.hoursText].filter(Boolean).join(' · '))]))));
  // desktop: month grid on the left, everything else on the right
  return [head, h('div', { class: 'cols' }, h('div', {}, out[1]), h('div', {}, ...out.slice(2)))];
}
function stat(v, l) { return h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l)); }

function daySheet(date) {
  const s = S();
  const info = dayInfo(s, date);
  const { today, overnightTail } = myDay(s, date);
  const k = keyOf(date);
  const content = [h('div', { class: 'row' }, h('h2', { class: 'grow' }, `${DAY_NAMES[date.getDay()]} ${fmtDate(date)}`), h('span', { class: 'small muted' }, relDay(date)))];
  if (today) content.push(h('div', { class: 'card hero' }, h('div', { class: 'title' }, 'Your shift'), h('div', { class: 'big' }, today.shift.label), h('div', { class: 'sub' }, `${fmtTime(today.window.start)} – ${fmtTime(today.window.end)} · ${fmtDur(today.shift.hours.durationMin)} · ${today.code}`),
    today.mci ? h('div', { style: { marginTop: '6px' } }, mciBadge()) : null,
    info.withMe.length ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'small muted', style: { marginBottom: '4px' } }, 'With you'), h('div', { class: 'people' }, ...info.withMe.map(e => personPill(e)))) : h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Nobody else on your shift'),
    info.alsoAtSite.length ? h('div', { style: { marginTop: '8px' } }, h('div', { class: 'tiny dim', style: { marginBottom: '4px' } }, 'Other shift, same site'), h('div', { class: 'people' }, ...info.alsoAtSite.map(e => personPill(e)))) : null));
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
let teamQuery = '', teamFilter = 'gp';
function renderTeam() {
  const s = S();
  const people = allPeople(s);
  if (!people.length) return h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, '👥'), 'Import a rota to see your team'));
  const q = teamQuery.toLowerCase();
  const list = people.filter(p => (teamFilter === 'all' || p.units.includes(teamFilter)) && (!q || p.name.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q)))
    .map(p => ({ ...p, shared: sharedShifts(s, p.key).length })).sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name));
  const now = new Date();
  const todayInfo = dayInfo(s, now);
  const input = h('input', { placeholder: 'Search name or title', value: teamQuery, style: { flex: 1, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '9px 12px' }, onInput: (e) => { teamQuery = e.target.value; renderList(); } });
  const seg = h('div', { class: 'seg', style: { marginTop: '10px' } }, ...[['gp', 'GPs'], ['fsed', 'FSED'], ['uv', 'Upper V.'], ['all', 'All']].map(([k, l]) => h('button', { class: k === teamFilter ? 'active' : '', onClick: () => { teamFilter = k; render(); } }, l)));
  const listEl = h('div', { class: 'list' });
  function renderList() {
    const q2 = teamQuery.toLowerCase();
    listEl.replaceChildren(...list.filter(p => !q2 || p.name.toLowerCase().includes(q2) || (p.title || '').toLowerCase().includes(q2)).map(p => {
      const todayEntry = todayInfo.entries.find(e => personKeyOf(e.person) === p.key);
      const t = telLink(p.mobile);
      return h('div', { class: 'item clickable', onClick: () => personSheet(p) },
        h('div', { class: 'avatar' }, initials(p.name)),
        h('div', { class: 'grow' }, h('div', { class: 'name row' }, p.name, isMe(s, p) ? h('span', { class: 'chip sel', style: { padding: '1px 7px', fontSize: '10px' } }, 'you') : null),
          h('div', { class: 'meta' }, [p.title, p.shared ? `${p.shared} shifts with you` : ''].filter(Boolean).join(' · '))),
        todayEntry ? shiftChip(todayEntry.shift, todayEntry.code) : null,
        t ? h('a', { class: 'btn sm ghost', href: t.wa, target: '_blank', rel: 'noopener', onClick: e => e.stopPropagation() }, '💬') : null);
    }));
  }
  renderList();
  return [h('h1', {}, 'Team'), h('div', { class: 'row', style: { marginTop: '10px' } }, input), seg, h('div', { class: 'card', style: { marginTop: '12px' } }, listEl)];
}

// ---------------- PLAN ----------------
function regenerate() {
  const s = S();
  const from = rt.planFrom || startOfDay(new Date());
  rt.suggestions = suggest(s, from, 10, rt.events, mergedApps(), appMeta);
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
      .map(p => ({ app: p.app || guessApp(p.title), title: p.title, date: k, start: fmtMin(p.start), end: fmtMin(p.end), minutes: p.end - p.start, status: p.status, goalId: p.goalId }));
    days[k] = { shift, blocks: list };
    blocks.push(...list);
  }
  try { await G.writePlan(s.settings.driveFolder, { app: 'citrus', updatedAt: new Date().toISOString(), from: keyOf(from), days, blocks }); } catch (e) { console.warn('plan.json', e.message); }
}
function guessApp(title) { const t = String(title || '').toLowerCase(); for (const k of Object.keys(APP_META)) if (t.includes(k)) return k; if (/german|deutsch/.test(t)) return 'mephisto'; if (/gym|workout|lift/.test(t)) return 'orange'; if (/ecg|ekg/.test(t)) return 'sinus'; if (/card|review|anki/.test(t)) return 'yuzu'; return ''; }

function renderPlan() {
  const s = S();
  const from = rt.planFrom || startOfDay(new Date());
  if (!Object.keys(rt.suggestions).length) regenerate();
  const out = [h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Plan'), h('button', { class: 'btn sm', onClick: () => { rt.planFrom = startOfDay(new Date()); regenerate(); render(); } }, '↻ Regenerate'))];
  // goals progress this week
  const ws = weekStartOf(new Date());
  const prog = weekProgress(s, ws);
  out.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `This week · ${fmtDateShort(ws)} – ${fmtDateShort(addDays(ws, 6))}`), h('button', { class: 'btn sm ghost', onClick: goalsSheet }, 'Edit goals')),
    ...s.goals.map(g => { const have = prog[g.id] || 0, target = g.hoursPerWeek * 60; return h('div', { style: { margin: '8px 0' } }, h('div', { class: 'row small' }, h('span', { class: 'grow', style: { fontWeight: 600 } }, g.name), h('span', { class: 'muted' }, `${fmtDur(have)} / ${fmtDur(target)}`)), h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, Math.round(have / target * 100))}%`, '--c': g.color } }))); }),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: rulesSheet }, 'Rules'), h('button', { class: 'btn sm', onClick: acceptAllVisible }, 'Accept all suggestions'))));
  const rv = reviewCard(); if (rv) out.push(rv);
  // days
  for (let i = 0; i < 10; i++) {
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
async function acceptAllVisible() {
  const all = Object.entries(rt.suggestions).flatMap(([k, list]) => list.map(b => [k, b]));
  if (!all.length) return toast('No suggestions to accept');
  for (const [k, b] of all) await acceptBlock(k, b, { silent: true });
  toast(`Planned ${all.length} blocks`, 'ok'); render();
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
function renderApps() {
  const apps = mergedApps();
  const known = Object.keys(APP_META);
  const names = [...new Set([...Object.keys(apps), ...known])];
  const today = keyOf(new Date());
  const tiles = names.map(name => {
    const st = apps[name] || apps[name.toLowerCase()] || {};
    const meta = appMeta(name, st);
    const ageMin = st.updatedAt ? Math.round((Date.now() - new Date(st.updatedAt)) / 60000) : null;
    const stale = ageMin == null || ageMin > 36 * 60;
    const asksToday = (st.asks || []).filter(x => x.date === today);
    const badge = asksToday.length ? Math.round(asksToday.reduce((x, y) => x + (+y.minutes || 0), 0)) : st.due || 0;
    const open = meta.url ? `${meta.url}${meta.url.includes('?') ? '&' : '?'}from=citrus` : '';
    return h(open ? 'a' : 'div', { class: `app-tile ${stale ? 'stale' : ''}`, href: open || null, target: open ? '_blank' : null, rel: 'noopener', style: { '--c': meta.color, '--c-soft': meta.color + '33' } },
      badge ? h('span', { class: 'badge' }, badge > 999 ? '999+' : badge) : null,
      h('div', { class: 'ic' }, meta.icon), h('div', { class: 'nm' }, meta.title),
      h('div', { class: 'sm' }, st.summary || st.next?.title || (stale ? 'Not reporting yet — open it and sign in with Google.' : '')),
      h('div', { class: 'st' }, ageMin == null ? 'no status' : st.today?.done ? 'done today' : ageMin < 60 ? `updated ${ageMin} min ago` : ageMin < 48 * 60 ? `updated ${Math.round(ageMin / 60)} h ago` : `updated ${Math.round(ageMin / 1440)} d ago`));
  });
  const pending = Object.entries(apps).flatMap(([n, st]) => (st.pending || []).slice(0, 3).map(p => ({ app: appMeta(n, st), text: p })));
  return [h('h1', {}, 'Apps'), h('p', { class: 'muted small', style: { margin: '6px 0 14px' } }, 'Everything reports into Drive › My Apps › hub. Tap a tile to open the app; badges are minutes asked for today or items due.'),
    h('div', { class: 'apps-grid' }, ...tiles),
    pending.length ? h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'title' }, 'Waiting on you'), h('div', { class: 'list' }, ...pending.map(p => h('div', { class: 'item' }, h('div', { class: 'avatar', style: { background: p.app.color + '33', color: p.app.color, fontSize: '18px' } }, p.app.icon), h('div', { class: 'grow' }, h('div', { class: 'name' }, p.text), h('div', { class: 'meta' }, p.app.title)))))) : null,
    h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'title' }, 'How the apps talk to Citrus'),
      h('div', { class: 'small muted' }, 'Each app writes hub/<app>/status.json (summary, what it needs today as “asks”, pending items). Citrus places the asks in your plan around shifts and writes hub/citrus/plan.json back, which the apps read to show when their block is. Statuses older than 36 h are shown greyed.')),
  ];
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
      signed ? h('button', { class: 'btn', onClick: () => { G.signOut(); render(); } }, 'Sign out') : h('button', { class: 'btn primary', onClick: async () => { try { if (!G.isSignedIn()) { store.update(x => ({ ...x, settings: { ...x.settings, clientId: cid.value.trim() } }), { remote: false }); await G.init(cid.value.trim()); } await G.signIn(); toast('Signed in', 'ok'); refreshAll(true); } catch (e) { toast(e.message, 'err'); } } }, 'Sign in with Google'),
      signed ? h('button', { class: 'btn', onClick: () => refreshAll(true) }, '↻ Sync now') : null),
    signed ? h('div', { class: 'small muted', style: { marginTop: '8px' } }, `${s.google.email || 'signed in'}${s.google.lastSync ? ` · last sync ${new Date(s.google.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`) : null));
  if (signed) {
    const cals = rt.calendars;
    out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Calendars to show'),
      cals.length ? h('div', {}, ...cals.map(c => toggleRow(`${c.name}${c.primary ? ' (primary)' : ''}`, s.settings.calendarIds.includes(c.id), (on) => store.update(x => ({ ...x, settings: { ...x.settings, calendarIds: on ? [...new Set([...x.settings.calendarIds, c.id])] : x.settings.calendarIds.filter(i => i !== c.id) } }), { silent: true })))) : h('div', { class: 'muted small' }, 'Sync to load calendars'),
      h('div', { class: 'divider' }),
      toggleRow('Mirror my shifts into a "Citrus Maxima Shifts" calendar', !!s.settings.pushShifts, (on) => { store.update(x => ({ ...x, settings: { ...x.settings, pushShifts: on } })); if (on) refreshAll(true); }),
      toggleRow('Add accepted plan blocks to my calendar', s.settings.pushPlan !== false, (on) => store.update(x => ({ ...x, settings: { ...x.settings, pushPlan: on } }))),
      h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', {}, 'Drive folder'), h('input', { value: s.settings.driveFolder, onChange: (e) => store.update(x => ({ ...x, settings: { ...x.settings, driveFolder: e.target.value.trim() || 'My Apps' } })) }), h('div', { class: 'tiny dim' }, 'Rotas go in <folder>/Rotas; every app keeps its files in <folder>/hub/<app>/.'))));
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
  out.push(diagnosticsCard());
  // Appearance + backup
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'App'),
    toggleRow('Light theme', s.settings.theme === 'light', (on) => { store.update(x => ({ ...x, settings: { ...x.settings, theme: on ? 'light' : 'dark' } }), { silent: true }); applyTheme(); }),
    h('div', { class: 'row wrap', style: { marginTop: '10px' } },
      h('button', { class: 'btn', onClick: () => { const blob = new Blob([store.exportJSON()], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `citrus-maxima-backup-${keyOf(new Date())}.json` }); a.click(); } }, '⬇ Backup'),
      (() => { const inp = h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onChange: async (e) => { try { const j = JSON.parse(await e.target.files[0].text()); store.replaceState(j); toast('Restored', 'ok'); } catch (err) { toast('Bad backup file', 'err'); } } }); return h('span', {}, inp, h('button', { class: 'btn', onClick: () => inp.click() }, '⬆ Restore')); })(),
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
    for (const [name, st] of Object.entries(mergedApps())) { const m = appMeta(name, st); if (m.title.toLowerCase().includes(q)) items.push({ label: `${m.icon} ${m.title}`, meta: st.summary || 'open', run: () => { if (m.url) window.open(m.url, '_blank'); } }); }
    for (const g of s.goals) if (g.name.toLowerCase().includes(q)) items.push({ label: g.name, meta: `${g.hoursPerWeek} h/week`, run: () => { show('plan'); goalsSheet(); } });
    for (const [k, t] of Object.entries(s.notes || {})) if (t && t.toLowerCase().includes(q)) items.push({ label: t.slice(0, 60), meta: `note · ${fmtDate(fromKey(k))}`, run: () => { rt.rotaSel = fromKey(k); show('rota'); daySheet(fromKey(k)); } });
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
      cur ? h('button', { class: 'btn danger', onClick: () => { store.update(x => { const swaps = { ...(x.swaps || {}) }; delete swaps[k]; return { ...x, swaps }; }); regenerate(); close(); render(); } }, 'Remove') : null)]);
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
function diagnosticsCard() {
  const s = S();
  const rows = [
    ['Google', G.isSignedIn() ? `signed in as ${G.accountEmail() || s.google.email || '?'}` : G.wasSignedIn() ? 'session expired — tap Sign in' : 'not signed in'],
    ['Last sync', s.google.lastSync ? new Date(s.google.lastSync).toLocaleString('en-GB') : 'never'],
    ['Sync issues', (rt.lastProblems || []).length ? rt.lastProblems.join(' · ') : 'none'],
    ['Queued calendar writes', String((s.outbox || []).length)],
    ['Rotas loaded', Object.keys(s.rotas).length ? Object.values(s.rotas).map(r => `${UNIT_LABEL[r.unitKind]} ${MONTHS[r.month - 1].slice(0, 3)}`).join(', ') : 'none'],
    ['Apps reporting', Object.keys(mergedApps()).join(', ') || 'none'],
    ['Online', rt.online ? 'yes' : 'no'],
    ['Installed', window.matchMedia('(display-mode: standalone)').matches ? 'yes (home screen)' : 'browser tab'],
  ];
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Diagnostics'), h('div', { class: 'kv' }, ...rows.flatMap(([a, b]) => [h('b', {}, a), h('span', {}, b)])),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: () => refreshAll(true) }, 'Sync now'), h('button', { class: 'btn sm', onClick: async () => { const regs = await navigator.serviceWorker?.getRegistrations?.() || []; for (const r of regs) await r.unregister(); const ks = await caches.keys(); for (const k of ks) await caches.delete(k); location.reload(); } }, 'Reinstall app files')));
}

boot();
