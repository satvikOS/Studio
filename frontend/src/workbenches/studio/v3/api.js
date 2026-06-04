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

  // Slice 633 — Hand-rolled rigid body sim: every body is a sphere
  // anchored to a mesh's centre. Collides with y=0 ground and other
  // bodies using simple penetration resolution + bounce.
  if (!window.__studioPhysicsState) {
    window.__studioPhysicsState = {
      bodies: [],
      gravity: -9.81,
      playing: false,
      lastTickMs: 0,
      groundY: 0,
    };
  }
  const _phys = window.__studioPhysicsState;

  window.__studioPhysicsInit = () => {
    _phys.bodies = []; _phys.playing = false;
    return { ok: true };
  };

  window.__studioPhysicsAddBody = (uuid, mass, restitution) => {
    const scene = window.__archdiscScene; if (!scene) return { ok: false };
    const mesh = scene.getObjectByProperty('uuid', uuid);
    if (!mesh || !mesh.isMesh) return { ok: false, error: 'mesh not found' };
    mesh.geometry.computeBoundingSphere();
    const r = (mesh.geometry.boundingSphere && mesh.geometry.boundingSphere.radius) || 0.5;
    _phys.bodies.push({
      uuid, mesh,
      mass: Math.max(0.001, Number(mass) || 1),
      r: r * Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z),
      vx: 0, vy: 0, vz: 0,
      e: Math.max(0, Math.min(1, Number(restitution) ?? 0.5)),
      x0: mesh.position.x, y0: mesh.position.y, z0: mesh.position.z,
    });
    return { ok: true, bodyCount: _phys.bodies.length, radius: r };
  };

  window.__studioPhysicsSetGravity = (g) => {
    _phys.gravity = Number(g);
    return { ok: true, gravity: _phys.gravity };
  };

  window.__studioPhysicsStep = (dt) => {
    const step = Math.min(0.05, Number(dt) || 0.016);
    for (const b of _phys.bodies) {
      b.vy += _phys.gravity * step;
      b.mesh.position.x += b.vx * step;
      b.mesh.position.y += b.vy * step;
      b.mesh.position.z += b.vz * step;
      // ground collide
      if (b.mesh.position.y - b.r < _phys.groundY) {
        b.mesh.position.y = _phys.groundY + b.r;
        if (b.vy < 0) b.vy = -b.vy * b.e;
        b.vx *= (1 - 0.05);
        b.vz *= (1 - 0.05);
      }
    }
    // pair-wise collide
    for (let i = 0; i < _phys.bodies.length; i++) {
      for (let j = i + 1; j < _phys.bodies.length; j++) {
        const a = _phys.bodies[i], b = _phys.bodies[j];
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dy = b.mesh.position.y - a.mesh.position.y;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const min = a.r + b.r;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d, nz = dz / d;
          const pen = (min - d) * 0.5;
          a.mesh.position.x -= nx * pen; a.mesh.position.y -= ny * pen; a.mesh.position.z -= nz * pen;
          b.mesh.position.x += nx * pen; b.mesh.position.y += ny * pen; b.mesh.position.z += nz * pen;
          // exchange velocity along normal (elastic-ish)
          const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
          if (vrel < 0) {
            const e = Math.min(a.e, b.e);
            const m1 = a.mass, m2 = b.mass;
            const J = -(1 + e) * vrel / (1 / m1 + 1 / m2);
            const jx = J * nx, jy = J * ny, jz = J * nz;
            a.vx -= jx / m1; a.vy -= jy / m1; a.vz -= jz / m1;
            b.vx += jx / m2; b.vy += jy / m2; b.vz += jz / m2;
          }
        }
      }
    }
    return { ok: true, bodies: _phys.bodies.length };
  };

  window.__studioPhysicsTogglePlay = () => {
    const v = window.__archdiscViewport; if (!v) return { ok: false };
    _phys.playing = !_phys.playing;
    if (_phys.playing) {
      _phys.lastTickMs = performance.now();
      const prev = v.__studioAnimTick;
      const chained = (now) => {
        if (_phys.playing) {
          const d = Math.min(0.05, (now - _phys.lastTickMs) / 1000);
          _phys.lastTickMs = now;
          window.__studioPhysicsStep(d);
        }
        if (prev) prev(now);
      };
      chained.__phys = true; chained.__prev = prev;
      v.__studioAnimTick = chained;
    }
    return { ok: true, playing: _phys.playing };
  };

  window.__studioPhysicsReset = () => {
    for (const b of _phys.bodies) {
      b.mesh.position.set(b.x0, b.y0, b.z0);
      b.vx = b.vy = b.vz = 0;
    }
    return { ok: true, bodies: _phys.bodies.length };
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
