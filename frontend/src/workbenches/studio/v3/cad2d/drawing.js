// ArchDisc Studio V3 — AutoCAD-style 2D drawing engine (slice 774).
//
// `class Drawing { name, entities, layers }` is the persistent
// document. The drawing keeps a flat ordered list of entities + a
// `Map<layerName, {color, visible}>` layer table; rendering walks the
// entity list in order so callers control z-order via insertion.
//
// `toSVG()` serialises the drawing to a self-contained SVG XML string
// in user-coordinate space. The SVG viewBox is computed from the
// drawing's bounding box (with a small margin). Y is flipped at export
// time (AutoCAD's drawing space has +Y up; SVG has +Y down) — every
// y-coordinate the entity carries is emitted as -y in the SVG so the
// rendered drawing looks the same in a browser as it would in AutoCAD.
//
// Pure JS, no THREE dependency — works headless from tests.

import { isEntity, KNOWN_KINDS } from './entities.js';

// ─── helpers ───────────────────────────────────────────────────────────────

let _entitySeq = 1;
function _eid() { return `cad2de-${_entitySeq++}-${Date.now().toString(36)}`; }

// XML-escape user-controlled text content for <text/> bodies.
function _xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Format a number for SVG attribute output — trims trailing zeros,
// caps at 4 decimal places so the output stays human-readable.
function _fmt(n) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10000) / 10000;
  // toFixed-style without forcing decimals.
  let s = String(r);
  if (s.indexOf('e') !== -1) s = r.toFixed(4);
  return s;
}

// Resolve the stroke colour for an entity — prefer the entity's own
// colour, fall back to the layer's, then to '#000000'.
function _strokeColor(drawing, ent) {
  if (ent.color) return ent.color;
  const L = drawing.layers.get(ent.layer || '0');
  if (L && L.color) return L.color;
  return '#000000';
}

// True iff the entity's layer is visible (or the layer is missing — we
// treat missing layers as visible-on-layer-0 for graceful degradation).
function _isVisible(drawing, ent) {
  const L = drawing.layers.get(ent.layer || '0');
  if (!L) return true;
  return L.visible !== false;
}

// ─── entity bbox / SVG emitters (per kind) ─────────────────────────────────

function _bboxOf(ent) {
  const p = ent.params;
  switch (ent.kind) {
    case 'line': {
      return [Math.min(p.p1[0], p.p2[0]), Math.min(p.p1[1], p.p2[1]),
              Math.max(p.p1[0], p.p2[0]), Math.max(p.p1[1], p.p2[1])];
    }
    case 'polyline': {
      if (!p.points.length) return [0, 0, 0, 0];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of p.points) {
        if (pt[0] < minX) minX = pt[0]; if (pt[1] < minY) minY = pt[1];
        if (pt[0] > maxX) maxX = pt[0]; if (pt[1] > maxY) maxY = pt[1];
      }
      return [minX, minY, maxX, maxY];
    }
    case 'circle': {
      return [p.center[0] - p.radius, p.center[1] - p.radius,
              p.center[0] + p.radius, p.center[1] + p.radius];
    }
    case 'arc': {
      // Approximation: use full bounding circle (correct for any arc;
      // never under-estimates the bbox).
      return [p.center[0] - p.radius, p.center[1] - p.radius,
              p.center[0] + p.radius, p.center[1] + p.radius];
    }
    case 'rectangle': {
      return [Math.min(p.p1[0], p.p2[0]), Math.min(p.p1[1], p.p2[1]),
              Math.max(p.p1[0], p.p2[0]), Math.max(p.p1[1], p.p2[1])];
    }
    case 'dimensionLinear': {
      // bbox = p1, p2, and the projected offset line endpoints.
      const dx = p.p2[0] - p.p1[0];
      const dy = p.p2[1] - p.p1[1];
      const L = Math.hypot(dx, dy) || 1;
      // unit-perpendicular (rotate (dx,dy) by +90°): (-dy, dx)/L
      const nx = -dy / L, ny = dx / L;
      const a = [p.p1[0] + nx * p.offset, p.p1[1] + ny * p.offset];
      const b = [p.p2[0] + nx * p.offset, p.p2[1] + ny * p.offset];
      return [
        Math.min(p.p1[0], p.p2[0], a[0], b[0]),
        Math.min(p.p1[1], p.p2[1], a[1], b[1]),
        Math.max(p.p1[0], p.p2[0], a[0], b[0]),
        Math.max(p.p1[1], p.p2[1], a[1], b[1]),
      ];
    }
    case 'text': {
      // Rough: assume average glyph 0.6 × size wide.
      const w = p.size * 0.6 * (p.content.length || 1);
      return [p.position[0], p.position[1], p.position[0] + w, p.position[1] + p.size];
    }
    default:
      return [0, 0, 0, 0];
  }
}

// Drawing-space → SVG-space y-flip. The SVG document uses a viewBox
// whose y0 = -bboxMaxY so that the drawing's +Y still points up
// visually.
function _svgY(y) { return -y; }

function _emitLine(p) {
  return `<line x1="${_fmt(p.p1[0])}" y1="${_fmt(_svgY(p.p1[1]))}" x2="${_fmt(p.p2[0])}" y2="${_fmt(_svgY(p.p2[1]))}"/>`;
}

function _emitPolyline(p) {
  const pts = p.points.map((pt) => `${_fmt(pt[0])},${_fmt(_svgY(pt[1]))}`).join(' ');
  return p.closed
    ? `<polygon points="${pts}"/>`
    : `<polyline points="${pts}"/>`;
}

function _emitCircle(p) {
  return `<circle cx="${_fmt(p.center[0])}" cy="${_fmt(_svgY(p.center[1]))}" r="${_fmt(p.radius)}"/>`;
}

function _emitArc(p) {
  // SVG arc via path's A command. Compute endpoints + large-arc flag
  // + sweep flag. Note: angles are CCW in drawing space; SVG sweep=1
  // is CW in SVG-space which is CCW in drawing-space after the y flip.
  const sx = p.center[0] + p.radius * Math.cos(p.startAngle);
  const sy = p.center[1] + p.radius * Math.sin(p.startAngle);
  const ex = p.center[0] + p.radius * Math.cos(p.endAngle);
  const ey = p.center[1] + p.radius * Math.sin(p.endAngle);
  const delta = p.endAngle - p.startAngle;
  const large = Math.abs(delta) > Math.PI ? 1 : 0;
  // In drawing space (y-up) CCW = positive sweep; after y-flip we
  // need sweep=1 to keep the arc going the same visual way.
  const sweep = delta >= 0 ? 0 : 1;
  return `<path d="M ${_fmt(sx)} ${_fmt(_svgY(sy))} A ${_fmt(p.radius)} ${_fmt(p.radius)} 0 ${large} ${sweep} ${_fmt(ex)} ${_fmt(_svgY(ey))}" fill="none"/>`;
}

function _emitRectangle(p) {
  const x = Math.min(p.p1[0], p.p2[0]);
  const yMax = Math.max(p.p1[1], p.p2[1]);
  const w = Math.abs(p.p2[0] - p.p1[0]);
  const h = Math.abs(p.p2[1] - p.p1[1]);
  // In SVG space the rect's y is the TOP-left; drawing's yMax flips
  // to the SVG top.
  return `<rect x="${_fmt(x)}" y="${_fmt(_svgY(yMax))}" width="${_fmt(w)}" height="${_fmt(h)}" fill="none"/>`;
}

function _emitDimension(p, color, label) {
  const dx = p.p2[0] - p.p1[0];
  const dy = p.p2[1] - p.p1[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const a = [p.p1[0] + nx * p.offset, p.p1[1] + ny * p.offset];
  const b = [p.p2[0] + nx * p.offset, p.p2[1] + ny * p.offset];
  // Extension lines + main dim line.
  const parts = [];
  parts.push(`<line x1="${_fmt(p.p1[0])}" y1="${_fmt(_svgY(p.p1[1]))}" x2="${_fmt(a[0])}" y2="${_fmt(_svgY(a[1]))}"/>`);
  parts.push(`<line x1="${_fmt(p.p2[0])}" y1="${_fmt(_svgY(p.p2[1]))}" x2="${_fmt(b[0])}" y2="${_fmt(_svgY(b[1]))}"/>`);
  parts.push(`<line x1="${_fmt(a[0])}" y1="${_fmt(_svgY(a[1]))}" x2="${_fmt(b[0])}" y2="${_fmt(_svgY(b[1]))}"/>`);
  // Tick marks at endpoints (small ± perpendicular).
  const tick = Math.min(len, Math.abs(p.offset) || 1) * 0.05 + 0.02;
  const tdx = (dx / len) * tick;
  const tdy = (dy / len) * tick;
  parts.push(`<line x1="${_fmt(a[0] - tdx)}" y1="${_fmt(_svgY(a[1] - tdy))}" x2="${_fmt(a[0] + tdx)}" y2="${_fmt(_svgY(a[1] + tdy))}"/>`);
  parts.push(`<line x1="${_fmt(b[0] - tdx)}" y1="${_fmt(_svgY(b[1] - tdy))}" x2="${_fmt(b[0] + tdx)}" y2="${_fmt(_svgY(b[1] + tdy))}"/>`);
  // Dimension label.
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const labelText = label != null ? label : _fmt(len);
  parts.push(`<text x="${_fmt(mid[0])}" y="${_fmt(_svgY(mid[1]) - 4)}" font-size="12" fill="${color}" text-anchor="middle">${_xmlEscape(labelText)}</text>`);
  return parts.join('');
}

function _emitText(p, color) {
  return `<text x="${_fmt(p.position[0])}" y="${_fmt(_svgY(p.position[1]))}" font-size="${_fmt(p.size)}" fill="${color}">${_xmlEscape(p.content)}</text>`;
}

// ─── Drawing class ─────────────────────────────────────────────────────────

export class Drawing {
  constructor(name) {
    this.name = String(name || 'Unnamed');
    this.entities = [];
    this.layers = new Map();
    // Seed layer '0' (AutoCAD's default white layer; we use #000000 on
    // a white SVG background).
    this.layers.set('0', { color: '#000000', visible: true });
  }

  // Push an entity onto the drawing; assigns an `id` if missing.
  addEntity(ent) {
    if (!isEntity(ent)) return { ok: false, error: 'not-an-entity' };
    // Ensure the entity's layer exists; auto-create at default colour.
    const layerName = ent.layer || '0';
    if (!this.layers.has(layerName)) {
      this.layers.set(layerName, { color: '#000000', visible: true });
    }
    ent.id = ent.id || _eid();
    this.entities.push(ent);
    return { ok: true, entityId: ent.id };
  }

  // Remove an entity by id; returns the removed entity (or null).
  removeEntity(id) {
    const idx = this.entities.findIndex((e) => e.id === id);
    if (idx < 0) return null;
    const [removed] = this.entities.splice(idx, 1);
    return removed;
  }

  // Re-layer an entity. Auto-creates the target layer if missing.
  setLayer(entityId, layerName, opts) {
    const ent = this.entities.find((e) => e.id === entityId);
    if (!ent) return { ok: false };
    if (!this.layers.has(layerName)) {
      this.layers.set(layerName, {
        color: (opts && opts.color) || '#000000',
        visible: opts && opts.visible !== undefined ? !!opts.visible : true,
      });
    }
    ent.layer = layerName;
    return { ok: true };
  }

  // Define / update a named layer (color + visibility).
  defineLayer(name, opts) {
    if (!name || typeof name !== 'string') return { ok: false };
    const prev = this.layers.get(name) || { color: '#000000', visible: true };
    this.layers.set(name, {
      color: (opts && opts.color) || prev.color,
      visible: opts && opts.visible !== undefined ? !!opts.visible : prev.visible,
    });
    return { ok: true };
  }

  // Compute the bbox of the drawing (in drawing coordinates). Returns
  // [minX, minY, maxX, maxY]. Empty drawings return a unit box.
  bbox() {
    if (!this.entities.length) return [0, 0, 1, 1];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of this.entities) {
      if (!isEntity(e)) continue;
      const [a, b, c, d] = _bboxOf(e);
      if (a < minX) minX = a; if (b < minY) minY = b;
      if (c > maxX) maxX = c; if (d > maxY) maxY = d;
    }
    if (!Number.isFinite(minX)) return [0, 0, 1, 1];
    return [minX, minY, maxX, maxY];
  }

  // Serialise the drawing to a self-contained SVG XML string.
  toSVG(opts) {
    const margin = (opts && Number.isFinite(opts.margin)) ? opts.margin : 4;
    const [minX, minY, maxX, maxY] = this.bbox();
    // Y-flip the bbox into SVG space.
    const ymin = -maxY;
    const ymax = -minY;
    const w = Math.max(1, (maxX - minX) + margin * 2);
    const h = Math.max(1, (ymax - ymin) + margin * 2);
    const vbX = minX - margin;
    const vbY = ymin - margin;
    const parts = [];
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${_fmt(vbX)} ${_fmt(vbY)} ${_fmt(w)} ${_fmt(h)}" width="${_fmt(w * 8)}" height="${_fmt(h * 8)}" data-archdisc-drawing="${_xmlEscape(this.name)}">`);
    parts.push(`<title>${_xmlEscape(this.name)}</title>`);
    // White paper.
    parts.push(`<rect x="${_fmt(vbX)}" y="${_fmt(vbY)}" width="${_fmt(w)}" height="${_fmt(h)}" fill="#ffffff"/>`);

    // Stroke width scales with bbox so a 1m line on a 100m drawing is
    // still legible.
    const strokeW = Math.max((maxX - minX), (maxY - minY)) * 0.002 + 0.01;

    // Group entities by layer for clean SVG output + stable z-order
    // within the layer (insertion order).
    // For determinism we emit layer '0' first, then any other layer
    // sorted lexicographically.
    const byLayer = new Map();
    for (const ent of this.entities) {
      if (!isEntity(ent)) continue;
      if (!_isVisible(this, ent)) continue;
      const L = ent.layer || '0';
      if (!byLayer.has(L)) byLayer.set(L, []);
      byLayer.get(L).push(ent);
    }
    const layerNames = Array.from(byLayer.keys()).sort((a, b) => {
      if (a === '0') return -1;
      if (b === '0') return 1;
      return a.localeCompare(b);
    });
    for (const L of layerNames) {
      parts.push(`<g data-layer="${_xmlEscape(L)}" fill="none" stroke-width="${_fmt(strokeW)}">`);
      for (const ent of byLayer.get(L)) {
        const color = _strokeColor(this, ent);
        switch (ent.kind) {
          case 'line':
            parts.push(`<g stroke="${color}">${_emitLine(ent.params)}</g>`);
            break;
          case 'polyline':
            parts.push(`<g stroke="${color}">${_emitPolyline(ent.params)}</g>`);
            break;
          case 'arc':
            parts.push(`<g stroke="${color}">${_emitArc(ent.params)}</g>`);
            break;
          case 'circle':
            parts.push(`<g stroke="${color}">${_emitCircle(ent.params)}</g>`);
            break;
          case 'rectangle':
            parts.push(`<g stroke="${color}">${_emitRectangle(ent.params)}</g>`);
            break;
          case 'dimensionLinear':
            parts.push(`<g stroke="${color}">${_emitDimension(ent.params, color, ent.params.label)}</g>`);
            break;
          case 'text':
            // <text/> uses fill, not stroke.
            parts.push(_emitText(ent.params, color));
            break;
          default:
            // Unknown kind — skipped (KNOWN_KINDS already gates this).
            break;
        }
      }
      parts.push('</g>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  // Statistics projection — used by the list op + verifier tests.
  stats() {
    const perKind = {};
    for (const ent of this.entities) {
      if (!isEntity(ent)) continue;
      perKind[ent.kind] = (perKind[ent.kind] || 0) + 1;
    }
    return {
      name: this.name,
      entityCount: this.entities.length,
      layerCount: this.layers.size,
      perKind,
      bbox: this.bbox(),
    };
  }
}

// Re-export for tests / external consumers.
export { KNOWN_KINDS };
