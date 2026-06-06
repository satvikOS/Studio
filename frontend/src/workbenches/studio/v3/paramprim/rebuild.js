// ArchDisc Studio V3 — slice 750 — parametric primitive rebuild.
//
// Builds a fresh THREE.BufferGeometry for a (kind, params) pair and
// swaps it onto an existing mesh in place. Position / rotation / scale
// / material / userData (including selection markers) are all kept,
// the only thing that changes is `mesh.geometry`.
//
// 3ds Max's primitives stay editable forever because the construction
// parameters live on the object. We mirror that by stamping
// userData.archdiscStudioPrimitiveParams = {kind, ...params} plus the
// schema in userData.archdiscStudioPrimitiveParamSchema so the side
// panel / outliner / cmd-palette ops can read it back without having
// to import the schema map.

import * as THREE from 'three';
import {
  getSchema,
  defaultParamsFor,
  clampParam,
  isParamPrim,
  PARAM_PRIM_KINDS,
} from './paramSchemas.js';

// Re-export so callers can `import { buildGeometryFor, getSchema } from './rebuild.js'`.
export { getSchema, defaultParamsFor, clampParam, isParamPrim, PARAM_PRIM_KINDS };

// Build a fresh BufferGeometry for the given (kind, params). Unknown
// kinds fall back to a unit BoxGeometry so callers always get a real
// geometry back.
export function buildGeometryFor(kind, params) {
  const p = params || {};
  switch (kind) {
    case 'cube':
      return new THREE.BoxGeometry(
        p.width, p.height, p.depth,
        p.wSeg | 0, p.hSeg | 0, p.dSeg | 0,
      );
    case 'sphere':
      return new THREE.SphereGeometry(
        p.radius,
        p.widthSeg | 0, p.heightSeg | 0,
      );
    case 'plane':
      return new THREE.PlaneGeometry(
        p.width, p.height,
        p.wSeg | 0, p.hSeg | 0,
      );
    case 'cylinder':
      return new THREE.CylinderGeometry(
        p.radiusTop, p.radiusBottom, p.height,
        p.radialSeg | 0, p.heightSeg | 0,
      );
    case 'cone':
      return new THREE.ConeGeometry(
        p.radius, p.height,
        p.radialSeg | 0, p.heightSeg | 0,
      );
    case 'torus':
      return new THREE.TorusGeometry(
        p.radius, p.tube,
        p.radialSeg | 0, p.tubularSeg | 0,
        p.arc,
      );
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(p.radius, p.detail | 0);
    case 'dodecahedron':
      return new THREE.DodecahedronGeometry(p.radius, p.detail | 0);
    case 'tetrahedron':
      return new THREE.TetrahedronGeometry(p.radius, p.detail | 0);
    case 'torus-knot':
      return new THREE.TorusKnotGeometry(
        p.radius, p.tube,
        p.tubularSeg | 0, p.radialSeg | 0,
        p.p | 0, p.q | 0,
      );

    // Bag kinds — proxy as a unit BoxGeometry scaled by `scale`. The
    // mesh's world transform is preserved separately; this only sizes
    // the local geometry so re-editing `scale` produces a visible
    // change in the viewer without us having to re-derive the bag's
    // baked-at-spawn topology.
    case 'voxel-cube':
    case 'voxel-sphere':
    case 'suzanne':
    case 'teapot':
    case 'color-cube':
    case 'arch':
    case 'ogee':
    case 'spline-helix':
    case 'spline-wave':
    case 'spline-trefoil': {
      const s = (typeof p.scale === 'number' && isFinite(p.scale)) ? p.scale : 1;
      return new THREE.BoxGeometry(0.03 * s, 0.03 * s, 0.03 * s);
    }

    default:
      return new THREE.BoxGeometry(0.03, 0.03, 0.03);
  }
}

// Merge partial params onto an existing param dict, clamping each
// value into its schema range. Unknown keys are silently dropped so
// callers can't poison the dict with typos.
function mergeAndClamp(kind, base, partial) {
  const out = { ...(base || {}) };
  if (!partial || typeof partial !== 'object') return out;
  const schema = getSchema(kind);
  if (!schema) return out;
  for (const k of Object.keys(partial)) {
    if (!schema[k]) continue;
    out[k] = clampParam(kind, k, partial[k]);
  }
  return out;
}

// Read the (kind, params) stamp off a mesh. When the mesh has no
// stamp, falls back to userData.archdiscStudioPrimitiveKind +
// defaults so we can still rebuild a never-stamped primitive.
export function readParams(mesh) {
  if (!mesh) return null;
  const ud = mesh.userData || {};
  const stamp = ud.archdiscStudioPrimitiveParams;
  if (stamp && typeof stamp === 'object' && stamp.kind) {
    const { kind, ...rest } = stamp;
    return { kind, params: { ...rest } };
  }
  const kind = ud.archdiscStudioPrimitiveKind;
  if (!kind || !isParamPrim(kind)) return null;
  return { kind, params: defaultParamsFor(kind) };
}

// Stamp (kind, params) + the schema onto a mesh's userData. Used by
// rebuild() and by `__studioPrimitiveStamp` for retrofitting meshes
// that pre-date this slice.
export function stamp(mesh, kind, params) {
  if (!mesh) return null;
  const merged = { ...defaultParamsFor(kind), ...(params || {}) };
  mesh.userData = {
    ...(mesh.userData || {}),
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: kind,
    archdiscStudioPrimitiveParams: { kind, ...merged },
    archdiscStudioPrimitiveParamSchema: getSchema(kind),
  };
  return merged;
}

// Swap mesh.geometry in place with a fresh BufferGeometry built from
// (existingParams + partialParams). Preserves:
//   • position / rotation / scale
//   • material reference
//   • userData (other than the param stamp, which we update)
//   • selection markers (these live on userData too)
//
// Returns { ok, kind, params } or { ok:false, error }.
export function rebuild(mesh, partialParams) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const cur = readParams(mesh);
  if (!cur) return { ok: false, error: 'not a parametric primitive' };

  const merged = mergeAndClamp(cur.kind, cur.params, partialParams);
  const fresh = buildGeometryFor(cur.kind, merged);
  if (!fresh) return { ok: false, error: 'geometry build failed' };

  // Hand-off: dispose the old geometry, swap in the new, keep
  // everything else exactly where it was.
  const old = mesh.geometry;
  mesh.geometry = fresh;
  if (old && typeof old.dispose === 'function' && old !== fresh) {
    try { old.dispose(); } catch (_) { /* ignore */ }
  }
  // Ensure bounding info is fresh so raycast / select-all sees correct
  // bounds against the new geometry.
  try { fresh.computeBoundingBox(); } catch (_) {}
  try { fresh.computeBoundingSphere(); } catch (_) {}

  // Re-stamp params + schema (in case the kind got upgraded).
  stamp(mesh, cur.kind, merged);
  return { ok: true, kind: cur.kind, params: merged };
}

// Reset a mesh's params back to schema defaults and rebuild.
export function reset(mesh) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const cur = readParams(mesh);
  if (!cur) return { ok: false, error: 'not a parametric primitive' };
  const fresh = defaultParamsFor(cur.kind);
  // Rebuild with the full default set (mergeAndClamp will overwrite
  // every current value with the schema defaults).
  return rebuild(mesh, fresh);
}
