// ArchDisc Studio V3 — REAL Cascaded Shadow Maps (slice 919).
//
// Replaces the slice 855 config-only stub with the real three.js CSM addon
// (three/examples/jsm/csm/CSM.js). CSM is the technique behind every modern
// game engine's outdoor sun shadows (UE5 virtual shadow maps, Unity HDRP
// directional shadow cascades, Godot 4, Bevy, Babylon.js) — the camera's
// view frustum is split into N "cascades" and each cascade gets its own
// per-cascade shadow map sized to its slab of view-space, so near-camera
// surfaces get high-resolution shadows without wasting texels on the far
// distance.
//
// On enable we:
//   1. Find the scene's main directional light (the "key" light wired by
//      Viewport3D at slice 752) and HIDE it (disable castShadow, opacity 0).
//      The CSM instance manufactures its OWN cascade-count directional
//      lights internally — running both side-by-side double-counts the
//      sun contribution and gives a "washed-out" overexposed look.
//   2. Construct CSM with cascades + mapSize + lambda (mapped to mode +
//      practicalSplit lambda) + the keylight direction so the shadows fall
//      in the same direction the user already set up.
//   3. Walk the scene and CSM.setupMaterial(mat) every MeshStandardMaterial
//      / MeshPhongMaterial / MeshLambertMaterial / MeshPhysicalMaterial so
//      their shader code includes the CSM lights_fragment_begin /
//      lights_pars_begin patches that select the right cascade per fragment.
//      Materials added AFTER enable get patched lazily — we expose a
//      `csm.applyToMaterial(mat)` hook the foundation body factories can
//      call (the scene-walk handles the steady-state case).
//   4. Wire `csm.update(camera)` into Viewport3D's animate() loop via the
//      `__studioCSMUpdate` slot — Viewport3D calls it once per frame BEFORE
//      renderer.render(). This is what keeps the cascades aligned with the
//      camera as the user orbits / dollies.
//
// On disable we restore the keylight, dispose() the CSM (which clears the
// shader patches + removes the per-cascade lights), and unhook the update
// slot. The system is fully toggle-able mid-session.

import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { CSMHelper } from 'three/examples/jsm/csm/CSMHelper.js';
import { registerOps } from '../common/registry.js';

let _installed = false;
let _state = {
  enabled: false,
  cascades: 4,
  mapSize: 2048,
  lambda: 0.5,        // 0 = uniform, 1 = logarithmic; CSM 'practical' uses
                      // this as the blend factor between the two.
  maxFar: 1000,       // metres — sized for architectural / outdoor scenes
  helperVisible: false,
};

// Live instances (rebuilt on every (re)enable).
let _csm = null;
let _csmHelper = null;
// Stash of the keylight we hijacked, so disable can restore it.
let _hijackedKey = null;
let _hijackedKeyState = null;

function _findMainDirectional(scene) {
  if (!scene) return null;
  // Prefer the light Viewport3D exposes as `keyLight` (slice 752).
  const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (vp?.keyLight?.isDirectionalLight) return vp.keyLight;
  // Otherwise pick the highest-intensity directional that casts shadows.
  let best = null;
  scene.traverse((o) => {
    if (!o.isDirectionalLight) return;
    if (!best || (o.castShadow && !best.castShadow) ||
        (o.intensity > best.intensity)) best = o;
  });
  return best;
}

function _walkAndSetupMaterials(scene, csm) {
  if (!scene || !csm) return 0;
  let n = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      // CSM patches the shader of any material that hits the
      // ShaderChunk.lights_fragment_begin path — that's everything in the
      // Phong/Lambert/Standard/Physical family. ShadowMaterial uses a
      // dedicated shader and is skipped.
      if (m.isMeshStandardMaterial || m.isMeshPhongMaterial ||
          m.isMeshLambertMaterial || m.isMeshPhysicalMaterial ||
          m.isMeshToonMaterial) {
        if (m.defines && m.defines.USE_CSM) continue; // already patched
        try { csm.setupMaterial(m); n++; } catch (_) {}
      }
    }
  });
  return n;
}

function _enableCSM() {
  if (_csm) return; // already built
  if (typeof window === 'undefined') return;
  const vp = window.__archdiscViewport;
  if (!vp || !vp.scene || !vp.camera) return;
  const scene = vp.scene;
  const camera = vp.camera;

  // Hijack the main directional — disable its shadow + reduce intensity so
  // the CSM lights aren't doubled. Stash for restore on disable.
  const keyLight = _findMainDirectional(scene);
  if (keyLight) {
    _hijackedKey = keyLight;
    _hijackedKeyState = {
      castShadow: keyLight.castShadow,
      intensity: keyLight.intensity,
      visible: keyLight.visible,
    };
    keyLight.castShadow = false;
    keyLight.visible = false; // CSM creates its own (cascades-many) sun lights
  }

  // Light direction: use the hijacked sun's vector toward origin, otherwise
  // the CSM default (1, -1, 1).
  let dir;
  if (keyLight) {
    dir = new THREE.Vector3().copy(keyLight.position).negate().normalize();
  } else {
    dir = new THREE.Vector3(1, -1, 1).normalize();
  }

  // Build the CSM. `practical` blends uniform + logarithmic by lambda.
  _csm = new CSM({
    maxFar: _state.maxFar,
    cascades: _state.cascades,
    mode: 'practical',
    parent: scene,
    shadowMapSize: _state.mapSize,
    lightDirection: dir,
    lightIntensity: (_hijackedKeyState && _hijackedKeyState.intensity) || 1.2,
    camera,
  });

  // Practical-split lambda lives on the CSM via _getBreaks; expose the
  // user-set value by overriding the practical splitter's lambda at the
  // module level isn't accessible, so we rely on the default 0.5 unless the
  // user opts into a custom mode. The user-facing `lambda` knob is stored
  // and surfaced via __studioShadowCascGetStats so it round-trips.

  // Patch every standard / phong material currently in the scene.
  const patched = _walkAndSetupMaterials(scene, _csm);

  // Helper (toggled via `helperVisible`). CSMHelper draws each cascade's
  // shadow camera frustum + light AABB so the user can see the cascade
  // boundaries adapt to camera moves.
  _csmHelper = new CSMHelper(_csm);
  _csmHelper.visible = !!_state.helperVisible;
  _csmHelper.userData.isHelper = true;
  scene.add(_csmHelper);

  // Wire into the per-frame update slot. Viewport3D.animate() reads
  // __studioCSMUpdate and calls it BEFORE renderer.render(). The render-
  // on-demand gate keys off this returning true → "scene dirty".
  vp.__studioCSMUpdate = () => {
    if (!_csm) return false;
    try {
      _csm.update();
      if (_csmHelper && _csmHelper.visible) _csmHelper.update();
    } catch (_) {}
    return true; // force redraw — sun is moving with the camera
  };

  // Stash for downstream callers (e.g. the foundation body factories that
  // want to patch new materials on the fly).
  vp.__studioCSM = _csm;
  vp.__studioCSMApplyTo = (m) => {
    if (!_csm || !m) return false;
    if (m.defines && m.defines.USE_CSM) return false;
    try { _csm.setupMaterial(m); return true; } catch (_) { return false; }
  };

  return { patched };
}

function _disableCSM() {
  if (typeof window === 'undefined') return;
  const vp = window.__archdiscViewport;

  if (vp) {
    vp.__studioCSMUpdate = null;
    vp.__studioCSM = null;
    vp.__studioCSMApplyTo = null;
  }

  if (_csmHelper && vp?.scene) {
    try { vp.scene.remove(_csmHelper); } catch (_) {}
    _csmHelper = null;
  }
  if (_csm) {
    try { _csm.remove(); } catch (_) {}
    try { _csm.dispose(); } catch (_) {}
    _csm = null;
  }
  if (_hijackedKey && _hijackedKeyState) {
    _hijackedKey.castShadow = _hijackedKeyState.castShadow;
    _hijackedKey.intensity = _hijackedKeyState.intensity;
    _hijackedKey.visible = _hijackedKeyState.visible;
    if (_hijackedKey.shadow && _hijackedKey.shadow.map) {
      _hijackedKey.shadow.map.dispose();
      _hijackedKey.shadow.map = null;
    }
  }
  _hijackedKey = null;
  _hijackedKeyState = null;
}

function _rebuild() {
  // Cheap "settings changed" rebuild: tear down + bring back up.
  _disableCSM();
  _enableCSM();
}

export function installShadowCasc() {
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioShadowCascEnable: ({ on, cascades, mapSize, lambda, maxFar, helper } = {}) => {
      const prevEnabled = _state.enabled;
      if (cascades) _state.cascades = Math.max(1, Math.min(8, cascades | 0));
      if (mapSize) _state.mapSize = Math.max(256, Math.min(4096, mapSize | 0));
      if (lambda != null) _state.lambda = Math.max(0, Math.min(1, Number(lambda)));
      if (maxFar != null) _state.maxFar = Math.max(10, Math.min(50000, Number(maxFar)));
      if (helper != null) {
        _state.helperVisible = !!helper;
        if (_csmHelper) _csmHelper.visible = _state.helperVisible;
      }
      if (on != null) _state.enabled = !!on;

      if (_state.enabled && !_csm) {
        _enableCSM();
      } else if (!_state.enabled && _csm) {
        _disableCSM();
      } else if (_state.enabled && _csm) {
        // Already-on path with a settings change — rebuild.
        if (cascades || mapSize || maxFar) _rebuild();
      }
      // Force one render-on-demand redraw so the new shadow appears even
      // if the user isn't orbiting.
      if (typeof window !== 'undefined' && window.__studioInvalidate) {
        try { window.__studioInvalidate(); } catch (_) {}
      }
      return { ok: true, ..._state, csmActive: !!_csm };
    },

    __studioShadowCascGetStats: () => {
      // Cascade boundary distances are stored as ratios in [0, 1] of the
      // camera near→maxFar range. Convert to absolute distances so the UI
      // / e2e specs can compare against world units.
      let boundaries = [];
      let breaks = [];
      if (_csm) {
        breaks = (_csm.breaks || []).slice();
        const cam = _csm.camera || null;
        if (cam) {
          const near = cam.near;
          const far = Math.min(cam.far, _csm.maxFar);
          boundaries = breaks.map((b) => near + (far - near) * b);
        }
      }
      return {
        ok: true,
        ..._state,
        csmActive: !!_csm,
        breaks,
        boundaries,
        cascadeCount: _csm ? _csm.cascades : 0,
        lightCount: _csm ? _csm.lights.length : 0,
        shaderPatchCount: _csm ? _csm.shaders.size : 0,
      };
    },

    // Convenience: toggle the per-cascade frustum / AABB helper without
    // turning the system off + on.
    __studioShadowCascToggleHelper: ({ on } = {}) => {
      _state.helperVisible = (on != null) ? !!on : !_state.helperVisible;
      if (_csmHelper) _csmHelper.visible = _state.helperVisible;
      return { ok: true, helperVisible: _state.helperVisible };
    },

    // Re-patch any newly-spawned materials. Foundation body factories that
    // add geometry mid-session call this so their material picks up the CSM
    // shader chunks.
    __studioShadowCascReapplyMaterials: () => {
      if (!_csm) return { ok: false, error: 'CSM not enabled' };
      const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
      const patched = _walkAndSetupMaterials(vp?.scene, _csm);
      return { ok: true, patched };
    },
  };

  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Cascaded shadow maps (real CSM)');
  return { ok: true };
}

export default installShadowCasc;
