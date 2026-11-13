// Turns imported rotas into answers: what am I doing on date X, who is with me, who is on call.
import { interpretCode } from './rota-parser.js';
import { monthKey, keyOf, addDays, atMin } from './util.js';

export const UNIT_LABEL = { gp: 'GP rota', uv: 'Upper Village specialists', fsed: 'FSED', lv: 'Lower Village specialists', nurse: 'Nurses' };
/** The nurses' schedule is its own thing: nurses are never your colleagues on the GP board, on leave lists or in coverage counts. */
export const isNurseRota = (r) => r.unitKind === 'nurse';

export function rotasForMonth(state, y, m) {
  const mk = monthKey(y, m);
  return Object.values(state.rotas).filter(r => monthKey(r.year, r.month) === mk);
}

export function allPeople(state) {
  const map = new Map();
  for (const r of Object.values(state.rotas)) {
    for (const p of r.people) {
      const k = (p.id && p.id !== '') ? `id:${p.id}` : `name:${p.name.toLowerCase()}`;
      const cur = map.get(k) || { key: k, name: p.name, id: p.id, title: p.title, mobile: p.mobile, units: new Set() };
      cur.units.add(r.unitKind);
      if (!cur.mobile && p.mobile) cur.mobile = p.mobile;
      map.set(k, cur);
    }
  }
  return [...map.values()].map(p => ({ ...p, units: [...p.units] }));
}

export function isMe(state, person) {
  if (!state.me) return false;
  if (state.me.id && person.id) return String(state.me.id) === String(person.id);
  return person.name.toLowerCase() === String(state.me.name || '').toLowerCase();
}

// One person's assignment on one day in one rota
function assignment(rota, person, day) {
  const code = person.days[day];
  const shift = interpretCode(code || '', rota.legend, rota.unitKind);
  return { person, rota, day, code: code || '', shift, mci: !!(person.flags && person.flags[day]) };
}

// Everything that happens on a given date across all rotas
export function dayInfo(state, date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const rotas = rotasForMonth(state, y, m);
  const entries = [];
  for (const r of rotas) if (!isNurseRota(r)) for (const p of r.people) entries.push(assignment(r, p, d));
  const mine = entries.find(e => e.rota.unitKind === 'gp' && isMe(state, e.person)) || entries.find(e => isMe(state, e.person)) || null;
  // your own correction (swap / cover / cancelled) wins over the imported rota
  const swap = state.swaps?.[keyOf(date)];
  if (swap && mine) {
    // a swap: the colleague takes what you were rostered for, you take swap.code (often their shift, or off)
    const other = swap.with ? entries.find(e => e.rota === mine.rota && e.person.name === swap.with) : null;
    if (other) { other.code = mine.code; other.shift = interpretCode(other.code, other.rota.legend, other.rota.unitKind); other.swap = swap; }
    mine.code = swap.code || ''; mine.shift = interpretCode(mine.code, mine.rota.legend, mine.rota.unitKind); mine.swap = swap;
  }
  const working = entries.filter(e => e.shift.kind === 'work');
  const gp = working.filter(e => e.rota.unitKind === 'gp');
  const bySite = {};
  for (const e of gp) {
    const site = e.shift.site || e.shift.label;
    (bySite[site] ||= []).push(e);
  }
  const fsed = working.filter(e => e.rota.unitKind === 'fsed');
  const uv = working.filter(e => e.rota.unitKind === 'uv');
  const lv = working.filter(e => e.rota.unitKind === 'lv');
  let withMe = [], alsoAtSite = [];
  if (mine && mine.shift.kind === 'work' && mine.shift.site) {
    const same = gp.filter(e => e !== mine && e.shift.site === mine.shift.site);
    withMe = same.filter(e => e.shift.type === mine.shift.type);
    alsoAtSite = same.filter(e => e.shift.type !== mine.shift.type);
  }
  const mci = gp.filter(e => e.mci);
  const leave = entries.filter(e => e.shift.kind === 'leave');
  const off = entries.filter(e => e.rota.unitKind === 'gp' && e.shift.kind === 'off');
  return { date, key: keyOf(date), rotas, entries, mine, working, gp, bySite, fsed, uv, lv, withMe, alsoAtSite, mci, leave, off, hasRota: rotas.length > 0 };
}

// Absolute time window of a shift on a date: {start: Date, end: Date}
export function shiftWindow(date, shift) {
  if (!shift || !shift.hours) return null;
  const start = atMin(date, shift.hours.start);
  const end = shift.hours.overnight ? atMin(addDays(date, 1), shift.hours.end) : atMin(date, shift.hours.end);
  return { start, end };
}

// My shift on a date, plus the tail of yesterday's overnight shift if any
export function myDay(state, date) {
  const info = dayInfo(state, date);
  const prev = dayInfo(state, addDays(date, -1));
  const today = info.mine && info.mine.shift.kind === 'work' ? { ...info.mine, window: shiftWindow(date, info.mine.shift) } : null;
  const overnightTail = prev.mine && prev.mine.shift.kind === 'work' && prev.mine.shift.hours?.overnight
    ? { ...prev.mine, window: shiftWindow(addDays(date, -1), prev.mine.shift) } : null;
  return { info, today, overnightTail, isNight: !!(today && today.shift.type === 'N'), afterNight: !!overnightTail };
}

// Colleague stats: shared shifts across loaded rotas
export function sharedShifts(state, personKey) {
  const out = [];
  for (const r of Object.values(state.rotas)) {
    if (r.unitKind !== 'gp') continue;
    const me = r.people.find(p => isMe(state, p));
    const other = r.people.find(p => (p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`) === personKey);
    if (!me || !other || other === me || isMe(state, other)) continue;   // you never "share" a shift with yourself
    for (let d = 1; d <= r.daysInMonth; d++) {
      const a = interpretCode(me.days[d] || '', r.legend, r.unitKind);
      const b = interpretCode(other.days[d] || '', r.legend, r.unitKind);
      if (a.kind === 'work' && b.kind === 'work' && a.site && a.site === b.site && a.type === b.type) {
        out.push({ date: new Date(r.year, r.month - 1, d), shift: a });
      }
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

export function monthSummary(state, y, m) {
  const days = new Date(y, m, 0).getDate();
  let work = 0, nights = 0, hours = 0, leave = 0;
  const siteCount = {};
  for (let d = 1; d <= days; d++) {
    const info = dayInfo(state, new Date(y, m - 1, d));
    if (!info.mine) continue;
    const s = info.mine.shift;
    if (s.kind === 'work') { work++; if (s.type === 'N') nights++; hours += s.hours?.durationMin || 0; siteCount[s.site || s.label] = (siteCount[s.site || s.label] || 0) + 1; }
    if (s.kind === 'leave') leave++;
  }
  return { work, nights, hours: Math.round(hours / 60), leave, off: days - work - leave, siteCount };
}
