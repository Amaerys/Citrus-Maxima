// Work → Calendar: "Labor law check" card + details/settings sheet. Flags only — contracts and employer policy can differ from the statute.
import { h, toast, fromKey, MONTHS } from './util.js';
import * as L from './labor.js';
let ctx = null;
export function initLabor(c) { ctx = c; }
const fmtD = (k) => { const d = fromKey(k); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const LV = { violation: ['Check', 'bad'], warn: ['Over', 'warn'], info: ['Note', ''], ok: ['Clear', 'ok'] };

export function laborCard(y, mo) {
  const s = ctx.S(); if (!s.me) return null; const cfg = L.settings(s); if (!cfg.on) return h('div', { class: 'card lw' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Labor law check · off'), h('button', { class: 'btn sm ghost', onClick: () => sheet(y, mo) }, 'Settings')));
  const r = L.checkMonth(s, y, mo, cfg), flags = r.findings.filter(f => f.level !== 'info'), t = r.totals, leave = L.leaveStatus(s, new Date(), cfg);
  const [word, cls] = LV[r.level];
  return h('div', { class: 'card lw' },
    h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Saudi labor law check'), h('span', { class: `chip lw-${cls}` }, flags.length ? `${flags.length} to check` : 'All clear')),
    h('div', { class: 'lw-stats' }, [[`${t.overtimeH}h`, 'over 48h weeks'], [`${t.compLeaveH}h`, 'comp. leave'], t.otPay != null ? [`${t.otPay.toLocaleString()}`, 'OT pay est. SAR'] : null, leave ? [`${leave.left}`, `of ${leave.entitled} leave days left`] : null].filter(Boolean).map(([n, l]) => h('div', {}, h('b', {}, n), h('small', {}, l)))),
    flags.slice(0, 3).map(f => h('div', { class: `lw-flag ${LV[f.level][1]}` }, h('b', {}, `${fmtD(f.date)} · ${f.article}`), ' ', f.msg)),
    flags.length > 3 ? h('div', { class: 'tiny dim' }, `+${flags.length - 3} more`) : null,
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm grow', onClick: () => sheet(y, mo) }, 'Details & settings'), h('span', { class: 'tiny dim' }, `${word} · not legal advice`)));
}

function sheet(y, mo) {
  const wrap = h('div', {}), repaint = () => setTimeout(() => paint(), 0); ctx.sheet([wrap]);
  const save = (patch) => { ctx.update(st => ({ ...st, settings: { ...st.settings, labor: { ...L.settings(st), ...patch } } })); };
  function paint() { const s = ctx.S(), cfg = L.settings(s), r = L.checkMonth(s, y, mo, cfg), b = h('div', {}); build(b, cfg, r); wrap.replaceChildren(b); }
  paint();
  function build(b, cfg, r) {
  const num = (v) => v === 0 ? '' : v;
  const toggle = (label, key, hint) => h('label', { class: 'row lw-tog' }, h('span', { class: 'grow' }, label, hint ? h('div', { class: 'tiny dim' }, hint) : null), h('input', { type: 'checkbox', checked: !!cfg[key], onChange: (e) => { save({ [key]: e.target.checked }); repaint(); } }));
  const dateIn = (label, val, on) => h('div', { class: 'field' }, h('label', {}, label), h('input', { type: 'date', value: val || '', onChange: (e) => on(e.target.value) }));
  b.append(h('h2', {}, `${MONTHS[mo - 1]} ${y} · labor law`),
    h('div', { class: 'small muted' }, 'Saudi Labor Law (Royal Decree M/51, amended by M/44 and in force from 19 Feb 2025). These are flags to check against your contract and your employer’s policy, not a legal ruling.'),
    h('div', { class: 'card' }, h('div', { class: 'title' }, 'Weeks'), h('table', { class: 'lw-weeks' }, h('tr', {}, ['Week of', 'Hours', 'Limit', 'Over', 'Rest'].map(x => h('th', {}, x))), ...r.weeks.map(w => h('tr', { class: w.full ? '' : 'part' }, h('td', {}, fmtD(w.start) + (w.full ? '' : ' *')), h('td', {}, w.hours), h('td', {}, w.cap + (w.ram ? ' R' : '')), h('td', { class: w.over ? 'bad' : '' }, w.over || '–'), h('td', { class: w.full && !w.restOk ? 'bad' : '' }, w.full ? (w.restOk ? '✓' : '✗') : '·')))), h('div', { class: 'tiny dim' }, '* weeks that run into the next or previous month are not judged (Sunday–Saturday weeks)')),
    h('div', { class: 'card' }, h('div', { class: 'title' }, 'Everything flagged'), r.findings.length ? r.findings.map(f => h('div', { class: `lw-flag ${LV[f.level][1]}` }, h('b', {}, `${fmtD(f.date)} · ${f.article}`), ' ', f.msg)) : h('div', { class: 'small muted' }, 'Nothing to flag this month.')),
    h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your settings'), toggle('Check my rota against the law', 'on'), toggle('Ramadan hours apply to me', 'muslim', '6h a day / 36h a week for Muslim staff (Art. 98)'),
      cfg.muslim ? h('div', { class: 'row wrap' }, dateIn('Ramadan starts', cfg.ramadan[0], (v) => { if (v) { save({ ramadan: [v, cfg.ramadan[1]] }); repaint(); } }), dateIn('Ramadan ends', cfg.ramadan[1], (v) => { if (v) { save({ ramadan: [cfg.ramadan[0], v] }); repaint(); } })) : null,
      dateIn('Start date at this employer (annual leave: 21 days, 30 after 5 years)', cfg.hire, (v) => { save({ hire: v }); repaint(); }),
      h('div', { class: 'field' }, h('label', {}, 'Basic monthly wage, SAR (optional, for an overtime estimate)'), h('input', { type: 'number', min: 0, inputmode: 'numeric', value: num(cfg.wage), onChange: (e) => { save({ wage: Math.max(0, +e.target.value || 0) }); repaint(); } })),
      h('div', { class: 'field' }, h('label', {}, 'Extra public holidays (Eid etc.), one date per line, YYYY-MM-DD'), h('textarea', { rows: 3, value: (cfg.holidays || []).join('\n'), onChange: (e) => { save({ holidays: e.target.value.split(/[\s,]+/).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)) }); toast('Saved'); repaint(); } })),
      h('div', { class: 'tiny dim' }, 'National Day (23 Sep) and Founding Day (22 Feb) are built in. Eid and Ramadan dates move with the moon, so confirm them.')),
    h('div', { class: 'card' }, h('div', { class: 'title' }, 'What is checked'), h('ul', { class: 'small lw-rules' },
      h('li', {}, 'Art. 98: 8h a day / 48h a week (36h in Ramadan for Muslims). 12h shifts are fine inside a 48h week.'), h('li', {}, 'Art. 101: no more than 12h from start to finish, and a 30 min break after 5 continuous hours (breaks cannot be seen in a rota).'),
      h('li', {}, 'Art. 104: at least 24 consecutive hours of rest every week.'), h('li', {}, 'Art. 107: overtime at hourly wage + 50 %; with your consent, leave of 1.5h per overtime hour (up to 30 days a year) can replace pay. Work on holidays counts as overtime.'),
      h('li', {}, 'Annual leave: 21 days, rising to 30 after 5 continuous years. Sick leave (Art. 117): 30 days full pay, 60 at 75 %, 30 unpaid.'))));
  }
}
