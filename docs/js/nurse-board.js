// Nurses board logic (no DOM): short unambiguous names, who can tell you the postings, marks for the 7-day strip,
// and reading a pasted posting list (the team leader's WhatsApp message) into tips. Used by people-ui.js.
import * as N from './nurses.js';
import { keyOf } from './util.js';

const clean = (n) => String(n || '').replace(/^Dr\.?\s*/i, '').replace(/\([^)]*\)/g, ' ').replace(/\s+-\s*\w+$/, '').trim();
const words = (n) => clean(n).split(/\s+/).filter(Boolean);
/**
 * "Fatima K.", "Al Nizar", "Babylyn": the first name, or the first two words when the first is a tiny prefix ("Al"),
 * plus a surname initial (then the whole surname) only where two people would read the same. `extra` = names that also count
 * as clashes (e.g. friends you call "Fatima") without getting a name back.
 */
export function shortNurseNames(names, extra = []) {
  const w = names.map(words), base = w.map(x => x.length > 1 && x[0].length <= 2 ? `${x[0]} ${x[1]}` : (x[0] || '')), out = [...base];
  const taken = new Set(extra.map(e => words(e)[0]?.toLowerCase()).filter(Boolean));
  for (let pass = 0; pass < 3; pass++) {
    const seen = new Map(); out.forEach((n, i) => seen.set(n.toLowerCase(), [...(seen.get(n.toLowerCase()) || []), i]));
    let clash = false;
    for (const [n, idx] of seen) if (idx.length > 1 || (pass === 0 && taken.has(n))) {
      clash = clash || idx.length > 1;
      for (const i of idx) { const x = w[i], last = x[x.length - 1] || ''; if (x.length < 2) continue; out[i] = pass === 0 ? `${base[i]} ${last[0]}.` : pass === 1 ? `${base[i]} ${last}` : x.join(' '); }
    }
    if (!clash) break;
  }
  return out;
}

/** People who actually know where the construction-clinic nurses go: the head nurse and the team leaders of the floating groups.
 *  FSED / Aqua Arabia leaders are fixed at their place and do not know the postings, so they are never offered. */
export function heardSources(s) {
  const l = N.nurses(s).filter(n => n.group === 'head' || n.group === 'leaders' || (n.leader && N.isFloater(n.group)));
  const short = shortNurseNames(l.map(n => n.name));
  return l.map((n, i) => ({ key: N.keyOfPerson(n), name: short[i], leader: !!n.leader })).sort((a, b) => b.leader - a.leader);
}
/** The source of the most recent tip you typed (not a guess): the next tip probably comes from the same person. */
export function lastSource(s) {
  let best = null; for (const x of Object.values(s.posts || {})) if (x.tip && !x.guess && x.from && x.from !== 'last time' && (!best || (x.at || 0) > (best.at || 0))) best = x;
  return best ? best.from : null;
}

/** Per-day marks for the board's day strip: how many confirmed, heard, guessed and still open, and whether the schedule covers the day. */
export function dayMarks(s, dates) {
  return dates.map(date => {
    if (!N.nurseRotaFor(s, date)) return { date, key: keyOf(date), hasRota: false, posted: 0, heard: 0, guessed: 0, open: 0 };
    const rows = N.rowsFor(s, date).filter(r => N.isFloater(r.group) && r.group !== 'head');
    const posted = rows.filter(r => r.post).length, heard = rows.filter(r => !r.post && r.tip && !r.tip.guess).length, guessed = rows.filter(r => !r.post && r.tip?.guess).length;
    return { date, key: keyOf(date), hasRota: true, posted, heard, guessed, open: rows.length - posted };
  });
}

// ───────── pasted posting list → tips
const SITE_RE = [['UPV', /\b(upv|upper\s*vill?age?)\b/i], ['LPV', /\b(lpv|lower\s*vill?age?)\b/i], ['UPO', /\b(upo|upper\s*office(\s*clinic)?)\b/i], ['LPO', /\b(lpo|lower\s*office(\s*clinic)?)\b/i]];
const siteIn = (t) => SITE_RE.find(([, re]) => re.test(t))?.[0] || '';
const stripSites = (t) => SITE_RE.reduce((a, [, re]) => a.replace(new RegExp(re.source, 'gi'), ' '), t);
const toks = (t) => t.toLowerCase().normalize('NFKD').replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(x => x.length >= 2);
const NOISE = new Set(['day', 'night', 'shift', 'am', 'pm', 'and', 'sn', 'rn', 'tl', 'hn', 'fa', 'clinic', 'office', 'today', 'tomorrow', 'posting', 'postings', 'nurse', 'nurses', 'the', 'at', 'to', 'in', 'is', 'are', 'for', 'with', 'off']);
/**
 * Reads a message like "UPV: Cresilda, Editha\nLower Village\n1. Areej\n2. Babylyn (N)" against the floating nurses of that day.
 * A line with only a site starts a block; a line with a site and names assigns those names. A name matches a nurse when its words start
 * her name's words (3+ letters) and point at exactly one nurse. Returns hits (one per nurse, the last mention wins), and what it could not place.
 */
export function parsePostingList(text, rows) {
  const cand = rows.filter(r => r.choices?.length).map(r => ({ r, t: toks(clean(r.person.name)) }));
  const hits = new Map(), unknown = [], offsite = []; let cur = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*[\d]+[.)]\s*|^\s*[-•*]\s*/, '').trim(); if (!line) continue;
    const site = siteIn(line), rest = stripSites(line).replace(/\([^)]*\)/g, ' ');
    const parts = rest.split(/[,;/&+]|\band\b/i).map(x => toks(x).filter(w => !NOISE.has(w))).filter(x => x.length);
    if (site && !parts.length) { cur = site; continue; }
    const at = site || cur;
    for (const p of parts) {
      const m = cand.filter(c => p.every(w => w.length >= 3 ? c.t.some(t => t.startsWith(w)) : c.t.includes(w)) && p.some(w => w.length >= 3));
      const label = p.join(' ');
      if (m.length !== 1) { unknown.push({ text: label, why: m.length ? `${m.length} nurses match` : 'no nurse on shift by that name' }); continue; }
      if (!at) { unknown.push({ text: label, why: 'no site before it' }); continue; }
      const r = m[0].r; if (!r.choices.includes(at)) { offsite.push({ key: r.key, name: r.person.name, site: at }); continue; }
      hits.set(r.key, { key: r.key, name: r.person.name, site: at, row: r });
    }
  }
  return { hits: [...hits.values()], unknown, offsite };
}
