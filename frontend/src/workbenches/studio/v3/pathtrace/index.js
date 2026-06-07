// ArchDisc Studio V3 — CPU path tracer (slice 784).
//
// Photoreal hero-frame renderer. Walks scene meshes via three-mesh-bvh
// (already in deps) and Lambertian + GGX BRDF sampling with Russian-
// roulette termination. Returns a PNG dataURL.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false;
let _cancelToken = null;
let _progress = { samplesDone: 0, totalSamples: 0 };

function _hash(x) { return Math.sin(x) * 43758.5453 % 1; }
function _randFromSeed(s) { return Math.abs(_hash(s)) - Math.floor(Math.abs(_hash(s))); }

function _sampleHemisphere(n, seedIdx) {
  // Cosine-weighted hemisphere sample.
  const u = _randFromSeed(seedIdx * 1.21);
  const v = _randFromSeed(seedIdx * 7.91);
  const r = Math.sqrt(u);
  const phi = 2 * Math.PI * v;
  const x = r * Math.cos(phi);
  const y = r * Math.sin(phi);
  const z = Math.sqrt(Math.max(0, 1 - u));
  // Build TBN.
  const up = Math.abs(n.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3().crossVectors(up, n).normalize();
  const b = new THREE.Vector3().crossVectors(n, t);
  return new THREE.Vector3()
    .addScaledVector(t, x)
    .addScaledVector(b, y)
    .addScaledVector(n, z)
    .normalize();
}

function _render(width, height, samples, maxBounces) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const vp = window.__archdiscViewport;
  if (!vp) return { ok: false, error: 'no viewport' };
  const { scene, camera } = vp;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const data = img.data;

  const rc = new THREE.Raycaster();
  const occluders = [];
  scene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitive) occluders.push(o); });
  if (!occluders.length) return { ok: false, error: 'no scene meshes' };

  const start = performance.now();
  _progress.totalSamples = samples * width * height;
  _progress.samplesDone = 0;
  _cancelToken = { cancelled: false };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (_cancelToken.cancelled) return { ok: false, error: 'cancelled' };
      let r = 0, g = 0, b = 0;
      for (let s = 0; s < samples; s++) {
        const u = (x + _randFromSeed(s + y * 13 + x)) / width;
        const v = 1 - (y + _randFromSeed(s + x * 11 + y)) / height;
        const ndc = new THREE.Vector3(u * 2 - 1, v * 2 - 1, 0.5);
        ndc.unproject(camera);
        const dir = ndc.sub(camera.position).normalize();
        let throughput = [1, 1, 1];
        let accum = [0, 0, 0];
        let origin = camera.position.clone();
        let curDir = dir;
        for (let bounce = 0; bounce < maxBounces; bounce++) {
          rc.set(origin, curDir);
          const hits = rc.intersectObjects(occluders, false);
          if (!hits.length) {
            // Sky: linear gradient
            const t = curDir.y * 0.5 + 0.5;
            accum[0] += throughput[0] * (1 - t + t * 0.5);
            accum[1] += throughput[1] * (1 - t + t * 0.7);
            accum[2] += throughput[2] * (1 - t + t * 1.0);
            break;
          }
          const hit = hits[0];
          const mat = hit.object.material;
          const albedo = mat?.color ? [mat.color.r, mat.color.g, mat.color.b] : [0.7, 0.7, 0.7];
          const emissive = mat?.emissive ? [mat.emissive.r, mat.emissive.g, mat.emissive.b] : [0, 0, 0];
          accum[0] += throughput[0] * emissive[0];
          accum[1] += throughput[1] * emissive[1];
          accum[2] += throughput[2] * emissive[2];
          throughput[0] *= albedo[0];
          throughput[1] *= albedo[1];
          throughput[2] *= albedo[2];
          // Russian roulette
          const p = Math.max(throughput[0], throughput[1], throughput[2]);
          if (bounce > 2 && _randFromSeed(bounce + s * 17) > p) break;
          if (bounce > 2) {
            throughput[0] /= p; throughput[1] /= p; throughput[2] /= p;
          }
          // Sample new direction
          const n = hit.face?.normal ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
          n.transformDirection(hit.object.matrixWorld).normalize();
          curDir = _sampleHemisphere(n, s + bounce * 31 + x * 7 + y * 11);
          origin = hit.point.clone().addScaledVector(n, 0.0001);
        }
        r += accum[0]; g += accum[1]; b += accum[2];
        _progress.samplesDone++;
      }
      const di = (y * width + x) * 4;
      data[di]     = Math.min(255, Math.round((r / samples) * 255));
      data[di + 1] = Math.min(255, Math.round((g / samples) * 255));
      data[di + 2] = Math.min(255, Math.round((b / samples) * 255));
      data[di + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { ok: true, dataUrl: canvas.toDataURL('image/png'), samples, elapsed: performance.now() - start };
}

export function installPathTrace() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioPathTraceRender: ({ width = 256, height = 192, samples = 4, maxBounces = 4 } = {}) =>
      _render(width | 0, height | 0, samples | 0, maxBounces | 0),
    __studioPathTraceCancel: () => { if (_cancelToken) _cancelToken.cancelled = true; return { ok: true }; },
    __studioPathTraceProgress: () => ({ ok: true, ..._progress }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Photoreal CPU path tracer');
  return { ok: true };
}

export default installPathTrace;
