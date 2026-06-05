// ArchDisc Studio V3 — voxel pointer dragger (add / remove + ghost).
//
// Hooks pointermove + pointerdown on the renderer canvas. On move we
// raycast against the current voxel mesh AND a backing ground plane
// (so the user can place voxels into an empty volume too). The result
// is a "hover cell" (x,y,z) which we render as a translucent ghost
// box.
//
// Click semantics:
//   • plain click → add a voxel at the hovered cell (uses the active
//                   palette index)
//   • shift+click → remove the voxel under the cursor
//
// We intentionally bypass orbit-controls only on actual paint clicks
// — orbiting the camera with right-click / middle-click still works
// because we don't preventDefault on those buttons.
//
// All raycasting is done in the volume mesh's LOCAL coordinate space
// so the dragger doesn't break if the user later moves / rotates the
// volume mesh in the scene.

import * as THREE from 'three';

const _state = {
  installed: false,
  dom: null,
  onMove: null,
  onDown: null,
  raycaster: new THREE.Raycaster(),
  ndc: new THREE.Vector2(),
  // Wired by index.js — these read the live volume + scene state.
  getVolume: () => null,
  getCellSize: () => 0.1,
  getMesh: () => null,            // the rebuilt voxel THREE.Mesh
  getActiveIdx: () => 1,
  onSet: (_x, _y, _z, _idx) => {},  // applied set callback
  rebuild: () => {},                 // request a mesh rebuild
  // Ghost
  ghost: null,
  hover: null,                      // { x, y, z, face } in cell coords
  // Toggle
  enabled: false,
};

function getViewport() {
  return (typeof window !== 'undefined') ? window.__archdiscViewport : null;
}
function getDom() {
  const vp = getViewport();
  return (vp && vp.renderer && vp.renderer.domElement) ? vp.renderer.domElement : null;
}
function getCamera() {
  const vp = getViewport();
  return (vp && vp.camera) || null;
}
function getScene() {
  return (typeof window !== 'undefined') ? window.__archdiscScene : null;
}

function setNdcFromEvent(ev, dom) {
  const r = dom.getBoundingClientRect();
  const w = r.width > 0 ? r.width : 1;
  const h = r.height > 0 ? r.height : 1;
  _state.ndc.x = ((ev.clientX - r.left) / w) * 2 - 1;
  _state.ndc.y = -((ev.clientY - r.top) / h) * 2 + 1;
}

// Convert a world-space hit to integer cell coordinates inside the
// volume's local box. `bumpIntoNeighbour` controls whether we want the
// cell the hit point is INSIDE (false — used for "remove") or the
// neighbour cell on the FAR side of the face we hit (true — used for
// "add" so the new voxel sits on top of the clicked face).
function hitToCell(point, face, volume, cellSize, mesh, bumpIntoNeighbour) {
  if (!volume) return null;
  // Convert hit to mesh-local space
  const local = mesh ? mesh.worldToLocal(point.clone()) : point.clone();
  const sx = volume.sizeX, sy = volume.sizeY, sz = volume.sizeZ;
  const halfX = sx * cellSize * 0.5;
  const halfY = sy * cellSize * 0.5;
  const halfZ = sz * cellSize * 0.5;

  let cx = Math.floor((local.x + halfX) / cellSize);
  let cy = Math.floor((local.y + halfY) / cellSize);
  let cz = Math.floor((local.z + halfZ) / cellSize);

  if (bumpIntoNeighbour && face && face.normal) {
    // Nudge half a cell along the face normal so we sit firmly inside
    // the neighbouring cell.
    const n = face.normal;
    cx += Math.sign(n.x);
    cy += Math.sign(n.y);
    cz += Math.sign(n.z);
  }
  if (cx < 0 || cy < 0 || cz < 0) return null;
  if (cx >= sx || cy >= sy || cz >= sz) return null;
  return { x: cx, y: cy, z: cz };
}

function raycastForCell(ev, opts = {}) {
  const dom = getDom();
  const cam = getCamera();
  const volume = _state.getVolume();
  if (!dom || !cam || !volume) return null;
  setNdcFromEvent(ev, dom);
  _state.raycaster.setFromCamera(_state.ndc, cam);

  const cellSize = _state.getCellSize() || 0.1;
  const mesh = _state.getMesh();

  // 1) Try the voxel mesh first — gives us the precise face the
  //    pointer is over.
  if (mesh) {
    const hits = _state.raycaster.intersectObject(mesh, false);
    if (hits.length) {
      const h = hits[0];
      const cell = hitToCell(h.point, h.face, volume, cellSize, mesh, opts.bump);
      if (cell) return { ...cell, face: h.face };
    }
  }

  // 2) Fall back to a ground plane at the volume's bottom (local y=0).
  //    This lets the user place the very first voxel into an empty
  //    volume.
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), volume.sizeY * cellSize * 0.5);
  const hit = new THREE.Vector3();
  if (_state.raycaster.ray.intersectPlane(plane, hit)) {
    const cell = hitToCell(hit, { normal: new THREE.Vector3(0, 0, 0) }, volume, cellSize, mesh, false);
    if (cell) return { ...cell, face: null };
  }
  return null;
}

function ensureGhost() {
  if (_state.ghost) return _state.ghost;
  const scene = getScene();
  if (!scene) return null;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x1de9b6,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    wireframe: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'voxel-ghost';
  mesh.renderOrder = 999;
  mesh.userData.archdiscStudioVoxelGhost = true;
  scene.add(mesh);
  _state.ghost = mesh;
  return mesh;
}

function hideGhost() {
  if (_state.ghost) _state.ghost.visible = false;
}

function placeGhost(cell) {
  const g = ensureGhost();
  if (!g) return;
  const volume = _state.getVolume();
  const cs = _state.getCellSize();
  const mesh = _state.getMesh();
  if (!volume) { g.visible = false; return; }
  const halfX = volume.sizeX * cs * 0.5;
  const halfY = volume.sizeY * cs * 0.5;
  const halfZ = volume.sizeZ * cs * 0.5;
  const lx = -halfX + (cell.x + 0.5) * cs;
  const ly = -halfY + (cell.y + 0.5) * cs;
  const lz = -halfZ + (cell.z + 0.5) * cs;
  // Place in world space — if the volume mesh has been moved, the
  // ghost follows it.
  const worldP = new THREE.Vector3(lx, ly, lz);
  if (mesh) mesh.localToWorld(worldP);
  g.position.copy(worldP);
  g.scale.setScalar(cs * 1.02);
  g.visible = true;
}

function onMove(ev) {
  if (!_state.enabled) return;
  const cell = raycastForCell(ev, { bump: true });
  if (!cell) { _state.hover = null; hideGhost(); return; }
  _state.hover = cell;
  placeGhost(cell);
}

function onDown(ev) {
  if (!_state.enabled) return;
  if (ev.button != null && ev.button !== 0) return; // primary only
  const volume = _state.getVolume();
  if (!volume) return;
  const remove = !!ev.shiftKey;
  const cell = raycastForCell(ev, { bump: !remove });
  if (!cell) return;
  if (remove) {
    _state.onSet(cell.x, cell.y, cell.z, 0);
  } else {
    _state.onSet(cell.x, cell.y, cell.z, _state.getActiveIdx());
  }
  _state.rebuild();
  // Update ghost position after the mesh has been rebuilt.
  setTimeout(() => {
    if (_state.hover) placeGhost(_state.hover);
  }, 0);
  ev.preventDefault();
  ev.stopPropagation();
}

export function install(opts) {
  if (opts && typeof opts === 'object') Object.assign(_state, opts);
  if (_state.installed) return { ok: true, alreadyInstalled: true };
  const dom = getDom();
  if (!dom) return { ok: false, error: 'no viewport canvas' };
  _state.onMove = onMove;
  _state.onDown = onDown;
  dom.addEventListener('pointermove', _state.onMove);
  dom.addEventListener('pointerdown', _state.onDown, true);
  _state.dom = dom;
  _state.installed = true;
  return { ok: true };
}

export function uninstall() {
  if (!_state.installed) return { ok: true, alreadyUninstalled: true };
  if (_state.dom) {
    try { _state.dom.removeEventListener('pointermove', _state.onMove); } catch (_) {}
    try { _state.dom.removeEventListener('pointerdown', _state.onDown, true); } catch (_) {}
  }
  if (_state.ghost) {
    const scene = getScene();
    if (scene) scene.remove(_state.ghost);
    try { _state.ghost.geometry.dispose(); } catch (_) {}
    try { _state.ghost.material.dispose(); } catch (_) {}
    _state.ghost = null;
  }
  _state.dom = null;
  _state.installed = false;
  _state.enabled = false;
  return { ok: true };
}

export function setEnabled(on) {
  _state.enabled = !!on;
  if (!_state.enabled) hideGhost();
  return { ok: true, enabled: _state.enabled };
}

export function isEnabled() {
  return _state.enabled;
}

export function getHover() {
  return _state.hover ? { ...(_state.hover) } : null;
}

// Test hook: simulate a pointer hit at integer cell coords without
// going through the renderer raycast path. Used by the e2e spec to
// drive add/remove deterministically.
export function simulateClick(x, y, z, shift) {
  const volume = _state.getVolume();
  if (!volume) return { ok: false, error: 'no volume' };
  if (x < 0 || y < 0 || z < 0) return { ok: false, error: 'oob' };
  if (x >= volume.sizeX || y >= volume.sizeY || z >= volume.sizeZ) return { ok: false, error: 'oob' };
  const idx = shift ? 0 : _state.getActiveIdx();
  _state.onSet(x, y, z, idx);
  _state.rebuild();
  return { ok: true, x, y, z, idx };
}

export default { install, uninstall, setEnabled, isEnabled, getHover, simulateClick };
