// ArchDisc Studio V3 — AutoCAD-style 2D drawing layer (slice 774).
//
// Entity factories for the 2D CAD primitives the drawing engine
// understands. Every entity is a plain JSON-safe object of shape:
//
//   { kind: string, params: {...}, layer: string, color: string }
//
// `kind` is the discriminator (e.g. 'line' / 'circle' / 'arc' /
// 'rectangle' / 'polyline' / 'dimensionLinear' / 'text'). `params`
// holds the geometric payload (points / radii / angles / text). The
// `layer` slot mirrors AutoCAD's named layer concept — the drawing
// keeps a `Map<layerName, {color, visible}>` and entities default to
// their layer's colour when their own `color` field is null.
//
// Pure JS, no THREE dependency — these factories are usable headless
// from tests / API callers without booting the viewport.

// ─── tiny helpers ───────────────────────────────────────────────────────────

function _vec2(p, fallback) {
  if (!p) return fallback ? fallback.slice() : [0, 0];
  if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0];
  if (typeof p === 'object') {
    return [Number(p.x) || 0, Number(p.y) || 0];
  }
  return fallback ? fallback.slice() : [0, 0];
}

function _num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _opts(extra) {
  const o = extra || {};
  return {
    layer: typeof o.layer === 'string' && o.layer ? o.layer : '0',
    color: typeof o.color === 'string' && o.color ? o.color : null,
  };
}

// ─── public factories ──────────────────────────────────────────────────────

// `line(p1, p2)` — straight line from p1 to p2.
export function line(p1, p2, extra) {
  const a = _vec2(p1, [0, 0]);
  const b = _vec2(p2, [1, 0]);
  return { kind: 'line', params: { p1: a, p2: b }, ..._opts(extra) };
}

// `polyline(points)` — chained line segments through N points; N>=2.
export function polyline(points, extra) {
  const pts = Array.isArray(points) ? points.map((p) => _vec2(p, [0, 0])) : [];
  return { kind: 'polyline', params: { points: pts, closed: !!(extra && extra.closed) }, ..._opts(extra) };
}

// `arc(center, radius, startAngle, endAngle)` — angles in radians,
// CCW from +X. A full circle is endAngle - startAngle = 2π.
export function arc(center, radius, startAngle, endAngle, extra) {
  return {
    kind: 'arc',
    params: {
      center: _vec2(center, [0, 0]),
      radius: Math.max(0, _num(radius, 1)),
      startAngle: _num(startAngle, 0),
      endAngle: _num(endAngle, Math.PI),
    },
    ..._opts(extra),
  };
}

// `circle(center, radius)` — full circle.
export function circle(center, radius, extra) {
  return {
    kind: 'circle',
    params: {
      center: _vec2(center, [0, 0]),
      radius: Math.max(0, _num(radius, 1)),
    },
    ..._opts(extra),
  };
}

// `rectangle(p1, p2)` — axis-aligned rectangle with opposite corners
// p1, p2. Stored as the two corners so the SVG export can emit the
// canonical <rect/> element with min/extent.
export function rectangle(p1, p2, extra) {
  return {
    kind: 'rectangle',
    params: {
      p1: _vec2(p1, [0, 0]),
      p2: _vec2(p2, [1, 1]),
    },
    ..._opts(extra),
  };
}

// `dimensionLinear(p1, p2, offset)` — AutoCAD-style linear dimension.
// `offset` is the perpendicular distance from the p1→p2 line at which
// the dimension line sits (positive = left of the direction vector).
// The drawing engine renders this as: two extension lines from p1/p2
// to the offset line + an arrow-capped dimension line + the measured
// length as <text/> above the dimension line.
export function dimensionLinear(p1, p2, offset, extra) {
  return {
    kind: 'dimensionLinear',
    params: {
      p1: _vec2(p1, [0, 0]),
      p2: _vec2(p2, [1, 0]),
      offset: _num(offset, 0.5),
    },
    ..._opts(extra),
  };
}

// `text(position, content, size)` — single-line annotation. `size`
// drives the SVG font-size; default 12.
export function text(position, content, size, extra) {
  return {
    kind: 'text',
    params: {
      position: _vec2(position, [0, 0]),
      content: typeof content === 'string' ? content : String(content == null ? '' : content),
      size: Math.max(1, _num(size, 12)),
    },
    ..._opts(extra),
  };
}

// Sanity / type-guard helper used by drawing.toSVG() to skip any
// foreign object that slipped into the entity list (e.g. via JSON
// import). Exported for tests.
export const KNOWN_KINDS = new Set([
  'line', 'polyline', 'arc', 'circle', 'rectangle', 'dimensionLinear', 'text',
]);

export function isEntity(e) {
  return !!(e && typeof e === 'object' && KNOWN_KINDS.has(e.kind) && e.params && typeof e.params === 'object');
}
