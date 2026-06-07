// ArchDisc Studio V3 — texture atlasing (slice 821).
// Pack N source textures into a single N×N atlas + rewrite mesh UVs to
// reference the atlas cell. Cuts draw calls for batched game assets.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _atlas({ meshUuids, atlasSize = 1024, cellsPerRow = 4 } = {}) {
  if (!Array.isArray(meshUuids) || !meshUuids.length) return { ok: false };
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = atlasSize;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#888'; ctx.fillRect(0, 0, atlasSize, atlasSize);
  const cellSize = Math.floor(atlasSize / cellsPerRow);
  const cellMap = []; // {uuid, cellX, cellY}
  for (let i = 0; i < meshUuids.length && i < cellsPerRow * cellsPerRow; i++) {
    const m = scene.getObjectByProperty('uuid', meshUuids[i]);
    if (!m) continue;
    const cx = (i % cellsPerRow) * cellSize, cy = Math.floor(i / cellsPerRow) * cellSize;
    const map = m.material?.map;
    if (map?.image) ctx.drawImage(map.image, cx, cy, cellSize, cellSize);
    else { ctx.fillStyle = `hsl(${i * 37}, 60%, 50%)`; ctx.fillRect(cx, cy, cellSize, cellSize); }
    cellMap.push({ uuid: meshUuids[i], cellX: cx, cellY: cy });
  }
  const tex = new THREE.CanvasTexture(canvas); tex.needsUpdate = true;
  // Remap UVs of each mesh into its cell.
  for (let i = 0; i < cellMap.length; i++) {
    const { uuid } = cellMap[i];
    const m = scene.getObjectByProperty('uuid', uuid);
    if (!m?.geometry?.attributes?.uv) continue;
    const uv = m.geometry.attributes.uv;
    const u0 = (i % cellsPerRow) / cellsPerRow, v0 = 1 - (Math.floor(i / cellsPerRow) + 1) / cellsPerRow;
    for (let k = 0; k < uv.count; k++) {
      const u = uv.getX(k), v = uv.getY(k);
      uv.setXY(k, u0 + u / cellsPerRow, v0 + v / cellsPerRow);
    }
    uv.needsUpdate = true;
    if (m.material) { m.material.map = tex; m.material.needsUpdate = true; }
  }
  return { ok: true, atlasSize, cells: cellMap.length, dataUrl: canvas.toDataURL('image/png') };
}
export function installTexAtlas() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = { __studioTexAtlasPack: _atlas };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'texpaint', 'Texture atlas packing for draw-call reduction');
  return { ok: true };
}
export default installTexAtlas;
