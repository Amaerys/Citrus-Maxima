// Single source of truth. Persists to localStorage immediately and to Google Drive (appDataFolder) when signed in.
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
    settings: { clientId: '', calendarIds: ['primary'], shiftCalendarId: '', pushShifts: false, driveFolder: 'Citrus Maxima', theme: 'dark' },
    google: { email: '', lastSync: 0 },
    apps: {},                 // other apps' status files from Drive: name -> json
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const s = JSON.parse(raw);
    return { ...defaults(), ...s, rules: { ...DEFAULT_RULES, ...(s.rules || {}) }, settings: { ...defaults().settings, ...(s.settings || {}) } };
  } catch { return defaults(); }
}

export function get() { return state; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let syncHook = null;
export function onRemoteSync(fn) { syncHook = fn; }

export function update(mutator, { silent = false, remote = true } = {}) {
  const next = typeof mutator === 'function' ? (mutator(state) || state) : { ...state, ...mutator };
  next.updatedAt = Date.now();
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('persist failed', e); }
  if (!silent) for (const fn of listeners) fn(state);
  if (remote && syncHook) syncHook(state);
  return state;
}

export function replaceState(s) {
  state = { ...defaults(), ...s };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  for (const fn of listeners) fn(state);
}

export function exportJSON() { return JSON.stringify(state, null, 2); }

export function newId(prefix = '') { return prefix + uid(); }
