// Career: your contracts (current + past), what they say, and a way to weigh the next offer. Pure functions, no DOM.
import { addDays, fromKey, keyOf } from './util.js';
const num = (v, max = 1e7) => Math.max(0, Math.min(max, +v || 0));
const dte = (v) => /^\d{4}-\d\d-\d\d$/.test(String(v || '')) ? v : '';
const txt = (v, n = 200) => String(v || '').trim().slice(0, n);
const uid = () => 'j' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const ASPECTS = [['environment', 'Work environment'], ['people', 'People'], ['food', 'Food'], ['housing', 'Living quarters']];
export const jobList = (s) => Object.values(s.jobs || {}).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
export const currentJob = (s) => jobList(s).find(j => j.status === 'current') || null;
export const offerList = (s) => Object.values(s.offers || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
export const total = (j) => num(j.basic) + num(j.housing) + num(j.transport) + num(j.other);

export function cleanJob(j) {
  const id = j.id || uid();
  return { id, employer: txt(j.employer, 120), employerAr: txt(j.employerAr, 120), role: txt(j.role, 80), city: txt(j.city, 40), site: txt(j.site, 120), contractId: txt(j.contractId, 20), status: j.status === 'current' ? 'current' : 'past',
    start: dte(j.start), end: dte(j.end), left: dte(j.left), signed: dte(j.signed), hoursWeek: num(j.hoursWeek, 168) || 48, daysWeek: num(j.daysWeek, 7), basic: num(j.basic), housing: num(j.housing), transport: num(j.transport), other: num(j.other),
    transportProvided: !!j.transportProvided, leave: num(j.leave, 365), trialDays: num(j.trialDays, 365), renewNoticeDays: num(j.renewNoticeDays, 365), renews: j.renews !== false, qiwa: txt(j.qiwa, 30), iqamaExpiry: dte(j.iqamaExpiry),
    rating: Math.max(0, Math.min(5, Math.round(+j.rating) || 0)), again: ['yes', 'no', 'maybe', ''].includes(j.again) ? j.again : '', notes: txt(j.notes, 1200), postingOf: txt(j.postingOf, 20), weeks: num(j.weeks, 600), aspects: Object.fromEntries(ASPECTS.map(([k]) => [k, Math.max(0, Math.min(5, Math.round(+j.aspects?.[k]) || 0))])), reasonLeft: txt(j.reasonLeft, 400), terms: Array.isArray(j.terms) ? j.terms.slice(0, 30).map(t => txt(t, 400)) : [], at: Date.now() };
}
export const saveJob = (s, j) => { const c = cleanJob(j); return { ...s, jobs: { ...(s.jobs || {}), [c.id]: c } }; };
export function deleteJob(s, id) { const jobs = { ...(s.jobs || {}) }; delete jobs[id]; return { ...s, jobs, deleted: { ...(s.deleted || {}), [`job:${id}`]: Date.now() } }; }

/** Key dates for a fixed-term contract. */
export function keyDates(j, now = new Date()) {
  const out = []; if (!j.start) return out; const days = (k) => Math.round((fromKey(k) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  if (j.trialDays) { const k = keyOf(addDays(fromKey(j.start), j.trialDays)); out.push({ id: 'trial', label: 'Trial period ended', date: k, days: days(k) }); }
  if (j.end) { if (j.renews && j.renewNoticeDays) { const k = keyOf(addDays(fromKey(j.end), -j.renewNoticeDays)); out.push({ id: 'renew', label: `Last day to give written notice not to renew (${j.renewNoticeDays} days before the end)`, date: k, days: days(k), why: 'After this the contract renews for a similar period.' }); } out.push({ id: 'end', label: 'Contract term ends', date: j.end, days: days(j.end) }); }
  if (j.iqamaExpiry) out.push({ id: 'iqama', label: 'Iqama expires', date: j.iqamaExpiry, days: days(j.iqamaExpiry) });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
export const upcoming = (j, now = new Date(), within = 120) => keyDates(j, now).filter(k => k.id !== 'trial' && k.days >= 0 && k.days <= within);

/** Years served, counted to leaving date (or today). */
export const yearsServed = (j, now = new Date()) => !j.start ? 0 : Math.max(0, ((j.left ? fromKey(j.left) : now) - fromKey(j.start)) / (365.25 * 864e5));
/** End-of-service reward, Labor Law Art. 84: half a month's wage per year for 5 years, a full month after. Resigning (Art. 85) pays a third / two thirds / all by 2 / 5 / 10 years. */
export function endOfService(j, now = new Date()) {
  const y = yearsServed(j, now), months = Math.min(y, 5) * 0.5 + Math.max(0, y - 5), t = total(j), b = num(j.basic);
  const resign = y < 2 ? 0 : y < 5 ? 1 / 3 : y < 10 ? 2 / 3 : 1;
  return { years: y, months, onTotal: Math.round(months * t), onBasic: Math.round(months * b), resignFactor: resign, resignOnTotal: Math.round(months * t * resign), perYearTotal: Math.round(t / 2) };
}
/** What an hour of your time pays: yearly package ÷ hours actually worked after leave. */
export function hourly(j) { const weeks = 52 - num(j.leave) / 7, hrs = num(j.hoursWeek) * weeks; return hrs > 0 ? Math.round(total(j) * 12 / hrs * 10) / 10 : 0; }
/** Overtime hour as the contract words it: hourly wage + 50 % of basic (÷240). */
export const overtimeRate = (j) => Math.round(num(j.basic) / 240 * 1.5 * 100) / 100;

/** Things in the contract worth a second look. */
export function flags(j) {
  const out = [];
  if (j.leave && j.leave < 21) out.push({ level: 'violation', msg: `Annual leave ${j.leave} days is below the legal minimum of 21 (Labor Law Art. 109)` });
  if (j.hoursWeek > 48) out.push({ level: 'violation', msg: `${j.hoursWeek}h a week is over the 48h limit (Art. 98)` });
  if (j.basic && total(j) && j.basic / total(j) < 0.5) out.push({ level: 'warn', msg: `Basic is only ${Math.round(j.basic / total(j) * 100)} % of the package. End-of-service and overtime are often figured on basic, so it matters` });
  if (j.qiwa && /reject/i.test(j.qiwa)) out.push({ level: 'warn', msg: 'Qiwa shows this contract as rejected/unsigned. Keep your payslips and bank transfers as proof of the period worked' });
  if (j.renews && j.status === 'current') out.push({ level: 'info', msg: `Renews automatically for a similar period unless written notice is given ${j.renewNoticeDays || 90} days before the end` });
  return out;
}

// ───────── offers
export const WEIGHTS = { pay: 30, hours: 15, leave: 10, culture: 20, growth: 10, place: 10, stability: 5 };
export const FEELS = [['culture', 'People & management'], ['growth', 'Learning & growth'], ['place', 'Environment, food & housing'], ['stability', 'Stability of the employer']];
export function cleanOffer(o) {
  const id = o.id || 'o' + uid().slice(1); const f = {}; for (const [k] of FEELS) f[k] = Math.max(0, Math.min(5, Math.round(+o.feel?.[k]) || 0));
  return { id, employer: txt(o.employer, 120), role: txt(o.role, 80), city: txt(o.city, 40), basic: num(o.basic), housing: num(o.housing), transport: num(o.transport), other: num(o.other), hoursWeek: num(o.hoursWeek, 168) || 48, leave: num(o.leave, 365) || 21, years: num(o.years, 10) || 1, ticket: !!o.ticket, insurance: !!o.insurance, housed: !!o.housed, notes: txt(o.notes, 800), feel: f, status: ['considering', 'declined', 'accepted'].includes(o.status) ? o.status : 'considering', at: Date.now() };
}
export const saveOffer = (s, o) => { const c = cleanOffer(o); return { ...s, offers: { ...(s.offers || {}), [c.id]: c } }; };
export function deleteOffer(s, id) { const offers = { ...(s.offers || {}) }; delete offers[id]; return { ...s, offers, deleted: { ...(s.deleted || {}), [`offer:${id}`]: Date.now() } }; }
/** 0–100, weighted. Pay is judged against what you earn now (or the best past job), the rest on fixed scales; unrated feelings count as neutral. */
export function scoreOffer(o, ref, w = WEIGHTS) {
  const refH = ref ? Math.max(hourly(ref), 1) : 40, oh = hourly({ ...o });
  const part = { pay: Math.min(1, oh / (refH * 1.5)), hours: Math.max(0, Math.min(1, (60 - o.hoursWeek) / 24)), leave: Math.min(1, o.leave / 35) };
  for (const [k] of FEELS) part[k] = (o.feel?.[k] || 3) / 5;
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1; let sc = 0; for (const k of Object.keys(w)) sc += (part[k] ?? 0.5) * w[k];
  return { score: Math.round(sc / sum * 100), hourly: oh, total: total(o), part };
}
/** Plain-language deltas versus the current job. */
export function compare(o, cur) {
  if (!cur) return []; const d = [], dt = total(o) - total(cur), dh = Math.round((hourly(o) - hourly(cur)) * 10) / 10;
  d.push(`${dt >= 0 ? '+' : '−'}${Math.abs(dt).toLocaleString()} SAR a month (${dh >= 0 ? '+' : '−'}${Math.abs(dh)} SAR per working hour)`);
  if (o.hoursWeek !== cur.hoursWeek) d.push(`${o.hoursWeek}h a week vs ${cur.hoursWeek}h`); if (o.leave !== cur.leave) d.push(`${o.leave} leave days vs ${cur.leave}`);
  const e = endOfService(cur); if (e.onTotal) d.push(`Your end-of-service so far is about ${e.onTotal.toLocaleString()} SAR; if you resign it pays ${Math.round(e.resignFactor * 100)} % of that (Art. 85), if they end the contract, all of it`);
  if (cur.status === 'current' && cur.end && fromKey(cur.end) > new Date()) d.push(`Fixed term runs to ${cur.end}. Leaving earlier without an agreed release can mean compensation under Art. 77, so get the release in writing`);
  return d;
}
