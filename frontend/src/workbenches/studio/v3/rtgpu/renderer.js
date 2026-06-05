// ArchDisc Studio V3 — GPU path tracer renderer (ping-pong accumulator).
//
// Owns the GPU side of the rtgpu path tracer:
//
//   • Two RGBA32F WebGLRenderTargets (`rtA`, `rtB`) that ping-pong each
//     frame. The path-trace shader samples *from* the previous frame's
//     accumulator and writes the new sum into the other one.
//   • A 2-triangle full-screen quad rendered with `RawShaderMaterial`
//     pointed at PATHSHADER_FRAGMENT.
//   • A second `RawShaderMaterial` (DISPLAY_FRAGMENT) that divides the
//     accumulator's running sum by its sample count, gammas it, and
//     writes the result to a Canvas2D context via WebGL `readPixels`.
//     (We can't blit a WebGL texture straight into a 2D canvas, so
//     we read back the RGBA bytes and `putImageData` them — small
//     overhead for a quarter-res image, and keeps the rt overlay
//     pattern identical to the CPU tracer's overlay.)
//
// Camera-change detection bumps the accumulator generation, zero-fills
// the next ping target, and resets `samplesPerPixel`.
//
// The renderer never owns the host WebGLRenderer — it borrows the one
// the viewport already created. Restoring its state (autoClear, render
// target, etc.) after each pass keeps the main viewport render loop
// healthy.

import * as THREE from 'three';
import {
  PATHSHADER_VERTEX, PATHSHADER_FRAGMENT,
  DISPLAY_VERTEX, DISPLAY_FRAGMENT,
} from './pathshader.frag.js';
import { buildSceneTextures, disposeSceneTextures, MAX_TRIANGLES } from './sceneToTextures.js';

// Probe driver capabilities up-front. WebGL2 + RGBA32F render-target
// support is what makes the accumulator work; if either is missing we
// return `supported:false` and `installRTGPU()` reports the reason via
// __studioRTGPUReady().
export function probeSupport(renderer) {
  if (!renderer) return { supported: false, reason: 'no renderer' };
  const gl = renderer.getContext ? renderer.getContext() : null;
  if (!gl) return { supported: false, reason: 'no GL context' };
  const isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined')
    && (gl instanceof WebGL2RenderingContext);
  if (!isWebGL2) return { supported: false, reason: 'WebGL2 required (GLSL ES 3.0)' };
  // We rely on EXT_color_buffer_float for RGBA32F render targets; the
  // accumulator pass writes Float32 data into the FBO.
  const cbf = gl.getExtension('EXT_color_buffer_float')
    || gl.getExtension('WEBGL_color_buffer_float');
  if (!cbf) return { supported: false, reason: 'EXT_color_buffer_float unavailable' };
  // OES_texture_float_linear is *not* required (we use NEAREST for the
  // accumulator and the scene data tex), so skip that check.
  return { supported: true };
}

const _quadGeom = new THREE.BufferGeometry();
{
  const verts = new Float32Array([
    -1, -1, 0,
     3, -1, 0,
    -1,  3, 0,
  ]);
  _quadGeom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
}

function _makeAccumTarget(width, height) {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

// Owns all GPU resources + the per-frame state of one path-tracer
// session. Construct once via `createRenderer`; call `runFrame()` on
// every viewport tick, `dispose()` on Stop.
export function createRenderer(opts) {
  const renderer = opts.renderer;
  if (!renderer) throw new Error('createRenderer: renderer required');
  // Mutable state — `setSize` + `setPixelStride` rewrite these in place
  // so the rest of the closure (runFrame, _readDisplayPixels) always
  // sees the latest dimensions without going through a getter.
  const state = {
    width:  Math.max(1, opts.width  | 0),
    height: Math.max(1, opts.height | 0),
    pixelStride: Math.max(1, Math.min(16, (opts.pixelStride || 4) | 0)),
  };
  state.traceW = Math.max(1, Math.ceil(state.width / state.pixelStride));
  state.traceH = Math.max(1, Math.ceil(state.height / state.pixelStride));

  // Two ping-pong accumulator targets.
  let rtA = _makeAccumTarget(state.traceW, state.traceH);
  let rtB = _makeAccumTarget(state.traceW, state.traceH);
  let readRT = rtA;
  let writeRT = rtB;

  // Scratch scene + camera for the fullscreen quad pass — keeps the
  // path tracer from polluting the host scene graph.
  const fsScene = new THREE.Scene();
  const fsCamera = new THREE.Camera();

  // Path-trace material.
  const traceMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PATHSHADER_VERTEX,
    fragmentShader: PATHSHADER_FRAGMENT,
    uniforms: {
      uTexPos:          { value: null },
      uTexNrm:          { value: null },
      uTexAlb:          { value: null },
      uTriCount:        { value: 0 },
      uCamPos:          { value: new THREE.Vector3() },
      uCamRight:        { value: new THREE.Vector3(1, 0, 0) },
      uCamUp:           { value: new THREE.Vector3(0, 1, 0) },
      uCamFwd:          { value: new THREE.Vector3(0, 0, -1) },
      uHalfH:           { value: Math.tan((50 * Math.PI / 180) * 0.5) },
      uHalfW:           { value: Math.tan((50 * Math.PI / 180) * 0.5) * (state.traceW / state.traceH) },
      uTexAccum:        { value: null },
      uSampleCount:     { value: 0 },
      uResolution:      { value: new THREE.Vector2(state.traceW, state.traceH) },
      uMaxBounces:      { value: Math.max(1, Math.min(4, (opts.maxBounces || 2) | 0)) },
      uSamplesPerFrame: { value: Math.max(1, Math.min(16, (opts.samplesPerFrame || 1) | 0)) },
      uFrameSeed:       { value: Math.random() },
      uSunDir:          { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor:        { value: new THREE.Vector3(1.0, 0.95, 0.85) },
      uSkyTop:          { value: new THREE.Vector3(0.55, 0.72, 1.0) },
      uSkyBot:          { value: new THREE.Vector3(0.85, 0.75, 0.60) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const traceMesh = new THREE.Mesh(_quadGeom, traceMat);
  traceMesh.frustumCulled = false;
  fsScene.add(traceMesh);

  // Display material — reads the accumulator, divides + gammas, writes
  // an opaque-ish color we can readPixels from for the overlay blit.
  const displayMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: DISPLAY_VERTEX,
    fragmentShader: DISPLAY_FRAGMENT,
    uniforms: {
      uTexAccum: { value: null },
      uExposure: { value: 1.0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  // Display target — RGBA8 so readPixels delivers UNSIGNED_BYTE, which
  // the overlay canvas can consume directly via ImageData.
  let displayRT = new THREE.WebGLRenderTarget(state.traceW, state.traceH, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  let displayPixelBuf = new Uint8Array(state.traceW * state.traceH * 4);

  // Scene textures + tuning state.
  let scenePack = null;
  let samplesPerPixel = 0;
  let cameraHash = 0;

  function _hashCamera(camera) {
    if (!camera) return 0;
    camera.updateMatrixWorld(true);
    const m = camera.matrixWorld.elements;
    const p = camera.projectionMatrix.elements;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < 16; i++) {
      const v = (m[i] * 1e6) | 0;
      h = Math.imul(h ^ (v + 0x9E3779B9), 16777619) >>> 0;
    }
    for (let i = 0; i < 16; i++) {
      const v = (p[i] * 1e6) | 0;
      h = Math.imul(h ^ (v + 0x85EBCA77), 2246822507) >>> 0;
    }
    return h >>> 0;
  }

  function rebuildScene(scene) {
    const next = buildSceneTextures(scene);
    if (scenePack) disposeSceneTextures(scenePack);
    scenePack = next;
    // Push the new textures into the trace material's uniforms.
    traceMat.uniforms.uTexPos.value = scenePack.posTex;
    traceMat.uniforms.uTexNrm.value = scenePack.nrmTex;
    traceMat.uniforms.uTexAlb.value = scenePack.albTex;
    traceMat.uniforms.uTriCount.value = scenePack.triCount;
    traceMat.uniforms.uSunDir.value.fromArray(scenePack.sunDir).normalize();
    traceMat.uniforms.uSunColor.value.fromArray(scenePack.sunColor);
    traceMat.uniforms.uSkyTop.value.fromArray(scenePack.skyTop);
    traceMat.uniforms.uSkyBot.value.fromArray(scenePack.skyBot);
    resetAccumulation();
    return scenePack;
  }

  function _clearTarget(rt) {
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0, 0);
    renderer.autoClear = true;
    renderer.clear(true, false, false);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
  }

  function resetAccumulation() {
    _clearTarget(rtA);
    _clearTarget(rtB);
    samplesPerPixel = 0;
  }

  function _updateCamera(camera) {
    if (!camera) return;
    camera.updateMatrixWorld(true);
    const m = camera.matrixWorld.elements;
    traceMat.uniforms.uCamPos.value.set(m[12], m[13], m[14]);
    traceMat.uniforms.uCamRight.value.set(m[0], m[1], m[2]);
    traceMat.uniforms.uCamUp.value.set(m[4], m[5], m[6]);
    traceMat.uniforms.uCamFwd.value.set(-m[8], -m[9], -m[10]);
    const fov = (camera.fov || 50) * Math.PI / 180;
    const aspect = camera.aspect || (state.traceW / Math.max(1, state.traceH));
    const halfH = Math.tan(fov * 0.5);
    const halfW = halfH * aspect;
    traceMat.uniforms.uHalfH.value = halfH;
    traceMat.uniforms.uHalfW.value = halfW;
  }

  function _renderTracePass() {
    traceMat.uniforms.uTexAccum.value = readRT.texture;
    traceMat.uniforms.uSampleCount.value = samplesPerPixel;
    traceMat.uniforms.uFrameSeed.value = Math.random();
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(writeRT);
    renderer.render(fsScene, fsCamera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    // Swap.
    const tmp = readRT; readRT = writeRT; writeRT = tmp;
    samplesPerPixel += traceMat.uniforms.uSamplesPerFrame.value;
  }

  function _renderDisplayPass() {
    displayMat.uniforms.uTexAccum.value = readRT.texture;
    const prevMat = traceMesh.material;
    traceMesh.material = displayMat;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(displayRT);
    renderer.render(fsScene, fsCamera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    traceMesh.material = prevMat;
  }

  function _readDisplayPixels() {
    // readRenderTargetPixels writes into displayPixelBuf in row-major
    // bottom-up order (WebGL convention). The overlay blit will flip Y.
    try {
      renderer.readRenderTargetPixels(
        displayRT, 0, 0, state.traceW, state.traceH, displayPixelBuf,
      );
    } catch (e) {
      // Some headless drivers reject readPixels — surface zeros and
      // let the overlay show nothing rather than crash the loop.
      displayPixelBuf.fill(0);
    }
  }

  function runFrame(camera) {
    if (!scenePack || scenePack.triCount === 0) return { ok: false, error: 'no scene' };
    if (camera) {
      const h = _hashCamera(camera);
      if (h !== cameraHash) {
        cameraHash = h;
        resetAccumulation();
      }
      _updateCamera(camera);
    }
    _renderTracePass();
    _renderDisplayPass();
    _readDisplayPixels();
    return { ok: true, samples: samplesPerPixel, pixels: displayPixelBuf };
  }

  function setPixelStride(stride) {
    const s = Math.max(1, Math.min(16, stride | 0));
    if (s === state.pixelStride) return;
    state.pixelStride = s;
    const nw = Math.max(1, Math.ceil(state.width / s));
    const nh = Math.max(1, Math.ceil(state.height / s));
    _resize(nw, nh);
  }

  function setSize(newW, newH) {
    state.width = Math.max(1, newW | 0);
    state.height = Math.max(1, newH | 0);
    const nw = Math.max(1, Math.ceil(state.width / state.pixelStride));
    const nh = Math.max(1, Math.ceil(state.height / state.pixelStride));
    _resize(nw, nh);
  }

  function _resize(nw, nh) {
    rtA.dispose(); rtB.dispose(); displayRT.dispose();
    rtA = _makeAccumTarget(nw, nh);
    rtB = _makeAccumTarget(nw, nh);
    readRT = rtA; writeRT = rtB;
    displayRT = new THREE.WebGLRenderTarget(nw, nh, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    state.traceW = nw;
    state.traceH = nh;
    traceMat.uniforms.uResolution.value.set(nw, nh);
    displayPixelBuf = new Uint8Array(nw * nh * 4);
    samplesPerPixel = 0;
  }

  function setMaxBounces(n) {
    const b = Math.max(1, Math.min(4, (n | 0) || 2));
    traceMat.uniforms.uMaxBounces.value = b;
    resetAccumulation();
  }

  function setSamplesPerFrame(n) {
    const s = Math.max(1, Math.min(16, (n | 0) || 1));
    traceMat.uniforms.uSamplesPerFrame.value = s;
  }

  function dispose() {
    try { traceMat.dispose(); } catch (_) {}
    try { displayMat.dispose(); } catch (_) {}
    try { rtA.dispose(); } catch (_) {}
    try { rtB.dispose(); } catch (_) {}
    try { displayRT.dispose(); } catch (_) {}
    if (scenePack) disposeSceneTextures(scenePack);
    scenePack = null;
  }

  const api = {
    // Tweakable state — index.js reads these for status reports.
    // Getters reflect the latest values after _resize() mutates `state`.
    get pixelStride() { return state.pixelStride; },
    get traceW() { return state.traceW; },
    get traceH() { return state.traceH; },
    get displayPixelBuf() { return displayPixelBuf; },
    get samplesPerPixel() { return samplesPerPixel; },
    get triCount() { return scenePack ? scenePack.triCount : 0; },
    get truncated() { return scenePack ? scenePack.truncated : false; },
    get cameraHash() { return cameraHash; },
    // Ops.
    rebuildScene,
    runFrame,
    resetAccumulation,
    setPixelStride,
    setMaxBounces,
    setSamplesPerFrame,
    setSize,
    dispose,
    // Constants re-exposed for the index ops layer.
    MAX_TRIANGLES,
  };
  return api;
}

export const __internals__ = { _makeAccumTarget };
