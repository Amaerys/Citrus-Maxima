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
export function fmtMin(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
    let idCol = find(/^(HMG-?ID|ID|EMP(LOYEE)? ?(ID|NO))$/i);
    if (idCol < 0 && snCol >= 0 && nameCol - snCol === 2) idCol = snCol + 1; // unlabeled ID column
    return {
      row: r, nameCol, dayCols, snCol, idCol,
      titleCol: find(/^title$/i), mobileCol: find(/mobile|phone/i),
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
  if (/transfer|resign|orientation|^OR$/i.test(c)) return { kind: 'other' };
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
