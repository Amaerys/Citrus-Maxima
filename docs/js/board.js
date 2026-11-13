// Shift board: who is in, hour by hour, with overlapping shifts drawn as bars on one shared time axis. Pure functions (no DOM).
const HOUR = 60;
/**
 * entries: [{ person, code, shift: { type, label, hours: { start, end, overnight } }, dayOffset? }] → rows on one axis + coverage per hour.
 * dayOffset −1 marks yesterday's overnight shift still running this morning (see today-model.js withLastNight); its bar sits left of 00:00.
 * wrap: the old behaviour moved a pre-dawn `now` onto tomorrow morning, which counts TONIGHT's crew as "in now" (beta T01-01).
 * Callers that pass yesterday's rows set wrap:false; the default stays for older callers.
 * Rows carry x0/x1, the part of the bar inside the axis.
 */
export function boardModel(entries, { nowMin = null, meKey = '', keyOf = (p) => p.name, wrap = true } = {}) {
  const rows = entries.filter(e => e.shift?.hours).map(e => {
    const { start, end, overnight } = e.shift.hours, off = (e.dayOffset || 0) * 1440, en = (overnight || end <= start ? end + 1440 : end) + off;
    return { key: keyOf(e.person), entry: e, name: e.person.name, code: e.code || '', type: e.shift.type || 'other', label: e.shift.label || '', start: start + off, end: en, prev: off < 0, me: !!meKey && keyOf(e.person) === meKey };
  }).sort((a, b) => a.start - b.start || a.end - b.end || a.name.localeCompare(b.name));
  if (!rows.length) return { rows, axisStart: 0, axisEnd: 1440, hours: [], now: null, nowCount: 0, next: null, peak: 0 };
  let axisStart = Math.floor(Math.min(...rows.map(r => r.start)) / HOUR) * HOUR, axisEnd = Math.ceil(Math.max(...rows.map(r => r.end)) / HOUR) * HOUR;
  if (axisEnd - axisStart < 720) axisEnd = axisStart + 720; axisEnd = Math.min(axisEnd, axisStart + 1800);
  const hours = []; for (let t = axisStart; t < axisEnd; t += HOUR) hours.push({ t, n: rows.filter(r => r.start < t + HOUR && r.end > t).length });
  for (const r of rows) { r.x0 = Math.max(r.start, axisStart); r.x1 = Math.min(r.end, axisEnd); }
  let now = nowMin; if (wrap && now != null && now < axisStart && now + 1440 < axisEnd) now += 1440; if (now != null && (now < axisStart || now > axisEnd)) now = null;
  const inNow = now == null ? [] : rows.filter(r => r.start <= now && now < r.end);
  const edges = [...new Set(rows.flatMap(r => [r.start, r.end]))].filter(t => now != null && t > now && t < axisEnd).sort((a, b) => a - b);
  const next = edges.length ? { t: edges[0], arrive: rows.filter(r => r.start === edges[0]).length, leave: rows.filter(r => r.end === edges[0]).length } : null;
  return { rows, axisStart, axisEnd, hours, now, nowCount: inNow.length, next, peak: Math.max(...hours.map(x => x.n)) };
}

const span = (h) => { const { start, end, overnight } = h; return [start, overnight || end <= start ? end + 1440 : end]; };
const merge = (iv) => { const s = iv.filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0]), o = []; for (const x of s) { const l = o[o.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else o.push([x[0], x[1]]); } return o; };
/**
 * How much of YOUR shift each colleague shares. Evening or late-day staff who are with you for most of your shift count as with you, in proportion.
 * mine: entry (shift.hours); others: entries. → { me:[start,end], rows:[{entry,start,end,overlap,pct,from,to}], alone:[[a,b]] (stretches of your shift with nobody else), covered:minutes, axis:[a,b] }
 */
export function overlapModel(mine, others) {
  if (!mine?.shift?.hours) return null; const me = span(mine.shift.hours), len = me[1] - me[0];
  const rows = others.filter(e => e.shift?.hours).map(e => { const [s, en] = span(e.shift.hours), a = Math.max(s, me[0]), b = Math.min(en, me[1]), ov = Math.max(0, b - a);
    return { entry: e, start: s, end: en, overlap: ov, pct: len ? ov / len : 0, from: ov ? a : null, to: ov ? b : null }; })
    .filter(r => r.overlap > 0).sort((a, b) => b.overlap - a.overlap || a.start - b.start);
  const cov = merge(rows.map(r => [r.from, r.to])), alone = []; let cur = me[0];
  for (const [a, b] of cov) { if (a > cur) alone.push([cur, a]); cur = Math.max(cur, b); } if (cur < me[1]) alone.push([cur, me[1]]);
  const covered = len - alone.reduce((t, [a, b]) => t + (b - a), 0);
  const axis = [Math.floor(Math.min(me[0], ...rows.map(r => r.start)) / 60) * 60, Math.ceil(Math.max(me[1], ...rows.map(r => r.end)) / 60) * 60];
  return { me, len, rows, alone, covered, axis };
}
