// ArchDisc Studio V3 — audio file loader + AudioBuffer store.
//
// Pure Web Audio API. We keep a single lazily-created AudioContext that
// gets shared with playback.js — both `loadAudio` (which calls
// `decodeAudioData`) and the playback graph need to talk to the same
// context so AudioBuffers decoded here are playable through the source
// nodes built there.
//
// Decoded buffers are stored in a module-level Map keyed by a uuid we
// mint on load. We expose `getBuffer(uuid)` for the playback module and
// `getAll()` for the list op, plus the inverse of `loadAudio` —
// `unloadAudio(uuid)`. The Map IS the registry; there is no
// per-instance class to instantiate.
//
// The loader accepts:
//   • ArrayBuffer            (already in memory)
//   • Uint8Array / TypedArray (we copy out the underlying buffer slice)
//   • Data URL string        (we decode the base64 chunk back to bytes)
//   • { arrayBuffer }-shaped objects from `File.arrayBuffer()`
//
// We do NOT take a File or Blob directly here so this module stays
// callable from headless tests where the FileReader/Blob shim is
// missing. The AudioPanel takes care of File → ArrayBuffer before
// handing the bytes to us.

// ─── Shared AudioContext ─────────────────────────────────────────────
// playback.js imports `getAudioContext` from here so both modules share
// the same context. Created lazily so SSR + unit tests don't crash on
// `new AudioContext()` at import time.

let _ctx = null;

export function getAudioContext() {
  if (_ctx) return _ctx;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    _ctx = new Ctor();
  } catch (_) {
    _ctx = null;
  }
  return _ctx;
}

// Allow the test harness to swap in a fake context, e.g. an
// OfflineAudioContext, so decode/playback can be exercised headlessly.
export function setAudioContext(ctx) {
  _ctx = ctx || null;
}

// ─── Buffer registry ─────────────────────────────────────────────────
const _buffers = new Map();      // uuid → { uuid, buffer, name, createdAt }

function mintUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try { return crypto.randomUUID(); } catch (_) {}
  }
  // Fall back to a timestamp+random scheme — uuids only need to be
  // distinct across the page session.
  return 'audio-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function getBuffer(uuid) {
  const entry = _buffers.get(uuid);
  return entry ? entry.buffer : null;
}

export function getEntry(uuid) {
  return _buffers.get(uuid) || null;
}

export function getAll() {
  return _buffers;
}

export function listEntries() {
  const out = [];
  _buffers.forEach((e) => {
    out.push({
      uuid: e.uuid,
      name: e.name || '',
      duration: e.buffer ? e.buffer.duration : 0,
      sampleRate: e.buffer ? e.buffer.sampleRate : 0,
      channels: e.buffer ? e.buffer.numberOfChannels : 0,
    });
  });
  return out;
}

export function clear() {
  _buffers.clear();
}

// ─── Input coercion ──────────────────────────────────────────────────
function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  if (typeof Buffer !== 'undefined') {
    // Node fallback (used by Vite SSR / Vitest in node environments).
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  throw new Error('no base64 decoder available');
}

function toArrayBuffer(input) {
  if (!input) throw new Error('audio: empty input');
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    // Slice out exactly the bytes the view represents — calling
    // decodeAudioData on a partial buffer is a common foot-gun.
    return input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength,
    );
  }
  if (typeof input === 'string') {
    if (!input.startsWith('data:')) {
      throw new Error('audio: string input must be a data: URL');
    }
    const comma = input.indexOf(',');
    if (comma < 0) throw new Error('audio: malformed data URL');
    const meta = input.substring(5, comma); // strip "data:"
    const payload = input.substring(comma + 1);
    const isB64 = /;base64$/i.test(meta) || /;base64;/i.test(meta);
    if (isB64) {
      const bytes = base64ToBytes(payload);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    // url-encoded text payload — treat as raw bytes via decodeURIComponent.
    const txt = decodeURIComponent(payload);
    const bytes = new Uint8Array(txt.length);
    for (let i = 0; i < txt.length; i++) bytes[i] = txt.charCodeAt(i) & 0xff;
    return bytes.buffer;
  }
  if (typeof input === 'object' && input.arrayBuffer) {
    throw new Error('audio: pass the result of arrayBuffer() instead of the File itself');
  }
  throw new Error('audio: unsupported input type');
}

// `AudioContext.decodeAudioData` returns a promise on modern browsers
// but the legacy callback signature is still in Safari 14-. Wrap both.
function decode(ctx, ab) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let result;
    try {
      result = ctx.decodeAudioData(
        ab,
        (buf) => { if (!settled) { settled = true; resolve(buf); } },
        (err) => { if (!settled) { settled = true; reject(err || new Error('decode failed')); } },
      );
    } catch (e) {
      reject(e);
      return;
    }
    // Modern impl returns a promise — chain it so we handle both.
    if (result && typeof result.then === 'function') {
      result.then(
        (buf) => { if (!settled) { settled = true; resolve(buf); } },
        (err) => { if (!settled) { settled = true; reject(err); } },
      );
    }
  });
}

// ─── Public loader ───────────────────────────────────────────────────
/**
 * @param {ArrayBuffer|TypedArray|string} input        Data URL or array
 *   buffer of an encoded audio file (wav/mp3/ogg/flac — whatever the
 *   browser's decoder supports).
 * @param {Object}  [opts]
 * @param {string}  [opts.name]                       Display name
 *   shown in the panel/list — defaults to "audio-N".
 * @returns {Promise<{ok, uuid, duration, sampleRate, channels, error?}>}
 */
export async function loadAudio(input, opts) {
  const ctx = getAudioContext();
  if (!ctx) return { ok: false, error: 'no AudioContext' };
  let ab;
  try {
    ab = toArrayBuffer(input);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
  let buffer;
  try {
    buffer = await decode(ctx, ab);
  } catch (e) {
    return { ok: false, error: 'decode failed: ' + String((e && e.message) || e) };
  }
  const uuid = mintUuid();
  const name = (opts && opts.name) || `audio-${_buffers.size + 1}`;
  _buffers.set(uuid, {
    uuid,
    buffer,
    name,
    createdAt: Date.now(),
  });
  return {
    ok: true,
    uuid,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    name,
  };
}

export function unloadAudio(uuid) {
  return _buffers.delete(uuid);
}

// ─── Sine wave generator ─────────────────────────────────────────────
// Build a fresh AudioBuffer of a pure sine tone and register it. Used by
// the e2e spec so we don't need a real audio file checked into the repo,
// and by the AudioPanel to drop in a quick "test tone" without leaving
// the app.
/**
 * @param {number} freqHz   tone frequency in Hz (default 440)
 * @param {number} durSec   tone duration in seconds (default 1)
 * @param {Object} [opts]
 * @param {number} [opts.sampleRate]   defaults to the shared ctx rate
 * @param {number} [opts.amplitude]    defaults to 0.4
 * @param {number} [opts.channels]     1 or 2 (defaults 1)
 * @param {string} [opts.name]         display name
 */
export function generateSineWave(freqHz, durSec, opts) {
  const ctx = getAudioContext();
  if (!ctx) return { ok: false, error: 'no AudioContext' };
  const f = Math.max(20, Math.min(20000, Number(freqHz) || 440));
  const d = Math.max(0.05, Math.min(60, Number(durSec) || 1));
  const sr = Math.max(8000, Math.min(96000, (opts && Number(opts.sampleRate)) || ctx.sampleRate || 44100));
  const amp = Math.max(0, Math.min(1, (opts && Number(opts.amplitude)) || 0.4));
  const channels = Math.max(1, Math.min(2, (opts && Number(opts.channels)) || 1));
  const length = Math.max(1, Math.round(sr * d));
  let buffer;
  try {
    buffer = ctx.createBuffer(channels, length, sr);
  } catch (e) {
    return { ok: false, error: 'createBuffer failed: ' + String((e && e.message) || e) };
  }
  const w = 2 * Math.PI * f / sr;
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    // Cosine modulation across channels so stereo isn't dead-centre.
    const phase = ch === 0 ? 0 : Math.PI * 0.5;
    for (let i = 0; i < length; i++) {
      // Linear fade-in/out (5 ms) to avoid click pops on play/stop.
      const fadeSamples = Math.max(1, Math.round(0.005 * sr));
      let env = 1;
      if (i < fadeSamples) env = i / fadeSamples;
      else if (i > length - fadeSamples) env = (length - i) / fadeSamples;
      data[i] = amp * env * Math.sin(w * i + phase);
    }
  }
  const uuid = mintUuid();
  const name = (opts && opts.name) || `sine-${f.toFixed(0)}Hz-${d.toFixed(2)}s`;
  _buffers.set(uuid, { uuid, buffer, name, createdAt: Date.now() });
  return {
    ok: true,
    uuid,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    name,
  };
}
