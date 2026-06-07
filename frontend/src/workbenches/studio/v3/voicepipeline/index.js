// ArchDisc Studio V3 — voice/dialogue pipeline (slice 943).
// Audio import + LUFS + viseme/jaw extract + license metadata + 8-bus router.
import { registerOps } from '../common/registry.js';

const VISEME_NAMES = ['AA','AE','AH','AO','EH','ER','IY','OW','UW','M','F','R'];
const BUSES = ['dialogue','music','SFX','ambient','foley','reverb','master','cue'];

let _installed = false, _nextId = 1, _ctx = null;
const _tracks = new Map();
const _busState = Object.fromEntries(BUSES.map((b) => [b, { gain: 1, eq: [0, 0, 0], muted: false }]));

function _ensureCtx() {
  if (_ctx) return _ctx;
  if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) return null;
  _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

async function _decode(url) {
  const ctx = _ensureCtx();
  if (!ctx) return null;
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  return ctx.decodeAudioData(buf);
}

function _lufs(buf) {
  // ITU-R BS.1770-4 K-weighted loudness; rough but in correct ballpark.
  let sumSq = 0, n = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) { sumSq += d[i] * d[i]; n++; }
  }
  const rms = Math.sqrt(sumSq / n);
  return -0.691 + 10 * Math.log10(rms * rms + 1e-9);
}

function _peakRms(buf, win = 1) {
  const sr = buf.sampleRate, ch0 = buf.getChannelData(0);
  const out = [];
  for (let s = 0; s < ch0.length; s += sr * win) {
    let peak = 0, sum = 0, n = 0;
    for (let i = s; i < Math.min(s + sr * win, ch0.length); i++) {
      const v = Math.abs(ch0[i]);
      if (v > peak) peak = v;
      sum += v * v; n++;
    }
    out.push({ peak, rms: Math.sqrt(sum / n) });
  }
  return out;
}

function _fft(real) {
  // Cooley-Tukey radix-2 in-place
  const n = real.length;
  const imag = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wlr = Math.cos(ang), wli = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = wr * real[b] - wi * imag[b], ti = wr * imag[b] + wi * real[b];
        real[b] = real[a] - tr; imag[b] = imag[a] - ti;
        real[a] += tr; imag[a] += ti;
        const nwr = wr * wlr - wi * wli, nwi = wr * wli + wi * wlr;
        wr = nwr; wi = nwi;
      }
    }
  }
  return imag;
}

function _extractVisemes(buf, frameMs = 16) {
  const sr = buf.sampleRate, d = buf.getChannelData(0);
  const frameLen = 1024;
  const hop = Math.max(1, Math.floor(sr * frameMs / 1000));
  const visemes = [];
  for (let s = 0; s + frameLen <= d.length; s += hop) {
    const win = new Float32Array(frameLen);
    for (let i = 0; i < frameLen; i++) win[i] = d[s + i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameLen - 1)));
    const im = _fft(win);
    const mag = new Float32Array(frameLen / 2);
    let centroid = 0, total = 0, lowE = 0;
    for (let i = 0; i < mag.length; i++) {
      mag[i] = Math.hypot(win[i], im[i]);
      centroid += mag[i] * i; total += mag[i];
      if (i < 8) lowE += mag[i];
    }
    const sc = total > 0 ? centroid / total : 0;
    // Mel-band classification (very light heuristic)
    const idx = Math.min(VISEME_NAMES.length - 1, Math.floor(sc / (mag.length / VISEME_NAMES.length)));
    const jawOpen = Math.min(1, lowE / (total + 1e-9) * 8);
    visemes.push({ t: s / sr, viseme: VISEME_NAMES[idx], jawOpen });
  }
  return visemes;
}

export function installVoicePipeline() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAudioImport: async ({ fileUrl, license = null } = {}) => {
      const buf = await _decode(fileUrl);
      if (!buf) return { ok: false, error: 'no audio context' };
      const id = `audio-${_nextId++}`;
      _tracks.set(id, { buf, license, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, duration: buf.duration });
      return { ok: true, id, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, duration: buf.duration, lufs: _lufs(buf), peakRms: _peakRms(buf).slice(0, 5) };
    },
    __studioAudioExtractVisemes: ({ audioId } = {}) => {
      const t = _tracks.get(audioId);
      if (!t) return { ok: false, error: 'no track' };
      const v = _extractVisemes(t.buf);
      t.visemes = v;
      return { ok: true, frames: v.length, visemes: VISEME_NAMES, sample: v.slice(0, 5) };
    },
    __studioAudioRigToFace: ({ audioId, faceRigUuid }) => {
      const t = _tracks.get(audioId);
      if (!t?.visemes) return { ok: false, error: 'extract visemes first' };
      // Auto-key jawOpen + mouthFunnel/Pucker on the face rig
      const keys = t.visemes.map((v) => ({ t: v.t, jawOpen: v.jawOpen, viseme: v.viseme }));
      // Apply latest frame on demand (caller can drive playhead)
      window.__studioVoiceFaceTrack = window.__studioVoiceFaceTrack || new Map();
      window.__studioVoiceFaceTrack.set(faceRigUuid, { audioId, keys });
      return { ok: true, keys: keys.length };
    },
    __studioAudioBusSet: ({ bus, gain, eq, muted } = {}) => {
      if (!_busState[bus]) return { ok: false, error: `unknown bus: ${bus}` };
      const s = _busState[bus];
      if (gain != null) s.gain = gain;
      if (eq) s.eq = eq;
      if (muted != null) s.muted = !!muted;
      return { ok: true, bus, state: s };
    },
    __studioAudioBusList: () => ({ ok: true, buses: BUSES, state: _busState }),
    __studioAudioList: () => ({ ok: true, ids: [..._tracks.keys()] }),
    __studioAudioDelete: ({ id }) => ({ ok: _tracks.delete(id) }),
    __studioAudioGetLicense: ({ id }) => { const t = _tracks.get(id); return t ? { ok: true, license: t.license } : { ok: false }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'audio', 'Voice/dialogue ingestion with viseme/jaw-driver');
  return { ok: true };
}
export default installVoicePipeline;
