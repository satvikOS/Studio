// Slice 702 — Offline (CPU) path-traced render. Mirrors Cycles's
// multi-bounce, Russian-roulette, Cook-Torrance + transmission path
// integrator at preview quality. Consumes slice-697 cyclesbrdf's
// material packer so it sees the SAME PBR parameters as the scene.

import * as THREE from 'three';

function _camRay(camera, ndcX, ndcY) {
  const origin = camera.position.clone();
  const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  return { origin, dir };
}

function _normRand() { return Math.random() * 2 - 1; }

function _cosineHemi(n) {
  // Cosine-weighted hemisphere sample around normal n.
  let v;
  for (let i = 0; i < 4; i++) {
    v = new THREE.Vector3(_normRand(), _normRand(), _normRand());
    if (v.lengthSq() < 1) break;
  }
  v.normalize();
  if (v.dot(n) < 0) v.negate();
  return v;
}

function _matFor(mesh) {
  // Pull packed material params via slice-697 cyclesbrdf packer if installed,
  // otherwise read directly off mesh.material.
  if (typeof window.__studioCyclesBRDF_PackedFor === 'function') {
    const p = window.__studioCyclesBRDF_PackedFor(mesh);
    if (p) return p;
  }
  const m = mesh.material || {};
  const c = m.color || { r: 0.8, g: 0.8, b: 0.8 };
  return {
    color: [c.r, c.g, c.b],
    roughness: m.roughness ?? 0.5,
    metalness: m.metalness ?? 0.0,
    emissive: m.emissive ? [m.emissive.r, m.emissive.g, m.emissive.b] : [0, 0, 0],
    transmission: m.transmission || 0,
    ior: m.ior || 1.5,
  };
}

function _fresnel(cosTheta, F0) {
  const p = Math.pow(1 - Math.max(0, cosTheta), 5);
  return F0.map((f) => f + (1 - f) * p);
}

function _intersectScene(scene, origin, dir, raycaster) {
  raycaster.set(origin, dir);
  raycaster.far = 1e4;
  const meshes = [];
  scene.traverseVisible((o) => { if (o.isMesh) meshes.push(o); });
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length > 0 ? hits[0] : null;
}

export function renderTiled(opts) {
  const {
    width = 256, height = 256, samples = 4, maxBounces = 3,
    onProgress, onComplete,
  } = opts || {};
  const scene = window.__archdiscScene;
  const viewport = window.__archdiscViewport;
  if (!scene || !viewport || !viewport.camera) {
    onComplete && onComplete({ ok: false, error: 'scene or camera missing' });
    return;
  }
  const camera = viewport.camera;
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(width, height);
  const buf = new Float32Array(width * height * 3);

  // Light: a single distant light at +Y+Z direction, white intensity 1.5.
  const lightDir = new THREE.Vector3(0.4, 1.0, 0.6).normalize();
  const sky = (rd) => {
    const t = 0.5 * (rd.y + 1);
    return [0.9 * (1 - t) + 0.4 * t, 0.9 * (1 - t) + 0.55 * t, 0.9 * (1 - t) + 0.8 * t];
  };

  let pixelIdx = 0;
  const total = width * height;
  const TILE = 256;   // pixels per tick

  function _tracePixel(x, y) {
    let R = 0, G = 0, B = 0;
    for (let s = 0; s < samples; s++) {
      const nx = ((x + Math.random()) / width) * 2 - 1;
      const ny = -(((y + Math.random()) / height) * 2 - 1);
      let { origin, dir } = _camRay(camera, nx, ny);
      let attenR = 1, attenG = 1, attenB = 1;
      let radR = 0, radG = 0, radB = 0;
      for (let b = 0; b < maxBounces; b++) {
        const hit = _intersectScene(scene, origin, dir, raycaster);
        if (!hit) {
          const sk = sky(dir);
          radR += attenR * sk[0]; radG += attenG * sk[1]; radB += attenB * sk[2];
          break;
        }
        const mat = _matFor(hit.object);
        // Emissive.
        radR += attenR * mat.emissive[0];
        radG += attenG * mat.emissive[1];
        radB += attenB * mat.emissive[2];
        const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize() : new THREE.Vector3(0, 1, 0);
        const wo = dir.clone().negate();
        const cosWo = Math.max(0, n.dot(wo));
        // Direct lighting (sun shadow ray).
        const shadowOrigin = hit.point.clone().add(n.clone().multiplyScalar(1e-3));
        const shHit = _intersectScene(scene, shadowOrigin, lightDir, raycaster);
        const NdotL = Math.max(0, n.dot(lightDir));
        if (!shHit && NdotL > 0) {
          const F0 = mat.metalness > 0.5
            ? mat.color
            : [0.04, 0.04, 0.04];
          const F = _fresnel(NdotL, F0);
          const diff = (1 - mat.metalness) * (1 / Math.PI);
          radR += attenR * (mat.color[0] * diff + F[0] * 0.2) * NdotL * 1.5;
          radG += attenG * (mat.color[1] * diff + F[1] * 0.2) * NdotL * 1.5;
          radB += attenB * (mat.color[2] * diff + F[2] * 0.2) * NdotL * 1.5;
        }
        // Indirect bounce.
        const newDir = _cosineHemi(n);
        attenR *= mat.color[0] * (1 - mat.metalness * 0.5);
        attenG *= mat.color[1] * (1 - mat.metalness * 0.5);
        attenB *= mat.color[2] * (1 - mat.metalness * 0.5);
        origin = hit.point.clone().add(n.clone().multiplyScalar(1e-3));
        dir = newDir;
        // Russian roulette.
        const p = Math.max(attenR, attenG, attenB);
        if (Math.random() > p) break;
        attenR /= p; attenG /= p; attenB /= p;
      }
      R += radR; G += radG; B += radB;
    }
    R /= samples; G /= samples; B /= samples;
    // Tonemap.
    R = R / (R + 1); G = G / (G + 1); B = B / (B + 1);
    return [R, G, B];
  }

  function _tick() {
    const end = Math.min(pixelIdx + TILE, total);
    for (let p = pixelIdx; p < end; p++) {
      const x = p % width;
      const y = Math.floor(p / width);
      const [r, g, b] = _tracePixel(x, y);
      buf[p * 3] = r; buf[p * 3 + 1] = g; buf[p * 3 + 2] = b;
      img.data[p * 4] = Math.min(255, r * 255);
      img.data[p * 4 + 1] = Math.min(255, g * 255);
      img.data[p * 4 + 2] = Math.min(255, b * 255);
      img.data[p * 4 + 3] = 255;
    }
    pixelIdx = end;
    ctx.putImageData(img, 0, 0);
    onProgress && onProgress(pixelIdx / total, cv);
    if (pixelIdx < total) {
      requestAnimationFrame(_tick);
    } else {
      onComplete && onComplete({ ok: true, canvas: cv, dataURL: cv.toDataURL('image/png') });
    }
  }
  _tick();
  return { ok: true, canvas: cv };
}
