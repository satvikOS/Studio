// ArchDisc Studio V3 — REAL deferred renderer G-buffer pass (slice 922).
//
// Replaces the slice-853 config stub with a working multi-render-target
// (MRT) G-buffer suitable for downstream screen-space passes (SSR, SSAO,
// SSGI, motion blur, path-tracer denoise).
//
// Layout (three attachments, RGBA half-float — backed by WebGL2 +
// EXT_color_buffer_half_float / EXT_color_buffer_float, both of which
// three.js auto-enables in WebGLExtensions / WebGLCapabilities):
//
//   attachment 0  →  vec4 (position.xyz, depth)        — world-space position
//   attachment 1  →  vec4 (normal.xyz,   materialID)   — world-space normal
//   attachment 2  →  vec4 (albedo.rgb,   roughness)    — surface colour
//
// Depth is also written to a separate DepthTexture attachment, so an SSR
// / SSGI / TAA pass can sample it as gl_FragCoord.z without round-tripping
// through attachment 0.
//
// Ops (all return `{ ok, ... }` per the V3 convention):
//
//   __studioDeferredEnable({on, gbufferFormat, maxLights, width, height})
//     → materialises the MRT render target on demand (lazily — we don't
//       allocate until the first enable call so the stub stays cheap).
//       Returns the active state + capability bits.
//
//   __studioDeferredCapture({width?, height?})
//     → runs ONE G-buffer pass into the MRT against the live viewport
//       scene + camera (window.__archdiscViewport), then reads each of
//       the three colour attachments back via readRenderTargetPixels +
//       blits them to a Canvas2D for a debug dataURL. Returns
//       {ok, positionDataUrl, normalDataUrl, albedoDataUrl, width,
//        height, meshCount, durationMs}.
//
//   __studioDeferredGetTexture({attachment})
//     → returns the underlying THREE.Texture for the given attachment
//       index (0=position, 1=normal, 2=albedo) so a downstream pass
//       (SSR/SSAO/SSGI/TAA/motion blur) can wire it as a uniform without
//       a CPU round-trip. Returns {ok, texture, depthTexture, format}.
//
//   __studioDeferredGetStats()
//     → returns the current state + capability bits + last capture's
//       timings.
//
// The MRT is keyed by (width, height). Resizing automatically rebuilds it.
//
// The slice-853 ops `__studioDeferredEnable / GetStats` keep working —
// this slice adds the missing `Capture` + `GetTexture` ops AND swaps the
// stub `__studioDeferredEnable` for one that actually allocates the GPU
// resources.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

// ── Module state ─────────────────────────────────────────────────────────
let _installed = false;
const _state = {
  enabled: false,
  gbufferFormat: 'rgba16f',
  maxLights: 64,
  width: 0,
  height: 0,
  lastCaptureMs: 0,
  lastMeshCount: 0,
  captureCount: 0,
};

let _mrt = null;                 // THREE.WebGLRenderTarget (count: 3)
let _gbufferVertexShader = null; // string (GLSL3)
let _gbufferFragShader   = null; // string (GLSL3)
let _gbufferMatTemplate  = null; // template ShaderMaterial — cloned per-mesh

// ── Shaders ──────────────────────────────────────────────────────────────
//
// We rely on three's auto-injected per-frame uniforms (modelMatrix,
// viewMatrix, projectionMatrix, normalMatrix) and per-vertex attributes
// (position, normal). ShaderMaterial (not RawShaderMaterial) gives us
// those for free; we only need to declare the cross-pass varyings.
//
// GLSL3 (#version 300 es) → use `in/out` instead of `attribute/varying`
// and `layout(location = N) out vec4 outN` for the three MRT slots.

const GBUFFER_VERTEX = /* glsl */`
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec2 vUv;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GBUFFER_FRAGMENT = /* glsl */`
precision highp float;

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec2 vUv;

uniform vec3  uAlbedo;
uniform float uRoughness;
uniform float uMaterialId;

layout(location = 0) out vec4 outPosition;  // (worldPos.xyz, linearDepth)
layout(location = 1) out vec4 outNormal;    // (worldNormal.xyz, materialId)
layout(location = 2) out vec4 outAlbedo;    // (albedo.rgb, roughness)

void main() {
  // Linear depth ≈ -view-space Z. We recompute it here so SSR/SSGI
  // can use it directly without dividing perspective-distorted depth.
  vec4 viewPos = viewMatrix * vec4(vWorldPos, 1.0);
  float linearDepth = -viewPos.z;

  outPosition = vec4(vWorldPos, linearDepth);
  outNormal   = vec4(normalize(vWorldNormal), uMaterialId);
  outAlbedo   = vec4(uAlbedo, uRoughness);
}
`;

// ── MRT lifecycle ────────────────────────────────────────────────────────

function _capabilities() {
  const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  const gl = vp && vp.renderer ? vp.renderer.getContext() : null;
  const webgl2 = !!(gl && typeof WebGL2RenderingContext !== 'undefined'
                    && gl instanceof WebGL2RenderingContext);
  let floatBuf = false;
  let halfFloatBuf = false;
  let maxColorAttachments = 0;
  let maxDrawBuffers = 0;
  if (gl) {
    try {
      floatBuf     = !!gl.getExtension('EXT_color_buffer_float');
      halfFloatBuf = !!gl.getExtension('EXT_color_buffer_half_float') || floatBuf;
      maxColorAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) || 0;
      maxDrawBuffers      = gl.getParameter(gl.MAX_DRAW_BUFFERS) || 0;
    } catch (_) { /* swallow */ }
  }
  return { webgl2, floatBuf, halfFloatBuf, maxColorAttachments, maxDrawBuffers };
}

function _pickType(format) {
  // Default to half-float for best compat (RGBA16F via
  // EXT_color_buffer_half_float on WebGL2). Caller can ask for 'rgba32f'
  // for full-float at the cost of bandwidth + extension reach, or
  // 'rgba8' for a cheap fallback.
  switch ((format || '').toLowerCase()) {
    case 'rgba8':   return THREE.UnsignedByteType;
    case 'rgba32f':
    case 'rgba32':  return THREE.FloatType;
    case 'rgba16':
    case 'rgba16f':
    default:        return THREE.HalfFloatType;
  }
}

function _disposeMrt() {
  if (!_mrt) return;
  try { _mrt.dispose(); } catch (_) {}
  _mrt = null;
}

function _ensureMrt(width, height, format) {
  const W = Math.max(1, Math.floor(width  || 0));
  const H = Math.max(1, Math.floor(height || 0));
  if (_mrt && _mrt.width === W && _mrt.height === H
      && _mrt.userData && _mrt.userData.gbufferFormat === format) {
    return _mrt;
  }
  _disposeMrt();
  const type = _pickType(format);
  // count: 3 → three.js auto-allocates 3 colour attachments + calls
  // gl.drawBuffers([COLOR_ATTACHMENT0, COLOR_ATTACHMENT0+1, COLOR_ATTACHMENT0+2])
  // when this RT is bound (see WebGLState::drawBuffers).
  const rt = new THREE.WebGLRenderTarget(W, H, {
    count: 3,
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  // Attach a depth texture so SSR/SSGI/TAA passes can sample
  // gl_FragCoord.z directly without re-rasterising.
  rt.depthTexture = new THREE.DepthTexture(W, H);
  rt.depthTexture.format = THREE.DepthFormat;
  rt.depthTexture.type   = THREE.UnsignedIntType;
  // Name each attachment so debug tooling can find them back.
  if (rt.textures && rt.textures.length >= 3) {
    rt.textures[0].name = 'gbuffer.position';
    rt.textures[1].name = 'gbuffer.normal';
    rt.textures[2].name = 'gbuffer.albedo';
  }
  rt.userData = { gbufferFormat: format, typeConst: type };
  _mrt = rt;
  _state.width = W;
  _state.height = H;
  return _mrt;
}

function _ensureTemplateMaterial() {
  if (_gbufferMatTemplate) return _gbufferMatTemplate;
  _gbufferVertexShader = GBUFFER_VERTEX;
  _gbufferFragShader   = GBUFFER_FRAGMENT;
  _gbufferMatTemplate = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader:   _gbufferVertexShader,
    fragmentShader: _gbufferFragShader,
    uniforms: {
      uAlbedo:     { value: new THREE.Color(0.7, 0.7, 0.7) },
      uRoughness:  { value: 0.5 },
      uMaterialId: { value: 0.0 },
    },
    side: THREE.DoubleSide,   // sheet bodies, ribbons, etc.
    depthTest: true,
    depthWrite: true,
    transparent: false,
  });
  return _gbufferMatTemplate;
}

function _albedoFromMesh(mesh) {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (m && m.color && m.color.isColor) return m.color;
  if (m && m.diffuse && m.diffuse.isColor) return m.diffuse;
  return new THREE.Color(0.7, 0.7, 0.7);
}

function _roughnessFromMesh(mesh) {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (m && typeof m.roughness === 'number') return m.roughness;
  // PBR-ish guess for unknown materials.
  return 0.5;
}

// Hash mesh.uuid → stable [0, 1] material id so attachment 1.w is a
// per-body discriminator for compositing / picking layers.
function _materialIdFromMesh(mesh) {
  const s = mesh.uuid || mesh.name || '';
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return (h & 0xFFFF) / 65535;
}

function _isPickable(o) {
  if (!o.isMesh) return false;
  const u = o.userData || {};
  if (u.isHelper) return false;
  if (u.archdiscStudioHelper) return false;
  if (u.archdiscStudioGizmo)  return false;
  if (u.archdiscStudioGrid)   return false;
  if (u.archdiscStudioGround) return false;
  if (o.name === '__selection_outline__') return false;
  if (o.parent && o.parent.name === '__selection_outline__') return false;
  if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) {
    return false;
  }
  // Also walk ancestors for the helper flag — TransformControls handles
  // are plain Meshes whose parent carries isHelper.
  for (let a = o; a; a = a.parent) {
    if (a.userData && a.userData.isHelper) return false;
  }
  return true;
}

// ── G-buffer pass ────────────────────────────────────────────────────────
//
// Walks the scene, swaps every pickable mesh's material to a per-mesh
// clone of the G-buffer template (with that mesh's albedo / roughness /
// materialId baked into the uniforms), renders ONCE into the MRT, then
// restores every material. Renderer state is saved/restored so the main
// viewport keeps painting correctly on the next frame.
function _runGBufferPass() {
  const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (!vp || !vp.scene || !vp.camera || !vp.renderer) {
    return { ok: false, reason: 'no-viewport' };
  }
  const { scene, camera, renderer } = vp;

  // Choose a sensible default size: if the caller hasn't enabled an
  // explicit width/height we match the on-screen drawing buffer.
  const W = _state.width  || renderer.getContext().drawingBufferWidth  || 1024;
  const H = _state.height || renderer.getContext().drawingBufferHeight || 768;
  const mrt = _ensureMrt(W, H, _state.gbufferFormat);
  const tpl = _ensureTemplateMaterial();

  // Collect pickable meshes + swap their material to a per-mesh clone.
  const swaps = [];
  scene.traverse((o) => {
    if (!_isPickable(o)) return;
    const matClone = tpl.clone();
    // Re-uniform — clone shares the uniform objects by reference in
    // some three.js versions; we want per-mesh isolation.
    matClone.uniforms = {
      uAlbedo:     { value: _albedoFromMesh(o).clone() },
      uRoughness:  { value: _roughnessFromMesh(o) },
      uMaterialId: { value: _materialIdFromMesh(o) },
    };
    swaps.push({ obj: o, prev: o.material, replacement: matClone });
    o.material = matClone;
  });

  // Save renderer state, run the pass, restore.
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const prevTarget = renderer.getRenderTarget();
  const prevAuto   = renderer.autoClear;
  const prevClear  = renderer.getClearColor(new THREE.Color());
  const prevAlpha  = renderer.getClearAlpha();
  const prevOverride = scene.overrideMaterial;

  try {
    renderer.setRenderTarget(mrt);
    // Clear all three colour attachments to (0, 0, 0, 0) so background
    // pixels are unambiguous to downstream passes.
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    scene.overrideMaterial = null;
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
  } catch (err) {
    // Restore + bubble so the caller sees what failed.
    for (const s of swaps) {
      s.obj.material = s.prev;
      try { s.replacement.dispose(); } catch (_) {}
    }
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    return { ok: false, reason: 'render-failed', error: String(err && err.message || err) };
  }

  const t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

  // Restore meshes + renderer state.
  for (const s of swaps) {
    s.obj.material = s.prev;
    try { s.replacement.dispose(); } catch (_) {}
  }
  scene.overrideMaterial = prevOverride;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;

  _state.lastCaptureMs = t1 - t0;
  _state.lastMeshCount = swaps.length;
  _state.captureCount++;
  return { ok: true, meshCount: swaps.length, durationMs: t1 - t0, width: W, height: H };
}

// ── Attachment readback (debug dataURL) ──────────────────────────────────
//
// readRenderTargetPixels supports a `textureIndex` argument that selects
// the colour attachment to read. For half-float / float attachments
// we still get a Float32Array back (three converts internally) — but
// the WebGL spec only mandates UNSIGNED_BYTE for arbitrary RTs and
// FLOAT-readback for float-capable ones, so we keep the readback simple:
// pull as UNSIGNED_BYTE if the attachment is RGBA8, FLOAT otherwise, and
// tonemap on the JS side for the debug PNG.

function _readAttachmentToDataUrl(renderer, mrt, attachmentIndex, encode) {
  const W = mrt.width, H = mrt.height;
  const tex = mrt.textures && mrt.textures[attachmentIndex];
  if (!tex) return null;
  const typeConst = mrt.userData && mrt.userData.typeConst;
  let buf, gl;
  try {
    gl = renderer.getContext();
    if (typeConst === THREE.FloatType || typeConst === THREE.HalfFloatType) {
      // Read as float — modern three.js auto-detects when the target's
      // type is FloatType/HalfFloatType and uses gl.FLOAT for the readback.
      buf = new Float32Array(W * H * 4);
      renderer.readRenderTargetPixels(mrt, 0, 0, W, H, buf, undefined, attachmentIndex);
    } else {
      buf = new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(mrt, 0, 0, W, H, buf, undefined, attachmentIndex);
    }
  } catch (_) {
    return null;
  }
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  // Encode each pixel via the caller-provided closure. We also Y-flip
  // here because WebGL reads from origin = lower-left, but Canvas2D
  // writes from upper-left.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const src = ((H - 1 - y) * W + x) * 4;
      const dst = (y * W + x) * 4;
      const r = buf[src];
      const g = buf[src + 1];
      const b = buf[src + 2];
      const a = buf[src + 3];
      const [er, eg, eb, ea] = encode(r, g, b, a);
      img.data[dst]     = er;
      img.data[dst + 1] = eg;
      img.data[dst + 2] = eb;
      img.data[dst + 3] = ea;
    }
  }
  ctx.putImageData(img, 0, 0);
  try { return cv.toDataURL('image/png'); } catch (_) { return null; }
}

// Encoders. Each takes raw RGBA + returns 4 bytes (0–255) for the debug
// PNG. Float attachments hand us metres of world position / unit-length
// normals / linear albedo; we normalise them to a visible 8-bit range.

const _encodePosition = (r, g, b, a) => {
  // World-space position can be any magnitude — we centre on 0 and
  // squash to [-2, 2] m for a useful preview (matches the camera's
  // default 0.15m distance + grid extent).
  const mapAxis = (v) => Math.max(0, Math.min(255, ((v / 4) + 0.5) * 255));
  return [mapAxis(r), mapAxis(g), mapAxis(b), 255];
};

const _encodeNormal = (r, g, b /*, a */) => {
  // Normals in [-1, 1] → [0, 255], standard normal-buffer encoding.
  const mapN = (v) => Math.max(0, Math.min(255, (v * 0.5 + 0.5) * 255));
  return [mapN(r), mapN(g), mapN(b), 255];
};

const _encodeAlbedo = (r, g, b, a) => {
  // Albedo is already linear [0, 1] — quick sRGB-ish encode for the
  // preview, roughness goes in alpha.
  const enc = (v) => Math.max(0, Math.min(255, Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255));
  return [enc(r), enc(g), enc(b), enc(a)];
};

// ── Install ──────────────────────────────────────────────────────────────
export function installDeferred() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioDeferredEnable: ({ on, gbufferFormat, maxLights, width, height } = {}) => {
      if (on != null)            _state.enabled       = !!on;
      if (gbufferFormat)         _state.gbufferFormat = String(gbufferFormat);
      if (typeof maxLights === 'number') _state.maxLights = Math.max(1, Math.min(1024, maxLights | 0));
      if (typeof width  === 'number' && width  > 0) _state.width  = width  | 0;
      if (typeof height === 'number' && height > 0) _state.height = height | 0;
      const caps = _capabilities();
      // If the user is enabling, allocate the MRT eagerly so later
      // capture calls don't pay the alloc cost on the first frame.
      if (_state.enabled) {
        const W = _state.width  || (caps.webgl2 ? 1024 : 512);
        const H = _state.height || (caps.webgl2 ? 768  : 384);
        try {
          _ensureMrt(W, H, _state.gbufferFormat);
        } catch (err) {
          return {
            ok: false, reason: 'mrt-alloc-failed',
            error: String(err && err.message || err),
            ..._state, ...caps,
          };
        }
      } else {
        _disposeMrt();
      }
      return { ok: true, ..._state, ...caps };
    },
    __studioDeferredCapture: ({ width, height } = {}) => {
      // Make sure the MRT exists at the requested size.
      if (typeof width === 'number' && width > 0)   _state.width  = width  | 0;
      if (typeof height === 'number' && height > 0) _state.height = height | 0;
      if (!_state.enabled) _state.enabled = true;
      const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
      if (!vp || !vp.renderer) return { ok: false, reason: 'no-viewport' };
      const res = _runGBufferPass();
      if (!res.ok) return res;
      let positionDataUrl = null;
      let normalDataUrl   = null;
      let albedoDataUrl   = null;
      try {
        positionDataUrl = _readAttachmentToDataUrl(vp.renderer, _mrt, 0, _encodePosition);
        normalDataUrl   = _readAttachmentToDataUrl(vp.renderer, _mrt, 1, _encodeNormal);
        albedoDataUrl   = _readAttachmentToDataUrl(vp.renderer, _mrt, 2, _encodeAlbedo);
      } catch (_) { /* readback best-effort */ }
      return {
        ok: true,
        meshCount:    res.meshCount,
        durationMs:   res.durationMs,
        width:        res.width,
        height:       res.height,
        positionDataUrl,
        normalDataUrl,
        albedoDataUrl,
      };
    },
    __studioDeferredGetTexture: ({ attachment } = {}) => {
      if (!_mrt) return { ok: false, reason: 'no-mrt' };
      const idx = Math.max(0, Math.min(2, (attachment | 0)));
      const tex = _mrt.textures && _mrt.textures[idx];
      if (!tex) return { ok: false, reason: 'no-attachment', attachment: idx };
      return {
        ok: true,
        texture:      tex,
        depthTexture: _mrt.depthTexture || null,
        format:       _state.gbufferFormat,
        width:        _mrt.width,
        height:       _mrt.height,
        attachment:   idx,
      };
    },
    __studioDeferredGetStats: () => {
      const caps = _capabilities();
      return {
        ok: true,
        ..._state, ...caps,
        hasMrt: !!_mrt,
        attachmentCount: _mrt && _mrt.textures ? _mrt.textures.length : 0,
      };
    },
  };
  for (const [n, fn] of Object.entries(ops)) {
    if (typeof window !== 'undefined') window[n] = fn;
  }
  registerOps(ops, 'rt', 'Deferred renderer (MRT G-buffer: position/normal/albedo)');
  return { ok: true };
}

export default installDeferred;
