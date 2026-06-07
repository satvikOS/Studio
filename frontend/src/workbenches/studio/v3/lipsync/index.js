// ArchDisc Studio V3 — phoneme / viseme lip sync (slice 818).
// Maps an input phoneme string (CMU Sphinx-style) to viseme blendshape
// weights using the Preston Blair 11-shape standard, then drives the
// slice-815 facial blendshape weights along a timeline.

import { registerOps } from '../common/registry.js';
let _installed = false;
const PRESTON_BLAIR = ['AI','E','U','O','MBP','FV','L','WQ','S','TH','EE'];
// Phoneme → viseme weight map (subset — covers 90% of English).
const PHONEME_TO_VISEME = {
  'AA': { AI: 1 }, 'AE': { AI: 1 }, 'AH': { AI: 0.8 }, 'AO': { O: 1 }, 'AW': { O: 0.8, U: 0.4 },
  'AY': { AI: 0.8, EE: 0.4 }, 'EH': { E: 1 }, 'ER': { E: 0.6 }, 'EY': { E: 0.8, EE: 0.4 },
  'IH': { EE: 1 }, 'IY': { EE: 1 }, 'OW': { O: 1 }, 'OY': { O: 0.6, EE: 0.5 },
  'UH': { U: 1 }, 'UW': { U: 1 }, 'B': { MBP: 1 }, 'CH': { S: 0.7 }, 'D': { TH: 0.5 },
  'DH': { TH: 1 }, 'F': { FV: 1 }, 'G': { TH: 0.3 }, 'HH': {}, 'JH': { S: 0.6 },
  'K': { TH: 0.3 }, 'L': { L: 1 }, 'M': { MBP: 1 }, 'N': { TH: 0.4 }, 'NG': { TH: 0.4 },
  'P': { MBP: 1 }, 'R': { U: 0.4 }, 'S': { S: 1 }, 'SH': { S: 0.8 }, 'T': { TH: 0.5 },
  'TH': { TH: 1 }, 'V': { FV: 1 }, 'W': { WQ: 1 }, 'Y': { EE: 0.5 }, 'Z': { S: 1 }, 'ZH': { S: 0.8 },
};
const _sessions = new Map();
function _build({ meshUuid, phonemes, durationsMs } = {}) {
  if (!Array.isArray(phonemes)) return { ok: false, error: 'phonemes[] required' };
  const key = `lipsync_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  const timeline = [];
  let t = 0;
  for (let i = 0; i < phonemes.length; i++) {
    const dur = (durationsMs?.[i] || 120) / 1000;
    timeline.push({ time: t, visemes: PHONEME_TO_VISEME[phonemes[i].toUpperCase()] || {} });
    t += dur;
  }
  _sessions.set(key, { meshUuid, timeline, totalDuration: t });
  return { ok: true, key, durationSec: t };
}
function _apply({ key, currentTimeSec } = {}) {
  const s = _sessions.get(key); if (!s) return { ok: false };
  // Find current viseme by piecewise sample
  let cur = s.timeline[0].visemes;
  for (let i = s.timeline.length - 1; i >= 0; i--) {
    if (currentTimeSec >= s.timeline[i].time) { cur = s.timeline[i].visemes; break; }
  }
  if (typeof window.__studioFaceBlendSetWeight === 'function') {
    for (const v of PRESTON_BLAIR) {
      const w = cur[v] || 0;
      try { window.__studioFaceBlendSetWeight({ meshUuid: s.meshUuid, name: `viseme_${v}`, weight: w }); } catch (_) {}
    }
  }
  return { ok: true, visemes: cur };
}
export function installLipSync() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioLipSyncBuild: _build,
    __studioLipSyncApply: _apply,
    __studioLipSyncListVisemes: () => ({ ok: true, visemes: PRESTON_BLAIR.slice() }),
    __studioLipSyncList: () => ({ ok: true, sessions: [..._sessions.keys()] }),
    __studioLipSyncRemove: ({ key } = {}) => { _sessions.delete(key); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Phoneme/viseme lip sync (Preston Blair)');
  return { ok: true };
}
export default installLipSync;
