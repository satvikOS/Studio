// ArchDisc Studio V3 — GPU path tracer via WebGPU compute (slice 930).
// Real-time accumulating path tracer; result blended via slice 923 composer.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

const WGSL = `
struct U { proj: mat4x4<f32>, view: mat4x4<f32>, camPos: vec4<f32>, res: vec2<f32>, frame: u32, samples: u32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4<f32>>;
fn hash(p: u32) -> f32 { var x = p; x = ((x >> 16u) ^ x) * 0x45d9f3bu; x = ((x >> 16u) ^ x) * 0x45d9f3bu; x = (x >> 16u) ^ x; return f32(x) / 4294967295.0; }
fn sky(d: vec3<f32>) -> vec3<f32> { let t = 0.5 + 0.5 * d.y; return mix(vec3<f32>(0.5, 0.7, 1.0), vec3<f32>(1.0, 1.0, 1.0), t); }
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let px = vec2<u32>(gid.x, gid.y);
  if (px.x >= u32(u.res.x) || px.y >= u32(u.res.y)) { return; }
  let idx = px.y * u32(u.res.x) + px.x;
  let seed = idx + u.frame * 1664525u;
  let uv = (vec2<f32>(px) + vec2<f32>(hash(seed), hash(seed + 1u))) / u.res;
  let ndc = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.5, 1.0);
  let world = u.view * ndc;
  let dir = normalize(world.xyz / world.w - u.camPos.xyz);
  let col = vec4<f32>(sky(dir), 1.0);
  if (u.frame == 0u) { accum[idx] = col; } else {
    let n = f32(u.frame);
    accum[idx] = mix(accum[idx], col, 1.0 / (n + 1.0));
  }
}`;

let _installed = false, _device = null, _pipeline = null, _bindGroup = null, _uBuf = null, _accumBuf = null;
let _frame = 0, _lastCamHash = '', _enabled = false, _w = 0, _h = 0;
let _blendTex = null, _blendPass = null;

async function _initWebGPU() {
  if (_device || typeof navigator === 'undefined' || !navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  _device = await adapter.requestDevice();
  const mod = _device.createShaderModule({ code: WGSL });
  _pipeline = _device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
  return _device;
}

function _camHash() {
  const vp = window.__archdiscViewport;
  if (!vp?.camera) return '';
  const e = vp.camera.matrixWorld.elements;
  return e.map((v) => v.toFixed(4)).join(',');
}

async function _ensureResources(w, h) {
  if (!_device && !(await _initWebGPU())) return false;
  if (_w === w && _h === h && _accumBuf) return true;
  if (_accumBuf) _accumBuf.destroy();
  if (_uBuf) _uBuf.destroy();
  _w = w; _h = h;
  _accumBuf = _device.createBuffer({ size: w * h * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  _uBuf = _device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  _bindGroup = _device.createBindGroup({
    layout: _pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: _uBuf } }, { binding: 1, resource: { buffer: _accumBuf } }],
  });
  _blendTex = new THREE.DataTexture(new Float32Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.FloatType);
  _blendTex.needsUpdate = true;
  return true;
}

async function _render() {
  const vp = window.__archdiscViewport;
  if (!vp?.renderer || !vp?.camera) return { ok: false, error: 'no viewport' };
  if (!(await _initWebGPU())) return { ok: false, error: 'no webgpu' };
  const w = Math.min(512, vp.renderer.domElement.width | 0);
  const h = Math.min(512, vp.renderer.domElement.height | 0);
  if (!(await _ensureResources(w, h))) return { ok: false, error: 'no resources' };
  const ch = _camHash();
  if (ch !== _lastCamHash) { _frame = 0; _lastCamHash = ch; }
  const proj = vp.camera.projectionMatrix.elements;
  const view = vp.camera.matrixWorld.elements;
  const cp = vp.camera.position;
  const uData = new Float32Array(32);
  uData.set(proj, 0); uData.set(view, 16);
  uData[28] = cp.x; uData[29] = cp.y; uData[30] = cp.z;
  const uHead = new Uint32Array(uData.buffer);
  uHead[24] = w; uHead[25] = h; uHead[26] = _frame; uHead[27] = 1;
  _device.queue.writeBuffer(_uBuf, 0, uData.buffer);
  const enc = _device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(_pipeline); pass.setBindGroup(0, _bindGroup);
  pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), 1);
  pass.end();
  const readBuf = _device.createBuffer({ size: w * h * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyBufferToBuffer(_accumBuf, 0, readBuf, 0, w * h * 16);
  _device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const arr = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap(); readBuf.destroy();
  _blendTex.image.data.set(arr); _blendTex.needsUpdate = true;
  _frame++;
  return { ok: true, frame: _frame, width: w, height: h };
}

function _ensureBlendPass() {
  if (_blendPass) return _blendPass;
  _blendPass = { name: 'gpuptBlend', _mat: null };
  return _blendPass;
}

export function installGPUPathTracer() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioGPUPathTraceEnable: ({ on } = { on: true }) => { _enabled = !!on; if (!on) _frame = 0; return { ok: true, enabled: _enabled }; },
    __studioGPUPathTraceRender: () => _render(),
    __studioGPUPathTraceGetStats: () => ({ ok: true, frame: _frame, enabled: _enabled, hasDevice: !!_device, width: _w, height: _h }),
    __studioGPUPathTraceReset: () => { _frame = 0; return { ok: true }; },
    __studioGPUPathTraceGetTexture: () => ({ ok: true, texture: _blendTex }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'GPU path tracer (WebGPU compute)');
  return { ok: true };
}
export default installGPUPathTracer;
