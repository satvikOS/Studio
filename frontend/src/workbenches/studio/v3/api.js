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

  // Slice 668 — Command palette registry. A central Map of commands
  // that any palette UI can read; auto-seeds with every existing
  // __studio* function so the registry is useful out of the box.
  if (!window.__studioCommandRegistry) window.__studioCommandRegistry = new Map();
  const _cmd = window.__studioCommandRegistry;

  // Auto-seed once with every callable __studio* on window.
  if (!window.__studioCommandSeeded) {
    window.__studioCommandSeeded = true;
    for (const k of Object.keys(window)) {
      if (k.startsWith('__studio') && typeof window[k] === 'function') {
        _cmd.set(k, { name: k, action: window[k], category: 'auto', description: '' });
      }
    }
  }

  window.__studioCommandRegister = (name, action, opts) => {
    if (!name) return { ok: false };
    const fn = typeof action === 'function' ? action
      : (typeof action === 'string' && typeof window[action] === 'function' ? window[action] : null);
    if (!fn) return { ok: false, error: 'action not callable' };
    _cmd.set(name, {
      name,
      action: fn,
      category: opts?.category || 'user',
      description: opts?.description || '',
      shortcut: opts?.shortcut || '',
    });
    return { ok: true, total: _cmd.size };
  };

  window.__studioCommandUnregister = (name) => {
    const had = _cmd.delete(name);
    return { ok: true, removed: had, total: _cmd.size };
  };

  window.__studioCommandList = (category) => ({
    ok: true,
    count: _cmd.size,
    commands: Array.from(_cmd.values())
      .filter((c) => !category || c.category === category)
      .map((c) => ({ name: c.name, category: c.category, description: c.description, shortcut: c.shortcut })),
  });

  window.__studioCommandSearch = (query, limit) => {
    const q = String(query || '').toLowerCase();
    const lim = Math.max(1, Math.min(100, Number(limit) || 20));
    if (!q) return { ok: true, count: 0, hits: [] };
    const score = (name) => {
      const n = name.toLowerCase();
      if (n === q) return 1000;
      if (n.startsWith(q)) return 800;
      if (n.includes(q)) return 500;
      // fuzzy: every char of q appears in order in n
      let i = 0;
      for (const c of n) if (c === q[i]) { if (++i === q.length) return 200; }
      return 0;
    };
    const scored = [];
    _cmd.forEach((c) => {
      const s = score(c.name) + (c.description.toLowerCase().includes(q) ? 50 : 0);
      if (s > 0) scored.push({ score: s, name: c.name, category: c.category, description: c.description });
    });
    scored.sort((a, b) => b.score - a.score);
    return { ok: true, count: Math.min(scored.length, lim), hits: scored.slice(0, lim) };
  };

  window.__studioCommandInvoke = async (name, ...args) => {
    const c = _cmd.get(name);
    if (!c) return { ok: false, error: 'unknown' };
    try {
      const r = await c.action(...args);
      return { ok: true, result: r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  window.__studioCommandResetRegistry = () => {
    const n = _cmd.size;
    _cmd.clear();
    window.__studioCommandSeeded = false;
    return { ok: true, removed: n };
  };

  // Slice 667 — Sharing / clipboard helpers. Uses the async Clipboard
  // API where available, falls back to no-op (returning ok=false).
  window.__studioCopySceneJsonToClipboard = async () => {
    const scene = window.__archdiscScene; if (!scene || !navigator.clipboard) return { ok: false };
    const json = JSON.stringify(scene.toJSON());
    try { await navigator.clipboard.writeText(json); return { ok: true, bytes: json.length }; }
    catch (e) { return { ok: false, error: e.message }; }
  };

  window.__studioCopyScreenshotToClipboard = async () => {
    const v = window.__archdiscViewport;
    if (!v || !v.renderer || !navigator.clipboard) return { ok: false };
    v.renderer.render(v.scene, v.camera);
    return new Promise((resolve) => {
      v.renderer.domElement.toBlob(async (blob) => {
        if (!blob) { resolve({ ok: false }); return; }
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          resolve({ ok: true, bytes: blob.size });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      }, 'image/png');
    });
  };

  window.__studioGenerateShareUrl = () => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const json = JSON.stringify(scene.toJSON());
    // base64 + URL-safe replace
    const b64 = btoa(unescape(encodeURIComponent(json)));
    const base = location.origin + location.pathname;
    return { ok: true, url: base + '#scene=' + b64, bytes: b64.length };
  };

  window.__studioImportFromShareUrl = async (urlOrHash) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    let hash = urlOrHash || location.hash;
    if (hash.startsWith('http')) {
      try { hash = new URL(hash).hash; } catch (_) {}
    }
    const m = /[#&]scene=([^&]+)/.exec(hash || '');
    if (!m) return { ok: false, error: 'no scene= in url' };
    let json;
    try { json = decodeURIComponent(escape(atob(m[1]))); } catch (e) { return { ok: false, error: 'bad base64' }; }
    let parsed;
    try { parsed = JSON.parse(json); } catch (e) { return { ok: false, error: 'bad json' }; }
    const loader = new THREE.ObjectLoader();
    let loaded = null;
    try { loaded = loader.parse(parsed); } catch (e) { return { ok: false, error: e.message }; }
    // Replace user meshes only.
    const remove = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const ud = o.userData || {};
      if (ud.archdiscStudioGizmo || ud.archdiscStudioGrid || ud.archdiscStudioGround || ud.archdiscStudioCameraHelper) return;
      remove.push(o);
    });
    for (const o of remove) o.parent?.remove(o);
    let added = 0;
    while (loaded.children.length > 0) {
      const c = loaded.children[0]; loaded.remove(c); scene.add(c); added++;
    }
    return { ok: true, added };
  };

  window.__studioCopySelectionUuid = async () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(sel.uuid); }
      catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: true, uuid: sel.uuid };
  };

  window.__studioPasteFromClipboard = async () => {
    if (!navigator.clipboard) return { ok: false };
    let text;
    try { text = await navigator.clipboard.readText(); }
    catch (e) { return { ok: false, error: e.message }; }
    if (!text) return { ok: false, error: 'empty' };
    // Try JSON first; if it parses, treat it as a scene snapshot.
    try {
      const parsed = JSON.parse(text);
      if (parsed && (parsed.object || parsed.metadata)) {
        const loader = new THREE.ObjectLoader();
        const loaded = loader.parse(parsed);
        const scene = window.__archdiscScene;
        let added = 0;
        while (loaded.children.length > 0) {
          const c = loaded.children[0]; loaded.remove(c); scene.add(c); added++;
        }
        return { ok: true, kind: 'scene', added };
      }
    } catch (_) {}
    return { ok: true, kind: 'text', text };
  };

  // Slice 666 — Asset library / palette pack. Library entries are
  // serialised mesh snapshots saved to localStorage; the user can
  // browse, instantiate, and tag them.
  const _ASSET_PREFIX = 'studio.v3.assets.';

  const _readAssetNames = () => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(_ASSET_PREFIX)) out.push(k.slice(_ASSET_PREFIX.length));
    }
    return out.sort();
  };

  window.__studioAssetSave = (name, tag) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const snap = {
      geometry: sel.geometry.toJSON ? sel.geometry.toJSON() : null,
      material: (Array.isArray(sel.material) ? sel.material[0] : sel.material)?.toJSON ? (Array.isArray(sel.material) ? sel.material[0] : sel.material).toJSON() : null,
      position: sel.position.toArray(),
      scale: sel.scale.toArray(),
      tag: String(tag || ''),
      name: String(name || `asset_${Date.now()}`),
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(_ASSET_PREFIX + snap.name, JSON.stringify(snap));
      return { ok: true, name: snap.name, tag: snap.tag };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  window.__studioAssetInstantiate = async (name, offset) => {
    const raw = localStorage.getItem(_ASSET_PREFIX + name);
    if (!raw) return { ok: false, error: 'not found' };
    const snap = JSON.parse(raw);
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const loader = new THREE.ObjectLoader();
    const geo = new THREE.BufferGeometryLoader().parse(snap.geometry);
    let mat;
    try { mat = loader.parseMaterials([snap.material])[snap.material.uuid] || new THREE.MeshStandardMaterial(); }
    catch (_) { mat = new THREE.MeshStandardMaterial({ color: 0xeeeeee }); }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.fromArray(snap.position);
    mesh.scale.fromArray(snap.scale);
    const off = Array.isArray(offset) ? offset : [0.5, 0, 0];
    mesh.position.x += off[0]; mesh.position.y += off[1]; mesh.position.z += off[2];
    mesh.name = `${snap.name}_inst`;
    mesh.userData.archdiscStudioPrimitiveKind = 'asset';
    mesh.userData.archdiscStudioAssetName = snap.name;
    if (snap.tag) mesh.userData.archdiscStudioAssetTag = snap.tag;
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    return { ok: true, uuid: mesh.uuid };
  };

  window.__studioAssetList = (tagFilter) => {
    const names = _readAssetNames();
    const items = names.map((n) => {
      try {
        const meta = JSON.parse(localStorage.getItem(_ASSET_PREFIX + n));
        return { name: n, tag: meta.tag || '', savedAt: meta.savedAt };
      } catch (_) { return { name: n, tag: '', savedAt: null }; }
    });
    const filtered = tagFilter ? items.filter((i) => i.tag === tagFilter) : items;
    return { ok: true, count: filtered.length, items: filtered };
  };

  window.__studioAssetDelete = (name) => {
    const k = _ASSET_PREFIX + name;
    const had = localStorage.getItem(k) != null;
    localStorage.removeItem(k);
    return { ok: true, removed: had };
  };

  window.__studioAssetRetag = (name, newTag) => {
    const k = _ASSET_PREFIX + name;
    const raw = localStorage.getItem(k);
    if (!raw) return { ok: false };
    const snap = JSON.parse(raw);
    snap.tag = String(newTag || '');
    localStorage.setItem(k, JSON.stringify(snap));
    return { ok: true, name, tag: snap.tag };
  };

  window.__studioAssetListTags = () => {
    const tags = new Set();
    for (const n of _readAssetNames()) {
      try {
        const meta = JSON.parse(localStorage.getItem(_ASSET_PREFIX + n));
        if (meta.tag) tags.add(meta.tag);
      } catch (_) {}
    }
    return { ok: true, tags: Array.from(tags).sort() };
  };

  // Slice 665 — Geometry health / repair pack. Stats and fixes for
  // common mesh-quality issues.
  const _activeGeoNonIdx = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return null;
    return { sel, geo: sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry };
  };

  window.__studioGeometryFindZeroAreaFaces = () => {
    const a = _activeGeoNonIdx(); if (!a) return { ok: false };
    const pos = a.geo.attributes.position.array;
    const tris = pos.length / 9;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();
    let zero = 0;
    for (let t = 0; t < tris; t++) {
      va.fromArray(pos, t * 9); vb.fromArray(pos, t * 9 + 3); vc.fromArray(pos, t * 9 + 6);
      ab.subVectors(vb, va); ac.subVectors(vc, va);
      if (cr.crossVectors(ab, ac).length() / 2 < 1e-10) zero++;
    }
    return { ok: true, totalFaces: tris, zeroArea: zero };
  };

  window.__studioGeometryFindDuplicateVerts = (eps) => {
    const a = _activeGeoNonIdx(); if (!a) return { ok: false };
    const e = Number(eps) || 1e-4;
    const pos = a.geo.attributes.position.array;
    const seen = new Map();
    let dupes = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const key = `${Math.round(pos[i]/e)}:${Math.round(pos[i+1]/e)}:${Math.round(pos[i+2]/e)}`;
      if (seen.has(key)) dupes++;
      else seen.set(key, true);
    }
    return { ok: true, total: pos.length / 3, duplicates: dupes, eps: e };
  };

  window.__studioGeometryFindHoles = () => {
    const a = _activeGeoNonIdx(); if (!a) return { ok: false };
    const pos = a.geo.attributes.position.array;
    const tris = pos.length / 9;
    const edges = new Map();
    const keyOf = (x, y, z) => `${Math.round(x*1e4)}:${Math.round(y*1e4)}:${Math.round(z*1e4)}`;
    const addEdge = (k1, k2) => {
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    };
    for (let t = 0; t < tris; t++) {
      const i = t * 9;
      const a1 = keyOf(pos[i], pos[i+1], pos[i+2]);
      const b1 = keyOf(pos[i+3], pos[i+4], pos[i+5]);
      const c1 = keyOf(pos[i+6], pos[i+7], pos[i+8]);
      addEdge(a1, b1); addEdge(b1, c1); addEdge(c1, a1);
    }
    let boundary = 0, nonManifold = 0;
    edges.forEach((count) => {
      if (count === 1) boundary++;
      else if (count > 2) nonManifold++;
    });
    return { ok: true, totalEdges: edges.size, boundaryEdges: boundary, nonManifoldEdges: nonManifold };
  };

  window.__studioGeometryFindNonManifold = () => {
    const r = window.__studioGeometryFindHoles();
    return r.ok ? { ok: true, nonManifoldEdges: r.nonManifoldEdges, totalEdges: r.totalEdges } : r;
  };

  window.__studioGeometryRepairWeld = async (eps) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false };
    const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    const before = (sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry).attributes.position.count;
    const merged = mergeVertices(sel.geometry, Number(eps) || 1e-4);
    sel.geometry.dispose();
    sel.geometry = merged;
    sel.geometry.computeVertexNormals();
    sel.geometry.computeBoundingBox();
    sel.geometry.computeBoundingSphere();
    const after = merged.attributes.position.count;
    return { ok: true, before, after, removed: before - after };
  };

  window.__studioGeometryFixOrientation = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false };
    sel.geometry.computeVertexNormals();
    // Flip any tri whose normal points away from the bounding-box centre.
    let g = sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry;
    g.computeBoundingBox();
    const c = new THREE.Vector3();
    g.boundingBox.getCenter(c);
    const pos = g.attributes.position;
    const arr = pos.array;
    const tris = pos.count / 3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), cv = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3(), outward = new THREE.Vector3();
    let flipped = 0;
    for (let t = 0; t < tris; t++) {
      a.fromArray(arr, t * 9); b.fromArray(arr, t * 9 + 3); cv.fromArray(arr, t * 9 + 6);
      ab.subVectors(b, a); ac.subVectors(cv, a);
      n.crossVectors(ab, ac).normalize();
      mid.set((a.x + b.x + cv.x) / 3, (a.y + b.y + cv.y) / 3, (a.z + b.z + cv.z) / 3);
      outward.subVectors(mid, c);
      if (n.dot(outward) < 0) {
        // swap b ↔ c
        for (let k = 0; k < 3; k++) {
          const i1 = (t * 3 + 1) * 3 + k;
          const i2 = (t * 3 + 2) * 3 + k;
          const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp;
        }
        flipped++;
      }
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    if (sel.geometry !== g) { sel.geometry.dispose(); sel.geometry = g; }
    return { ok: true, flipped, totalFaces: tris };
  };

  // Slice 664 — Viewport HUD overlays: DOM elements pinned to the
  // viewport (fps badge, axis label, watermark…). Stored in a registry
  // so we can clear them in bulk.
  if (!window.__studioHudOverlays) window.__studioHudOverlays = [];

  const _ensureHudHost = () => {
    let host = document.querySelector('[data-studio-v3-hud-host]');
    if (host) return host;
    const v = document.querySelector('.studio-viewport') || document.body;
    host = document.createElement('div');
    host.setAttribute('data-studio-v3-hud-host', '');
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:50';
    v.appendChild(host);
    return host;
  };

  const _addHud = (el, kind) => {
    const host = _ensureHudHost();
    host.appendChild(el);
    window.__studioHudOverlays.push({ el, kind });
    return el;
  };

  window.__studioHudAddBadge = (text, opts) => {
    const o = opts || {};
    const el = document.createElement('div');
    el.textContent = String(text || '');
    el.style.cssText = `position:absolute;top:${o.top ?? 8}px;left:${o.left ?? 8}px;` +
      `padding:6px 10px;font:600 12px/1.1 ui-sans-serif,system-ui;` +
      `color:${o.color || '#ecf3fb'};background:${o.background || 'rgba(15,20,28,0.78)'};` +
      `border:1px solid ${o.border || '#26334a'};border-radius:6px;` +
      `pointer-events:none;letter-spacing:0.02em`;
    el.dataset.studioHud = 'badge';
    _addHud(el, 'badge');
    return { ok: true, el: el.outerHTML.slice(0, 80) };
  };

  window.__studioHudFlashMessage = (text, durationMs) => {
    const el = document.createElement('div');
    el.textContent = String(text || '');
    el.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);` +
      `padding:14px 22px;font:600 16px/1.2 ui-sans-serif,system-ui;` +
      `color:#ecf3fb;background:rgba(15,20,28,0.85);border:1px solid #3a4a5c;` +
      `border-radius:12px;opacity:1;transition:opacity 0.3s ease;pointer-events:none`;
    _addHud(el, 'flash');
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => { el.remove(); window.__studioHudOverlays = window.__studioHudOverlays.filter((x) => x.el !== el); }, 400);
    }, Number(durationMs) || 1500);
    return { ok: true };
  };

  window.__studioHudWatermark = (text, opacity) => {
    const el = document.createElement('div');
    el.textContent = String(text || 'archdisc Studio');
    el.style.cssText = `position:absolute;bottom:6px;right:8px;` +
      `font:500 10px/1 ui-sans-serif,system-ui;color:rgba(236,243,251,${opacity ?? 0.4});` +
      `letter-spacing:0.08em;pointer-events:none;text-transform:uppercase`;
    _addHud(el, 'watermark');
    return { ok: true };
  };

  window.__studioHudCornerStats = () => {
    let el = document.querySelector('[data-studio-hud-stats]');
    if (!el) {
      el = document.createElement('div');
      el.dataset.studioHudStats = '';
      el.style.cssText = `position:absolute;top:8px;right:8px;` +
        `padding:6px 10px;font:500 11px/1.4 ui-monospace,Menlo,monospace;color:#ecf3fb;` +
        `background:rgba(15,20,28,0.78);border:1px solid #26334a;border-radius:6px;` +
        `pointer-events:none;text-align:right`;
      _addHud(el, 'stats');
    }
    const tick = () => {
      const stats = window.__studioGetSceneStats?.();
      const fps = window.__studioGetFps?.();
      if (!stats?.ok) { el._timer = setTimeout(tick, 500); return; }
      el.innerHTML =
        `${stats.meshes} mesh · ${stats.verts} v · ${stats.triangles} t<br>` +
        `${fps?.fps ? fps.fps.toFixed(0) + ' fps' : '—'}` +
        (stats.drawCalls != null ? ` · ${stats.drawCalls} dc` : '');
      el._timer = setTimeout(tick, 500);
    };
    tick();
    return { ok: true };
  };

  window.__studioHudClearAll = () => {
    let n = 0;
    for (const r of window.__studioHudOverlays.slice()) {
      if (r.el?.parentNode) { r.el.parentNode.removeChild(r.el); n++; }
      if (r.el?._timer) clearTimeout(r.el._timer);
    }
    window.__studioHudOverlays.length = 0;
    // also drop the corner-stats poll if attached
    const cs = document.querySelector('[data-studio-hud-stats]');
    if (cs?._timer) clearTimeout(cs._timer);
    return { ok: true, removed: n };
  };

  window.__studioHudList = () => ({
    ok: true,
    count: window.__studioHudOverlays.length,
    items: window.__studioHudOverlays.map((r) => ({ kind: r.kind, text: r.el.textContent?.slice(0, 60) })),
  });

  // Slice 663 — Debug visualisers. Each helper is tagged so the
  // bulk-clear op can scrub them without touching real geometry.
  if (!window.__studioDebugHelpers) window.__studioDebugHelpers = [];

  const _addHelper = (helper, kind) => {
    if (!helper) return null;
    if (!helper.userData) helper.userData = {};
    helper.userData.archdiscStudioDebugHelper = kind;
    helper.userData.archdiscStudioGizmo = true;
    window.__archdiscScene?.add(helper);
    window.__studioDebugHelpers.push(helper);
    return helper;
  };

  window.__studioShowMeshBoundingBox = (uuid) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = uuid ? scene.getObjectByProperty('uuid', uuid) : (window.__studioSelectedMesh && window.__studioSelectedMesh());
    if (!m) return { ok: false };
    const box = new THREE.Box3().setFromObject(m);
    const helper = new THREE.Box3Helper(box, 0xffcc00);
    _addHelper(helper, 'bbox');
    return { ok: true, uuid: helper.uuid };
  };

  window.__studioShowVertexNormals = async (uuid, length) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = uuid ? scene.getObjectByProperty('uuid', uuid) : (window.__studioSelectedMesh && window.__studioSelectedMesh());
    if (!m || !m.geometry) return { ok: false };
    const { VertexNormalsHelper } = await import('three/examples/jsm/helpers/VertexNormalsHelper.js');
    const helper = new VertexNormalsHelper(m, Number(length) || 0.1, 0x66ccff);
    _addHelper(helper, 'vnormals');
    return { ok: true, uuid: helper.uuid };
  };

  window.__studioShowFaceNormals = (uuid, length) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = uuid ? scene.getObjectByProperty('uuid', uuid) : (window.__studioSelectedMesh && window.__studioSelectedMesh());
    if (!m || !m.geometry) return { ok: false };
    // Inline per-tri midpoint-to-normal segments — three.js dropped its
    // bundled FaceNormalsHelper; ours is good enough and lives in scene
    // space tracked by the helper registry.
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const pos = g.attributes.position.array;
    const positions = [];
    const len = Number(length) || 0.1;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3();
    for (let t = 0; t < pos.length / 9; t++) {
      a.fromArray(pos, t * 9); b.fromArray(pos, t * 9 + 3); c.fromArray(pos, t * 9 + 6);
      ab.subVectors(b, a); ac.subVectors(c, a);
      n.crossVectors(ab, ac).normalize();
      mid.set((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
      positions.push(mid.x, mid.y, mid.z, mid.x + n.x * len, mid.y + n.y * len, mid.z + n.z * len);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const helper = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xff6677 }));
    m.add(helper);
    _addHelper(helper, 'fnormals');
    return { ok: true, uuid: helper.uuid };
  };

  window.__studioShowSkeleton = (uuid) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = uuid ? scene.getObjectByProperty('uuid', uuid) : (window.__studioSelectedMesh && window.__studioSelectedMesh());
    if (!m || !m.skeleton) return { ok: false, error: 'no skeleton' };
    const helper = new THREE.SkeletonHelper(m);
    _addHelper(helper, 'skeleton');
    return { ok: true, uuid: helper.uuid };
  };

  window.__studioShowDirectionalLightHelper = (uuid) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    let light = null;
    if (uuid) light = scene.getObjectByProperty('uuid', uuid);
    if (!light) scene.traverse((o) => { if (!light && o.isDirectionalLight) light = o; });
    if (!light) return { ok: false, error: 'no directional light' };
    const helper = new THREE.DirectionalLightHelper(light, 1, 0xffff66);
    _addHelper(helper, 'dirlight');
    return { ok: true, uuid: helper.uuid };
  };

  window.__studioHideAllHelpers = () => {
    let n = 0;
    for (const h of window.__studioDebugHelpers.slice()) {
      if (h.parent) {
        h.parent.remove(h);
        h.geometry?.dispose?.();
        h.material?.dispose?.();
        n++;
      }
    }
    window.__studioDebugHelpers.length = 0;
    return { ok: true, removed: n };
  };

  // Slice 662 — Math / geometry query helpers. These let callers do
  // precise scene introspection without poking at the viewport directly.
  window.__studioMathProjectToScreen = (point) => {
    const v = window.__archdiscViewport; if (!v || !v.camera || !v.renderer) return { ok: false };
    const p = new THREE.Vector3(...(point || [0, 0, 0]));
    p.project(v.camera);
    const size = v.renderer.getSize(new THREE.Vector2());
    return {
      ok: true,
      ndc: [p.x, p.y, p.z],
      pixel: [(p.x * 0.5 + 0.5) * size.x, (1 - (p.y * 0.5 + 0.5)) * size.y],
    };
  };

  window.__studioMathScreenToWorld = (pixel, depth) => {
    const v = window.__archdiscViewport; if (!v || !v.camera || !v.renderer) return { ok: false };
    const size = v.renderer.getSize(new THREE.Vector2());
    const x = (pixel?.[0] ?? 0) / size.x * 2 - 1;
    const y = -((pixel?.[1] ?? 0) / size.y * 2 - 1);
    const z = depth === undefined ? 0.5 : Number(depth);
    const ndc = new THREE.Vector3(x, y, z);
    ndc.unproject(v.camera);
    return { ok: true, world: [ndc.x, ndc.y, ndc.z] };
  };

  window.__studioMathCenterOfMass = (uuid) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = uuid ? scene.getObjectByProperty('uuid', uuid) : (window.__studioSelectedMesh && window.__studioSelectedMesh());
    if (!m || !m.geometry) return { ok: false };
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const pos = g.attributes.position.array;
    const tris = pos.length / 9;
    let totalArea = 0, cx = 0, cy = 0, cz = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();
    for (let t = 0; t < tris; t++) {
      a.fromArray(pos, t * 9);
      b.fromArray(pos, t * 9 + 3);
      c.fromArray(pos, t * 9 + 6);
      ab.subVectors(b, a); ac.subVectors(c, a);
      const area = cr.crossVectors(ab, ac).length() / 2;
      totalArea += area;
      cx += area * (a.x + b.x + c.x) / 3;
      cy += area * (a.y + b.y + c.y) / 3;
      cz += area * (a.z + b.z + c.z) / 3;
    }
    if (totalArea < 1e-12) return { ok: false, error: 'degenerate' };
    return { ok: true, center: [cx / totalArea, cy / totalArea, cz / totalArea], area: totalArea };
  };

  window.__studioMathRayFromScreen = (pixelX, pixelY) => {
    const v = window.__archdiscViewport; if (!v || !v.camera || !v.renderer) return { ok: false };
    const size = v.renderer.getSize(new THREE.Vector2());
    const x = (pixelX / size.x) * 2 - 1;
    const y = -((pixelY / size.y) * 2 - 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x, y }, v.camera);
    return {
      ok: true,
      origin: [ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z],
      direction: [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z],
    };
  };

  window.__studioMathClosestRayHit = (pixelX, pixelY) => {
    const v = window.__archdiscViewport; if (!v) return { ok: false };
    const size = v.renderer.getSize(new THREE.Vector2());
    const x = (pixelX / size.x) * 2 - 1;
    const y = -((pixelY / size.y) * 2 - 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x, y }, v.camera);
    const meshes = [];
    window.__archdiscScene.traverse((o) => {
      if (o.isMesh && !(o.userData && (o.userData.archdiscStudioGizmo || o.userData.archdiscStudioGrid || o.userData.archdiscStudioGround))) {
        meshes.push(o);
      }
    });
    const hits = ray.intersectObjects(meshes, false);
    if (!hits.length) return { ok: true, hit: null };
    const h = hits[0];
    return {
      ok: true,
      hit: {
        uuid: h.object.uuid,
        point: [h.point.x, h.point.y, h.point.z],
        distance: h.distance,
        face: h.faceIndex,
      },
    };
  };

  window.__studioMathBoundingSphere = (uuid) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = uuid ? scene.getObjectByProperty('uuid', uuid) : (window.__studioSelectedMesh && window.__studioSelectedMesh());
    if (!m || !m.geometry) return { ok: false };
    m.geometry.computeBoundingSphere();
    const s = m.geometry.boundingSphere;
    if (!s) return { ok: false };
    m.updateMatrixWorld(true);
    const c = s.center.clone().applyMatrix4(m.matrixWorld);
    const sc = Math.max(Math.abs(m.scale.x), Math.abs(m.scale.y), Math.abs(m.scale.z));
    return { ok: true, center: [c.x, c.y, c.z], radius: s.radius * sc };
  };

  // Slice 661 — Local file management: scene snapshots stored in
  // localStorage under studio.v3.files.{name}. Each entry is a stringy
  // scene.toJSON() payload.
  const _FILE_PREFIX = 'studio.v3.files.';

  const _readFileNames = () => {
    const names = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(_FILE_PREFIX)) names.push(k.slice(_FILE_PREFIX.length));
    }
    return names.sort();
  };

  window.__studioFileSave = (name) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const json = JSON.stringify(scene.toJSON());
    const n = String(name || `scene_${Date.now()}`);
    try {
      localStorage.setItem(_FILE_PREFIX + n, json);
      return { ok: true, name: n, bytes: json.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  window.__studioFileLoad = async (name) => {
    const raw = localStorage.getItem(_FILE_PREFIX + name);
    if (!raw) return { ok: false, error: 'not found' };
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return { ok: false, error: 'bad JSON' }; }
    const loader = new THREE.ObjectLoader();
    const loaded = await new Promise((resolve) => {
      try { resolve(loader.parse(parsed)); } catch (e) { resolve(null); }
    });
    if (!loaded) return { ok: false, error: 'loader failed' };
    // Remove existing user meshes
    const remove = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const ud = o.userData || {};
      if (ud.archdiscStudioGizmo || ud.archdiscStudioGrid || ud.archdiscStudioGround || ud.archdiscStudioCameraHelper) return;
      remove.push(o);
    });
    for (const o of remove) o.parent?.remove(o);
    // Add loaded children
    let added = 0;
    while (loaded.children.length > 0) {
      const child = loaded.children[0];
      loaded.remove(child);
      scene.add(child);
      added++;
    }
    return { ok: true, added };
  };

  window.__studioFileList = () => {
    const names = _readFileNames();
    return {
      ok: true,
      count: names.length,
      files: names.map((n) => ({
        name: n,
        bytes: (localStorage.getItem(_FILE_PREFIX + n) || '').length,
      })),
    };
  };

  window.__studioFileDelete = (name) => {
    const k = _FILE_PREFIX + name;
    const had = localStorage.getItem(k) != null;
    localStorage.removeItem(k);
    return { ok: true, removed: had };
  };

  window.__studioFileRename = (oldName, newName) => {
    const k1 = _FILE_PREFIX + oldName, k2 = _FILE_PREFIX + newName;
    const v = localStorage.getItem(k1);
    if (v == null) return { ok: false, error: 'source not found' };
    if (localStorage.getItem(k2) != null) return { ok: false, error: 'target exists' };
    localStorage.setItem(k2, v);
    localStorage.removeItem(k1);
    return { ok: true, oldName, newName };
  };

  window.__studioFileExport = (name) => {
    const r = window.__studioFileSave(name || `export_${new Date().toISOString().replace(/[:.]/g, '-')}`);
    if (!r.ok) return r;
    // also produce a downloadable dataUrl
    const raw = localStorage.getItem(_FILE_PREFIX + r.name);
    const dataUrl = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(raw)));
    return Object.assign({}, r, { dataUrl });
  };

  // Slice 660 — Smart selection helpers — pick meshes by structural
  // criteria, not just by clicking.
  const _allUserMeshes = () => {
    const out = [];
    const scene = window.__archdiscScene; if (!scene) return out;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const ud = o.userData || {};
      if (ud.archdiscStudioGizmo || ud.archdiscStudioGrid || ud.archdiscStudioGround || ud.archdiscStudioCameraHelper || ud.archdiscStudioAnnotation) return;
      out.push(o);
    });
    return out;
  };

  window.__studioSelectByPolygon = (points2D) => {
    if (!Array.isArray(points2D) || points2D.length < 3) return { ok: false, error: 'need ≥3 points' };
    const v = window.__archdiscViewport; if (!v || !v.camera || !v.renderer) return { ok: false };
    const size = v.renderer.getSize(new THREE.Vector2());
    const W = size.x || 800, H = size.y || 600;
    const ptInPoly = (x, y, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };
    const hits = [];
    const tmp = new THREE.Vector3();
    for (const m of _allUserMeshes()) {
      m.getWorldPosition(tmp).project(v.camera);
      const sx = (tmp.x * 0.5 + 0.5) * W;
      const sy = (1 - (tmp.y * 0.5 + 0.5)) * H;
      if (ptInPoly(sx, sy, points2D)) hits.push(m);
    }
    if (window.__studioSelectMeshes) window.__studioSelectMeshes(hits);
    else if (window.__studioSelectMesh && hits.length) window.__studioSelectMesh(hits[hits.length - 1]);
    return { ok: true, count: hits.length };
  };

  window.__studioSelectByMaterialName = (name) => {
    const target = String(name || '').toLowerCase();
    const hits = _allUserMeshes().filter((m) => {
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      return mat && String(mat.name || '').toLowerCase() === target;
    });
    if (window.__studioSelectMeshes) window.__studioSelectMeshes(hits);
    return { ok: true, count: hits.length };
  };

  window.__studioSelectByKind = (kind) => {
    const target = String(kind || '');
    const hits = _allUserMeshes().filter((m) => (m.userData?.archdiscStudioPrimitiveKind || '') === target);
    if (window.__studioSelectMeshes) window.__studioSelectMeshes(hits);
    return { ok: true, count: hits.length, kind: target };
  };

  window.__studioSelectSimilar = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const k = sel.userData?.archdiscStudioPrimitiveKind;
    if (!k) return { ok: false, error: 'no primitive kind' };
    return window.__studioSelectByKind(k);
  };

  window.__studioSelectByGeometryFingerprint = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false };
    const v = sel.geometry.attributes.position?.count || 0;
    const hits = _allUserMeshes().filter((m) => (m.geometry?.attributes.position?.count || 0) === v);
    if (window.__studioSelectMeshes) window.__studioSelectMeshes(hits);
    return { ok: true, count: hits.length, vertCount: v };
  };

  window.__studioGetSelectionCount = () => {
    if (window.__studioSelectedMeshes) {
      const r = window.__studioSelectedMeshes();
      return { ok: true, count: Array.isArray(r) ? r.length : 0 };
    }
    const one = window.__studioSelectedMesh && window.__studioSelectedMesh();
    return { ok: true, count: one ? 1 : 0 };
  };

  // Slice 659 — Scene-wide units & metadata. Lives in scene.userData
  // so it round-trips through scene.toJSON / fromJSON.
  if (!window.__studioSceneMeta) {
    window.__studioSceneMeta = {
      units: 'm',
      scale: 1,
      author: '',
      title: '',
      createdAt: new Date().toISOString(),
      custom: {},
    };
  }
  const _meta = window.__studioSceneMeta;
  const _writeMetaToScene = () => {
    const scene = window.__archdiscScene;
    if (scene) {
      if (!scene.userData) scene.userData = {};
      scene.userData.archdiscStudioMeta = JSON.parse(JSON.stringify(_meta));
    }
  };

  const _UNIT_TO_M = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };

  window.__studioSetSceneUnits = (units) => {
    if (!_UNIT_TO_M[units]) return { ok: false, valid: Object.keys(_UNIT_TO_M) };
    _meta.units = units;
    _writeMetaToScene();
    return { ok: true, units, factor: _UNIT_TO_M[units] };
  };

  window.__studioGetSceneUnits = () => ({
    ok: true,
    units: _meta.units,
    factor: _UNIT_TO_M[_meta.units] || 1,
  });

  window.__studioSetSceneScale = (s) => {
    const v = Math.max(1e-6, Number(s) || 1);
    _meta.scale = v;
    _writeMetaToScene();
    return { ok: true, scale: v };
  };

  window.__studioGetSceneMetadata = () => ({
    ok: true,
    meta: JSON.parse(JSON.stringify(_meta)),
  });

  window.__studioSetSceneMetadata = (key, value) => {
    if (!key) return { ok: false };
    if (key in _meta && key !== 'custom') {
      _meta[key] = value;
    } else {
      _meta.custom[String(key)] = value;
    }
    _writeMetaToScene();
    return { ok: true, key, value };
  };

  // Convert a value in scene units to metres (handy for physics / FEM).
  window.__studioConvertToMeters = (value) => ({
    ok: true,
    meters: Number(value) * _meta.scale * (_UNIT_TO_M[_meta.units] || 1),
  });

  // Slice 658 — TransformControls gizmo pack: 6 wrappers around the
  // Viewport3D-owned TransformControls instance.
  const _tc = () => {
    const v = window.__archdiscViewport;
    return (v && v.transformControls) || null;
  };

  window.__studioGizmoSetMode = (mode) => {
    const tc = _tc(); if (!tc) return { ok: false };
    const valid = ['translate', 'rotate', 'scale'];
    if (!valid.includes(mode)) return { ok: false, valid };
    tc.setMode(mode);
    return { ok: true, mode };
  };

  window.__studioGizmoSetSpace = (space) => {
    const tc = _tc(); if (!tc) return { ok: false };
    const valid = ['world', 'local'];
    if (!valid.includes(space)) return { ok: false, valid };
    tc.setSpace(space);
    return { ok: true, space };
  };

  window.__studioGizmoSetSize = (s) => {
    const tc = _tc(); if (!tc) return { ok: false };
    const v = Math.max(0.1, Math.min(4, Number(s) || 0.8));
    tc.setSize(v);
    return { ok: true, size: v };
  };

  window.__studioGizmoSetVisible = (on) => {
    const tc = _tc(); if (!tc) return { ok: false };
    tc.visible = !!on;
    if (tc.getHelper) {
      try { const h = tc.getHelper(); if (h) h.visible = !!on; } catch (_) {}
    }
    return { ok: true, visible: tc.visible };
  };

  window.__studioGizmoSetSnap = (translateSnap, rotateSnapDeg, scaleSnap) => {
    const tc = _tc(); if (!tc) return { ok: false };
    if (translateSnap !== undefined) tc.translationSnap = translateSnap === null ? null : Number(translateSnap);
    if (rotateSnapDeg !== undefined) tc.rotationSnap = rotateSnapDeg === null ? null : Number(rotateSnapDeg) * Math.PI / 180;
    if (scaleSnap !== undefined) tc.scaleSnap = scaleSnap === null ? null : Number(scaleSnap);
    return {
      ok: true,
      translateSnap: tc.translationSnap,
      rotateSnap: tc.rotationSnap,
      scaleSnap: tc.scaleSnap,
    };
  };

  window.__studioGizmoGetState = () => {
    const tc = _tc(); if (!tc) return { ok: false };
    return {
      ok: true,
      mode: tc.mode,
      space: tc.space,
      size: tc.size,
      visible: tc.visible,
      translateSnap: tc.translationSnap,
      rotateSnap: tc.rotationSnap,
      scaleSnap: tc.scaleSnap,
      attached: !!tc.object,
    };
  };

  // Slice 657 — Presentation / slide pack. Captures camera viewpoints
  // into an ordered list and steps through them like Keynote slides.
  if (!window.__studioPresentation) window.__studioPresentation = { slides: [], index: -1, active: false };
  const _pres = window.__studioPresentation;

  window.__studioPresentationCaptureSlide = (name) => {
    const v = window.__archdiscViewport; if (!v || !v.camera) return { ok: false };
    const ctrl = v.orbitControls || v.controls;
    const slide = {
      name: String(name || `slide_${_pres.slides.length + 1}`),
      cameraPosition: v.camera.position.toArray(),
      target: ctrl ? [ctrl.target.x, ctrl.target.y, ctrl.target.z] : [0, 0, 0],
      fov: v.camera.fov,
    };
    _pres.slides.push(slide);
    return { ok: true, name: slide.name, total: _pres.slides.length };
  };

  window.__studioPresentationListSlides = () => ({
    ok: true,
    count: _pres.slides.length,
    slides: _pres.slides.map((s, i) => ({ index: i, name: s.name, fov: s.fov })),
  });

  window.__studioPresentationDeleteSlide = (name) => {
    const idx = _pres.slides.findIndex((s) => s.name === name);
    if (idx < 0) return { ok: false };
    _pres.slides.splice(idx, 1);
    if (_pres.index >= _pres.slides.length) _pres.index = _pres.slides.length - 1;
    return { ok: true, remaining: _pres.slides.length };
  };

  const _gotoSlide = (idx) => {
    const v = window.__archdiscViewport; if (!v || !v.camera) return { ok: false };
    if (idx < 0 || idx >= _pres.slides.length) return { ok: false, error: 'out of range' };
    const s = _pres.slides[idx];
    v.camera.position.fromArray(s.cameraPosition);
    if (v.camera.isPerspectiveCamera) {
      v.camera.fov = s.fov;
      v.camera.updateProjectionMatrix();
    }
    const ctrl = v.orbitControls || v.controls;
    if (ctrl) { ctrl.target.fromArray(s.target); if (ctrl.update) ctrl.update(); }
    v.camera.lookAt(s.target[0], s.target[1], s.target[2]);
    v.camera.updateMatrixWorld(true);
    _pres.index = idx;
    return { ok: true, index: idx, name: s.name };
  };

  window.__studioPresentationStart = () => {
    if (!_pres.slides.length) return { ok: false, error: 'no slides' };
    _pres.active = true;
    return _gotoSlide(0);
  };

  window.__studioPresentationNext = () => {
    if (!_pres.active) return { ok: false, error: 'not started' };
    const next = _pres.index + 1;
    if (next >= _pres.slides.length) return { ok: true, finished: true };
    return _gotoSlide(next);
  };

  window.__studioPresentationClear = () => {
    const n = _pres.slides.length;
    _pres.slides.length = 0;
    _pres.index = -1;
    _pres.active = false;
    return { ok: true, cleared: n };
  };

  // Slice 656 — Render-pass image pack. Each op swaps every mesh's
  // material for a special variant, renders the current view, returns
  // a dataURL, then restores the original materials.
  const _withTemporaryMaterial = (factoryFn) => {
    const v = window.__archdiscViewport;
    if (!v || !v.scene || !v.renderer || !v.camera) return { ok: false };
    const saved = [];
    v.scene.traverse((o) => {
      if (!o.isMesh) return;
      saved.push({ mesh: o, material: o.material });
      o.material = factoryFn(o);
    });
    v.renderer.render(v.scene, v.camera);
    const url = v.renderer.domElement.toDataURL('image/png');
    saved.forEach((s) => { s.mesh.material = s.material; });
    return { ok: true, dataUrl: url };
  };

  window.__studioRenderDepthImage = () => {
    const mat = new THREE.MeshDepthMaterial();
    return _withTemporaryMaterial(() => mat);
  };

  window.__studioRenderNormalImage = () => {
    const mat = new THREE.MeshNormalMaterial();
    return _withTemporaryMaterial(() => mat);
  };

  window.__studioRenderMatcapImage = async (matcapDataUrl) => {
    if (!matcapDataUrl) return { ok: false, error: 'matcap required' };
    const tex = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; resolve(t); };
      img.onerror = () => resolve(null);
      img.src = matcapDataUrl;
    });
    if (!tex) return { ok: false, error: 'matcap load failed' };
    const mat = new THREE.MeshMatcapMaterial({ matcap: tex });
    return _withTemporaryMaterial(() => mat);
  };

  window.__studioRenderToonImage = (color) => {
    const c = new THREE.Color(color || 0xb6c4d2);
    const grad = new Uint8Array([64, 64, 64, 128, 128, 128, 200, 200, 200, 255, 255, 255]);
    const gradTex = new THREE.DataTexture(grad, 4, 1, THREE.RGBFormat);
    gradTex.needsUpdate = true;
    const mat = new THREE.MeshToonMaterial({ color: c, gradientMap: gradTex });
    return _withTemporaryMaterial(() => mat);
  };

  window.__studioRenderClayImage = () => {
    const mat = new THREE.MeshLambertMaterial({ color: 0xc8c8c8 });
    return _withTemporaryMaterial(() => mat);
  };

  window.__studioRenderXrayImage = () => {
    // Wireframe overlay against a dark base — quick X-ray feel.
    const mat = new THREE.MeshBasicMaterial({
      color: 0x66ccff,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
      wireframe: true,
    });
    return _withTemporaryMaterial(() => mat);
  };

  // Slice 655 — Snap / grid configuration pack. Lightweight state
  // store that drag handlers in the shell can read.
  if (!window.__studioSnapState) {
    window.__studioSnapState = {
      enabled: false,
      mode: 'grid',
      gridSize: 0.1,
      angleStepDeg: 15,
      lockedAxis: null, // 'x' | 'y' | 'z' | null
    };
  }
  const _snap = window.__studioSnapState;

  window.__studioSnapModeSet = (mode) => {
    const valid = ['grid', 'vertex', 'edge', 'face', 'none'];
    if (!valid.includes(mode)) return { ok: false, valid };
    _snap.mode = mode;
    if (mode === 'none') _snap.enabled = false;
    return { ok: true, mode };
  };

  window.__studioSnapModeGet = () => ({ ok: true, ..._snap });

  window.__studioSnapGridSize = (units) => {
    const v = Math.max(1e-4, Math.min(10, Number(units) || 0.1));
    _snap.gridSize = v;
    return { ok: true, gridSize: v };
  };

  window.__studioSnapAngleStep = (deg) => {
    const v = Math.max(1, Math.min(180, Number(deg) || 15));
    _snap.angleStepDeg = v;
    return { ok: true, angleStepDeg: v };
  };

  window.__studioSnapLockAxis = (axis) => {
    const a = (axis || '').toLowerCase();
    _snap.lockedAxis = ['x', 'y', 'z'].includes(a) ? a : null;
    return { ok: true, lockedAxis: _snap.lockedAxis };
  };

  window.__studioSnapEnabled = (on) => {
    _snap.enabled = on === undefined ? !_snap.enabled : !!on;
    return { ok: true, enabled: _snap.enabled };
  };

  // Apply snap to a candidate position. Useful when drag handlers call
  // out to the snap state instead of forking the entire pipeline.
  window.__studioSnapApply = (pos) => {
    const p = Array.isArray(pos) ? pos.slice() : [0, 0, 0];
    if (!_snap.enabled) return { ok: true, position: p };
    if (_snap.mode === 'grid') {
      const g = _snap.gridSize;
      p[0] = Math.round(p[0] / g) * g;
      p[1] = Math.round(p[1] / g) * g;
      p[2] = Math.round(p[2] / g) * g;
    }
    if (_snap.lockedAxis === 'x') { p[1] = 0; p[2] = 0; }
    else if (_snap.lockedAxis === 'y') { p[0] = 0; p[2] = 0; }
    else if (_snap.lockedAxis === 'z') { p[0] = 0; p[1] = 0; }
    return { ok: true, position: p };
  };

  // Slice 654 — Custom key-binding registry. Sits ALONGSIDE the
  // existing shell-level onKeyDown switch — listens at window-capture
  // before React's onKeyDown so user-mapped combos win.
  if (!window.__studioKeyBindings) window.__studioKeyBindings = new Map();
  const _kb = window.__studioKeyBindings;

  const _comboFromEvent = (e) => {
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.metaKey) parts.push('meta');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    let key = (e.key || '').toLowerCase();
    if (key === ' ') key = 'space';
    if (key === 'arrowleft') key = 'left';
    if (key === 'arrowright') key = 'right';
    if (key === 'arrowup') key = 'up';
    if (key === 'arrowdown') key = 'down';
    parts.push(key);
    return parts.join('+');
  };

  if (!window.__studioKeyListenerAttached) {
    window.__studioKeyListenerAttached = true;
    document.addEventListener('keydown', (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const combo = _comboFromEvent(e);
      const fn = _kb.get(combo);
      if (typeof fn === 'function') {
        e.preventDefault();
        try { fn(e); } catch (_) {}
      } else if (typeof fn === 'string' && typeof window[fn] === 'function') {
        e.preventDefault();
        try { window[fn](); } catch (_) {}
      }
    }, true);
  }

  window.__studioSetKeyBinding = (combo, target) => {
    if (!combo) return { ok: false };
    _kb.set(String(combo).toLowerCase(), target);
    return { ok: true, combo, total: _kb.size };
  };

  window.__studioRemoveKeyBinding = (combo) => {
    const had = _kb.delete(String(combo).toLowerCase());
    return { ok: true, removed: had, total: _kb.size };
  };

  window.__studioListKeyBindings = () => ({
    ok: true,
    count: _kb.size,
    bindings: Array.from(_kb.entries()).map(([combo, t]) => ({ combo, target: typeof t === 'function' ? '<fn>' : t })),
  });

  window.__studioResetKeyBindings = () => {
    const n = _kb.size;
    _kb.clear();
    return { ok: true, removed: n };
  };

  window.__studioInvokeShortcut = (combo) => {
    const fn = _kb.get(String(combo).toLowerCase());
    if (typeof fn === 'function') { try { fn(); return { ok: true, fired: true }; } catch (e) { return { ok: false, error: e.message }; } }
    if (typeof fn === 'string' && typeof window[fn] === 'function') {
      try { window[fn](); return { ok: true, fired: true, name: fn }; } catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: false, error: 'no binding' };
  };

  // resolves the next single key combo the user presses (returns Promise).
  window.__studioCaptureNextKey = () => new Promise((resolve) => {
    const handler = (e) => {
      document.removeEventListener('keydown', handler, true);
      e.preventDefault();
      resolve({ ok: true, combo: _comboFromEvent(e) });
    };
    document.addEventListener('keydown', handler, true);
  });

  // Slice 653 — Alignment / distribution pack for CAD-style layout.
  // Operate on the current multi-selection; single selection no-ops.
  const _selectedList = () => {
    if (window.__studioSelectedMeshes) {
      const r = window.__studioSelectedMeshes();
      if (Array.isArray(r) && r.length) return r;
    }
    const one = window.__studioSelectedMesh && window.__studioSelectedMesh();
    return one ? [one] : [];
  };

  const _bboxOf = (mesh) => {
    if (!mesh.geometry) return null;
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox.clone();
    mesh.updateMatrixWorld(true);
    b.applyMatrix4(mesh.matrixWorld);
    return b;
  };

  window.__studioAlignSelectionTo = (axis, mode) => {
    const list = _selectedList(); if (list.length < 2) return { ok: false, error: 'need ≥2' };
    const ax = (axis || 'x').toLowerCase();
    const md = mode || 'center';
    const bboxes = list.map(_bboxOf).filter(Boolean);
    if (!bboxes.length) return { ok: false };
    let target;
    if (md === 'min') target = Math.min(...bboxes.map((b) => b.min[ax]));
    else if (md === 'max') target = Math.max(...bboxes.map((b) => b.max[ax]));
    else target = bboxes.reduce((acc, b) => acc + (b.min[ax] + b.max[ax]) / 2, 0) / bboxes.length;
    if (window.__studioPushUndo) window.__studioPushUndo('align');
    list.forEach((m, i) => {
      const b = bboxes[i];
      const cur = md === 'min' ? b.min[ax] : (md === 'max' ? b.max[ax] : (b.min[ax] + b.max[ax]) / 2);
      m.position[ax] += target - cur;
      m.updateMatrixWorld(true);
    });
    return { ok: true, axis: ax, mode: md, count: list.length };
  };

  window.__studioDistributeSelection = (axis) => {
    const list = _selectedList(); if (list.length < 3) return { ok: false, error: 'need ≥3' };
    const ax = (axis || 'x').toLowerCase();
    const bboxes = list.map(_bboxOf).filter(Boolean);
    const centers = bboxes.map((b) => (b.min[ax] + b.max[ax]) / 2);
    const sorted = centers.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c);
    const lo = sorted[0].c, hi = sorted[sorted.length - 1].c;
    const step = (hi - lo) / (sorted.length - 1);
    if (window.__studioPushUndo) window.__studioPushUndo('distribute');
    sorted.forEach((entry, k) => {
      const target = lo + step * k;
      const mesh = list[entry.i];
      mesh.position[ax] += target - entry.c;
      mesh.updateMatrixWorld(true);
    });
    return { ok: true, axis: ax, span: hi - lo, step };
  };

  window.__studioStackOnAxis = (axis, gap) => {
    const list = _selectedList(); if (list.length < 2) return { ok: false, error: 'need ≥2' };
    const ax = (axis || 'x').toLowerCase();
    const g = Number(gap) || 0;
    const bboxes = list.map(_bboxOf).filter(Boolean);
    if (window.__studioPushUndo) window.__studioPushUndo('stack');
    let cursor = bboxes[0].min[ax];
    list.forEach((m, i) => {
      const b = bboxes[i];
      const half = (b.max[ax] - b.min[ax]) / 2;
      const cur = (b.min[ax] + b.max[ax]) / 2;
      const targetCenter = cursor + half;
      m.position[ax] += targetCenter - cur;
      cursor = cursor + (b.max[ax] - b.min[ax]) + g;
      m.updateMatrixWorld(true);
    });
    return { ok: true, axis: ax, gap: g, count: list.length };
  };

  window.__studioCenterSelectionToOrigin = () => {
    const list = _selectedList(); if (!list.length) return { ok: false };
    const bboxes = list.map(_bboxOf).filter(Boolean);
    const center = new THREE.Vector3();
    const full = new THREE.Box3();
    bboxes.forEach((b) => full.union(b));
    full.getCenter(center);
    if (window.__studioPushUndo) window.__studioPushUndo('center-origin');
    list.forEach((m) => {
      m.position.sub(center);
      m.updateMatrixWorld(true);
    });
    return { ok: true, offset: [center.x, center.y, center.z] };
  };

  window.__studioGroupBoundsCenter = () => {
    const list = _selectedList(); if (!list.length) return { ok: false };
    const bboxes = list.map(_bboxOf).filter(Boolean);
    const full = new THREE.Box3();
    bboxes.forEach((b) => full.union(b));
    const c = new THREE.Vector3(); full.getCenter(c);
    const s = new THREE.Vector3(); full.getSize(s);
    return { ok: true, center: [c.x, c.y, c.z], size: [s.x, s.y, s.z] };
  };

  window.__studioMirrorSelection = (plane) => {
    // plane in {'xy','xz','yz'} — flip the perpendicular axis
    const list = _selectedList(); if (!list.length) return { ok: false };
    const ax = plane === 'xy' ? 'z' : (plane === 'xz' ? 'y' : 'x');
    if (window.__studioPushUndo) window.__studioPushUndo('mirror');
    list.forEach((m) => { m.position[ax] = -m.position[ax]; m.scale[ax] *= -1; });
    return { ok: true, axis: ax, plane: plane || 'yz', count: list.length };
  };

  // Slice 652 — Mesh clipboard / duplicate pack. Maintains a stack of
  // mesh snapshots that can be pasted as fresh instances. Each
  // snapshot is a {geometry clone, material clone, world transform}.
  if (!window.__studioMeshClipboard) window.__studioMeshClipboard = [];

  const _snapshotMesh = (mesh) => {
    if (!mesh || !mesh.geometry) return null;
    return {
      geometry: mesh.geometry.clone(),
      material: (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.clone() || new THREE.MeshStandardMaterial(),
      position: mesh.position.toArray(),
      quaternion: mesh.quaternion.toArray(),
      scale: mesh.scale.toArray(),
      name: mesh.name || '',
      userData: { archdiscStudioPrimitiveKind: mesh.userData?.archdiscStudioPrimitiveKind || 'pasted' },
    };
  };

  window.__studioClipboardCopy = (uuid) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    let target = null;
    if (uuid) target = scene.getObjectByProperty('uuid', uuid);
    else target = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!target) return { ok: false, error: 'no target' };
    const snap = _snapshotMesh(target);
    if (!snap) return { ok: false };
    window.__studioMeshClipboard.push(snap);
    return { ok: true, depth: window.__studioMeshClipboard.length };
  };

  window.__studioClipboardPaste = (offset) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const top = window.__studioMeshClipboard[window.__studioMeshClipboard.length - 1];
    if (!top) return { ok: false, error: 'empty' };
    const mesh = new THREE.Mesh(top.geometry.clone(), top.material.clone());
    mesh.position.fromArray(top.position);
    mesh.quaternion.fromArray(top.quaternion);
    mesh.scale.fromArray(top.scale);
    const off = Array.isArray(offset) ? offset : [0.5, 0, 0];
    mesh.position.x += off[0]; mesh.position.y += off[1]; mesh.position.z += off[2];
    mesh.name = (top.name || 'paste') + '_copy';
    mesh.userData = Object.assign({}, top.userData);
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    return { ok: true, uuid: mesh.uuid };
  };

  window.__studioClipboardClear = () => {
    const n = window.__studioMeshClipboard.length;
    window.__studioMeshClipboard.forEach((s) => { s.geometry?.dispose(); s.material?.dispose(); });
    window.__studioMeshClipboard.length = 0;
    return { ok: true, cleared: n };
  };

  window.__studioClipboardCount = () => ({ ok: true, count: window.__studioMeshClipboard.length });

  window.__studioClipboardHasContent = () => ({
    ok: true,
    has: window.__studioMeshClipboard.length > 0,
  });

  window.__studioClipboardDuplicateSelected = (offset) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const snap = _snapshotMesh(sel);
    if (!snap) return { ok: false };
    window.__studioMeshClipboard.push(snap);
    return window.__studioClipboardPaste(offset);
  };

  // Slice 651 — Material library: built-in PBR presets + a per-user
  // saved-preset map persisted to localStorage.
  const _MATERIAL_PRESETS = {
    gold:     { color: 0xffd166, metalness: 1.0, roughness: 0.15, clearcoat: 0 },
    chrome:   { color: 0xffffff, metalness: 1.0, roughness: 0.05 },
    copper:   { color: 0xb87333, metalness: 1.0, roughness: 0.3 },
    glass:    { color: 0xffffff, metalness: 0, roughness: 0.05, transmission: 1, ior: 1.5, thickness: 0.5 },
    plastic:  { color: 0xeeeeee, metalness: 0, roughness: 0.6, clearcoat: 0.4 },
    rubber:   { color: 0x222222, metalness: 0, roughness: 0.95 },
    wood:     { color: 0xb38950, metalness: 0, roughness: 0.7 },
    concrete: { color: 0xa0a0a0, metalness: 0, roughness: 0.95 },
    velvet:   { color: 0x6e1e3a, metalness: 0, roughness: 1, sheen: 1, sheenColor: 0xff8aa5 },
  };

  const _ensurePhysMat = (sel) => {
    const mat0 = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    if (mat0 && mat0.isMeshPhysicalMaterial) return mat0;
    const next = new THREE.MeshPhysicalMaterial({ color: mat0?.color?.clone() || new THREE.Color(0xeeeeee) });
    if (Array.isArray(sel.material)) sel.material[0] = next; else sel.material = next;
    mat0?.dispose?.();
    return next;
  };

  window.__studioMaterialPresetApply = (name) => {
    const def = _MATERIAL_PRESETS[name];
    if (!def) return { ok: false, error: 'unknown preset', valid: Object.keys(_MATERIAL_PRESETS) };
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    const m = _ensurePhysMat(sel);
    if (def.color != null) m.color.set(def.color);
    if (def.metalness != null) m.metalness = def.metalness;
    if (def.roughness != null) m.roughness = def.roughness;
    if (def.clearcoat != null) m.clearcoat = def.clearcoat;
    if (def.transmission != null) { m.transmission = def.transmission; m.transparent = def.transmission > 0; }
    if (def.ior != null) m.ior = def.ior;
    if (def.thickness != null) m.thickness = def.thickness;
    if (def.sheen != null) m.sheen = def.sheen;
    if (def.sheenColor != null) m.sheenColor = new THREE.Color(def.sheenColor);
    m.needsUpdate = true;
    return { ok: true, preset: name };
  };

  window.__studioMaterialPresetList = () => ({
    ok: true,
    builtin: Object.keys(_MATERIAL_PRESETS),
    user: Object.keys(_getUserMats()),
  });

  const _getUserMats = () => {
    try {
      const raw = localStorage.getItem('studio.v3.user-materials');
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  };
  const _setUserMats = (obj) => {
    try { localStorage.setItem('studio.v3.user-materials', JSON.stringify(obj)); return true; }
    catch (_) { return false; }
  };

  const _snapshotMat = (mat) => ({
    color: mat.color ? mat.color.getHex() : 0xffffff,
    metalness: mat.metalness ?? 0,
    roughness: mat.roughness ?? 0.5,
    clearcoat: mat.clearcoat ?? 0,
    transmission: mat.transmission ?? 0,
    ior: mat.ior ?? 1.5,
    thickness: mat.thickness ?? 0,
    emissive: mat.emissive ? mat.emissive.getHex() : 0,
    emissiveIntensity: mat.emissiveIntensity ?? 1,
  });

  window.__studioMaterialSavePreset = (name) => {
    if (!name) return { ok: false };
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const mat = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    if (!mat) return { ok: false };
    const user = _getUserMats();
    user[String(name)] = _snapshotMat(mat);
    _setUserMats(user);
    return { ok: true, name, total: Object.keys(user).length };
  };

  window.__studioMaterialLoadPreset = (name) => {
    const user = _getUserMats();
    const def = user[String(name)];
    if (!def) return { ok: false, error: 'unknown' };
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const m = _ensurePhysMat(sel);
    Object.keys(def).forEach((k) => {
      if (k === 'color') m.color.set(def.color);
      else if (k === 'emissive') m.emissive.set(def.emissive);
      else m[k] = def[k];
    });
    m.needsUpdate = true;
    return { ok: true };
  };

  window.__studioMaterialDeletePreset = (name) => {
    const user = _getUserMats();
    const had = !!user[String(name)];
    delete user[String(name)];
    _setUserMats(user);
    return { ok: true, removed: had, total: Object.keys(user).length };
  };

  if (!window.__studioMaterialClipboard) window.__studioMaterialClipboard = null;

  window.__studioMaterialCopySelection = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const mat = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    if (!mat) return { ok: false };
    window.__studioMaterialClipboard = _snapshotMat(mat);
    return { ok: true, snapshot: window.__studioMaterialClipboard };
  };

  // Slice 650 — UI / theme / scale / accent pack. Manipulates root
  // attributes + CSS variables so every styled token responds.
  window.__studioSetTheme = (theme) => {
    const valid = ['dark', 'light', 'high-contrast'];
    const t = valid.includes(theme) ? theme : 'dark';
    document.documentElement.setAttribute('data-studio-theme', t);
    try { localStorage.setItem('studio.v3.theme', t); } catch (_) {}
    return { ok: true, theme: t };
  };

  window.__studioGetTheme = () => ({
    ok: true,
    theme: document.documentElement.getAttribute('data-studio-theme') || 'dark',
  });

  window.__studioSetUiScale = (s) => {
    const v = Math.max(0.5, Math.min(2, Number(s) || 1));
    document.documentElement.style.setProperty('--studio-ui-scale', String(v));
    document.documentElement.style.fontSize = `${v * 16}px`;
    try { localStorage.setItem('studio.v3.ui-scale', String(v)); } catch (_) {}
    return { ok: true, scale: v };
  };

  window.__studioGetUiScale = () => {
    const cv = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--studio-ui-scale'));
    return { ok: true, scale: isNaN(cv) ? 1 : cv };
  };

  window.__studioSetAccentColor = (hex) => {
    const c = new THREE.Color(hex || 0x66aaff);
    const css = `#${c.getHexString()}`;
    document.documentElement.style.setProperty('--studio-accent', css);
    document.documentElement.style.setProperty('--studio-accent-soft', css + '55');
    try { localStorage.setItem('studio.v3.accent', css); } catch (_) {}
    return { ok: true, accent: css };
  };

  window.__studioToggleHighContrast = () => {
    const cur = document.documentElement.getAttribute('data-studio-theme');
    const next = cur === 'high-contrast' ? 'dark' : 'high-contrast';
    return window.__studioSetTheme(next);
  };

  // Slice 649 — Collections / selection sets. Named groups of mesh
  // uuids that survive across edit sessions.
  if (!window.__studioCollections) window.__studioCollections = new Map();
  const _coll = window.__studioCollections;

  window.__studioCollectionCreate = (name) => {
    const n = String(name || `coll_${_coll.size + 1}`);
    if (_coll.has(n)) return { ok: false, error: 'exists' };
    _coll.set(n, new Set());
    return { ok: true, name: n, count: _coll.size };
  };

  window.__studioCollectionAddSelected = (name) => {
    if (!_coll.has(name)) _coll.set(name, new Set());
    const set = _coll.get(name);
    const list = (window.__studioSelectedMeshes && window.__studioSelectedMeshes())
      || ((window.__studioSelectedMesh && window.__studioSelectedMesh()) ? [window.__studioSelectedMesh()] : []);
    for (const m of list) if (m && m.uuid) set.add(m.uuid);
    return { ok: true, name, size: set.size };
  };

  window.__studioCollectionRemove = (name, uuid) => {
    if (!_coll.has(name)) return { ok: false };
    const set = _coll.get(name);
    const had = set.delete(uuid);
    return { ok: true, removed: had, size: set.size };
  };

  window.__studioCollectionList = () => ({
    ok: true,
    collections: Array.from(_coll.entries()).map(([k, v]) => ({ name: k, size: v.size })),
  });

  window.__studioCollectionSelectAll = (name) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    if (!_coll.has(name)) return { ok: false, error: 'unknown' };
    const hits = [];
    for (const uuid of _coll.get(name)) {
      const m = scene.getObjectByProperty('uuid', uuid);
      if (m) hits.push(m);
    }
    if (window.__studioSelectMeshes) window.__studioSelectMeshes(hits);
    else if (window.__studioSelectMesh && hits.length) window.__studioSelectMesh(hits[hits.length - 1]);
    return { ok: true, count: hits.length };
  };

  window.__studioCollectionDelete = (name) => {
    const had = _coll.delete(name);
    return { ok: true, removed: had, count: _coll.size };
  };

  // Slice 648 — Orbit / view-controls tuning pack. Six dials that
  // tweak the camera's OrbitControls in place.
  const _orbit = () => {
    const v = window.__archdiscViewport;
    return (v && (v.orbitControls || v.controls)) || null;
  };

  window.__studioSetOrbitSpeed = (s) => {
    const c = _orbit(); if (!c) return { ok: false };
    c.rotateSpeed = Math.max(0.05, Math.min(5, Number(s) || 1));
    return { ok: true, rotateSpeed: c.rotateSpeed };
  };

  window.__studioSetZoomSpeed = (s) => {
    const c = _orbit(); if (!c) return { ok: false };
    c.zoomSpeed = Math.max(0.05, Math.min(5, Number(s) || 1));
    return { ok: true, zoomSpeed: c.zoomSpeed };
  };

  window.__studioSetPanSpeed = (s) => {
    const c = _orbit(); if (!c) return { ok: false };
    c.panSpeed = Math.max(0.05, Math.min(5, Number(s) || 1));
    return { ok: true, panSpeed: c.panSpeed };
  };

  window.__studioSetDamping = (factor) => {
    const c = _orbit(); if (!c) return { ok: false };
    const f = Math.max(0, Math.min(1, Number(factor) ?? 0.1));
    c.enableDamping = f > 0;
    c.dampingFactor = f;
    return { ok: true, damping: f };
  };

  window.__studioLockCameraY = (on) => {
    const c = _orbit(); if (!c) return { ok: false };
    const lock = !!on;
    c.minPolarAngle = lock ? Math.PI / 2 : 0;
    c.maxPolarAngle = lock ? Math.PI / 2 : Math.PI;
    return { ok: true, locked: lock };
  };

  window.__studioGetOrbitState = () => {
    const c = _orbit(); if (!c) return { ok: false };
    return {
      ok: true,
      rotateSpeed: c.rotateSpeed,
      zoomSpeed: c.zoomSpeed,
      panSpeed: c.panSpeed,
      damping: c.enableDamping ? c.dampingFactor : 0,
      lockedY: c.minPolarAngle > 1e-6 && c.maxPolarAngle - c.minPolarAngle < 1e-6,
      target: [c.target.x, c.target.y, c.target.z],
    };
  };

  // Slice 647 — Undo history pack: extend the existing undo stack with
  // named checkpoints and inspection / cap controls.
  if (!window.__studioCheckpoints) window.__studioCheckpoints = new Map();

  window.__studioClearUndo = () => {
    _undo.past.length = 0;
    _undo.future.length = 0;
    _undo.labels.length = 0;
    return { ok: true };
  };

  window.__studioCheckpoint = (label) => {
    const name = String(label || `cp_${window.__studioCheckpoints.size + 1}`);
    const snap = snapshotScene();
    if (!snap) return { ok: false, error: 'snapshot failed' };
    window.__studioCheckpoints.set(name, snap);
    // also push to the regular undo stack so the user can step back
    _undo.past.push(snap);
    _undo.labels.push({ label: 'checkpoint:' + name, ts: Date.now() });
    if (_undo.past.length > 64) { _undo.past.shift(); _undo.labels.shift(); }
    _undo.future.length = 0;
    return { ok: true, name, total: window.__studioCheckpoints.size };
  };

  window.__studioListCheckpoints = () => ({
    ok: true,
    names: Array.from(window.__studioCheckpoints.keys()),
  });

  window.__studioRestoreCheckpoint = (label) => {
    const snap = window.__studioCheckpoints.get(String(label));
    if (!snap) return { ok: false, error: 'unknown checkpoint' };
    const current = snapshotScene();
    if (current) _undo.future.push(current);
    return restoreScene(snap);
  };

  window.__studioGetUndoState = () => ({
    ok: true,
    past: _undo.past.length,
    future: _undo.future.length,
    latest: _undo.labels.length ? _undo.labels[_undo.labels.length - 1].label : null,
    checkpoints: window.__studioCheckpoints.size,
  });

  window.__studioSetUndoLimit = (n) => {
    const limit = Math.max(1, Math.min(512, Number(n) || 64));
    while (_undo.past.length > limit) { _undo.past.shift(); _undo.labels.shift(); }
    window.__studioUndoLimit = limit;
    return { ok: true, limit };
  };

  // Slice 646 — Performance / scene stats pack.
  window.__studioGetSceneStats = () => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    let meshes = 0, verts = 0, tris = 0, lights = 0;
    const matSet = new Set();
    scene.traverse((o) => {
      if (o.isLight) lights++;
      if (!o.isMesh) return;
      meshes++;
      const v = o.geometry?.attributes?.position?.count || 0;
      verts += v;
      tris += o.geometry?.index ? (o.geometry.index.count / 3) : (v / 3);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m) matSet.add(m.uuid); });
    });
    const v = window.__archdiscViewport;
    const info = v?.renderer?.info;
    return {
      ok: true,
      meshes, lights, verts, triangles: tris,
      materials: matSet.size,
      drawCalls: info?.render?.calls ?? null,
      memoryGeo: info?.memory?.geometries ?? null,
      memoryTex: info?.memory?.textures ?? null,
    };
  };

  if (!window.__studioFpsState) window.__studioFpsState = { last: performance.now(), frames: [], hist: [] };
  const _fps = window.__studioFpsState;

  // hook into AnimTick once so every frame is counted
  const _attachFpsTick = () => {
    const v = window.__archdiscViewport; if (!v) return;
    if (v.__studioAnimTick && v.__studioAnimTick.__fps) return;
    const prev = v.__studioAnimTick;
    const fn = (now) => {
      const t = now ?? performance.now();
      const dt = t - _fps.last; _fps.last = t;
      _fps.frames.push(dt);
      if (_fps.frames.length > 120) _fps.frames.shift();
      if (_fps.recording) _fps.hist.push(dt);
      if (prev) prev(t);
    };
    fn.__fps = true; fn.__prev = prev;
    v.__studioAnimTick = fn;
  };

  window.__studioGetFps = () => {
    _attachFpsTick();
    if (!_fps.frames.length) return { ok: true, fps: 0, samples: 0 };
    const avg = _fps.frames.reduce((a, b) => a + b, 0) / _fps.frames.length;
    return { ok: true, fps: avg > 0 ? 1000 / avg : 0, samples: _fps.frames.length };
  };

  window.__studioStartProfile = () => {
    _attachFpsTick();
    _fps.hist.length = 0;
    _fps.recording = true;
    _fps.startedAt = performance.now();
    return { ok: true };
  };

  window.__studioStopProfile = () => {
    _fps.recording = false;
    const samples = _fps.hist.length;
    if (!samples) return { ok: true, samples: 0 };
    const sum = _fps.hist.reduce((a, b) => a + b, 0);
    const sorted = _fps.hist.slice().sort((a, b) => a - b);
    const avg = sum / samples;
    const p50 = sorted[Math.floor(samples / 2)];
    const p95 = sorted[Math.floor(samples * 0.95)];
    const max = sorted[samples - 1];
    return {
      ok: true,
      samples,
      durationMs: performance.now() - _fps.startedAt,
      avgFrameMs: avg,
      avgFps: avg > 0 ? 1000 / avg : 0,
      p50: p50, p95: p95, max,
    };
  };

  window.__studioClearScene = () => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const remove = [];
    scene.traverse((o) => {
      if (!o.isMesh && !o.isLine && !(o.isLight && !o.userData?.archdiscStudioKeyLight)) return;
      const ud = o.userData;
      if (ud && (ud.archdiscStudioGizmo || ud.archdiscStudioGrid || ud.archdiscStudioGround || ud.archdiscStudioCameraHelper)) return;
      remove.push(o);
    });
    let n = 0;
    for (const o of remove) {
      if (o.parent) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m && m.dispose && m.dispose());
        o.parent.remove(o); n++;
      }
    }
    return { ok: true, removed: n };
  };

  window.__studioSetRendererPixelRatio = (r) => {
    const v = window.__archdiscViewport; if (!v || !v.renderer) return { ok: false };
    const pr = Math.max(0.25, Math.min(window.devicePixelRatio || 2, Number(r) || 1));
    v.renderer.setPixelRatio(pr);
    return { ok: true, pixelRatio: pr };
  };

  // Slice 645 — Environment / sky pack. Wraps scene.environment and
  // every PBR material's envMapIntensity to control how strongly the
  // env contributes.
  window.__studioSetEnvIntensity = (v) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const i = Math.max(0, Math.min(5, Number(v) ?? 1));
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m && 'envMapIntensity' in m) { m.envMapIntensity = i; m.needsUpdate = true; } });
    });
    if (!scene.userData) scene.userData = {};
    scene.userData.archdiscStudioEnvIntensity = i;
    return { ok: true, intensity: i };
  };

  window.__studioSetEnvRotation = (degrees) => {
    const scene = window.__archdiscScene; if (!scene || !scene.environment) return { ok: false, error: 'no env' };
    const rad = (Number(degrees) || 0) * Math.PI / 180;
    if (typeof scene.environmentRotation?.setFromAxisAngle === 'function') {
      // r163+ exposes scene.environmentRotation as Euler
      scene.environmentRotation = new THREE.Euler(0, rad, 0);
    } else {
      // older path: rotate the texture's offset/repeat (approximation)
      scene.environment.offset = scene.environment.offset || new THREE.Vector2();
      scene.environment.offset.x = degrees / 360;
      scene.environment.needsUpdate = true;
    }
    return { ok: true, degrees };
  };

  window.__studioToggleEnvAsBackground = (on) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const want = on === undefined ? !scene.background : !!on;
    if (want) {
      if (scene.environment) scene.background = scene.environment;
      else return { ok: false, error: 'no env' };
    } else {
      scene.background = null;
    }
    return { ok: true, on: !!scene.background };
  };

  window.__studioBakeProceduralSky = (top, mid, bot) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const t = new THREE.Color(top || 0x4060a0);
    const m = new THREE.Color(mid || 0xc4d0e6);
    const b = new THREE.Color(bot || 0xeec99c);
    const data = new Uint8Array(3 * 4);
    const fill = (i, c) => { data[i*4] = c.r*255 | 0; data[i*4+1] = c.g*255 | 0; data[i*4+2] = c.b*255 | 0; data[i*4+3] = 255; };
    fill(0, b); fill(1, m); fill(2, t);
    const tex = new THREE.DataTexture(data, 1, 3, THREE.RGBAFormat);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.needsUpdate = true;
    if (scene.environment && scene.environment.dispose) scene.environment.dispose();
    scene.environment = tex;
    return { ok: true, stops: 3 };
  };

  window.__studioGetEnvState = () => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    return {
      ok: true,
      hasEnv: !!scene.environment,
      hasBackground: !!scene.background,
      intensity: scene.userData?.archdiscStudioEnvIntensity ?? 1,
    };
  };

  window.__studioCycleHDRIPreset = () => {
    if (!window.__studioListHDRIPresets || !window.__studioSetHDRIEnvironment) return { ok: false };
    const presets = window.__studioListHDRIPresets().presets;
    if (!Array.isArray(presets)) return { ok: false };
    if (!window.__studioHDRIIdx) window.__studioHDRIIdx = 0;
    const next = (window.__studioHDRIIdx + 1) % presets.length;
    window.__studioHDRIIdx = next;
    const r = window.__studioSetHDRIEnvironment(presets[next]);
    return { ok: r.ok, preset: presets[next] };
  };

  // Slice 644 — Freehand 3D strokes: a Blender-grease-pencil-style
  // drawing layer that lives in the scene. Each stroke becomes a
  // THREE.Line so it survives exports.
  if (!window.__studioFreehandState) window.__studioFreehandState = { current: null, strokes: [] };
  const _fh = window.__studioFreehandState;

  window.__studioFreehandStart = (color, thickness) => {
    if (_fh.current) return { ok: false, error: 'stroke in progress' };
    _fh.current = {
      points: [],
      color: color != null ? color : 0xff5577,
      thickness: Math.max(1, Number(thickness) || 2),
    };
    return { ok: true };
  };

  window.__studioFreehandPoint = (x, y, z) => {
    if (!_fh.current) return { ok: false, error: 'no stroke' };
    _fh.current.points.push([Number(x) || 0, Number(y) || 0, Number(z) || 0]);
    return { ok: true, count: _fh.current.points.length };
  };

  window.__studioFreehandEnd = () => {
    const scene = window.__archdiscScene;
    if (!_fh.current || !scene) return { ok: false };
    const pts = _fh.current.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    if (pts.length < 2) { _fh.current = null; return { ok: false, error: 'too few points' }; }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: _fh.current.color, linewidth: _fh.current.thickness });
    const line = new THREE.Line(geo, mat);
    line.userData.archdiscStudioFreehand = true;
    line.name = `freehand_${_fh.strokes.length + 1}`;
    scene.add(line);
    _fh.strokes.push({ uuid: line.uuid, object: line, length: _strokeLength(pts) });
    _fh.current = null;
    return { ok: true, uuid: line.uuid, points: pts.length };
  };

  const _strokeLength = (pts) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    return len;
  };

  window.__studioFreehandList = () => ({
    ok: true,
    count: _fh.strokes.length,
    strokes: _fh.strokes.map((s) => ({ uuid: s.uuid, length: s.length })),
  });

  window.__studioFreehandClear = (uuid) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const idx = _fh.strokes.findIndex((s) => s.uuid === uuid);
    if (idx < 0) return { ok: false };
    const rec = _fh.strokes[idx];
    if (rec.object && rec.object.parent) {
      rec.object.geometry?.dispose();
      rec.object.material?.dispose();
      rec.object.parent.remove(rec.object);
    }
    _fh.strokes.splice(idx, 1);
    return { ok: true, remaining: _fh.strokes.length };
  };

  window.__studioFreehandClearAll = () => {
    let n = 0;
    for (const s of _fh.strokes.slice()) {
      if (s.object && s.object.parent) {
        s.object.geometry?.dispose();
        s.object.material?.dispose();
        s.object.parent.remove(s.object);
        n++;
      }
    }
    _fh.strokes.length = 0;
    return { ok: true, cleared: n };
  };

  // Slice 643 — Geometry analysis / measurement pack. Pure-function
  // readouts that take coordinates or mesh uuids and return numeric
  // results — useful for engineering, QA, BOMs.
  window.__studioMeasureDistance = (p1, p2) => {
    if (!Array.isArray(p1) || !Array.isArray(p2)) return { ok: false };
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
    return { ok: true, distance: Math.sqrt(dx*dx + dy*dy + dz*dz) };
  };

  window.__studioMeasureAngle = (p1, p2, p3) => {
    if (!Array.isArray(p1) || !Array.isArray(p2) || !Array.isArray(p3)) return { ok: false };
    const a = new THREE.Vector3(p1[0]-p2[0], p1[1]-p2[1], p1[2]-p2[2]);
    const b = new THREE.Vector3(p3[0]-p2[0], p3[1]-p2[1], p3[2]-p2[2]);
    if (a.lengthSq() < 1e-12 || b.lengthSq() < 1e-12) return { ok: false, error: 'degenerate' };
    const cos = a.normalize().dot(b.normalize());
    const rad = Math.acos(Math.min(1, Math.max(-1, cos)));
    return { ok: true, radians: rad, degrees: rad * 180 / Math.PI };
  };

  const _resolveMeshOrSel = (uuid) => {
    if (uuid) {
      const scene = window.__archdiscScene; if (!scene) return null;
      return scene.getObjectByProperty('uuid', uuid);
    }
    return window.__studioSelectedMesh && window.__studioSelectedMesh();
  };

  window.__studioMeasureBoundingBoxVolume = (uuid) => {
    const m = _resolveMeshOrSel(uuid);
    if (!m || !m.geometry) return { ok: false };
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    const ex = (bb.max.x - bb.min.x) * m.scale.x;
    const ey = (bb.max.y - bb.min.y) * m.scale.y;
    const ez = (bb.max.z - bb.min.z) * m.scale.z;
    return { ok: true, extents: [ex, ey, ez], volume: ex * ey * ez };
  };

  window.__studioMeasureSurfaceArea = (uuid) => {
    const m = _resolveMeshOrSel(uuid);
    if (!m || !m.geometry) return { ok: false };
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const pos = g.attributes.position.array;
    let area = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();
    const tris = pos.length / 9;
    for (let t = 0; t < tris; t++) {
      a.fromArray(pos, t*9);
      b.fromArray(pos, t*9 + 3);
      c.fromArray(pos, t*9 + 6);
      ab.subVectors(b, a); ac.subVectors(c, a);
      cr.crossVectors(ab, ac);
      area += cr.length() / 2;
    }
    // apply scale (assuming uniform)
    const s = m.scale.x * m.scale.y; // approximate area scale
    return { ok: true, triangles: tris, area, scaledArea: area * s };
  };

  window.__studioMeasurePivot = (uuid) => {
    const m = _resolveMeshOrSel(uuid);
    if (!m || !m.geometry) return { ok: false };
    m.geometry.computeBoundingBox();
    const c = new THREE.Vector3();
    m.geometry.boundingBox.getCenter(c);
    c.multiply(m.scale);
    c.applyQuaternion(m.quaternion);
    c.add(m.position);
    return { ok: true, center: [c.x, c.y, c.z] };
  };

  window.__studioMeasureGetStats = (uuid) => {
    const m = _resolveMeshOrSel(uuid);
    if (!m || !m.geometry) return { ok: false };
    const v = m.geometry.attributes.position?.count || 0;
    const tris = m.geometry.index ? m.geometry.index.count / 3 : v / 3;
    const vol = window.__studioMeasureBoundingBoxVolume(uuid);
    const area = window.__studioMeasureSurfaceArea(uuid);
    return {
      ok: true,
      vertices: v,
      triangles: tris,
      volume: vol.volume || 0,
      surfaceArea: area.scaledArea || area.area || 0,
    };
  };

  // Slice 642 — Procedural texture pack. Six canvas-based generators
  // that return a CanvasTexture (srgb) and apply it as the active
  // mesh's material map.
  const _makeCanvasTex = (size, draw) => {
    const s = Math.max(8, Math.min(2048, Number(size) || 256));
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    draw(ctx, s);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  };

  const _applyMap = (tex, channel) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const mat = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    if (!mat) return { ok: false };
    if (channel === 'normal') mat.normalMap = tex;
    else if (channel === 'rough') mat.roughnessMap = tex;
    else if (channel === 'metal') mat.metalnessMap = tex;
    else if (channel === 'emissive') mat.emissiveMap = tex;
    else mat.map = tex;
    mat.needsUpdate = true;
    return { ok: true, channel: channel || 'map' };
  };

  window.__studioMakeCheckerTexture = (size, c1, c2, divisions) => {
    const a = new THREE.Color(c1 || 0xffffff), b = new THREE.Color(c2 || 0x222222);
    const div = Math.max(2, Math.min(64, Number(divisions) || 8));
    const tex = _makeCanvasTex(size, (ctx, s) => {
      const cell = s / div;
      for (let y = 0; y < div; y++) for (let x = 0; x < div; x++) {
        const c = (x + y) % 2 === 0 ? a : b;
        ctx.fillStyle = `rgb(${(c.r*255)|0},${(c.g*255)|0},${(c.b*255)|0})`;
        ctx.fillRect(x * cell, y * cell, cell + 1, cell + 1);
      }
    });
    const r = _applyMap(tex, arguments[4]);
    return { ok: true, uuid: tex.uuid, divisions: div, applied: r.ok };
  };

  window.__studioMakeGradientTexture = (size, c1, c2, dir) => {
    const a = new THREE.Color(c1 || 0x1e2a3a), b = new THREE.Color(c2 || 0xff8866);
    const d = dir || 'vertical';
    const tex = _makeCanvasTex(size, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, d === 'horizontal' ? s : 0, d === 'horizontal' ? 0 : s);
      g.addColorStop(0, `rgb(${(a.r*255)|0},${(a.g*255)|0},${(a.b*255)|0})`);
      g.addColorStop(1, `rgb(${(b.r*255)|0},${(b.g*255)|0},${(b.b*255)|0})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    });
    const r = _applyMap(tex, arguments[4]);
    return { ok: true, uuid: tex.uuid, applied: r.ok };
  };

  window.__studioMakeNoiseTexture = (size, scale) => {
    const sc = Math.max(1, Math.min(32, Number(scale) || 4));
    const tex = _makeCanvasTex(size, (ctx, s) => {
      const img = ctx.createImageData(s, s);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const v = Math.floor(Math.random() * 255);
        const i = (y * s + x) * 4;
        img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v; img.data[i+3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    });
    tex.repeat.set(sc, sc);
    const r = _applyMap(tex, arguments[2]);
    return { ok: true, uuid: tex.uuid, scale: sc, applied: r.ok };
  };

  window.__studioMakeVoronoiTexture = (size, cellCount) => {
    const N = Math.max(4, Math.min(200, Number(cellCount) || 24));
    const tex = _makeCanvasTex(size, (ctx, s) => {
      const seeds = [];
      for (let i = 0; i < N; i++) {
        seeds.push({
          x: Math.random() * s,
          y: Math.random() * s,
          c: [Math.floor(Math.random()*255), Math.floor(Math.random()*255), Math.floor(Math.random()*255)],
        });
      }
      const img = ctx.createImageData(s, s);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        let best = Infinity, bestC = [0, 0, 0];
        for (const sd of seeds) {
          const d = (sd.x - x)**2 + (sd.y - y)**2;
          if (d < best) { best = d; bestC = sd.c; }
        }
        const i = (y * s + x) * 4;
        img.data[i] = bestC[0]; img.data[i+1] = bestC[1]; img.data[i+2] = bestC[2]; img.data[i+3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    });
    const r = _applyMap(tex, arguments[2]);
    return { ok: true, uuid: tex.uuid, cells: N, applied: r.ok };
  };

  window.__studioMakeStripeTexture = (size, count, c1, c2, vertical) => {
    const n = Math.max(2, Math.min(64, Number(count) || 8));
    const a = new THREE.Color(c1 || 0xffffff), b = new THREE.Color(c2 || 0x222222);
    const tex = _makeCanvasTex(size, (ctx, s) => {
      const stripe = s / n;
      for (let i = 0; i < n; i++) {
        const col = i % 2 === 0 ? a : b;
        ctx.fillStyle = `rgb(${(col.r*255)|0},${(col.g*255)|0},${(col.b*255)|0})`;
        if (vertical) ctx.fillRect(i * stripe, 0, stripe + 1, s);
        else          ctx.fillRect(0, i * stripe, s, stripe + 1);
      }
    });
    const r = _applyMap(tex, arguments[5]);
    return { ok: true, uuid: tex.uuid, stripes: n, applied: r.ok };
  };

  window.__studioMakeDotsTexture = (size, count, dotR) => {
    const n = Math.max(2, Math.min(64, Number(count) || 8));
    const rad = Number(dotR) || 0.2;
    const tex = _makeCanvasTex(size, (ctx, s) => {
      ctx.fillStyle = '#1e2a3a'; ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#ffd1a8';
      const cell = s / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        ctx.beginPath();
        ctx.arc(x * cell + cell/2, y * cell + cell/2, rad * cell, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const r = _applyMap(tex, arguments[3]);
    return { ok: true, uuid: tex.uuid, dots: n*n, applied: r.ok };
  };

  // Slice 641 — Bulk selection / visibility helpers. These operate
  // across the whole scene so the user can act on big groups without
  // hunting in the outliner.
  const _userMeshes = () => {
    const out = [];
    const scene = window.__archdiscScene; if (!scene) return out;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const ud = o.userData;
      if (ud && (ud.archdiscStudioGizmo || ud.archdiscStudioGrid || ud.archdiscStudioGround || ud.archdiscStudioCameraHelper)) return;
      out.push(o);
    });
    return out;
  };

  window.__studioSelectByDistance = (point, radius) => {
    const p = Array.isArray(point) ? point : [0, 0, 0];
    const r2 = (Number(radius) || 1) ** 2;
    const hits = [];
    const v = new THREE.Vector3();
    for (const m of _userMeshes()) {
      m.getWorldPosition(v);
      const d2 = (v.x - p[0])**2 + (v.y - p[1])**2 + (v.z - p[2])**2;
      if (d2 <= r2) hits.push(m);
    }
    if (window.__studioSelectMeshes) window.__studioSelectMeshes(hits);
    else if (window.__studioSelectMesh && hits.length) window.__studioSelectMesh(hits[hits.length - 1]);
    return { ok: true, count: hits.length, uuids: hits.map((m) => m.uuid) };
  };

  window.__studioSelectByName = (pattern) => {
    if (!pattern) return { ok: false, error: 'pattern required' };
    let rx;
    try { rx = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i'); }
    catch (_) { return { ok: false, error: 'bad regex' }; }
    const hits = _userMeshes().filter((m) => rx.test(m.name || ''));
    if (window.__studioSelectMeshes) window.__studioSelectMeshes(hits);
    else if (window.__studioSelectMesh && hits.length) window.__studioSelectMesh(hits[hits.length - 1]);
    return { ok: true, count: hits.length, uuids: hits.map((m) => m.uuid) };
  };

  window.__studioSelectByMaterialColor = (hex) => {
    if (hex == null) return { ok: false };
    const target = new THREE.Color(hex);
    const hits = _userMeshes().filter((m) => {
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!mat || !mat.color) return false;
      return Math.abs(mat.color.r - target.r) < 0.01
        && Math.abs(mat.color.g - target.g) < 0.01
        && Math.abs(mat.color.b - target.b) < 0.01;
    });
    if (window.__studioSelectMeshes) window.__studioSelectMeshes(hits);
    else if (window.__studioSelectMesh && hits.length) window.__studioSelectMesh(hits[hits.length - 1]);
    return { ok: true, count: hits.length, uuids: hits.map((m) => m.uuid) };
  };

  window.__studioInvertVisibility = () => {
    let n = 0;
    for (const m of _userMeshes()) { m.visible = !m.visible; n++; }
    return { ok: true, toggled: n };
  };

  window.__studioHideUnselected = () => {
    const sel = (window.__studioSelectedMeshes && window.__studioSelectedMeshes())
      || ((window.__studioSelectedMesh && window.__studioSelectedMesh()) ? [window.__studioSelectedMesh()] : []);
    const set = new Set(sel);
    let n = 0;
    for (const m of _userMeshes()) {
      if (!set.has(m) && m.visible) { m.visible = false; n++; }
    }
    return { ok: true, hidden: n };
  };

  window.__studioShowAll = () => {
    let n = 0;
    for (const m of _userMeshes()) { if (!m.visible) { m.visible = true; n++; } }
    return { ok: true, revealed: n };
  };

  // Slice 640 — Procedural primitive pack. Six "add" ops that build
  // geometries the existing primitive bar doesn't cover.
  const _addAndSelect = (geometry, namePrefix, opts) => {
    const scene = window.__archdiscScene; if (!scene) return null;
    const mat = new THREE.MeshStandardMaterial({
      color: (opts && opts.color) || 0xc4d4e6,
      roughness: opts?.roughness ?? 0.55,
      metalness: opts?.metalness ?? 0.15,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitiveKind = namePrefix;
    mesh.name = namePrefix;
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    return mesh;
  };

  window.__studioCreateText3D = async (text, opts) => {
    const o = opts || {};
    const fontUrl = o.fontUrl || 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json';
    const { FontLoader } = await import('three/examples/jsm/loaders/FontLoader.js');
    const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js');
    let fontJson = o.fontJson;
    if (!fontJson) {
      try {
        const res = await fetch(fontUrl); fontJson = await res.json();
      } catch (e) {
        return { ok: false, error: 'font load failed: ' + (e?.message || e) };
      }
    }
    const font = new FontLoader().parse(fontJson);
    const geo = new TextGeometry(String(text || 'Studio'), {
      font, size: o.size || 0.4, depth: o.depth || 0.08,
      curveSegments: 6, bevelEnabled: o.bevel ?? true, bevelThickness: 0.01, bevelSize: 0.005, bevelSegments: 2,
    });
    geo.center();
    const mesh = _addAndSelect(geo, 'text3d', o);
    return { ok: !!mesh, uuid: mesh?.uuid, verts: geo.attributes.position.count };
  };

  window.__studioCreateTorusKnot = (radius, tube, p, q) => {
    const geo = new THREE.TorusKnotGeometry(radius || 0.5, tube || 0.15, 128, 16, p || 2, q || 3);
    const mesh = _addAndSelect(geo, 'torus-knot', { color: 0xff8866 });
    return { ok: !!mesh, uuid: mesh?.uuid };
  };

  window.__studioCreateIcosphere = (radius, subdiv) => {
    const geo = new THREE.IcosahedronGeometry(radius || 0.5, Math.min(4, subdiv || 2));
    const mesh = _addAndSelect(geo, 'icosphere', { color: 0xaabbff });
    return { ok: !!mesh, uuid: mesh?.uuid };
  };

  window.__studioCreateGear = (teeth, innerR, outerR, thickness) => {
    const T = Math.max(6, Math.min(80, Number(teeth) || 18));
    const ri = Number(innerR) || 0.15;
    const ro = Number(outerR) || 0.5;
    const rt = ro + 0.06;
    const th = Number(thickness) || 0.15;
    const shape = new THREE.Shape();
    for (let i = 0; i < T * 2; i++) {
      const a = (i / (T * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? rt : ro;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, ri, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 1, steps: 1 });
    geo.translate(0, 0, -th / 2);
    const mesh = _addAndSelect(geo, 'gear', { color: 0x99a0a8, metalness: 0.6, roughness: 0.4 });
    return { ok: !!mesh, uuid: mesh?.uuid, teeth: T };
  };

  window.__studioCreateSpring = (turns, radius, height, tube) => {
    const N = Math.max(2, Math.min(50, Number(turns) || 6));
    const R = Number(radius) || 0.3;
    const H = Number(height) || 0.8;
    const r = Number(tube) || 0.04;
    const segs = Math.max(64, N * 24);
    const points = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = t * N * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * R, t * H - H / 2, Math.sin(a) * R));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, segs, r, 12, false);
    const mesh = _addAndSelect(geo, 'spring', { color: 0xc8c8d0, metalness: 0.6, roughness: 0.3 });
    return { ok: !!mesh, uuid: mesh?.uuid, turns: N };
  };

  window.__studioCreateRoundedBox = (w, h, d, radius, segs) => {
    const W = Number(w) || 1, H = Number(h) || 1, D = Number(d) || 1;
    const R = Math.max(0.001, Math.min(Math.min(W, H, D) * 0.45, Number(radius) || 0.15));
    const S = Math.max(2, Math.min(16, Number(segs) || 6));
    // Build via Shape extrude with rounded XY profile, then push the
    // Z faces back so the whole solid has rounded edges; cheap-and-OK.
    const shape = new THREE.Shape();
    const halfW = W / 2, halfH = H / 2;
    shape.moveTo(-halfW + R, -halfH);
    shape.lineTo(halfW - R, -halfH);
    shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + R);
    shape.lineTo(halfW, halfH - R);
    shape.quadraticCurveTo(halfW, halfH, halfW - R, halfH);
    shape.lineTo(-halfW + R, halfH);
    shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - R);
    shape.lineTo(-halfW, -halfH + R);
    shape.quadraticCurveTo(-halfW, -halfH, -halfW + R, -halfH);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: D, bevelEnabled: true, bevelSize: R, bevelThickness: R, bevelSegments: S, steps: 1, curveSegments: S,
    });
    geo.translate(0, 0, -D / 2);
    const mesh = _addAndSelect(geo, 'rounded-box', { color: 0xffd9a8, roughness: 0.4, metalness: 0.1 });
    return { ok: !!mesh, uuid: mesh?.uuid };
  };

  // Slice 639 — Extended I/O. ASCII PLY, binary glTF, SVG paths,
  // image plane, custom-resolution snapshot, scene-state JSON.
  window.__studioExportPlyAscii = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    let g = sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry;
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const n = pos.count;
    const faceCount = Math.floor(n / 3);
    const lines = [
      'ply', 'format ascii 1.0',
      `element vertex ${n}`,
      'property float x', 'property float y', 'property float z',
    ];
    if (norm) lines.push('property float nx', 'property float ny', 'property float nz');
    lines.push(`element face ${faceCount}`, 'property list uchar int vertex_indices', 'end_header');
    for (let i = 0; i < n; i++) {
      const r = [pos.array[i*3], pos.array[i*3+1], pos.array[i*3+2]];
      if (norm) r.push(norm.array[i*3], norm.array[i*3+1], norm.array[i*3+2]);
      lines.push(r.map((v) => v.toFixed(6)).join(' '));
    }
    for (let i = 0; i < faceCount; i++) lines.push(`3 ${i*3} ${i*3+1} ${i*3+2}`);
    return { ok: true, text: lines.join('\n'), verts: n, faces: faceCount };
  };

  window.__studioExportGlbBinary = async () => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return { ok: false };
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    return new Promise((resolve) => {
      new GLTFExporter().parse(
        v.scene,
        (buf) => resolve({ ok: true, bytes: buf.byteLength, buffer: buf }),
        (err) => resolve({ ok: false, error: err?.message || 'export failed' }),
        { binary: true },
      );
    });
  };

  window.__studioImportSvgPaths = async (svgText, depth) => {
    if (!svgText) return { ok: false, error: 'empty svg' };
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const { SVGLoader } = await import('three/examples/jsm/loaders/SVGLoader.js');
    const loader = new SVGLoader();
    const data = loader.parse(svgText);
    const group = new THREE.Group();
    const d = Number(depth);
    for (const p of data.paths) {
      const shapes = SVGLoader.createShapes(p);
      for (const shape of shapes) {
        const geo = d > 0
          ? new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false })
          : new THREE.ShapeGeometry(shape);
        const mat = new THREE.MeshStandardMaterial({
          color: (p.userData && p.userData.style && p.userData.style.fill) || 0xeeeeee,
          side: THREE.DoubleSide, roughness: 0.6, metalness: 0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
      }
    }
    // SVG y-axis is flipped vs three.js; scale Y by -1.
    group.scale.y = -1;
    group.userData.archdiscStudioPrimitiveKind = 'svg-import';
    group.name = 'svg_import';
    scene.add(group);
    return { ok: true, uuid: group.uuid, paths: data.paths.length };
  };

  window.__studioImportImagePlane = (dataUrl, width) => new Promise((resolve) => {
    if (!dataUrl) { resolve({ ok: false, error: 'empty dataUrl' }); return; }
    const scene = window.__archdiscScene;
    if (!scene) { resolve({ ok: false }); return; }
    const img = new Image();
    img.onload = () => {
      const w = Number(width) || 2;
      const h = w * (img.height / img.width);
      const geo = new THREE.PlaneGeometry(w, h);
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.archdiscStudioPrimitiveKind = 'image-plane';
      mesh.name = 'image_plane';
      scene.add(mesh);
      resolve({ ok: true, uuid: mesh.uuid, width: w, height: h });
    };
    img.onerror = () => resolve({ ok: false, error: 'load failed' });
    img.src = dataUrl;
  });

  window.__studioExportSnapshotPng = (width, height) => {
    const v = window.__archdiscViewport;
    if (!v || !v.renderer || !v.camera || !v.scene) return { ok: false };
    const w = Math.max(64, Number(width) || 1024);
    const h = Math.max(64, Number(height) || 1024);
    const renderer = v.renderer;
    const oldSize = renderer.getSize(new THREE.Vector2());
    const oldPR = renderer.getPixelRatio();
    const oldAspect = v.camera.aspect;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);
    v.camera.aspect = w / h;
    v.camera.updateProjectionMatrix();
    renderer.render(v.scene, v.camera);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.setSize(oldSize.x, oldSize.y, false);
    renderer.setPixelRatio(oldPR);
    v.camera.aspect = oldAspect;
    v.camera.updateProjectionMatrix();
    return { ok: true, dataUrl: url, width: w, height: h };
  };

  window.__studioExportSceneJson = () => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const out = scene.toJSON();
    const json = JSON.stringify(out);
    return { ok: true, bytes: json.length, json };
  };

  // Slice 638 — Multi-camera registry. We don't swap the renderer's
  // active camera (that's the main viewport's job); instead we record
  // PerspectiveCamera transforms as scene objects with CameraHelper
  // gizmos so the user can lay out shots and snap the main cam to any.
  if (!window.__studioCameras) window.__studioCameras = [];

  window.__studioCameraCreate = (name, opts) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const o = opts || {};
    const fov = Number(o.fov) || 50;
    const near = Number(o.near) || 0.01;
    const far = Number(o.far) || 100;
    const cam = new THREE.PerspectiveCamera(fov, 16/9, near, far);
    const p = Array.isArray(o.position) ? o.position : [2, 2, 2];
    const t = Array.isArray(o.target) ? o.target : [0, 0, 0];
    cam.position.set(p[0], p[1], p[2]);
    cam.lookAt(t[0], t[1], t[2]);
    cam.updateMatrixWorld(true);
    const helper = new THREE.CameraHelper(cam);
    helper.userData.archdiscStudioCameraHelper = true;
    cam.name = name || `cam_${window.__studioCameras.length + 1}`;
    cam.userData.archdiscStudioCamera = { name: cam.name, target: t.slice() };
    scene.add(cam);
    scene.add(helper);
    const rec = { uuid: cam.uuid, name: cam.name, camera: cam, helper, target: t.slice() };
    window.__studioCameras.push(rec);
    return { ok: true, uuid: cam.uuid, name: cam.name };
  };

  window.__studioCameraDelete = (uuid) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const idx = window.__studioCameras.findIndex((r) => r.uuid === uuid);
    if (idx < 0) return { ok: false, error: 'not found' };
    const r = window.__studioCameras[idx];
    if (r.helper) { scene.remove(r.helper); r.helper.geometry?.dispose(); r.helper.material?.dispose(); }
    if (r.camera) scene.remove(r.camera);
    window.__studioCameras.splice(idx, 1);
    return { ok: true, remaining: window.__studioCameras.length };
  };

  window.__studioCameraSetPosition = (uuid, pos) => {
    const rec = window.__studioCameras.find((r) => r.uuid === uuid);
    if (!rec) return { ok: false };
    const p = Array.isArray(pos) ? pos : [0, 0, 0];
    rec.camera.position.set(p[0], p[1], p[2]);
    rec.camera.lookAt(rec.target[0], rec.target[1], rec.target[2]);
    rec.camera.updateMatrixWorld(true);
    rec.helper.update();
    return { ok: true, position: p };
  };

  window.__studioCameraSetTarget = (uuid, target) => {
    const rec = window.__studioCameras.find((r) => r.uuid === uuid);
    if (!rec) return { ok: false };
    const t = Array.isArray(target) ? target : [0, 0, 0];
    rec.target = t.slice();
    rec.camera.lookAt(t[0], t[1], t[2]);
    rec.camera.updateMatrixWorld(true);
    rec.helper.update();
    if (rec.camera.userData.archdiscStudioCamera) rec.camera.userData.archdiscStudioCamera.target = t.slice();
    return { ok: true, target: t };
  };

  window.__studioCameraSnapMainTo = (uuid) => {
    const v = window.__archdiscViewport; if (!v || !v.camera) return { ok: false };
    const rec = window.__studioCameras.find((r) => r.uuid === uuid);
    if (!rec) return { ok: false };
    v.camera.position.copy(rec.camera.position);
    const ctrl = v.orbitControls || v.controls;
    if (ctrl) { ctrl.target.set(rec.target[0], rec.target[1], rec.target[2]); if (ctrl.update) ctrl.update(); }
    v.camera.lookAt(rec.target[0], rec.target[1], rec.target[2]);
    v.camera.updateMatrixWorld(true);
    return { ok: true, snapped: rec.name };
  };

  window.__studioCameraListAll = () => ({
    ok: true,
    count: window.__studioCameras.length,
    cameras: window.__studioCameras.map((r) => ({
      uuid: r.uuid,
      name: r.name,
      position: [r.camera.position.x, r.camera.position.y, r.camera.position.z],
      target: r.target,
      fov: r.camera.fov,
    })),
  });

  // Slice 637 — Annotation pack: text labels, arrows, dimensions and
  // callouts. All annotations live on a flat list keyed by uuid so
  // they can be listed / cleared independently of the scene meshes.
  if (!window.__studioAnnotations) window.__studioAnnotations = [];

  const _annotationLabelTexture = (text, opts) => {
    const o = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const fontSize = (o.fontSize || 32) * dpr;
    const padding = (o.padding || 8) * dpr;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontSize}px ${o.font || 'sans-serif'}`;
    const w = ctx.measureText(text).width + padding * 2;
    const h = fontSize + padding * 2;
    canvas.width = w;
    canvas.height = h;
    ctx.fillStyle = o.background || 'rgba(15, 20, 28, 0.85)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = o.border || '#3a4a5c';
    ctx.lineWidth = dpr;
    ctx.strokeRect(0, 0, w, h);
    ctx.font = `${fontSize}px ${o.font || 'sans-serif'}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = o.color || '#ecf3fb';
    ctx.fillText(text, padding, padding);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, aspect: w / h };
  };

  window.__studioAddTextLabel = (position, text, opts) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const { tex, aspect } = _annotationLabelTexture(String(text || ''), opts);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: !(opts && opts.alwaysOnTop) });
    const sprite = new THREE.Sprite(mat);
    const size = (opts && opts.size) || 0.4;
    sprite.scale.set(size * aspect, size, 1);
    const p = Array.isArray(position) ? position : [0, 1, 0];
    sprite.position.set(p[0], p[1], p[2]);
    sprite.userData.archdiscStudioAnnotation = { kind: 'label', text };
    sprite.renderOrder = 99;
    scene.add(sprite);
    window.__studioAnnotations.push({ kind: 'label', uuid: sprite.uuid, object: sprite });
    return { ok: true, uuid: sprite.uuid };
  };

  window.__studioAddArrow = (from, to, color) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const f = new THREE.Vector3(...(from || [0, 0, 0]));
    const t = new THREE.Vector3(...(to   || [1, 0, 0]));
    const dir = new THREE.Vector3().subVectors(t, f);
    const len = dir.length();
    if (len < 1e-6) return { ok: false, error: 'degenerate' };
    dir.normalize();
    const arrow = new THREE.ArrowHelper(dir, f, len, color || 0xffaa00, len * 0.18, len * 0.1);
    arrow.userData.archdiscStudioAnnotation = { kind: 'arrow' };
    scene.add(arrow);
    window.__studioAnnotations.push({ kind: 'arrow', uuid: arrow.uuid, object: arrow });
    return { ok: true, uuid: arrow.uuid, length: len };
  };

  window.__studioAddDimension = (p1, p2, opts) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const a = new THREE.Vector3(...(p1 || [0, 0, 0]));
    const b = new THREE.Vector3(...(p2 || [1, 0, 0]));
    const dist = a.distanceTo(b);
    const group = new THREE.Group();
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color: 0x44ddff }),
    );
    group.add(line);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const labelOpts = Object.assign({ size: 0.35 }, opts || {});
    const { tex, aspect } = _annotationLabelTexture(dist.toFixed(3), labelOpts);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(labelOpts.size * aspect, labelOpts.size, 1);
    sprite.position.copy(mid).add(new THREE.Vector3(0, labelOpts.size * 0.6, 0));
    group.add(sprite);
    group.userData.archdiscStudioAnnotation = { kind: 'dimension', a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], distance: dist };
    scene.add(group);
    window.__studioAnnotations.push({ kind: 'dimension', uuid: group.uuid, object: group, distance: dist });
    return { ok: true, uuid: group.uuid, distance: dist };
  };

  window.__studioAddCallout = (position, text, opts) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const p = Array.isArray(position) ? position : [0, 1, 0];
    const offset = (opts && opts.offset) || [0.6, 0.6, 0];
    const labelPos = [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
    const group = new THREE.Group();
    // pin sphere
    const pin = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff5577 }),
    );
    pin.position.set(p[0], p[1], p[2]);
    group.add(pin);
    // connector line
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(p[0], p[1], p[2]),
        new THREE.Vector3(labelPos[0], labelPos[1], labelPos[2]),
      ]),
      new THREE.LineBasicMaterial({ color: 0xff8899 }),
    );
    group.add(line);
    // label
    const label = window.__studioAddTextLabel(labelPos, text, opts);
    if (label.ok) {
      const labelSprite = scene.getObjectByProperty('uuid', label.uuid);
      if (labelSprite) {
        scene.remove(labelSprite);
        group.add(labelSprite);
        // remove from annotation list since it lives inside this group
        window.__studioAnnotations = window.__studioAnnotations.filter((a) => a.uuid !== label.uuid);
      }
    }
    group.userData.archdiscStudioAnnotation = { kind: 'callout', text };
    scene.add(group);
    window.__studioAnnotations.push({ kind: 'callout', uuid: group.uuid, object: group });
    return { ok: true, uuid: group.uuid };
  };

  window.__studioClearAnnotations = () => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    for (const a of window.__studioAnnotations) {
      if (a.object && a.object.parent) a.object.parent.remove(a.object);
      a.object?.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    }
    const n = window.__studioAnnotations.length;
    window.__studioAnnotations.length = 0;
    return { ok: true, cleared: n };
  };

  window.__studioListAnnotations = () => ({
    ok: true,
    count: window.__studioAnnotations.length,
    annotations: window.__studioAnnotations.map((a) => ({ kind: a.kind, uuid: a.uuid, distance: a.distance })),
  });

  // Slice 636 — Modifier stack. A "recipe" of {kind, opts} stored on
  // mesh.userData.archdiscStudioModifiers. The user can add / list /
  // reorder / remove before baking via applyAll. Kinds map to existing
  // __studio* ops so we don't reinvent the modifiers themselves.
  const _modifierMap = {
    subdivide: (o) => window.__studioSubdivide(o?.iters ?? 1),
    solidify:  (o) => window.__studioSolidify(o?.thickness ?? 0.05),
    invert:    () => window.__studioInvertNormals(),
    weld:      (o) => window.__studioWeldByDistance(o?.eps ?? 1e-3),
    triangulate: () => window.__studioTriangulate(),
    decimate:  (o) => window.__studioDecimate(o?.ratio ?? 0.5),
    spherify:  (o) => window.__studioSpherify(o?.radius ?? 1),
    randomize: (o) => window.__studioRandomize(o?.strength ?? 0.02),
    voxelize:  (o) => window.__studioVoxelize(o?.size ?? 0.1),
    cast:      (o) => window.__studioCastToSphere(o?.strength ?? 1, o?.radius ?? 1),
    smooth:    () => window.__studioShadingSmooth(),
    flat:      () => window.__studioShadingFlat(),
    twist:     (o) => window.__studioTwistY(o?.degrees ?? 90),
    bend:      (o) => window.__studioBendYZ(o?.degrees ?? 45),
    taper:     (o) => window.__studioTaperY(o?.topRatio ?? 0.5),
  };

  const _modList = (sel) => {
    if (!sel.userData) sel.userData = {};
    if (!Array.isArray(sel.userData.archdiscStudioModifiers)) sel.userData.archdiscStudioModifiers = [];
    return sel.userData.archdiscStudioModifiers;
  };

  window.__studioModifierAdd = (kind, opts) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    if (!_modifierMap[kind]) return { ok: false, error: 'unknown kind: ' + kind };
    const list = _modList(sel);
    list.push({ kind, opts: opts || {} });
    return { ok: true, count: list.length, stack: list.map((m) => m.kind) };
  };

  window.__studioModifierList = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    return { ok: true, stack: _modList(sel).slice() };
  };

  window.__studioModifierRemove = (idx) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const list = _modList(sel);
    if (idx < 0 || idx >= list.length) return { ok: false, error: 'out of range' };
    const removed = list.splice(idx, 1)[0];
    return { ok: true, removed: removed.kind, count: list.length };
  };

  window.__studioModifierReorder = (from, to) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const list = _modList(sel);
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return { ok: false };
    const [m] = list.splice(from, 1);
    list.splice(to, 0, m);
    return { ok: true, stack: list.map((x) => x.kind) };
  };

  window.__studioModifierApply = async (idx) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const list = _modList(sel);
    if (idx < 0 || idx >= list.length) return { ok: false };
    const m = list[idx];
    const r = await _modifierMap[m.kind](m.opts);
    list.splice(idx, 1);
    return { ok: true, applied: m.kind, result: r };
  };

  window.__studioModifierApplyAll = async () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const list = _modList(sel);
    const applied = [];
    for (const m of list.slice()) {
      const r = await _modifierMap[m.kind](m.opts);
      applied.push({ kind: m.kind, result: r });
    }
    list.length = 0;
    return { ok: true, applied };
  };

  // Slice 635 — Lightweight 2D sketch: build a polyline in the XZ plane
  // then extrude (Y) or revolve (around Y) into a real mesh.
  if (!window.__studioSketchState) window.__studioSketchState = { points: [], closed: false };
  const _sk = window.__studioSketchState;

  window.__studioSketchAddPoint = (x, z) => {
    _sk.points.push([Number(x) || 0, Number(z) || 0]);
    return { ok: true, count: _sk.points.length };
  };

  window.__studioSketchClose = () => {
    _sk.closed = true;
    return { ok: true, closed: true, count: _sk.points.length };
  };

  window.__studioSketchClear = () => {
    _sk.points.length = 0;
    _sk.closed = false;
    return { ok: true };
  };

  window.__studioSketchGetPoints = () => ({
    ok: true,
    points: _sk.points.slice(),
    closed: _sk.closed,
  });

  window.__studioSketchExtrude = (depth) => {
    if (_sk.points.length < 3) return { ok: false, error: 'need ≥3 points' };
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const d = Number(depth) || 1;
    const shape = new THREE.Shape();
    shape.moveTo(_sk.points[0][0], _sk.points[0][1]);
    for (let i = 1; i < _sk.points.length; i++) shape.lineTo(_sk.points[i][0], _sk.points[i][1]);
    if (_sk.closed) shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, steps: 1 });
    geo.rotateX(-Math.PI / 2); // lay XZ flat on ground
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa66, roughness: 0.7, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.archdiscStudioPrimitiveKind = 'sketch-extrude';
    mesh.name = 'sketch_extrude';
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    if (window.__studioToast) window.__studioToast(`Extrude depth ${d}`, 'ok');
    return { ok: true, uuid: mesh.uuid, depth: d, verts: geo.attributes.position.count };
  };

  window.__studioSketchRevolve = (segments, angleDeg) => {
    if (_sk.points.length < 2) return { ok: false, error: 'need ≥2 points' };
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const segs = Math.max(3, Math.min(360, Number(segments) || 64));
    const span = (Number(angleDeg) || 360) * Math.PI / 180;
    // Lathe wants Vector2 [x=radius, y=height]; map sketch.x → radius, sketch.z → height.
    const pts = _sk.points.map(([x, z]) => new THREE.Vector2(Math.abs(x), z));
    const geo = new THREE.LatheGeometry(pts, segs, 0, span);
    const mat = new THREE.MeshStandardMaterial({ color: 0x66aaff, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.archdiscStudioPrimitiveKind = 'sketch-revolve';
    mesh.name = 'sketch_revolve';
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    if (window.__studioToast) window.__studioToast(`Revolve ${segs} segs`, 'ok');
    return { ok: true, uuid: mesh.uuid, segments: segs, verts: geo.attributes.position.count };
  };

  // Slice 634 — Object constraint pack: per-frame ties between meshes.
  // Each constraint stores {kind, source, target, opts}. Applied every
  // frame via the viewport anim tick chain so they survive pause/play.
  if (!window.__studioConstraints) window.__studioConstraints = [];

  const _resolveMesh = (uuid) => {
    const scene = window.__archdiscScene; if (!scene) return null;
    if (!uuid) return window.__studioSelectedMesh && window.__studioSelectedMesh();
    return scene.getObjectByProperty('uuid', uuid);
  };

  const _ensureConstraintTick = () => {
    const v = window.__archdiscViewport; if (!v) return;
    if (v.__studioAnimTick && v.__studioAnimTick.__constraints) return;
    const prev = v.__studioAnimTick;
    const fn = () => {
      for (const c of window.__studioConstraints) {
        if (!c.source || !c.target) continue;
        if (c.kind === 'follow') {
          c.source.position.copy(c.target.position).add(c.offset || new THREE.Vector3());
        } else if (c.kind === 'lookAt') {
          c.source.lookAt(c.target.position);
        } else if (c.kind === 'track') {
          // Track-to: align c.axis on source to vector(target - source).
          const dir = new THREE.Vector3().subVectors(c.target.position, c.source.position).normalize();
          const axis = c.axis || new THREE.Vector3(0, 1, 0);
          const q = new THREE.Quaternion().setFromUnitVectors(axis, dir);
          c.source.quaternion.copy(q);
        } else if (c.kind === 'copyRot') {
          c.source.quaternion.copy(c.target.quaternion);
        } else if (c.kind === 'copyScale') {
          c.source.scale.copy(c.target.scale);
        }
      }
    };
    const chained = (now) => { fn(); if (prev) prev(now); };
    chained.__constraints = true;
    chained.__prev = prev;
    v.__studioAnimTick = chained;
  };

  window.__studioConstraintFollow = (sourceUuid, targetUuid, offset) => {
    const s = _resolveMesh(sourceUuid), t = _resolveMesh(targetUuid);
    if (!s || !t) return { ok: false, error: 'mesh not found' };
    const off = Array.isArray(offset) ? new THREE.Vector3(offset[0], offset[1], offset[2]) : new THREE.Vector3();
    window.__studioConstraints.push({ kind: 'follow', source: s, target: t, offset: off });
    _ensureConstraintTick();
    return { ok: true, count: window.__studioConstraints.length };
  };

  window.__studioConstraintLookAt = (sourceUuid, targetUuid) => {
    const s = _resolveMesh(sourceUuid), t = _resolveMesh(targetUuid);
    if (!s || !t) return { ok: false };
    window.__studioConstraints.push({ kind: 'lookAt', source: s, target: t });
    _ensureConstraintTick();
    return { ok: true, count: window.__studioConstraints.length };
  };

  window.__studioConstraintTrack = (sourceUuid, axis, targetUuid) => {
    const s = _resolveMesh(sourceUuid), t = _resolveMesh(targetUuid);
    if (!s || !t) return { ok: false };
    const ax = Array.isArray(axis) ? new THREE.Vector3(axis[0], axis[1], axis[2]).normalize() : new THREE.Vector3(0, 1, 0);
    window.__studioConstraints.push({ kind: 'track', source: s, target: t, axis: ax });
    _ensureConstraintTick();
    return { ok: true, axis: [ax.x, ax.y, ax.z] };
  };

  window.__studioConstraintCopyRotation = (sourceUuid, targetUuid) => {
    const s = _resolveMesh(sourceUuid), t = _resolveMesh(targetUuid);
    if (!s || !t) return { ok: false };
    window.__studioConstraints.push({ kind: 'copyRot', source: s, target: t });
    _ensureConstraintTick();
    return { ok: true };
  };

  window.__studioConstraintCopyScale = (sourceUuid, targetUuid) => {
    const s = _resolveMesh(sourceUuid), t = _resolveMesh(targetUuid);
    if (!s || !t) return { ok: false };
    window.__studioConstraints.push({ kind: 'copyScale', source: s, target: t });
    _ensureConstraintTick();
    return { ok: true };
  };

  window.__studioConstraintClear = (sourceUuid) => {
    if (!sourceUuid) { window.__studioConstraints.length = 0; return { ok: true, cleared: 'all' }; }
    const s = _resolveMesh(sourceUuid); if (!s) return { ok: false };
    const before = window.__studioConstraints.length;
    window.__studioConstraints = window.__studioConstraints.filter((c) => c.source !== s);
    return { ok: true, removed: before - window.__studioConstraints.length };
  };

  // Slice 633 — Hand-rolled rigid-body sandbox. No external physics
  // dep; sphere-vs-ground (y=0) + sphere-vs-sphere with restitution.
  // Bodies store {mesh, vel:[3], mass, radius, restitution, kinematic}.
  if (!window.__studioPhysics) {
    window.__studioPhysics = {
      bodies: [],
      gravity: [0, -9.81, 0],
      playing: false,
      lastTickMs: 0,
    };
  }
  const _phys = window.__studioPhysics;

  window.__studioPhysicsInit = (gravity) => {
    _phys.bodies.length = 0;
    _phys.gravity = Array.isArray(gravity) ? gravity.slice() : [0, -9.81, 0];
    _phys.playing = false;
    return { ok: true, gravity: _phys.gravity };
  };

  window.__studioPhysicsAddRigid = (uuid, opts) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    let mesh = uuid ? scene.getObjectByProperty('uuid', uuid)
      : (window.__studioSelectedMesh && window.__studioSelectedMesh());
    if (!mesh) return { ok: false, error: 'not found' };
    if (!mesh.geometry) return { ok: false, error: 'no geometry' };
    mesh.geometry.computeBoundingSphere();
    const o = opts || {};
    const body = {
      mesh,
      vel: Array.isArray(o.vel) ? o.vel.slice() : [0, 0, 0],
      mass: Number(o.mass) || 1,
      radius: Number(o.radius) || (mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.radius * Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z) : 0.5),
      restitution: o.restitution ?? 0.6,
      kinematic: !!o.kinematic,
    };
    _phys.bodies.push(body);
    return { ok: true, uuid: mesh.uuid, count: _phys.bodies.length, radius: body.radius };
  };

  window.__studioPhysicsSetGravity = (g) => {
    if (Array.isArray(g) && g.length === 3) _phys.gravity = g.slice();
    return { ok: true, gravity: _phys.gravity };
  };

  window.__studioPhysicsStep = (dt) => {
    const step = Math.max(1e-4, Math.min(0.05, Number(dt) || 0.016));
    const [gx, gy, gz] = _phys.gravity;
    const bodies = _phys.bodies;
    // integrate
    for (const b of bodies) {
      if (b.kinematic) continue;
      b.vel[0] += gx * step;
      b.vel[1] += gy * step;
      b.vel[2] += gz * step;
      b.mesh.position.x += b.vel[0] * step;
      b.mesh.position.y += b.vel[1] * step;
      b.mesh.position.z += b.vel[2] * step;
    }
    // ground collision (plane y=0)
    for (const b of bodies) {
      if (b.kinematic) continue;
      const groundY = b.radius;
      if (b.mesh.position.y < groundY) {
        b.mesh.position.y = groundY;
        if (b.vel[1] < 0) b.vel[1] = -b.vel[1] * b.restitution;
        // tangential friction
        b.vel[0] *= 0.95;
        b.vel[2] *= 0.95;
      }
    }
    // pair collisions
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], c = bodies[j];
        if (a.kinematic && c.kinematic) continue;
        const dx = c.mesh.position.x - a.mesh.position.x;
        const dy = c.mesh.position.y - a.mesh.position.y;
        const dz = c.mesh.position.z - a.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const minD = a.radius + c.radius;
        if (dist < minD) {
          const nx = dx / dist, ny = dy / dist, nz = dz / dist;
          const overlap = (minD - dist) * 0.5;
          if (!a.kinematic) { a.mesh.position.x -= nx * overlap; a.mesh.position.y -= ny * overlap; a.mesh.position.z -= nz * overlap; }
          if (!c.kinematic) { c.mesh.position.x += nx * overlap; c.mesh.position.y += ny * overlap; c.mesh.position.z += nz * overlap; }
          // 1D impulse along normal
          const va = a.vel[0] * nx + a.vel[1] * ny + a.vel[2] * nz;
          const vc = c.vel[0] * nx + c.vel[1] * ny + c.vel[2] * nz;
          const rest = Math.min(a.restitution, c.restitution);
          const ma = a.kinematic ? 1e9 : a.mass;
          const mc = c.kinematic ? 1e9 : c.mass;
          const jImp = -(1 + rest) * (vc - va) / (1 / ma + 1 / mc);
          if (!a.kinematic) { a.vel[0] -= (jImp / ma) * nx; a.vel[1] -= (jImp / ma) * ny; a.vel[2] -= (jImp / ma) * nz; }
          if (!c.kinematic) { c.vel[0] += (jImp / mc) * nx; c.vel[1] += (jImp / mc) * ny; c.vel[2] += (jImp / mc) * nz; }
        }
      }
    }
    return { ok: true, bodies: bodies.length, dt: step };
  };

  window.__studioPhysicsReset = () => {
    _phys.bodies.length = 0;
    _phys.playing = false;
    const v = window.__archdiscViewport;
    if (v && v.__studioAnimTick && v.__studioAnimTick.__physics) {
      v.__studioAnimTick = v.__studioAnimTick.__prev || null;
    }
    return { ok: true };
  };

  window.__studioPhysicsTogglePlay = () => {
    const v = window.__archdiscViewport; if (!v) return { ok: false };
    if (_phys.playing) {
      _phys.playing = false;
      if (v.__studioAnimTick && v.__studioAnimTick.__physics) {
        v.__studioAnimTick = v.__studioAnimTick.__prev || null;
      }
      return { ok: true, on: false };
    }
    _phys.playing = true;
    _phys.lastTickMs = performance.now();
    const prev = v.__studioAnimTick;
    const chained = (now) => {
      const dt = Math.min(0.05, (now - _phys.lastTickMs) / 1000);
      _phys.lastTickMs = now;
      window.__studioPhysicsStep(dt);
      if (prev) prev(now);
    };
    chained.__physics = true;
    chained.__prev = prev;
    v.__studioAnimTick = chained;
    return { ok: true, on: true, count: _phys.bodies.length };
  };

  // Slice 632 — Particle system: a THREE.Points with per-vertex
  // velocity / lifetime / colour stored on userData arrays.
  window.__studioCreateParticleSystem = (count, opts) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const n = Math.max(1, Math.min(50000, Number(count) || 1000));
    const o = opts || {};
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const vels = new Float32Array(n * 3);
    const life = new Float32Array(n);
    const max = new Float32Array(n);
    const c1 = new THREE.Color(o.color1 || 0xff8844);
    const c2 = new THREE.Color(o.color2 || 0x66ccff);
    const radius = Number(o.radius) || 0.2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      positions[i * 3]     = Math.cos(a) * r;
      positions[i * 3 + 1] = (Math.random() - 0.1) * 0.05;
      positions[i * 3 + 2] = Math.sin(a) * r;
      vels[i * 3]     = (Math.random() - 0.5) * 0.4;
      vels[i * 3 + 1] = Math.random() * 1.2 + 0.4;
      vels[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      max[i] = 0.8 + Math.random() * 1.4;
      life[i] = Math.random() * max[i];
      const t = life[i] / max[i];
      colors[i * 3]     = c1.r * (1 - t) + c2.r * t;
      colors[i * 3 + 1] = c1.g * (1 - t) + c2.g * t;
      colors[i * 3 + 2] = c1.b * (1 - t) + c2.b * t;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: o.size || 0.04, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    const pts = new THREE.Points(g, mat);
    pts.userData.archdiscStudioParticles = { vels, life, max, count: n, c1, c2, gravity: o.gravity ?? -1.2 };
    pts.name = o.name || 'particles';
    scene.add(pts);
    if (!window.__studioParticleSystems) window.__studioParticleSystems = [];
    window.__studioParticleSystems.push(pts);
    if (window.__studioToast) window.__studioToast(`Particles ×${n}`, 'ok');
    return { ok: true, uuid: pts.uuid, count: n };
  };

  window.__studioParticleStep = (dt) => {
    const sys = window.__studioParticleSystems;
    if (!sys || !sys.length) return { ok: false, error: 'no systems' };
    const step = Number(dt) || 0.016;
    let touched = 0;
    for (const pts of sys) {
      const ud = pts.userData.archdiscStudioParticles; if (!ud) continue;
      const pos = pts.geometry.attributes.position.array;
      const col = pts.geometry.attributes.color.array;
      const { vels, life, max, c1, c2, gravity } = ud;
      for (let i = 0; i < ud.count; i++) {
        vels[i * 3 + 1] += gravity * step;
        pos[i * 3]     += vels[i * 3] * step;
        pos[i * 3 + 1] += vels[i * 3 + 1] * step;
        pos[i * 3 + 2] += vels[i * 3 + 2] * step;
        life[i] += step;
        if (life[i] > max[i]) {
          life[i] = 0;
          pos[i * 3]     = 0;
          pos[i * 3 + 1] = 0;
          pos[i * 3 + 2] = 0;
          vels[i * 3]     = (Math.random() - 0.5) * 0.4;
          vels[i * 3 + 1] = Math.random() * 1.2 + 0.4;
          vels[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
        }
        const t = Math.min(1, life[i] / max[i]);
        col[i * 3]     = c1.r * (1 - t) + c2.r * t;
        col[i * 3 + 1] = c1.g * (1 - t) + c2.g * t;
        col[i * 3 + 2] = c1.b * (1 - t) + c2.b * t;
        touched++;
      }
      pts.geometry.attributes.position.needsUpdate = true;
      pts.geometry.attributes.color.needsUpdate = true;
    }
    return { ok: true, touched };
  };

  window.__studioParticleSetColors = (uuid, c1, c2) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const pts = scene.getObjectByProperty('uuid', uuid);
    if (!pts || !pts.userData || !pts.userData.archdiscStudioParticles) return { ok: false };
    pts.userData.archdiscStudioParticles.c1 = new THREE.Color(c1);
    pts.userData.archdiscStudioParticles.c2 = new THREE.Color(c2);
    return { ok: true };
  };

  window.__studioStarfield = (count, radius) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const n = Math.max(100, Math.min(20000, Number(count) || 5000));
    const r = Number(radius) || 50;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // random direction on unit sphere
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({ size: 0.06, color: 0xffffff, transparent: true, opacity: 0.8 });
    const sky = new THREE.Points(g, m);
    sky.userData.archdiscStudioStarfield = true;
    scene.add(sky);
    return { ok: true, uuid: sky.uuid, count: n };
  };

  window.__studioToggleParticleAnim = () => {
    const v = window.__archdiscViewport; if (!v) return { ok: false };
    if (v.__studioParticleTick) {
      const oldTick = v.__studioAnimTick;
      v.__studioParticleTick = null;
      // detach particle tick from animation tick if it was chained
      if (oldTick && oldTick.__particles) v.__studioAnimTick = oldTick.__prev;
      return { ok: true, on: false };
    }
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      window.__studioParticleStep(dt);
    };
    v.__studioParticleTick = tick;
    const prev = v.__studioAnimTick;
    const chained = (now) => { tick(now); if (prev) prev(now); };
    chained.__particles = true;
    chained.__prev = prev;
    v.__studioAnimTick = chained;
    return { ok: true, on: true };
  };

  window.__studioListParticleSystems = () => {
    const sys = window.__studioParticleSystems || [];
    return { ok: true, count: sys.length, uuids: sys.map((p) => p.uuid) };
  };

  // Slice 631 — Scene outliner: list every user-mesh by uuid + metadata.
  window.__studioListSceneMeshes = () => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const out = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData && (o.userData.archdiscStudioGizmo || o.userData.archdiscStudioGround || o.userData.archdiscStudioGrid)) return;
      out.push({
        uuid: o.uuid,
        name: o.name || '(unnamed)',
        kind: (o.userData && o.userData.archdiscStudioPrimitiveKind) || 'mesh',
        visible: o.visible,
        selectable: !(o.userData && o.userData.archdiscStudioFrozen),
        parent: o.parent && o.parent.uuid !== scene.uuid ? o.parent.uuid : null,
      });
    });
    return { ok: true, count: out.length, meshes: out };
  };

  window.__studioRenameMesh = (uuid, newName) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = scene.getObjectByProperty('uuid', uuid);
    if (!m) return { ok: false, error: 'not found' };
    m.name = String(newName || '');
    return { ok: true, uuid, name: m.name };
  };

  window.__studioSetMeshVisible = (uuid, visible) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = scene.getObjectByProperty('uuid', uuid);
    if (!m) return { ok: false };
    m.visible = !!visible;
    return { ok: true, uuid, visible: m.visible };
  };

  window.__studioSetMeshFrozen = (uuid, frozen) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = scene.getObjectByProperty('uuid', uuid);
    if (!m) return { ok: false };
    if (!m.userData) m.userData = {};
    m.userData.archdiscStudioFrozen = !!frozen;
    return { ok: true, uuid, frozen: !!frozen };
  };

  window.__studioReparentMesh = (childUuid, parentUuid) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const child = scene.getObjectByProperty('uuid', childUuid);
    if (!child) return { ok: false, error: 'child not found' };
    const newParent = parentUuid ? scene.getObjectByProperty('uuid', parentUuid) : scene;
    if (!newParent) return { ok: false, error: 'parent not found' };
    // preserve world transform
    const oldMatrix = child.matrixWorld.clone();
    newParent.add(child);
    newParent.updateMatrixWorld(true);
    const m = new THREE.Matrix4().copy(newParent.matrixWorld).invert().multiply(oldMatrix);
    m.decompose(child.position, child.quaternion, child.scale);
    return { ok: true, child: childUuid, parent: newParent.uuid };
  };

  // Slice 631 — Outliner colour tag (handy for grouping). Persisted on
  // userData so it survives serialisation.
  window.__studioSetMeshTagColor = (uuid, hex) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const m = scene.getObjectByProperty('uuid', uuid);
    if (!m) return { ok: false };
    if (!m.userData) m.userData = {};
    m.userData.archdiscStudioTagColor = hex || null;
    return { ok: true, uuid, color: hex || null };
  };

  // Slice 630 — UV planar projection along one axis. Maps the two
  // remaining axes onto u/v, normalized to the bounding box.
  window.__studioUvProjectPlanar = (axis) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false };
    if (window.__studioPushUndo) window.__studioPushUndo('uv-planar');
    sel.geometry.computeBoundingBox();
    const bb = sel.geometry.boundingBox;
    const pos = sel.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    const ax = (axis || 'y').toLowerCase();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.array[i * 3], y = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2];
      let u, v;
      if (ax === 'x') { u = (z - bb.min.z) / (bb.max.z - bb.min.z || 1); v = (y - bb.min.y) / (bb.max.y - bb.min.y || 1); }
      else if (ax === 'z') { u = (x - bb.min.x) / (bb.max.x - bb.min.x || 1); v = (y - bb.min.y) / (bb.max.y - bb.min.y || 1); }
      else { u = (x - bb.min.x) / (bb.max.x - bb.min.x || 1); v = (z - bb.min.z) / (bb.max.z - bb.min.z || 1); }
      uv[i * 2] = u; uv[i * 2 + 1] = v;
    }
    sel.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return { ok: true, axis: ax, count: pos.count };
  };

  // Slice 630 — Cube projection: pick the dominant face normal per
  // triangle, project the 3 verts to that face's 2D plane.
  window.__studioUvProjectCube = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false };
    if (window.__studioPushUndo) window.__studioPushUndo('uv-cube');
    let g = sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const ex = bb.max.x - bb.min.x || 1, ey = bb.max.y - bb.min.y || 1, ez = bb.max.z - bb.min.z || 1;
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      a.fromArray(pos.array, t * 3);
      b.fromArray(pos.array, (t + 1) * 3);
      c.fromArray(pos.array, (t + 2) * 3);
      n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const map = (vert) => {
        const i = vert * 2;
        if (ax >= ay && ax >= az)      { uv[i] = (pos.array[vert*3+2] - bb.min.z) / ez; uv[i+1] = (pos.array[vert*3+1] - bb.min.y) / ey; }
        else if (ay >= ax && ay >= az) { uv[i] = (pos.array[vert*3]   - bb.min.x) / ex; uv[i+1] = (pos.array[vert*3+2] - bb.min.z) / ez; }
        else                           { uv[i] = (pos.array[vert*3]   - bb.min.x) / ex; uv[i+1] = (pos.array[vert*3+1] - bb.min.y) / ey; }
      };
      map(t); map(t + 1); map(t + 2);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (sel.geometry !== g) { sel.geometry.dispose(); sel.geometry = g; }
    return { ok: true, count: pos.count };
  };

  // Slice 630 — Spherical projection: u = atan2(x,z)/2π+0.5, v = asin(y/|p|)/π+0.5.
  window.__studioUvProjectSphere = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false };
    if (window.__studioPushUndo) window.__studioPushUndo('uv-sphere');
    const pos = sel.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.array[i * 3], y = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2];
      const r = Math.sqrt(x * x + y * y + z * z) || 1e-6;
      uv[i * 2]     = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
      uv[i * 2 + 1] = Math.asin(y / r) / Math.PI + 0.5;
    }
    sel.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return { ok: true, count: pos.count };
  };

  // Slice 630 — Cylindrical projection (Y-axis): u = atan2(x,z)/2π+0.5, v = (y-min)/extent.
  window.__studioUvProjectCylinder = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false };
    if (window.__studioPushUndo) window.__studioPushUndo('uv-cyl');
    sel.geometry.computeBoundingBox();
    const bb = sel.geometry.boundingBox;
    const ext = bb.max.y - bb.min.y || 1;
    const pos = sel.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.array[i * 3], y = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2];
      uv[i * 2]     = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
      uv[i * 2 + 1] = (y - bb.min.y) / ext;
    }
    sel.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return { ok: true, count: pos.count };
  };

  // Slice 630 — UV scale (tile or shrink texture).
  window.__studioUvScale = (s) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry || !sel.geometry.attributes.uv) return { ok: false };
    const sc = Number(s) || 1;
    const uv = sel.geometry.attributes.uv;
    for (let i = 0; i < uv.array.length; i++) uv.array[i] *= sc;
    uv.needsUpdate = true;
    return { ok: true, scale: sc };
  };

  // Slice 630 — UV rotate (deg).
  window.__studioUvRotate = (deg) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry || !sel.geometry.attributes.uv) return { ok: false };
    const a = (Number(deg) || 0) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const uv = sel.geometry.attributes.uv;
    for (let i = 0; i < uv.array.length; i += 2) {
      const u = uv.array[i] - 0.5, v = uv.array[i + 1] - 0.5;
      uv.array[i]     = u * cos - v * sin + 0.5;
      uv.array[i + 1] = u * sin + v * cos + 0.5;
    }
    uv.needsUpdate = true;
    return { ok: true, deg };
  };

  // Slice 629 — Lightweight keyframe + playback system. Tracks are
  // keyed by mesh uuid + property; play() builds an AnimationClip and
  // runs it through a THREE.AnimationMixer driven by the viewport tick.
  if (!window.__studioAnimState) {
    window.__studioAnimState = {
      tracks: new Map(),     // uuid → { property → [{time, value:[]}] }
      mixer: null,
      action: null,
      duration: 2,
      playing: false,
      lastTickMs: 0,
    };
  }
  const _anim = window.__studioAnimState;

  window.__studioKeyframeSet = (property, time, value) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    const id = sel.uuid;
    if (!_anim.tracks.has(id)) _anim.tracks.set(id, {});
    const bag = _anim.tracks.get(id);
    if (!bag[property]) bag[property] = [];
    const t = Number(time) || 0;
    let vals;
    if (Array.isArray(value)) vals = value.slice();
    else if (property === '.position' || property === '.scale') {
      vals = [sel.position.x, sel.position.y, sel.position.z];
      if (property === '.scale') vals = [sel.scale.x, sel.scale.y, sel.scale.z];
    } else if (property === '.quaternion') vals = [sel.quaternion.x, sel.quaternion.y, sel.quaternion.z, sel.quaternion.w];
    const exist = bag[property].findIndex((k) => Math.abs(k.time - t) < 1e-4);
    if (exist >= 0) bag[property][exist].value = vals;
    else bag[property].push({ time: t, value: vals });
    bag[property].sort((a, b) => a.time - b.time);
    return { ok: true, uuid: id, property, time: t, total: bag[property].length };
  };

  window.__studioKeyframeDelete = (property, time) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const bag = _anim.tracks.get(sel.uuid);
    if (!bag || !bag[property]) return { ok: false };
    const t = Number(time);
    bag[property] = bag[property].filter((k) => Math.abs(k.time - t) > 1e-4);
    return { ok: true, remaining: bag[property].length };
  };

  window.__studioKeyframeList = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const bag = _anim.tracks.get(sel.uuid) || {};
    const out = {};
    Object.keys(bag).forEach((k) => { out[k] = bag[k].map((kf) => kf.time); });
    return { ok: true, tracks: out };
  };

  const _rebuildClip = () => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return null;
    const tracks = [];
    _anim.tracks.forEach((bag, uuid) => {
      const node = v.scene.getObjectByProperty('uuid', uuid);
      if (!node) return;
      Object.keys(bag).forEach((prop) => {
        const sorted = bag[prop].slice().sort((a, b) => a.time - b.time);
        if (sorted.length < 2) return;
        const times = sorted.map((k) => k.time);
        const values = [];
        sorted.forEach((k) => values.push(...k.value));
        const trackName = node.name ? `${node.name}${prop}` : uuid + prop;
        const Ctor = prop === '.quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
        tracks.push(new Ctor(trackName, times, values));
      });
    });
    if (!tracks.length) return null;
    return new THREE.AnimationClip('studio', _anim.duration, tracks);
  };

  window.__studioPlayAnimation = (duration) => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return { ok: false };
    if (duration) _anim.duration = Number(duration);
    const clip = _rebuildClip();
    if (!clip) return { ok: false, error: 'need ≥2 keyframes per track' };
    // Build a mixer rooted at the scene so multiple objects can animate.
    const mixer = new THREE.AnimationMixer(v.scene);
    // Re-bind every track to a real node by name; if names are uuids, use the uuid path.
    _anim.mixer = mixer;
    _anim.action = mixer.clipAction(clip);
    _anim.action.setLoop(THREE.LoopRepeat).play();
    _anim.playing = true;
    _anim.lastTickMs = performance.now();
    v.__studioAnimTick = (nowMs) => {
      if (!_anim.playing || !_anim.mixer) return;
      const dt = Math.min(0.1, (nowMs - _anim.lastTickMs) / 1000);
      _anim.lastTickMs = nowMs;
      _anim.mixer.update(dt);
    };
    return { ok: true, duration: _anim.duration, tracks: clip.tracks.length };
  };

  window.__studioPauseAnimation = () => {
    _anim.playing = false;
    if (_anim.action) _anim.action.paused = true;
    return { ok: true, playing: false };
  };

  window.__studioSeekTime = (t) => {
    if (!_anim.mixer || !_anim.action) return { ok: false };
    _anim.action.time = Math.max(0, Math.min(_anim.duration, Number(t) || 0));
    _anim.mixer.update(0);
    return { ok: true, time: _anim.action.time };
  };

  window.__studioGetAnimState = () => ({
    playing: _anim.playing,
    duration: _anim.duration,
    time: _anim.action ? _anim.action.time : 0,
    trackCount: Array.from(_anim.tracks.values()).reduce((n, bag) => n + Object.keys(bag).length, 0),
  });

  // Slice 628 — Convert active material to MeshPhysicalMaterial if it
  // isn't already, so clearcoat / transmission / ior slots exist.
  const _ensurePhys = (sel) => {
    if (!sel.material) return null;
    const cur = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    if (cur.isMeshPhysicalMaterial) return cur;
    const next = new THREE.MeshPhysicalMaterial({
      color: cur.color ? cur.color.clone() : new THREE.Color(0xffffff),
      map: cur.map || null,
      roughness: cur.roughness ?? 0.5,
      metalness: cur.metalness ?? 0,
      emissive: cur.emissive ? cur.emissive.clone() : new THREE.Color(0),
      emissiveIntensity: cur.emissiveIntensity ?? 1,
      vertexColors: !!cur.vertexColors,
    });
    if (Array.isArray(sel.material)) sel.material[0] = next; else sel.material = next;
    cur.dispose();
    return next;
  };

  window.__studioSetEmissive = (hex, intensity) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const m = _ensurePhys(sel); if (!m) return { ok: false };
    if (hex !== undefined) m.emissive.set(hex);
    if (intensity !== undefined) m.emissiveIntensity = Math.max(0, Number(intensity));
    m.needsUpdate = true;
    return { ok: true, hex: '#' + m.emissive.getHexString(), intensity: m.emissiveIntensity };
  };
  window.__studioSetRoughness = (v) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const m = _ensurePhys(sel); if (!m) return { ok: false };
    m.roughness = Math.max(0, Math.min(1, Number(v) || 0));
    m.needsUpdate = true;
    return { ok: true, roughness: m.roughness };
  };
  window.__studioSetMetalness = (v) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const m = _ensurePhys(sel); if (!m) return { ok: false };
    m.metalness = Math.max(0, Math.min(1, Number(v) || 0));
    m.needsUpdate = true;
    return { ok: true, metalness: m.metalness };
  };
  window.__studioSetClearcoat = (v, rough) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const m = _ensurePhys(sel); if (!m) return { ok: false };
    m.clearcoat = Math.max(0, Math.min(1, Number(v) || 0));
    if (rough !== undefined) m.clearcoatRoughness = Math.max(0, Math.min(1, Number(rough)));
    m.needsUpdate = true;
    return { ok: true, clearcoat: m.clearcoat, clearcoatRoughness: m.clearcoatRoughness };
  };
  window.__studioSetTransmission = (v, thickness) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const m = _ensurePhys(sel); if (!m) return { ok: false };
    m.transmission = Math.max(0, Math.min(1, Number(v) || 0));
    if (thickness !== undefined) m.thickness = Math.max(0, Number(thickness));
    m.transparent = m.transmission > 0;
    m.needsUpdate = true;
    return { ok: true, transmission: m.transmission, thickness: m.thickness };
  };
  window.__studioSetIor = (v) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false };
    const m = _ensurePhys(sel); if (!m) return { ok: false };
    m.ior = Math.max(1, Math.min(2.5, Number(v) || 1.5));
    m.needsUpdate = true;
    return { ok: true, ior: m.ior };
  };

  // Slice 627 — Add a free-floating point light.
  window.__studioAddPointLight = (pos, color, intensity) => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return { ok: false };
    const p = Array.isArray(pos) ? pos : [1, 2, 1];
    const light = new THREE.PointLight(color || 0xffeecc, Number(intensity) || 1, 0, 2);
    light.position.set(p[0], p[1], p[2]);
    light.castShadow = true;
    light.userData.archdiscStudioLight = 'point';
    v.scene.add(light);
    return { ok: true, uuid: light.uuid };
  };

  // Slice 627 — Spot light with cone target.
  window.__studioAddSpotLight = (pos, target, color, intensity) => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return { ok: false };
    const p = Array.isArray(pos) ? pos : [2, 3, 2];
    const t = Array.isArray(target) ? target : [0, 0, 0];
    const light = new THREE.SpotLight(color || 0xffffff, Number(intensity) || 2, 0, Math.PI / 6, 0.3, 1);
    light.position.set(p[0], p[1], p[2]);
    light.target.position.set(t[0], t[1], t[2]);
    light.castShadow = true;
    light.userData.archdiscStudioLight = 'spot';
    v.scene.add(light);
    v.scene.add(light.target);
    return { ok: true, uuid: light.uuid };
  };

  // Slice 627 — Hemisphere (sky/ground) light.
  window.__studioAddHemiLight = (sky, ground, intensity) => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return { ok: false };
    const light = new THREE.HemisphereLight(sky || 0xa0c4ff, ground || 0x442200, Number(intensity) || 0.6);
    light.position.set(0, 5, 0);
    light.userData.archdiscStudioLight = 'hemi';
    v.scene.add(light);
    return { ok: true, uuid: light.uuid };
  };

  // Slice 627 — Rectangular area light (good for product / studio lighting).
  window.__studioAddRectLight = (pos, w, h, color, intensity) => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return { ok: false };
    const p = Array.isArray(pos) ? pos : [0, 3, 0];
    const light = new THREE.RectAreaLight(color || 0xffffff, Number(intensity) || 3, Number(w) || 1, Number(h) || 1);
    light.position.set(p[0], p[1], p[2]);
    light.lookAt(0, 0, 0);
    light.userData.archdiscStudioLight = 'rect';
    v.scene.add(light);
    return { ok: true, uuid: light.uuid };
  };

  // Slice 627 — Toggle shadows on every mesh + the renderer.
  window.__studioToggleShadows = () => {
    const v = window.__archdiscViewport; if (!v || !v.renderer || !v.scene) return { ok: false };
    const on = !v.renderer.shadowMap.enabled;
    v.renderer.shadowMap.enabled = on;
    v.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    v.scene.traverse((o) => {
      if (o.isMesh) { o.castShadow = on; o.receiveShadow = on; }
      if (o.isLight && o.shadow) o.castShadow = on;
    });
    return { ok: true, shadows: on };
  };

  // Slice 627 — List every light by type for the inspector.
  window.__studioListLights = () => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return { ok: false };
    const out = { ambient: 0, directional: 0, point: 0, spot: 0, hemi: 0, rect: 0 };
    v.scene.traverse((o) => {
      if (o.isAmbientLight) out.ambient++;
      else if (o.isDirectionalLight) out.directional++;
      else if (o.isPointLight) out.point++;
      else if (o.isSpotLight) out.spot++;
      else if (o.isHemisphereLight) out.hemi++;
      else if (o.isRectAreaLight) out.rect++;
    });
    return { ok: true, ...out };
  };

  // Slice 626 — Camera near/far/fov readout + setters.
  window.__studioSetCameraFov = (fov) => {
    const v = window.__archdiscViewport; if (!v || !v.camera || !v.camera.isPerspectiveCamera) return { ok: false };
    v.camera.fov = Math.max(5, Math.min(170, Number(fov) || 50));
    v.camera.updateProjectionMatrix();
    return { ok: true, fov: v.camera.fov };
  };
  window.__studioSetCameraNear = (n) => {
    const v = window.__archdiscViewport; if (!v || !v.camera) return { ok: false };
    v.camera.near = Math.max(1e-4, Number(n) || 0.1);
    v.camera.updateProjectionMatrix();
    return { ok: true, near: v.camera.near };
  };
  window.__studioSetCameraFar = (f) => {
    const v = window.__archdiscViewport; if (!v || !v.camera) return { ok: false };
    v.camera.far = Math.max(v.camera.near + 1, Number(f) || 1000);
    v.camera.updateProjectionMatrix();
    return { ok: true, far: v.camera.far };
  };

  // Slice 626 — Axis lines: draw a +X/+Y/+Z red/green/blue helper.
  window.__studioToggleAxisLines = () => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return { ok: false };
    let helper = v.__studioAxisHelper;
    if (helper) {
      v.scene.remove(helper);
      helper.geometry.dispose();
      if (Array.isArray(helper.material)) helper.material.forEach((m) => m.dispose()); else helper.material.dispose();
      v.__studioAxisHelper = null;
      return { ok: true, on: false };
    }
    helper = new THREE.AxesHelper(2);
    helper.userData.archdiscStudioGizmo = true;
    helper.renderOrder = 9999;
    v.scene.add(helper);
    v.__studioAxisHelper = helper;
    return { ok: true, on: true };
  };

  // Slice 626 — Ground plane toggle: a 100×100 grid-textured plane at y=0.
  window.__studioToggleGround = () => {
    const v = window.__archdiscViewport; if (!v || !v.scene) return { ok: false };
    let ground = v.__studioGround;
    if (ground) {
      v.scene.remove(ground);
      ground.geometry.dispose(); ground.material.dispose();
      v.__studioGround = null;
      return { ok: true, on: false };
    }
    const geo = new THREE.PlaneGeometry(50, 50);
    const mat = new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.9, metalness: 0 });
    ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData.archdiscStudioGround = true;
    v.scene.add(ground);
    v.__studioGround = ground;
    return { ok: true, on: true };
  };

  // Slice 626 — Wireframe overlay for the active mesh: cyan EdgesGeometry.
  window.__studioToggleWireOverlay = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (sel.__studioWireOverlay) {
      sel.remove(sel.__studioWireOverlay);
      sel.__studioWireOverlay.geometry.dispose();
      sel.__studioWireOverlay.material.dispose();
      sel.__studioWireOverlay = null;
      return { ok: true, on: false };
    }
    const edges = new THREE.EdgesGeometry(sel.geometry, 30);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ffff }));
    line.userData.archdiscStudioGizmo = true;
    sel.add(line);
    sel.__studioWireOverlay = line;
    return { ok: true, on: true };
  };

  // Slice 625 — Randomize: jitter each vertex by ±strength on every axis.
  window.__studioRandomize = (strength) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo('randomize');
    const s = Number(strength) || 0.02;
    const pos = sel.geometry.attributes.position;
    for (let i = 0; i < pos.array.length; i++) pos.array[i] += (Math.random() - 0.5) * 2 * s;
    pos.needsUpdate = true;
    sel.geometry.computeVertexNormals();
    sel.geometry.computeBoundingBox(); sel.geometry.computeBoundingSphere();
    return { ok: true, strength: s };
  };

  // Slice 625 — Cast to sphere: blend each vertex toward |r| * normalize(p).
  window.__studioCastToSphere = (strength, radius) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo('cast-sphere');
    const t = Math.max(0, Math.min(1, Number(strength) ?? 1));
    const r = Number(radius) || 1;
    const pos = sel.geometry.attributes.position;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      tmp.fromArray(pos.array, i * 3);
      const len = tmp.length() || 1e-6;
      const tx = tmp.x / len * r, ty = tmp.y / len * r, tz = tmp.z / len * r;
      pos.array[i * 3]     = tmp.x + (tx - tmp.x) * t;
      pos.array[i * 3 + 1] = tmp.y + (ty - tmp.y) * t;
      pos.array[i * 3 + 2] = tmp.z + (tz - tmp.z) * t;
    }
    pos.needsUpdate = true;
    sel.geometry.computeVertexNormals();
    sel.geometry.computeBoundingBox(); sel.geometry.computeBoundingSphere();
    return { ok: true, strength: t, radius: r };
  };

  // Slice 625 — Voxelize: snap each vert to nearest grid cell of size s.
  window.__studioVoxelize = (size) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo('voxelize');
    const s = Number(size) || 0.1;
    const pos = sel.geometry.attributes.position;
    for (let i = 0; i < pos.array.length; i++) pos.array[i] = Math.round(pos.array[i] / s) * s;
    pos.needsUpdate = true;
    sel.geometry.computeVertexNormals();
    sel.geometry.computeBoundingBox(); sel.geometry.computeBoundingSphere();
    return { ok: true, size: s };
  };

  // Slice 625 — Triangulate: forcibly convert to non-indexed tri soup.
  window.__studioTriangulate = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (sel.geometry.index) {
      const tri = sel.geometry.toNonIndexed();
      sel.geometry.dispose();
      sel.geometry = tri;
    }
    sel.geometry.computeVertexNormals();
    return { ok: true, verts: sel.geometry.attributes.position.count };
  };

  // Slice 625 — Decimate by ratio (0..1) using SimplifyModifier. ratio
  // is the fraction to *keep* (0.5 = drop half).
  window.__studioDecimate = async (ratio) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const [{ SimplifyModifier }, { mergeVertices }] = await Promise.all([
      import('three/examples/jsm/modifiers/SimplifyModifier.js'),
      import('three/examples/jsm/utils/BufferGeometryUtils.js'),
    ]);
    if (window.__studioPushUndo) window.__studioPushUndo('decimate');
    const merged = mergeVertices(sel.geometry, 1e-4);
    const before = merged.attributes.position.count;
    const keep = Math.max(0.05, Math.min(0.95, Number(ratio) || 0.5));
    const remove = Math.floor(before * (1 - keep));
    const out = new SimplifyModifier().modify(merged, remove);
    sel.geometry.dispose();
    sel.geometry = out;
    sel.geometry.computeVertexNormals();
    sel.geometry.computeBoundingBox(); sel.geometry.computeBoundingSphere();
    return { ok: true, before, after: out.attributes.position.count };
  };

  // Slice 625 — Spherify: set every vertex's |p| = radius (exact).
  window.__studioSpherify = (radius) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo('spherify');
    const r = Number(radius) || 1;
    const pos = sel.geometry.attributes.position;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      tmp.fromArray(pos.array, i * 3);
      const len = tmp.length() || 1e-6;
      pos.array[i * 3]     = tmp.x / len * r;
      pos.array[i * 3 + 1] = tmp.y / len * r;
      pos.array[i * 3 + 2] = tmp.z / len * r;
    }
    pos.needsUpdate = true;
    sel.geometry.computeVertexNormals();
    sel.geometry.computeBoundingBox(); sel.geometry.computeBoundingSphere();
    return { ok: true, radius: r };
  };

  // Slice 624 — Solidify: add a back-face shell at -thickness along
  // each vertex normal. Doubles vert count.
  window.__studioSolidify = (thickness) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo('solidify');
    const t = Number(thickness) || 0.05;
    const src = sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry.clone();
    src.computeVertexNormals();
    const sPos = src.attributes.position.array;
    const sN   = src.attributes.normal.array;
    const tris = sPos.length / 9;
    const out = new Float32Array(tris * 2 * 9);
    // front: copy as-is
    out.set(sPos, 0);
    // back: offset by -t * normal, reversed winding
    for (let i = 0; i < tris; i++) {
      const off = tris * 9 + i * 9;
      const s = i * 9;
      // reverse winding: c, b, a
      for (let k = 2, w = 0; k >= 0; k--, w++) {
        out[off + w * 3]     = sPos[s + k * 3]     - sN[s + k * 3]     * t;
        out[off + w * 3 + 1] = sPos[s + k * 3 + 1] - sN[s + k * 3 + 1] * t;
        out[off + w * 3 + 2] = sPos[s + k * 3 + 2] - sN[s + k * 3 + 2] * t;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    sel.geometry.dispose();
    sel.geometry = g;
    if (window.__studioToast) window.__studioToast(`Solidify ${t} → ${g.attributes.position.count} verts`, 'ok');
    return { ok: true, verts: g.attributes.position.count, thickness: t };
  };

  // Slice 624 — Invert normals / flip face winding.
  window.__studioInvertNormals = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo('invert-normals');
    let g = sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      // swap vert 1 and vert 2
      for (let k = 0; k < 3; k++) {
        const a = (i + 1) * 3 + k, b = (i + 2) * 3 + k;
        const t = pos.array[a]; pos.array[a] = pos.array[b]; pos.array[b] = t;
      }
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    if (sel.geometry !== g) { sel.geometry.dispose(); sel.geometry = g; }
    return { ok: true };
  };

  // Slice 624 — Weld coincident verts within eps via mergeVertices.
  window.__studioWeldByDistance = async (eps) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    const before = (sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry).attributes.position.count;
    const merged = mergeVertices(sel.geometry, Number(eps) || 1e-3);
    sel.geometry.dispose();
    sel.geometry = merged;
    sel.geometry.computeVertexNormals();
    sel.geometry.computeBoundingBox(); sel.geometry.computeBoundingSphere();
    const after = merged.attributes.position.count;
    if (window.__studioToast) window.__studioToast(`Welded ${before} → ${after} verts`, 'ok');
    return { ok: true, before, after };
  };

  // Slice 624 — Recenter origin to geometry's bbox centre. The mesh
  // position moves so the world space stays put.
  window.__studioCenterOrigin = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo('center-origin');
    sel.geometry.computeBoundingBox();
    const c = new THREE.Vector3();
    sel.geometry.boundingBox.getCenter(c);
    sel.geometry.translate(-c.x, -c.y, -c.z);
    sel.position.add(c.applyQuaternion(sel.quaternion).multiply(sel.scale));
    sel.geometry.computeBoundingBox(); sel.geometry.computeBoundingSphere();
    return { ok: true, offset: [c.x, c.y, c.z] };
  };

  // Slice 624 — Flat vs smooth shading. Flat: copy face normal to all
  // 3 verts per tri. Smooth: averaged vertex normals.
  window.__studioShadingFlat = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    let g = sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry;
    const pos = g.attributes.position;
    const norms = new Float32Array(pos.count * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromArray(pos.array, i * 3);
      b.fromArray(pos.array, (i + 1) * 3);
      c.fromArray(pos.array, (i + 2) * 3);
      ab.subVectors(b, a); ac.subVectors(c, a);
      n.crossVectors(ab, ac).normalize();
      for (let k = 0; k < 3; k++) { norms.set([n.x, n.y, n.z], (i + k) * 3); }
    }
    g.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
    if (sel.geometry !== g) { sel.geometry.dispose(); sel.geometry = g; }
    return { ok: true };
  };
  window.__studioShadingSmooth = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    sel.geometry.computeVertexNormals();
    return { ok: true };
  };

  // Slice 624 — Toggle maximize: hide left+right panels via a CSS class
  // on the shell. Mirrors Blender's Ctrl+Space focus mode.
  window.__studioMaximizeViewport = () => {
    const shell = document.querySelector('[data-studio-v3-shell]');
    if (!shell) return { ok: false };
    const max = !shell.classList.contains('studio-v3-maximized');
    shell.classList.toggle('studio-v3-maximized', max);
    return { ok: true, maximized: max };
  };

  // Slice 623 — Subdivide each triangle into 4 by inserting midpoints
  // on every edge. Iteration N multiplies face count by 4. No smoothing
  // (loop/catmull-clark fairing is a future slice) — just splits the
  // mesh so per-vertex ops (sculpt, displace) have something to push.
  window.__studioSubdivide = (iters) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    const n = Math.max(1, Math.min(4, Number(iters) || 1));
    let geo = sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry.clone();
    if (window.__studioPushUndo) window.__studioPushUndo('subdivide');
    for (let pass = 0; pass < n; pass++) {
      const pos = geo.attributes.position;
      const tris = pos.count / 3;
      const out = new Float32Array(tris * 4 * 3 * 3);
      let o = 0;
      for (let t = 0; t < tris; t++) {
        const i = t * 9;
        const ax = pos.array[i],     ay = pos.array[i + 1], az = pos.array[i + 2];
        const bx = pos.array[i + 3], by = pos.array[i + 4], bz = pos.array[i + 5];
        const cx = pos.array[i + 6], cy = pos.array[i + 7], cz = pos.array[i + 8];
        const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
        const nx = (bx + cx) / 2, ny = (by + cy) / 2, nz = (bz + cz) / 2;
        const ox = (cx + ax) / 2, oy = (cy + ay) / 2, oz = (cz + az) / 2;
        // 4 sub-tris: a-m-o, m-b-n, o-n-c, m-n-o
        const push = (x1,y1,z1,x2,y2,z2,x3,y3,z3) => {
          out[o++] = x1; out[o++] = y1; out[o++] = z1;
          out[o++] = x2; out[o++] = y2; out[o++] = z2;
          out[o++] = x3; out[o++] = y3; out[o++] = z3;
        };
        push(ax,ay,az,  mx,my,mz,  ox,oy,oz);
        push(mx,my,mz,  bx,by,bz,  nx,ny,nz);
        push(ox,oy,oz,  nx,ny,nz,  cx,cy,cz);
        push(mx,my,mz,  nx,ny,nz,  ox,oy,oz);
      }
      const next = new THREE.BufferGeometry();
      next.setAttribute('position', new THREE.BufferAttribute(out, 3));
      next.computeVertexNormals();
      geo = next;
    }
    sel.geometry.dispose();
    sel.geometry = geo;
    sel.geometry.computeBoundingBox();
    sel.geometry.computeBoundingSphere();
    if (window.__studioToast) window.__studioToast(`Subdivided ×${n} → ${geo.attributes.position.count} verts`, 'ok');
    return { ok: true, iters: n, verts: geo.attributes.position.count };
  };

  // Slice 622 — Frame the active selection: move the camera so the
  // selection's bounding sphere fills ~half the viewport, and centre
  // orbit on it. Mirrors Blender's Numpad-.
  window.__studioFrameSelection = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    const v = window.__archdiscViewport;
    if (!sel || !v || !v.camera) return { ok: false, error: 'no selection' };
    sel.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(sel);
    if (box.isEmpty()) return { ok: false, error: 'empty bounds' };
    const sph = new THREE.Sphere();
    box.getBoundingSphere(sph);
    const cam = v.camera;
    const ctrl = v.orbitControls || v.controls;
    const fov = (cam.fov || 50) * Math.PI / 180;
    const dist = Math.max(0.3, sph.radius / Math.sin(fov / 2)) * 1.4;
    const dir = new THREE.Vector3().subVectors(cam.position, ctrl ? ctrl.target : new THREE.Vector3()).normalize();
    cam.position.copy(sph.center).addScaledVector(dir, dist);
    if (ctrl) { ctrl.target.copy(sph.center); if (ctrl.update) ctrl.update(); }
    cam.lookAt(sph.center);
    cam.updateMatrixWorld(true);
    return { ok: true, radius: sph.radius, center: [sph.center.x, sph.center.y, sph.center.z] };
  };

  // Slice 622 — Isolate selection: hide every other mesh in the scene
  // (push to a tucked-away parent); toggle restores them. Mirrors
  // Blender's Numpad-/.
  if (!window.__studioIsolateStack) window.__studioIsolateStack = [];
  window.__studioToggleIsolateSelection = () => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    if (window.__studioIsolateStack.length > 0) {
      // restore
      window.__studioIsolateStack.forEach((rec) => { rec.mesh.visible = rec.was; });
      window.__studioIsolateStack = [];
      return { ok: true, isolated: false };
    }
    const records = [];
    window.__archdiscScene.traverse((o) => {
      if (!o.isMesh || o === sel) return;
      if (o.userData && (o.userData.archdiscStudioGizmo || o.userData.archdiscStudioGrid || o.userData.archdiscStudioGround)) return;
      records.push({ mesh: o, was: o.visible });
      o.visible = false;
    });
    window.__studioIsolateStack = records;
    return { ok: true, isolated: true, hidden: records.length };
  };

  // Slice 621 — Real sculpt brush displacement. point is local-space
  // [x,y,z]; vertices within `size` are pushed along the average of
  // their normals by `strength` × falloff. kind: draw | inflate | smooth.
  window.__studioSculptBrushApply = (point) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry || !sel.geometry.attributes.position) {
      return { ok: false, error: 'no selection' };
    }
    const brush = window.__studioSculptBrush;
    const pos = sel.geometry.attributes.position;
    let normal = sel.geometry.attributes.normal;
    if (!normal) { sel.geometry.computeVertexNormals(); normal = sel.geometry.attributes.normal; }
    const p = Array.isArray(point) ? point : [0, 0, 0];
    const size = brush.size || 0.04;
    const strength = brush.strength || 0.3;
    const falloff = brush.falloff || 0.6;
    const r2 = size * size;
    let touched = 0;
    const tmp = new THREE.Vector3();
    const tmpN = new THREE.Vector3();
    if (window.__studioPushUndo) window.__studioPushUndo('sculpt');
    if (brush.kind === 'smooth') {
      // simple laplacian: average each vertex within radius with neighbors
      const original = new Float32Array(pos.array);
      for (let i = 0; i < pos.count; i++) {
        tmp.fromArray(original, i * 3);
        const d2 = (tmp.x - p[0]) ** 2 + (tmp.y - p[1]) ** 2 + (tmp.z - p[2]) ** 2;
        if (d2 > r2) continue;
        const w = Math.pow(1 - Math.sqrt(d2) / size, falloff * 4 + 0.1);
        let cx = 0, cy = 0, cz = 0, n = 0;
        for (let j = 0; j < pos.count; j++) {
          if (i === j) continue;
          const dx = original[j * 3] - tmp.x;
          const dy = original[j * 3 + 1] - tmp.y;
          const dz = original[j * 3 + 2] - tmp.z;
          if (dx * dx + dy * dy + dz * dz < r2 * 0.25) {
            cx += original[j * 3]; cy += original[j * 3 + 1]; cz += original[j * 3 + 2]; n++;
          }
        }
        if (n > 0) {
          pos.array[i * 3]     = tmp.x + ((cx / n) - tmp.x) * w * strength;
          pos.array[i * 3 + 1] = tmp.y + ((cy / n) - tmp.y) * w * strength;
          pos.array[i * 3 + 2] = tmp.z + ((cz / n) - tmp.z) * w * strength;
          touched++;
        }
      }
    } else {
      const sign = brush.kind === 'inflate' ? 1 : (brush.kind === 'pinch' ? -1 : 1);
      for (let i = 0; i < pos.count; i++) {
        tmp.fromArray(pos.array, i * 3);
        const dx = tmp.x - p[0], dy = tmp.y - p[1], dz = tmp.z - p[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const t = 1 - Math.sqrt(d2) / size;
        const w = Math.pow(t, falloff * 4 + 0.1);
        if (brush.kind === 'inflate') {
          tmpN.fromArray(normal.array, i * 3);
          pos.array[i * 3]     += tmpN.x * w * strength * sign;
          pos.array[i * 3 + 1] += tmpN.y * w * strength * sign;
          pos.array[i * 3 + 2] += tmpN.z * w * strength * sign;
        } else {
          // draw: push along brush direction (default +Y; or supplied normal)
          tmpN.fromArray(normal.array, i * 3);
          pos.array[i * 3]     += tmpN.x * w * strength * sign;
          pos.array[i * 3 + 1] += tmpN.y * w * strength * sign;
          pos.array[i * 3 + 2] += tmpN.z * w * strength * sign;
        }
        touched++;
      }
    }
    pos.needsUpdate = true;
    sel.geometry.computeVertexNormals();
    if (sel.geometry.boundsTree) {
      try { sel.geometry.computeBoundsTree(); } catch (_) {}
    }
    sel.geometry.computeBoundingBox();
    sel.geometry.computeBoundingSphere();
    return { ok: true, touched };
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

  // Slice 609 — FXAA antialias pass.
  let _fxaaPass = null;
  window.__studioToggleFXAA = async () => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.renderer) return { ok: false };
    if (_fxaaPass && vp.__studioComposer) {
      vp.__studioComposer.removePass(_fxaaPass);
      _fxaaPass.dispose && _fxaaPass.dispose();
      _fxaaPass = null;
      if (window.__studioToast) window.__studioToast('FXAA off', 'info');
      return { ok: true, on: false };
    }
    if (!vp.__studioComposer && window.__studioToggleOutlinePass) await window.__studioToggleOutlinePass();
    if (!vp.__studioComposer) return { ok: false, error: 'no composer' };
    const [passMod, shaderMod] = await Promise.all([
      import('three/examples/jsm/postprocessing/ShaderPass.js'),
      import('three/examples/jsm/shaders/FXAAShader.js'),
    ]);
    _fxaaPass = new passMod.ShaderPass(shaderMod.FXAAShader);
    const dom = vp.renderer.domElement;
    const dpr = vp.renderer.getPixelRatio();
    _fxaaPass.material.uniforms.resolution.value.set(1 / (dom.clientWidth * dpr), 1 / (dom.clientHeight * dpr));
    const passes = vp.__studioComposer.passes;
    vp.__studioComposer.insertPass(_fxaaPass, Math.max(0, passes.length - 1));
    if (window.__studioToast) window.__studioToast('FXAA on', 'ok');
    return { ok: true, on: true };
  };

  // Slice 608 — Bloom post-effect via UnrealBloomPass.
  let _bloomPass = null;
  window.__studioToggleBloom = async () => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.renderer || !vp.scene || !vp.camera) return { ok: false };
    if (_bloomPass && vp.__studioComposer) {
      vp.__studioComposer.removePass(_bloomPass);
      _bloomPass.dispose && _bloomPass.dispose();
      _bloomPass = null;
      if (window.__studioToast) window.__studioToast('Bloom off', 'info');
      return { ok: true, on: false };
    }
    if (!vp.__studioComposer && window.__studioToggleOutlinePass) await window.__studioToggleOutlinePass();
    if (!vp.__studioComposer) return { ok: false, error: 'no composer' };
    const mod = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
    const dom = vp.renderer.domElement;
    _bloomPass = new mod.UnrealBloomPass(new THREE.Vector2(dom.clientWidth, dom.clientHeight), 0.4, 0.6, 0.85);
    const passes = vp.__studioComposer.passes;
    vp.__studioComposer.insertPass(_bloomPass, Math.max(0, passes.length - 1));
    if (window.__studioToast) window.__studioToast('Bloom on', 'ok');
    return { ok: true, on: true };
  };

  // Slice 607 — SSAO post-effect pass; lazy-loads SSAOPass and appends it
  // to the EffectComposer (creating it if needed). Toggleable.
  let _ssaoPass = null;
  window.__studioToggleSSAO = async () => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.renderer || !vp.scene || !vp.camera) return { ok: false };
    if (_ssaoPass && vp.__studioComposer) {
      vp.__studioComposer.removePass(_ssaoPass);
      _ssaoPass.dispose && _ssaoPass.dispose();
      _ssaoPass = null;
      if (window.__studioToast) window.__studioToast('SSAO off', 'info');
      return { ok: true, on: false };
    }
    if (!vp.__studioComposer && window.__studioToggleOutlinePass) {
      // Need an EffectComposer; outline-pass init builds one.
      await window.__studioToggleOutlinePass();
    }
    if (!vp.__studioComposer) return { ok: false, error: 'no composer' };
    const mod = await import('three/examples/jsm/postprocessing/SSAOPass.js');
    const dom = vp.renderer.domElement;
    _ssaoPass = new mod.SSAOPass(vp.scene, vp.camera, dom.clientWidth, dom.clientHeight);
    _ssaoPass.kernelRadius = 0.02;
    _ssaoPass.minDistance = 0.001;
    _ssaoPass.maxDistance = 0.1;
    const passes = vp.__studioComposer.passes;
    vp.__studioComposer.insertPass(_ssaoPass, Math.max(0, passes.length - 1));
    if (window.__studioToast) window.__studioToast('SSAO on', 'ok');
    return { ok: true, on: true };
  };

  // Slice 606 — Outline post-process via three's OutlinePass. Toggleable
  // EffectComposer hooked into the existing renderer; selected mesh gets
  // a true screen-space outline (parity with Blender's selection halo).
  let _composer = null;
  let _outlinePass = null;
  window.__studioToggleOutlinePass = async () => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.renderer) return { ok: false };
    if (_composer) {
      _composer.dispose && _composer.dispose();
      _composer = null;
      _outlinePass = null;
      vp.__studioComposer = null;
      if (window.__studioToast) window.__studioToast('Outline pass off', 'info');
      return { ok: true, on: false };
    }
    const [composerMod, renderMod, outlineMod, outputMod] = await Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/OutlinePass.js'),
      import('three/examples/jsm/postprocessing/OutputPass.js'),
    ]);
    _composer = new composerMod.EffectComposer(vp.renderer);
    _composer.addPass(new renderMod.RenderPass(vp.scene, vp.camera));
    _outlinePass = new outlineMod.OutlinePass(
      new THREE.Vector2(vp.renderer.domElement.clientWidth, vp.renderer.domElement.clientHeight),
      vp.scene,
      vp.camera,
    );
    _outlinePass.edgeStrength = 4;
    _outlinePass.edgeGlow = 0.4;
    _outlinePass.edgeThickness = 1.0;
    _outlinePass.visibleEdgeColor = new THREE.Color(0x1de9b6);
    _outlinePass.hiddenEdgeColor = new THREE.Color(0x0a4a3a);
    _composer.addPass(_outlinePass);
    _composer.addPass(new outputMod.OutputPass());
    vp.__studioComposer = _composer;
    vp.__studioOutlinePass = _outlinePass;
    // Sync selection list to the outline pass.
    const syncSel = () => {
      const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
      _outlinePass.selectedObjects = sel ? [sel] : [];
    };
    syncSel();
    vp.__studioOutlineSync = syncSel;
    if (window.__studioToast) window.__studioToast('Outline pass on', 'ok');
    return { ok: true, on: true };
  };

  // Slice 619 — Recolour every instance of the active InstancedMesh.
  // hueFromIndex(i, n) → 0..1; falls back to a rainbow when fn omitted.
  window.__studioInstanceRecolor = (fn) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.isInstancedMesh) return { ok: false, error: 'no instanced mesh' };
    const n = sel.count;
    const c = new THREE.Color();
    if (!sel.instanceColor) {
      sel.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      const mat = Array.isArray(sel.material) ? sel.material[0] : sel.material;
      if (mat) { mat.vertexColors = true; mat.needsUpdate = true; }
    }
    const f = typeof fn === 'function' ? fn : (i) => i / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) {
      c.setHSL(f(i, n), 0.65, 0.55);
      sel.setColorAt(i, c);
    }
    if (sel.instanceColor) sel.instanceColor.needsUpdate = true;
    if (window.__studioToast) window.__studioToast(`Recoloured ${n} instances`, 'ok');
    return { ok: true, count: n };
  };

  // Slice 620 — V3 LOD: wrap the active mesh in three.LOD with three
  // distance tiers. tier 0 is original geometry, 1 is BufferGeometryUtils
  // mergeVertices+SimplifyModifier removing ~50% verts, 2 ~80%. Lower
  // tiers swap in at distances [2, 6] world units from the camera.
  window.__studioCreateLOD = async (dists) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry || !sel.material) return { ok: false, error: 'no selection' };
    if (sel.isLOD || sel.parent?.isLOD) return { ok: false, error: 'already LOD' };
    const [{ SimplifyModifier }, { mergeVertices }] = await Promise.all([
      import('three/examples/jsm/modifiers/SimplifyModifier.js'),
      import('three/examples/jsm/utils/BufferGeometryUtils.js'),
    ]);
    const mod = new SimplifyModifier();
    const base = mergeVertices(sel.geometry.clone(), 1e-3);
    const count = base.attributes.position.count;
    const half = mod.modify(base, Math.max(3, Math.floor(count * 0.5)));
    const low  = mod.modify(base, Math.max(3, Math.floor(count * 0.2)));
    const lod = new THREE.LOD();
    lod.position.copy(sel.position);
    lod.quaternion.copy(sel.quaternion);
    lod.scale.copy(sel.scale);
    const matA = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    const d = Array.isArray(dists) && dists.length === 2 ? dists : [2, 6];
    lod.addLevel(new THREE.Mesh(sel.geometry, matA), 0);
    lod.addLevel(new THREE.Mesh(half, matA.clone()), d[0]);
    lod.addLevel(new THREE.Mesh(low, matA.clone()), d[1]);
    lod.userData.archdiscStudioLOD = true;
    const parent = sel.parent || window.__archdiscScene;
    parent.add(lod);
    parent.remove(sel);
    if (window.__studioSelectMesh) window.__studioSelectMesh(lod.levels[0].object);
    if (window.__studioToast) window.__studioToast(`LOD: ${count} → ${half.attributes.position.count} → ${low.attributes.position.count} verts`, 'ok');
    return { ok: true, levels: 3, verts: [count, half.attributes.position.count, low.attributes.position.count] };
  };

  // Slice 613 — Create an InstancedMesh from the active mesh as the
  // template + an array of [x, y, z] positions. Useful for forests,
  // crowds, particle-style swarms without N draw calls.
  window.__studioInstanceFromSelection = (positions, scale) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel || !sel.geometry) return { ok: false, error: 'no selection' };
    if (!Array.isArray(positions) || positions.length === 0) return { ok: false, error: 'positions required' };
    const mat = Array.isArray(sel.material) ? sel.material[0].clone() : sel.material.clone();
    const im = new THREE.InstancedMesh(sel.geometry.clone(), mat, positions.length);
    const m = new THREE.Matrix4();
    const s = Number(scale) || 1;
    for (let i = 0; i < positions.length; i++) {
      m.identity();
      m.makeScale(s, s, s);
      m.setPosition(positions[i][0], positions[i][1], positions[i][2]);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.name = `${sel.name || 'mesh'}-instances`;
    im.castShadow = true; im.receiveShadow = true;
    im.userData = {
      archdiscStudioPrimitive: true,
      archdiscStudioPrimitiveKind: 'instances',
      archdiscStudioInstanceCount: positions.length,
      archdiscStudioInstanceFrom: sel.userData.archdiscStudioPrimitiveKind || 'mesh',
    };
    const scene = window.__archdiscScene;
    scene.add(im);
    if (window.__studioToast) window.__studioToast(`Instanced ×${positions.length}`, 'ok');
    return { ok: true, uuid: im.uuid, count: positions.length };
  };
  window.__studioScatterInstances = (count, radius) => {
    const n = Math.max(1, Math.min(20000, Math.floor(count || 50)));
    const r = Math.max(0.001, Number(radius) || 0.3);
    const positions = [];
    for (let i = 0; i < n; i++) {
      positions.push([
        (Math.random() - 0.5) * 2 * r,
        0,
        (Math.random() - 0.5) * 2 * r,
      ]);
    }
    return window.__studioInstanceFromSelection(positions, 1);
  };

  // Slice 605 — Sky gradient background. Builds a 1×64 DataTexture from
  // a linear lerp between top + bottom hex colours and mounts it as the
  // scene.background. EquirectangularReflectionMapping makes it tile
  // around the dome instead of acting as a plane.
  window.__studioSetSkyGradient = (topHex, bottomHex) => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.scene) return { ok: false };
    const top = new THREE.Color(topHex || '#1a2438');
    const bot = new THREE.Color(bottomHex || '#0d1117');
    const H = 64;
    const data = new Uint8Array(H * 4);
    for (let i = 0; i < H; i++) {
      const t = 1 - i / (H - 1);
      data[i * 4    ] = Math.round((top.r * t + bot.r * (1 - t)) * 255);
      data[i * 4 + 1] = Math.round((top.g * t + bot.g * (1 - t)) * 255);
      data[i * 4 + 2] = Math.round((top.b * t + bot.b * (1 - t)) * 255);
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, 1, H, THREE.RGBAFormat);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    vp.scene.background = tex;
    return { ok: true, top: '#' + top.getHexString(), bottom: '#' + bot.getHexString() };
  };
  window.__studioClearSkyGradient = (color) => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.scene) return { ok: false };
    vp.scene.background = new THREE.Color(color || '#0d1117');
    return { ok: true };
  };

  // Slice 604 — Fog control. Linear fog for now (Three.Fog); exponential
  // fog could land in a follow-up.
  window.__studioSetFog = (color, near, far) => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.scene) return { ok: false };
    if (near == null && far == null && color == null) {
      vp.scene.fog = null;
      return { ok: true, on: false };
    }
    vp.scene.fog = new THREE.Fog(color || 0x0d1117, near || 0.5, far || 5);
    return { ok: true, on: true, color: '#' + vp.scene.fog.color.getHexString(), near: vp.scene.fog.near, far: vp.scene.fog.far };
  };
  window.__studioGetFog = () => {
    const vp = window.__archdiscViewport;
    const f = vp && vp.scene && vp.scene.fog;
    if (!f) return null;
    return { color: '#' + f.color.getHexString(), near: f.near, far: f.far };
  };

  // Slice 603 — Renderer tone mapping + exposure. Surfaces three's
  // ACESFilmic / Linear / Reinhard / Cineon / Neutral modes and an
  // exposure multiplier. Drives composition-style colour grading.
  const TONE_MAPS = {
    none:    THREE.NoToneMapping,
    linear:  THREE.LinearToneMapping,
    reinhard: THREE.ReinhardToneMapping,
    cineon:  THREE.CineonToneMapping,
    aces:    THREE.ACESFilmicToneMapping,
    neutral: THREE.NeutralToneMapping || THREE.AgXToneMapping || THREE.ACESFilmicToneMapping,
  };
  window.__studioListToneMappings = () => Object.keys(TONE_MAPS);
  window.__studioSetToneMapping = (name) => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.renderer) return { ok: false };
    const t = TONE_MAPS[name];
    if (t == null) return { ok: false, error: 'bad name' };
    vp.renderer.toneMapping = t;
    return { ok: true, name };
  };
  window.__studioSetExposure = (v) => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.renderer) return { ok: false };
    vp.renderer.toneMappingExposure = Math.max(0, Math.min(8, Number(v) || 1));
    return { ok: true, exposure: vp.renderer.toneMappingExposure };
  };
  window.__studioGetExposure = () => {
    const vp = window.__archdiscViewport;
    return vp && vp.renderer ? vp.renderer.toneMappingExposure : 1;
  };

  // Slice 602 — Apply an image data-URL as the active material's
  // normalMap. PBR rendering uses it to perturb shading normals.
  window.__studioApplyNormalMap = (dataUrl, name) => new Promise((resolve) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) { resolve({ ok: false, error: 'no selection' }); return; }
    const mat = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    if (!mat) { resolve({ ok: false, error: 'no material' }); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      tex.name = name || 'normal';
      mat.normalMap = tex;
      mat.needsUpdate = true;
      if (window.__studioToast) window.__studioToast(`Normal map applied (${img.width}×${img.height})`, 'ok');
      resolve({ ok: true, width: img.width, height: img.height });
    };
    img.onerror = () => resolve({ ok: false, error: 'image load failed' });
    img.src = dataUrl;
  });

  // Slice 601 — Apply an image data-URL as the active material's base
  // colour map. Switches material to vertexColors off + map on.
  window.__studioApplyTextureMap = (dataUrl, name) => new Promise((resolve) => {
    const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!sel) { resolve({ ok: false, error: 'no selection' }); return; }
    const mat = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    if (!mat) { resolve({ ok: false, error: 'no material' }); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      tex.name = name || 'tex';
      mat.map = tex;
      mat.vertexColors = false;
      mat.needsUpdate = true;
      if (window.__studioToast) window.__studioToast(`Texture applied (${img.width}×${img.height})`, 'ok');
      resolve({ ok: true, width: img.width, height: img.height });
    };
    img.onerror = () => resolve({ ok: false, error: 'image load failed' });
    img.src = dataUrl;
  });

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
