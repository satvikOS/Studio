// ArchDisc Studio V3 — editmore install + window.__studioEdit* API.
//
// installEditMore() is IDEMPOTENT — re-running overwrites the existing
// window slots (which is the desired behaviour for hot-reload too).
//
// The 12 ops it installs are deeper Blender edit-mode operators that
// complement the slice-682 edit/ module. Every op is registered under
// the same `edit` category so they sit alongside the slice-682 ops in
// the command palette.
//
//   1. __studioEditExtrudeIndividual(distance)
//   2. __studioEditFillNgon(vertIndices)
//   3. __studioEditFillHoles()
//   4. __studioEditPokeFace(faceIdx)
//   5. __studioEditTriangulateNgons()
//   6. __studioEditSplitEdge(edgeFaceIdx, edgeIdx)
//   7. __studioEditCollapseEdge(edgeFaceIdx, edgeIdx)
//   8. __studioEditFlipNormals()
//   9. __studioEditRecalculateNormalsOutside()
//   10. __studioEditMergeCenter(vertIndices)
//   11. __studioEditSeparateBySelection(vertIndices)
//   12. __studioEditMarkSeam(edgeFaceIdx, edgeIdx)

import {
  editExtrudeIndividual,
  editFillNgon,
  editFillHoles,
  editPokeFace,
  editTriangulateNgons,
  editSplitEdge,
  editCollapseEdge,
  editFlipNormals,
  editRecalculateNormalsOutside,
  editMergeCenter,
  editSeparateBySelection,
  editMarkSeam,
} from './editmore.js';

const OPS = [
  { name: '__studioEditExtrudeIndividual',         fn: editExtrudeIndividual,         description: 'Extrude every face independently along its own normal.' },
  { name: '__studioEditFillNgon',                  fn: editFillNgon,                  description: 'Fan-triangulate an arbitrary polygon defined by a vertex-index loop.' },
  { name: '__studioEditFillHoles',                 fn: editFillHoles,                 description: 'Find every boundary loop (edges used by only 1 face) and fan-fill them.' },
  { name: '__studioEditPokeFace',                  fn: editPokeFace,                  description: 'Replace a face with N triangles meeting at its centroid.' },
  { name: '__studioEditTriangulateNgons',          fn: editTriangulateNgons,          description: 'Confirm no n-gons — engine is tri-based, returns the tri count.' },
  { name: '__studioEditSplitEdge',                 fn: editSplitEdge,                 description: 'Insert a midpoint on one specific edge, splitting adjacent faces.' },
  { name: '__studioEditCollapseEdge',              fn: editCollapseEdge,              description: 'Merge an edge’s two endpoints into the midpoint, drop degenerate tris.' },
  { name: '__studioEditFlipNormals',               fn: editFlipNormals,               description: 'Reverse the winding of every triangle (parity name for invert-normals).' },
  { name: '__studioEditRecalculateNormalsOutside', fn: editRecalculateNormalsOutside, description: 'Recompute vertex normals consistently outward (fix-orientation alias).' },
  { name: '__studioEditMergeCenter',               fn: editMergeCenter,               description: 'Merge selected verts (or all verts) to the centroid; drop collapsed tris.' },
  { name: '__studioEditSeparateBySelection',       fn: editSeparateBySelection,       description: 'Split the mesh into 2 by a vertex-index list — listed verts + faces leave.' },
  { name: '__studioEditMarkSeam',                  fn: editMarkSeam,                  description: 'Tag an edge as a seam on geometry.userData.archdiscStudioSeams.' },
];

let _installed = false;

function registerWithPalette(name, fn, description) {
  if (typeof window === 'undefined') return;
  if (typeof window.__studioCommandRegister === 'function') {
    try {
      window.__studioCommandRegister(name, fn, { category: 'edit', description });
      return;
    } catch (_) {
      /* fall through to deferred retry */
    }
  }
  // Deferred: api.js may install the palette on a later tick.
  setTimeout(() => {
    if (typeof window.__studioCommandRegister === 'function') {
      try {
        window.__studioCommandRegister(name, fn, { category: 'edit', description });
      } catch (_) { /* swallow */ }
    }
  }, 0);
}

export function installEditMore() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  for (const { name, fn, description } of OPS) {
    window[name] = fn;
    registerWithPalette(name, fn, description);
  }
  _installed = true;
  return { ok: true, installed: OPS.length, names: OPS.map((o) => o.name) };
}

export function uninstallEditMore() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  for (const { name } of OPS) {
    try { delete window[name]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(name); } catch (_) {}
    }
  }
  _installed = false;
  return { ok: true, removed: OPS.length };
}

export function isInstalled() { return _installed; }

export const opNames = OPS.map((o) => o.name);
