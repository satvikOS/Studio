// ArchDisc Studio V3 — REAL WebGPU compute-shader path tracer
// (slice 886, replacing the slice 830 stub).
//
// Pipeline overview:
//   1. Acquire `adapter` + `device` from navigator.gpu (no silent CPU
//      fallback — if WebGPU is genuinely unavailable we return
//      { ok:false, error:'no WebGPU' } and let the caller decide).
//   2. Walk the active scene, merge Studio primitives into a single
//      world-space mesh, build a three-mesh-bvh, then pack BVH + tris +
//      positions + materials + per-tri material IDs into GPU storage
//      buffers (see bvhUpload.js).
//   3. Upload a Uniforms struct holding the camera inverse-view-proj
//      + origin + dims + seed.
//   4. Dispatch the WGSL compute kernel from wgslShader.js — one
//      invocation per pixel at @workgroup_size(8, 8). The kernel writes
//      this sample's radiance into an rgba16float storage texture.
//   5. Copy that texture into a CPU-readable buffer via
//      commandEncoder.copyTextureToBuffer, mapAsync the readback buffer,
//      accumulate into a Float32 running mean on the JS side, repeat
//      for `samples` iterations.
//   6. Tone-map + present via a canvas dataURL.
//
// Surface ops (preserved from slice 830):
//   __studioGPURTRender / __studioGPURTHasGPU

import { registerOps } from '../common/registry.js';
import { buildGPUResources } from './bvhUpload.js';
import { PT_WGSL } from './wgslShader.js';

let _installed = false;
let _devicePromise = null;

// Singleton device — request once, reuse across renders.
async function _getDevice() {
  if (_devicePromise) return _devicePromise;
  _devicePromise = (async () => {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      return { ok: false, error: 'no WebGPU' };
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, error: 'no WebGPU adapter' };
    const device = await adapter.requestDevice();
    return { ok: true, adapter, device };
  })();
  return _devicePromise;
}

function _collectMeshes() {
  if (typeof window === 'undefined') return [];
  const vp = window.__archdiscViewport;
  if (!vp || !vp.scene) return [];
  const meshes = [];
  vp.scene.traverse((o) => {
    if (o.isMesh && o.userData?.archdiscStudioPrimitive) meshes.push(o);
  });
  return meshes;
}

// Frame the viewport camera onto the supplied meshes' world-space bbox and
// refresh its matrices, so the inverse-view-projection the kernel reads
// always points AT the scene — never at empty space.
//
// This is the robustness fix (slice 951+): the RT used to depend entirely on
// the caller having framed `vp.camera` first. `__studioMainCameraLook` (and
// ad-hoc callers) set position/lookAt but could leave the camera staring past
// the geometry, and any caller that forgot to call updateProjectionMatrix() /
// updateMatrixWorld(true) handed us a stale inverse-VP → empty / fragment
// images. We now FIT here, against the exact merged geometry we ray-trace, so
// the packed inverse-VP is guaranteed consistent with what the BVH contains.
//
// Returns the THREE.Box3 used (for diagnostics), or null if THREE / camera
// unavailable (in which case we leave the camera untouched and still update
// its matrices in _packUniforms).
function _frameCameraToScene(THREE, camera, meshes) {
  if (!THREE || !camera || !meshes || !meshes.length) return null;
  const box = new THREE.Box3();
  let hasAny = false;
  for (const m of meshes) {
    if (!m || !m.geometry) continue;
    m.updateWorldMatrix(true, false);
    box.expandByObject(m);
    hasAny = true;
  }
  if (!hasAny || box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Bounding-sphere radius of the bbox (covers all 8 corners), floored so a
  // degenerate / single-point scene still gets a sane framing distance.
  const radius = Math.max(0.5 * size.length(), 0.001);

  // Distance so the sphere fits inside BOTH the vertical and horizontal FOV.
  const fovY = (camera.fov || 45) * Math.PI / 180;
  const aspect = camera.aspect || 1;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
  const fitFov = Math.min(fovY, fovX);
  const dist = (radius / Math.sin(fitFov / 2)) * 1.15; // 15 % margin

  // 3/4 hero direction (right, slightly above, in front) — same family as
  // __studioFrameAll, so the RT and the live viewport agree on composition.
  const dir = new THREE.Vector3(1, 0.55, 1).normalize();
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  camera.up.set(0, 1, 0);
  camera.lookAt(center);

  // Keep the geometry comfortably between the near/far planes for this dist.
  camera.near = Math.max(dist - radius * 1.5, dist * 0.01, 0.001);
  camera.far = dist + radius * 4;

  // CRITICAL: refresh projection + world matrices NOW so the inverse-VP packed
  // in _packUniforms reflects this exact framed pose. Without these two calls
  // the cached matrices (matrixWorldInverse / projectionMatrix) are stale and
  // the kernel rays miss the scene.
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  // If OrbitControls is present, keep its target in sync so subsequent manual
  // orbiting starts from the framed center (per the BVH-raycast lessons —
  // stale controls targets break later interaction).
  try {
    const vp = window.__archdiscViewport;
    const controls = vp && (typeof vp.controls === 'function' ? vp.controls() : vp.controls);
    if (controls && controls.target) { controls.target.copy(center); controls.update && controls.update(); }
  } catch (_) { /* controls optional */ }

  return box;
}

function _toneMap(rgb) {
  // Filmic tone-map (Reinhard with whitepoint = 4) + sRGB encode.
  const W = 4.0;
  const tm = rgb.map((c) => c * (1 + c / (W * W)) / (1 + c));
  return tm.map((c) => {
    const clamped = Math.max(0, Math.min(1, c));
    // sRGB OETF
    return clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  });
}

// Build the camera-uniforms ArrayBuffer.
//
//   mat4 cameraInverseViewProj  : 64 bytes
//   vec4 cameraOrigin           : 16
//   u32 width / height / sample / maxBounces : 16
//   u32 nodeCount / triCount / materialCount / seed : 16
//
// Total = 112 bytes.
function _packUniforms(camera, width, height, sampleIdx, maxBounces, nodeCount, triCount, materialCount, seed) {
  const buf = new ArrayBuffer(112);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  // Inverse view-proj — three.js stores matrices in column-major Float32
  // which matches WGSL.
  camera.updateMatrixWorld(true);
  if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
  // viewProj = proj * viewInverse  → we want inverse of that.
  // three.js: camera.projectionMatrix, camera.matrixWorldInverse.
  // inverseVP = matrixWorld * projectionMatrixInverse.
  // We'll compute via THREE if available.
  // eslint-disable-next-line no-undef
  const THREE = window.THREE || null;
  let inv;
  if (THREE) {
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    inv = vp.invert();
    inv.toArray(f32, 0);
  } else {
    // Fallback: identity (best-effort if THREE global not on window).
    for (let i = 0; i < 16; i++) f32[i] = (i % 5 === 0) ? 1 : 0;
  }
  // origin
  f32[16] = camera.position.x;
  f32[17] = camera.position.y;
  f32[18] = camera.position.z;
  f32[19] = 1.0;
  // dims + counts
  u32[20] = width >>> 0;
  u32[21] = height >>> 0;
  u32[22] = sampleIdx >>> 0;
  u32[23] = maxBounces >>> 0;
  u32[24] = nodeCount >>> 0;
  u32[25] = triCount >>> 0;
  u32[26] = materialCount >>> 0;
  u32[27] = seed >>> 0;
  return buf;
}

async function _render({ width = 512, height = 384, samples = 8, maxBounces = 1, frame = true } = {}) {
  // Clamp + sanitise.
  width = Math.max(8, Math.min(2048, width | 0));
  height = Math.max(8, Math.min(2048, height | 0));
  samples = Math.max(1, Math.min(256, samples | 0));
  maxBounces = Math.max(0, Math.min(8, maxBounces | 0));

  if (typeof window === 'undefined') return { ok: false, error: 'no window' };

  // 1. Acquire device (real WebGPU only — explicit failure if missing).
  const dev = await _getDevice();
  if (!dev.ok) return { ok: false, error: dev.error };
  const { device } = dev;

  // 2. Collect Studio primitives + build BVH + buffers.
  const meshes = _collectMeshes();
  if (!meshes.length) return { ok: false, error: 'no scene meshes' };
  let resources;
  try {
    resources = buildGPUResources(meshes);
  } catch (e) {
    return { ok: false, error: 'BVH build failed: ' + (e?.message || String(e)) };
  }
  if (!resources) return { ok: false, error: 'no geometry' };

  const vp = window.__archdiscViewport;
  const camera = vp.camera;
  if (!camera) return { ok: false, error: 'no camera' };

  // Stash THREE globally so _packUniforms can build the inverse VP — the
  // pathtrace module already requires THREE in its imports, but here we
  // need it without re-importing (keeps the module surface tight). Prefer the
  // viewport's live THREE so we share the same class identity as the scene.
  if (!window.THREE) {
    if (window.__archdiscTHREE) {
      window.THREE = window.__archdiscTHREE;
    } else {
      try {
        // dynamic import keeps THREE off the synchronous critical path
        const T = await import('three');
        window.THREE = T;
      } catch (_) { /* will fall back to identity in _packUniforms */ }
    }
  }

  // 2b. Frame the camera ONTO the exact geometry we just packed for the BVH,
  // then refresh its matrices. This is the robustness guarantee: whatever the
  // caller did (or didn't do) to vp.camera, the inverse-VP we pack below now
  // points at the scene. Callers that have already composed a bespoke shot can
  // opt out with { frame: false }.
  let framedBox = null;
  if (frame !== false) {
    framedBox = _frameCameraToScene(window.THREE, camera, meshes);
  }

  // 3. GPU buffer creation
  const t0 = performance.now();
  const nodesBuf = device.createBuffer({
    size: Math.max(32, resources.nodes.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(nodesBuf, 0, resources.nodes);

  const triIdxBuf = device.createBuffer({
    size: Math.max(32, resources.triIndices.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(triIdxBuf, 0, resources.triIndices);

  const posBuf = device.createBuffer({
    size: Math.max(32, resources.positions.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(posBuf, 0, resources.positions);

  const matBuf = device.createBuffer({
    size: Math.max(32, resources.materials.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(matBuf, 0, resources.materials);

  const triMatBuf = device.createBuffer({
    size: Math.max(32, resources.triMaterialId.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(triMatBuf, 0, resources.triMaterialId);

  const uniformBuf = device.createBuffer({
    size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const outTex = device.createTexture({
    size: { width, height, depthOrArrayLayers: 1 },
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });

  // 4. Pipeline
  const shaderModule = device.createShaderModule({ code: PT_WGSL });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: nodesBuf } },
      { binding: 2, resource: { buffer: triIdxBuf } },
      { binding: 3, resource: { buffer: posBuf } },
      { binding: 4, resource: { buffer: matBuf } },
      { binding: 5, resource: { buffer: triMatBuf } },
      { binding: 6, resource: outTex.createView() },
    ],
  });

  // Bytes-per-row for the readback buffer must be a multiple of 256.
  const bytesPerPixel = 8; // rgba16float = 4 channels * 2 bytes
  const bytesPerRow = Math.ceil(width * bytesPerPixel / 256) * 256;
  const readBuf = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Running mean accumulator on the JS side.
  const accum = new Float32Array(width * height * 3);

  // 5. Loop samples
  for (let s = 0; s < samples; s++) {
    const seed = (s * 2654435761 ^ Math.floor(performance.now() * 1000)) >>> 0;
    const uni = _packUniforms(
      camera, width, height, s, maxBounces,
      resources.nodeCount, resources.triCount, resources.materialCount, seed,
    );
    device.queue.writeBuffer(uniformBuf, 0, uni);

    const cmd = device.createCommandEncoder();
    const pass = cmd.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8), 1);
    pass.end();
    cmd.copyTextureToBuffer(
      { texture: outTex },
      { buffer: readBuf, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([cmd.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const mapped = new Uint16Array(readBuf.getMappedRange());
    // rgba16float → Float32 in JS (per-pixel halfFloatToFloat).
    for (let y = 0; y < height; y++) {
      const rowStart = (bytesPerRow * y) / 2; // /2 because Uint16
      for (let x = 0; x < width; x++) {
        const src = rowStart + x * 4;
        const dst = (y * width + x) * 3;
        const r = _f16ToF32(mapped[src + 0]);
        const g = _f16ToF32(mapped[src + 1]);
        const b = _f16ToF32(mapped[src + 2]);
        // Running mean
        const k = s + 1;
        accum[dst + 0] += (r - accum[dst + 0]) / k;
        accum[dst + 1] += (g - accum[dst + 1]) / k;
        accum[dst + 2] += (b - accum[dst + 2]) / k;
      }
    }
    readBuf.unmap();
  }

  // 6. Present
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const out = img.data;
  for (let i = 0; i < width * height; i++) {
    const r = accum[i * 3 + 0];
    const g = accum[i * 3 + 1];
    const b = accum[i * 3 + 2];
    const [tr, tg, tb] = _toneMap([r, g, b]);
    out[i * 4 + 0] = Math.round(tr * 255);
    out[i * 4 + 1] = Math.round(tg * 255);
    out[i * 4 + 2] = Math.round(tb * 255);
    out[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // Dispose GPU resources we created this run.
  nodesBuf.destroy?.();
  triIdxBuf.destroy?.();
  posBuf.destroy?.();
  matBuf.destroy?.();
  triMatBuf.destroy?.();
  uniformBuf.destroy?.();
  outTex.destroy?.();
  readBuf.destroy?.();

  const elapsed = performance.now() - t0;
  const result = {
    ok: true,
    dataUrl: canvas.toDataURL('image/png'),
    width, height, samples, maxBounces, elapsed,
    device: 'gpu',
    nodeCount: resources.nodeCount,
    triCount: resources.triCount,
    framed: !!framedBox,
  };
  if (framedBox) {
    const sz = framedBox.getSize(new window.THREE.Vector3());
    result.sceneExtent = [+sz.x.toFixed(3), +sz.y.toFixed(3), +sz.z.toFixed(3)];
    result.cameraPosition = [
      +camera.position.x.toFixed(3),
      +camera.position.y.toFixed(3),
      +camera.position.z.toFixed(3),
    ];
  }
  return result;
}

// IEEE-754 half-float → float decoder. Used to interpret rgba16float
// pixels that come back from the storage texture readback.
function _f16ToF32(h) {
  const s = (h >> 15) & 0x1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) {
    if (f === 0) return s ? -0 : 0;
    // Subnormal
    const v = Math.pow(2, -14) * (f / 1024);
    return s ? -v : v;
  } else if (e === 0x1f) {
    return f ? NaN : (s ? -Infinity : Infinity);
  }
  const v = Math.pow(2, e - 15) * (1 + f / 1024);
  return s ? -v : v;
}

async function _hasGPU() {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return { ok: true, hasGPU: false };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return { ok: true, hasGPU: !!adapter };
  } catch (_) {
    return { ok: true, hasGPU: false };
  }
}

export function installGPURT() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioGPURTRender: _render,
    __studioGPURTHasGPU: _hasGPU,
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'GPU compute path tracer (real WebGPU)');
  return { ok: true };
}

export default installGPURT;
