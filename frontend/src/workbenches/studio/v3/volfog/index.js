// ArchDisc Studio V3 — slice 920 — REAL volumetric fog ShaderPass.
//
// The slice-825 stub (replaced by this file) did "volumetric" fog by
// setting `scene.fog = new THREE.FogExp2(...)` — which is a per-fragment
// distance lerp the GPU applies to every fragment shader, not a march.
// That gave nothing close to the look of a real volume: no anisotropic
// scattering, no light shafts, no Henyey-Greenstein silver lining toward
// the sun, no in-scattering term.
//
// Slice 920 replaces that with a true screen-space ray-march ShaderPass
// (volFogShader.js carries the GLSL). Per pixel:
//
//   1. Sample the depth-texture from the aux depth RT.
//   2. Reconstruct the world-space surface position behind the pixel via
//      inv(projection * view) — the same matrix the GPU path tracer uses.
//   3. March from the camera origin to that surface in 32 constant-length
//      steps, sampling an exponential height-falloff density at each.
//   4. At each step add: density × phaseHG(cosθ_view_sun, g) × sunLight,
//      plus ambient × softened-HG × multiScatter.
//   5. Accumulate Beer-Lambert transmittance and use it to attenuate the
//      original scene colour. The combined formula is the standard
//      volumetric rendering integral.
//
// Wired as a ShaderPass between the RenderPass and the OutputPass, exactly
// like the EEVEE SSGI / SSR / bloom / FXAA passes elsewhere in api.js. We
// reuse the aux depth-buffer pattern from v3/eevee/passes.js so we don't
// duplicate render-target machinery.
//
// Ops (unchanged from slice 825, expanded for the runtime stats):
//   __studioVolFogEnable({on, density, color, heightFalloff,
//                        multiScatter, anisotropy})
//   __studioVolFogGetState()  →  { ok, on, density, color, ...,
//                                  stats: {steps, lastMarchMs, ...} }

import * as THREE from 'three';

import { registerOps } from '../common/registry.js';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';
import { VOL_FOG_VERTEX, VOL_FOG_FRAGMENT } from './volFogShader.js';

// ── module state ─────────────────────────────────────────────────────────

let _installed = false;

// Config defaults — chosen to match the slice-825 stub so any downstream
// code that polled `getState()` for {density, color, …} keeps working.
let _state = {
  on: false,
  density: 0.05,
  color: [0.5, 0.6, 0.7],
  heightFalloff: 0.5,
  multiScatter: 0.4,
  anisotropy: 0.3,
};

// Runtime context: pass, composer reference, aux depth-only target,
// per-frame uniforms cache. Created lazily on the first enable.
const _ctx = {
  pass: null,
  composer: null,
  ownsComposer: false,
  depthRT: null,
  width: 0,
  height: 0,
  tickInstalled: false,
  framesRendered: 0,
  lastBuildMs: 0,
};

// ── viewport / renderer helpers (shared pattern with v3/eevee/) ──────────

function _viewport() {
  return (typeof window !== 'undefined') ? window.__archdiscViewport : null;
}
function _renderer() { const vp = _viewport(); return vp && vp.renderer; }
function _scene()    {
  const vp = _viewport();
  return (vp && vp.scene) || (typeof window !== 'undefined' ? window.__archdiscScene : null);
}
function _camera()   { const vp = _viewport(); return vp && vp.camera; }
function _composer() { const vp = _viewport(); return vp && vp.__studioComposer; }

function _canvasSize() {
  const r = _renderer();
  if (!r || !r.domElement) return { w: 1, h: 1 };
  const w = Math.max(1, Math.floor(r.domElement.clientWidth || r.domElement.width || 1));
  const h = Math.max(1, Math.floor(r.domElement.clientHeight || r.domElement.height || 1));
  return { w, h };
}

// ── depth buffer (reused even when EEVEE's aux buffer doesn't exist) ─────

function _createDepthRT(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.depthTexture = new THREE.DepthTexture(w, h);
  rt.depthTexture.format = THREE.DepthFormat;
  rt.depthTexture.type = THREE.UnsignedShortType;
  return rt;
}

function _resizeDepthRT(rt, w, h) {
  if (!rt) return false;
  if (rt.width === w && rt.height === h) return false;
  rt.setSize(w, h);
  if (rt.depthTexture) {
    rt.depthTexture.image = { width: w, height: h };
    rt.depthTexture.needsUpdate = true;
  }
  return true;
}

// Render the scene depth-only into the aux depth RT. Saves + restores
// renderer state so the host composer.render() keeps working untouched.
function _renderDepth(renderer, scene, camera, depthRT) {
  if (!renderer || !scene || !camera || !depthRT) return;
  const prevTarget = renderer.getRenderTarget();
  const prevAuto   = renderer.autoClear;
  const prevClear  = new THREE.Color();
  const prevAlpha  = renderer.getClearAlpha();
  renderer.getClearColor(prevClear);

  renderer.setRenderTarget(depthRT);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  renderer.render(scene, camera);

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
}

// ── sun light discovery ──────────────────────────────────────────────────
//
// Pull the brightest DirectionalLight in the scene. Matches the lookup
// rt/pathtracer.js + restir/restirSampler.js use so the fog scatters
// along the same sun the rest of the engine treats as "the sun".
function _findSun(scene) {
  if (!scene || !scene.traverse) return null;
  let best = null;
  let bestIntensity = -1;
  scene.traverse((o) => {
    if (!o || !o.isDirectionalLight) return;
    if (o.visible === false) return;
    const I = o.intensity || 0;
    if (I > bestIntensity) {
      best = o;
      bestIntensity = I;
    }
  });
  return best;
}

// ── ShaderPass build ─────────────────────────────────────────────────────

async function _ensureComposer() {
  const vp = _viewport();
  if (!vp) return null;
  if (vp.__studioComposer) return vp.__studioComposer;
  const r = _renderer();
  const s = _scene();
  const c = _camera();
  if (!r || !s || !c) return null;
  const [composerMod, renderMod, outputMod] = await Promise.all([
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js'),
  ]);
  const composer = new composerMod.EffectComposer(r);
  composer.addPass(new renderMod.RenderPass(s, c));
  composer.addPass(new outputMod.OutputPass());
  const { w, h } = _canvasSize();
  composer.setSize(w, h);
  vp.__studioComposer = composer;
  _ctx.ownsComposer = true;
  _ctx.composer = composer;
  return composer;
}

async function _buildPass() {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { ShaderPass } = await import('three/examples/jsm/postprocessing/ShaderPass.js');
  const { w, h } = _canvasSize();
  if (!_ctx.depthRT) _ctx.depthRT = _createDepthRT(w, h);
  _ctx.width = w;
  _ctx.height = h;

  const shader = {
    uniforms: {
      tDiffuse:        { value: null },
      tDepth:          { value: _ctx.depthRT.depthTexture },
      uInvViewProj:    { value: new THREE.Matrix4() },
      uCameraPos:      { value: new THREE.Vector3() },
      uCameraNear:     { value: 0.1 },
      uCameraFar:      { value: 1000.0 },
      uSunDir:         { value: new THREE.Vector3(0.0, 1.0, 0.0) },
      uSunColor:       { value: new THREE.Vector3(1.0, 0.95, 0.85) },
      uAmbient:        { value: new THREE.Vector3(0.15, 0.18, 0.22) },
      uFogColor:       { value: new THREE.Vector3(..._state.color) },
      uDensity:        { value: _state.density },
      uHeightFalloff:  { value: _state.heightFalloff },
      uFogBaseY:       { value: 0.0 },
      uAnisotropy:     { value: _state.anisotropy },
      uMultiScatter:   { value: _state.multiScatter },
      uMaxDistance:    { value: 1000.0 },
      uFrameSeed:      { value: Math.random() },
    },
    vertexShader:   VOL_FOG_VERTEX,
    fragmentShader: VOL_FOG_FRAGMENT,
  };
  const pass = new ShaderPass(shader);
  pass.needsSwap = true;
  pass.__volFog = true;
  _ctx.pass = pass;
  _ctx.lastBuildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return pass;
}

// Update camera uniforms (matrices, near/far), sun light, and uFogColor.
// Called every frame from the tick.
const _tmpInvVP = new THREE.Matrix4();
const _tmpSunDir = new THREE.Vector3();

function _updateUniforms() {
  const pass = _ctx.pass;
  const camera = _camera();
  const scene = _scene();
  if (!pass || !camera || !scene) return;
  const U = pass.material.uniforms;

  camera.updateMatrixWorld(true);
  if (camera.matrixWorldInverse) {
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  }
  _tmpInvVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
  U.uInvViewProj.value.copy(_tmpInvVP);
  U.uCameraPos.value.copy(camera.position);
  U.uCameraNear.value = camera.near != null ? camera.near : 0.1;
  U.uCameraFar.value = camera.far != null ? camera.far : 1000.0;
  U.uMaxDistance.value = Math.min(U.uCameraFar.value, 2000.0);

  const sun = _findSun(scene);
  if (sun) {
    // three.js DirectionalLight shines from position TOWARD target. The
    // "direction toward the sun from any lit point" is the opposite —
    // (position - target).normalize(). Same convention as pathtracer.js.
    if (sun.target && sun.target.isObject3D) {
      _tmpSunDir.subVectors(sun.position, sun.target.position).normalize();
    } else {
      _tmpSunDir.copy(sun.position).normalize();
    }
    U.uSunDir.value.copy(_tmpSunDir);
    const i = sun.intensity || 1.0;
    U.uSunColor.value.set(sun.color.r * i, sun.color.g * i, sun.color.b * i);
  } else {
    // Sensible top-down default if the scene has no directional light.
    U.uSunDir.value.set(0.3, 0.9, 0.2).normalize();
    U.uSunColor.value.set(1.0, 0.95, 0.85);
  }

  // Ambient: cheap probe from scene.environment intensity or a static
  // value. We re-pull from the scene each frame so day/night cycle (slice
  // 826) reaching into scene.fog colour / environment changes flow into
  // the fog too.
  const env = scene.background;
  if (env && env.isColor) {
    U.uAmbient.value.set(env.r * 0.35, env.g * 0.35, env.b * 0.35);
  } else {
    U.uAmbient.value.set(0.15, 0.18, 0.22);
  }

  // Push the user-tunable state into the uniforms each frame too so
  // __studioVolFogEnable({...}) takes effect immediately without a
  // pass rebuild.
  U.uFogColor.value.set(_state.color[0], _state.color[1], _state.color[2]);
  U.uDensity.value = _state.density;
  U.uHeightFalloff.value = _state.heightFalloff;
  U.uAnisotropy.value = Math.max(-0.95, Math.min(0.95, _state.anisotropy));
  U.uMultiScatter.value = Math.max(0.0, Math.min(1.0, _state.multiScatter));
  U.uFrameSeed.value = Math.random();
}

// ── tick: depth-render + uniform refresh + resize ────────────────────────

function _installTick() {
  if (_ctx.tickInstalled) return true;
  const ok = chainIntoAnimTick('volfog', () => {
    if (!_state.on || !_ctx.pass) return;
    try {
      const { w, h } = _canvasSize();
      if (_resizeDepthRT(_ctx.depthRT, w, h)) {
        _ctx.width = w;
        _ctx.height = h;
        if (_ctx.composer) {
          try { _ctx.composer.setSize(w, h); } catch (_) {}
        }
      }
      _renderDepth(_renderer(), _scene(), _camera(), _ctx.depthRT);
      _updateUniforms();
      _ctx.framesRendered++;
    } catch (_) {
      // Never blow up the host loop.
    }
  });
  if (!ok || !ok.ok) return false;
  _ctx.tickInstalled = true;
  return true;
}

function _uninstallTick() {
  if (!_ctx.tickInstalled) return;
  unchainFromAnimTick('volfog');
  _ctx.tickInstalled = false;
}

// Insert just before the terminal OutputPass — same convention as the
// EEVEE renderer.
function _insertBeforeOutput(composer, pass) {
  if (!composer || !pass) return;
  const passes = composer.passes;
  const insertAt = Math.max(0, passes.length - 1);
  composer.insertPass(pass, insertAt);
}

// ── enable / disable ─────────────────────────────────────────────────────

async function _enable() {
  const composer = await _ensureComposer();
  if (!composer) return { ok: false, error: 'no composer or viewport' };
  _ctx.composer = composer;
  if (!_ctx.pass) await _buildPass();
  // If pass already inserted (e.g. user toggled off then on), don't re-insert.
  const already = composer.passes && composer.passes.indexOf(_ctx.pass) >= 0;
  if (!already) _insertBeforeOutput(composer, _ctx.pass);
  _installTick();
  return { ok: true, on: true };
}

function _disable() {
  const composer = _composer() || _ctx.composer;
  if (composer && _ctx.pass) {
    try { composer.removePass(_ctx.pass); } catch (_) {}
  }
  _uninstallTick();
  // Tear down composer only if we own it AND nothing else is using it.
  if (_ctx.ownsComposer && composer) {
    const others = (composer.passes || []).filter((p) => {
      if (!p) return false;
      if (p === _ctx.pass) return false;
      if (p.constructor && (p.constructor.name === 'RenderPass'
        || p.constructor.name === 'OutputPass')) return false;
      return true;
    });
    if (others.length === 0) {
      try { composer.dispose && composer.dispose(); } catch (_) {}
      const vp = _viewport();
      if (vp && vp.__studioComposer === composer) vp.__studioComposer = null;
      _ctx.composer = null;
      _ctx.ownsComposer = false;
    }
  }
  return { ok: true, on: false };
}

// ── apply: route a config update to enable/disable + uniform sync ────────

async function _apply() {
  if (_state.on) {
    return _enable();
  }
  return _disable();
}

// ── installer ────────────────────────────────────────────────────────────

export function installVolFog() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioVolFogEnable: async ({ on, density, color, heightFalloff,
                                  multiScatter, anisotropy } = {}) => {
      if (on != null) _state.on = !!on;
      if (density != null) _state.density = Number(density);
      if (color && color.length >= 3) _state.color = [color[0], color[1], color[2]];
      if (heightFalloff != null) _state.heightFalloff = Number(heightFalloff);
      if (multiScatter != null) _state.multiScatter = Number(multiScatter);
      if (anisotropy != null) _state.anisotropy = Number(anisotropy);
      return _apply();
    },
    __studioVolFogGetState: () => ({
      ok: true,
      on: _state.on,
      density: _state.density,
      color: _state.color.slice(),
      heightFalloff: _state.heightFalloff,
      multiScatter: _state.multiScatter,
      anisotropy: _state.anisotropy,
      stats: {
        steps: 32,
        framesRendered: _ctx.framesRendered,
        lastBuildMs: _ctx.lastBuildMs,
        width: _ctx.width,
        height: _ctx.height,
        hasPass: !!_ctx.pass,
        hasDepthRT: !!_ctx.depthRT,
        composerOwned: !!_ctx.ownsComposer,
      },
    }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt',
    'Volumetric fog (real ShaderPass: HG phase + height-falloff + sun scatter).');
  return { ok: true };
}

export default installVolFog;
