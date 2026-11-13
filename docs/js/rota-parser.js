// Rota parser for HABIB Medical Center monthly schedule workbooks.
// Input: a sheet grid from xlsx-lite (sheetToGrid). Output: a normalized Rota object.
import { readXlsx, sheetToGrid } from './xlsx-lite.js';

const str = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------- time helpers ----------
function parseClock(s) {
  // "8:00", "09:00 AM", "1:00", "18:00"
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let h = +m[1]; const min = +(m[2] || 0); const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + min;
}
export function parseHours(text) {
  // returns {start, end, overnight} in minutes, or null
  if (!text) return null;
  const m = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(text);
  if (!m) return null;
  const start = parseClock(m[1]), end = parseClock(m[2]);
  if (start === null || end === null) return null;
  return { start, end, overnight: end <= start, durationMin: end > start ? end - start : 24 * 60 - start + end };
}

// ---------- legend ----------
function splitCodes(codeText) {
  const t = str(codeText);
  if (!t) return [];
  if (/^AL\s*\/\s*EL$/i.test(t)) return ['AL/EL', 'AL', 'EL'];
  const parts = t.split(/\s*[\\\/]\s*/).map(s => s.trim()).filter(Boolean);
  return parts.length > 1 ? [t, ...parts] : [t];
}

function parseLegend(grid, stopRow = grid.length) {
  const legend = {};     // code -> {code, desc, hours, site, raw}
  const entries = [];
  for (let r = 1; r < stopRow; r++) {
    const row = grid[r]; if (!row) continue;
    for (let c = 1; c < row.length; c++) {
      if (str(row[c]).toLowerCase() !== 'shift') continue;
      // header labels to the right (up to 25 cols)
      const labels = [];
      for (let cc = c + 1; cc < Math.min(row.length, c + 25); cc++) {
        const v = str(row[cc]); if (v && !labels.some(l => l.col === cc)) labels.push({ col: cc, label: v.toLowerCase() });
      }
      if (!labels.length) continue;
      let blank = 0;
      for (let rr = r + 1; rr < stopRow && blank < 2; rr++) {
        const code = str(grid[rr][c]);
        const vals = labels.map(l => ({ label: l.label, value: str(grid[rr][l.col]) }));
        const hasAny = code || vals.some(v => v.value);
        if (!hasAny) { blank++; continue; }
        if (code.length > 14 || /habib|unit|month/i.test(code)) break; // ran into the title block
        blank = 0;
        const hoursText = vals.find(v => /hour/.test(v.label))?.value || '';
        const descText = vals.find(v => /desc/.test(v.label))?.value || '';
        const raw = vals.map(v => v.value).filter(Boolean).join(' | ');
        const hours = parseHours(hoursText) || parseHours(descText);
        // In the 2-col legend, "Regular Hours" holds the description for non-shift codes.
        let desc = descText || (hours ? '' : hoursText);
        const entry = { code, desc, hoursText: hours ? (hoursText || descText) : '', hours, raw };
        entries.push(entry);
        for (const k of splitCodes(code)) if (!legend[k.toUpperCase()]) legend[k.toUpperCase()] = entry;
      }
    }
  }
  return { legend, entries };
}

// ---------- header / people ----------
function findHeader(grid) {
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r]; if (!row) continue;
    const nameCol = row.findIndex(v => str(v).toUpperCase() === 'NAME');
    if (nameCol < 0) continue;
    const dayCols = {};
    for (let c = nameCol + 1; c < row.length; c++) {
      const v = row[c];
      if (isNum(v) && v >= 1 && v <= 31 && Number.isInteger(v)) dayCols[v] = c;
      else if (/^\d{1,2}$/.test(str(v))) dayCols[+str(v)] = c;
    }
    if (Object.keys(dayCols).length < 20) continue;
    const find = (re) => row.findIndex(v => re.test(str(v)));
    const snCol = find(/^SN$/i);
    let idCol = find(/^(HMG-?ID|I\.?D|EMP(LOYEE)? ?(ID|NO))$/i);
    if (idCol < 0 && snCol >= 0 && nameCol - snCol === 2) idCol = snCol + 1; // unlabeled ID column
    return {
      row: r, nameCol, dayCols, snCol, idCol,
      titleCol: find(/^title$/i), mobileCol: find(/mobile|phone/i), clinicCol: find(/^assigned clinic$/i),
    };
  }
  return null;
}

function cellMeta(grid, label) {
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r]; if (!row) continue;
    for (let c = 1; c < row.length; c++) {
      if (str(row[c]).toLowerCase().replace(/\s+/g, '') === label) {
        for (let cc = c + 1; cc < row.length; cc++) {
          const v = row[cc];
          if (v === null || v === undefined || str(v) === '') continue;
          if (str(v).toLowerCase().replace(/\s+/g, '') === label) continue; // merged label cell
          return v;
        }
      }
    }
  }
  return null;
}

function classify(code, legend) {
  const c = str(code).toUpperCase();
  if (!c) return { kind: 'off' };
  if (/annual|eid|sick|emergency|leave|^AL$|^EL$|^SL$|^EM\\?L$|^AL\/EL$/i.test(c)) return { kind: 'leave' };
  if (/^VL$/.test(c)) return { kind: 'leave' };                                   // nurses' schedule: vacation leave
  if (/transfer|resign|orientation|^OR$|^(ACLS|BLS)\b|^PULL OUT|^END OF CONTRACT/i.test(c)) return { kind: 'other' };
  if (/^(OFF|OFF REQUEST|O)$/i.test(c)) return { kind: 'off' };
  return { kind: 'work' };
}

export function interpretCode(code, legend, unitKind) {
  const c = str(code);
  const C = c.toUpperCase();
  const base = { code: c, kind: classify(c, legend).kind, label: c, site: '', hours: null, type: '' };
  if (!C) return { ...base, label: 'Off' };
  const direct = legend[C];
  if (base.kind !== 'work') {
    return { ...base, label: direct?.desc || (direct?.raw) || c.replace(/\s+/g, ' ') };
  }
  let m;
  if ((m = /^([DNE])(\d)$/.exec(C))) {
    const typeEntry = legend[m[1]];
    const siteEntry = legend[C];
    const type = m[1];
    const hours = siteEntry?.hours || typeEntry?.hours || null;
    const site = siteEntry?.desc || siteEntry?.raw || '';
    return { ...base, type, site, hours, label: `${{ D: 'Day', N: 'Night', E: 'Evening' }[type]} · ${site || C}` };
  }
  if (direct) {
    const type = C;
    if (/^[DNE]$/.test(C)) {
      const site = unitKind === 'fsed' ? 'FSED' : unitKind === 'uv' ? 'Upper Village' : unitKind === 'lv' ? 'Lower Village' : '';
      const word = { D: 'Day', N: 'Night', E: 'Evening' }[C];
      return { ...base, type, site, hours: direct.hours, label: site ? `${word} · ${site}` : word };
    }
    const site = /^(AD|OR|SF)$/.test(C) ? '' : (direct.desc || '');
    const label = { AD: 'Admin day', SF: 'SF shift (13:00–01:00)' }[C] || direct.desc || C;
    return { ...base, type, site, hours: direct.hours, label };
  }
  return { ...base, type: C, label: c };
}

export function guessUnitKind(unit) {
  const u = str(unit).toLowerCase();
  if (/fsed/.test(u)) return 'fsed';
  if (/upper village/.test(u)) return 'uv';
  if (/lower village/.test(u)) return 'lv';
  return 'gp';
}

export function parseRotaGrid(grid, meta = {}, outlineGrid = []) {
  const header = findHeader(grid);
  if (!header) throw new Error('Could not find the schedule header row (NAME + day numbers)');
  if (header.clinicCol >= 0) return parseNurseGrid(grid, header, meta);   // the nurses' schedule has its own layout (sections, a clinic column, a legend below the names)
  const { legend, entries } = parseLegend(grid, header.row);
  const unit = str(cellMeta(grid, 'unit/department')) || meta.unit || '';
  let monthVal = cellMeta(grid, 'month&year');
  let year = meta.year, month = meta.month;
  if (monthVal instanceof Date) { year = monthVal.getUTCFullYear(); month = monthVal.getUTCMonth() + 1; }
  else if (typeof monthVal === 'number') { const d = new Date(Math.round((monthVal - 25569) * 86400000)); year = d.getUTCFullYear(); month = d.getUTCMonth() + 1; }
  else if (monthVal) {
    const m = /([A-Za-z]{3,})\w*[\s-]*(\d{2,4})/.exec(str(monthVal));
    if (m) { month = new Date(`${m[1]} 1, 2000`).getMonth() + 1; year = +m[2] < 100 ? 2000 + +m[2] : +m[2]; }
  }
  const dayNums = Object.keys(header.dayCols).map(Number).sort((a, b) => a - b);
  const daysInMonth = (year && month) ? new Date(year, month, 0).getDate() : dayNums[dayNums.length - 1];
  const weekdayRow = grid[header.row + 1] || [];
  const unitKind = guessUnitKind(unit);
  const people = [];
  let blank = 0;
  for (let r = header.row + 2; r < grid.length && blank < 3; r++) {
    const row = grid[r] || [];
    const name = str(row[header.nameCol]);
    if (!name || name.length < 2 || /^[DNE]$/i.test(name)) { blank++; continue; }
    blank = 0;
    const days = {}, flags = {};
    for (const d of dayNums) {
      if (d > daysInMonth) continue;
      const v = str(row[header.dayCols[d]]);
      if (v) days[d] = v;
      // colored outline (cyan in HABIB rotas) = MCI 2nd physician: moved to FSED/MCI site immediately if a mass-casualty incident happens
      const outline = outlineGrid[r]?.[header.dayCols[d]];
      if (v && outline) flags[d] = 'mci';
    }
    const idRaw = header.idCol >= 0 && header.idCol !== header.nameCol ? row[header.idCol] : null;
    people.push({
      sn: header.snCol >= 0 ? str(row[header.snCol]) : String(people.length + 1),
      id: str(idRaw),
      name: name.replace(/\s+/g, ' ').replace(/^Dr\.\s*/i, 'Dr. '),
      title: header.titleCol >= 0 ? str(row[header.titleCol]) : '',
      mobile: header.mobileCol >= 0 ? str(row[header.mobileCol]).replace(/\.0$/, '') : '',
      days, flags,
    });
  }
  // sanity: weekday check
  let weekdayOk = true;
  if (year && month) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d1 = new Date(year, month - 1, 1).getDay();
    const w1 = str(weekdayRow[header.dayCols[1]]).slice(0, 3);
    weekdayOk = !w1 || names[d1].toLowerCase() === w1.toLowerCase();
  }
  const seen = new Set();
  const legendList = entries.filter(e => { const k = `${e.code}|${e.desc}|${e.hoursText}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(e => ({ code: e.code, desc: e.desc, hoursText: e.hoursText, raw: e.raw }));
  return {
    unit, unitKind, year, month, daysInMonth, people, legend, legendList, weekdayOk,
    id: `${unitKind}-${year}-${String(month).padStart(2, '0')}`,
    importedAt: new Date().toISOString(),
    sourceName: meta.sourceName || '',
  };
}

// ---------- nurses' schedule ----------
const STAFF_TITLE = /^(HN|RN|SN|PN|AN|CN|NA|PHN|NURSE)\b/i;
const clean = (t) => str(t).replace(/\s+/g, ' ').trim();
/** Known blocks of the nurses' sheet, most specific first ("Construction Clinics Team Leaders" is leaders, not the pool). */
const SECTIONS = [
  ['leaders', /team leader/], ['fa', /first\s*aid/], ['pool', /construction/], ['fsed', /free standing|\bfsed\b/], ['sixflags', /six\s*flags/],
  ['aqua', /aqua/], ['plateau', /\bplat(eau|ue)\b/], ['nairiya', /nairiya/], ['head', /head nurse/],
];
export const SITE_CODES = ['UPV', 'LPV', 'UPO', 'LPO'];
/** Which block a heading starts. A heading the app doesn't know becomes its own group named from the sheet, never part of the block above it:
 *  folding new blocks into the previous one is how "SIX FLAGS" nurses ended up listed as Aqua Arabia. */
export function nurseSection(heading) {
  const t = clean(heading), low = t.toLowerCase(), known = SECTIONS.find(([, re]) => re.test(low));
  const sites = SITE_CODES.filter(c => new RegExp(`\\b${c}\\b`).test(t.toUpperCase()));   // "(UPV-LPV)" says where that block can be posted
  if (known) return { key: known[0], heading: t, sites, known: true };
  let label = t.replace(/\([^)]*\)/g, ' ').replace(/[-–:]+\s*$/, '').replace(/\s+/g, ' ').trim() || t;
  if (label === label.toUpperCase()) label = label.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());   // "SIX FLAGS" → "Six Flags"
  label = label.slice(0, 40);
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
  return { key: `sec:${slug}`, heading: t, sites, known: false, label };
}
/** The heading text of a row with no person: the first cell with letters before the day columns (headings are merged cells, so it repeats). */
const headingOf = (row, upTo) => { for (let c = 0; c < upTo; c++) { const v = clean(row[c]); if (/[a-z]{2}/i.test(v)) return v; } return ''; };
const pullDest = (v) => clean(v.replace(/^pull\s*out\s*[-–:]?\s*/i, '').replace(/\bproject\b/i, ''));
const titleCase = (t) => t.toLowerCase().replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
function parseNurseGrid(grid, header, meta) {
  const unit = clean(cellMeta(grid, 'unit/department')) || meta.unit || '';
  let monthVal = cellMeta(grid, 'month&year'), year = meta.year, month = meta.month;
  if (monthVal instanceof Date) { year = monthVal.getUTCFullYear(); month = monthVal.getUTCMonth() + 1; }
  else if (typeof monthVal === 'number') { const d = new Date(Math.round((monthVal - 25569) * 86400000)); year = d.getUTCFullYear(); month = d.getUTCMonth() + 1; }
  else if (monthVal) { const m = /([A-Za-z]{3,})\w*[\s-]*(\d{2,4})/.exec(str(monthVal)); if (m) { month = new Date(`${m[1]} 1, 2000`).getMonth() + 1; year = +m[2] < 100 ? 2000 + +m[2] : +m[2]; } }
  const dayNums = Object.keys(header.dayCols).map(Number).sort((a, b) => a - b);
  const daysInMonth = (year && month) ? new Date(year, month, 0).getDate() : dayNums[dayNums.length - 1];
  const people = [], groups = {}, pulls = {}; let section = null, banner = '', legendRow = -1;
  const firstDayCol = Math.min(...Object.values(header.dayCols));
  const enter = (heading) => {
    const sec = nurseSection(heading);
    if (!people.length && !sec.known) { banner = sec.heading; return; }   // the project banner above everyone ("Qiddiyah Project-HMC"), not a block
    section = sec.key; const g = groups[sec.key] ||= { heading: sec.heading };
    if (!sec.known) { g.label = sec.label; if (!sec.sites.length) g.fixed = sec.label; }
    if (sec.sites.length) g.choices = sec.sites;
  };
  for (let r = header.row + 2; r < grid.length; r++) {
    const row = grid[r] || [];
    if (row.some(v => /^legend$/i.test(clean(v)))) { legendRow = r; break; }
    const name = clean(row[header.nameCol]), title = header.titleCol >= 0 ? clean(row[header.titleCol]) : '', id = header.idCol >= 0 ? clean(row[header.idCol]).replace(/\.0$/, '') : '';
    if (!name || (!STAFF_TITLE.test(title) && !/^\d{3,}$/.test(id))) { const t = headingOf(row, firstDayCol) || name; if (t) enter(t); continue; }   // a heading row, not a person
    const clinic = header.clinicCol >= 0 ? clean(row[header.clinicCol]) : '';
    const days = {}, dest = {};
    for (const d of dayNums) {
      if (d > daysInMonth) continue;
      let v = clean(row[header.dayCols[d]]); if (!v || v === '/') continue;   // "/" is a rest day, same as blank
      // "PULL OUT - NARJIS" / "PULL OUT - NAIRIYA Project": keep where they were pulled to, one code per destination
      if (/^pull\s*out/i.test(v)) { const to = pullDest(v); v = to ? `PULL OUT - ${to.toUpperCase()}` : 'PULL OUT'; if (to) { dest[to.toUpperCase()] = (dest[to.toUpperCase()] || 0) + 1; pulls[v] = titleCase(to); } }
      days[d] = v;
    }
    const leader = /\(leader\)/i.test(name), fa = /\(fa\)/i.test(name);
    // head nurse by title (HN, "ALL SITES"), wherever the sheet puts them; Nairiya by clinic; first aiders also by their "(FA)" tag
    const grp = /^HN\b/i.test(title) || /all sites/i.test(clinic) ? 'head' : /nairiya/i.test(clinic) ? 'nairiya' : fa ? 'fa' : section || 'pool';
    const pulledTo = Object.entries(dest).sort((a, b) => b[1] - a[1])[0]?.[0];
    people.push({ sn: String(people.length + 1), id, name: name.replace(/\s*\((leader|fa)\)/ig, '').trim(), title, mobile: header.mobileCol >= 0 ? clean(row[header.mobileCol]).replace(/\.0$/, '') : '', clinic, group: grp, leader, fa, days, flags: {}, ...(pulledTo ? { pulledOut: titleCase(pulledTo) } : {}) });
  }
  for (const k of Object.keys(groups)) if (!people.some(p => p.group === k)) delete groups[k];   // only blocks that hold someone
  // legend sits below the names: code | hours | length
  const legend = {}, entries = [];
  const add = (code, desc, hoursText) => { const hours = parseHours(hoursText); legend[code] = { code, desc, hoursText, hours, raw: `${code} ${hoursText}` }; entries.push({ code, desc, hoursText, raw: `${code} ${hoursText}` }); };
  if (legendRow >= 0) for (let r = legendRow + 1; r < grid.length; r++) {
    const row = grid[r] || [], cells = row.map(clean), i = cells.findIndex(c => /^[A-Z][A-Z0-9+]{0,2}$/.test(c));
    if (i < 0 || i > 4) { if (cells.every(c => !c)) continue; else break; }
    const code = cells[i], next = cells[i + 1] || '';
    if (parseHours(next)) add(code, `${code} shift`, next); else if (/vacation|leave/i.test(next)) { legend[code] = { code, desc: next, hoursText: '', hours: null, raw: next }; entries.push({ code, desc: next, hoursText: '', raw: next }); }
  }
  for (const [code, label] of [['ACLS', 'ACLS / BLS training'], ['BLS', 'ACLS / BLS training'], ['PULL OUT', 'Pulled out to another project'], ['END OF CONTRACT', 'Contract ended']]) legend[code] ||= { code, desc: label, hoursText: '', hours: null, raw: label };
  for (const [code, to] of Object.entries(pulls)) legend[code] ||= { code, desc: `Pulled out → ${to}`, hoursText: '', hours: null, raw: `Pulled out → ${to}` };
  legend.VL ||= { code: 'VL', desc: 'Vacation leave', hoursText: '', hours: null, raw: 'Vacation leave' };
  const weekdayRow = grid[header.row + 1] || [], names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const w1 = str(weekdayRow[header.dayCols[1]]).slice(0, 3), weekdayOk = !(year && month) || !w1 || names[new Date(year, month - 1, 1).getDay()].toLowerCase() === w1.toLowerCase();
  const warnings = nurseWarnings(grid, header, legendRow, people, legend, dayNums.filter(d => d <= daysInMonth));
  return { unit, unitKind: 'nurse', year, month, daysInMonth, people, groups, legend, legendList: entries.map(e => ({ code: e.code, desc: e.desc, hoursText: e.hoursText, raw: e.raw })), weekdayOk, warnings,
    ...(banner ? { banner } : {}), id: `nurse-${year}-${String(month).padStart(2, '0')}`, importedAt: new Date().toISOString(), sourceName: meta.sourceName || '' };
}

/** Things in the sheet that look wrong but that the import still accepts — shown to the user, never silently "fixed". */
function nurseWarnings(grid, header, legendRow, people, legend, days) {
  const out = [], first = (p) => p.name.split(' ')[0];
  // the same mobile on two people is almost always a copy-paste slip
  const byMob = {}; for (const p of people) { const m = p.mobile.replace(/\D/g, '').replace(/^(966|0)/, ''); if (m) (byMob[m] ||= []).push(p); }
  for (const list of Object.values(byMob)) if (list.length > 1) out.push({ kind: 'mobile-shared', text: `${list.map(first).join(' and ')} share the same mobile number`, keys: list.map(p => p.id || p.name) });
  // Saudi mobiles are 5xxxxxxxx (9 digits, or 10 with the leading 0)
  for (const p of people) { const m = p.mobile.replace(/\D/g, '').replace(/^966/, '').replace(/^0/, ''); if (m && !/^5\d{8}$/.test(m)) out.push({ kind: 'mobile-odd', text: `${first(p)}’s mobile (${p.mobile}) is not 9 digits starting with 5`, keys: [p.id || p.name] }); }
  if (legendRow < 0) return out;
  const firstDayCol = Math.min(...Object.values(header.dayCols));
  for (let r = legendRow + 1; r < grid.length; r++) {
    const cells = (grid[r] || []).map(clean);
    // legend line "A2 | 14:00-02:00 | 8Hrs": the stated length must match the hours
    const i = cells.findIndex(c => /^[A-Z][A-Z0-9+]{0,2}$/.test(c));
    if (i >= 0 && i < firstDayCol - 1) { const h = parseHours(cells[i + 1] || ''), len = /^(\d+(?:\.\d+)?)\s*hrs?$/i.exec(cells[i + 2] || ''); if (h && len && Math.abs(h.durationMin / 60 - +len[1]) > 0.01) out.push({ kind: 'legend-hours', text: `Legend: ${cells[i]} is ${cells[i + 1]} (${+(h.durationMin / 60).toFixed(2)}h) but says ${cells[i + 2]}`, code: cells[i] }); }
    // the sheet's own head-count table ("D | 16 | 16 | 15 …" under the day columns): check it against what was read
    const label = cells[firstDayCol - 1] || '';
    if (legend[label.toUpperCase()]?.hours && days.filter(d => /^\d+$/.test(cells[header.dayCols[d]] || '')).length >= days.length / 2) {
      const bad = days.filter(d => /^\d+$/.test(cells[header.dayCols[d]] || '') && +cells[header.dayCols[d]] !== people.filter(p => (p.days[d] || '').toUpperCase() === label.toUpperCase()).length);
      if (bad.length) out.push({ kind: 'count', text: `${label} head-count in the sheet differs from the names on ${bad.length} day${bad.length === 1 ? '' : 's'} (${bad.slice(0, 6).join(', ')}${bad.length > 6 ? '…' : ''})`, code: label, days: bad });
    }
  }
  return out;
}

export async function parseRotaFile(arrayBuffer, sourceName = '') {
  const wb = await readXlsx(arrayBuffer);
  if (!wb.sheets.length) throw new Error('Workbook has no sheets');
  // pick the sheet with a header
  let lastErr = null;
  for (const sh of wb.sheets) {
    try {
      const { grid, outlineGrid } = sheetToGrid(sh);
      return parseRotaGrid(grid, { sourceName }, outlineGrid);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Strip legend (functions) for JSON storage, keep what the app needs.
export function serializeRota(rota) {
  const legend = {};
  for (const [k, v] of Object.entries(rota.legend)) legend[k] = { code: v.code, desc: v.desc, hoursText: v.hoursText, hours: v.hours, raw: v.raw };
  return { ...rota, legend };
}
