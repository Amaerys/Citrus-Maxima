// Apps tab: a constellation of your apps around Citrus. Tap a star for its card. SVG + CSS only; motion is transform/opacity/stroke-dashoffset and respects reduced-motion.
// The stars are a pointer shortcut only (aria-hidden, not focusable): keyboard and screen-reader users get one tab stop per app
// through the chip tablist (appTabs below), so 6 apps cost 6 stops, not 12.
import { svg } from './mind-viz.js';
import { h } from './util.js';

const W = 360, CX = W / 2;

// A star's label when the app sent no icon: a 2-letter monogram from its title ("Sinus Tracker" → "ST", "yuzu" → "Yu"),
// so 15 icon-less apps no longer all read "A". An emoji or a deliberate monogram is kept as it is.
export function appIcon(icon, title = '') {
  const s = String(icon || '').trim(), t = String(title || '').trim();
  if (s && !(/^[A-Za-z]$/.test(s) && t.length > 1)) return s;
  const words = t.split(/[\s\-_.]+/).filter(w => /[A-Za-z0-9]/.test(w));
  if (!words.length) return s || '?';
  const m = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return words.length > 1 ? m.toUpperCase() : m[0].toUpperCase() + m.slice(1).toLowerCase();
}
const isMono = (s) => /^[A-Za-z0-9?]{1,2}$/.test(s);
// Monograms that collide ("Atlas Notes" and "Amber Notes" both "AN") try other letter pairs from the title until unique.
function uniqueIcons(nodes) {
  const first = nodes.map(nd => appIcon(nd.icon, nd.label)), used = new Set(), out = first.slice();
  // pass 1: every monogram's first owner keeps it, so a later "Acorn" is not pushed off "Ac" by an earlier collision fix
  const dup = first.map((m, i) => { if (!isMono(m)) return false; const k = m.toUpperCase(); if (used.has(k)) return true; used.add(k); return false; });
  // pass 2: collisions take another letter pair from their title, else letter + number
  first.forEach((m, i) => {
    if (!dup[i]) return;
    const letters = String(nodes[i].label || '').replace(/[^A-Za-z0-9]/g, ''), alts = [];
    for (let j = 1; j < letters.length; j++) alts.push(letters[0].toUpperCase() + letters[j].toLowerCase());
    for (let n = 2; n < 100; n++) alts.push((letters[0] || m[0]).toUpperCase() + n);
    out[i] = alts.find(x => !used.has(x.toUpperCase())) || m; used.add(out[i].toUpperCase());
  });
  return out;
}

// Orbits grow with the number of apps: one ring up to 8, two up to 18, then three (the canvas gets taller).
// Each ring gets a share of the nodes proportional to its length, so spacing stays even; alternate rings are offset by half a step.
export function layout(n) {
  const rings = n <= 8 ? [[128, 98]] : n <= 18 ? [[84, 62], [152, 114]] : [[78, 60], [122, 95], [164, 132]];
  const r = n <= 8 ? 23 : n <= 12 ? 19 : n <= 18 ? 16 : n <= 30 ? 13 : 11, H = rings.length > 2 ? 340 : 300, CY = H / 2;
  const len = rings.map(([a, b]) => Math.PI * Math.sqrt((a * a + b * b) * 2)), total = len.reduce((x, y) => x + y, 0);
  const counts = rings.map(() => 0); let left = n;
  // biggest-share-first rounding: never leaves a ring empty when there are enough apps for it
  rings.forEach((_, i) => { counts[i] = i === rings.length - 1 ? left : Math.max(1, Math.round(n * len[i] / total)); left -= counts[i]; });
  const pos = [];
  rings.forEach(([rx, ry], ri) => { const k = counts[ri], off = ri % 2 ? Math.PI / Math.max(1, k) : 0; for (let i = 0; i < k; i++) { const a = -Math.PI / 2 + off + (i * 2 * Math.PI) / k; pos.push([CX + rx * Math.cos(a), CY + ry * Math.sin(a)]); } });
  return { rings, r, H, CY, pos };
}

/** nodes: [{ key, icon, color, badge, fresh, done, label }] */
export function constellation(nodes, sel, onPick) {
  const { rings, r: R, H, CY, pos } = layout(Math.max(1, nodes.length)), icons = uniqueIcons(nodes);
  const dust = Array.from({ length: 26 }, (_, i) => { const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * W, y = (Math.cos(i * 57.3) * 0.5 + 0.5) * H; return svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: (0.6 + (i % 3) * 0.4).toFixed(1), class: 'c-dust', style: `animation-delay:${(i % 7) * 0.6}s` }); });
  const links = nodes.map((nd, i) => svg('line', { x1: CX, y1: CY, x2: pos[i][0].toFixed(1), y2: pos[i][1].toFixed(1), class: `c-link ${nd.fresh ? 'live' : ''} ${sel === nd.key ? 'on' : ''}`, style: `--c:${nd.color}` }));
  const stars = nodes.map((nd, i) => {
    const [x, y] = pos[i], on = sel === nd.key, r = on ? Math.round(R * 1.17) : R, circ = 2 * Math.PI * (r + 4), icon = icons[i], mono = isMono(icon);
    const g = svg('g', { class: `c-node ${on ? 'on' : ''} ${nd.fresh ? '' : 'stale'}`, style: `--c:${nd.color}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, 'data-key': nd.key },
      svg('title', {}, nd.label),
      svg('circle', { r: r + 10, class: 'c-halo' }), svg('circle', { r: r + 4, class: 'c-track' }),
      svg('circle', { r: r + 4, class: 'c-arc', 'stroke-dasharray': `${nd.done ? circ : nd.fresh ? circ * 0.72 : 0} ${circ}`, transform: 'rotate(-90)' }),
      svg('circle', { r, class: 'c-body' }), (() => { const fs = Math.round(r * (mono ? 0.72 : 0.92)); const t = svg('text', { class: `c-icon ${mono ? 'mono' : ''}`, 'text-anchor': 'middle', y: (fs * 0.34).toFixed(1), 'font-size': fs }); t.textContent = icon; return t; })());
    g.firstChild.textContent = nd.label;
    if (nd.badge) {
      const br = R < 16 ? 7 : 9, txt = nd.badge > 99 ? '99+' : String(nd.badge);
      const b = svg('g', { transform: `translate(${(r * 0.78).toFixed(1)} ${(-r * 0.78).toFixed(1)})`, class: 'c-badge-g' }, svg('rect', { x: -Math.max(br, txt.length * 3.2 + 3), y: -br, width: 2 * Math.max(br, txt.length * 3.2 + 3), height: 2 * br, rx: br, class: 'c-badge' }));
      const t = svg('text', { class: 'c-badge-t', 'text-anchor': 'middle', y: (br * 0.38).toFixed(1), 'font-size': br < 9 ? 7.5 : 9 }); t.textContent = txt; b.append(t); g.append(b);
    }
    g.addEventListener('click', () => onPick(nd.key));
    return g;
  });
  const core = svg('g', { transform: `translate(${CX} ${CY})`, class: 'c-core' }, svg('circle', { r: 46, class: 'c-pulse' }), svg('circle', { r: 46, class: 'c-pulse p2' }), svg('circle', { r: 28, class: 'c-core-body' }));
  const t = svg('text', { class: 'c-core-t', 'text-anchor': 'middle', y: 5 }); t.textContent = 'Citrus'; core.append(t);
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: `constellation rings-${rings.length}`, 'aria-hidden': 'true', focusable: 'false' },
    ...dust, ...rings.map(([rx, ry]) => svg('ellipse', { cx: CX, cy: CY, rx, ry, class: 'c-orbit' })), ...links, core, ...stars);
}

// The keyboard/screen-reader picker for the same apps: a tablist with one tab stop (roving tabindex), ←/→/↑/↓, Home/End.
// Selection follows focus, as the WAI-ARIA tabs pattern allows when switching is cheap. panelId is the detail card's id
// (give it role=tabpanel). items: [{ key, icon, color, title, fresh }]
export function appTabs(items, sel, onPick, panelId = 'app-panel') {
  const tabs = items.map(it => h('button', {
    class: `c-chip ${it.key === sel ? 'on' : ''} ${it.fresh ? '' : 'stale'}`, style: { '--c': it.color }, role: 'tab', id: `app-tab-${String(it.key).replace(/[^\w-]/g, '_')}`,
    'aria-selected': it.key === sel ? 'true' : 'false', 'aria-controls': panelId, tabindex: it.key === sel ? '0' : '-1', dataset: { key: it.key }, onClick: () => onPick(it.key),
  }, h('span', { 'aria-hidden': 'true' }, appIcon(it.icon, it.title)), it.title));
  if (tabs.length && !items.some(it => it.key === sel)) tabs[0].tabIndex = 0;
  const list = h('div', { class: 'c-chips', role: 'tablist', 'aria-label': 'Your apps' }, tabs);
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (j == null) return; e.preventDefault();
    const key = tabs[(j + tabs.length) % tabs.length].dataset.key;
    onPick(key);
    // onPick usually re-renders: refocus the new tab wherever it now lives
    requestAnimationFrame(() => { const el = [...document.querySelectorAll('.c-chips [role=tab]')].find(b => b.dataset.key === key); el?.focus(); el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); });
  });
  return list;
}
