// Apps tab: a constellation of your apps around Citrus. Tap a star for its card. SVG + CSS only; motion is transform/opacity/stroke-dashoffset and respects reduced-motion.
import { svg } from './mind-viz.js';

const W = 360, H = 300, CX = W / 2, CY = H / 2;
/** nodes: [{ key, icon, color, badge, fresh, done, label }] */
export function constellation(nodes, sel, onPick) {
  const n = Math.max(1, nodes.length), rx = 128, ry = 98, pos = nodes.map((_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [CX + rx * Math.cos(a), CY + ry * Math.sin(a)]; });
  const dust = Array.from({ length: 26 }, (_, i) => { const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * W, y = (Math.cos(i * 57.3) * 0.5 + 0.5) * H; return svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: (0.6 + (i % 3) * 0.4).toFixed(1), class: 'c-dust', style: `animation-delay:${(i % 7) * 0.6}s` }); });
  const links = nodes.map((nd, i) => svg('line', { x1: CX, y1: CY, x2: pos[i][0].toFixed(1), y2: pos[i][1].toFixed(1), class: `c-link ${nd.fresh ? 'live' : ''} ${sel === nd.key ? 'on' : ''}`, style: `--c:${nd.color}` }));
  const stars = nodes.map((nd, i) => {
    const [x, y] = pos[i], on = sel === nd.key, r = on ? 27 : 23, circ = 2 * Math.PI * (r + 4);
    const g = svg('g', { class: `c-node ${on ? 'on' : ''} ${nd.fresh ? '' : 'stale'}`, style: `--c:${nd.color}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, role: 'button', tabindex: 0, 'aria-label': `${nd.label}${nd.badge ? `, ${nd.badge} waiting` : ''}`, 'aria-pressed': on ? 'true' : 'false' },
      svg('circle', { r: r + 10, class: 'c-halo' }), svg('circle', { r: r + 4, class: 'c-track' }),
      svg('circle', { r: r + 4, class: 'c-arc', 'stroke-dasharray': `${nd.done ? circ : nd.fresh ? circ * 0.72 : 0} ${circ}`, transform: 'rotate(-90)' }),
      svg('circle', { r, class: 'c-body' }), (() => { const t = svg('text', { class: 'c-icon', 'text-anchor': 'middle', y: 7, 'font-size': on ? 24 : 21 }); t.textContent = nd.icon; return t; })());
    if (nd.badge) { const b = svg('g', { transform: `translate(${r - 4} ${-r + 2})` }, svg('circle', { r: 9, class: 'c-badge' })); const t = svg('text', { class: 'c-badge-t', 'text-anchor': 'middle', y: 3.5 }); t.textContent = nd.badge > 99 ? '99+' : String(nd.badge); b.append(t); g.append(b); }
    const pick = () => onPick(nd.key); g.addEventListener('click', pick); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return g;
  });
  const core = svg('g', { transform: `translate(${CX} ${CY})`, class: 'c-core' }, svg('circle', { r: 46, class: 'c-pulse' }), svg('circle', { r: 46, class: 'c-pulse p2' }), svg('circle', { r: 28, class: 'c-core-body' }));
  const t = svg('text', { class: 'c-core-t', 'text-anchor': 'middle', y: 5 }); t.textContent = 'Citrus'; core.append(t);
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'constellation', role: 'group', 'aria-label': 'Your apps' }, ...dust, svg('ellipse', { cx: CX, cy: CY, rx, ry, class: 'c-orbit' }), ...links, core, ...stars);
}
