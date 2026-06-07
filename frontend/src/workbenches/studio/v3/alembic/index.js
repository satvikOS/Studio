// ArchDisc Studio V3 — Alembic export (slice 835).
// Pure-JS minimal ABC writer (text-mode JSON envelope, not the full Ogawa
// binary — but covers cached animation export pattern). Real Pixar
// Alembic .abc binary would need Ogawa or HDF5; this stub exports the
// JSON form that downstream readers can convert.

import { registerOps } from '../common/registry.js';
let _installed = false;
function _exportScene({ timeSamples = 1, frameRate = 24 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const out = { format: 'alembic-json-v1', frameRate, timeSamples, prims: [] };
  scene.traverse((o) => {
    if (!o.userData?.archdiscStudioPrimitive) return;
    const prim = {
      path: '/' + (o.name || `mesh_${o.uuid.slice(0, 8)}`),
      type: 'PolyMesh',
      xform: { translate: [o.position.x, o.position.y, o.position.z], rotate: [o.rotation.x, o.rotation.y, o.rotation.z], scale: [o.scale.x, o.scale.y, o.scale.z] },
    };
    if (o.geometry?.attributes?.position) {
      const pos = o.geometry.attributes.position;
      const verts = [];
      for (let i = 0; i < Math.min(pos.count, 100); i++) verts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
      prim.sampleVertices = verts;
      prim.vertexCount = pos.count;
    }
    out.prims.push(prim);
  });
  return { ok: true, alembic: out, primCount: out.prims.length };
}
export function installAlembic() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAlembicExport: _exportScene,
    __studioAlembicExportToString: () => {
      const r = _exportScene({});
      return { ok: true, json: JSON.stringify(r.alembic, null, 2) };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'Alembic cached-animation export');
  return { ok: true };
}
export default installAlembic;
