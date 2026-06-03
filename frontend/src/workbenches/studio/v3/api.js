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

  // Slice 574 — Plugin manager. A "plugin" is a string of JS that
  // gets eval'd at install + at every shell mount. Plugins persist in
  // localStorage at studio.v3.plugins as { name, code, installedAt }[].
  const PLUGIN_KEY = 'studio.v3.plugins';
  const loadPlugins = () => {
    try { return JSON.parse(window.localStorage.getItem(PLUGIN_KEY) || '[]') || []; } catch (_) { return []; }
  };
  const persistPlugins = (arr) => { try { window.localStorage.setItem(PLUGIN_KEY, JSON.stringify(arr)); } catch (_) {} };
  const runPlugin = (p) => {
    try {
      // Plugins get THREE + scene via closure-style args.
      // eslint-disable-next-line no-new-func
      const fn = new Function('THREE', 'scene', 'viewport', p.code);
      fn(THREE, window.__archdiscScene, window.__archdiscViewport);
    } catch (e) {
      console.warn('[studio plugin]', p.name, e);
      if (window.__studioToast) window.__studioToast(`Plugin "${p.name}" error: ${e.message}`, 'warn');
    }
  };
  window.__studioListPlugins = () => loadPlugins();
  window.__studioInstallPlugin = (name, code) => {
    if (!name || !code) return { ok: false, error: 'name + code required' };
    const arr = loadPlugins().filter((p) => p.name !== name);
    const rec = { name, code, installedAt: Date.now() };
    arr.push(rec);
    persistPlugins(arr);
    runPlugin(rec);
    if (window.__studioToast) window.__studioToast(`Plugin installed: ${name}`, 'ok');
    return { ok: true, plugin: rec };
  };
  window.__studioUninstallPlugin = (name) => {
    const arr = loadPlugins();
    const next = arr.filter((p) => p.name !== name);
    persistPlugins(next);
    if (window.__studioToast) window.__studioToast(`Plugin removed: ${name}`, 'info');
    return { ok: true, removed: arr.length - next.length };
  };
  // Auto-run on mount.
  for (const p of loadPlugins()) runPlugin(p);

  // Slice 576 — Vertex paint helpers. Initialises a per-vertex color
  // attribute on the active geometry and supports flood-fill colouring.
  // The material is switched to vertexColors mode so the paint shows.
  window.__studioVertexPaintInit = (hex) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry || !sel.geometry.attributes || !sel.geometry.attributes.position) return { ok: false, error: 'no selection' };
    const g = sel.geometry;
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color(hex || '#ffffff');
    for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    if (mat) { mat.vertexColors = true; mat.needsUpdate = true; }
    return { ok: true, vertices: n };
  };
  window.__studioVertexPaintFloodFill = (hex) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry || !sel.geometry.attributes || !sel.geometry.attributes.color) {
      return window.__studioVertexPaintInit(hex);
    }
    const col = sel.geometry.attributes.color;
    const c = new THREE.Color(hex || '#ffffff');
    for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
    col.needsUpdate = true;
    return { ok: true, vertices: col.count };
  };
  window.__studioVertexPaintRandom = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (!sel.geometry.attributes.color) window.__studioVertexPaintInit('#ffffff');
    const col = sel.geometry.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < col.count; i++) {
      c.setHSL(Math.random(), 0.6, 0.55);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    return { ok: true, vertices: col.count };
  };

  // Slice 573 — Sculpt brush settings live on window so the inspector
  // panel + future viewport input handler share the same state.
  if (!window.__studioSculptBrush) {
    window.__studioSculptBrush = { kind: 'draw', size: 0.04, strength: 0.3, falloff: 0.6 };
  }
  window.__studioGetSculptBrush = () => Object.assign({}, window.__studioSculptBrush);
  window.__studioSetSculptBrush = (patch) => {
    window.__studioSculptBrush = Object.assign({}, window.__studioSculptBrush, patch || {});
    window.dispatchEvent(new CustomEvent('studio-sculpt-brush-changed', { detail: window.__studioSculptBrush }));
    return { ok: true, brush: window.__studioSculptBrush };
  };

  // Slice 570 — Bake the selected mesh's world matrix into its geometry,
  // then reset position/rotation/scale to identity. Useful for snapshotting
  // a transformed mesh into a fresh primitive.
  window.__studioApplyMatrix = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo('apply-matrix');
    sel.updateMatrixWorld(true);
    sel.geometry.applyMatrix4(sel.matrix);
    sel.position.set(0, 0, 0);
    sel.rotation.set(0, 0, 0);
    sel.scale.set(1, 1, 1);
    sel.updateMatrixWorld(true);
    sel.geometry.computeBoundingBox();
    sel.geometry.computeBoundingSphere();
    if (window.__studioToast) window.__studioToast('Matrix applied', 'ok');
    return { ok: true };
  };

  // Slice 594 — Modifier history. Each geometry op should call
  // __studioPushModifier(label, params) to record on the active mesh.
  window.__studioPushModifier = (label, params) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    sel.userData = sel.userData || {};
    sel.userData.modifiers = sel.userData.modifiers || [];
    sel.userData.modifiers.push({ label, params: params || null, ts: Date.now() });
    return { ok: true, count: sel.userData.modifiers.length };
  };
  window.__studioListModifiers = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return [];
    return (sel.userData && sel.userData.modifiers) || [];
  };
  window.__studioClearModifiers = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    sel.userData = sel.userData || {};
    sel.userData.modifiers = [];
    return { ok: true };
  };

  // Slice 592 — Selection sets. Save the current multi-select under a
  // name; recall to restore. Stored on window so they survive across
  // single-session edits (but not across reloads).
  if (!window.__studioSelectionSets) window.__studioSelectionSets = {};
  window.__studioSaveSelectionSet = (name) => {
    const set = Array.isArray(window.__studioSelectedMeshesSet) && window.__studioSelectedMeshesSet.length
      ? window.__studioSelectedMeshesSet.slice()
      : (window.__studioSelectedMesh && window.__studioSelectedMesh() ? [window.__studioSelectedMesh()] : []);
    if (!name || !set.length) return { ok: false, error: 'need name + selection' };
    window.__studioSelectionSets[name] = set.map((m) => m.uuid);
    if (window.__studioToast) window.__studioToast(`Saved set "${name}" (${set.length})`, 'ok');
    return { ok: true, count: set.length };
  };
  window.__studioRecallSelectionSet = (name) => {
    const uuids = window.__studioSelectionSets[name];
    if (!uuids) return { ok: false, error: 'no such set' };
    const s = window.__archdiscScene;
    if (!s) return { ok: false, error: 'no scene' };
    const meshes = [];
    s.traverse((o) => { if (uuids.includes(o.uuid)) meshes.push(o); });
    window.__studioSelectedMeshesSet = meshes;
    if (meshes.length && window.__studioSelectMesh) window.__studioSelectMesh(meshes[meshes.length - 1]);
    if (window.__studioToast) window.__studioToast(`Recalled "${name}" (${meshes.length})`, 'info');
    return { ok: true, count: meshes.length };
  };
  window.__studioListSelectionSets = () => Object.keys(window.__studioSelectionSets || {});

  // Slice 591 — PLY importer for point clouds + low-poly meshes.
  window.__studioImportPLY = (data, name) => new Promise(async (resolve) => {
    try {
      const mod = await import('three/examples/jsm/loaders/PLYLoader.js');
      const loader = new mod.PLYLoader();
      const geo = loader.parse(data);
      const mat = new THREE.MeshStandardMaterial({ color: 0xa0c4ff });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name || 'ply';
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'ply', archdiscStudioPlySource: name };
      window.__archdiscScene && window.__archdiscScene.add(mesh);
      resolve({ ok: true, uuid: mesh.uuid });
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });

  // Slice 590 — Camera follow. When enabled, the orbit target tracks
  // the selected mesh's world position each frame. Toggle via
  // __studioToggleCameraFollow(); state persists per session.
  if (!window.__studioCameraFollowGuardAttached) {
    window.__studioCameraFollowGuardAttached = true;
    const tmp = new THREE.Vector3();
    const tick = () => {
      if (window.__studioCameraFollowOn) {
        const vp = window.__archdiscViewport;
        const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
        if (vp && vp.orbitControls && vp.orbitControls.target && m) {
          m.getWorldPosition(tmp);
          vp.orbitControls.target.lerp(tmp, 0.25);
          if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  window.__studioToggleCameraFollow = () => {
    window.__studioCameraFollowOn = !window.__studioCameraFollowOn;
    if (window.__studioToast) window.__studioToast(`Camera follow ${window.__studioCameraFollowOn ? 'on' : 'off'}`, 'info');
    return { ok: true, on: !!window.__studioCameraFollowOn };
  };

  // Slice 589 — STL + OBJ importers. STL takes ArrayBuffer; OBJ takes
  // a string. Both wrap their lazy loader in __studioImport*.
  window.__studioImportSTL = (arrayBuffer, name) => new Promise(async (resolve) => {
    try {
      const mod = await import('three/examples/jsm/loaders/STLLoader.js');
      const loader = new mod.STLLoader();
      const geo = loader.parse(arrayBuffer);
      const mat = new THREE.MeshStandardMaterial({ color: 0xc0c8d0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = name || 'stl';
      mesh.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'stl', archdiscStudioStlSource: name };
      window.__archdiscScene && window.__archdiscScene.add(mesh);
      resolve({ ok: true, uuid: mesh.uuid });
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
  window.__studioImportOBJ = (text, name) => new Promise(async (resolve) => {
    try {
      const mod = await import('three/examples/jsm/loaders/OBJLoader.js');
      const loader = new mod.OBJLoader();
      const obj = loader.parse(text);
      obj.name = name || 'obj';
      obj.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'obj', archdiscStudioObjSource: name };
      obj.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      window.__archdiscScene && window.__archdiscScene.add(obj);
      resolve({ ok: true, uuid: obj.uuid });
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });

  // Slice 588 — Programmatic GLTF/GLB importer. Pairs with the viewport
  // drag-drop handler so palette + scripts share the same import path.
  window.__studioImportGLTF = (arrayBuffer, name) => new Promise(async (resolve) => {
    try {
      const mod = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new mod.GLTFLoader();
      loader.parse(arrayBuffer, '', (gltf) => {
        if (!gltf.scene || !window.__archdiscScene) { resolve({ ok: false, error: 'no scene' }); return; }
        gltf.scene.userData = { ...gltf.scene.userData, archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'gltf', archdiscStudioGltfSource: name || 'gltf' };
        window.__archdiscScene.add(gltf.scene);
        resolve({ ok: true, uuid: gltf.scene.uuid });
      }, (err) => resolve({ ok: false, error: err && err.message || String(err) }));
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });

  // Slice 587 — Polyline drawing tool. Activate via __studioStartPolyline()
  // (or programmatically via __studioAddPolyline(points)) to create a Line
  // primitive from an explicit array of [x,y,z] points.
  window.__studioAddPolyline = (points, color) => {
    const s = window.__archdiscScene;
    if (!s || !Array.isArray(points) || points.length < 2) return { ok: false, error: 'need >=2 points' };
    const arr = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      arr[i * 3] = points[i][0]; arr[i * 3 + 1] = points[i][1]; arr[i * 3 + 2] = points[i][2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.LineBasicMaterial({ color: color || 0x1de9b6 });
    const line = new THREE.Line(geom, mat);
    line.name = 'polyline';
    line.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'polyline', vertexCount: points.length };
    s.add(line);
    if (window.__studioToast) window.__studioToast(`Polyline · ${points.length} pts`, 'ok');
    return { ok: true, uuid: line.uuid, count: points.length };
  };

  // Slice 585 — Look-at constraint. Persists target uuid on selected
  // mesh's userData; a per-frame guard rotates the source to face the
  // target each tick.
  if (!window.__studioLookAtGuardAttached) {
    window.__studioLookAtGuardAttached = true;
    const target = new THREE.Vector3();
    const tick = () => {
      const s = window.__archdiscScene;
      if (s) {
        try {
          s.traverse((o) => {
            if (o.userData && o.userData.archdiscStudioLookAtUuid) {
              let t = null;
              s.traverse((q) => { if (q.uuid === o.userData.archdiscStudioLookAtUuid) t = q; });
              if (t) { t.getWorldPosition(target); o.lookAt(target); }
            }
          });
        } catch (_) {}
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  window.__studioSetLookAt = (sourceUuid, targetUuid) => {
    const s = window.__archdiscScene;
    if (!s) return { ok: false };
    let src = null;
    s.traverse((o) => { if (o.uuid === sourceUuid) src = o; });
    if (!src) return { ok: false, error: 'no source' };
    src.userData = src.userData || {};
    if (!targetUuid) { delete src.userData.archdiscStudioLookAtUuid; return { ok: true, cleared: true }; }
    src.userData.archdiscStudioLookAtUuid = targetUuid;
    return { ok: true, target: targetUuid };
  };

  // Slice 600 — WASD fly camera. Each call dollies / strafes the camera
  // (and orbit target) along its forward / right axis by `step` metres.
  window.__studioFly = (dir, step) => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.camera || !vp.orbitControls) return { ok: false };
    const cam = vp.camera, ctrl = vp.orbitControls;
    const s = Math.max(0.005, Number(step) || 0.05);
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd); // unit vector camera→target
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    let dx = 0, dy = 0;
    if (dir === 'w') dx = +s;
    else if (dir === 's') dx = -s;
    else if (dir === 'a') dy = -s;
    else if (dir === 'd') dy = +s;
    cam.position.addScaledVector(fwd, dx);
    cam.position.addScaledVector(right, dy);
    ctrl.target.addScaledVector(fwd, dx);
    ctrl.target.addScaledVector(right, dy);
    if (typeof ctrl.update === 'function') ctrl.update();
    return { ok: true, dir, step: s };
  };

  // Slice 600 — Modal transform mode (Blender G / R / S parity).
  // Captures pointer movement after the hotkey fires; X / Y / Z lock to
  // an axis; Enter commits; Esc reverts. State on window so the
  // top-center HUD chip can render the current mode + delta.
  if (!window.__studioModalState) window.__studioModalState = null;
  let _modalListeners = null;
  const detachModal = () => {
    if (!_modalListeners) return;
    window.removeEventListener('mousemove', _modalListeners.move);
    window.removeEventListener('keydown', _modalListeners.key, true);
    _modalListeners = null;
  };
  const revertModal = () => {
    const st = window.__studioModalState;
    if (!st || !st.mesh) return;
    const m = st.mesh;
    m.position.copy(st.initPos);
    m.rotation.copy(st.initRot);
    m.scale.copy(st.initScale);
    m.updateMatrixWorld(true);
  };
  const commitModal = () => {
    const st = window.__studioModalState;
    if (!st) return;
    if (window.__studioPushUndo) window.__studioPushUndo(`modal-${st.kind}`);
  };
  window.__studioStartModalTransform = (kind) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    detachModal();
    const init = {
      kind, // 'move' | 'rotate' | 'scale'
      mesh: sel,
      axis: null, // 'x' | 'y' | 'z' | null (free)
      startX: null, startY: null,
      initPos: sel.position.clone(),
      initRot: sel.rotation.clone(),
      initScale: sel.scale.clone(),
      delta: 0,
    };
    window.__studioModalState = init;
    window.dispatchEvent(new CustomEvent('studio-modal-transform', { detail: { active: true, kind } }));
    const apply = (m, dx, dy, axis) => {
      const k = window.__studioModalState && window.__studioModalState.kind;
      if (!k) return;
      const tunit = 0.001; // 1 mm / px
      const runit = 0.005; // 0.005 rad / px
      const sunit = 0.005; // multiplier / px
      const ax = axis || (Math.abs(dx) > Math.abs(dy) ? 'x' : 'y');
      const d = (axis === 'y' ? -dy : dx); // for y-axis use vertical motion
      window.__studioModalState.delta = d;
      if (k === 'move') {
        const off = d * tunit;
        m.position.copy(init.initPos);
        if (axis) m.position[axis] += off;
        else { m.position.x += dx * tunit; m.position.y += -dy * tunit; }
      } else if (k === 'rotate') {
        m.rotation.copy(init.initRot);
        const off = d * runit;
        if (axis) m.rotation[axis] += off;
        else m.rotation.z += off;
      } else if (k === 'scale') {
        const s = Math.max(0.01, 1 + d * sunit);
        m.scale.copy(init.initScale);
        if (axis) m.scale[axis] = init.initScale[axis] * s;
        else m.scale.multiplyScalar(s);
      }
      m.updateMatrixWorld(true);
    };
    _modalListeners = {
      move: (e) => {
        const st = window.__studioModalState;
        if (!st) return;
        if (st.startX == null) { st.startX = e.clientX; st.startY = e.clientY; return; }
        const dx = e.clientX - st.startX, dy = e.clientY - st.startY;
        apply(st.mesh, dx, dy, st.axis);
      },
      key: (e) => {
        const st = window.__studioModalState;
        if (!st) return;
        const k = e.key.toLowerCase();
        if (k === 'escape') {
          revertModal();
          window.__studioModalState = null;
          detachModal();
          window.dispatchEvent(new CustomEvent('studio-modal-transform', { detail: { active: false } }));
          e.preventDefault();
          e.stopPropagation();
        } else if (k === 'enter') {
          commitModal();
          window.__studioModalState = null;
          detachModal();
          window.dispatchEvent(new CustomEvent('studio-modal-transform', { detail: { active: false } }));
          e.preventDefault();
          e.stopPropagation();
        } else if (k === 'x' || k === 'y' || k === 'z') {
          st.axis = k;
          window.dispatchEvent(new CustomEvent('studio-modal-transform', { detail: { active: true, kind: st.kind, axis: k } }));
          e.preventDefault();
          e.stopPropagation();
        }
      },
    };
    window.addEventListener('mousemove', _modalListeners.move);
    window.addEventListener('keydown', _modalListeners.key, true);
    return { ok: true, kind };
  };
  window.__studioCancelModalTransform = () => {
    if (!window.__studioModalState) return { ok: false };
    revertModal();
    window.__studioModalState = null;
    detachModal();
    window.dispatchEvent(new CustomEvent('studio-modal-transform', { detail: { active: false } }));
    return { ok: true };
  };

  // Slice 599 — Taper deformer along Y. ratio < 1 narrows the top, > 1
  // widens it; X and Z are scaled proportionally to height.
  window.__studioTaperY = (topRatio) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const g = sel.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const ext = Math.max(1e-6, bb.max.y - bb.min.y);
    const r = Math.max(0.01, Number(topRatio) || 1);
    if (window.__studioPushUndo) window.__studioPushUndo('taper-y');
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = (y - bb.min.y) / ext;
      const sc = 1 + (r - 1) * t;
      pos.setXYZ(i, x * sc, y, z * sc);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    if (window.__studioToast) window.__studioToast(`Tapered to ${r}`, 'ok');
    if (window.__studioPushModifier) window.__studioPushModifier('taper-y', { topRatio: r });
    return { ok: true, vertices: pos.count };
  };

  // Slice 598 — Bend deformer in the YZ plane. Vertices warp around a
  // hinge axis (X) so the mesh curves like a beam under load.
  window.__studioBendYZ = (degrees) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const g = sel.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const yMid = (bb.min.y + bb.max.y) / 2;
    const ext = Math.max(1e-6, bb.max.y - bb.min.y);
    const rad = (Number(degrees) || 0) * Math.PI / 180;
    if (window.__studioPushUndo) window.__studioPushUndo('bend-yz');
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = (y - yMid) / ext;
      const a = t * rad;
      const cy = Math.cos(a), sy = Math.sin(a);
      pos.setXYZ(i, x, y * cy - z * sy, y * sy + z * cy);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    if (window.__studioToast) window.__studioToast(`Bent ${degrees}° in YZ`, 'ok');
    if (window.__studioPushModifier) window.__studioPushModifier('bend-yz', { degrees });
    return { ok: true, vertices: pos.count };
  };

  // Slice 597 — Twist deformer along the Y axis. Rotates each vertex
  // around Y by (y - yMin) / extent * angle radians.
  window.__studioTwistY = (degrees) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const g = sel.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const ext = Math.max(1e-6, bb.max.y - bb.min.y);
    const rad = (Number(degrees) || 0) * Math.PI / 180;
    if (window.__studioPushUndo) window.__studioPushUndo('twist-y');
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = (y - bb.min.y) / ext;
      const a = t * rad;
      const cx = Math.cos(a), sx = Math.sin(a);
      pos.setXYZ(i, x * cx - z * sx, y, x * sx + z * cx);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    if (window.__studioToast) window.__studioToast(`Twisted ${degrees}° along Y`, 'ok');
    if (window.__studioPushModifier) window.__studioPushModifier('twist-y', { degrees });
    return { ok: true, vertices: pos.count };
  };

  // Slice 596 — Noise displacement. For each vertex, offsets along its
  // normal by `strength * pseudo-noise(position)`. Deterministic per
  // position so re-applying with the same seed re-creates the bumps.
  window.__studioDisplaceNoise = (strength) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const g = sel.geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal;
    const s = Math.max(0.0001, Number(strength) || 0.01);
    // Cheap value-noise: sin-based hash on the integer-bucketed coord.
    const noise = (x, y, z) => {
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
      return (h - Math.floor(h)) * 2 - 1;
    };
    if (window.__studioPushUndo) window.__studioPushUndo('displace-noise');
    for (let i = 0; i < pos.count; i++) {
      const ox = pos.getX(i), oy = pos.getY(i), oz = pos.getZ(i);
      const n = noise(ox * 50, oy * 50, oz * 50);
      pos.setXYZ(
        i,
        ox + nor.getX(i) * n * s,
        oy + nor.getY(i) * n * s,
        oz + nor.getZ(i) * n * s,
      );
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    if (window.__studioToast) window.__studioToast(`Displaced ${pos.count} verts`, 'ok');
    if (window.__studioPushModifier) window.__studioPushModifier('displace-noise', { strength: s });
    return { ok: true, vertices: pos.count };
  };

  // Slice 582 — Decimate / simplify the selected geometry. Wraps the
  // three SimplifyModifier (quadric edge collapse). Tessellate doubles
  // tri density for higher subdivision.
  window.__studioSimplifyMesh = async (ratio) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const target = Math.max(0.05, Math.min(0.95, Number(ratio) || 0.5));
    const before = sel.geometry.attributes.position.count;
    const mod = await import('three/examples/jsm/modifiers/SimplifyModifier.js');
    const sm = new mod.SimplifyModifier();
    const drop = Math.floor(before * (1 - target));
    if (window.__studioPushUndo) window.__studioPushUndo('simplify');
    const reduced = sm.modify(sel.geometry, drop);
    if (sel.geometry.dispose) sel.geometry.dispose();
    sel.geometry = reduced;
    const after = sel.geometry.attributes.position.count;
    if (window.__studioToast) window.__studioToast(`Simplified ${before} → ${after} verts`, 'ok');
    window.__studioPushModifier && window.__studioPushModifier('simplify', { ratio: target });
    return { ok: true, before, after };
  };
  window.__studioTessellate = async (passes) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const mod = await import('three/examples/jsm/modifiers/TessellateModifier.js');
    const t = new mod.TessellateModifier(0.05, Math.max(1, Math.min(6, Number(passes) || 1)));
    if (window.__studioPushUndo) window.__studioPushUndo('tessellate');
    const before = sel.geometry.attributes.position.count;
    sel.geometry = t.modify(sel.geometry);
    const after = sel.geometry.attributes.position.count;
    if (window.__studioToast) window.__studioToast(`Tessellated ${before} → ${after} verts`, 'ok');
    window.__studioPushModifier && window.__studioPushModifier('tessellate', { passes });
    return { ok: true, before, after };
  };

  // Slice 581 — Particle system. Adds a child Three.Points around the
  // selected mesh's world center with `count` random offsets within
  // `radius`. Coloured by accent. Persists with the scene.
  window.__studioAddParticles = (count, radius) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    const n = Math.max(1, Math.min(20000, Math.floor(count || 1000)));
    const r = Math.max(0.001, Number(radius) || 0.06);
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const rr = r * Math.cbrt(Math.random());
      positions[i * 3]     = rr * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = rr * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = rr * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x1de9b6, size: Math.max(0.001, r * 0.04), sizeAttenuation: true,
      transparent: true, opacity: 0.85,
    });
    const points = new THREE.Points(geo, mat);
    points.name = (sel.name || 'mesh') + '-particles';
    points.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'particles', count: n, radius: r };
    sel.add(points);
    if (window.__studioToast) window.__studioToast(`Added ${n} particles`, 'ok');
    return { ok: true, uuid: points.uuid, count: n };
  };

  // Slice 580 — Render queue. Each entry is { name, position, target, w, h }.
  // Running pops the head, sets the camera, calls exportViewportPNG, then
  // restores the original camera between entries.
  if (!window.__studioRenderQueueState) window.__studioRenderQueueState = { jobs: [], running: false };
  window.__studioListRenderQueue = () => window.__studioRenderQueueState.jobs.slice();
  window.__studioEnqueueRender = (rec) => {
    if (!rec || !rec.position) return { ok: false, error: 'need position' };
    window.__studioRenderQueueState.jobs.push({
      name: rec.name || `render-${window.__studioRenderQueueState.jobs.length + 1}`,
      position: rec.position,
      target: rec.target || [0, 0, 0],
      w: rec.w || 1280, h: rec.h || 720,
    });
    window.dispatchEvent(new CustomEvent('studio-render-queue-changed'));
    return { ok: true, depth: window.__studioRenderQueueState.jobs.length };
  };
  window.__studioClearRenderQueue = () => {
    window.__studioRenderQueueState.jobs.length = 0;
    window.dispatchEvent(new CustomEvent('studio-render-queue-changed'));
    return { ok: true };
  };
  window.__studioEnqueueCameraBookmarks = () => {
    const bm = window.__studioCameraBookmarks || {};
    let n = 0;
    for (const name of Object.keys(bm)) {
      const r = bm[name];
      window.__studioEnqueueRender({ name: `bookmark-${name}`, position: r.position, target: r.target });
      n++;
    }
    return { ok: true, queued: n };
  };
  window.__studioRunRenderQueue = async () => {
    const st = window.__studioRenderQueueState;
    if (st.running) return { ok: false, error: 'already running' };
    st.running = true;
    const vp = window.__archdiscViewport;
    if (!vp || !vp.camera) { st.running = false; return { ok: false, error: 'no viewport' }; }
    const savedP = vp.camera.position.clone();
    const savedT = vp.orbitControls && vp.orbitControls.target ? vp.orbitControls.target.clone() : null;
    const done = [];
    while (st.jobs.length) {
      const job = st.jobs.shift();
      vp.camera.position.set(job.position[0], job.position[1], job.position[2]);
      if (vp.orbitControls && vp.orbitControls.target) {
        vp.orbitControls.target.set(job.target[0], job.target[1], job.target[2]);
        if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
      }
      vp.camera.lookAt(job.target[0], job.target[1], job.target[2]);
      const r = window.__studioExportViewportPNG && window.__studioExportViewportPNG(job.name, job.w, job.h);
      done.push({ job, result: r });
      window.dispatchEvent(new CustomEvent('studio-render-queue-changed'));
      await new Promise((res) => setTimeout(res, 30));
    }
    vp.camera.position.copy(savedP);
    if (savedT && vp.orbitControls && vp.orbitControls.target) {
      vp.orbitControls.target.copy(savedT);
      if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
    }
    st.running = false;
    return { ok: true, rendered: done.length };
  };

  // Slice 579 — CSG boolean modifier. Wraps manifold-3d for real
  // Union / Subtract / Intersect on the two most recently selected
  // meshes; falls back to a plain mergeGeometries when WASM init fails.
  let _manifold = null;
  const ensureManifold = async () => {
    if (_manifold) return _manifold;
    try {
      const mod = await import('manifold-3d');
      const Module = mod.default || mod;
      const m = await Module();
      m.setup();
      _manifold = m;
      return _manifold;
    } catch (e) {
      return null;
    }
  };
  const toManifoldMesh = (mesh) => {
    const g = mesh.geometry.clone();
    mesh.updateMatrixWorld(true);
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.index) {
      const idx = new Uint32Array(g.attributes.position.count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    const vertProperties = new Float32Array(g.attributes.position.array);
    const triVerts = new Uint32Array(g.index.array);
    return { vertProperties, triVerts, numProp: 3 };
  };
  const fromManifoldMesh = (man, name) => {
    const mesh = man.getMesh();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb7c4cf }));
    m.castShadow = true; m.receiveShadow = true;
    m.name = name;
    m.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'csg' };
    return m;
  };
  window.__studioBoolean = async (op) => {
    const set = Array.isArray(window.__studioSelectedMeshesSet) && window.__studioSelectedMeshesSet.length >= 2
      ? window.__studioSelectedMeshesSet.slice(-2)
      : [];
    if (set.length !== 2) return { ok: false, error: 'need 2 selected' };
    if (window.__studioPushUndo) window.__studioPushUndo(`csg-${op}`);
    const lib = await ensureManifold();
    let result = null;
    let fallback = false;
    if (lib) {
      try {
        const M = lib.Manifold;
        const a = new M(toManifoldMesh(set[0]));
        const b = new M(toManifoldMesh(set[1]));
        if (op === 'union') result = a.add(b);
        else if (op === 'subtract') result = a.subtract(b);
        else if (op === 'intersect') result = a.intersect(b);
        else return { ok: false, error: 'bad op' };
      } catch (e) {
        fallback = true;
      }
    } else {
      fallback = true;
    }
    let outMesh;
    if (!fallback && result) {
      outMesh = fromManifoldMesh(result, `csg-${op}`);
    } else {
      const mod = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
      const geos = set.map((m) => { const g = m.geometry.clone(); m.updateMatrixWorld(true); g.applyMatrix4(m.matrixWorld); return g; });
      const merged = mod.mergeGeometries(geos, false) || geos[0];
      outMesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0xb7c4cf }));
      outMesh.castShadow = true; outMesh.receiveShadow = true;
      outMesh.name = `csg-${op}-fallback`;
      outMesh.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'csg', archdiscStudioCsgFallback: true };
    }
    const s = window.__archdiscScene;
    s.add(outMesh);
    for (const m of set) {
      if (m.geometry) m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose && x.dispose());
      else if (m.material && m.material.dispose) m.material.dispose();
      (m.parent || s).remove(m);
    }
    window.__studioSelectedMeshesSet = [outMesh];
    if (window.__studioSelectMesh) window.__studioSelectMesh(outMesh);
    if (window.__studioToast) window.__studioToast(`CSG ${op}${fallback ? ' (fallback)' : ''}`, 'ok');
    return { ok: true, op, fallback };
  };

  // Slice 569 — Join multi-selected meshes into a single archdisc
  // primitive. Each member is baked to world space, then their
  // geometries are merged.
  window.__studioJoinSelected = async () => {
    const set = Array.isArray(window.__studioSelectedMeshesSet) && window.__studioSelectedMeshesSet.length >= 2
      ? window.__studioSelectedMeshesSet.slice()
      : [];
    if (!set.length) return { ok: false, error: 'need 2+ selected' };
    const mod = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    if (window.__studioPushUndo) window.__studioPushUndo('join');
    const geoms = [];
    for (const m of set) {
      if (!m.geometry) continue;
      const g = m.geometry.clone();
      m.updateMatrixWorld(true);
      g.applyMatrix4(m.matrixWorld);
      // Strip extraneous attributes that would block the merge.
      const keep = ['position', 'normal'];
      for (const k of Object.keys(g.attributes)) {
        if (!keep.includes(k)) g.deleteAttribute(k);
      }
      geoms.push(g);
    }
    if (geoms.length < 2) return { ok: false, error: 'no geometries' };
    const merged = mod.mergeGeometries(geoms, false);
    if (!merged) return { ok: false, error: 'merge failed' };
    const first = set[0];
    const mat = Array.isArray(first.material) ? first.material[0] : first.material;
    const joined = new THREE.Mesh(merged, mat ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff }));
    joined.name = `${first.name || 'mesh'}-joined`;
    joined.castShadow = true; joined.receiveShadow = true;
    joined.userData = {
      archdiscStudioPrimitive: true,
      archdiscStudioPrimitiveKind: 'mesh',
      archdiscStudioJoinedFrom: set.length,
    };
    const s = window.__archdiscScene;
    s.add(joined);
    // Dispose + remove the originals.
    for (const m of set) {
      if (m.geometry) m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose && x.dispose());
      else if (m.material && m.material.dispose) m.material.dispose();
      (m.parent || s).remove(m);
    }
    window.__studioSelectedMeshesSet = [joined];
    if (window.__studioSelectMesh) window.__studioSelectMesh(joined);
    if (window.__studioToast) window.__studioToast(`Joined ${set.length} → 1`, 'ok');
    return { ok: true, members: set.length };
  };

  // Slice 565 — Geometry tools. Compute smooth normals; merge near-
  // duplicate vertices (welding). Lazy-imports BufferGeometryUtils.
  window.__studioComputeVertexNormals = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    sel.geometry.computeVertexNormals();
    if (window.__studioToast) window.__studioToast('Vertex normals recomputed', 'ok');
    window.__studioPushModifier && window.__studioPushModifier('vertex-normals');
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
    window.__studioPushModifier && window.__studioPushModifier('weld', { tol });
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
