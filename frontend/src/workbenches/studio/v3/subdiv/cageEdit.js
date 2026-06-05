// ArchDisc Studio V3 — subdiv cage editing.
//
// `setCageVertex(meshUuid, idx, [x,y,z])` writes a single CAGE vertex
// (in cage-index space — i.e. the welded indices baked into
// userData.archdiscStudioCage.positions) and triggers a smooth-mesh
// rebuild so the viewport reflects the edit immediately. Used by
// Archie's control-cage edit ops and by the SubdivPanel's "Snap to
// origin" / "Nudge" buttons.

import { meshByUuid } from './crease.js';
import { CAGE_KEY, rebuild } from './surface.js';

export function setCageVertex(meshUuidOrMesh, idx, xyz) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  const cage = mesh.userData && mesh.userData[CAGE_KEY];
  if (!cage) return { ok: false, error: 'not wrapped' };
  if (!Number.isInteger(idx)) return { ok: false, error: 'bad idx' };
  const n = cage.positions.length / 3;
  if (idx < 0 || idx >= n) return { ok: false, error: 'idx out of range' };
  if (!Array.isArray(xyz) || xyz.length !== 3) return { ok: false, error: 'bad xyz' };

  const x = Number(xyz[0]);
  const y = Number(xyz[1]);
  const z = Number(xyz[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { ok: false, error: 'non-finite xyz' };
  }
  cage.positions[idx * 3] = x;
  cage.positions[idx * 3 + 1] = y;
  cage.positions[idx * 3 + 2] = z;

  const r = rebuild(mesh);
  return {
    ok: true,
    idx,
    xyz: [x, y, z],
    cageVerts: n,
    smoothVerts: r && r.smoothVerts,
  };
}

// Nudge by a delta vector (convenience for UI buttons).
export function nudgeCageVertex(meshUuidOrMesh, idx, dxyz) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  const cage = mesh.userData && mesh.userData[CAGE_KEY];
  if (!cage) return { ok: false, error: 'not wrapped' };
  if (!Number.isInteger(idx)) return { ok: false, error: 'bad idx' };
  const n = cage.positions.length / 3;
  if (idx < 0 || idx >= n) return { ok: false, error: 'idx out of range' };
  if (!Array.isArray(dxyz) || dxyz.length !== 3) return { ok: false, error: 'bad dxyz' };
  const x = cage.positions[idx * 3] + Number(dxyz[0] || 0);
  const y = cage.positions[idx * 3 + 1] + Number(dxyz[1] || 0);
  const z = cage.positions[idx * 3 + 2] + Number(dxyz[2] || 0);
  return setCageVertex(mesh, idx, [x, y, z]);
}

// Read-only accessor: returns the cage vertex xyz.
export function getCageVertex(meshUuidOrMesh, idx) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return null;
  const cage = mesh.userData && mesh.userData[CAGE_KEY];
  if (!cage) return null;
  if (!Number.isInteger(idx) || idx < 0 || idx >= cage.positions.length / 3) return null;
  return [
    cage.positions[idx * 3],
    cage.positions[idx * 3 + 1],
    cage.positions[idx * 3 + 2],
  ];
}
