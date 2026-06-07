// ArchDisc Studio V3 — mesh streaming partitioner (slice 823).
// Splits a huge scene into world-partition cells so the renderer only
// activates the cells around the camera — Unreal World Partition / Unity
// Adaptive Probe streaming.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _grid = null;
function _partition({ cellSize = 0.2, radius = 2 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  _grid = { cellSize, radius, cells: new Map() };
  scene.traverse((o) => {
    if (!o.isMesh || !o.userData?.archdiscStudioPrimitive) return;
    const p = o.position;
    const cx = Math.floor(p.x / cellSize), cy = Math.floor(p.y / cellSize), cz = Math.floor(p.z / cellSize);
    const key = `${cx}_${cy}_${cz}`;
    if (!_grid.cells.has(key)) _grid.cells.set(key, { cx, cy, cz, members: [] });
    _grid.cells.get(key).members.push(o.uuid);
  });
  return { ok: true, cellCount: _grid.cells.size, cellSize };
}
function _activate(cameraPos) {
  if (!_grid || !cameraPos) return { ok: false };
  const scene = window.__archdiscScene;
  const cx = Math.floor(cameraPos[0] / _grid.cellSize);
  const cy = Math.floor(cameraPos[1] / _grid.cellSize);
  const cz = Math.floor(cameraPos[2] / _grid.cellSize);
  let active = 0;
  for (const cell of _grid.cells.values()) {
    const inRange = Math.abs(cell.cx - cx) <= _grid.radius && Math.abs(cell.cy - cy) <= _grid.radius && Math.abs(cell.cz - cz) <= _grid.radius;
    for (const uuid of cell.members) {
      const obj = scene?.getObjectByProperty('uuid', uuid);
      if (obj) obj.visible = inRange;
      if (inRange) active++;
    }
  }
  return { ok: true, activeMeshes: active };
}
export function installStreamPart() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioStreamPartition: _partition,
    __studioStreamActivate: ({ cameraPos } = {}) => _activate(cameraPos),
    __studioStreamGetGrid: () => ({ ok: true, ..._grid ? { cellSize: _grid.cellSize, cellCount: _grid.cells.size } : { initialised: false } }),
    __studioStreamReset: () => { _grid = null; return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'World partition streaming');
  return { ok: true };
}
export default installStreamPart;
