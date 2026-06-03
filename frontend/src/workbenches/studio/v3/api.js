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
const _undo = { past: [], future: [], labels: [] };
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
function pushUndo(label) {
  const snap = snapshotScene();
  if (snap) {
    _undo.past.push(snap);
    _undo.labels.push({ label: label || 'edit', ts: Date.now() });
    if (_undo.past.length > 64) { _undo.past.shift(); _undo.labels.shift(); }
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
  // Slice 529 — Lock / unlock selected. Locked meshes resist transform
  // by snapping back to their pre-gizmo state on each frame. Flag stored
  // in userData.archdiscStudioLocked.
  window.__studioToggleLockSelected = () => {
    const set = Array.isArray(window.__studioSelectedMeshesSet) && window.__studioSelectedMeshesSet.length
      ? window.__studioSelectedMeshesSet.slice()
      : (window.__studioSelectedMesh && window.__studioSelectedMesh() ? [window.__studioSelectedMesh()] : []);
    if (!set.length) return { ok: false, error: 'no selection' };
    // Toggle based on the first member's current state.
    const nextLocked = !(set[0].userData && set[0].userData.archdiscStudioLocked);
    for (const m of set) {
      m.userData = m.userData || {};
      m.userData.archdiscStudioLocked = nextLocked;
      if (nextLocked) {
        m.userData.__lockedTransform = {
          p: [m.position.x, m.position.y, m.position.z],
          r: [m.rotation.x, m.rotation.y, m.rotation.z],
          s: [m.scale.x, m.scale.y, m.scale.z],
        };
      } else {
        delete m.userData.__lockedTransform;
      }
    }
    if (window.__studioToast) window.__studioToast(`${nextLocked ? 'Locked' : 'Unlocked'} ${set.length}`, 'info');
    return { ok: true, locked: nextLocked, count: set.length };
  };

  // Bind a per-frame guard the first time the op is registered; safe to
  // call repeatedly because it's idempotent on the symbol.
  if (!window.__studioLockedGuardAttached) {
    window.__studioLockedGuardAttached = true;
    const tick = () => {
      const s = window.__archdiscScene;
      if (s) {
        try {
          s.traverse((o) => {
            if (o.userData && o.userData.archdiscStudioLocked && o.userData.__lockedTransform) {
              const lt = o.userData.__lockedTransform;
              o.position.set(lt.p[0], lt.p[1], lt.p[2]);
              o.rotation.set(lt.r[0], lt.r[1], lt.r[2]);
              o.scale.set(lt.s[0], lt.s[1], lt.s[2]);
            }
          });
        } catch (_) {}
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Slice 541 — Selected mesh outline highlight. Attaches a teal
  // LineSegments child built from EdgesGeometry; auto-removes from any
  // previous selection. Driven by a rAF loop watching the active mesh.
  let _outlineFor = null;
  const removeOutline = (m) => {
    if (!m) return;
    const child = m.children && m.children.find((c) => c.userData && c.userData.__studioOutline);
    if (child) {
      if (child.geometry && child.geometry.dispose) child.geometry.dispose();
      if (child.material && child.material.dispose) child.material.dispose();
      m.remove(child);
    }
  };
  const addOutline = (m) => {
    if (!m || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) return;
    const edges = new THREE.EdgesGeometry(m.geometry, 30);
    const mat = new THREE.LineBasicMaterial({ color: 0x1de9b6, depthTest: false, transparent: true, opacity: 0.85 });
    const lines = new THREE.LineSegments(edges, mat);
    lines.userData = { __studioOutline: true, isHelper: true };
    lines.renderOrder = 998;
    m.add(lines);
  };
  if (!window.__studioOutlineGuardAttached) {
    window.__studioOutlineGuardAttached = true;
    const tick = () => {
      const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
      if (m !== _outlineFor) {
        removeOutline(_outlineFor);
        _outlineFor = m;
        if (m && m.geometry) addOutline(m);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Slice 556 — Reset camera home.
  window.__studioResetCamera = () => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.camera) return { ok: false, error: 'no viewport' };
    vp.camera.position.set(0.15, 0.12, 0.18);
    const ctrl = vp.orbitControls || vp.controls;
    if (ctrl && ctrl.target) {
      ctrl.target.set(0, 0, 0);
      if (typeof ctrl.update === 'function') ctrl.update();
    }
    if (window.__studioFrameAll) window.__studioFrameAll();
    if (window.__studioToast) window.__studioToast('Camera reset', 'info');
    return { ok: true };
  };

  // Slice 521 — Annotation op. Spawns a Sprite-style text overlay anchored
  // at a world point. Uses a CanvasTexture so we don't pull in extra deps.
  // Persists in userData.archdiscStudioAnnotation. window.__studioListAnnotations
  // returns [{ uuid, text, position }].
  // Slice 534 — Reference image plate. Adds a Plane geometry textured
  // from a data-URL or any image URL. Useful for tracing references.
  // Persists in userData.archdiscStudioImagePlate.
  window.__studioAddImagePlate = (url, opts = {}) => {
    const s = window.__archdiscScene;
    if (!s || !url) return { ok: false, error: 'no scene or url' };
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const aspect = img.width / img.height;
        const h = opts.height || 1;
        const w = h * aspect;
        const geom = new THREE.PlaneGeometry(w, h);
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(opts.x || 0, opts.y || h / 2, opts.z || 0);
        if (opts.rotation) mesh.rotation.set(opts.rotation[0], opts.rotation[1], opts.rotation[2]);
        mesh.name = opts.name || 'image-plate';
        mesh.userData = { archdiscStudioImagePlate: true, src: url.length > 80 ? '<inline>' : url };
        s.add(mesh);
        if (window.__studioToast) window.__studioToast(`Reference plate added (${img.width}×${img.height})`, 'ok');
        resolve({ ok: true, uuid: mesh.uuid, width: img.width, height: img.height });
      };
      img.onerror = () => resolve({ ok: false, error: 'image load failed' });
      img.src = url;
    });
  };
  window.__studioListImagePlates = () => {
    const s = window.__archdiscScene;
    if (!s) return [];
    const out = [];
    s.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioImagePlate) out.push({ uuid: o.uuid, name: o.name, src: o.userData.src });
    });
    return out;
  };

  // Slice 568 — Toggle a 0.2 m AxesHelper at world origin.
  window.__studioToggleWorldAxes = () => {
    const s = window.__archdiscScene;
    if (!s) return { ok: false };
    if (window.__studioWorldAxesHelper) {
      s.remove(window.__studioWorldAxesHelper);
      window.__studioWorldAxesHelper.geometry && window.__studioWorldAxesHelper.geometry.dispose && window.__studioWorldAxesHelper.geometry.dispose();
      window.__studioWorldAxesHelper = null;
      return { ok: true, on: false };
    }
    const h = new THREE.AxesHelper(0.2);
    h.userData = { isHelper: true, archdiscStudioWorldAxes: true };
    h.renderOrder = 997;
    s.add(h);
    window.__studioWorldAxesHelper = h;
    return { ok: true, on: true };
  };

  // Slice 567 — Toggle a Box3Helper on the active mesh's world AABB.
  // Useful for engineering reviews. Helper auto-attaches to whatever
  // mesh is selected at toggle time.
  window.__studioToggleAABB = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    if (window.__studioAABBHelper && window.__studioAABBHelper.parent) {
      window.__studioAABBHelper.parent.remove(window.__studioAABBHelper);
      window.__studioAABBHelper.geometry.dispose();
      window.__studioAABBHelper.material.dispose();
      window.__studioAABBHelper = null;
      return { ok: true, on: false };
    }
    const box = new THREE.Box3().setFromObject(sel);
    const helper = new THREE.Box3Helper(box, 0x1de9b6);
    helper.userData = { isHelper: true, archdiscStudioAABB: true };
    helper.renderOrder = 998;
    sel.parent ? sel.parent.add(helper) : window.__archdiscScene.add(helper);
    window.__studioAABBHelper = helper;
    if (window.__studioToast) window.__studioToast('AABB on', 'info');
    return { ok: true, on: true };
  };

  // Slice 565 — Geometry tools. Compute smooth normals; merge near-
  // duplicate vertices (welding). Lazy-imports BufferGeometryUtils.
  window.__studioComputeVertexNormals = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    sel.geometry.computeVertexNormals();
    if (window.__studioToast) window.__studioToast('Vertex normals recomputed', 'ok');
    return { ok: true };
  };
  window.__studioWeldVertices = async (tol) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const mod = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    const before = sel.geometry.attributes.position.count;
    const merged = mod.mergeVertices(sel.geometry, tol || 1e-4);
    if (!merged) return { ok: false, error: 'merge failed' };
    sel.geometry.dispose();
    sel.geometry = merged;
    const after = sel.geometry.attributes.position.count;
    if (window.__studioToast) window.__studioToast(`Welded ${before}→${after}`, 'ok');
    return { ok: true, before, after };
  };

  // Slice 559 — Tag selected primitives. Tags persist in userData.tags
  // (a string[]) so they roundtrip through save / load. __studioListTags
  // dedupes across the scene for UIs.
  window.__studioAddTag = (tag) => {
    const set = Array.isArray(window.__studioSelectedMeshesSet) && window.__studioSelectedMeshesSet.length
      ? window.__studioSelectedMeshesSet.slice()
      : (window.__studioSelectedMesh && window.__studioSelectedMesh() ? [window.__studioSelectedMesh()] : []);
    if (!set.length || !tag) return { ok: false, error: 'no selection or tag' };
    const t = String(tag).trim().slice(0, 32);
    if (!t) return { ok: false, error: 'empty tag' };
    for (const m of set) {
      m.userData = m.userData || {};
      m.userData.tags = m.userData.tags || [];
      if (!m.userData.tags.includes(t)) m.userData.tags.push(t);
    }
    if (window.__studioToast) window.__studioToast(`Tagged ${set.length} as #${t}`, 'ok');
    return { ok: true, tag: t, count: set.length };
  };
  window.__studioRemoveTag = (tag) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.userData || !sel.userData.tags) return { ok: false };
    sel.userData.tags = sel.userData.tags.filter((x) => x !== tag);
    return { ok: true };
  };
  window.__studioListTags = () => {
    const s = window.__archdiscScene;
    if (!s) return [];
    const seen = new Set();
    s.traverse((o) => {
      if (o.userData && Array.isArray(o.userData.tags)) {
        for (const t of o.userData.tags) seen.add(t);
      }
    });
    return Array.from(seen).sort();
  };
  window.__studioSelectByTag = (tag) => {
    const s = window.__archdiscScene;
    if (!s) return { ok: false };
    const set = [];
    s.traverse((o) => {
      if (o.userData && Array.isArray(o.userData.tags) && o.userData.tags.includes(tag)) set.push(o);
    });
    window.__studioSelectedMeshesSet = set;
    if (set.length && window.__studioSelectMesh) window.__studioSelectMesh(set[set.length - 1]);
    if (window.__studioToast) window.__studioToast(`Selected ${set.length} #${tag}`, 'info');
    return { ok: true, count: set.length };
  };

  window.__studioAddAnnotation = (text, position) => {
    const s = window.__archdiscScene;
    if (!s) return { ok: false, error: 'no scene' };
    let pos = position;
    if (!pos) {
      const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
      if (!sel) return { ok: false, error: 'no selection' };
      const wp = new THREE.Vector3();
      sel.getWorldPosition(wp);
      pos = [wp.x, wp.y + 0.03, wp.z];
    }
    const txt = (text || 'note').slice(0, 60);
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = 'rgba(29, 233, 182, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 254, 62);
    ctx.fillStyle = '#e6edf3';
    ctx.font = '20px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(pos[0], pos[1], pos[2]);
    sprite.scale.set(0.16, 0.04, 1);
    sprite.userData = { archdiscStudioAnnotation: true, text: txt };
    sprite.renderOrder = 999;
    s.add(sprite);
    return { ok: true, uuid: sprite.uuid, text: txt, position: pos };
  };
  window.__studioListAnnotations = () => {
    const s = window.__archdiscScene;
    if (!s) return [];
    const out = [];
    s.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioAnnotation) {
        out.push({ uuid: o.uuid, text: o.userData.text, position: [o.position.x, o.position.y, o.position.z] });
      }
    });
    return out;
  };

  // Slice 512 — Distance measurement op. Takes the last two members
  // of __studioSelectedMeshesSet (or any explicit pair via uuids) and
  // returns world-space distance + dispatches studio-measure-result.
  window.__studioMeasureSelected = (uuid1, uuid2) => {
    const s = window.__archdiscScene;
    if (!s) return { ok: false, error: 'no scene' };
    const findByUuid = (u) => { let m = null; s.traverse((o) => { if (o.uuid === u) m = o; }); return m; };
    let a, b;
    if (uuid1 && uuid2) { a = findByUuid(uuid1); b = findByUuid(uuid2); }
    else {
      const set = Array.isArray(window.__studioSelectedMeshesSet) ? window.__studioSelectedMeshesSet : [];
      if (set.length < 2) return { ok: false, error: 'need 2 selected' };
      a = set[set.length - 2]; b = set[set.length - 1];
    }
    if (!a || !b) return { ok: false, error: 'missing meshes' };
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    a.getWorldPosition(pa); b.getWorldPosition(pb);
    const d = pa.distanceTo(pb);

    // Slice 513 — Visual line. Reuse a single LineSegments + replace
    // each measure. Tag userData so it's distinguishable in the outliner.
    let line = s.getObjectByName('__studio_measure_line');
    if (line) {
      if (line.geometry) line.geometry.dispose();
      s.remove(line);
    }
    const geo = new THREE.BufferGeometry().setFromPoints([pa, pb]);
    const mat = new THREE.LineBasicMaterial({ color: 0x1de9b6, depthTest: false, transparent: true, opacity: 0.95 });
    line = new THREE.LineSegments(geo, mat);
    line.name = '__studio_measure_line';
    line.userData = { isHelper: true, archdiscStudioMeasure: true };
    line.renderOrder = 999;
    s.add(line);

    const detail = { a: a.uuid, b: b.uuid, distance: d, mm: d * 1000 };
    window.dispatchEvent(new CustomEvent('studio-measure-result', { detail }));
    if (window.__studioToast) window.__studioToast(`Distance: ${(d * 1000).toFixed(1)} mm`, 'info');
    return { ok: true, ...detail };
  };

  // Slice 513 — Clear measurement helper.
  window.__studioClearMeasure = () => {
    const s = window.__archdiscScene;
    if (!s) return { ok: false };
    const line = s.getObjectByName('__studio_measure_line');
    if (line) { if (line.geometry) line.geometry.dispose(); if (line.material) line.material.dispose(); s.remove(line); }
    return { ok: true };
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
  // Slice 518 — see below for the label-aware override.
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
  window.__studioListUndoHistory = () => _undo.labels.slice();
  // Allow callers to attach a custom label without rewriting every site
  // that used the original no-arg signature.
  window.__studioPushUndo = (label) => pushUndo(label);

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
