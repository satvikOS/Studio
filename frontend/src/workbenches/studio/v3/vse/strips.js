// ArchDisc Studio V3 — VSE strip data model.
//
// A "strip" is a single time-bounded clip on a horizontal track. Three
// kinds are supported in this slice:
//
//   image        — a static dataURL painted to the buffer.
//   viewport     — calls __studioExportSnapshotPng() at scrub-time to
//                  grab the live 3D viewport as a fresh PNG dataURL.
//   colorcorrect — overlay strip; instead of producing pixels of its
//                  own, it takes the buffer already composed beneath
//                  it and applies per-pixel gain/gamma/contrast +
//                  optional tint. Works because compose.js walks
//                  channels bottom-up; the colorcorrect strip mutates
//                  whatever sits below it.
//
// Channels: channel 1 is the lowest (drawn first); higher channels
// overlay lower ones. This is Blender VSE's convention.
//
// Strip shape:
//   { uuid, kind, channel, startTime, endTime, params, _imageCache? }
//
// params per kind:
//   image:        { dataUrl }
//   viewport:     { width?, height? }
//   colorcorrect: { gain?, gamma?, contrast?, tint?: [r,g,b] }

let _seq = 0;

function genUuid() {
  // Studio-internal uuids only need to be stable per-session; full
  // crypto.randomUUID isn't worth the polyfill weight in headless
  // contexts. Mirrors the curves.js + graph.js conventions.
  _seq += 1;
  return `vse-strip-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

export function createStrip(kind, channel, startTime, endTime, params) {
  const k = String(kind || '').toLowerCase();
  if (k !== 'image' && k !== 'viewport' && k !== 'colorcorrect') {
    throw new Error(`unknown strip kind: ${kind}`);
  }
  const ch = Math.max(1, Math.floor(Number(channel) || 1));
  let s = Number(startTime);
  let e = Number(endTime);
  if (!Number.isFinite(s)) s = 0;
  if (!Number.isFinite(e)) e = s + 1;
  if (e < s) { const t = s; s = e; e = t; }
  const p = sanitizeParams(k, params || {});
  return {
    uuid: genUuid(),
    kind: k,
    channel: ch,
    startTime: s,
    endTime: e,
    params: p,
    _imageCache: null,           // populated lazily by compose.js
    _imageCacheKey: null,
  };
}

export function sanitizeParams(kind, params) {
  const p = params && typeof params === 'object' ? params : {};
  if (kind === 'image') {
    return {
      dataUrl: typeof p.dataUrl === 'string' ? p.dataUrl : '',
    };
  }
  if (kind === 'viewport') {
    return {
      width: Math.max(64, Math.floor(Number(p.width) || 512)),
      height: Math.max(64, Math.floor(Number(p.height) || 512)),
    };
  }
  if (kind === 'colorcorrect') {
    const tint = Array.isArray(p.tint) && p.tint.length === 3
      ? [Number(p.tint[0]) || 1, Number(p.tint[1]) || 1, Number(p.tint[2]) || 1]
      : [1, 1, 1];
    return {
      gain: Number.isFinite(+p.gain) ? +p.gain : 1.0,
      gamma: Number.isFinite(+p.gamma) ? Math.max(0.05, +p.gamma) : 1.0,
      contrast: Number.isFinite(+p.contrast) ? +p.contrast : 1.0,
      tint,
    };
  }
  return p;
}

export function mergeParams(strip, partial) {
  const next = { ...strip.params, ...(partial || {}) };
  strip.params = sanitizeParams(strip.kind, next);
  // Invalidate any cached pixels so the next compose re-pulls the
  // source (e.g. a swapped dataURL).
  strip.params._imageCache = null;
  strip._imageCache = null;
  strip._imageCacheKey = null;
  return strip.params;
}

// True iff time t lies within [startTime, endTime).
// We use a half-open interval so a strip ending exactly when another
// begins doesn't double-render at the boundary.
export function isActiveAt(strip, t) {
  return t >= strip.startTime && t < strip.endTime;
}

// JSON shape — same as the runtime shape minus the lazy caches.
export function stripToJSON(strip) {
  return {
    uuid: strip.uuid,
    kind: strip.kind,
    channel: strip.channel,
    startTime: strip.startTime,
    endTime: strip.endTime,
    params: { ...strip.params },
  };
}

export function stripFromJSON(json) {
  if (!json) return null;
  const s = createStrip(json.kind, json.channel, json.startTime, json.endTime, json.params);
  // Preserve the original uuid so external references survive a
  // round-trip — createStrip would have minted a new one.
  if (json.uuid) s.uuid = json.uuid;
  return s;
}
