// ArchDisc Studio V3 — bezier animation curve state + sampler.
//
// A "curve" here is a per-(mesh.uuid, property, channel) collection of
// keyframes. Each keyframe carries a value AND two tangent handles
// (inHandle pointing back to the previous key, outHandle pointing
// toward the next key). The sampler interpolates between adjacent
// keyframes using cubic bezier segments, with optional 'linear' and
// 'step' modes per-key for blender-graph-style flexibility.
//
//   key = {
//     time:        number  seconds
//     value:       number  scalar (one curve per channel — caller
//                          authors separate curves for x/y/z so the
//                          graph editor stays 2D)
//     inHandle:    { x, y }  offset in (time, value) from the key
//     outHandle:   { x, y }  offset in (time, value) from the key
//     interp:      'bezier' | 'linear' | 'step'   (per-segment, applied
//                                                  to the segment that
//                                                  STARTS at this key)
//   }
//
// A `curve` is { uuid, meshUuid, property, channel, keys: [...] } where
// `property` is one of 'position' | 'rotation' | 'scale' and `channel`
// is 0..2 (x/y/z index). The playback driver assembles per-mesh
// transforms by sampling all matching curves at the current time.
//
// All exports are pure functions — no global state, no DOM, no THREE.
// The orchestrator (index.js) keeps an in-memory Map of curves keyed by
// uuid; tests can also build curves directly for sampling unit checks.

let _seq = 1;
function _uuid() {
  // Cheap monotonic id — collision-free within one page-load. Keeps the
  // window surface deterministic for e2e assertions.
  _seq += 1;
  return `anim-curve-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

const DEFAULT_HANDLE_DX = 0.1;   // seconds; cushiony default tangent

/**
 * Build a fresh curve descriptor.
 *
 * @param {string} meshUuid
 * @param {string} property  'position' | 'rotation' | 'scale'
 * @param {number} channel   0=x, 1=y, 2=z
 * @returns {object} curve
 */
export function createCurve(meshUuid, property, channel) {
  return {
    uuid: _uuid(),
    meshUuid: String(meshUuid),
    property: String(property),
    channel: Number(channel) || 0,
    keys: [],
  };
}

/**
 * Make a fresh keyframe with sensible default tangent handles. Default
 * tangents are flat (handle.y = 0) so a brand-new key looks like a
 * "constant" segment until the user drags them.
 */
export function makeKey(time, value, inHandle, outHandle, interp) {
  const t = Number(time) || 0;
  const v = Number(value) || 0;
  return {
    time: t,
    value: v,
    inHandle: _normalizeHandle(inHandle, -DEFAULT_HANDLE_DX, 0),
    outHandle: _normalizeHandle(outHandle,  DEFAULT_HANDLE_DX, 0),
    interp: _normalizeInterp(interp),
  };
}

function _normalizeHandle(h, defX, defY) {
  if (!h || typeof h !== 'object') return { x: defX, y: defY };
  const x = Number.isFinite(h.x) ? Number(h.x) : defX;
  const y = Number.isFinite(h.y) ? Number(h.y) : defY;
  return { x, y };
}

function _normalizeInterp(v) {
  if (v === 'linear' || v === 'step' || v === 'bezier') return v;
  return 'bezier';
}

/**
 * Insert a key into the curve; keeps `keys` sorted by time. If a key
 * already exists at the same time (within 1e-4 s), it's replaced.
 *
 * @returns {number} the resulting keyframe count
 */
export function addKey(curve, time, value, inHandle, outHandle, interp) {
  if (!curve || !Array.isArray(curve.keys)) return 0;
  const key = makeKey(time, value, inHandle, outHandle, interp);
  const i = curve.keys.findIndex((k) => Math.abs(k.time - key.time) < 1e-4);
  if (i >= 0) curve.keys[i] = key;
  else curve.keys.push(key);
  curve.keys.sort((a, b) => a.time - b.time);
  return curve.keys.length;
}

export function deleteKey(curve, idx) {
  if (!curve || !Array.isArray(curve.keys)) return 0;
  const i = Number(idx);
  if (!(i >= 0 && i < curve.keys.length)) return curve.keys.length;
  curve.keys.splice(i, 1);
  return curve.keys.length;
}

export function setKeyInterp(curve, idx, interp) {
  if (!curve || !Array.isArray(curve.keys)) return false;
  const i = Number(idx);
  if (!(i >= 0 && i < curve.keys.length)) return false;
  curve.keys[i].interp = _normalizeInterp(interp);
  return true;
}

export function moveKey(curve, idx, time, value) {
  if (!curve || !Array.isArray(curve.keys)) return false;
  const i = Number(idx);
  if (!(i >= 0 && i < curve.keys.length)) return false;
  const k = curve.keys[i];
  if (Number.isFinite(time)) k.time = Number(time);
  if (Number.isFinite(value)) k.value = Number(value);
  curve.keys.sort((a, b) => a.time - b.time);
  return true;
}

export function setKeyHandle(curve, idx, which, x, y) {
  if (!curve || !Array.isArray(curve.keys)) return false;
  const i = Number(idx);
  if (!(i >= 0 && i < curve.keys.length)) return false;
  const k = curve.keys[i];
  const target = which === 'in' ? k.inHandle : (which === 'out' ? k.outHandle : null);
  if (!target) return false;
  if (Number.isFinite(x)) target.x = Number(x);
  if (Number.isFinite(y)) target.y = Number(y);
  return true;
}

/**
 * Curve duration = last key's time, 0 if empty.
 */
export function curveDuration(curve) {
  if (!curve || !curve.keys || !curve.keys.length) return 0;
  return curve.keys[curve.keys.length - 1].time;
}

// ─── Sampler ──────────────────────────────────────────────────────────

/**
 * Solve cubic-bezier x(s) = t for s ∈ [0, 1] given:
 *   x0 = 0
 *   x1 = (h0x) / dt        (out-handle of the left key in normalised seg time)
 *   x2 = 1 + (h1x) / dt    (in-handle of the right key, also normalised)
 *   x3 = 1
 *
 * Uses Newton-Raphson with a bisection fallback. Matches Blender / AE
 * eased-curve behaviour where the time axis isn't uniformly mapped.
 */
function _solveBezierX(targetX, x1, x2) {
  // Clamp control points so the segment stays monotonic-ish. Without
  // this, a user dragging handles past the next key produces NaN s.
  const cx1 = Math.max(0, Math.min(1, x1));
  const cx2 = Math.max(0, Math.min(1, x2));

  // Bezier basis: x(s) = 3*(1-s)^2*s*cx1 + 3*(1-s)*s^2*cx2 + s^3
  const sampleX = (s) => {
    const omS = 1 - s;
    return 3 * omS * omS * s * cx1 + 3 * omS * s * s * cx2 + s * s * s;
  };
  const sampleDX = (s) => {
    const omS = 1 - s;
    return 3 * omS * omS * cx1
         + 6 * omS * s * (cx2 - cx1)
         + 3 * s * s * (1 - cx2);
  };

  // Initial guess: linear time. 6 Newton steps gets sub-pixel accuracy
  // for handles in the [0, 1] band.
  let s = Math.max(0, Math.min(1, targetX));
  for (let i = 0; i < 6; i++) {
    const xs = sampleX(s);
    const dx = sampleDX(s);
    if (Math.abs(dx) < 1e-8) break;
    const next = s - (xs - targetX) / dx;
    if (!Number.isFinite(next)) break;
    s = Math.max(0, Math.min(1, next));
  }
  // Bisection cleanup for the edge cases.
  let lo = 0, hi = 1;
  for (let i = 0; i < 8; i++) {
    const xs = sampleX(s);
    if (Math.abs(xs - targetX) < 1e-5) break;
    if (xs < targetX) lo = s; else hi = s;
    s = 0.5 * (lo + hi);
  }
  return s;
}

function _bezierY(s, y1, y2) {
  // y0 = 0, y3 = 1; (y1, y2) are normalised handle deltas already.
  const omS = 1 - s;
  return 3 * omS * omS * s * y1 + 3 * omS * s * s * y2 + s * s * s;
}

/**
 * Sample the curve at time `t`. Returns the interpolated value.
 *
 * Behaviour:
 *   • t before the first key → first key's value (constant clamp)
 *   • t after the last key   → last key's value
 *   • on each segment, the LEFT key's `interp` chooses the mode:
 *       - 'step'   → left value until the right key, then right
 *       - 'linear' → straight lerp
 *       - 'bezier' → cubic with both handle vectors honoured
 *
 * The bezier basis uses (dt, dv) = (rightKey.time - leftKey.time,
 * rightKey.value - leftKey.value) as the segment's local space. Handle
 * x components are in *seconds*, y components in *value units*; we
 * normalise into [0, 1] x [0, 1] before evaluating.
 */
export function sample(curve, t) {
  if (!curve || !curve.keys || !curve.keys.length) return 0;
  const time = Number(t) || 0;
  const keys = curve.keys;
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;

  // Locate bracketing keys via linear scan (curves are small — <100
  // keys is typical; binary search is overkill).
  let i = 0;
  for (; i < keys.length - 1; i++) {
    if (time >= keys[i].time && time <= keys[i + 1].time) break;
  }
  const a = keys[i];
  const b = keys[i + 1];
  const dt = b.time - a.time;
  if (dt <= 0) return a.value;

  const interp = a.interp || 'bezier';
  if (interp === 'step') return a.value;

  const tNorm = (time - a.time) / dt;

  if (interp === 'linear') {
    return a.value + (b.value - a.value) * tNorm;
  }

  // Bezier path. Handle x components are absolute seconds offsets from
  // their owning key, so we normalise into segment-local [0, 1].
  const dv = b.value - a.value;
  const h0x = a.outHandle ? Number(a.outHandle.x) / dt : 0.333;
  const h0y = a.outHandle ? Number(a.outHandle.y) : 0;
  const h1xRaw = b.inHandle ? Number(b.inHandle.x) / dt : -0.333;
  const h1yRaw = b.inHandle ? Number(b.inHandle.y) : 0;
  // The in-handle of b points BACK toward a, so its x is negative.
  // Convert to "from a's perspective" so the basis above sees x2 ∈ [0,1].
  const x1 = Math.max(0, Math.min(1, h0x));
  const x2 = Math.max(0, Math.min(1, 1 + h1xRaw));
  // y handles: when dv != 0, normalise so handle y of +dv lands on 1.
  // For flat segments (dv == 0) the y handles act as absolute units,
  // which lets the user "pop" values up and down even on a constant
  // baseline — Blender does the same.
  let y1, y2;
  if (Math.abs(dv) > 1e-9) {
    y1 = h0y / dv;
    y2 = 1 + h1yRaw / dv;
  } else {
    // Flat baseline: keep value at a.value plus the absolute handle
    // contribution scaled by ease.
    y1 = h0y;
    y2 = h1yRaw;
  }

  const s = _solveBezierX(tNorm, x1, x2);
  const yNorm = _bezierY(s, y1, y2);
  if (Math.abs(dv) > 1e-9) return a.value + dv * yNorm;
  // Flat-baseline mode: yNorm is in absolute value units.
  return a.value + yNorm;
}

// ─── Serialisation ───────────────────────────────────────────────────

export function curveToJSON(curve) {
  if (!curve) return null;
  return {
    uuid: curve.uuid,
    meshUuid: curve.meshUuid,
    property: curve.property,
    channel: curve.channel,
    keys: curve.keys.map((k) => ({
      time: k.time, value: k.value,
      inHandle: { ...k.inHandle },
      outHandle: { ...k.outHandle },
      interp: k.interp,
    })),
  };
}

export function curveFromJSON(json) {
  if (!json || typeof json !== 'object') return null;
  const c = {
    uuid: json.uuid || _uuid(),
    meshUuid: String(json.meshUuid || ''),
    property: String(json.property || 'position'),
    channel: Number(json.channel) || 0,
    keys: [],
  };
  for (const k of (json.keys || [])) {
    c.keys.push(makeKey(k.time, k.value, k.inHandle, k.outHandle, k.interp));
  }
  c.keys.sort((a, b) => a.time - b.time);
  return c;
}
