// ArchDisc Studio V3 — volumetric god rays (slice 795 stub → slice 921 real).
//
// Slice 921 replaces the slice-795 config stub with a real screen-space
// radial-blur ShaderPass (Mitchell 2007 / GPU Gems 3 §13) inserted into
// the viewport composer. The shader lives in ./godRaysShader.js and
// composes additively on top of the lit scene each frame:
//
//   final.rgb = base.rgb + clamp(sum_{i=0..N}(scene[i] * decay^i * weight)
//                                * exposure * intensity, 0, clampMax)
//
// Wiring:
//   1. Lazy-import three/ShaderPass + EffectComposer/RenderPass/OutputPass.
//   2. If the host viewport already has a composer, slot the god-rays pass
//      just before the terminal OutputPass. If no composer exists, build
//      one (matches the bootstrap pattern in api.js outline-pass /
//      eevee/renderer.js _ensureComposer).
//   3. Install a __studioAnimTick chain link that recomputes the sun's
//      projected UV every frame from the live camera + lightDir. The
//      pass picks up the new uSunUv automatically on the next render.
//
// Ops:
//   __studioGodRaysEnable({on, lightDir, samples, density})
//   __studioGodRaysSetIntensity({i})
//   __studioGodRaysGetStats()
//
// Module is idempotent: enable→enable→disable→enable each runs cleanly.

import { registerOps } from '../common/registry.js';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';
import { buildGodRaysShader } from './godRaysShader.js';

let _installed = false;

// All runtime state lives in a single closure so re-enable doesn't
// dangling-reference an old pass.
const _state = {
  // user-facing toggles
  on:        false,
  lightDir:  [0.5, 1.0, 0.5],   // world-space sun direction (+up)
  samples:   80,
  density:   0.6,
  intensity: 1.0,
  exposure:  0.18,
  decay:     0.96,
  weight:    0.55,
  clampMax:  1.5,

  // Wiring handles
  pass:           null,
  composer:       null,
  ownsComposer:   false,
  tickInstalled:  false,

  // Per-frame instrumentation surfaced via GetStats.
  lastSunUv:      { x: 0.5, y: 0.7 },
  lastBehind:     false,
  frames:         0,
};

function _viewport() {
  return (typeof window !== 'undefined') ? window.__archdiscViewport : null;
}

function _composerOnViewport() {
  const vp = _viewport();
  return vp && vp.__studioComposer;
}

function _canvasSize() {
  const vp = _viewport();
  if (!vp || !vp.renderer || !vp.renderer.domElement) return { w: 1, h: 1 };
  const dom = vp.renderer.domElement;
  return {
    w: Math.max(1, Math.floor(dom.clientWidth || dom.width || 1)),
    h: Math.max(1, Math.floor(dom.clientHeight || dom.height || 1)),
  };
}

// Build (or reuse) a composer for our pass. Mirrors the bootstrap path
// in eevee/renderer.js and api.js outline-pass so consecutive post-FX
// slices share a single EffectComposer.
async function _ensureComposer() {
  const vp = _viewport();
  if (!vp || !vp.renderer || !vp.scene || !vp.camera) return null;
  if (vp.__studioComposer) {
    _state.composer = vp.__studioComposer;
    return _state.composer;
  }
  const [composerMod, renderMod, outputMod] = await Promise.all([
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js'),
  ]);
  const composer = new composerMod.EffectComposer(vp.renderer);
  composer.addPass(new renderMod.RenderPass(vp.scene, vp.camera));
  composer.addPass(new outputMod.OutputPass());
  const { w, h } = _canvasSize();
  composer.setSize(w, h);
  vp.__studioComposer = composer;
  _state.composer = composer;
  _state.ownsComposer = true;
  return composer;
}

// Insert a pass just before the terminal OutputPass so colour goes
// through the gamma/tone pipeline. Same heuristic eevee/api.js use.
function _insertBeforeOutput(composer, pass) {
  if (!composer || !pass) return;
  const passes = composer.passes || [];
  const insertAt = Math.max(0, passes.length - 1);
  composer.insertPass(pass, insertAt);
}

// Project the world-space sun position (= camera_position + lightDir * R)
// to screen UV. We treat lightDir as a *direction* (normalised), then
// place a virtual sun far enough away that the projection is effectively
// at infinity — same construction Three's DirectionalLight uses for its
// camera helper.
function _computeSunUv() {
  const vp = _viewport();
  if (!vp || !vp.camera) return { uv: { x: -1, y: -1 }, behind: true };
  const cam = vp.camera;
  // Ensure camera matrices are current. The host loop normally calls
  // updateMatrixWorld every frame; we do it defensively so tests / first
  // frame after enable also get a valid projection.
  try { cam.updateMatrixWorld && cam.updateMatrixWorld(true); } catch (_) {}
  try { cam.updateProjectionMatrix && cam.updateProjectionMatrix(); } catch (_) {}

  const [lx, ly, lz] = _state.lightDir;
  // Normalise.
  const len = Math.hypot(lx, ly, lz) || 1;
  const dx = lx / len, dy = ly / len, dz = lz / len;
  // Sun position relative to camera, large radius so projection is stable.
  const R = 1.0e4;
  const camPos = cam.position;
  const sunX = camPos.x + dx * R;
  const sunY = camPos.y + dy * R;
  const sunZ = camPos.z + dz * R;

  // Manual matrix-multiply to avoid pulling in THREE.Vector3 here (keeps
  // this module's hard import surface stable). cam.matrixWorldInverse
  // and cam.projectionMatrix are THREE.Matrix4 with .elements as the
  // column-major float array.
  const v = cam.matrixWorldInverse && cam.matrixWorldInverse.elements;
  const p = cam.projectionMatrix     && cam.projectionMatrix.elements;
  if (!v || !p) return { uv: { x: -1, y: -1 }, behind: true };

  // worldToView
  const vx = v[0]*sunX + v[4]*sunY + v[8] *sunZ + v[12];
  const vy = v[1]*sunX + v[5]*sunY + v[9] *sunZ + v[13];
  const vz = v[2]*sunX + v[6]*sunY + v[10]*sunZ + v[14];
  const vw = v[3]*sunX + v[7]*sunY + v[11]*sunZ + v[15];

  // viewToClip
  const cx = p[0]*vx + p[4]*vy + p[8] *vz + p[12]*vw;
  const cy = p[1]*vx + p[5]*vy + p[9] *vz + p[13]*vw;
  const cz = p[2]*vx + p[6]*vy + p[10]*vz + p[14]*vw;
  const cw = p[3]*vx + p[7]*vy + p[11]*vz + p[15]*vw;

  // Perspective divide. Cull when the sun is behind the camera.
  if (cw === 0) return { uv: { x: -1, y: -1 }, behind: true };
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const ndcZ = cz / cw;
  const behind = (cw < 0) || (ndcZ < -1.0001) || (ndcZ > 1.0001);
  const uvX = ndcX * 0.5 + 0.5;
  const uvY = ndcY * 0.5 + 0.5;
  return { uv: { x: uvX, y: uvY }, behind };
}

async function _ensurePass() {
  if (_state.pass) return _state.pass;
  const [passMod] = await Promise.all([
    import('three/examples/jsm/postprocessing/ShaderPass.js'),
  ]);
  const shader = buildGodRaysShader({
    samples:   _state.samples,
    density:   _state.density,
    intensity: _state.intensity,
    exposure:  _state.exposure,
    decay:     _state.decay,
    weight:    _state.weight,
    clampMax:  _state.clampMax,
  });
  const pass = new passMod.ShaderPass(shader);
  pass.needsSwap = true;
  pass.__godRays = true;   // tag so we can find / dedupe ourselves
  _state.pass = pass;
  return pass;
}

function _installTick() {
  if (_state.tickInstalled) return true;
  const ok = chainIntoAnimTick('godrays', () => {
    if (!_state.on || !_state.pass) return;
    const { uv, behind } = _computeSunUv();
    const u = _state.pass.uniforms;
    if (u && u.uSunUv) {
      // ShaderPass uniforms.value is the plain {x,y} object we set up in
      // makeGodRaysUniforms. THREE will read .x/.y when uploading.
      if (typeof u.uSunUv.value.set === 'function') {
        u.uSunUv.value.set(uv.x, uv.y);
      } else {
        u.uSunUv.value.x = uv.x;
        u.uSunUv.value.y = uv.y;
      }
    }
    _state.lastSunUv = uv;
    _state.lastBehind = behind;
    _state.frames++;
  });
  if (!ok || !ok.ok) return false;
  _state.tickInstalled = true;
  return true;
}

function _uninstallTick() {
  if (!_state.tickInstalled) return;
  unchainFromAnimTick('godrays');
  _state.tickInstalled = false;
}

async function _enable() {
  if (_state.on) return { ok: true, on: true, already: true };
  const composer = await _ensureComposer();
  if (!composer) {
    return { ok: false, error: 'no viewport or composer' };
  }
  const pass = await _ensurePass();
  // Avoid duplicate insertion if user toggles twice with the composer
  // already holding our pass (e.g. after disable left the pass in).
  if (!composer.passes.includes(pass)) {
    _insertBeforeOutput(composer, pass);
  }
  _state.on = true;
  _installTick();
  return { ok: true, on: true };
}

function _disable() {
  if (!_state.on) return { ok: true, on: false };
  const composer = _state.composer || _composerOnViewport();
  if (composer && _state.pass) {
    try { composer.removePass(_state.pass); } catch (_) {}
  }
  _state.on = false;
  _uninstallTick();
  // Best-effort composer cleanup if we built it ourselves and nothing
  // else hangs off it. Mirrors eevee/renderer.js _maybeTeardownAux.
  if (_state.ownsComposer && composer) {
    const other = (composer.passes || []).filter((p) => {
      if (!p) return false;
      if (p.__godRays) return false;
      const cn = p.constructor && p.constructor.name;
      if (cn === 'RenderPass' || cn === 'OutputPass') return false;
      return true;
    });
    if (other.length === 0) {
      try { composer.dispose && composer.dispose(); } catch (_) {}
      const vp = _viewport();
      if (vp && vp.__studioComposer === composer) vp.__studioComposer = null;
      _state.composer = null;
      _state.ownsComposer = false;
    }
  }
  return { ok: true, on: false };
}

function _applyShaderUniforms() {
  const p = _state.pass;
  if (!p || !p.uniforms) return;
  const u = p.uniforms;
  if (u.uSamples)   u.uSamples.value   = _state.samples;
  if (u.uDensity)   u.uDensity.value   = _state.density;
  if (u.uIntensity) u.uIntensity.value = _state.intensity;
  if (u.uExposure)  u.uExposure.value  = _state.exposure;
  if (u.uDecay)     u.uDecay.value     = _state.decay;
  if (u.uWeight)    u.uWeight.value    = _state.weight;
  if (u.uClampMax)  u.uClampMax.value  = _state.clampMax;
}

export function installGodRays() {
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioGodRaysEnable: ({ on, lightDir, samples, density } = {}) => {
      if (lightDir && lightDir.length === 3) {
        _state.lightDir = [lightDir[0], lightDir[1], lightDir[2]];
      }
      if (samples != null) {
        const s = Math.max(16, Math.min(160, samples | 0));
        _state.samples = s;
      }
      if (density != null) {
        const d = Math.max(0, Math.min(2, Number(density) || 0));
        _state.density = d;
      }
      // Push freshly chosen settings into the live pass if it exists.
      _applyShaderUniforms();
      if (on === false) {
        return _disable();
      }
      if (on === true || (on == null && !_state.on)) {
        // Default behaviour when called without `on` is to (re-)enable;
        // matches the parity-map description "enable god rays".
        return _enable();
      }
      return { ok: true, on: _state.on, ..._currentState() };
    },
    __studioGodRaysSetIntensity: ({ i = 1 } = {}) => {
      _state.intensity = Math.max(0, Math.min(8, Number(i) || 0));
      _applyShaderUniforms();
      return { ok: true, intensity: _state.intensity };
    },
    __studioGodRaysGetStats: () => ({ ok: true, ..._currentState() }),
  };

  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Volumetric god rays (screen-space radial blur)');
  return { ok: true };
}

function _currentState() {
  return {
    on:        _state.on,
    lightDir:  _state.lightDir.slice(),
    samples:   _state.samples,
    density:   _state.density,
    intensity: _state.intensity,
    exposure:  _state.exposure,
    decay:     _state.decay,
    weight:    _state.weight,
    clampMax:  _state.clampMax,
    sunUv:     { x: _state.lastSunUv.x, y: _state.lastSunUv.y },
    behind:    _state.lastBehind,
    frames:    _state.frames,
    composerPassCount: (_state.composer && _state.composer.passes)
      ? _state.composer.passes.length : 0,
    hasPass:   !!_state.pass,
    ownsComposer: !!_state.ownsComposer,
  };
}

export default installGodRays;
