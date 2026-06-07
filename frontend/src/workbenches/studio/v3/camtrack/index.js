// ArchDisc Studio V3 — camera tracking / solve (slice 869).
// Tracks 2D features through a video to solve 3D camera path. Stub
// implementation stores tracked points + outputs a camera position
// chain ready for downstream consumption.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _solves = new Map();
export function installCamTrack() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioCamTrackCreateSolve: ({ name } = {}) => {
      _solves.set(name, { name, frames: [], cameraPath: [] }); return { ok: true, name };
    },
    __studioCamTrackAddFrame: ({ name, features = [] } = {}) => {
      const s = _solves.get(name); if (!s) return { ok: false };
      s.frames.push({ index: s.frames.length, features });
      // Simple linear camera estimate: average feature centroid
      const cx = features.reduce((a, f) => a + (f.x || 0), 0) / Math.max(1, features.length);
      const cy = features.reduce((a, f) => a + (f.y || 0), 0) / Math.max(1, features.length);
      s.cameraPath.push({ frame: s.frames.length - 1, position: [cx, cy, 1], rotation: [0, 0, 0] });
      return { ok: true, frameIndex: s.frames.length - 1 };
    },
    __studioCamTrackGetSolve: ({ name } = {}) => {
      const s = _solves.get(name); if (!s) return { ok: false };
      return { ok: true, frames: s.frames.length, cameraPath: s.cameraPath };
    },
    __studioCamTrackList: () => ({ ok: true, names: [..._solves.keys()] }),
    __studioCamTrackDelete: ({ name } = {}) => { _solves.delete(name); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Camera tracking / solve');
  return { ok: true };
}
export default installCamTrack;
