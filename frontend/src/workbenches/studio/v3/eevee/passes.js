// ArchDisc Studio V3 — EEVEE-style SSGI + SSR ShaderPass wrappers.
//
// Two thin builders on top of three's ShaderPass:
//
//   createSSGIPass({ depthRT, normalRT, resolution, intensity, radius })
//   createSSRPass ({ depthRT, normalRT, resolution, maxDistance, step,
//                    intensity, steps })
//
// Both passes read from the composer's read buffer for `tDiffuse` (so
// whatever the previous pass produced becomes the base colour) and from
// the supplied depth + normal render targets for the geometric info.
//
// In addition this module owns `createAuxBuffers()` which builds the
// per-frame depth + normal targets, plus `renderAuxBuffers()` which
// pre-renders the scene to those two RTs ahead of the composer chain.
// Renderer.js calls these from the tick callback we install.

import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import { SSGI_VERTEX, SSGI_FRAGMENT } from './ssgi.frag.js';
import { SSR_VERTEX, SSR_FRAGMENT } from './ssr.frag.js';

// ── ShaderPass uniform shapes ─────────────────────────────────────────────

function _ssgiShader(initial) {
  return {
    uniforms: {
      tDiffuse:    { value: null },
      tDepth:      { value: initial.depthTex },
      tNormal:     { value: initial.normalTex },
      uIntensity:  { value: initial.intensity != null ? initial.intensity : 1.0 },
      uRadius:     { value: initial.radius    != null ? initial.radius    : 0.08 },
      uResolution: { value: new THREE.Vector2(initial.width, initial.height) },
      uFrameSeed:  { value: Math.random() },
    },
    vertexShader:   SSGI_VERTEX,
    fragmentShader: SSGI_FRAGMENT,
  };
}

function _ssrShader(initial) {
  return {
    uniforms: {
      tDiffuse:    { value: null },
      tDepth:      { value: initial.depthTex },
      tNormal:     { value: initial.normalTex },
      uMaxDist:    { value: initial.maxDistance != null ? initial.maxDistance : 0.5 },
      uStep:       { value: initial.step        != null ? initial.step        : 0.02 },
      uIntensity:  { value: initial.intensity   != null ? initial.intensity   : 1.0 },
      uResolution: { value: new THREE.Vector2(initial.width, initial.height) },
      uFrameSeed:  { value: Math.random() },
    },
    vertexShader:   SSR_VERTEX,
    fragmentShader: SSR_FRAGMENT,
  };
}

export function createSSGIPass(opts) {
  const shader = _ssgiShader({
    depthTex:  opts.depthRT  ? opts.depthRT.depthTexture || opts.depthRT.texture  : null,
    normalTex: opts.normalRT ? opts.normalRT.texture : null,
    width:     opts.width  || 1,
    height:    opts.height || 1,
    intensity: opts.intensity,
    radius:    opts.radius,
  });
  const pass = new ShaderPass(shader);
  pass.needsSwap = true;
  // Tag so other code (EeveePanel polling, e2e specs) can find this
  // pass back without keeping a private reference.
  pass.__eeveeKind = 'ssgi';
  pass.eeveeUpdateAux = (depthRT, normalRT) => {
    pass.uniforms.tDepth.value  = depthRT  ? depthRT.depthTexture || depthRT.texture  : null;
    pass.uniforms.tNormal.value = normalRT ? normalRT.texture : null;
  };
  pass.eeveeSetResolution = (w, h) => {
    pass.uniforms.uResolution.value.set(w, h);
  };
  pass.eeveeSetIntensity = (v) => {
    pass.uniforms.uIntensity.value = Math.max(0, Math.min(2, Number(v) || 0));
  };
  pass.eeveeSetRadius = (v) => {
    pass.uniforms.uRadius.value = Math.max(0.005, Math.min(0.3, Number(v) || 0.08));
  };
  pass.eeveeBumpSeed = () => {
    pass.uniforms.uFrameSeed.value = Math.random();
  };
  return pass;
}

export function createSSRPass(opts) {
  const shader = _ssrShader({
    depthTex:    opts.depthRT  ? opts.depthRT.depthTexture || opts.depthRT.texture  : null,
    normalTex:   opts.normalRT ? opts.normalRT.texture : null,
    width:       opts.width  || 1,
    height:      opts.height || 1,
    maxDistance: opts.maxDistance,
    step:        opts.step,
    intensity:   opts.intensity,
  });
  const pass = new ShaderPass(shader);
  pass.needsSwap = true;
  pass.__eeveeKind = 'ssr';
  pass.eeveeUpdateAux = (depthRT, normalRT) => {
    pass.uniforms.tDepth.value  = depthRT  ? depthRT.depthTexture || depthRT.texture  : null;
    pass.uniforms.tNormal.value = normalRT ? normalRT.texture : null;
  };
  pass.eeveeSetResolution = (w, h) => {
    pass.uniforms.uResolution.value.set(w, h);
  };
  pass.eeveeSetMaxDistance = (v) => {
    pass.uniforms.uMaxDist.value = Math.max(0.05, Math.min(2.0, Number(v) || 0.5));
  };
  pass.eeveeSetIntensity = (v) => {
    pass.uniforms.uIntensity.value = Math.max(0, Math.min(2, Number(v) || 0));
  };
  pass.eeveeBumpSeed = () => {
    pass.uniforms.uFrameSeed.value = Math.random();
  };
  return pass;
}

// ── Aux buffers (depth + view-space normals) ──────────────────────────────
//
// EffectComposer's read buffer doesn't carry the depth that SSGI/SSR need,
// so we render the scene to a dedicated depth target + a normal target
// each frame using a global MeshNormalMaterial override. Both targets are
// shared between SSGI and SSR.

export function createAuxBuffers(width, height) {
  const W = Math.max(1, Math.floor(width));
  const H = Math.max(1, Math.floor(height));
  // Depth target: colour attachment is a small RGBA8 placeholder; the
  // depth-texture attachment is what the SSGI/SSR shaders actually read.
  const depthRT = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  depthRT.depthTexture = new THREE.DepthTexture(W, H);
  depthRT.depthTexture.format = THREE.DepthFormat;
  depthRT.depthTexture.type = THREE.UnsignedShortType;

  const normalRT = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  const normalMat = new THREE.MeshNormalMaterial();
  return { depthRT, normalRT, normalMat, width: W, height: H };
}

export function resizeAuxBuffers(aux, width, height) {
  const W = Math.max(1, Math.floor(width));
  const H = Math.max(1, Math.floor(height));
  if (W === aux.width && H === aux.height) return false;
  aux.depthRT.setSize(W, H);
  aux.normalRT.setSize(W, H);
  if (aux.depthRT.depthTexture) {
    aux.depthRT.depthTexture.image = { width: W, height: H };
    aux.depthRT.depthTexture.needsUpdate = true;
  }
  aux.width = W;
  aux.height = H;
  return true;
}

export function disposeAuxBuffers(aux) {
  if (!aux) return;
  try { aux.depthRT.dispose(); } catch (_) {}
  try { aux.normalRT.dispose(); } catch (_) {}
  try { aux.normalMat.dispose(); } catch (_) {}
}

// Renders the scene twice into the aux RTs — once depth-only (relies on
// each mesh's own material so depth is correct), once with a
// MeshNormalMaterial override so the colour attachment carries the
// encoded view-space normal.
//
// Saves + restores renderer state so the main viewport render loop
// (or composer) keeps working untouched.
export function renderAuxBuffers(renderer, scene, camera, aux) {
  if (!renderer || !scene || !camera || !aux) return;
  const prevTarget = renderer.getRenderTarget();
  const prevAuto   = renderer.autoClear;
  const prevOverride = scene.overrideMaterial;
  const prevClear = new THREE.Color();
  const prevAlpha = renderer.getClearAlpha();
  renderer.getClearColor(prevClear);

  // ── Depth pass ──
  renderer.setRenderTarget(aux.depthRT);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  scene.overrideMaterial = null;
  renderer.render(scene, camera);

  // ── Normal pass ──
  renderer.setRenderTarget(aux.normalRT);
  renderer.setClearColor(0x808080, 1);
  scene.overrideMaterial = aux.normalMat;
  renderer.render(scene, camera);

  // Restore.
  scene.overrideMaterial = prevOverride;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
}

export default {
  createSSGIPass,
  createSSRPass,
  createAuxBuffers,
  resizeAuxBuffers,
  disposeAuxBuffers,
  renderAuxBuffers,
};
