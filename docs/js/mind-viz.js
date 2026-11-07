// Mind visuals: small SVG builders. No libraries; animation is CSS only (transform/opacity/stroke-dashoffset), see .mind-* in app.css.
const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const pct = (x) => Math.round(clamp01(x) * 100);

/** Progress ring. value 0–1 (null = empty). */
export function ring(value, { size = 56, stroke = 5, color = 'var(--orange)', label = '', sub = '', cls = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = value == null ? 0 : clamp01(value);
  const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: `m-ring ${cls}`, role: 'img', 'aria-label': value == null ? 'no data' : `${pct(v)}%` },
    svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--line)', 'stroke-width': stroke }),
    svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': `${c * v} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'm-ring-arc' }));
  if (!label && !sub) return s;
  const w = document.createElement('div'); w.className = 'm-ring-wrap'; w.style.width = size + 'px'; w.style.height = size + 'px';
  w.append(s); const t = document.createElement('div'); t.className = 'm-ring-text';
  t.innerHTML = ''; const a = document.createElement('b'); a.textContent = label; t.append(a);
  if (sub) { const b = document.createElement('small'); b.textContent = sub; t.append(b); }
  w.append(t); return w;
}

/** Sparkline of numbers (nulls are gaps). */
export function spark(values, { w = 120, h = 32, color = 'var(--orange)', max = null, fill = true } = {}) {
  const vals = values.map(v => (v == null || Number.isNaN(v) ? null : +v)), nums = vals.filter(v => v != null);
  const s = svg('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, preserveAspectRatio: 'none', class: 'm-spark', 'aria-hidden': 'true' });
  if (nums.length < 2) { s.append(svg('line', { x1: 0, y1: h - 1, x2: w, y2: h - 1, stroke: 'var(--line)', 'stroke-width': 1 })); return s; }
  const lo = Math.min(...nums, 0), hi = max ?? Math.max(...nums, 1), span = hi - lo || 1, step = w / (vals.length - 1);
  const pts = vals.map((v, i) => v == null ? null : [i * step, h - 3 - ((v - lo) / span) * (h - 6)]);
  let d = '', pen = false; for (const p of pts) { if (!p) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`; pen = true; }
  if (fill) { const live = pts.filter(Boolean); s.append(svg('path', { d: `${d} L${live[live.length - 1][0].toFixed(1)} ${h} L${live[0][0].toFixed(1)} ${h} Z`, fill: color, opacity: .12 })); }
  s.append(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
  const last = pts.filter(Boolean).pop(); s.append(svg('circle', { cx: last[0], cy: last[1], r: 2.6, fill: color, class: 'm-spark-dot' }));
  return s;
}

/** Bars 0–1 with labels. */
export function bars(items, { h = 64, color = 'var(--orange)' } = {}) {
  const wrap = document.createElement('div'); wrap.className = 'm-bars'; wrap.style.height = h + 22 + 'px';
  for (const it of items) {
    const col = document.createElement('div'); col.className = 'm-bar' + (it.now ? ' now' : '');
    const f = document.createElement('i'); f.style.height = Math.max(it.v == null ? 0 : 4, (it.v || 0) * h) + 'px'; f.style.background = it.color || color; f.title = it.title || '';
    const l = document.createElement('span'); l.textContent = it.label;
    col.append(f, l); wrap.append(col);
  }
  return wrap;
}

/** Calendar heat: cells = [{key, v (0–1|null), title}], laid out in columns of 7 (weeks). */
export function heat(cells, { color = 'var(--orange)' } = {}) {
  const g = document.createElement('div'); g.className = 'm-heat';
  for (const c of cells) {
    const e = document.createElement('i'); e.title = c.title || c.key; e.dataset.k = c.key;
    if (c.blank) e.className = 'blank'; else if (c.v != null) { e.style.background = color; e.style.opacity = String(0.18 + 0.82 * clamp01(c.v)); } else e.className = 'none';
    if (c.today) e.classList.add('today');
    g.append(e);
  }
  return g;
}

/** Radar of 0–1 values; ghost = previous values. axes = [{id,label,color}] */
export function radar(axes, values, { size = 240, ghost = null } = {}) {
  const c = size / 2, R = size / 2 - 34, n = axes.length;
  const pt = (i, f) => { const a = -Math.PI / 2 + (i / n) * 2 * Math.PI; return [c + Math.cos(a) * R * f, c + Math.sin(a) * R * f]; };
  const poly = (vals) => vals.map((v, i) => pt(i, clamp01(v ?? 0)).map(x => x.toFixed(1)).join(',')).join(' ');
  const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'm-radar', role: 'img', 'aria-label': 'Balance across areas' });
  for (const f of [.25, .5, .75, 1]) s.append(svg('polygon', { points: axes.map((_, i) => pt(i, f).join(',')).join(' '), fill: 'none', stroke: 'var(--line)', 'stroke-width': 1 }));
  axes.forEach((a, i) => { const [x, y] = pt(i, 1); s.append(svg('line', { x1: c, y1: c, x2: x, y2: y, stroke: 'var(--line)' })); const [lx, ly] = pt(i, 1.2); const t = svg('text', { x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'm-radar-l' }); t.textContent = a.label; s.append(t); });
  if (ghost) s.append(svg('polygon', { points: poly(ghost), fill: 'none', stroke: 'var(--muted)', 'stroke-dasharray': '3 3', 'stroke-width': 1.2 }));
  s.append(svg('polygon', { points: poly(values), fill: 'var(--orange)', 'fill-opacity': .18, stroke: 'var(--orange)', 'stroke-width': 2, 'stroke-linejoin': 'round', class: 'm-radar-shape' }));
  values.forEach((v, i) => { const [x, y] = pt(i, clamp01(v ?? 0)); s.append(svg('circle', { cx: x, cy: y, r: 3.2, fill: axes[i].color })); });
  return s;
}

/**
 * The tree: a core (the brain) with a branch to each life area, and leaves (habits, objectives) on the branches.
 * Branch thickness and glow follow how alive the area is; a pulse runs out along branches with activity today.
 * areas = [{id,name,color,emoji,score,heat,items,activeToday,habitDots[{done}],aimDots[{p}]}]
 */
export function tree(areas, { onPick, score = null, size = 360, selected = '' } = {}) {
  const W = size, H = Math.round(size * 0.92), cx = W / 2, cy = H / 2 + 6, n = areas.length;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'm-tree', role: 'group', 'aria-label': 'Your life areas' });
  const defs = svg('defs', {},
    svg('radialGradient', { id: 'mCore' }, svg('stop', { offset: '0%', 'stop-color': '#ffd2a8' }), svg('stop', { offset: '55%', 'stop-color': '#ff7a1a' }), svg('stop', { offset: '100%', 'stop-color': '#ff7a1a', 'stop-opacity': 0 })));
  s.append(defs);
  // faint stars (deterministic so it does not shimmer between renders)
  for (let i = 0; i < 26; i++) { const x = (i * 97.3 % W), y = (i * 53.7 % H), r = .6 + (i % 3) * .35; s.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r, class: 'm-star', style: `animation-delay:${(i % 7) * .6}s`, fill: 'currentColor' })); }
  const R = Math.min(W, H) * 0.36;
  const pos = areas.map((a, i) => { const ang = -Math.PI / 2 + (i / n) * 2 * Math.PI + 0.18; return { a, ang, x: cx + Math.cos(ang) * R * (i % 2 ? 1 : .9), y: cy + Math.sin(ang) * R * (i % 2 ? 1 : .9) }; });
  const gB = svg('g', { class: 'm-branches' }), gN = svg('g', { class: 'm-nodes' }), gL = svg('g', { class: 'm-leaves' });
  pos.forEach((p, i) => {
    const a = p.a, live = a.score == null ? 0.18 : 0.3 + 0.7 * a.score, bend = (i % 2 ? 1 : -1) * 22;
    const mx = (cx + p.x) / 2 + Math.sin(p.ang) * bend, my = (cy + p.y) / 2 - Math.cos(p.ang) * bend;
    const d = `M${cx} ${cy} Q${mx.toFixed(1)} ${my.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    gB.append(svg('path', { d, fill: 'none', stroke: a.color, 'stroke-width': (1.2 + live * 2.6).toFixed(2), 'stroke-linecap': 'round', opacity: (0.25 + live * 0.5).toFixed(2), class: 'm-branch' }));
    if (a.activeToday) gB.append(svg('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-dasharray': '6 90', class: 'm-pulse', style: `animation-delay:${(i * 0.45).toFixed(2)}s`, opacity: .85 }));
    // leaves along the outer side of the branch: habits (dots) and objectives (diamonds)
    const leaves = [...a.habitDots.map(x => ({ t: 'h', done: x.done })), ...a.aimDots.map(x => ({ t: 'a', p: x.p }))].slice(0, 7);
    leaves.forEach((l, j) => {
      const spread = (j - (leaves.length - 1) / 2) * 0.34, la = p.ang + spread, dist = 26 + (j % 2) * 7;
      const lx = p.x + Math.cos(la) * dist, ly = p.y + Math.sin(la) * dist;
      gL.append(svg('line', { x1: p.x.toFixed(1), y1: p.y.toFixed(1), x2: lx.toFixed(1), y2: ly.toFixed(1), stroke: a.color, opacity: .35, 'stroke-width': 1 }));
      if (l.t === 'h') gL.append(svg('circle', { cx: lx.toFixed(1), cy: ly.toFixed(1), r: l.done ? 4 : 3, fill: l.done ? a.color : 'var(--bg)', stroke: a.color, 'stroke-width': 1.4, class: l.done ? 'm-leaf done' : 'm-leaf' }));
      else gL.append(svg('rect', { x: (lx - 3.6).toFixed(1), y: (ly - 3.6).toFixed(1), width: 7.2, height: 7.2, transform: `rotate(45 ${lx.toFixed(1)} ${ly.toFixed(1)})`, fill: a.color, opacity: (0.35 + l.p * 0.65).toFixed(2), class: 'm-leaf' }));
    });
    // the area node
    const rad = 17 + Math.min(6, a.items * 0.8), g = svg('g', { class: `m-node${a.id === selected ? ' sel' : ''}${a.activeToday ? ' live' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${a.name}${a.score != null ? `, ${pct(a.score)}%` : ''}`, 'data-area': a.id, style: `animation-delay:${(i * 0.37).toFixed(2)}s` });
    g.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: rad + 6, fill: a.color, opacity: (0.06 + (a.heat || 0) * 0.2).toFixed(2), class: 'm-halo' }));
    g.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: rad, fill: 'var(--card)', stroke: a.color, 'stroke-width': 1.6 }));
    if (a.score != null) { const rr = rad - 3, cc = 2 * Math.PI * rr; g.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: rr, fill: 'none', stroke: a.color, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-dasharray': `${cc * a.score} ${cc}`, transform: `rotate(-90 ${p.x.toFixed(1)} ${p.y.toFixed(1)})`, opacity: .9 })); }
    const e = svg('text', { x: p.x.toFixed(1), y: (p.y + 1).toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'm-node-e' }); e.textContent = a.emoji; g.append(e);
    const nm = svg('text', { x: p.x.toFixed(1), y: (p.y + rad + 11).toFixed(1), 'text-anchor': 'middle', class: 'm-node-n' }); nm.textContent = a.name; g.append(nm);
    if (onPick) { g.addEventListener('click', () => onPick(a.id)); g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(a.id); } }); }
    gN.append(g);
  });
  s.append(gB, gL);
  // the core: breathes
  const core = svg('g', { class: 'm-core' },
    svg('circle', { cx: cx, cy: cy, r: 38, fill: 'url(#mCore)', class: 'm-core-glow' }),
    svg('circle', { cx: cx, cy: cy, r: 22, fill: 'var(--card)', stroke: 'var(--orange)', 'stroke-width': 2 }));
  const t = svg('text', { x: cx, y: cy + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'm-core-t' }); t.textContent = score == null ? '·' : String(score); core.append(t);
  s.append(core, gN);
  return s;
}
