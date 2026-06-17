/* Technical line-art helpers: isometric projection, dimensions, bolt circles.
   Slides call ADraw.* to append vector geometry into an <svg> node. Monochrome. */
window.ADraw = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const THEMES = {
    paper: { ink: '#26292e', mid: '#5b5f66', faint: '#9c9fa4', line: '#c2c1bc',
      fTop: '#deddd9', fL: '#cdccc7', fR: '#bbbab5', sphHi: '#efeeea', sphMid: '#cbcac6', sphLo: '#b2b1ac' },
    ink: { ink: '#ecebe7', mid: 'rgba(236,235,231,.74)', faint: 'rgba(236,235,231,.54)', line: 'rgba(236,235,231,.28)',
      fTop: 'rgba(236,235,231,.18)', fL: 'rgba(236,235,231,.10)', fR: 'rgba(236,235,231,.04)', sphHi: 'rgba(236,235,231,.40)', sphMid: 'rgba(236,235,231,.14)', sphLo: 'rgba(236,235,231,.04)' },
  };
  let P = THEMES.paper;
  function setTheme(name) { P = THEMES[name] || THEMES.paper; }
  // live getters so functions always read the active theme
  const INK = () => P.ink, MID = () => P.mid, FAINT = () => P.faint, LINE = () => P.line;
  function el(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  // isometric projection: model [x,y,z] (y up) -> screen [sx,sy]
  function iso(p, o, s) {
    const a = Math.PI / 6, cx = Math.cos(a), sn = Math.sin(a);
    return [o[0] + (p[0] - p[2]) * cx * s, o[1] + ((p[0] + p[2]) * sn - p[1]) * s];
  }
  function line(svg, a, b, o, s, attrs) {
    const A = iso(a, o, s), B = iso(b, o, s);
    svg.appendChild(el('line', Object.assign({ x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: INK(), 'stroke-width': 1.4, 'stroke-linecap': 'round' }, attrs || {})));
  }
  function poly(svg, pts, o, s, attrs) {
    const d = pts.map(p => iso(p, o, s)).map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2)).join(' ') + ' Z';
    svg.appendChild(el('path', Object.assign({ d, fill: 'none', stroke: INK(), 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, attrs || {})));
  }
  // wireframe box: w along +x, h along +y(up), d along +z, anchored at base-corner origin model point m
  function box(svg, m, w, h, d, o, s, attrs) {
    attrs = attrs || {};
    const solid = attrs.solid; const ea = Object.assign({}, attrs); delete ea.solid;
    const [X, Y, Z] = m;
    const v = {
      A: [X, Y, Z], B: [X + w, Y, Z], C: [X + w, Y, Z + d], D: [X, Y, Z + d],
      E: [X, Y + h, Z], F: [X + w, Y + h, Z], G: [X + w, Y + h, Z + d], H: [X, Y + h, Z + d]
    };
    const top = [v.E, v.F, v.G, v.H], front = [v.A, v.B, v.F, v.E], side = [v.B, v.C, v.G, v.F];
    if (solid) {
      // shaded solid: tonal greys per face (monochrome) give 3D depth
      poly(svg, side, o, s, Object.assign({ fill: P.fR }, ea));
      poly(svg, front, o, s, Object.assign({ fill: P.fL }, ea));
      poly(svg, top, o, s, Object.assign({ fill: P.fTop }, ea));
    } else {
      poly(svg, top, o, s, ea); poly(svg, front, o, s, ea); poly(svg, side, o, s, ea);
      const hid = { stroke: FAINT(), 'stroke-width': 0.9, 'stroke-dasharray': '3 3' };
      line(svg, v.A, v.D, o, s, hid); line(svg, v.D, v.C, o, s, hid); line(svg, v.D, v.H, o, s, hid);
    }
    return v;
  }
  // shaded 3D sphere via monochrome radial gradient (call before drawing wireframe over it)
  let gradN = 0;
  function sphereShade(svg, cx, cy, r) {
    const id = 'sph' + (gradN++);
    const defs = el('defs', {});
    const g = el('radialGradient', { id, cx: '37%', cy: '32%', r: '75%' });
    g.appendChild(el('stop', { offset: '0%', 'stop-color': P.sphHi }));
    g.appendChild(el('stop', { offset: '52%', 'stop-color': P.sphMid }));
    g.appendChild(el('stop', { offset: '100%', 'stop-color': P.sphLo }));
    defs.appendChild(g); svg.appendChild(defs);
    svg.appendChild(el('circle', { cx, cy, r, fill: 'url(#' + id + ')' }));
  }
  // ellipse hole on the top face (y const), radius r at model (cx,cz)
  function holeTop(svg, cx, y, cz, r, o, s, attrs) {
    const pts = [];
    for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2; pts.push(iso([cx + r * Math.cos(t), y, cz + r * Math.sin(t)], o, s)); }
    const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2)).join(' ') + ' Z';
    svg.appendChild(el('path', Object.assign({ d, fill: 'none', stroke: INK(), 'stroke-width': 1.2 }, attrs || {})));
  }
  // screen-space dimension line with arrowheads + centered label
  function dimH(svg, x1, x2, y, label, attrs) {
    const c = (attrs && attrs.color) || MID();
    svg.appendChild(el('line', { x1, y1: y, x2, y2: y, stroke: c, 'stroke-width': 1 }));
    arrow(svg, x1, y, 1, c); arrow(svg, x2, y, -1, c);
    const t = el('text', { x: (x1 + x2) / 2, y: y - 7, 'text-anchor': 'middle', fill: c, 'font-family': 'Geist Mono, monospace', 'font-size': 12.5 });
    t.textContent = label; svg.appendChild(t);
  }
  function dimV(svg, y1, y2, x, label, attrs) {
    const c = (attrs && attrs.color) || MID();
    svg.appendChild(el('line', { x1: x, y1, x2: x, y2, stroke: c, 'stroke-width': 1 }));
    arrowV(svg, x, y1, 1, c); arrowV(svg, x, y2, -1, c);
    const t = el('text', { x: x + 9, y: (y1 + y2) / 2 + 4, fill: c, 'font-family': 'Geist Mono, monospace', 'font-size': 12.5 });
    t.textContent = label; svg.appendChild(t);
  }
  function arrow(svg, x, y, dir, c) {
    svg.appendChild(el('path', { d: `M ${x} ${y} l ${7 * dir} -3.5 M ${x} ${y} l ${7 * dir} 3.5`, stroke: c, 'stroke-width': 1, fill: 'none' }));
  }
  function arrowV(svg, x, y, dir, c) {
    svg.appendChild(el('path', { d: `M ${x} ${y} l -3.5 ${7 * dir} M ${x} ${y} l 3.5 ${7 * dir}`, stroke: c, 'stroke-width': 1, fill: 'none' }));
  }
  // leader line + feature tag (callout) in screen space
  function leader(svg, x1, y1, x2, y2, text, opts) {
    opts = opts || {}; const c = opts.color || INK();
    svg.appendChild(el('line', { x1, y1, x2, y2, stroke: c, 'stroke-width': 1 }));
    svg.appendChild(el('circle', { cx: x1, cy: y1, r: 2, fill: c }));
    const anchor = opts.anchor || 'start';
    const tx = anchor === 'end' ? x2 - 6 : x2 + 6;
    const t = el('text', { x: tx, y: y2 - 5, 'text-anchor': anchor, fill: c, 'font-family': 'Geist Mono, monospace', 'font-size': 11.5, 'letter-spacing': '.02em' });
    t.textContent = text; svg.appendChild(t);
  }
  // bolt circle (plan view): pitch circle dashed + N holes
  function boltCircle(svg, cx, cy, R, holeR, n, opts) {
    opts = opts || {};
    svg.appendChild(el('circle', { cx, cy, r: R + holeR + 14, fill: 'none', stroke: INK(), 'stroke-width': 1.4 }));      // OD
    svg.appendChild(el('circle', { cx, cy, r: R, fill: 'none', stroke: FAINT(), 'stroke-width': 1, 'stroke-dasharray': '5 4' })); // PCD
    svg.appendChild(el('circle', { cx, cy, r: 12, fill: 'none', stroke: INK(), 'stroke-width': 1.4 }));                  // bore
    // center mark
    svg.appendChild(el('line', { x1: cx - R - 22, y1: cy, x2: cx + R + 22, y2: cy, stroke: FAINT(), 'stroke-width': 0.8, 'stroke-dasharray': '8 3 2 3' }));
    svg.appendChild(el('line', { x1: cx, y1: cy - R - 22, x2: cx, y2: cy + R + 22, stroke: FAINT(), 'stroke-width': 0.8, 'stroke-dasharray': '8 3 2 3' }));
    for (let i = 0; i < n; i++) {
      const t = -Math.PI / 2 + i / n * Math.PI * 2;
      const hx = cx + R * Math.cos(t), hy = cy + R * Math.sin(t);
      svg.appendChild(el('circle', { cx: hx, cy: hy, r: holeR, fill: 'none', stroke: INK(), 'stroke-width': 1.3 }));
      svg.appendChild(el('line', { x1: hx - holeR - 3, y1: hy, x2: hx + holeR + 3, y2: hy, stroke: FAINT(), 'stroke-width': 0.7 }));
      svg.appendChild(el('line', { x1: hx, y1: hy - holeR - 3, x2: hx, y2: hy + holeR + 3, stroke: FAINT(), 'stroke-width': 0.7 }));
    }
  }
  return { el, iso, line, poly, box, holeTop, dimH, dimV, leader, boltCircle, sphereShade, setTheme, INK, MID, FAINT, LINE };
})();
