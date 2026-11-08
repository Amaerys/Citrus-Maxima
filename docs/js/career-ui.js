// Work → Career: where your contracts live (summary first, tap for the full terms), key dates, and a scorecard for weighing the next job.
import { h, toast, fromKey, MONTHS } from './util.js';
import * as C from './career.js';
let ctx = null, openId = null, tab = 'jobs';
export function initCareer(c) { ctx = c; }
const S = () => ctx.S(), sar = (n) => `${Math.round(n).toLocaleString()} SAR`;
const fd = (k) => { if (!k) return '—'; const d = fromKey(k); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
const my = (k) => { if (!k) return '?'; const d = fromKey(k); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
const dur = (j) => { const y = C.yearsServed(j); return y >= 1 ? `${Math.floor(y)}y ${Math.round((y % 1) * 12)}m` : `${Math.max(1, Math.round(y * 12))} months`; };
const stars = (n) => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : 'not rated';
const AGAIN = { yes: 'Would go back', no: 'Would not repeat', maybe: 'Maybe' };
const field = (label, ...x) => h('div', { class: 'field' }, h('label', {}, label), ...x);

export function renderCareer() {
  const s = S(), jobs = C.jobList(s), seg = h('div', { class: 'seg view-mode', role: 'tablist', style: { marginBottom: '10px' } }, [['jobs', 'My jobs'], ['next', 'Next job']].map(([k, l]) => h('button', { class: tab === k ? 'active' : '', role: 'tab', onClick: () => { tab = k; ctx.render(); } }, l)));
  return [seg, ...(tab === 'next' ? nextJob(s, jobs) : myJobs(s, jobs))];
}

function myJobs(s, jobs) {
  const out = [], cur = C.currentJob(s);
  if (!jobs.length) return [h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, '📄'), 'No contracts yet'), h('div', { class: 'small muted' }, 'Load the career file from your computer, or add a job by hand. It stays in your own state and Drive.'), h('div', { class: 'row wrap', style: { marginTop: '10px' } }, importBtn(), h('button', { class: 'btn grow', onClick: () => jobSheet() }, '＋ Add a job')))];
  if (cur) out.push(summaryCard(cur));
  const past = jobs.filter(j => j !== cur && !j.postingOf);
  if (past.length) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Work history'), h('div', { class: 'cr-line' }, ...[...jobs].reverse().filter(j => !j.postingOf).map(j => h('button', { class: `cr-node ${j === cur ? 'now' : ''}`, onClick: () => { openId = j.id; ctx.render(); } }, h('b', {}, j.employer), h('small', {}, `${my(j.start)} → ${j.left ? my(j.left) : j === cur ? 'now' : my(j.end)}`), h('small', {}, `${sar(C.total(j))} · ${stars(j.rating)}`))))));
  for (const j of past) out.push(pastCard(j));
  out.push(h('div', { class: 'row wrap' }, h('button', { class: 'btn grow', onClick: () => jobSheet() }, '＋ Add a job'), importBtn(), h('button', { class: 'btn grow', onClick: exportFile }, '⬇ Export')));
  return out;
}

function summaryCard(j) {
  const e = C.endOfService(j), keys = C.keyDates(j).filter(k => k.id !== 'trial'), fl = C.flags(j), open = openId === j.id;
  return h('div', { class: 'card cr-now' },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, 'Current job'), h('b', {}, j.employer), h('div', { class: 'small muted' }, [j.role, j.city].filter(Boolean).join(' · '))), h('span', { class: 'chip sel' }, dur(j))),
    h('div', { class: 'cr-grid' }, [[sar(C.total(j)), 'monthly package'], [sar(j.basic), 'basic'], [`${j.leave}d`, 'annual leave'], [`${j.hoursWeek}h`, 'a week'], [`${C.hourly(j)}`, 'SAR per hour worked'], [sar(e.onTotal), 'end-of-service so far']].map(([n, l]) => h('div', {}, h('b', {}, n), h('small', {}, l)))),
    keys.map(k => h('div', { class: `cr-key ${k.days < 0 ? 'past' : k.days <= 90 ? 'soon' : ''}` }, h('div', { class: 'grow' }, h('b', {}, k.label), k.why ? h('div', { class: 'tiny dim' }, k.why) : null), h('div', { class: 'cr-when' }, fd(k.date), h('small', {}, k.days < 0 ? `${-k.days}d ago` : k.days === 0 ? 'today' : `in ${k.days}d`)))),
    fl.map(f => h('div', { class: `lw-flag ${f.level === 'violation' ? 'bad' : f.level === 'warn' ? 'warn' : ''}` }, f.msg)),
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('button', { class: 'btn sm grow', onClick: () => { openId = open ? null : j.id; ctx.render(); } }, open ? 'Hide full terms' : 'Full terms'), h('button', { class: 'btn sm ghost', onClick: () => jobSheet(j) }, '✎ Edit')),
    open ? details(j, e) : null);
}

function details(j, e) {
  const row = (k, v) => v ? h('div', { class: 'cr-row' }, h('span', {}, k), h('b', {}, v)) : null;
  return h('div', { class: 'cr-det' },
    row('Contract', j.contractId ? `#${j.contractId}${j.signed ? ' · signed ' + fd(j.signed) : ''}` : ''), row('Work site', j.site), row('Term', `${fd(j.start)} → ${fd(j.end)}${j.renews ? ' · renews' : ''}`), row('Trial period', j.trialDays ? `${j.trialDays} days` : ''), row('Hours', `${j.hoursWeek}h a week${j.daysWeek ? ` (${j.daysWeek} days)` : ''}`),
    row('Basic', sar(j.basic)), row('Housing', j.housing ? sar(j.housing) : ''), row('Transport', j.transport ? sar(j.transport) : j.transportProvided ? 'Provided' : ''), row('Other allowance', j.other ? sar(j.other) : ''), row('Total', sar(C.total(j))), row('Overtime', `${C.overtimeRate(j)} SAR per hour (hourly wage + 50 % of basic)`),
    row('Annual leave', `${j.leave} calendar days a year`), row('End-of-service', `half a month per year for 5 years, a month after. So far ${sar(e.onTotal)} on the full package, ${sar(e.onBasic)} on basic. Resigning pays ${Math.round(e.resignFactor * 100)} %.`), row('Qiwa', j.qiwa),
    j.terms?.length ? h('div', { class: 'cr-terms' }, h('div', { class: 'tiny dim' }, 'Worth knowing'), h('ul', {}, j.terms.map(t => h('li', {}, t)))) : null, j.notes ? h('div', { class: 'small', style: { marginTop: '8px' } }, j.notes) : null);
}

function pastCard(j) {
  const open = openId === j.id, e = C.endOfService(j), posts = C.jobList(S()).filter(x => x.postingOf === j.id);
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, j.employer), h('div', { class: 'small muted' }, `${fd(j.start)} → ${j.left ? fd(j.left) : fd(j.end)} · ${dur(j)} · ${j.city || ''}`)), j.again ? h('span', { class: `chip ${j.again === 'no' ? 'pull' : ''}` }, AGAIN[j.again]) : null),
    h('div', { class: 'small' }, `${sar(C.total(j))} a month · ${j.leave}d leave · ${j.hoursWeek}h · ${stars(j.rating)}`), j.reasonLeft ? h('div', { class: 'small muted', style: { marginTop: '4px' } }, `Left: ${j.reasonLeft}`) : null, h('div', { class: 'chips', style: { marginTop: '6px' } }, ...aspectChips(j)),
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('button', { class: 'btn sm grow', onClick: () => { openId = open ? null : j.id; ctx.render(); } }, open ? 'Hide' : 'Full terms'), h('button', { class: 'btn sm ghost', onClick: () => jobSheet(j) }, '✎ Edit')), open ? details(j, e) : null, posts.map(postingBlock));
}
const aspectChips = (j) => C.ASPECTS.filter(([k]) => j.aspects?.[k]).map(([k, l]) => h('span', { class: `chip ${j.aspects[k] <= 2 ? 'pull' : ''}` }, `${l} ${j.aspects[k]}/5`));
function postingBlock(p) { return h('div', { class: 'cr-post' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `Posting: ${p.site || p.city}`), h('button', { class: 'btn sm ghost', onClick: () => jobSheet(p) }, '✎')), h('div', { class: 'small muted' }, `${p.weeks ? `about ${p.weeks < 5 ? 'a month' : p.weeks + ' weeks'}` : ''} · ${p.city}`), h('div', { class: 'chips', style: { margin: '6px 0' } }, ...aspectChips(p)), p.notes ? h('div', { class: 'small' }, p.notes) : null); }

function jobSheet(j) {
  const v = { ...(j || { status: 'past', hoursWeek: 48, leave: 21, trialDays: 90, renews: true }) }, I = (k, o = {}) => h('input', { value: v[k] ?? '', ...o, onInput: (e) => { v[k] = o.type === 'number' ? +e.target.value : e.target.value; } });
  const box = ctx.sheet([h('h2', {}, j ? 'Edit job' : 'Add a job'), field('Employer', I('employer')), field('Role', I('role')), field('City', I('city')), field('Work site (if different)', I('site')),
    h('div', { class: 'row wrap' }, field('Start', I('start', { type: 'date' })), field('Contract ends', I('end', { type: 'date' })), field('Left on (if you left)', I('left', { type: 'date' }))),
    h('div', { class: 'row wrap' }, field('Basic', I('basic', { type: 'number', inputmode: 'numeric' })), field('Housing', I('housing', { type: 'number' })), field('Transport', I('transport', { type: 'number' })), field('Other', I('other', { type: 'number' }))),
    h('div', { class: 'row wrap' }, field('Hours a week', I('hoursWeek', { type: 'number' })), field('Leave days', I('leave', { type: 'number' })), field('Renewal notice (days)', I('renewNoticeDays', { type: 'number' }))),
    field('Status', h('select', { onChange: (e) => { v.status = e.target.value; } }, ['current', 'past'].map(x => h('option', { value: x, selected: v.status === x }, x === 'current' ? 'Current job' : 'Past job')))),
    field('Would you go back?', h('select', { onChange: (e) => { v.again = e.target.value; } }, [['', 'Not sure'], ['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']].map(([k, l]) => h('option', { value: k, selected: (v.again || '') === k }, l)))), field('Rating (1–5)', I('rating', { type: 'number', min: 0, max: 5 })), field('Why you left', I('reasonLeft')), h('div', { class: 'title' }, 'How was it? (1–5)'), ...C.ASPECTS.map(([k, l]) => field(l, h('input', { type: 'range', min: 0, max: 5, value: v.aspects?.[k] || 0, onInput: (e) => { v.aspects = { ...(v.aspects || {}), [k]: +e.target.value }; } }))), field('Notes', h('textarea', { rows: 3, onInput: (e) => { v.notes = e.target.value; } }, v.notes || '')),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => { if (!String(v.employer || '').trim()) return toast('Add the employer', 'err'); ctx.update(s => C.saveJob(s, v)); box.close(); ctx.render(); } }, 'Save'), j ? h('button', { class: 'btn danger', onClick: () => { if (confirm('Delete this job?')) { ctx.update(s => C.deleteJob(s, j.id)); box.close(); ctx.render(); } } }, 'Delete') : null)]);
}

// ───────── next job
function nextJob(s, jobs) {
  const cur = C.currentJob(s), offers = C.offerList(s), out = [], lessons = jobs.filter(j => j.again === 'no' || j.notes && j.again || C.ASPECTS.some(([k]) => j.aspects?.[k] && j.aspects[k] <= 2));
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Deciding your next job'), h('div', { class: 'small muted' }, 'Add an offer, rate how it feels, and it is scored against what you earn now: pay per hour actually worked, hours, leave, and the things money does not show.')));
  if (lessons.length) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Lessons from your past jobs'), lessons.map(j => h('div', { class: 'small' }, `${j.employer}: ${AGAIN[j.again] || ''}${j.site && j.postingOf ? ' (' + j.site + ')' : ''}${C.ASPECTS.filter(([k]) => j.aspects?.[k] && j.aspects[k] <= 2).map(([, l]) => ' · poor ' + l.toLowerCase()).join('')}${j.reasonLeft ? ' · ' + j.reasonLeft : ''}${j.notes ? ' · ' + j.notes : ''}`)), h('div', { class: 'tiny dim' }, 'Check every new offer against these before you say yes.')));
  const rows = offers.map(o => ({ o, r: C.scoreOffer(o, cur) })).sort((a, b) => b.r.score - a.r.score);
  if (cur) out.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `Now: ${cur.employer}`), h('span', { class: 'small muted' }, `${sar(C.total(cur))} · ${C.hourly(cur)}/h · ${cur.leave}d · ${cur.hoursWeek}h`))));
  for (const { o, r } of rows) out.push(h('div', { class: `card of-${o.status}` }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, o.employer), h('div', { class: 'small muted' }, [o.role, o.city, o.status !== 'considering' ? o.status : ''].filter(Boolean).join(' · '))), h('div', { class: 'of-score' }, h('b', {}, r.score), h('small', {}, '/100'))),
    h('div', { class: 'small' }, `${sar(r.total)} a month · ${r.hourly} SAR/h · ${o.leave}d leave · ${o.hoursWeek}h`), C.compare(o, cur).map(t => h('div', { class: 'tiny dim' }, t)),
    h('div', { class: 'row wrap', style: { marginTop: '6px' } }, h('button', { class: 'btn sm ghost', onClick: () => offerSheet(o) }, '✎ Edit'))));
  if (!offers.length) out.push(h('div', { class: 'card empty' }, 'No offers yet'));
  out.push(h('button', { class: 'btn primary', onClick: () => offerSheet() }, '＋ Add an offer'));
  return out;
}
function offerSheet(o) {
  const v = { ...(o || { hoursWeek: 48, leave: 21, years: 1, status: 'considering' }), feel: { ...(o?.feel || {}) } }, I = (k, p = {}) => h('input', { value: v[k] ?? '', ...p, onInput: (e) => { v[k] = p.type === 'number' ? +e.target.value : e.target.value; } });
  const box = ctx.sheet([h('h2', {}, o ? 'Edit offer' : 'Add an offer'), field('Employer', I('employer')), field('Role', I('role')), field('City', I('city')),
    h('div', { class: 'row wrap' }, field('Basic', I('basic', { type: 'number' })), field('Housing', I('housing', { type: 'number' })), field('Transport', I('transport', { type: 'number' })), field('Other', I('other', { type: 'number' }))),
    h('div', { class: 'row wrap' }, field('Hours a week', I('hoursWeek', { type: 'number' })), field('Leave days', I('leave', { type: 'number' })), field('Contract years', I('years', { type: 'number' }))),
    h('div', { class: 'chips' }, [['ticket', 'Annual flight ticket'], ['insurance', 'Family insurance'], ['housed', 'Housing provided']].map(([k, l]) => h('button', { class: `chip ${v[k] ? 'sel' : ''}`, onClick: (e) => { v[k] = !v[k]; e.currentTarget.classList.toggle('sel', v[k]); } }, l))),
    h('div', { class: 'title', style: { marginTop: '10px' } }, 'How does it feel? (1–5)'), ...C.FEELS.map(([k, l]) => field(l, h('input', { type: 'range', min: 0, max: 5, step: 1, value: v.feel[k] || 0, onInput: (e) => { v.feel[k] = +e.target.value; } }))),
    field('Status', h('select', { onChange: (e) => { v.status = e.target.value; } }, ['considering', 'declined', 'accepted'].map(x => h('option', { value: x, selected: v.status === x }, x)))), field('Notes', h('textarea', { rows: 3, onInput: (e) => { v.notes = e.target.value; } }, v.notes || '')),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => { if (!String(v.employer || '').trim()) return toast('Add the employer', 'err'); ctx.update(s => C.saveOffer(s, v)); box.close(); ctx.render(); } }, 'Save'), o ? h('button', { class: 'btn danger', onClick: () => { if (confirm('Delete this offer?')) { ctx.update(s => C.deleteOffer(s, o.id)); box.close(); ctx.render(); } } }, 'Delete') : null)]);
}

// ───────── file in / out (keeps salary details out of the code: you load them once, then they sync with your Drive state)
function importBtn() {
  const f = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { const d = JSON.parse(await file.text()); const jobs = d.jobs || [], n = jobs.length; if (!n) throw 0; ctx.update(s => { let st = s; for (const j of jobs) st = C.saveJob(st, j); for (const o of d.offers || []) st = C.saveOffer(st, o); if (d.labor) st = { ...st, settings: { ...st.settings, labor: { ...(st.settings?.labor || {}), ...d.labor } } }; return st; }); toast(`Loaded ${n} job${n > 1 ? 's' : ''}`); ctx.render(); } catch { toast('That is not a career file', 'err'); } } });
  return [f, h('button', { class: 'btn grow', onClick: () => f.click() }, '⬆ Load career file')];
}
function exportFile() { const s = S(), blob = new Blob([JSON.stringify({ jobs: C.jobList(s), offers: C.offerList(s) }, null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: 'career.json' }); a.click(); }

/** Today: only when a contract date is close. */
export function todayCard() {
  const cur = C.currentJob(S()); if (!cur) return null; const u = C.upcoming(cur, new Date(), 90); if (!u.length) return null;
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Contract dates'), u.map(k => h('div', { class: 'small' }, `${k.label}: ${fd(k.date)} (in ${k.days} days)`)), h('button', { class: 'btn sm ghost', onClick: () => { ctx.go('rota', 'career'); } }, 'Open Career'));
}
