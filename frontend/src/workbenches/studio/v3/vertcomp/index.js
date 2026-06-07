// ArchDisc Studio V3 — vertex / normal compression for export (slice 824).
// Quantises position to 16-bit normalised, normals to octahedral 2×8-bit
// per axis. Game-engine-ready vertex stream.

import { registerOps } from '../common/registry.js';
let _installed = false;
function _octEncode(n) {
  const sum = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) || 1;
  const px = n[0] / sum, py = n[1] / sum;
  if (n[2] >= 0) return [px, py];
  return [(1 - Math.abs(py)) * Math.sign(px), (1 - Math.abs(px)) * Math.sign(py)];
}
function _compress({ meshUuid } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const m = scene.getObjectByProperty('uuid', meshUuid); if (!m?.geometry) return { ok: false };
  const pos = m.geometry.attributes.position;
  const nor = m.geometry.attributes.normal;
  if (!pos) return { ok: false };
  // Bbox normalise
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox;
  const sx = bb.max.x - bb.min.x || 1, sy = bb.max.y - bb.min.y || 1, sz = bb.max.z - bb.min.z || 1;
  const posU16 = new Uint16Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    posU16[i*3]   = Math.round(((pos.getX(i) - bb.min.x) / sx) * 65535);
    posU16[i*3+1] = Math.round(((pos.getY(i) - bb.min.y) / sy) * 65535);
    posU16[i*3+2] = Math.round(((pos.getZ(i) - bb.min.z) / sz) * 65535);
  }
  let norI8 = null;
  if (nor) {
    norI8 = new Int8Array(nor.count * 2);
    for (let i = 0; i < nor.count; i++) {
      const [a, b] = _octEncode([nor.getX(i), nor.getY(i), nor.getZ(i)]);
      norI8[i*2]   = Math.round(a * 127);
      norI8[i*2+1] = Math.round(b * 127);
    }
  }
  const decode = { bboxMin: [bb.min.x, bb.min.y, bb.min.z], bboxSize: [sx, sy, sz] };
  m.userData.archdiscStudioVertComp = { posU16Length: posU16.length, norI8Length: norI8?.length || 0, decode };
  return {
    ok: true,
    vertCount: pos.count,
    posU16: Array.from(posU16.slice(0, 24)), // sample
    norI8: norI8 ? Array.from(norI8.slice(0, 16)) : null,
    decode,
    bytesSaved: pos.count * (3 * 4 - 3 * 2) + (nor ? nor.count * (3 * 4 - 2) : 0),
  };
}
export function installVertComp() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = { __studioVertCompress: _compress };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'Vertex/normal compression for export');
  return { ok: true };
}
export default installVertComp;
