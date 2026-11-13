// Single source of truth. Persists to localStorage immediately and to Google Drive (My Apps/hub/citrus/state.json) when signed in.
// Three promises: a malformed record never reaches the views (sanitize on load, restore and merge), a merge of two devices
// never drops an edit (every collection merges per record or per field, by edit time), and a damaged localStorage copy is
// kept and recovered instead of silently replaced.
import { uid } from './util.js';

const KEY = 'citrus.state.v1';
const BAK = 'citrus.state.v1.bak';          // this device's last copy that loaded cleanly (written once per app start)
const CORRUPT = 'citrus.state.corrupt.';    // + ISO time: a copy that could not be read, kept for download
const TOMBSTONE_DAYS = 400;                 // a device can be offline this long and still not bring deleted things back

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

const DEFAULT_SETTINGS = { clientId: '753489712404-ra7ahu34gjl305b4ss1765idmqg7am5s.apps.googleusercontent.com', calendarIds: ['primary'], shiftCalendarId: '', pushShifts: false, driveFolder: 'My Apps', theme: 'dark' };

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
    notes: {},                // dateKey -> text  (edit times live in `stamps`, so the stored format stays plain text)
    swaps: {},                // dateKey -> {code, with, note, at}  (overrides the imported rota)
    outbox: [],               // calendar writes waiting for the network (never synced between devices)
    deleted: {},              // tombstones 'swap:<date>' | 'plan:<id>' | 'rota:<id>' | 'note:<date>' | 'goal:<id>' … -> time, so deletions survive merges
    stamps: {},               // edit times of values that have no `at` of their own: 'me', 'goal:<id>', 'rule:<k>', 'set:<k>', 'note:<date>'
    settings: { ...DEFAULT_SETTINGS },
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
    rotaChanges: {},          // id -> brief of what changed when a schedule was uploaded again (last 30)
    dayLog: {},               // dateKey -> {score 1-5, note}   how each day felt
    study: {},                // id -> study subject {name, perWeek minutes, block minutes, app}
    studyLog: {},             // 'dateKey:subjectId' -> {mins}
    polls: {},                // id -> time poll sent to friends (slots + who said yes)
    wishlist: {},             // id -> place / trip / activity to try
    treats: {},               // id -> something brought for the team (food, gift)
    jobs: {},                 // id -> employment record (contract terms, pay, dates). Stays in your own state and Drive; never published to the hub.
    offers: {},               // id -> job offer being weighed against the current job
    contacts: {},             // personKey -> {phone, whatsapp, snap, insta, note}   handles for people from the rotas
    chores: {},               // id -> {title, icon, every, mins, lastDone, next:{date,start}}   room cleaning, laundry…
    reminders: {},            // 'task:id' | 'habit:id' -> {eventId, sig, at}   calendar alarms Citrus created
    inboxLog: {},             // 'app:id' -> {status: accepted|dismissed, at, taskId}      what you decided about their proposals
  };
}

// ════════════════════════════════════════ shapes
// Map collections whose values are records (objects): collection -> tombstone prefix. The merge and the sanitizer both read this table,
// so a collection added here is cleaned on load and merged record by record.
export const RECORD_MAPS = {
  swaps: 'swap', tasks: 'task', aims: 'aim', habits: 'habit', reflections: 'refl', resolutions: 'res', yearMeta: 'year', inboxLog: 'inbox',
  media: 'media', memos: 'memo', friends: 'friend', outings: 'outing', chores: 'chore', posts: 'post', contacts: 'contact', rotaChanges: 'rchg',
  dayLog: 'daylog', study: 'study', studyLog: 'slog', polls: 'poll', wishlist: 'wish', treats: 'treat', jobs: 'job', offers: 'offer', reminders: 'rem',
};
// Fields the views use without checking (`.toLowerCase()`, `.filter()`): repaired to the right type rather than dropping the record.
const FIELDS = {
  tasks: { title: 's' }, aims: { title: 's', milestones: 'a' }, habits: { name: 's' }, chores: { title: 's' }, friends: { name: 's' }, outings: { who: 'a' },
  memos: { title: 's', tags: 'a' }, media: { title: 's', genres: 'a' }, rotaChanges: { mine: 'a', others: 'a', added: 'a', removed: 'a', withMe: 'a' },
};
const CELL_MAPS = ['habitLog', 'metricLog'];     // id -> dateKey -> cell record
const NUM_MAPS = ['prefs', 'deleted', 'stamps']; // key -> number
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, d = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);

/** A clean copy of a state: every collection has the right container type, records that are not objects are dropped, and the
 *  few fields the views read without checking (rota people and days, plan ids, goal numbers, rule numbers) are repaired.
 *  Unknown top-level keys are kept as they are. `report.fixed` counts records dropped, `report.repaired` fields quietly put back in shape. Never throws. */
export function sanitize(input, report = { fixed: 0, notes: [] }) {
  const s = isObj(input) ? { ...input } : {};
  // `fixed`: records dropped (worth telling the user); `repaired`: fields put back in shape, quietly (old or odd but not lost)
  const fix = (what, dropped = true) => { if (dropped) report.fixed++; else report.repaired = (report.repaired || 0) + 1; if (report.notes.length < 20) report.notes.push(what); };
  const mapOf = (k, keep) => {
    if (s[k] === undefined) return;
    if (!isObj(s[k])) { fix(`${k}: not a collection`); delete s[k]; return; }
    const out = {}; let changed = false;
    for (const [id, v] of Object.entries(s[k])) { const r = keep(v, id); if (r === undefined) fix(`${k}.${id}`); else out[id] = r; if (r !== v) changed = true; }
    if (changed) s[k] = out;   // untouched collections keep their identity (cheap, and callers can compare by reference)
  };
  for (const k of Object.keys(RECORD_MAPS)) mapOf(k, (v, id) => {
    if (!isObj(v)) return undefined;
    if (k === 'rotaChanges' && !(Number.isInteger(v.month) && v.month >= 1 && v.month <= 12)) return undefined; // the briefs index MONTHS[month - 1]
    let r = v;
    for (const [f, t] of Object.entries(FIELDS[k] || {})) if (t === 's' ? typeof r[f] !== 'string' : !Array.isArray(r[f])) { if (r === v) { r = { ...v }; fix(`${k}.${id}.${f}`, false); } r[f] = t === 's' ? str(r[f]) : []; }
    return r;
  });
  for (const k of CELL_MAPS) mapOf(k, (cells, id) => { if (!isObj(cells)) return undefined; if (Object.values(cells).every(isObj)) return cells; const o = {}; for (const [d, c] of Object.entries(cells)) if (isObj(c)) o[d] = c; else fix(`${k}.${id}.${d}`); return o; });
  for (const k of NUM_MAPS) mapOf(k, (v) => (Number.isFinite(+v) && v !== null && v !== '' && typeof v !== 'object' ? +v : undefined));
  mapOf('notes', (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : isObj(v) && typeof v.text === 'string' ? v.text : undefined));
  mapOf('apps', (v) => (isObj(v) ? v : undefined));
  mapOf('rotas', (r) => {
    if (!isObj(r) || !Array.isArray(r.people) || !isObj(r.legend)) return undefined;
    if (!r.people.every(isObj)) fix(`rotas.${r.id} people`);
    const okDays = (d) => Array.isArray(d) || isObj(d);   // the parser stores days as an object keyed by day number; older data may be an array
    const people = r.people.filter(p => isObj(p)).map(p => (okDays(p.days) && typeof p.name === 'string' ? p : { ...p, name: str(p.name), days: okDays(p.days) ? p.days : {} }));
    return people.length === r.people.length && people.every((p, i) => p === r.people[i]) ? r : { ...r, people };
  });
  mapOf('plan', (list) => {
    if (!Array.isArray(list)) return undefined;
    if (!list.every(isObj)) fix('plan blocks');
    const ok = list.filter(isObj).map(p => (p.id ? p : { ...p, id: 'p' + uid() }));
    return ok.length === list.length && ok.every((p, i) => p === list[i]) ? list : ok;
  });
  if (s.mediaMeta !== undefined) {
    if (!isObj(s.mediaMeta)) { fix('mediaMeta'); delete s.mediaMeta; }
    else if (s.mediaMeta.dismissed !== undefined && !Array.isArray(s.mediaMeta.dismissed)) { fix('mediaMeta.dismissed'); s.mediaMeta = { ...s.mediaMeta, dismissed: [] }; }
  }
  if (s.me !== undefined && s.me !== null && !(isObj(s.me) && (typeof s.me.id === 'string' || typeof s.me.name === 'string'))) { fix('me'); s.me = null; }
  else if (isObj(s.me) && (typeof s.me.id !== 'string' || typeof s.me.name !== 'string')) s.me = { ...s.me, id: str(s.me.id), name: str(s.me.name) };
  if (s.goals !== undefined) {
    if (!Array.isArray(s.goals)) { fix('goals'); delete s.goals; }
    else {
      const seen = new Set(), goals = [];
      for (const g of s.goals) {
        if (!isObj(g)) { fix('goals[]'); continue; }
        let id = typeof g.id === 'string' && g.id ? g.id : 'g-' + (str(g.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid());
        if (seen.has(id)) { fix(`goals ${id} twice`); continue; } seen.add(id);
        const clean = { ...g, id, name: str(g.name, 'Goal'), hoursPerWeek: Math.max(0, num(+g.hoursPerWeek, 0)), minBlock: Math.max(5, num(+g.minBlock, 30)), maxBlock: Math.max(5, num(+g.maxBlock, 90)), priority: num(+g.priority, goals.length + 1), color: str(g.color, '#ff7a1a') };
        const same = Object.keys(clean).every(k => clean[k] === g[k]);
        goals.push(same ? g : clean); if (!same) fix(`goal ${id}`, false);
      }
      if (goals.length !== s.goals.length || goals.some((g, i) => g !== s.goals[i])) s.goals = goals;
    }
  }
  if (s.rules !== undefined) {
    if (!isObj(s.rules)) { fix('rules'); delete s.rules; }
    else {
      const r = { ...s.rules };
      for (const [k, d] of Object.entries(DEFAULT_RULES)) {
        if (r[k] === undefined) continue;
        if (typeof d === 'number' && !Number.isFinite(r[k])) { fix(`rules.${k}`, false); r[k] = Number.isFinite(+r[k]) && r[k] !== null && r[k] !== '' ? +r[k] : d; }
        else if (k === 'commute' && !isObj(r[k])) { fix('rules.commute', false); r[k] = d; }
        else if (k === 'protectedBlocks') { if (!Array.isArray(r[k])) { fix('rules.protectedBlocks'); r[k] = []; } else if (!r[k].every(isObj)) { fix('rules.protectedBlocks[]'); r[k] = r[k].filter(isObj); } }
      }
      s.rules = r;
    }
  }
  if (s.settings !== undefined) {
    if (!isObj(s.settings)) { fix('settings'); delete s.settings; }
    else if (s.settings.calendarIds !== undefined && !(Array.isArray(s.settings.calendarIds) && s.settings.calendarIds.every(x => typeof x === 'string'))) {
      fix('settings.calendarIds', false); const ids = Array.isArray(s.settings.calendarIds) ? s.settings.calendarIds.filter(x => typeof x === 'string' && x) : [];
      s.settings = { ...s.settings, calendarIds: ids.length ? ids : ['primary'] };
    }
  }
  if (s.outbox !== undefined) { if (!Array.isArray(s.outbox)) { fix('outbox'); delete s.outbox; } else if (!s.outbox.every(isObj)) { fix('outbox[]'); s.outbox = s.outbox.filter(isObj); } }
  if (s.google !== undefined && !isObj(s.google)) { fix('google'); delete s.google; }
  if (s.updatedAt !== undefined && !Number.isFinite(s.updatedAt)) { s.updatedAt = Number.isFinite(+s.updatedAt) ? +s.updatedAt : 0; }
  return s;
}

// Fill in the defaults around a clean state (nested rules and settings too).
function complete(s) {
  const d = defaults();
  const st = { ...d, ...s, rules: { ...DEFAULT_RULES, ...(s.rules || {}) }, settings: { ...d.settings, ...(s.settings || {}) } };
  if (st.settings.driveFolder === 'Citrus Maxima') st.settings.driveFolder = 'My Apps'; // layout shared with Orange & Mephisto
  if (!st.settings.clientId) st.settings.clientId = d.settings.clientId;
  return st;
}

// ════════════════════════════════════════ this device
/** What happened at start-up when the saved copy could not be read: null when all was well.
 *  {at, reason, kept: localStorage key of the damaged copy (or ''), from: ['backup' | 'readable part'], fixed: records repaired} */
export let recovery = null;
let lsOk = true;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { lsOk = false; return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };

let state;                                  // loaded at the end of this module, once every helper below exists
const listeners = new Set();

function parseState(raw) { try { const s = JSON.parse(raw); return isObj(s) ? s : null; } catch { return null; } }

function load() {
  const raw = lsGet(KEY);
  if (!raw) return complete({});
  const report = { fixed: 0, notes: [] };
  const parsed = parseState(raw);
  if (parsed) {
    const s = complete(sanitize(parsed, report));
    if (report.fixed) { recovery = { at: Date.now(), reason: 'repaired', kept: keepCorrupt(raw), from: [], fixed: report.fixed, notes: report.notes }; }
    else if (raw.length < 1.5e6) lsSet(BAK, raw);   // a known-good copy for the day this one gets damaged (skipped for huge states: quota)
    return s;
  }
  // unreadable: keep it, then rebuild from what can still be read — the last clean copy and the readable part of this one, merged
  const kept = keepCorrupt(raw);
  const bak = parseState(lsGet(BAK) || '');
  const part = salvageJSON(raw);
  const from = [];
  let s = null;
  if (bak) { s = sanitize(bak, report); from.push('backup'); }
  if (part) { const p = sanitize(part, report); s = s ? mergeStates(complete(s), complete(p)) : p; from.push('readable part'); }
  recovery = { at: Date.now(), reason: 'unreadable', kept, from, fixed: report.fixed, notes: report.notes };
  return complete(s || {});
}

// Keep the damaged text under its own key (the newest two), so the next save cannot overwrite what might be recovered.
function keepCorrupt(raw) {
  const key = CORRUPT + new Date().toISOString();
  let old = [];
  try { old = Object.keys(localStorage).filter(k => k.startsWith(CORRUPT)).sort(); } catch {}
  for (const k of old.slice(0, Math.max(0, old.length - 1))) lsDel(k);
  if (lsSet(key, raw)) return key;
  lsDel('citrus.events'); lsDel(BAK);
  return lsSet(key, raw) ? key : '';
}
/** The damaged copy kept at start-up, for download (null when there is none). */
export function corruptCopy() { return recovery?.kept ? lsGet(recovery.kept) : null; }
export function dismissRecovery() { if (recovery?.kept) lsDel(recovery.kept); recovery = null; }

/** Best effort for JSON cut off mid-way (a full disk, a crash while writing): close it at the last complete value. */
export function salvageJSON(raw) {
  if (typeof raw !== 'string' || raw[0] !== '{') return null;
  const cuts = []; const stack = []; let inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); if (stack.length) cuts.push([i + 1, stack.slice().reverse().join('')]); }
    else if (c === ',') cuts.push([i, stack.slice().reverse().join('')]);
  }
  for (let n = cuts.length - 1, tries = 0; n >= 0 && tries < 60; n--, tries++) {
    const [at, close] = cuts[n];
    const s = parseState(raw.slice(0, at) + close);
    if (s) return s;
  }
  return null;
}

// Save to this device. When the browser's storage is full, drop what can be fetched again (the calendar cache, the start-up copy) and retry.
export const persistence = { ok: true, lastError: '', bytes: 0, since: 0 };
const persistListeners = new Set();
export function onPersistence(fn) { persistListeners.add(fn); return () => persistListeners.delete(fn); }
function persist() {
  const raw = JSON.stringify(state);
  const was = persistence.ok;
  persistence.bytes = raw.length * 2;
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    try { localStorage.setItem(KEY, raw); saved = true; }
    catch (e) {
      persistence.lastError = e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '') ? 'This device\'s storage is full' : (e?.message || 'save failed');
      if (attempt === 0) lsDel('citrus.events'); else if (attempt === 1) lsDel(BAK); else console.warn('persist failed', e);
    }
  }
  if (saved) { persistence.ok = true; persistence.lastError = ''; persistence.since = 0; }
  else { persistence.ok = false; persistence.since ||= Date.now(); }
  if (was !== persistence.ok) { for (const fn of persistListeners) try { fn(persistence); } catch {} alerts(); }
  return saved;
}

export function get() { return state; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let syncHook = null;
export function onRemoteSync(fn) { syncHook = fn; }

export function update(mutator, { silent = false, remote = true } = {}) {
  const prev = state;
  const next = typeof mutator === 'function' ? (mutator(state) || state) : { ...state, ...mutator };
  if (remote) { next.updatedAt = Date.now(); stampChanges(prev, next, next.updatedAt); }   // local-only bookkeeping (sync time, app cache, outbox) must not make this copy look newer
  state = next;
  persist();
  if (!silent) for (const fn of listeners) fn(state);
  if (remote && syncHook) syncHook(state);
  return state;
}

let beforeReplace = null;
/** Replace the whole state (a merge from Drive, a restored backup). The incoming copy is sanitized first, so a malformed file
 *  cannot blank the app. `bump`: this is the user's own choice (a restore): it becomes the newest copy and is pushed to the others. */
export function replaceState(s, { bump = false } = {}) {
  const prev = state;
  const next = complete(sanitize(s));
  if (bump) { beforeReplace = prev; next.updatedAt = Date.now(); next.stamps = { ...(next.stamps || {}) }; stampChanges(prev, next, next.updatedAt); }
  state = next;
  if (bump && syncHook) syncHook(state);
  persist();
  for (const fn of listeners) fn(state);
}
/** Undo the last restore (the copy from just before it), or false when there is nothing to undo. */
export function undoReplace() { if (!beforeReplace) return false; const b = beforeReplace; beforeReplace = null; replaceState(b, { bump: true }); beforeReplace = null; return true; }

export function exportJSON() { return JSON.stringify(state, null, 2); }

export function newId(prefix = '') { return prefix + uid(); }

// Mark something deleted so a merge with an older copy does not bring it back
export function tombstone(s, key) { return { ...(s.deleted || {}), [key]: Date.now() }; }

// ════════════════════════════════════════ edit times for values without their own `at`
// Notes are plain text, goals/rules/settings/me are plain values: their edit times are kept in `stamps`, written here
// for every change that goes through update(), so no caller has to remember it.
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
function stampChanges(prev, next, t) {
  if (!prev || !next) return;
  let stamps = null, deleted = null;
  const stamp = (k) => { (stamps ||= { ...(next.stamps || {}) })[k] = t; };
  const tomb = (k) => { (deleted ||= { ...(next.deleted || {}) })[k] = t; };
  if (prev.me !== next.me && !same(prev.me, next.me)) stamp('me');
  if (prev.notes !== next.notes) {
    const a = prev.notes || {}, b = next.notes || {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) { if (b[k] !== undefined) stamp(`note:${k}`); else if (!(next.deleted || {})[`note:${k}`]) tomb(`note:${k}`); }
  }
  for (const [field, pre] of [['rules', 'rule'], ['settings', 'set']]) {
    if (prev[field] === next[field]) continue;
    const a = prev[field] || {}, b = next[field] || {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k])) stamp(`${pre}:${k}`);
  }
  if (prev.goals !== next.goals && Array.isArray(next.goals)) {
    const before = new Map((prev.goals || []).filter(isObj).map(g => [g.id, g]));
    const ids = new Set();
    for (const g of next.goals) { if (!isObj(g)) continue; ids.add(g.id); if (!same(before.get(g.id), g)) stamp(`goal:${g.id}`); }
    for (const id of before.keys()) if (!ids.has(id)) tomb(`goal:${id}`);
    if (!same([...before.keys()], next.goals.filter(isObj).map(g => g.id))) stamp('goalOrder');
  }
  if (stamps) next.stamps = stamps;
  if (deleted) next.deleted = deleted;
}

// ════════════════════════════════════════ merging two devices
/** Merge this device's state (local) with Drive's (remote). Every collection merges record by record, newest edit wins; values
 *  without an `at` of their own (notes, goals, rules, settings, me) follow their edit time in `stamps`. Tombstones remove what
 *  either side deleted, unless it was edited again after the deletion. The outbox, sign-in and app cache never leave this device.
 *  Copies from before `stamps` existed have no edit times: then a set value beats an empty or default one, and the newer copy
 *  decides the rest — so a fresh device can never wipe `me`, custom goals or rules from Drive. */
export function mergeStates(local, remote) {
  if (!isObj(remote)) return local; if (!isObj(local)) return remote;
  local = sanitize(local); remote = sanitize(remote);
  const lt = num(local.updatedAt, 0), rt = num(remote.updatedAt, 0);
  const [older, newer] = lt > rt ? [remote, local] : [local, remote];
  const out = { ...older, ...newer };   // unknown keys from either copy survive; known ones are merged below
  const deleted = { ...(older.deleted || {}) };
  for (const [k, t] of Object.entries(newer.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, t);
  const alive = (key, at) => !(deleted[key] && deleted[key] >= (at || 0));
  const stamps = { ...(older.stamps || {}) };
  for (const [k, t] of Object.entries(newer.stamps || {})) stamps[k] = Math.max(stamps[k] || 0, t);
  const so = older.stamps || {}, sn = newer.stamps || {};
  // a value with an edit time beats one without; with equal times, a set value beats an empty/default one, then the newer copy wins
  const pick = (key, a, b, isBlank) => {
    const ta = so[key] || 0, tb = sn[key] || 0;
    if (ta !== tb) return ta > tb ? a : b;
    if (b === undefined) return a;
    if (a !== undefined && isBlank(b) && !isBlank(a)) return a;
    return b;
  };

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
  const mergeMap = (prefix, a = {}, b = {}, atOf = (v) => v?.at || 0) => {
    const m = {};
    for (const src of [a, b]) for (const [k, v] of Object.entries(src)) { const cur = m[k]; if (cur === undefined || atOf(v, k) >= atOf(cur, k)) m[k] = v; }
    for (const k of Object.keys(m)) if (!alive(`${prefix}:${k}`, atOf(m[k], k))) delete m[k];
    return m;
  };
  for (const [coll, prefix] of Object.entries(RECORD_MAPS)) out[coll] = mergeMap(prefix, older[coll], newer[coll], coll === 'rotaChanges' ? (x) => x?.at2 || x?.at || 0 : undefined);
  // notes: plain text, edit time in stamps; with equal times the newer copy's text wins
  {
    const m = {};
    for (const k of new Set([...Object.keys(older.notes || {}), ...Object.keys(newer.notes || {})])) {
      const v = pick(`note:${k}`, older.notes?.[k], newer.notes?.[k], (x) => x === undefined || x === '');
      if (v !== undefined && alive(`note:${k}`, stamps[`note:${k}`])) m[k] = v;
    }
    out.notes = m;
  }
  out.prefs = { ...(older.prefs || {}), ...(newer.prefs || {}) };
  // me: never let "nobody picked yet" overwrite a person
  out.me = pick('me', older.me, newer.me, (x) => !x || !(x.id || x.name)) ?? null;
  // rules and settings: field by field
  for (const [field, pre, dflt] of [['rules', 'rule', DEFAULT_RULES], ['settings', 'set', DEFAULT_SETTINGS]]) {
    const a = older[field] || {}, b = newer[field] || {}, o = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const v = pick(`${pre}:${k}`, a[k], b[k], (x) => x === undefined || same(x, dflt[k])); if (v !== undefined) o[k] = v; }
    out[field] = o;
  }
  out.settings.clientId = out.settings.clientId || newer.settings?.clientId || older.settings?.clientId || '';
  out.goals = mergeGoals(older, newer, so, sn, alive);
  // mediaMeta: suggestions dismissed on either device stay dismissed; reading goals per kind; the rest follows the newer edit
  {
    const a = older.mediaMeta || {}, b = newer.mediaMeta || {};
    const [lo, hi] = (b.at || 0) >= (a.at || 0) ? [a, b] : [b, a];
    const dismissed = [...new Set([...(Array.isArray(lo.dismissed) ? lo.dismissed : []), ...(Array.isArray(hi.dismissed) ? hi.dismissed : [])])].sort().slice(-300);   // sorted: both devices end with the same list, so no write ping-pong
    out.mediaMeta = { ...lo, ...hi, ...(lo.goals || hi.goals ? { goals: { ...(lo.goals || {}), ...(hi.goals || {}) } } : {}), ...(dismissed.length || lo.dismissed || hi.dismissed ? { dismissed } : {}) };
  }
  for (const coll of CELL_MAPS) {   // one cell per id and day, the latest write wins
    out[coll] = {};
    for (const src of [older[coll] || {}, newer[coll] || {}]) for (const [sk, cells] of Object.entries(src)) {
      const m = (out[coll][sk] ||= {});
      for (const [d, c] of Object.entries(cells || {})) if (!m[d] || (c?.at || 0) >= (m[d].at || 0)) m[d] = c;
    }
  }
  for (const hid of Object.keys(out.habitLog)) if (!out.habits[hid]) delete out.habitLog[hid];   // logs of deleted habits go with them
  // collections this version doesn't know yet (a newer build on another device): merge them record by record too, never drop one side
  for (const k of new Set([...Object.keys(older), ...Object.keys(newer)])) {
    if (k in KNOWN) continue;
    const a = older[k], b = newer[k];
    if (isObj(a) && isObj(b) && Object.values(a).every(isObj) && Object.values(b).every(isObj)) out[k] = mergeMap(k, a, b);
  }
  const horizon = Date.now() - TOMBSTONE_DAYS * 86400000;
  out.deleted = Object.fromEntries(Object.entries(deleted).filter(([, t]) => t > horizon));
  // edit times are only needed while the value exists (a deletion has its tombstone)
  const goalIds = new Set(out.goals.map(g => g.id));
  out.stamps = Object.fromEntries(Object.entries(stamps).filter(([k]) => k.startsWith('note:') ? k.slice(5) in out.notes : k.startsWith('goal:') ? goalIds.has(k.slice(5)) : true));
  out.outbox = local.outbox || [];
  out.google = local.google || {};
  out.apps = local.apps;
  return out;
}
const KNOWN = Object.fromEntries(Object.keys(defaults()).map(k => [k, 1]));

// Goals are a list: merge them by id (edit times in stamps), keep the newer copy's order and add the other's at the end.
// A copy that never touched its goals (the five defaults, no edit times) has no opinion about them.
function mergeGoals(older, newer, so, sn, alive) {
  const untouched = (s, st) => same(s.goals, DEFAULT_GOALS) && !Object.keys(st).some(k => k.startsWith('goal'));
  const a = Array.isArray(older.goals) ? older.goals : DEFAULT_GOALS, b = Array.isArray(newer.goals) ? newer.goals : DEFAULT_GOALS;
  if (untouched(newer, sn) && !untouched(older, so)) return a;
  if (untouched(older, so)) return b;
  const ma = new Map(a.map(g => [g.id, g])), mb = new Map(b.map(g => [g.id, g]));
  const dflt = new Map(DEFAULT_GOALS.map(g => [g.id, g]));
  const firstOrder = (so.goalOrder || 0) > (sn.goalOrder || 0) ? a : b, second = firstOrder === a ? b : a;
  const out = [], seen = new Set();
  for (const g of [...firstOrder, ...second]) {
    if (seen.has(g.id)) continue; seen.add(g.id);
    const ga = ma.get(g.id), gb = mb.get(g.id), ta = so[`goal:${g.id}`] || 0, tb = sn[`goal:${g.id}`] || 0;
    let v = ta !== tb ? (ta > tb ? ga : gb) : gb ?? ga;
    if (ta === tb && ga && gb && same(gb, dflt.get(g.id)) && !same(ga, dflt.get(g.id))) v = ga;
    v ||= ga || gb;
    if (alive(`goal:${g.id}`, Math.max(ta, tb))) out.push(v);
  }
  return out;
}

// ════════════════════════════════════════ telling the user (only in a browser; the banner module loads on demand)
function alerts() {
  if (typeof document === 'undefined') return;
  if (!recovery && persistence.ok && !document.querySelector('.d10-alert')) return;
  import('./store-alerts.js').then(m => m.showStoreAlerts({ recovery: () => recovery, persistence, corruptCopy, dismissRecovery, exportJSON })).catch(() => {});
}
state = load();
if (recovery?.kept) persist();                 // write the repaired copy (the damaged one is kept under its own key)
if (recovery) { if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', alerts, { once: true }); else setTimeout(alerts, 0); } }
if (!lsOk) { persistence.ok = false; persistence.lastError = 'This browser blocks saving on this device'; }
