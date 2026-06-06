// Slice 763 — real-time UV editor ops.
//
// Maya UV Editor / Blender UV Editor parity: per-island move / rotate /
// scale / mirror, greedy first-fit-decreasing bin-pack of all islands
// into the [0,1]² UDIM-0 tile, and Laplacian relax preserving boundary.
//
// Each op resolves a mesh by uuid against `window.__archdiscScene`,
// validates that it carries a UV attribute (callers must unwrap first
// via the slice-734 ZUV Master or slice-630 UV projection), then
// delegates to the island/relax kernels.

import { registerOps } from '../common/registry.js';
import {
  findIslands,
  islandBoundingBox,
  moveIsland,
  rotateIsland,
  scaleIsland,
  mirrorIsland,
  packIslands,
} from './islands.js';
import { relaxUVs } from './relax.js';

let _installed = false;

function _resolveMesh(meshUuid) {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) return null;
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes?.uv) return null;
  return mesh;
}

export function uvFindIslands(meshUuid) {
  const mesh = _resolveMesh(meshUuid);
  if (!mesh) return { ok: false, reason: 'mesh has no UVs' };
  const islands = findIslands(mesh.geometry);
  return {
    ok: true,
    count: islands.length,
    islands: islands.map((isl) => ({
      id: isl.id,
      triCount: isl.triIndices.length,
      bbox: islandBoundingBox(isl),
    })),
  };
}

export function uvMoveIsland(opts) {
  if (!opts) return { ok: false };
  const mesh = _resolveMesh(opts.meshUuid);
  if (!mesh) return { ok: false, reason: 'mesh has no UVs' };
  const ok = moveIsland(mesh.geometry, opts.islandId | 0,
    Number(opts.du) || 0, Number(opts.dv) || 0);
  return { ok };
}

export function uvRotateIsland(opts) {
  if (!opts) return { ok: false };
  const mesh = _resolveMesh(opts.meshUuid);
  if (!mesh) return { ok: false, reason: 'mesh has no UVs' };
  const deg = Number(opts.angleDeg) || 0;
  const ok = rotateIsland(mesh.geometry, opts.islandId | 0, deg * Math.PI / 180);
  return { ok };
}

export function uvScaleIsland(opts) {
  if (!opts) return { ok: false };
  const mesh = _resolveMesh(opts.meshUuid);
  if (!mesh) return { ok: false, reason: 'mesh has no UVs' };
  const sx = Number(opts.sx) || 1;
  const sy = Number(opts.sy) || 1;
  const ok = scaleIsland(mesh.geometry, opts.islandId | 0, sx, sy);
  return { ok };
}

export function uvMirrorIsland(opts) {
  if (!opts) return { ok: false };
  const mesh = _resolveMesh(opts.meshUuid);
  if (!mesh) return { ok: false, reason: 'mesh has no UVs' };
  const axis = (opts.axis || 'x');
  const ok = mirrorIsland(mesh.geometry, opts.islandId | 0, axis);
  return { ok };
}

export function uvPack(opts) {
  if (!opts) return { ok: false };
  const mesh = _resolveMesh(opts.meshUuid);
  if (!mesh) return { ok: false, reason: 'mesh has no UVs' };
  const margin = Number(opts.margin);
  const m = Number.isFinite(margin) ? margin : 0.01;
  const packedCount = packIslands(mesh.geometry, m);
  return { ok: packedCount > 0, packedCount };
}

export function uvRelax(opts) {
  if (!opts) return { ok: false };
  const mesh = _resolveMesh(opts.meshUuid);
  if (!mesh) return { ok: false, reason: 'mesh has no UVs' };
  const iterations = Number(opts.iterations) || 5;
  const strength = Number(opts.strength);
  const s = Number.isFinite(strength) ? strength : 0.5;
  const ok = relaxUVs(mesh.geometry, iterations, s);
  return { ok };
}

export function installUVEditor() {
  if (_installed) return;
  _installed = true;
  const ops = {
    __studioUVFindIslands:   uvFindIslands,
    __studioUVMoveIsland:    uvMoveIsland,
    __studioUVRotateIsland:  uvRotateIsland,
    __studioUVScaleIsland:   uvScaleIsland,
    __studioUVMirrorIsland:  uvMirrorIsland,
    __studioUVPack:          uvPack,
    __studioUVRelax:         uvRelax,
  };
  for (const [name, fn] of Object.entries(ops)) {
    if (typeof window !== 'undefined') window[name] = fn;
  }
  registerOps(ops, 'edit',
    'UV editor — per-island move/rotate/scale/mirror, greedy bin-pack, Laplacian relax (Maya UV Editor / Blender UV Editor parity)');
}
