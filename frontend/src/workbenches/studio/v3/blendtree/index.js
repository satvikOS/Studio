// ArchDisc Studio V3 — animation blend tree (slice 862).
// Unity-style 1D/2D blend tree: blend N animation clips by a continuous
// param value with weighted interpolation.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _trees = new Map();
function _blend1D(tree, x) {
  // tree.clips = [{value, clip}] sorted by value
  const arr = tree.clips;
  if (!arr.length) return [];
  if (x <= arr[0].value) return [{ clip: arr[0].clip, weight: 1 }];
  if (x >= arr[arr.length - 1].value) return [{ clip: arr[arr.length - 1].clip, weight: 1 }];
  for (let i = 0; i < arr.length - 1; i++) {
    if (x >= arr[i].value && x <= arr[i + 1].value) {
      const t = (x - arr[i].value) / (arr[i + 1].value - arr[i].value);
      return [{ clip: arr[i].clip, weight: 1 - t }, { clip: arr[i + 1].clip, weight: t }];
    }
  }
  return [];
}
function _blend2D(tree, x, y) {
  // Inverse-distance weighted blend among points
  const arr = tree.clips;
  const eps = 1e-6;
  let total = 0;
  const weights = arr.map((c) => {
    const d = Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2);
    const w = 1 / (d + eps);
    total += w; return w;
  });
  return arr.map((c, i) => ({ clip: c.clip, weight: weights[i] / total }));
}
export function installBlendTree() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioBlendTreeCreate: ({ name, dimensions = 1 } = {}) => {
      _trees.set(name, { name, dimensions, clips: [] }); return { ok: true };
    },
    __studioBlendTreeAddClip: ({ name, clip, value, x, y } = {}) => {
      const t = _trees.get(name); if (!t) return { ok: false };
      if (t.dimensions === 1) t.clips.push({ clip, value: value ?? 0 });
      else t.clips.push({ clip, x: x ?? 0, y: y ?? 0 });
      if (t.dimensions === 1) t.clips.sort((a, b) => a.value - b.value);
      return { ok: true, count: t.clips.length };
    },
    __studioBlendTreeEvaluate: ({ name, x = 0, y = 0 } = {}) => {
      const t = _trees.get(name); if (!t) return { ok: false };
      return { ok: true, blend: t.dimensions === 1 ? _blend1D(t, x) : _blend2D(t, x, y) };
    },
    __studioBlendTreeList: () => ({ ok: true, names: [..._trees.keys()] }),
    __studioBlendTreeDelete: ({ name } = {}) => { _trees.delete(name); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Animation blend tree');
  return { ok: true };
}
export default installBlendTree;
