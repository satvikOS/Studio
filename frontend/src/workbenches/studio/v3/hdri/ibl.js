// Slice 704 — HDRI image-based lighting + importance sampling.
// Loads an equirectangular HDR (RGBE / .hdr) or 32-bit float image,
// builds the scene environment texture, and computes a CDF for
// importance sampling so emitter samples concentrate on bright
// sources (sun discs, lamps). Mirrors KeyShot / Cycles IBL paths.

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { PMREMGenerator } from 'three';

let _currentTexture = null;
let _currentEnvMap = null;
let _pmremGen = null;
let _cdf = null;     // Float32Array, marginal+conditional sampler

function _pmrem() {
  if (_pmremGen) return _pmremGen;
  const r = window.__archdiscViewport?.renderer;
  if (!r) return null;
  _pmremGen = new PMREMGenerator(r);
  return _pmremGen;
}

function _buildCDF(rgbeTex) {
  if (!rgbeTex.image) return null;
  const w = rgbeTex.image.width;
  const h = rgbeTex.image.height;
  const data = rgbeTex.image.data;
  if (!data) return null;
  // Build luminance × sin(θ) weight per row.
  const lum = new Float32Array(w * h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    const sinT = Math.sin(Math.PI * (y + 0.5) / h);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * (data.length / (w * h));   // RGBA float
      const r = data[i] || 0, g = data[i + 1] || 0, b = data[i + 2] || 0;
      const l = (0.299 * r + 0.587 * g + 0.114 * b) * sinT;
      lum[y * w + x] = l;
      total += l;
    }
  }
  // Build cumulative CDF.
  const cdf = new Float32Array(lum.length);
  let acc = 0;
  for (let i = 0; i < lum.length; i++) {
    acc += lum[i];
    cdf[i] = acc / total;
  }
  return { cdf, w, h, total };
}

export function loadHDRI(url) {
  return new Promise((resolve) => {
    const loader = new RGBELoader();
    loader.setDataType(THREE.FloatType);
    loader.load(url,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        _currentTexture = texture;
        const pmrem = _pmrem();
        if (pmrem) {
          const envMap = pmrem.fromEquirectangular(texture).texture;
          _currentEnvMap = envMap;
          if (window.__archdiscScene) {
            window.__archdiscScene.environment = envMap;
            window.__archdiscScene.background = envMap;
          }
        }
        _cdf = _buildCDF(texture);
        resolve({ ok: true, width: texture.image?.width, height: texture.image?.height });
      },
      undefined,
      (err) => resolve({ ok: false, error: err?.message || String(err) }));
  });
}

export function setIntensity(mul) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  scene.environmentIntensity = Math.max(0, Number(mul) || 0);
  return { ok: true };
}

export function setBackgroundVisible(show) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  scene.background = show ? (_currentEnvMap || _currentTexture) : null;
  return { ok: true };
}

export function clearHDRI() {
  const scene = window.__archdiscScene;
  if (scene) {
    scene.environment = null;
    scene.background = null;
  }
  if (_currentEnvMap) _currentEnvMap.dispose?.();
  if (_currentTexture) _currentTexture.dispose?.();
  _currentEnvMap = null; _currentTexture = null; _cdf = null;
  return { ok: true };
}

// Importance-sample one direction (returns a unit vector + pdf).
export function sampleDirection() {
  if (!_cdf) return { ok: false };
  const r = Math.random();
  let lo = 0, hi = _cdf.cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (_cdf.cdf[mid] < r) lo = mid + 1; else hi = mid;
  }
  const x = lo % _cdf.w;
  const y = Math.floor(lo / _cdf.w);
  const u = (x + 0.5) / _cdf.w;
  const v = (y + 0.5) / _cdf.h;
  const phi = u * 2 * Math.PI;
  const theta = v * Math.PI;
  const dx = Math.sin(theta) * Math.cos(phi);
  const dy = Math.cos(theta);
  const dz = Math.sin(theta) * Math.sin(phi);
  return { ok: true, dir: [dx, dy, dz], u, v, pdf: 1 / _cdf.total };
}

export function getStats() {
  return {
    ok: true,
    hasHDRI: !!_currentEnvMap,
    cdfSize: _cdf ? _cdf.cdf.length : 0,
    width: _currentTexture?.image?.width || 0,
    height: _currentTexture?.image?.height || 0,
  };
}
