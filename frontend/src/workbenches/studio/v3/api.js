// ArchDisc Studio V3 — native window.__studio* API surface.
//
// Re-implementing V2's 206 ops in v3-native form, batch by batch. This
// module owns the registration; each batch lands as a slice that adds
// the API + a headed e2e proving parity with V2's behaviour. V3 no
// longer mounts V2, so anything not registered here is genuinely
// missing from V3.
//
// Conventions:
//   • All ops return plain JSON-safe objects of shape { ok, ... }.
//   • Ops that mutate the scene push an undo entry first.
//   • The window registration runs once via registerV3Api() — called
//     by StudioShellV3 on mount.

import * as THREE from 'three';
import { countPrimitives, clearPrimitives, spawnPrimitive } from './spawn';

// ─── Edit-mode state (slice 376/377 V2 equivalent) ───────────────────────
const validEditModes = new Set(['object', 'vertex', 'edge', 'face', 'sculpt']);

// ─── Undo stack ───────────────────────────────────────────────────────────
// Snapshot-based. Each entry captures the scene's primitive transforms +
// geometry positions so an undo restores them. Cheap enough for the
// typical mesh count (< 200 primitives, each < 5 K verts).
const _undo = { past: [], future: [] };
function snapshotScene() {
  const scene = window.__archdiscScene;
  if (!scene) return null;
  const items = [];
  scene.traverse((o) => {
    if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
    const entry = {
      uuid: o.uuid,
      kind: o.userData.archdiscStudioPrimitiveKind || 'unknown',
      position: [o.position.x, o.position.y, o.position.z],
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
      scale: [o.scale.x, o.scale.y, o.scale.z],
      visible: o.visible,
    };
    if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const pos = o.geometry.attributes.position;
      // Snapshot small geometries fully so ops that change index buffer
      // (extrude, inset, subdivide, mirror, symmetrize) round-trip correctly.
      if (pos.count <= 4096) {
        entry.geomPos = Array.from(pos.array);
        if (o.geometry.index) entry.geomIdx = Array.from(o.geometry.index.array);
      }
    }
    items.push(entry);
  });
  return items;
}
function restoreScene(snap) {
  const scene = window.__archdiscScene;
  if (!scene || !snap) return { ok: false, error: 'no scene/snap' };
  const byUuid = new Map();
  scene.traverse((o) => {
    if (o.userData && o.userData.archdiscStudioPrimitive) byUuid.set(o.uuid, o);
  });
  // Drop any primitives that aren't in the snap (they were added since).
  for (const [uuid, mesh] of byUuid) {
    if (!snap.find((e) => e.uuid === uuid)) {
      scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material && mesh.material.dispose) mesh.material.dispose();
      byUuid.delete(uuid);
    }
  }
  // Re-spawn any missing prims (deleted between snap and now).
  for (const entry of snap) {
    if (!byUuid.has(entry.uuid)) {
      const mesh = spawnPrimitive(entry.kind, scene);
      if (mesh) {
        mesh.uuid = entry.uuid; // preserve identity
        byUuid.set(entry.uuid, mesh);
      }
    }
  }
  // Apply transforms + geometry.
  for (const entry of snap) {
    const mesh = byUuid.get(entry.uuid);
    if (!mesh) continue;
    mesh.position.set(...entry.position);
    mesh.rotation.set(...entry.rotation);
    mesh.scale.set(...entry.scale);
    mesh.visible = entry.visible;
    mesh.updateMatrixWorld(true);
    if (entry.geomPos && mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position) {
      // Rebuild geometry from scratch when the vert count OR index buffer
      // changed (true for extrude / inset / subdivide / mirror / symmetrize).
      const pos = mesh.geometry.attributes.position;
      const idxChanged = entry.geomIdx && mesh.geometry.index && entry.geomIdx.length !== mesh.geometry.index.array.length;
      const vertCountChanged = pos.array.length !== entry.geomPos.length;
      if (vertCountChanged || idxChanged) {
        // Build a fresh BufferGeometry mirroring the snapshot.
        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.Float32BufferAttribute(entry.geomPos, 3));
        if (entry.geomIdx) newGeo.setIndex(Array.from(entry.geomIdx));
        newGeo.computeVertexNormals();
        newGeo.computeBoundingSphere();
        mesh.geometry.dispose();
        mesh.geometry = newGeo;
      } else {
        for (let i = 0; i < entry.geomPos.length; i++) pos.array[i] = entry.geomPos[i];
        pos.needsUpdate = true;
        if (mesh.geometry.computeVertexNormals) mesh.geometry.computeVertexNormals();
      }
    }
  }
  return { ok: true, count: snap.length };
}
function pushUndo() {
  const snap = snapshotScene();
  if (snap) {
    _undo.past.push(snap);
    if (_undo.past.length > 64) _undo.past.shift();
    _undo.future.length = 0;
  }
  return { ok: !!snap, depth: _undo.past.length };
}

// ─── Animation toggle (placeholder — no real runtime yet) ───────────────
let _animating = false;

// ─── Scene I/O ───────────────────────────────────────────────────────────
function saveScene() {
  const snap = snapshotScene();
  if (!snap) return null;
  return JSON.stringify({ version: 3, primitives: snap });
}
function loadScene(jsonOrObj) {
  let obj = jsonOrObj;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); }
    catch { return { ok: false, error: 'invalid JSON' }; }
  }
  if (!obj || obj.version !== 3 || !Array.isArray(obj.primitives)) {
    return { ok: false, error: 'unsupported scene version (expected v3)' };
  }
  // Clear current scene, then re-populate from snap.
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false, error: 'no scene' };
  clearPrimitives(scene);
  return restoreScene(obj.primitives);
}

// ─── Registration ────────────────────────────────────────────────────────
export function registerV3Api() {
  if (window.__studioV3ApiRegistered) return;
  window.__studioV3ApiRegistered = true;

  // Edit-mode state.
  if (!window.__studioEditModeRef) window.__studioEditModeRef = { current: 'object' };
  window.__studioGetEditMode = () => window.__studioEditModeRef.current;
  window.__studioSetEditMode = (mode) => {
    if (!validEditModes.has(mode)) return { ok: false, error: 'invalid mode', valid: Array.from(validEditModes) };
    const prev = window.__studioEditModeRef.current;
    window.__studioEditModeRef.current = mode;
    window.dispatchEvent(new CustomEvent('studio-edit-mode-changed', { detail: { mode, prev } }));
    return { ok: true, mode, prev };
  };

  // Multi-select set.
  if (!window.__studioEditSelection) window.__studioEditSelection = { current: { vertices: [], edges: [], faces: [] } };
  window.__studioGetEditSelection = () => {
    const s = window.__studioEditSelection.current;
    return { vertices: s.vertices.slice(), edges: s.edges.map((e) => e.slice()), faces: s.faces.slice() };
  };
  window.__studioClearEditSelection = () => {
    window.__studioEditSelection.current = { vertices: [], edges: [], faces: [] };
    return { ok: true };
  };
  window.__studioReplaceEditSelection = (mode, item) => {
    window.__studioEditSelection.current = { vertices: [], edges: [], faces: [] };
    return window.__studioAddToEditSelection(mode, item);
  };
  window.__studioAddToEditSelection = (mode, item) => {
    const s = window.__studioEditSelection.current;
    if (mode === 'vertex' && Number.isInteger(item)) { if (!s.vertices.includes(item)) s.vertices.push(item); }
    else if (mode === 'edge' && Array.isArray(item) && item.length === 2) {
      const exists = s.edges.find((e) => (e[0] === item[0] && e[1] === item[1]) || (e[0] === item[1] && e[1] === item[0]));
      if (!exists) s.edges.push([item[0], item[1]]);
    }
    else if (mode === 'face' && Number.isInteger(item)) { if (!s.faces.includes(item)) s.faces.push(item); }
    else return { ok: false, error: 'bad mode/item' };
    return { ok: true };
  };

  // Selected mesh accessor (Viewport3D's transformControls owns it).
  window.__studioSelectedMesh = () => {
    const vp = window.__archdiscViewport;
    return (vp && vp.getSelected && vp.getSelected()) || null;
  };
  window.__studioSelectMesh = (mesh) => {
    const vp = window.__archdiscViewport;
    if (vp && vp.transformControls && mesh) {
      vp.transformControls.attach(mesh);
      return { ok: true };
    }
    return { ok: false };
  };

  // Scene I/O.
  window.__studioSaveScene = () => saveScene();
  window.__studioLoadScene = (j) => loadScene(j);
  window.__studioRevealAll = () => {
    const scene = window.__archdiscScene;
    if (!scene) return { ok: false };
    let n = 0;
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive && !o.visible) { o.visible = true; n++; }
    });
    return { ok: true, revealed: n };
  };
  // Slice 491 — Transform snap. Forwards to TransformControls; remembers
  // last step values so toggle-on restores prior snap (1 cm / 15° / 0.1).
  let _snapOn = false;
  let _tStep = 0.01;
  let _rStep = Math.PI / 12; // 15°
  let _sStep = 0.1;
  const applySnap = () => {
    const vp = window.__archdiscViewport;
    const tc = vp && vp.transformControls;
    if (!tc) return false;
    tc.setTranslationSnap(_snapOn ? _tStep : null);
    tc.setRotationSnap(_snapOn ? _rStep : null);
    tc.setScaleSnap(_snapOn ? _sStep : null);
    return true;
  };
  window.__studioSetTranslationSnap = (n) => { _tStep = Number(n) || 0; if (_snapOn) applySnap(); return { ok: true, step: _tStep }; };
  window.__studioSetRotationSnap    = (rad) => { _rStep = Number(rad) || 0; if (_snapOn) applySnap(); return { ok: true, step: _rStep }; };
  window.__studioSetScaleSnap       = (n) => { _sStep = Number(n) || 0; if (_snapOn) applySnap(); return { ok: true, step: _sStep }; };
  window.__studioToggleSnap = () => {
    _snapOn = !_snapOn;
    const ok = applySnap();
    if (ok) {
      window.dispatchEvent(new CustomEvent('studio-snap-toggle', { detail: { snap: _snapOn } }));
      if (window.__studioToast) window.__studioToast(`Snap ${_snapOn ? 'on' : 'off'}`, 'info');
    }
    return { ok, snap: _snapOn };
  };
  window.__studioGetSnap = () => ({ on: _snapOn, t: _tStep, r: _rStep, s: _sStep });
  window.__studioResetTransform = (kind) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo();
    if (kind === 'g') sel.position.set(0, 0, 0);
    else if (kind === 'r') sel.rotation.set(0, 0, 0);
    else if (kind === 's') sel.scale.set(1, 1, 1);
    else return { ok: false, error: 'unknown kind' };
    sel.updateMatrixWorld(true);
    return { ok: true, kind };
  };
  // Slice 501 — Box marquee select op. Takes pixel rect (x1,y1,x2,y2) in
  // canvas-relative coords and returns matched primitive UUIDs (those whose
  // world-space center projects into the rect). Selects the last hit so
  // the inspector reflects the result.
  window.__studioBoxSelect = (x1, y1, x2, y2) => {
    const vp = window.__archdiscViewport;
    const scene = window.__archdiscScene;
    if (!vp || !vp.camera || !vp.renderer || !scene) return { ok: false, error: 'no viewport' };
    const dom = vp.renderer.domElement;
    const W = dom.clientWidth, H = dom.clientHeight;
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const hits = [];
    let last = null;
    const target = new THREE.Vector3();
    scene.traverse((o) => {
      if (!(o.userData && o.userData.archdiscStudioPrimitive)) return;
      o.getWorldPosition(target);
      target.project(vp.camera); // NDC
      const sx = (target.x * 0.5 + 0.5) * W;
      const sy = (1 - (target.y * 0.5 + 0.5)) * H;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        hits.push(o.uuid);
        last = o;
      }
    });
    if (last && window.__studioSelectMesh) window.__studioSelectMesh(last);
    return { ok: true, hits, count: hits.length };
  };
  window.__studioHideUnselected = () => {
    const scene = window.__archdiscScene;
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!scene || !sel) return { ok: false, error: 'no selection' };
    let n = 0;
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o !== sel && o.visible) { o.visible = false; n++; }
    });
    return { ok: true, hidden: n };
  };

  // Undo stack.
  window.__studioPushUndo = () => pushUndo();
  window.__studioUndo = () => {
    if (!_undo.past.length) return { ok: false, error: 'nothing to undo' };
    const current = snapshotScene();
    const prev = _undo.past.pop();
    if (current) _undo.future.push(current);
    return restoreScene(prev);
  };
  window.__studioRedo = () => {
    if (!_undo.future.length) return { ok: false, error: 'nothing to redo' };
    const current = snapshotScene();
    const next = _undo.future.pop();
    if (current) _undo.past.push(current);
    return restoreScene(next);
  };
  window.__studioUndoStackLen = () => _undo.past.length;

  // Anim placeholder.
  window.__studioToggleAnimating = () => { _animating = !_animating; return { ok: true, animating: _animating }; };

  // Scene stats.
  window.__studioListSceneStats = () => {
    const scene = window.__archdiscScene;
    if (!scene) return { ok: false, error: 'no scene', count: 0, totalVerts: 0, meshes: [] };
    const meshes = [];
    let totalVerts = 0;
    scene.traverse((o) => {
      if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
      const v = (o.geometry && o.geometry.attributes && o.geometry.attributes.position && o.geometry.attributes.position.count) || 0;
      totalVerts += v;
      meshes.push({
        uuid: o.uuid,
        kind: o.userData.archdiscStudioPrimitiveKind || 'unknown',
        verts: v,
      });
    });
    return { ok: true, count: meshes.length, totalVerts, meshes };
  };

  // Scene count quick read.
  window.__studioCountPrimitives = () => countPrimitives(window.__archdiscScene);
}

export function unregisterV3Api() {
  if (!window.__studioV3ApiRegistered) return;
  for (const k of [
    '__studioGetEditMode', '__studioSetEditMode',
    '__studioGetEditSelection', '__studioClearEditSelection',
    '__studioReplaceEditSelection', '__studioAddToEditSelection',
    '__studioSelectedMesh', '__studioSelectMesh',
    '__studioSaveScene', '__studioLoadScene', '__studioRevealAll',
    '__studioPushUndo', '__studioUndo', '__studioRedo', '__studioUndoStackLen',
    '__studioToggleAnimating',
    '__studioListSceneStats', '__studioCountPrimitives',
    '__studioV3ApiRegistered',
  ]) {
    try { delete window[k]; } catch (_) {}
  }
}
