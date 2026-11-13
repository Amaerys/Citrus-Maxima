// Checks a backup / restored state before it replaces this device's copy. Pure (no DOM, no storage).
// A file that parses as JSON can still blank every tab (beta T09-02, T10-11): `{"rotas":{"x":{"people":"no"}}}` passed the old `!j.rotas` test.
// The rules mirror store.js load() and go one level deeper, so whatever survives here also survives a reload.

// collections that are maps id → record
const MAPS = ['rotas', 'plan', 'prefs', 'notes', 'swaps', 'deleted', 'apps', 'tasks', 'aims', 'habits', 'habitLog', 'reflections', 'resolutions', 'yearMeta', 'metricLog', 'inboxLog', 'media', 'mediaMeta', 'memos', 'reminders', 'friends', 'outings', 'chores', 'posts', 'contacts', 'jobs', 'offers', 'polls', 'wishlist', 'treats', 'dayLog', 'study', 'studyLog', 'rotaChanges'];
// maps whose values are not one record per key (notes: dateKey → text, deleted: key → time, mediaMeta: a settings object)
const SCALAR_MAPS = new Set(['notes', 'deleted', 'prefs', 'mediaMeta', 'yearMeta']);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const LABEL = { gp: 'GP', fsed: 'FSED', uv: 'Upper Village', lv: 'Lower Village', nurse: 'Nurses' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function goodRota(r) {
  return isObj(r) && Array.isArray(r.people) && isObj(r.legend) && Number.isInteger(+r.year) && +r.month >= 1 && +r.month <= 12
    && r.people.every(p => isObj(p) && typeof p.name === 'string' && (p.days == null || isObj(p.days)));
}

/**
 * json: the parsed file. → { ok, error, state (cleaned copy), dropped: [what was left out], summary: { savedAt, rotas: [..], counts: {..}, me } }
 * ok is false (and state null) only when nothing usable is in it; otherwise bad records are dropped and listed.
 */
export function checkBackup(json) {
  if (!isObj(json)) return { ok: false, error: 'This is not a Citrus backup (no data in it).', state: null, dropped: [], summary: null };
  if (!isObj(json.rotas)) return { ok: false, error: 'This is not a Citrus backup: it has no rotas section.', state: null, dropped: [], summary: null };
  const s = JSON.parse(JSON.stringify(json)), dropped = [];
  for (const k of MAPS) {
    if (!(k in s)) continue;
    if (!isObj(s[k])) { dropped.push(`${k} (not a list)`); delete s[k]; continue; }
    if (SCALAR_MAPS.has(k)) continue;
    let bad = 0; for (const [id, v] of Object.entries(s[k])) if (k === 'plan' ? !Array.isArray(v) : !isObj(v)) { delete s[k][id]; bad++; }
    if (bad) dropped.push(`${bad} unreadable ${k} entr${bad > 1 ? 'ies' : 'y'}`);
  }
  for (const [id, r] of Object.entries(s.rotas)) if (!goodRota(r)) { delete s.rotas[id]; dropped.push(`rota “${String(id).slice(0, 40)}” (damaged)`); }
  for (const [k, list] of Object.entries(s.plan || {})) { const ok = list.filter(isObj); if (ok.length !== list.length) { dropped.push(`${list.length - ok.length} plan block(s) on ${k}`); s.plan[k] = ok; } }
  if ('goals' in s && !Array.isArray(s.goals)) { delete s.goals; dropped.push('goals (not a list)'); } else if (s.goals) { const g = s.goals.filter(x => isObj(x) && typeof x.name === 'string'); if (g.length !== s.goals.length) dropped.push(`${s.goals.length - g.length} goal(s)`); s.goals = g; }
  if ('outbox' in s && !Array.isArray(s.outbox)) delete s.outbox;
  if ('me' in s && s.me != null && !(isObj(s.me) && typeof s.me.name === 'string')) { delete s.me; dropped.push('“me” (unreadable)'); }
  for (const k of ['settings', 'rules', 'google']) if (k in s && !isObj(s[k])) { delete s[k]; dropped.push(`${k} (unreadable)`); }
  const rotas = Object.values(s.rotas).sort((a, b) => a.year - b.year || a.month - b.month).map(r => `${LABEL[r.unitKind] || r.unit || 'rota'} ${MON[r.month - 1]} ${r.year}`);
  const n = (k) => isObj(s[k]) ? Object.keys(s[k]).length : 0;
  const counts = { rotas: rotas.length, 'plan days': n('plan'), tasks: n('tasks'), habits: n('habits'), goals: (s.goals || []).length, friends: n('friends'), notes: n('notes'), swaps: n('swaps') };
  const known = MAPS.some(k => k in s) || 'me' in s || 'goals' in s;
  if (!known) return { ok: false, error: 'This file has none of the things Citrus saves.', state: null, dropped, summary: null };
  return { ok: true, error: '', state: s, dropped, summary: { savedAt: +s.updatedAt || 0, rotas, counts, me: s.me?.name || '' } };
}

/** One line for the preview: "4 rotas · 12 tasks · 30 plan days" (zeros left out). */
export const describeCounts = (c) => Object.entries(c || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${v === 1 ? k.replace(/s$/, '') : k}`).join(' · ') || 'nothing but settings';
