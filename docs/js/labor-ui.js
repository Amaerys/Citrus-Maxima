// Work → Calendar: "Labor law check" card + details/settings sheet. Flags only — contracts and employer policy can differ from the statute.
import { h, toast, fromKey, MONTHS } from './util.js';
import * as L from './labor.js';
let ctx = null;
export function initLabor(c) { ctx = c; }
const fmtD = (k) => { if (!k) return ''; const d = fromKey(k); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const LV = { violation: ['Check', 'bad'], warn: ['Over', 'warn'], info: ['Note', ''], ok: ['Clear', 'ok'] };
const sar = (n) => Math.round(n).toLocaleString('en-US');

/** One flag row: "Week of 8–14 Nov · Art. 98  60h worked …". */
const flagRow = (f) => h('div', { class: `lw-flag ${LV[f.level][1]}` }, h('b', {}, `${f.label || fmtD(f.date)} · ${f.article}`), ' ', f.msg,
  f.dates && f.dates.length > 1 ? h('div', { class: 'tiny dim lw-dates' }, f.dates.map(k => fromKey(k).getDate()).join(' · ')) : null);

/** settings.labor without the contract keys that are blank or only repeat the contract: those must keep following Career (beta T05-01). */
function cleanLabor(st, labor) {
  const c = L.fromContract(st), out = { ...labor };
  for (const k of L.CONTRACT_KEYS) if (out[k] === '' || out[k] == null || out[k] === 0 || String(out[k]) === String(c[k] ?? '')) delete out[k];
  return out;
}
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function laborCard(y, mo) {
  const s = ctx.S(); if (!s.me) return null; const cfg = L.settings(s); if (!cfg.on) return h('div', { class: 'card lw' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Labor law check · off'), h('button', { class: 'btn sm ghost', onClick: () => sheet(y, mo) }, 'Settings')));
  const r = L.checkMonth(s, y, mo, cfg), flags = r.findings.filter(f => f.level !== 'info'), t = r.totals, leave = L.leaveStatus(s, new Date(), cfg);
  const [word, cls] = LV[r.level];
  const stats = [
    [`${t.overtimeH}h`, `over ${t.cap}h weeks`, t.cap < L.LAW.weeklyH ? `Hours above your ${t.cap}h contract week; the legal ceiling is ${L.LAW.weeklyH}h` : 'Hours above the 48h legal week'],
    [`${t.compLeaveH}h`, 'comp. leave', '1.5h of leave per overtime hour, if you take leave instead of pay'],
    t.otPay != null ? [sar(t.otPay), 'OT pay est. SAR', `${t.otRate} SAR an hour: hourly wage + 50 % of basic hourly (Art. 107)`] : null,
    leave ? [`${leave.used}/${leave.entitled}`, `leave in rotas (${leave.seenMonths} mo)`, `Leave days in the rotas loaded for this leave year (from ${fmtD(leave.yearStart)}). Months without a rota are not counted.`] : null,
  ].filter(Boolean);
  return h('div', { class: 'card lw' },
    h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Saudi labor law check'), h('span', { class: `chip lw-${cls}` }, flags.length ? `${flags.length} to check` : 'All clear')),
    h('div', { class: 'lw-stats' }, stats.map(([n, l, tip]) => h('div', { title: tip }, h('b', {}, n), h('small', {}, l)))),
    flags.slice(0, 3).map(flagRow),
    flags.length > 3 ? h('div', { class: 'tiny dim' }, `+${flags.length - 3} more`) : null,
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm grow', onClick: () => sheet(y, mo) }, 'Details & settings'), h('span', { class: 'tiny dim' }, `${word} · not legal advice`)));
}

function sheet(y, mo) {
  const wrap = h('div', {}), repaint = () => setTimeout(() => paint(), 0); ctx.sheet([wrap]);
  // write only what the user changed, on top of the stored hand settings — never the values derived from the contract (beta T05-01)
  const save = (patch) => ctx.update(st => { const labor = cleanLabor(st, { ...(st.settings?.labor || {}), ...patch }); return { ...st, settings: { ...st.settings, labor } }; });
  // heal older saves that froze the contract's wage/leave/hours into settings while they still equal the contract
  { const st = ctx.S(), raw = st.settings?.labor; if (raw && !sameJSON(cleanLabor(st, raw), raw)) save({}); }
  function paint() { const s = ctx.S(), cfg = L.settings(s), r = L.checkMonth(s, y, mo, cfg), b = h('div', {}); build(b, cfg, r); wrap.replaceChildren(b); }
  paint();
  function build(b, cfg, r) {
    const toggle = (label, key, hint) => h('label', { class: 'row lw-tog' }, h('span', { class: 'grow' }, label, hint ? h('div', { class: 'tiny dim' }, hint) : null), h('input', { type: 'checkbox', checked: !!cfg[key], onChange: (e) => { save({ [key]: e.target.checked }); repaint(); } }));
    const dateIn = (label, val, on) => h('div', { class: 'field' }, h('label', {}, label), h('input', { type: 'date', value: val || '', onChange: (e) => on(e.target.value) }));
    // a contract term: shows the value in use, where it comes from, and a reset when you typed your own
    const term = (key, label, type, show, parse) => {
      const c = cfg.contract[key], mine = cfg.src[key] === 'you';
      const hint = mine ? (c ? `Yours · contract says ${show(c)}` : 'Yours') : c ? 'From contract' : 'No contract: type it';
      return h('div', { class: 'field lw-term' }, h('label', {}, label),
        h('div', { class: 'row' }, h('input', { type, class: 'grow', min: 0, inputmode: type === 'number' ? 'numeric' : null, value: cfg[key] === 0 ? '' : (cfg[key] ?? ''), placeholder: c ? String(c) : '',
          onChange: (e) => { save({ [key]: parse(e.target.value) }); repaint(); } }),
          mine && c ? h('button', { class: 'btn sm ghost', title: 'Follow the contract again', onClick: () => { save({ [key]: null }); toast('Back to the contract value'); repaint(); } }, 'Reset') : null),
        h('div', { class: `tiny ${mine ? 'lw-mine' : 'dim'}` }, hint));
    };
    const n0 = (v) => Math.max(0, Math.min(1e7, +v || 0));
    const legalNote = cfg.contractH > L.LAW.weeklyH ? h('div', { class: 'lw-flag bad' }, h('b', {}, 'Art. 98'), ` ${cfg.contractH}h a week is over the ${L.LAW.weeklyH}h legal limit, so weeks are checked against ${L.LAW.weeklyH}h.`) : null;
    const weekCell = (w) => L.weekLabel(fromKey(w.start)) + (w.full ? '' : ' *');
    const info = r.findings.filter(f => f.level === 'info'), real = r.findings.filter(f => f.level !== 'info');
    b.append(h('h2', {}, `${MONTHS[mo - 1]} ${y} · labor law`),
      h('div', { class: 'small muted' }, 'Saudi Labor Law (Royal Decree M/51, amended by M/44 and in force from 19 Feb 2025). These are flags to check against your contract and your employer’s policy, not a legal ruling.'),
      h('div', { class: 'card' }, h('div', { class: 'title' }, 'Weeks (Sun–Sat)'),
        h('table', { class: 'lw-weeks' }, h('tr', {}, ['Week', 'Hours', 'Limit', 'Over', 'Rest'].map(x => h('th', {}, x))),
          ...r.weeks.map(w => h('tr', { class: w.full ? '' : 'part' }, h('td', { class: 'lw-wk' }, weekCell(w)), h('td', {}, w.hours), h('td', { title: w.cap < w.legal ? `Contract ${w.cap}h, legal ${w.legal}h` : 'Legal limit' }, w.cap < w.legal ? `${w.cap}/${w.legal}` : w.cap, w.ram ? ' R' : ''),
            h('td', { class: w.full && w.overLegal ? 'bad' : w.full && w.over ? 'warn' : '' }, w.over || '–'), h('td', { class: w.full && !w.restOk ? 'bad' : '' }, w.full ? (w.restOk ? '✓' : '✗') : '·')))),
        h('div', { class: 'tiny dim' }, `* weeks that run into the next or previous month are not judged. Limit: ${r.totals.cap < L.LAW.weeklyH ? `your ${r.totals.cap}h contract week / the legal ${L.LAW.weeklyH}h` : `the legal ${L.LAW.weeklyH}h`}${r.weeks.some(w => w.ram) ? '; R = Ramadan days in the week' : ''}.`)),
      h('div', { class: 'card' }, h('div', { class: 'title' }, 'Everything flagged'),
        real.length ? real.map(flagRow) : h('div', { class: 'small muted' }, 'Nothing to check this month.'),
        info.length ? h('div', { class: 'lw-notes' }, h('div', { class: 'tiny dim' }, 'Notes'), info.map(flagRow)) : null),
      h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your settings'), toggle('Check my rota against the law', 'on'), toggle('Ramadan hours apply to me', 'muslim', '6h a day / 36h a week for Muslim staff (Art. 98)'),
        cfg.muslim ? h('div', { class: 'row wrap' },
          dateIn('Ramadan starts', cfg.ramadan[0], (v) => { if (!v) return; if (v > cfg.ramadan[1]) return toast('Ramadan must start before it ends', 'err'); save({ ramadan: [v, cfg.ramadan[1]] }); repaint(); }),
          dateIn('Ramadan ends', cfg.ramadan[1], (v) => { if (!v) return; if (v < cfg.ramadan[0]) return toast('Ramadan must end after it starts', 'err'); save({ ramadan: [cfg.ramadan[0], v] }); repaint(); })) : null,
        h('div', { class: 'tiny dim lw-sub' }, 'Contract terms · these follow Career unless you type your own'),
        h('div', { class: 'lw-terms' },
          term('hire', 'Start date', 'date', fmtD, (v) => /^\d{4}-\d\d-\d\d$/.test(v) ? v : null),
          term('wage', 'Basic, SAR a month', 'number', sar, (v) => n0(v) || null),
          term('leaveDays', 'Annual leave, days', 'number', String, (v) => Math.min(365, n0(v)) || null),
          term('weeklyH', 'Week, hours', 'number', (v) => `${v}h`, (v) => Math.min(168, n0(v)) || null)),
        legalNote,
        h('div', { class: 'tiny dim' }, `Annual leave is at least ${L.LAW.annualDays} days, ${L.LAW.annualDays5y} after 5 years. Overtime is paid per Art. 107 on the full hourly wage + 50 % of basic${cfg.allowances ? ` (allowances ${sar(cfg.allowances)} SAR from the contract)` : ''}.`),
        h('div', { class: 'field' }, h('label', {}, 'Extra public holidays (Eid etc.), one date per line, YYYY-MM-DD'), h('textarea', { rows: 3, value: (cfg.holidays || []).join('\n'), onChange: (e) => {
          const { ok, bad } = L.parseHolidays(e.target.value); save({ holidays: ok });
          toast(bad.length ? `Saved ${ok.length} · ignored ${bad.slice(0, 4).join(', ')}${bad.length > 4 ? '…' : ''} (not a real YYYY-MM-DD date)` : `Saved ${ok.length} holiday${ok.length === 1 ? '' : 's'}`, bad.length ? 'err' : ''); repaint(); } })),
        h('div', { class: 'tiny dim' }, 'National Day (23 Sep) and Founding Day (22 Feb) are built in. Eid and Ramadan dates move with the moon, so confirm them.')),
      h('div', { class: 'card' }, h('div', { class: 'title' }, 'What is checked'), h('ul', { class: 'small lw-rules' },
        h('li', {}, 'Art. 98: 8h a day / 48h a week (36h in Ramadan for Muslims), whatever the contract says; a shorter contract week lowers the limit. 12h shifts are fine inside a 48h week.'), h('li', {}, 'Art. 101: no more than 12h from start to finish, and a 30 min break after 5 continuous hours (breaks cannot be seen in a rota).'),
        h('li', {}, 'Art. 104: at least 24 consecutive hours of rest every week.'), h('li', {}, 'Art. 107: overtime at hourly wage + 50 % of basic hourly; with your consent, leave of 1.5h per overtime hour (up to 30 days a year) can replace pay. Work on holidays counts as overtime.'),
        h('li', {}, 'Annual leave: 21 days, rising to 30 after 5 continuous years. Sick leave (Art. 117): 30 days full pay, 60 at 75 %, 30 unpaid.'))));
  }
}
