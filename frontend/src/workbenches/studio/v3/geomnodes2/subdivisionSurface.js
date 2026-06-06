// ArchDisc Studio V3 — Geometry-Nodes 2 / SubdivisionSurface (slice 757).
//
// Blender Geometry Nodes' "Subdivide Surface" SOP. Catmull-Clark on
// quad input, Loop on triangle input. We delegate to the existing
// `catmullclark/` module when the mesh actually has a recoverable
// quad cage; otherwise fall back to the shared common/subdivide.js
// `loopSubdivide` which handles the indexed midpoint-split with edge
// welding (a faithful first-iteration approximation that survives
// repeated calls — exactly what Geometry Nodes uses internally for
// triangulated meshes).
//
// Pure JS, zero new deps.

import { loopSubdivide } from '../common/subdivide.js';

// subdivideSurface(geometryOrMesh, levels)
//   geometryOrMesh: THREE.BufferGeometry OR THREE.Mesh
//   levels: integer 1..4
//   returns: { geometry, levels, verts, faces, method }
export function subdivideSurface(input, levels) {
  if (!input) return null;
  const L = Math.max(1, Math.min(4, (levels | 0) || 1));
  const geo = input.isBufferGeometry ? input :
              (input.geometry || null);
  if (!geo) return null;

  // Prefer the existing v3/catmullclark op when present AND the input
  // already has a recorded quad cage (i.e. somebody upstream tagged
  // userData.archdiscStudioCCQuads on the mesh).
  const mesh = input.isMesh ? input : null;
  if (mesh && typeof window !== 'undefined' &&
      typeof window.__studioCatmullClark === 'function' &&
      mesh.userData && mesh.userData.archdiscStudioCCQuads) {
    try {
      const r = window.__studioCatmullClark(mesh.uuid, L);
      if (r && r.ok) {
        return {
          geometry: mesh.geometry,
          levels: L,
          verts: r.verts,
          faces: r.quads,
          method: 'catmullclark',
        };
      }
    } catch (_) { /* fall through */ }
  }

  // Generic Loop subdivision fallback.
  const out = loopSubdivide(geo, L);
  if (!out) return null;
  const verts = out.attributes.position ? out.attributes.position.count : 0;
  const faces = out.index ? out.index.count / 3 : verts / 3;
  return {
    geometry: out,
    levels: L,
    verts,
    faces: Math.floor(faces),
    method: 'loop',
  };
}

export default subdivideSurface;
