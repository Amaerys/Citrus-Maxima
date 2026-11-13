// Work → Career: where your contracts live (summary first, tap for the full terms), key dates, and a scorecard for weighing the next job.
import { h, toast, fromKey, keyOf, pad2, MONTHS } from './util.js';
import * as C from './career.js';
import { windows } from './labor.js';
import { isNurseRota } from './model.js';
let ctx = null, openId = null, tab = 'jobs', showDeclined = false;
export function initCareer(c) { ctx = c; }
const S = () => ctx.S(), sar = (n) => `${Math.round(n).toLocaleString()} SAR`, n0 = (n) => Math.round(n).toLocaleString();
const fd = (k) => { if (!k) return ''; const d = fromKey(k); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
const my = (k) => { if (!k) return '?'; const d = fromKey(k); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
const inDays = (n) => n < 0 ? `${-n}d ago` : n === 0 ? 'today' : `in ${n}d`;
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** "2y 3m", "1 year", "5 months", "3 weeks": floor, never "12 months" or "2y 12m". */
export function durText(j, now = new Date()) {
  if (!j.start) return ''; const { y, m, d } = C.served(j, now);
  if (y) return m ? `${y}y ${m}m` : pl(y, 'year'); if (m) return pl(m, 'month');
  return d >= 7 ? pl(Math.floor(d / 7), 'week') : pl(d, 'day');
}
const stars = (n) => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : 'not rated';
const AGAIN = { yes: 'Would go back', no: 'Would not repeat', maybe: 'Maybe' };
const field = (label, ...x) => h('div', { class: 'field' }, h('label', {}, label), ...x);
const join = (...p) => p.flat().filter(Boolean).join(' · ');
const stopKey = (j) => j.left || (j.status === 'current' ? '' : j.end);
/** Not rated, then 1–5: tappable, the value is always visible. */
function ratePicker(value, onPick, label) {
  let cur = value || 0; const wrap = h('div', { class: 'cr-rate', role: 'radiogroup', 'aria-label': label });
  const draw = () => wrap.replaceChildren(...[0, 1, 2, 3, 4, 5].map(n => h('button', { type: 'button', role: 'radio', 'aria-checked': cur === n ? 'true' : 'false', class: cur === n ? 'on' : '', title: n ? `${n} of 5` : 'Not rated', onClick: () => { cur = n; onPick(n); draw(); } }, n ? String(n) : '–')));
  draw(); return wrap;
}

export function renderCareer() {
  const s = S(), jobs = C.jobList(s), seg = h('div', { class: 'seg view-mode cr-seg', role: 'tablist' }, [['jobs', 'My jobs'], ['next', 'Next job']].map(([k, l]) => h('button', { class: tab === k ? 'active' : '', role: 'tab', 'aria-selected': tab === k ? 'true' : 'false', onClick: () => { tab = k; ctx.render(); } }, l)));
  return [seg, ...(tab === 'next' ? nextJob(s, jobs) : myJobs(s, jobs))];
}

function actions(withExport) { return h('div', { class: 'cr-actions' }, h('button', { class: 'btn', onClick: () => jobSheet() }, '＋ Add a job'), importBtn(), withExport ? h('button', { class: 'btn', onClick: exportFile }, '⬇ Export') : null); }

function myJobs(s, jobs) {
  const cur = C.currentJob(s);
  if (!jobs.length) return [h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, '📄'), 'No contracts yet'), h('div', { class: 'small muted' }, 'Load the career file from your computer, or add a job by hand. It stays in your own state and Drive.'), actions(false))];
  const past = jobs.filter(j => j !== cur && !j.postingOf), left = [], right = [];
  if (cur) left.push(summaryCard(s, cur));
  const line = timeline(jobs.filter(j => !j.postingOf), cur); if (line) (cur ? right : left).push(line);
  for (const j of past) right.push(pastCard(s, j));
  // Postings whose parent job is gone still show, so nothing is hidden.
  const orphans = jobs.filter(j => j.postingOf && !s.jobs?.[j.postingOf]); if (orphans.length) right.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Postings'), orphans.map(postingBlock)));
  right.push(actions(true));
  return [h('div', { class: `cr-wrap ${left.length && right.length ? 'two' : ''}` }, left.length ? h('div', { class: 'cr-col' }, ...left) : null, h('div', { class: 'cr-col' }, ...right))];
}

/** Proportional bar of your working life: each job is as wide as it lasted, gaps show as gaps. Tap a job to jump to its card. */
function timeline(list, cur) {
  const rows = list.filter(j => j.start).map(j => ({ j, a: fromKey(j.start), b: C.servedTo(j) })).filter(r => r.b > r.a).sort((x, y) => x.a - y.a);
  if (rows.length < 2 && !(rows.length && rows[0].j !== cur)) return null;
  const first = rows[0].a, last = rows.reduce((m, r) => r.b > m ? r.b : m, rows[0].b), span = (last - first) || 1, segs = []; let at = first;
  for (const r of rows) { const a = r.a > at ? r.a : at; if (a > at) segs.push(h('span', { class: 'cr-gap', style: { flexGrow: String((a - at) / span * 1000) }, title: 'Gap' })); if (r.b > a) segs.push(h('button', { class: `cr-seg-j ${r.j === cur ? 'now' : ''} ${r.j.again === 'no' ? 'no' : ''}`, style: { flexGrow: String((r.b - a) / span * 1000) }, title: `${r.j.employer} · ${my(r.j.start)} → ${r.j === cur ? 'now' : my(stopKey(r.j))}`, 'aria-label': `${r.j.employer}, ${durText(r.j)}`, onClick: () => jump(r.j.id) }, h('b', {}, r.j.employer))); if (r.b > at) at = r.b; }
  return h('div', { class: 'card cr-hist' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Work history'), h('span', { class: 'tiny dim' }, `${first.getFullYear()} → ${cur ? 'now' : last.getFullYear()}`)), h('div', { class: 'cr-tl' }, ...segs),
    h('div', { class: 'cr-tl-legend' }, rows.map(r => h('button', { class: 'cr-tl-item', onClick: () => jump(r.j.id) }, h('i', { class: r.j === cur ? 'now' : r.j.again === 'no' ? 'no' : '' }), h('b', {}, r.j.employer), h('small', {}, join(`${my(r.j.start)} → ${r.j === cur ? 'now' : my(stopKey(r.j))}`, durText(r.j)))))));
}
function jump(id) { openId = id; ctx.render(); requestAnimationFrame(() => document.getElementById(`cr-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }

/** Hours I was rostered per loaded month (my own shifts in the doctors' rotas), from the job's start on. */
export function rosterHours(s, j) {
  const months = [...new Set(Object.values(s.rotas || {}).filter(r => !isNurseRota(r) && r.year && r.month).map(r => `${r.year}-${pad2(r.month)}`))].sort(), out = [];
  for (const mk of months) {
    if (j.start && mk < j.start.slice(0, 7)) continue; const [y, m] = mk.split('-').map(Number), a = new Date(y, m - 1, 1), b = new Date(y, m, 1);
    let ms = 0; try { for (const w of windows(s, a, b)) ms += Math.max(0, Math.min(+w.end, +b) - Math.max(+w.start, +a)); } catch { continue; }
    if (ms > 0) out.push({ key: mk, label: `${MONTHS[m - 1].slice(0, 3)} ${y}`, hours: Math.round(ms / 36e5 * 10) / 10 });
  }
  return out;
}

function summaryCard(s, j) {
  const e = C.endOfService(j), keys = C.keyDates(j).filter(k => k.id !== 'trial'), fl = C.flags(j), open = openId === j.id, ot = C.overtime(j), step = C.nextStep(j), real = C.realHourly(j, rosterHours(s, j)).slice(-2);
  return h('div', { class: 'card cr-now', id: `cr-${j.id}` },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, 'Current job'), h('b', { class: 'cr-emp' }, j.employer), h('div', { class: 'small muted' }, join(j.role, j.city, j.start ? `since ${fd(j.start)}` : ''))), h('span', { class: 'chip sel' }, durText(j))),
    h('div', { class: 'cr-grid' }, [[n0(C.total(j)), 'SAR a month'], [n0(j.basic), 'SAR basic'], [`${C.hourly(j)}`, 'SAR per contract hour'], [`${j.hoursWeek}h`, 'a week'], [`${j.leave}d`, 'annual leave'], [`${ot.full}`, 'SAR per OT hour']].map(([n, l]) => h('div', {}, h('b', {}, n), h('small', {}, l)))),
    h('div', { class: 'cr-eos', role: 'group', 'aria-label': 'End-of-service so far' },
      h('div', { class: 'cr-eos-h' }, h('span', {}, 'End-of-service so far'), h('small', {}, `${e.years.toFixed(2)} years · ${e.months.toFixed(2)} months' wage`)),
      h('div', { class: 'cr-eos-row' },
        h('div', { class: `cr-eos-v ${e.resignFactor ? '' : 'zero'}` }, h('small', {}, 'If you resign'), h('b', {}, sar(e.resignOnTotal)), h('small', {}, `${Math.round(e.resignFactor * 100)} % · Art. 85`)),
        h('div', { class: 'cr-eos-v full' }, h('small', {}, 'If they end it / the term runs out'), h('b', {}, sar(e.onTotal)), h('small', {}, '100 % · Art. 84'))),
      step ? h('div', { class: 'cr-step' }, h('b', {}, fd(step.date)), ` (${inDays(step.days)}): ${step.years} years, ${step.msg}.`) : null),
    real.length ? h('div', { class: 'cr-real' }, real.map(r => h('div', {}, h('span', {}, `${r.label} rota`), h('b', {}, `${r.perHour} SAR/h`), h('small', {}, `${r.hours}h rostered vs ≈${r.contractH}h in the contract${r.overH > 0 ? ` (+${r.overH}h)` : ''}`)))) : null,
    keys.length ? h('div', { class: 'cr-keys' }, keys.map(k => h('div', { class: `cr-key ${k.days < 0 ? 'past' : k.days <= 90 ? 'soon' : ''}` }, h('div', { class: 'grow' }, h('b', {}, k.label), k.why ? h('div', { class: 'tiny dim' }, k.why) : null), h('div', { class: 'cr-when' }, fd(k.date), h('small', {}, inDays(k.days)))))) : null,
    fl.map(f => h('div', { class: `lw-flag ${f.level === 'violation' ? 'bad' : f.level === 'warn' ? 'warn' : ''}` }, f.msg)),
    C.postingsOf(s, j.id).map(postingBlock),
    h('div', { class: 'row wrap cr-btns' }, h('button', { class: 'btn sm grow', 'aria-expanded': open ? 'true' : 'false', onClick: () => { openId = open ? null : j.id; ctx.render(); } }, open ? 'Hide full terms' : 'Full terms'), h('button', { class: 'btn sm ghost', onClick: () => jobSheet(j) }, '✎ Edit')),
    open ? details(j, e) : null);
}

function details(j, e) {
  const row = (k, v) => v ? h('div', { class: 'cr-row' }, h('span', {}, k), h('b', {}, v)) : null, ot = C.overtime(j), term = C.currentTerm(j);
  return h('div', { class: 'cr-det' },
    row('Contract', j.contractId ? join(`#${j.contractId}`, j.signed ? 'signed ' + fd(j.signed) : '') : ''), row('Work site', j.site),
    row('Term', j.start ? join(`${fd(j.start)} → ${fd(j.end) || 'open-ended'}`, j.end ? (j.renews ? 'renews' : 'does not renew') : '', term?.renewals ? `now ${fd(term.start)} → ${fd(term.end)}` : '') : ''), row('Left on', fd(j.left)),
    row('Trial period', j.trialDays ? `${j.trialDays} days` : ''), row('Hours', `${j.hoursWeek}h a week${j.daysWeek ? ` (${j.daysWeek} days)` : ''}`),
    row('Basic', sar(j.basic)), row('Housing', j.housing ? sar(j.housing) : ''), row('Transport', j.transport ? sar(j.transport) : j.transportProvided ? 'Provided' : ''), row('Other allowance', j.other ? sar(j.other) : ''), row('Total', sar(C.total(j))),
    row('Overtime (Art. 107)', `${ot.full} SAR an hour: hourly wage ${ot.hourlyWage} + 50 % of basic hourly ${ot.basicHourly} (÷240). On basic alone: ${ot.basicOnly}`),
    row('Annual leave', `${j.leave} calendar days a year`),
    row('End-of-service', `Half a month per year for the first 5 years, a full month per year after, parts of a year pro rata (Art. 84). ${e.years.toFixed(2)} years so far: ${sar(e.onTotal)} on the full package (${sar(e.onBasic)} if figured on basic). Resigning pays ${Math.round(e.resignFactor * 100)} % (${sar(e.resignOnTotal)}). The full award is also due if you leave under Art. 81, or under Art. 87 (force majeure; a woman within 6 months of marriage or 3 months of giving birth).`),
    row('Qiwa', j.qiwa), row('Iqama expires', fd(j.iqamaExpiry)),
    j.terms?.length ? h('div', { class: 'cr-terms' }, h('div', { class: 'tiny dim' }, 'Worth knowing'), h('ul', {}, j.terms.map(t => h('li', {}, t)))) : null, j.notes ? h('div', { class: 'small', style: { marginTop: '8px' } }, j.notes) : null);
}

function pastCard(s, j) {
  const open = openId === j.id, e = C.endOfService(j), posts = C.postingsOf(s, j.id), stop = stopKey(j);
  return h('div', { class: `card cr-past ${open ? 'open' : ''}`, id: `cr-${j.id}` }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, j.employer), h('div', { class: 'small muted' }, join(j.start ? `${fd(j.start)} → ${stop ? fd(stop) : '?'}` : '', durText(j), j.role, j.city))), j.again ? h('span', { class: `chip ${j.again === 'no' ? 'pull' : ''}` }, AGAIN[j.again]) : null),
    h('div', { class: 'small' }, join(`${sar(C.total(j))} a month`, `${j.leave}d leave`, `${j.hoursWeek}h`, stars(j.rating))), j.reasonLeft ? h('div', { class: 'small muted', style: { marginTop: '4px' } }, `Left: ${j.reasonLeft}`) : null, aspectChips(j).length ? h('div', { class: 'chips', style: { marginTop: '6px' } }, ...aspectChips(j)) : null,
    h('div', { class: 'row wrap cr-btns' }, h('button', { class: 'btn sm grow', 'aria-expanded': open ? 'true' : 'false', onClick: () => { openId = open ? null : j.id; ctx.render(); } }, open ? 'Hide' : 'Full terms'), h('button', { class: 'btn sm ghost', onClick: () => jobSheet(j) }, '✎ Edit')), open ? details(j, e) : null, posts.map(postingBlock));
}
const aspectChips = (j) => C.ASPECTS.filter(([k]) => j.aspects?.[k]).map(([k, l]) => h('span', { class: `chip ${j.aspects[k] <= 2 ? 'pull' : ''}` }, `${l} ${j.aspects[k]}/5`));
function postingBlock(p) {
  const where = join(p.site, p.city) || p.employer, when = join(p.start ? `${fd(p.start)}${stopKey(p) ? ' → ' + fd(stopKey(p)) : ''}` : '', p.weeks ? (p.weeks < 5 ? 'about a month' : `about ${p.weeks} weeks`) : '');
  return h('div', { class: 'cr-post' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', { class: 'tiny dim' }, 'Posting'), h('b', { style: { display: 'block' } }, where)), h('button', { class: 'btn sm ghost', 'aria-label': `Edit posting ${where}`, onClick: () => jobSheet(p) }, '✎')), when ? h('div', { class: 'small muted' }, when) : null, aspectChips(p).length ? h('div', { class: 'chips', style: { margin: '6px 0' } }, ...aspectChips(p)) : null, p.notes ? h('div', { class: 'small' }, p.notes) : null);
}

function jobSheet(j) {
  const v = { ...(j || { status: 'past', hoursWeek: 48, leave: 21, trialDays: 90, renews: true, renewNoticeDays: C.RENEW_NOTICE }), aspects: { ...(j?.aspects || {}) }, terms: (j?.terms || []).join('\n') };
  const I = (k, o = {}) => h('input', { value: v[k] ?? '', ...o, onInput: (e) => { v[k] = o.type === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value; } });
  const err = h('div', { class: 'cr-err', role: 'alert' });
  const save = () => {
    const problems = C.jobErrors(v); if (problems.length) { err.textContent = problems.join('. '); return toast(problems[0], 'err'); }
    const before = S(); ctx.update(s => C.saveJob(s, v)); const after = S();
    const moved = Object.values(before.jobs || {}).filter(o => o.status === 'current' && after.jobs?.[o.id]?.status === 'past' && o.id !== v.id);
    if (moved.length) toast(`${moved.map(o => o.employer).join(', ')} moved to past jobs${moved[0] && after.jobs[moved[0].id].left ? `, left ${fd(after.jobs[moved[0].id].left)}` : ''}. Edit it if that date is wrong`);
    box.close(); ctx.render();
  };
  const box = ctx.sheet([h('h2', {}, j ? (j.postingOf ? 'Edit posting' : 'Edit job') : 'Add a job'), field('Employer', I('employer')), h('div', { class: 'row wrap cr-fields' }, field('Role', I('role')), field('City', I('city'))), field('Work site (if different)', I('site')),
    h('div', { class: 'row wrap cr-fields' }, field('Start', I('start', { type: 'date' })), field('Contract ends', I('end', { type: 'date' })), field('Left on (if you left)', I('left', { type: 'date' }))),
    h('div', { class: 'row wrap cr-fields' }, field('Basic', I('basic', { type: 'number', inputmode: 'numeric', min: 0 })), field('Housing', I('housing', { type: 'number', inputmode: 'numeric', min: 0 })), field('Transport', I('transport', { type: 'number', inputmode: 'numeric', min: 0 })), field('Other', I('other', { type: 'number', inputmode: 'numeric', min: 0 }))),
    h('div', { class: 'row wrap cr-fields' }, field('Hours a week', I('hoursWeek', { type: 'number', min: 0, max: 168 })), field('Leave days', I('leave', { type: 'number', min: 0 })), field('Status', h('select', { onChange: (e) => { v.status = e.target.value; } }, ['current', 'past'].map(x => h('option', { value: x, selected: v.status === x }, x === 'current' ? 'Current job' : 'Past job'))))),
    h('details', { class: 'cr-more' }, h('summary', {}, 'Contract details'),
      h('label', { class: 'cr-check' }, h('input', { type: 'checkbox', checked: v.renews !== false, onChange: (e) => { v.renews = e.target.checked; } }), 'Renews automatically at the end of the term'),
      h('div', { class: 'row wrap cr-fields' }, field('Notice not to renew (days before the end)', I('renewNoticeDays', { type: 'number', min: 0 })), field('Trial period (days)', I('trialDays', { type: 'number', min: 0 })), field('Days a week', I('daysWeek', { type: 'number', min: 0, max: 7 }))),
      h('div', { class: 'row wrap cr-fields' }, field('Contract #', I('contractId')), field('Signed on', I('signed', { type: 'date' })), field('Iqama expires', I('iqamaExpiry', { type: 'date' })), field('Qiwa status', I('qiwa', { placeholder: 'e.g. Approved' }))),
      h('label', { class: 'cr-check' }, h('input', { type: 'checkbox', checked: !!v.transportProvided, onChange: (e) => { v.transportProvided = e.target.checked; } }), 'Transport provided'),
      field('Terms worth knowing (one per line)', h('textarea', { rows: 3, onInput: (e) => { v.terms = e.target.value; } }, v.terms))),
    h('details', { class: 'cr-more' }, h('summary', {}, 'How was it?'),
      field('Would you go back?', h('select', { onChange: (e) => { v.again = e.target.value; } }, [['', 'Not sure'], ['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']].map(([k, l]) => h('option', { value: k, selected: (v.again || '') === k }, l)))),
      field('Overall rating', ratePicker(v.rating, (n) => { v.rating = n; }, 'Overall rating')), field('Why you left', I('reasonLeft')),
      ...C.ASPECTS.map(([k, l]) => field(l, ratePicker(v.aspects[k], (n) => { v.aspects[k] = n; }, l)))),
    field('Notes', h('textarea', { rows: 3, onInput: (e) => { v.notes = e.target.value; } }, v.notes || '')), err,
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: save }, 'Save'), j ? h('button', { class: 'btn danger', onClick: () => { if (confirm('Delete this job?')) { ctx.update(s => C.deleteJob(s, j.id)); box.close(); ctx.render(); } } }, 'Delete') : null)]);
}

// ───────── next job
function nextJob(s, jobs) {
  const cur = C.currentJob(s), ref = cur || jobs.filter(j => !j.postingOf).sort((a, b) => C.hourly(b) - C.hourly(a))[0] || null, offers = C.offerList(s), left = [], right = [];
  const lessons = jobs.filter(j => j.again === 'no' || j.notes && j.again || C.ASPECTS.some(([k]) => j.aspects?.[k] && j.aspects[k] <= 2) || j.reasonLeft && j.again);
  left.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Deciding your next job'), h('div', { class: 'small muted' }, `Add an offer and rate how it feels. It is scored against ${cur ? 'what you earn now' : ref ? 'your best past job' : 'a 40 SAR/h reference'}: pay per hour actually worked (benefits included), hours, leave, and the things money does not show.`)));
  if (cur) left.push(h('div', { class: 'card cr-ctx' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `Now: ${cur.employer}`), h('span', { class: 'small muted' }, join(sar(C.total(cur)), `${C.hourly(cur)}/h`, `${cur.leave}d`, `${cur.hoursWeek}h`))),
    C.compareContext(cur).map(c => h('div', { class: 'small cr-ctx-l' }, c.text.replace('{date}', fd(c.date))))));
  if (lessons.length) left.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Lessons from your past jobs'), lessons.map(j => { const head = j.postingOf ? `${j.employer} (posting: ${join(j.site, j.city)})` : j.employer, poor = C.ASPECTS.filter(([k]) => j.aspects?.[k] && j.aspects[k] <= 2).map(([, l]) => 'poor ' + l.toLowerCase()); return h('div', { class: 'small cr-lesson' }, h('b', {}, head), ' ', join(AGAIN[j.again], poor, j.reasonLeft, j.notes)); }), h('div', { class: 'tiny dim' }, 'Check every new offer against these before you say yes.')));
  const rows = offers.map(o => ({ o, r: C.scoreOffer(o, ref) })).sort((a, b) => b.r.score - a.r.score), live = rows.filter(x => x.o.status !== 'declined'), declined = rows.filter(x => x.o.status === 'declined');
  live.forEach((x, i) => right.push(offerCard(x, cur, i + 1)));
  if (!live.length) right.push(h('div', { class: 'card empty' }, offers.length ? 'No open offers' : 'No offers yet'));
  if (declined.length) right.push(h('div', { class: 'card cr-declined' }, h('button', { class: 'cr-dtoggle', 'aria-expanded': showDeclined ? 'true' : 'false', onClick: () => { showDeclined = !showDeclined; ctx.render(); } }, h('span', { class: 'grow' }, `Declined (${declined.length})`), h('span', {}, showDeclined ? '▴' : '▾')),
    showDeclined ? declined.map(({ o, r }) => h('div', { class: 'cr-drow' }, h('span', { class: 'grow' }, join(o.employer, o.role)), h('span', { class: 'small muted' }, `${sar(r.total)} · ${r.score}/100`), h('button', { class: 'btn sm ghost', 'aria-label': `Edit ${o.employer}`, onClick: () => offerSheet(o) }, '✎'))) : null));
  right.push(h('button', { class: 'btn primary cr-add', onClick: () => offerSheet() }, '＋ Add an offer'));
  return [h('div', { class: 'cr-wrap two' }, h('div', { class: 'cr-col' }, ...left), h('div', { class: 'cr-col' }, ...right))];
}
function offerCard({ o, r }, cur, rank) {
  return h('div', { class: `card cr-offer of-${o.status}` }, h('div', { class: 'row' }, h('span', { class: 'cr-rank' }, `#${rank}`), h('div', { class: 'grow' }, h('b', {}, o.employer), h('div', { class: 'small muted' }, join(o.role, o.city, o.status === 'accepted' ? 'accepted' : '', `${o.years}y contract`))), h('div', { class: 'of-score' }, h('b', {}, r.score), h('small', {}, '/100'))),
    h('div', { class: 'small' }, join(`${sar(r.total)} a month${r.value.value !== r.cash ? ` (${n0(r.cash)} cash)` : ''}`, `${r.hourly} SAR/h`, `${o.leave}d leave`, `${o.hoursWeek}h`)),
    h('div', { class: 'cr-bars' }, Object.entries(C.WEIGHTS).map(([k, w]) => h('span', { title: `${k}: ${Math.round(r.part[k] * 100)} % (weight ${w})`, style: { flexGrow: String(w), '--p': `${Math.round(r.part[k] * 100)}%` } }))),
    C.compare(o, cur).map(t => h('div', { class: 'tiny dim' }, t)),
    h('div', { class: 'row wrap', style: { marginTop: '6px' } }, h('button', { class: 'btn sm ghost', onClick: () => offerSheet(o) }, '✎ Edit')));
}
function offerSheet(o) {
  const v = { ...(o || { hoursWeek: 48, leave: 21, years: 1, status: 'considering' }), feel: { ...(o?.feel || {}) } }, I = (k, p = {}) => h('input', { value: v[k] ?? '', ...p, onInput: (e) => { v[k] = p.type === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value; } });
  const extra = h('div', { class: 'row wrap cr-fields' }), cur = C.currentJob(S());
  const drawExtra = () => extra.replaceChildren(...[v.housed ? field('Housing worth (SAR a month)', I('housedValue', { type: 'number', min: 0, placeholder: String(cur?.housing || Math.round((+v.basic || 0) * C.HOUSING_SHARE)) })) : null, v.ticket ? field('Ticket worth (SAR a year)', I('ticketValue', { type: 'number', min: 0 })) : null, v.insurance ? field('Insurance worth (SAR a year)', I('insuranceValue', { type: 'number', min: 0 })) : null].filter(Boolean));
  drawExtra();
  const box = ctx.sheet([h('h2', {}, o ? 'Edit offer' : 'Add an offer'), field('Employer', I('employer')), h('div', { class: 'row wrap cr-fields' }, field('Role', I('role')), field('City', I('city'))),
    h('div', { class: 'row wrap cr-fields' }, field('Basic', I('basic', { type: 'number', inputmode: 'numeric', min: 0 })), field('Housing', I('housing', { type: 'number', inputmode: 'numeric', min: 0 })), field('Transport', I('transport', { type: 'number', inputmode: 'numeric', min: 0 })), field('Other', I('other', { type: 'number', inputmode: 'numeric', min: 0 }))),
    h('div', { class: 'row wrap cr-fields' }, field('Hours a week', I('hoursWeek', { type: 'number', min: 0 })), field('Leave days', I('leave', { type: 'number', min: 0 })), field('Contract years', I('years', { type: 'number', min: 1 }))),
    h('div', { class: 'chips' }, [['ticket', 'Annual flight ticket'], ['insurance', 'Family insurance'], ['housed', 'Housing provided']].map(([k, l]) => h('button', { type: 'button', class: `chip ${v[k] ? 'sel' : ''}`, 'aria-pressed': v[k] ? 'true' : 'false', onClick: (e) => { v[k] = !v[k]; e.currentTarget.classList.toggle('sel', v[k]); e.currentTarget.setAttribute('aria-pressed', v[k] ? 'true' : 'false'); drawExtra(); } }, l))), extra,
    h('div', { class: 'title', style: { marginTop: '10px' } }, 'How does it feel?'), h('div', { class: 'tiny dim', style: { marginBottom: '6px' } }, '1 = awful, 5 = great, – = not rated yet (counts as 3)'), ...C.FEELS.map(([k, l]) => field(l, ratePicker(v.feel[k], (n) => { v.feel[k] = n; }, l))),
    field('Status', h('select', { onChange: (e) => { v.status = e.target.value; } }, ['considering', 'declined', 'accepted'].map(x => h('option', { value: x, selected: v.status === x }, x)))), field('Notes', h('textarea', { rows: 3, onInput: (e) => { v.notes = e.target.value; } }, v.notes || '')),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => { if (!String(v.employer || '').trim()) return toast('Add the employer', 'err'); ctx.update(s => C.saveOffer(s, v)); box.close(); ctx.render(); } }, 'Save'), o ? h('button', { class: 'btn danger', onClick: () => { if (confirm('Delete this offer?')) { ctx.update(s => C.deleteOffer(s, o.id)); box.close(); ctx.render(); } } }, 'Delete') : null)]);
}

// ───────── file in / out (keeps salary details out of the code: you load them once, then they sync with your Drive state)
function importBtn() {
  const f = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; let d;
    try { d = JSON.parse(await file.text()); } catch { return toast('That file is not JSON', 'err'); }
    try { let res; ctx.update(s => { res = C.importCareer(s, d); return res.state; }); const c = res.counts; toast(`Loaded ${C.importSummary(c) || 'nothing new'}${c.demoted.length ? `. ${c.demoted.map(o => o.employer).join(', ')} moved to past jobs` : ''}`); ctx.render(); }
    catch { toast('That is not a career file: it needs jobs, offers or labor', 'err'); }
  } });
  return [f, h('button', { class: 'btn', onClick: () => f.click() }, '⬆ Load career file')];
}
function exportFile() { const blob = new Blob([JSON.stringify(C.exportData(S()), null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `career-${keyOf(new Date())}.json` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

/** Today: only when a contract date is close. */
export function todayCard() {
  const cur = C.currentJob(S()); if (!cur) return null; const u = C.upcoming(cur, new Date(), 90); if (!u.length) return null;
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Contract dates'), u.map(k => h('div', { class: 'small' }, `${k.label}: ${fd(k.date)} (${k.days === 0 ? 'today' : `in ${pl(k.days, 'day')}`})`)), h('button', { class: 'btn sm ghost', onClick: () => { ctx.go('rota', 'career'); } }, 'Open Career'));
}
