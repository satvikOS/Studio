// ArchDisc Studio V3 — camera + transform-utility ops.
//
// V3-native ports of V2 camera framing, axis-view, lookAt, alignment,
// mirror, scatter, clone, recenter primitives. Each registers as a
// window.__studio* op so the cmdbar + QAT + spec callers stay
// interchangeable with V2.

import * as THREE from 'three';

function vp() { return window.__archdiscViewport || null; }
function scene() { return window.__archdiscScene || (vp() && vp().scene) || null; }
function activeMesh() {
  const v = vp();
  return (v && v.getSelected && v.getSelected()) || null;
}

// Walk every Studio-spawned primitive.
function eachPrim(fn) {
  const s = scene(); if (!s) return 0;
  let n = 0;
  s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) { fn(o); n++; } });
  return n;
}

// Scene-wide bounding box from primitive bounds.
function sceneBoundingBox() {
  const s = scene(); if (!s) return null;
  const box = new THREE.Box3();
  let any = false;
  s.traverse((o) => {
    if (o.userData && o.userData.archdiscStudioPrimitive && o.geometry) {
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o);
      box.union(b);
      any = true;
    }
  });
  return any ? box : null;
}

// Fly camera so the given bounding sphere fits the view.
function frameSphere(centre, radius) {
  const v = vp(); if (!v || !v.camera) return false;
  const cam = v.camera;
  // Distance so the sphere fits in the camera's vertical FOV with margin.
  const fovRad = (cam.fov || 45) * Math.PI / 180;
  const dist = (radius * 1.6) / Math.sin(fovRad / 2);
  // Keep the existing look direction; offset along it from the new target.
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir).negate(); // dir now points camera→away
  cam.position.copy(centre).addScaledVector(dir, dist);
  const ctrl = v.orbitControls || v.controls;
  if (ctrl) {
    ctrl.target.copy(centre);
    if (ctrl.update) ctrl.update();
  } else {
    cam.lookAt(centre);
  }
  cam.updateMatrixWorld(true);
  return true;
}

// ─── Camera framing ──────────────────────────────────────────────────────
function frameAll() {
  const box = sceneBoundingBox();
  if (!box) return { ok: false, error: 'empty scene' };
  const centre = new THREE.Vector3(); box.getCenter(centre);
  const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
  return { ok: frameSphere(centre, Math.max(radius, 0.01)), centre: [centre.x, centre.y, centre.z], radius };
}
function fitSelected() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (!m.geometry || !m.geometry.computeBoundingSphere) return { ok: false, error: 'no geometry' };
  m.updateMatrixWorld(true);
  m.geometry.computeBoundingSphere();
  const bs = m.geometry.boundingSphere;
  if (!bs) return { ok: false, error: 'no bounds' };
  const centre = bs.center.clone().applyMatrix4(m.matrixWorld);
  const radius = bs.radius * Math.max(m.scale.x, m.scale.y, m.scale.z);
  return { ok: frameSphere(centre, Math.max(radius, 0.005)), centre: [centre.x, centre.y, centre.z], radius };
}

// ─── Axis view (top/front/side/persp) ────────────────────────────────────
function setCameraAxis(axis) {
  const v = vp(); if (!v || !v.camera) return { ok: false, error: 'no viewport' };
  const cam = v.camera;
  const ctrl = v.orbitControls || v.controls;
  const target = (ctrl && ctrl.target) || new THREE.Vector3(0, 0, 0);
  const dist = Math.max(cam.position.distanceTo(target), 0.15);
  let dir;
  if (axis === 'top')        dir = new THREE.Vector3(0, 1, 0.001);
  else if (axis === 'front') dir = new THREE.Vector3(0, 0, 1);
  else if (axis === 'side')  dir = new THREE.Vector3(1, 0, 0);
  else if (axis === 'persp') dir = new THREE.Vector3(1, 0.7, 1).normalize();
  else return { ok: false, error: 'unknown axis' };
  cam.position.copy(target).addScaledVector(dir, dist);
  if (ctrl) { if (ctrl.update) ctrl.update(); }
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  return { ok: true, axis, target: [target.x, target.y, target.z] };
}

// ─── Object-level transforms ─────────────────────────────────────────────
function lookAt(target) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(target) || target.length !== 3) return { ok: false, error: 'bad target' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  m.lookAt(target[0], target[1], target[2]);
  m.updateMatrixWorld(true);
  return { ok: true, target };
}
function centerAtOrigin() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const prev = [m.position.x, m.position.y, m.position.z];
  m.position.set(0, 0, 0); m.updateMatrixWorld(true);
  return { ok: true, prev };
}
function alignToGround() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (!m.geometry || !m.geometry.computeBoundingBox) return { ok: false, error: 'no geometry' };
  m.geometry.computeBoundingBox();
  const b = m.geometry.boundingBox; if (!b) return { ok: false, error: 'no bounds' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  // Move so the local-space min Y sits on Y=0 in world after scale.
  m.position.y = -b.min.y * m.scale.y;
  m.updateMatrixWorld(true);
  return { ok: true, y: m.position.y };
}
function applyTransforms() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  // Bake position/rotation/scale into vertex positions, then reset.
  m.updateMatrixWorld(true);
  const pos = m.geometry.attributes.position;
  if (!pos) return { ok: false, error: 'no geometry positions' };
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
  m.updateMatrixWorld(true);
  if (m.geometry.computeVertexNormals) m.geometry.computeVertexNormals();
  if (m.geometry.computeBoundingSphere) m.geometry.computeBoundingSphere();
  if (m.geometry.boundsTree && m.geometry.disposeBoundsTree) m.geometry.disposeBoundsTree();
  return { ok: true };
}
function recenterPivot() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (!m.geometry || !m.geometry.computeBoundingBox) return { ok: false, error: 'no geometry' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  m.geometry.computeBoundingBox();
  const b = m.geometry.boundingBox;
  const c = new THREE.Vector3(); b.getCenter(c);
  // Shift verts so centroid is at local 0; offset position so visual stays.
  const pos = m.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) - c.x, pos.getY(i) - c.y, pos.getZ(i) - c.z);
  }
  pos.needsUpdate = true;
  // Compensate in world space for the visual shift.
  m.updateMatrixWorld(true);
  const worldShift = c.clone().applyMatrix4(m.matrixWorld).sub(new THREE.Vector3(0, 0, 0).applyMatrix4(m.matrixWorld));
  m.position.add(worldShift);
  m.updateMatrixWorld(true);
  if (m.geometry.computeBoundingSphere) m.geometry.computeBoundingSphere();
  return { ok: true, centroid: [c.x, c.y, c.z] };
}
function mirrorAcrossAxis(axis = 'x') {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const pos = m.geometry.attributes.position; if (!pos) return { ok: false, error: 'no positions' };
  let sx = 1, sy = 1, sz = 1;
  if (axis === 'x') sx = -1;
  else if (axis === 'y') sy = -1;
  else if (axis === 'z') sz = -1;
  else return { ok: false, error: 'bad axis' };
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * sx, pos.getY(i) * sy, pos.getZ(i) * sz);
  }
  // Reverse triangle winding so faces don't invert.
  if (m.geometry.index) {
    const ia = m.geometry.index.array;
    for (let i = 0; i < ia.length; i += 3) { const t = ia[i]; ia[i] = ia[i + 2]; ia[i + 2] = t; }
    m.geometry.index.needsUpdate = true;
  }
  pos.needsUpdate = true;
  if (m.geometry.computeVertexNormals) m.geometry.computeVertexNormals();
  if (m.geometry.computeBoundingSphere) m.geometry.computeBoundingSphere();
  if (m.geometry.boundsTree && m.geometry.disposeBoundsTree) m.geometry.disposeBoundsTree();
  return { ok: true, axis };
}

// ─── Scatter / clone ─────────────────────────────────────────────────────
function cloneAlongAxis(axis = 'x', count = 5, step = 0.05) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (typeof count !== 'number' || count < 1) return { ok: false, error: 'bad count' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const made = [];
  for (let i = 1; i <= count; i++) {
    const clone = m.clone();
    clone.geometry = m.geometry.clone();
    clone.material = m.material;
    clone.userData = { ...m.userData };
    if (axis === 'x') clone.position.x += step * i;
    else if (axis === 'y') clone.position.y += step * i;
    else if (axis === 'z') clone.position.z += step * i;
    scene().add(clone);
    made.push(clone.uuid);
  }
  return { ok: true, axis, count: made.length, uuids: made };
}
function randomScatter(count = 12, radius = 0.2, seed = 1234) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  // Mulberry32 for deterministic seeding.
  let s = seed >>> 0;
  const rand = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const made = [];
  for (let i = 0; i < count; i++) {
    const clone = m.clone();
    clone.geometry = m.geometry.clone();
    clone.material = m.material;
    clone.userData = { ...m.userData };
    clone.position.set(
      m.position.x + (rand() - 0.5) * radius * 2,
      m.position.y + (rand() - 0.5) * radius * 2,
      m.position.z + (rand() - 0.5) * radius * 2,
    );
    clone.rotation.y = rand() * Math.PI * 2;
    scene().add(clone);
    made.push(clone.uuid);
  }
  return { ok: true, count: made.length, uuids: made };
}

// ─── Group / merge meshes ────────────────────────────────────────────────
function groupSelected() {
  // Slice 506 — Use the multi-select set if present, else fall back to
  // the active mesh.
  const set = Array.isArray(window.__studioSelectedMeshesSet) && window.__studioSelectedMeshesSet.length
    ? window.__studioSelectedMeshesSet.slice()
    : (activeMesh() ? [activeMesh()] : []);
  if (!set.length) return { ok: false, error: 'no mesh' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const group = new THREE.Group();
  group.name = `${set[0].name}-group`;
  group.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'group',
  };
  const s = scene(); s.add(group);
  for (const m of set) group.attach(m);
  return { ok: true, uuid: group.uuid, members: set.length };
}

function ungroupSelected() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  // Walk up to the nearest archdisc group.
  let g = m;
  while (g && !(g.userData && g.userData.archdiscStudioPrimitiveKind === 'group')) g = g.parent;
  if (!g) return { ok: false, error: 'no parent group' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const s = scene();
  const kids = g.children.slice();
  for (const c of kids) s.attach(c);
  g.parent && g.parent.remove(g);
  return { ok: true, freed: kids.length };
}

// ─── Registration ────────────────────────────────────────────────────────
export function registerCameraOps() {
  window.__studioFrameAll        = frameAll;
  window.__studioFitSelected     = fitSelected;
  window.__studioSetCameraAxis   = setCameraAxis;
  window.__studioLookAt          = lookAt;
  window.__studioCenterAtOrigin  = centerAtOrigin;
  window.__studioAlignToGround   = alignToGround;
  window.__studioApplyTransforms = applyTransforms;
  window.__studioRecenterPivot   = recenterPivot;
  window.__studioMirrorAcrossAxis = mirrorAcrossAxis;
  window.__studioCloneAlongAxis  = cloneAlongAxis;
  window.__studioRandomScatter   = randomScatter;
  window.__studioGroupSelected   = groupSelected;
  window.__studioUngroupSelected = ungroupSelected;
}
export function unregisterCameraOps() {
  for (const k of [
    '__studioFrameAll', '__studioFitSelected', '__studioSetCameraAxis',
    '__studioLookAt', '__studioCenterAtOrigin', '__studioAlignToGround',
    '__studioApplyTransforms', '__studioRecenterPivot', '__studioMirrorAcrossAxis',
    '__studioCloneAlongAxis', '__studioRandomScatter', '__studioGroupSelected',
    '__studioUngroupSelected',
  ]) { try { delete window[k]; } catch (_) {} }
}
