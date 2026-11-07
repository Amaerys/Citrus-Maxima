// Shift board: who is in, hour by hour, with overlapping shifts drawn as bars on one shared time axis. Pure functions (no DOM).
const HOUR = 60;
/** entries: [{ person, code, shift: { type, label, hours: { start, end, overnight } } }] → rows on one axis + coverage per hour. */
export function boardModel(entries, { nowMin = null, meKey = '', keyOf = (p) => p.name } = {}) {
  const rows = entries.filter(e => e.shift?.hours).map(e => {
    const { start, end, overnight } = e.shift.hours; let en = overnight || end <= start ? end + 1440 : end;
    return { key: keyOf(e.person), entry: e, name: e.person.name, code: e.code || '', type: e.shift.type || 'other', label: e.shift.label || '', start, end: en, me: !!meKey && keyOf(e.person) === meKey };
  }).sort((a, b) => a.start - b.start || a.end - b.end || a.name.localeCompare(b.name));
  if (!rows.length) return { rows, axisStart: 0, axisEnd: 1440, hours: [], now: null, nowCount: 0, next: null, peak: 0 };
  let axisStart = Math.floor(Math.min(...rows.map(r => r.start)) / HOUR) * HOUR, axisEnd = Math.ceil(Math.max(...rows.map(r => r.end)) / HOUR) * HOUR;
  if (axisEnd - axisStart < 720) axisEnd = axisStart + 720; axisEnd = Math.min(axisEnd, axisStart + 1800);
  const hours = []; for (let t = axisStart; t < axisEnd; t += HOUR) hours.push({ t, n: rows.filter(r => r.start < t + HOUR && r.end > t).length });
  let now = nowMin; if (now != null && now < axisStart && now + 1440 < axisEnd) now += 1440; if (now != null && (now < axisStart || now > axisEnd)) now = null;
  const inNow = now == null ? [] : rows.filter(r => r.start <= now && now < r.end);
  const edges = [...new Set(rows.flatMap(r => [r.start, r.end]))].filter(t => now != null && t > now && t < axisEnd).sort((a, b) => a - b);
  const next = edges.length ? { t: edges[0], arrive: rows.filter(r => r.start === edges[0]).length, leave: rows.filter(r => r.end === edges[0]).length } : null;
  return { rows, axisStart, axisEnd, hours, now, nowCount: inNow.length, next, peak: Math.max(...hours.map(x => x.n)) };
}
