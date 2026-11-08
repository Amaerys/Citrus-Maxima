// Single source of truth. Persists to localStorage immediately and to Google Drive (My Apps/hub/citrus/state.json) when signed in.
import { uid } from './util.js';

const KEY = 'citrus.state.v1';

export const DEFAULT_RULES = {
  sleepStart: 23 * 60 + 30,   // default lights-out on free days
  sleepHours: 7.5,
  wakeMin: 7 * 60,
  postNightRecoveryUntil: 15 * 60, // after a night shift, nothing heavy before this time
  preShiftBufferMin: 60,       // minutes before shift start kept free (getting ready)
  postShiftBufferMin: 45,      // minutes after shift end kept free (wind down)
  commute: { 'Upper Village': 25, 'Lower Village': 25, 'Upper office clinic 242': 30, 'Lower office clinic 242': 30, FSED: 25, default: 30 },
  maxStudyOnWorkday: 120,      // minutes
  maxStudyOnFreeDay: 300,
  protectedBlocks: [],         // {id, label, days:[0-6], start, end}
  earliestPlan: 8 * 60,
  latestPlan: 23 * 60,
};

export const DEFAULT_GOALS = [
  { id: 'g-usmle', name: 'USMLE Step 1', kind: 'study', hoursPerWeek: 8, minBlock: 60, maxBlock: 180, priority: 1, color: '#ff7a1a', deadline: '' },
  { id: 'g-german', name: 'German (Mephisto)', kind: 'study', hoursPerWeek: 5, minBlock: 30, maxBlock: 90, priority: 2, color: '#f2c14e' },
  { id: 'g-yuzu', name: 'Yuzu reviews', kind: 'habit', hoursPerWeek: 3.5, minBlock: 20, maxBlock: 40, priority: 3, color: '#9ad36a', daily: true },
  { id: 'g-gym', name: 'Gym', kind: 'fitness', hoursPerWeek: 4, minBlock: 60, maxBlock: 90, priority: 4, color: '#4fb3ff' },
  { id: 'g-social', name: 'Friends / family', kind: 'social', hoursPerWeek: 4, minBlock: 90, maxBlock: 240, priority: 5, color: '#d58cff' },
];

function defaults() {
  return {
    version: 1,
    updatedAt: 0,
    me: null,                 // {name, id}
    rotas: {},                // id -> rota
    goals: DEFAULT_GOALS,
    rules: DEFAULT_RULES,
    plan: {},                 // dateKey -> [{id, goalId, start, end, status, reason, eventId}]
    prefs: {},                // learned: `${goalId}|${slotTag}` -> score
    notes: {},                // dateKey -> text
    swaps: {},                // dateKey -> {code, with, note, at}  (overrides the imported rota)
    outbox: [],               // calendar writes waiting for the network (never synced between devices)
    deleted: {},              // tombstones 'swap:<date>' | 'plan:<id>' | 'rota:<id>' | 'note:<date>' -> time, so deletions survive merges
    settings: { clientId: '753489712404-ra7ahu34gjl305b4ss1765idmqg7am5s.apps.googleusercontent.com', calendarIds: ['primary'], shiftCalendarId: '', pushShifts: false, driveFolder: 'My Apps', theme: 'dark' },
    google: { email: '', lastSync: 0 },
    apps: {},                 // other apps' status files from Drive: name -> json
    // ---- Mind (see mind.js): every collection is a map id -> record with an `at` edit time, so devices merge key by key
    tasks: {},                // id -> {title, done, due, est, pri, aimId, area, notes}
    aims: {},                 // id -> objective {title, why, area, deadline, milestones[], status}
    habits: {},               // id -> {name, emoji, freq, aimId, area, link, minutes, archived}
    habitLog: {},             // habitId -> dateKey -> {v: 1|0, at}   (per-day cell, latest tap wins)
    reflections: {},          // 'method:date' -> {method, date, mood, energy, answers, scores}
    resolutions: {},          // id -> {year, title, area, why, target, progress, aimId, checkins{q1..q4}}
    yearMeta: {},             // year -> {theme, at}
    // ---- received from other apps (see inbound.js)
    metricLog: {},            // 'app:key' -> dateKey -> {v, goal, label, unit, kind, at}   numbers and progress the apps report
    // ---- Library, notes, reminders
    media: {},                // id -> {kind, title, status, rating 0-10, progress, total, creator, genres, src, extId, finishedAt, minutes}
    mediaMeta: {},            // {goals:{book:24}, anilist:'name', dismissed:[…], at}
    memos: {},                // id -> {title, body, tags[], pinned}
    friends: {},              // id -> {name, kind, phone, whatsapp, snap, insta, rotaKey, sched, weeklyOff, every, birthday…}   (stays in your own state and Drive; never published to the hub)
    outings: {},              // id -> {date, who[], what, where, rating, planned}
    posts: {},                // 'YYYY-MM-DD:personKey' -> {site}   which site a floating nurse was posted to that day
    contacts: {},             // personKey -> {phone, whatsapp, snap, insta, note}   handles for people from the rotas
    chores: {},               // id -> {title, icon, every, mins, lastDone, next:{date,start}}   room cleaning, laundry…
    reminders: {},            // 'task:id' | 'habit:id' -> {eventId, sig, at}   calendar alarms Citrus created
    inboxLog: {},             // 'app:id' -> {status: accepted|dismissed, at, taskId}      what you decided about their proposals
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return defaults();
    for (const k of ['rotas', 'plan', 'prefs', 'notes', 'swaps', 'deleted', 'apps', 'tasks', 'aims', 'habits', 'habitLog', 'reflections', 'resolutions', 'yearMeta', 'metricLog', 'inboxLog', 'media', 'mediaMeta', 'memos', 'reminders', 'friends', 'outings', 'chores', 'posts', 'contacts']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) delete s[k];
    for (const [id, r] of Object.entries(s.rotas || {})) if (!r || !Array.isArray(r.people) || !r.legend) delete s.rotas[id];
    for (const [k, list] of Object.entries(s.plan || {})) if (!Array.isArray(list)) delete s.plan[k];
    if (!Array.isArray(s.goals)) delete s.goals; if (!Array.isArray(s.outbox)) delete s.outbox;
    const st = { ...defaults(), ...s, rules: { ...DEFAULT_RULES, ...(s.rules || {}) }, settings: { ...defaults().settings, ...(s.settings || {}) } };
    if (st.settings.driveFolder === 'Citrus Maxima') st.settings.driveFolder = 'My Apps'; // layout shared with Orange & Mephisto
    if (!st.settings.clientId) st.settings.clientId = defaults().settings.clientId;
    return st;
  } catch { return defaults(); }
}

// Save to this device. When the browser's storage is full, drop what can be fetched again (the calendar cache) and retry.
export const persistence = { ok: true, lastError: '', bytes: 0 };
function persist() {
  const raw = JSON.stringify(state);
  persistence.bytes = raw.length * 2;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { localStorage.setItem(KEY, raw); persistence.ok = true; persistence.lastError = ''; return true; }
    catch (e) {
      persistence.ok = false; persistence.lastError = e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '') ? 'This device\'s storage is full' : (e?.message || 'save failed');
      if (attempt === 0) { try { localStorage.removeItem('citrus.events'); } catch {} } else console.warn('persist failed', e);
    }
  }
  return false;
}

export function get() { return state; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let syncHook = null;
export function onRemoteSync(fn) { syncHook = fn; }

export function update(mutator, { silent = false, remote = true } = {}) {
  const next = typeof mutator === 'function' ? (mutator(state) || state) : { ...state, ...mutator };
  if (remote) next.updatedAt = Date.now();   // local-only bookkeeping (sync time, app cache, outbox) must not make this copy look newer
  state = next;
  persist();
  if (!silent) for (const fn of listeners) fn(state);
  if (remote && syncHook) syncHook(state);
  return state;
}

export function replaceState(s, { bump = false } = {}) {
  state = { ...defaults(), ...s, rules: { ...DEFAULT_RULES, ...(s.rules || {}) }, settings: { ...defaults().settings, ...(s.settings || {}) } };
  if (bump) { state.updatedAt = Date.now(); if (syncHook) syncHook(state); }
  persist();
  for (const fn of listeners) fn(state);
}

export function exportJSON() { return JSON.stringify(state, null, 2); }

export function newId(prefix = '') { return prefix + uid(); }

// Mark something deleted so a merge with an older copy does not bring it back
export function tombstone(s, key) { return { ...(s.deleted || {}), [key]: Date.now() }; }

// Merge this device's state (local) with Drive's (remote). Collections merge key-by-key, newest edit wins,
// tombstones remove items deleted on either side; scalars follow the newer copy; the outbox never leaves this device.
export function mergeStates(local, remote) {
  if (!remote) return local; if (!local) return remote;
  const [older, newer] = local.updatedAt > remote.updatedAt ? [remote, local] : [local, remote];
  const out = { ...older, ...newer };
  const deleted = { ...(older.deleted || {}) };
  for (const [k, t] of Object.entries(newer.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, t);
  const alive = (key, at) => !(deleted[key] && deleted[key] >= (at || 0));
  // rotas: keep the most recently imported copy of each
  out.rotas = {};
  for (const src of [older.rotas || {}, newer.rotas || {}]) for (const [id, r] of Object.entries(src)) {
    const cur = out.rotas[id]; const at = Date.parse(r.importedAt || 0) || 0;
    if (alive(`rota:${id}`, at) && (!cur || (r.importedAt || '') >= (cur.importedAt || ''))) out.rotas[id] = r;
  }
  // plan blocks: by id, newest `at` wins
  out.plan = {};
  for (const src of [older.plan || {}, newer.plan || {}]) for (const [k, list] of Object.entries(src)) {
    const byId = new Map((out.plan[k] || []).map(p => [p.id, p]));
    for (const p of list || []) { const cur = byId.get(p.id); if (!cur || (p.at || 0) >= (cur.at || 0)) byId.set(p.id, p); }
    out.plan[k] = [...byId.values()].filter(p => alive(`plan:${p.id}`, p.at));
  }
  const mergeMap = (prefix, a = {}, b = {}, atOf = () => 0) => {
    const m = {};
    for (const src of [a, b]) for (const [k, v] of Object.entries(src)) { const cur = m[k]; if (!cur || atOf(v) >= atOf(cur)) m[k] = v; }
    for (const k of Object.keys(m)) if (!alive(`${prefix}:${k}`, atOf(m[k]))) delete m[k];
    return m;
  };
  out.swaps = mergeMap('swap', older.swaps, newer.swaps, v => v?.at || 0);
  out.notes = mergeMap('note', older.notes, newer.notes, () => 0);
  out.prefs = { ...(older.prefs || {}), ...(newer.prefs || {}) };
  // Mind: same rule everywhere — newest edit wins per record, tombstones remove deleted ones
  const at = v => v?.at || 0;
  out.tasks = mergeMap('task', older.tasks, newer.tasks, at);
  out.aims = mergeMap('aim', older.aims, newer.aims, at);
  out.habits = mergeMap('habit', older.habits, newer.habits, at);
  out.reflections = mergeMap('refl', older.reflections, newer.reflections, at);
  out.resolutions = mergeMap('res', older.resolutions, newer.resolutions, at);
  out.yearMeta = mergeMap('year', older.yearMeta, newer.yearMeta, at);
  out.inboxLog = mergeMap('inbox', older.inboxLog, newer.inboxLog, at);
  out.media = mergeMap('media', older.media, newer.media, at);
  out.memos = mergeMap('memo', older.memos, newer.memos, at);
  out.mediaMeta = (newer.mediaMeta?.at || 0) >= (older.mediaMeta?.at || 0) ? { ...(older.mediaMeta || {}), ...(newer.mediaMeta || {}) } : { ...(newer.mediaMeta || {}), ...(older.mediaMeta || {}) };
  out.friends = mergeMap('friend', older.friends, newer.friends, at);
  out.outings = mergeMap('outing', older.outings, newer.outings, at);
  out.chores = mergeMap('chore', older.chores, newer.chores, at);
  out.posts = mergeMap('post', older.posts, newer.posts, at);
  out.contacts = mergeMap('contact', older.contacts, newer.contacts, at);
  out.reminders = mergeMap('rem', older.reminders, newer.reminders, at);
  out.metricLog = {};
  for (const src of [older.metricLog || {}, newer.metricLog || {}]) for (const [sk, cells] of Object.entries(src)) {
    const m = (out.metricLog[sk] ||= {});
    for (const [d, c] of Object.entries(cells || {})) if (!m[d] || (c?.at || 0) >= (m[d].at || 0)) m[d] = c;
  }
  out.habitLog = {};   // one cell per habit and day, the latest tap wins; logs of deleted habits go with them
  for (const src of [older.habitLog || {}, newer.habitLog || {}]) for (const [hid, cells] of Object.entries(src)) {
    const m = (out.habitLog[hid] ||= {});
    for (const [d, c] of Object.entries(cells || {})) if (!m[d] || (c?.at || 0) >= (m[d].at || 0)) m[d] = c;
  }
  for (const hid of Object.keys(out.habitLog)) if (!out.habits[hid]) delete out.habitLog[hid];
  out.deleted = Object.fromEntries(Object.entries(deleted).filter(([, t]) => Date.now() - t < 90 * 86400000)); // forget tombstones after 90 days
  out.settings = { ...(older.settings || {}), ...(newer.settings || {}), clientId: newer.settings?.clientId || older.settings?.clientId || '' };
  out.outbox = local.outbox || [];
  out.google = local.google || {};
  out.apps = local.apps;
  return out;
}
