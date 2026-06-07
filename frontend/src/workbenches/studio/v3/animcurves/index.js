// ArchDisc Studio V3 — animation curves / F-curve editor (slice 809).
import { registerOps } from '../common/registry.js';
let _installed = false;
const _curves = new Map(); // key = uuid:channel
function _key(uuid, channel) { return `${uuid}:${channel}`; }
function _evaluate(curve, time) {
  const kfs = curve.keyframes;
  if (!kfs.length) return 0;
  if (time <= kfs[0].time) return kfs[0].value;
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (time >= a.time && time <= b.time) {
      const t = (time - a.time) / (b.time - a.time);
      if (a.interp === 'constant') return a.value;
      if (a.interp === 'linear') return a.value + (b.value - a.value) * t;
      // Bezier (cubic Hermite using in/out tangents)
      const h00 = 2*t*t*t - 3*t*t + 1, h10 = t*t*t - 2*t*t + t, h01 = -2*t*t*t + 3*t*t, h11 = t*t*t - t*t;
      const dt = b.time - a.time;
      return h00 * a.value + h10 * (a.outTangent || 0) * dt + h01 * b.value + h11 * (b.inTangent || 0) * dt;
    }
  }
  return 0;
}
export function installAnimCurves() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAnimCurveCreate: ({ uuid, channel } = {}) => {
      const k = _key(uuid, channel);
      _curves.set(k, { uuid, channel, keyframes: [] });
      return { ok: true, key: k };
    },
    __studioAnimCurveAddKeyframe: ({ uuid, channel, time, value, interp = 'bezier', inTangent = 0, outTangent = 0 } = {}) => {
      const c = _curves.get(_key(uuid, channel));
      if (!c) return { ok: false };
      c.keyframes.push({ time, value, interp, inTangent, outTangent });
      c.keyframes.sort((a, b) => a.time - b.time);
      return { ok: true, count: c.keyframes.length };
    },
    __studioAnimCurveSetTangent: ({ uuid, channel, index, inTangent, outTangent } = {}) => {
      const c = _curves.get(_key(uuid, channel)); if (!c?.keyframes[index]) return { ok: false };
      if (inTangent != null) c.keyframes[index].inTangent = inTangent;
      if (outTangent != null) c.keyframes[index].outTangent = outTangent;
      return { ok: true };
    },
    __studioAnimCurveEvaluate: ({ uuid, channel, time = 0 } = {}) => {
      const c = _curves.get(_key(uuid, channel));
      if (!c) return { ok: false };
      return { ok: true, value: _evaluate(c, time) };
    },
    __studioAnimCurveList: () => ({ ok: true, keys: [..._curves.keys()] }),
    __studioAnimCurveDelete: ({ uuid, channel } = {}) => { _curves.delete(_key(uuid, channel)); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Animation curves / F-curve editor');
  return { ok: true };
}
export default installAnimCurves;
