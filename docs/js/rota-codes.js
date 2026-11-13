// Rota legend → tidy rows (Work › Calendar "Shift codes") and the codes you can pick in "Correct this day". Pure functions (no DOM).
// The Excel legend is written for people: "D1 \ N1 \ E1 · Upper Village", "AL/EL", "Em\L". Splitting it blindly gave bogus codes
// ("Em", "L") and dropped the hours (beta T02-23, T02-25).
import { interpretCode } from './rota-parser.js';

const p2 = (n) => String(n).padStart(2, '0');
const clock = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${p2(Math.floor(x / 60))}${x % 60 ? ':' + p2(x % 60) : ''}`; };
/** "08–20", "07–16:30", or '' when the rota gives no hours. */
export const hoursShort = (sh) => sh?.hours ? `${clock(sh.hours.start)}–${clock(sh.hours.end)}` : '';
const isSiteCode = (c) => /^[DNE]\d$/i.test(c);
const LEAVE_ATOMS = /^(AL|EL|SL|VL)$/i;
const parts = (code) => String(code || '').split(/\s*[\\/]\s*/).map(x => x.trim()).filter(Boolean);
/** A combined legend key ("D1 \ N1 \ E1", "AL/EL") is a list of codes; "Em\L" is one code whose halves mean nothing alone. */
const splits = (code) => { const p = parts(code); return p.length > 1 && p.every(x => isSiteCode(x) || LEAVE_ATOMS.test(x)); };
const atoms = (code) => splits(code) ? parts(code) : [String(code).trim()];

/**
 * Legend rows for people: [{ codes: 'D1 / N1 / E1', what: 'Upper Village', hours: '08–20 / 20–08 / 10–22' }],
 * plus `marks`: legend lines with no code (cell colours such as "MCI 2nd Physician"), which the old card dropped.
 */
export function legendRows(rota) {
  if (!rota?.legendList) return { rows: [], marks: [] };
  const rows = [], marks = [], seen = new Set();
  for (const e of rota.legendList) {
    if (!e.code) { if (e.desc && !marks.includes(e.desc)) marks.push(e.desc); continue; }
    const list = atoms(e.code), key = list.join('/').toUpperCase(); if (seen.has(key)) continue; seen.add(key);
    const shifts = list.map(c => interpretCode(c, rota.legend, rota.unitKind));
    const hrs = shifts.map(hoursShort), what = e.desc || (shifts[0].kind === 'work' ? shifts[0].label.replace(/ \(.*\)$/, '') : shifts[0].label);
    rows.push({ codes: list.join(' / '), what: what === list[0] ? '' : what, hours: hrs.some(Boolean) ? hrs.map(x => x || '—').join(' / ') : '', kind: shifts[0].kind });
  }
  return { rows, marks };
}

const GROUP_OF = (sh) => sh.kind === 'leave' ? 'Leave' : sh.kind !== 'work' ? 'Other' : ({ D: 'Day', N: 'Night', E: 'Evening' })[sh.type] || 'Other';
export const GROUPS = ['Day', 'Night', 'Evening', 'Other', 'Leave'];
/** Words for one option: "D1 · Upper Village · 08–20", "VL · Planned leave". */
export function codeText(rota, code) {
  const sh = interpretCode(code, rota?.legend || {}, rota?.unitKind || 'gp');
  if (/^VL$/i.test(code)) return 'VL · Planned leave';
  let what = sh.kind === 'work' ? (sh.site || sh.label.replace(/ \(.*\)$/, '')) : sh.label;
  // "AL/EL = Annual leave / Eid leave": each half of a combined legend line gets its own half of the words
  const combo = (rota?.legendList || []).find(e => e.code && splits(e.code) && atoms(e.code).some(a => a.toUpperCase() === String(code).toUpperCase()));
  const halves = combo ? String(combo.desc || '').split(/\s+\/\s+/) : [];
  if (combo && halves.length === atoms(combo.code).length) what = halves[atoms(combo.code).findIndex(a => a.toUpperCase() === String(code).toUpperCase())];
  if (what.toUpperCase().startsWith(String(code).toUpperCase() + ' ')) what = '';
  return [code, what && what !== code ? what : '', hoursShort(sh)].filter(Boolean).join(' · ');
}
/**
 * The codes you can set a day to, grouped Day / Night / Evening / Other / Leave, each with its site and hours.
 * Leave codes are always there (planned leave is VL), and so is whatever the day holds now, so Save never silently changes it (beta T02-06).
 * → [{ group, items: [{ code, text }] }]
 */
export function codeOptions(rota, keep = []) {
  const codes = new Map(), add = (c) => { c = String(c || '').trim(); if (c && !codes.has(c.toUpperCase())) codes.set(c.toUpperCase(), c); };
  const leg = rota?.legendList || [], hasSites = leg.some(e => parts(e.code).some(isSiteCode));
  for (const e of leg) if (e.code) for (const c of atoms(e.code)) if (!(hasSites && /^[DNE]$/i.test(c))) add(c);   // bare D/N/E only give the default hours
  for (const p of rota?.people || []) for (const v of Object.values(p.days || {})) { const sh = interpretCode(v, rota.legend, rota.unitKind); if (sh.kind === 'work' || sh.kind === 'leave') add(v); }
  if (!rota) ['D1', 'D2', 'N1', 'N2', 'E1', 'E2'].forEach(add);
  ['AL', 'SL', 'VL'].forEach(add); keep.forEach(add);
  const groups = new Map(GROUPS.map(g => [g, []]));
  for (const c of codes.values()) { const sh = interpretCode(c, rota?.legend || {}, rota?.unitKind || 'gp'); if (sh.kind === 'off') continue; groups.get(GROUP_OF(sh)).push({ code: c, text: codeText(rota, c) }); }
  const ord = (a, b) => a.code.localeCompare(b.code, 'en', { numeric: true });
  return GROUPS.map(g => ({ group: g, items: groups.get(g).sort(ord) })).filter(g => g.items.length);
}
