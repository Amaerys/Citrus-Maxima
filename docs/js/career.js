// Career: your contracts (current + past), what they say, and a way to weigh the next offer. Pure functions, no DOM.
import { addDays, fromKey, keyOf } from './util.js';
const num = (v, max = 1e7) => Math.max(0, Math.min(max, +v || 0));
const dte = (v) => /^\d{4}-\d\d-\d\d$/.test(String(v || '')) ? v : '';
const txt = (v, n = 200) => String(v || '').trim().slice(0, n);
const r1 = (n) => Math.round(n * 10) / 10, r2 = (n) => Math.round(n * 100) / 100;
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const rate = (v) => Math.max(0, Math.min(5, Math.round(+v) || 0)); // 0 = not rated, 1–5
const uid = () => 'j' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Days of written notice before the end, when the contract file or the sheet does not say. Common in Saudi contracts; the user can change it. */
export const RENEW_NOTICE = 60;
/** The divisor the Labor Law uses for an hourly wage: a month is 30 days × 8 hours. */
export const HOURS_PER_MONTH = 240;

export const ASPECTS = [['environment', 'Work environment'], ['people', 'People'], ['food', 'Food'], ['housing', 'Living quarters']];
export const jobList = (s) => Object.values(s.jobs || {}).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
export const currentJob = (s) => jobList(s).find(j => j.status === 'current' && !j.postingOf) || jobList(s).find(j => j.status === 'current') || null;
export const offerList = (s) => Object.values(s.offers || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
export const postingsOf = (s, id) => jobList(s).filter(x => x.postingOf === id);
export const total = (j) => num(j.basic) + num(j.housing) + num(j.transport) + num(j.other);

export function cleanJob(j) {
  const id = j.id || uid(), terms = Array.isArray(j.terms) ? j.terms : String(j.terms || '').split('\n');
  return { id, employer: txt(j.employer, 120), employerAr: txt(j.employerAr, 120), role: txt(j.role, 80), city: txt(j.city, 40), site: txt(j.site, 120), contractId: txt(j.contractId, 20), status: j.status === 'current' ? 'current' : 'past',
    start: dte(j.start), end: dte(j.end), left: dte(j.left), signed: dte(j.signed), hoursWeek: num(j.hoursWeek, 168) || 48, daysWeek: num(j.daysWeek, 7), basic: num(j.basic), housing: num(j.housing), transport: num(j.transport), other: num(j.other),
    transportProvided: !!j.transportProvided, leave: num(j.leave, 365), trialDays: num(j.trialDays, 365), renewNoticeDays: j.renewNoticeDays == null || j.renewNoticeDays === '' ? RENEW_NOTICE : num(j.renewNoticeDays, 365), renews: j.renews !== false, qiwa: txt(j.qiwa, 30), iqamaExpiry: dte(j.iqamaExpiry),
    rating: rate(j.rating), again: ['yes', 'no', 'maybe', ''].includes(j.again) ? j.again : '', notes: txt(j.notes, 1200), postingOf: txt(j.postingOf, 20), weeks: num(j.weeks, 600), aspects: Object.fromEntries(ASPECTS.map(([k]) => [k, rate(j.aspects?.[k])])), reasonLeft: txt(j.reasonLeft, 400), terms: terms.map(t => txt(t, 400)).filter(Boolean).slice(0, 30), at: Date.now() };
}
/** Problems that make a job sheet unsaveable (dates in the wrong order). */
export function jobErrors(j) {
  const e = [];
  if (!txt(j.employer)) e.push('Add the employer');
  if (j.start && j.end && j.end < j.start) e.push('“Contract ends” is before “Start”');
  if (j.start && j.left && j.left < j.start) e.push('“Left on” is before “Start”');
  if (j.start && j.signed && j.signed > (j.end || '9999')) e.push('“Signed” is after the contract ends');
  return e;
}
/** Only one main job is current: saving a current one moves the others to past jobs, with a left date the day before the new start (unless their term already ended). */
export function settleCurrent(s, keepId) {
  const keep = s.jobs?.[keepId]; if (!keep || keep.status !== 'current' || keep.postingOf) return { state: s, demoted: [] };
  const jobs = { ...s.jobs }, demoted = [];
  for (const o of Object.values(jobs)) {
    if (o.id === keepId || o.status !== 'current' || o.postingOf) continue;
    const dayBefore = keep.start && keep.start > (o.start || '') ? keyOf(addDays(fromKey(keep.start), -1)) : '';
    const left = o.left || (o.end && dayBefore && o.end <= dayBefore ? '' : dayBefore);
    jobs[o.id] = { ...o, status: 'past', left, at: Date.now() }; demoted.push(jobs[o.id]);
  }
  return { state: { ...s, jobs }, demoted };
}
export const saveJob = (s, j) => { const c = cleanJob(j); return settleCurrent({ ...s, jobs: { ...(s.jobs || {}), [c.id]: c } }, c.id).state; };
export function deleteJob(s, id) { const jobs = { ...(s.jobs || {}) }; delete jobs[id]; return { ...s, jobs, deleted: { ...(s.deleted || {}), [`job:${id}`]: Date.now() } }; }

// ───────── dates
/** Adds months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsKey(k, n) { const d = fromKey(k), x = new Date(d.getFullYear(), d.getMonth() + n, 1), last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(d.getDate(), last)); return keyOf(x); }
const addYears = (d, n) => fromKey(addMonthsKey(keyOf(d), 12 * n));
/** Exact years between two dates: whole calendar years, then the part of the next year in days, so an anniversary is exactly n.0. */
export function yearsBetween(a, b) {
  a = sod(a); b = sod(b); if (b <= a) return 0;
  let y = b.getFullYear() - a.getFullYear(); if (addYears(a, y) > b) y--;
  const from = addYears(a, y), to = addYears(a, y + 1); return y + (b - from) / (to - from);
}
/** The day service stops counting (exclusive): the day after "left", else after the end date of a past job, else today. Never later than today. */
export function servedTo(j, now = new Date()) {
  const today = sod(now), stop = j.left || (j.status !== 'current' ? j.end : '');
  if (!stop) return today; const d = addDays(fromKey(stop), 1); return d < today ? d : today;
}
/** Years served: to the leaving date, else a past job's end date, else today. The last day worked counts. */
export const yearsServed = (j, now = new Date()) => !j.start ? 0 : yearsBetween(fromKey(j.start), servedTo(j, now));
/** Length of service in calendar years, months and days (for display). */
export function served(j, now = new Date()) {
  if (!j.start) return { y: 0, m: 0, d: 0 }; const a = fromKey(j.start), b = servedTo(j, now); if (b <= a) return { y: 0, m: 0, d: 0 };
  let mo = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth(); if (fromKey(addMonthsKey(j.start, mo)) > b) mo--;
  const d = Math.round((b - fromKey(addMonthsKey(j.start, mo))) / 864e5); return { y: Math.floor(mo / 12), m: mo % 12, d };
}

/** The contract term in force. A renewing current contract rolls forward by its original length once the end has passed. */
export function currentTerm(j, now = new Date()) {
  if (!j.start || !j.end || j.end < j.start) return null;
  const today = keyOf(sod(now)), after = keyOf(addDays(fromKey(j.end), 1));
  let months = 0; for (let m = 1; m <= 240; m++) { const k = addMonthsKey(j.start, m); if (k === after) { months = m; break; } if (k > after) break; }
  const days = Math.round((fromKey(after) - fromKey(j.start)) / 864e5);
  let start = j.start, end = j.end, n = 0;
  while (j.status === 'current' && j.renews && end < today && n < 60) { start = keyOf(addDays(fromKey(end), 1)); end = keyOf(addDays(months ? fromKey(addMonthsKey(start, months)) : addDays(fromKey(start), days), -1)); n++; }
  return { start, end, renewals: n, months, days };
}
/** Key dates for a fixed-term contract. */
export function keyDates(j, now = new Date()) {
  const out = []; if (!j.start) return out; const days = (k) => Math.round((fromKey(k) - sod(now)) / 864e5), term = currentTerm(j, now);
  if (j.trialDays) { const k = keyOf(addDays(fromKey(j.start), j.trialDays)); out.push({ id: 'trial', label: 'Trial period ended', date: k, days: days(k) }); }
  if (term) {
    const nd = j.renewNoticeDays ?? RENEW_NOTICE;
    if (term.renewals) out.push({ id: 'renewed', label: `Renewed automatically (term ${term.renewals + 1})`, date: term.start, days: days(term.start) });
    if (j.renews && nd && j.status === 'current') { const k = keyOf(addDays(fromKey(term.end), -nd)); out.push({ id: 'renew', label: `Last day to give written notice not to renew (${nd} days before the end)`, date: k, days: days(k), why: 'After this the contract renews for a similar period.' }); }
    out.push({ id: 'end', label: term.renewals ? 'Current term ends' : 'Contract term ends', date: term.end, days: days(term.end) });
  }
  if (j.iqamaExpiry) out.push({ id: 'iqama', label: 'Iqama expires', date: j.iqamaExpiry, days: days(j.iqamaExpiry) });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
export const upcoming = (j, now = new Date(), within = 120) => keyDates(j, now).filter(k => k.id !== 'trial' && k.id !== 'renewed' && k.days >= 0 && k.days <= within);

// ───────── money
/** Art. 85 share of the award when YOU resign, by completed years. */
export const resignFactor = (y) => y < 2 ? 0 : y < 5 ? 1 / 3 : y < 10 ? 2 / 3 : 1;
/** End-of-service award, Labor Law Art. 84: half a month's wage for each of the first 5 years, a full month for each year after, parts of a year pro rata.
 *  It is due in full when the employer ends the contract or a fixed term runs out. Resigning (Art. 85) pays a third after 2 years, two thirds after 5, all after 10. */
export function endOfService(j, now = new Date()) {
  const y = yearsServed(j, now), months = Math.min(y, 5) * 0.5 + Math.max(0, y - 5), t = total(j), b = num(j.basic), f = resignFactor(y);
  return { years: y, months, onTotal: Math.round(months * t), onBasic: Math.round(months * b), resignFactor: f, resignOnTotal: Math.round(months * t * f), resignOnBasic: Math.round(months * b * f), perYearTotal: Math.round(t / 2) };
}
/** The next date the end-of-service rules change for this job: 2 / 5 / 10 years (Art. 85), 5 years is also where each year starts to earn a full month (Art. 84). */
export function nextStep(j, now = new Date()) {
  if (!j.start || j.status !== 'current' || j.left) return null; const y = yearsServed(j, now);
  const step = [[2, 'resigning pays a third of the award'], [5, 'resigning pays two thirds, and each further year earns a full month'], [10, 'resigning pays the full award']].find(([n]) => n > y + 1e-9);
  if (!step) return null; const date = keyOf(addYears(fromKey(j.start), step[0]));
  return { years: step[0], date, days: Math.round((fromKey(date) - sod(now)) / 864e5), msg: step[1], factor: resignFactor(step[0]) };
}
/** What an hour of your time pays: yearly package ÷ contract hours actually worked after leave. */
export function hourly(j, monthly = total(j)) { const weeks = 52 - num(j.leave) / 7, hrs = num(j.hoursWeek) * weeks; return hrs > 0 ? r1(monthly * 12 / hrs) : 0; }
/** Overtime hour, Art. 107: the hourly wage (full package ÷ 240) plus 50 % of the basic hourly wage. basicOnly is the floor some employers pay (basic ÷ 240 × 1.5). */
export function overtime(j) { const w = total(j) / HOURS_PER_MONTH, b = num(j.basic) / HOURS_PER_MONTH; return { full: r2(w + b * 0.5), basicOnly: r2(b * 1.5), hourlyWage: r2(w), basicHourly: r2(b) }; }
export const overtimeRate = (j) => overtime(j).full;
/** Pay per hour actually rostered, from the hours in loaded rotas ([{key:'2026-11', hours}]), next to the contract's monthly hours. */
export function realHourly(j, months) { const t = total(j), contractH = r1(num(j.hoursWeek) * 52 / 12); return months.filter(m => m.hours > 0).map(m => ({ ...m, contractH, perHour: r1(t / m.hours), overH: r1(m.hours - contractH) })); }

/** Things in the contract worth a second look. */
export function flags(j, now = new Date()) {
  const out = [], y = yearsServed(j, now);
  if (j.leave && j.leave < 21) out.push({ level: 'violation', msg: `Annual leave ${j.leave} days is below the legal minimum of 21 (Labor Law Art. 109)` });
  else if (j.leave && j.leave < 30 && y >= 5 && j.status === 'current') out.push({ level: 'violation', msg: `After 5 years of service annual leave is at least 30 days, the contract gives ${j.leave} (Art. 109)` });
  if (j.hoursWeek > 48) out.push({ level: 'violation', msg: `${j.hoursWeek}h a week is over the 48h limit (Art. 98)` });
  if (j.trialDays > 180) out.push({ level: 'violation', msg: `A ${j.trialDays}-day trial period is over the 180-day maximum (Art. 53)` });
  else if (j.trialDays > 90) out.push({ level: 'warn', msg: `A trial period over 90 days needs a written agreement to extend it (Art. 53)` });
  if (j.basic && total(j) && j.basic / total(j) < 0.5) out.push({ level: 'warn', msg: `Basic is only ${Math.round(j.basic / total(j) * 100)} % of the package. Overtime and some employers' end-of-service figures use basic, so it matters` });
  if (j.qiwa && /reject/i.test(j.qiwa)) out.push({ level: 'warn', msg: 'Qiwa shows this contract as rejected/unsigned. Keep your payslips and bank transfers as proof of the period worked' });
  if (j.renews && j.status === 'current' && j.end) { const nd = j.renewNoticeDays ?? RENEW_NOTICE; out.push({ level: 'info', msg: nd ? `Renews automatically for a similar period unless written notice is given ${nd} days before the end` : 'Renews automatically. Add the notice period from your contract to see the deadline' }); }
  return out;
}

// ───────── offers
export const WEIGHTS = { pay: 30, hours: 15, leave: 10, culture: 20, growth: 10, place: 10, stability: 5 };
export const FEELS = [['culture', 'People & management'], ['growth', 'Learning & growth'], ['place', 'Environment, food & housing'], ['stability', 'Stability of the employer']];
/** Housing provided in kind is worth what you would otherwise pay; without a figure, use your current housing allowance or the usual 25 % of basic. */
export const HOUSING_SHARE = 0.25;
export function cleanOffer(o) {
  const id = o.id || 'o' + uid().slice(1); const f = {}; for (const [k] of FEELS) f[k] = rate(o.feel?.[k]);
  return { id, employer: txt(o.employer, 120), role: txt(o.role, 80), city: txt(o.city, 40), basic: num(o.basic), housing: num(o.housing), transport: num(o.transport), other: num(o.other), hoursWeek: num(o.hoursWeek, 168) || 48, leave: num(o.leave, 365) || 21, years: num(o.years, 10) || 1,
    ticket: !!o.ticket, insurance: !!o.insurance, housed: !!o.housed, housedValue: num(o.housedValue), ticketValue: num(o.ticketValue), insuranceValue: num(o.insuranceValue), notes: txt(o.notes, 800), feel: f, status: ['considering', 'declined', 'accepted'].includes(o.status) ? o.status : 'considering', at: Date.now() };
}
export const saveOffer = (s, o) => { const c = cleanOffer(o); return { ...s, offers: { ...(s.offers || {}), [c.id]: c } }; };
export function deleteOffer(s, id) { const offers = { ...(s.offers || {}) }; delete offers[id]; return { ...s, offers, deleted: { ...(s.deleted || {}), [`offer:${id}`]: Date.now() } }; }
/** Monthly value of an offer: cash plus benefits in kind (housing provided; ticket and insurance when you give their yearly worth). */
export function offerValue(o, ref) {
  const housed = o.housed && !num(o.housing) ? (num(o.housedValue) || num(ref?.housing) || Math.round(num(o.basic) * HOUSING_SHARE)) : 0;
  const extras = Math.round(((o.ticket ? num(o.ticketValue) : 0) + (o.insurance ? num(o.insuranceValue) : 0)) / 12), cash = total(o);
  return { cash, housed, housedGuess: !!housed && !num(o.housedValue), extras, value: cash + housed + extras, unpriced: [o.ticket && !num(o.ticketValue) ? 'ticket' : '', o.insurance && !num(o.insuranceValue) ? 'insurance' : ''].filter(Boolean) };
}
/** 0–100, weighted. Pay (with benefits) is judged against what you earn now (or the best past job), the rest on fixed scales; a feeling you have not rated counts as neutral (3 of 5). */
export function scoreOffer(o, ref, w = WEIGHTS) {
  const refH = ref ? Math.max(hourly(ref), 1) : 40, v = offerValue(o, ref), oh = hourly(o, v.value);
  const part = { pay: Math.min(1, oh / (refH * 1.5)), hours: Math.max(0, Math.min(1, (60 - o.hoursWeek) / 24)), leave: Math.min(1, o.leave / 35) };
  for (const [k] of FEELS) { const f = rate(o.feel?.[k]); part[k] = f ? (f - 1) / 4 : 0.5; }
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1; let sc = 0; for (const k of Object.keys(w)) sc += (part[k] ?? 0.5) * w[k];
  return { score: Math.round(sc / sum * 100), hourly: oh, total: v.value, cash: v.cash, value: v, part };
}
/** Plain-language deltas versus the current job (the end-of-service and fixed-term context is in compareContext, shown once). */
export function compare(o, cur) {
  if (!cur) return []; const d = [], v = offerValue(o, cur), dt = v.value - total(cur), dh = r1(hourly(o, v.value) - hourly(cur));
  d.push(`${dt >= 0 ? '+' : '−'}${Math.abs(dt).toLocaleString()} SAR a month (${dh >= 0 ? '+' : '−'}${Math.abs(dh)} SAR per working hour)`);
  if (v.housed) d.push(`Housing provided counted as ${v.housed.toLocaleString()} SAR a month${v.housedGuess ? ' (estimate: set its worth in the offer)' : ''}`);
  if (v.unpriced.length) d.push(`${v.unpriced.join(' and ')} not counted: add the yearly worth in the offer`);
  if (o.hoursWeek !== cur.hoursWeek) d.push(`${o.hoursWeek}h a week vs ${cur.hoursWeek}h`); if (o.leave !== cur.leave) d.push(`${o.leave} leave days vs ${cur.leave}`);
  return d;
}
/** What leaving the current job costs, once for all offers. Dates come back as keys for the UI to format. */
export function compareContext(cur, now = new Date()) {
  if (!cur) return []; const out = [], e = endOfService(cur, now), term = currentTerm(cur, now);
  if (e.onTotal) out.push({ id: 'eos', text: `End-of-service so far ${e.onTotal.toLocaleString()} SAR. Resigning now pays ${Math.round(e.resignFactor * 100)} % of it (${e.resignOnTotal.toLocaleString()} SAR, Art. 85); if they end the contract or the term runs out, all of it` });
  if (cur.status === 'current' && term && term.end >= keyOf(sod(now))) out.push({ id: 'term', date: term.end, text: 'Fixed term runs to {date}. Leaving earlier without an agreed release can mean compensation under Art. 77, so get the release in writing' });
  return out;
}

// ───────── file import (merge, never duplicate)
const jobKey = (j) => `${norm(j.employer)}|${j.start || ''}|${norm(j.site)}`;
const offerKey = (o) => `${norm(o.employer)}|${norm(o.role)}`;
/** Merges a career file ({jobs?, offers?, labor?}) into the state. Same id, or same employer + start (offers: employer + role), updates instead of adding. */
export function importCareer(s, d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('not a career file');
  const jobsIn = Array.isArray(d.jobs) ? d.jobs : [], offersIn = Array.isArray(d.offers) ? d.offers : [], labor = d.labor && typeof d.labor === 'object' && !Array.isArray(d.labor) ? d.labor : null;
  if (!jobsIn.length && !offersIn.length && !labor) throw new Error('not a career file');
  const n = { jobsAdded: 0, jobsUpdated: 0, offersAdded: 0, offersUpdated: 0, labor: !!labor, demoted: [] }, jobs = { ...(s.jobs || {}) }, offers = { ...(s.offers || {}) }, idMap = {};
  const byKey = (list, keyFn) => Object.fromEntries(Object.values(list).map(x => [keyFn(x), x.id]));
  const jk = byKey(jobs, jobKey);
  for (const raw of jobsIn.filter(j => j && !j.postingOf).concat(jobsIn.filter(j => j && j.postingOf))) {
    const pj = { ...raw, ...(raw.postingOf ? { postingOf: idMap[raw.postingOf] || raw.postingOf } : {}) }, hit = (pj.id && jobs[pj.id] ? pj.id : '') || jk[jobKey(pj)];
    if (!pj.postingOf) delete pj.postingOf;
    // An update keeps what the file does not carry (a posting link, ratings you added by hand).
    const c = cleanJob({ ...(hit ? jobs[hit] : {}), ...pj, id: hit || pj.id }); if (raw.id) idMap[raw.id] = c.id;
    if (hit) n.jobsUpdated++; else n.jobsAdded++; jobs[c.id] = c; jk[jobKey(c)] = c.id;
  }
  const ok = byKey(offers, offerKey);
  for (const raw of offersIn.filter(Boolean)) { const hit = (raw.id && offers[raw.id] ? raw.id : '') || ok[offerKey(raw)], c = cleanOffer({ ...(hit ? offers[hit] : {}), ...raw, id: hit || raw.id }); if (hit) n.offersUpdated++; else n.offersAdded++; offers[c.id] = c; ok[offerKey(c)] = c.id; }
  let st = { ...s, jobs, offers };
  if (labor) st = { ...st, settings: { ...(st.settings || {}), labor: { ...(st.settings?.labor || {}), ...labor } } };
  // If the file and the state together hold several current jobs, the one that started last stays current.
  const cur = Object.values(jobs).filter(j => j.status === 'current' && !j.postingOf).sort((a, b) => (b.start || '').localeCompare(a.start || ''))[0];
  if (cur) { const r = settleCurrent(st, cur.id); st = r.state; n.demoted = r.demoted; }
  return { state: st, counts: n };
}
/** "2 jobs, 1 offer, labor settings" (added / updated). */
export function importSummary(c) {
  const pl = (x, w) => `${x} ${w}${x === 1 ? '' : 's'}`, part = (a, u, w) => a + u ? `${pl(a + u, w)}${u ? ` (${u} updated)` : ''}` : '';
  return [part(c.jobsAdded, c.jobsUpdated, 'job'), part(c.offersAdded, c.offersUpdated, 'offer'), c.labor ? 'labor settings' : ''].filter(Boolean).join(', ');
}
/** What the export writes; import reads the same shape back. */
export const exportData = (s) => ({ jobs: jobList(s), offers: offerList(s), labor: s.settings?.labor || {} });
