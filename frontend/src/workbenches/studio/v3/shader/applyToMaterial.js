// ArchDisc Studio V3 — graph → CanvasTexture compiler.
//
// Bakes a 256x256 image by per-pixel evaluating the graph. Uses a
// document.createElement('canvas') so the result is a real CanvasTexture
// usable as MeshStandardMaterial.map (sRGB). Falls back to a typed-array
// DataTexture only if `document` is unavailable (worker contexts).
//
// World-space sampling is approximated: x/z come from the UV interpreted
// as a top-down [-1..1] square; the host scene's bounding sphere is used
// to convert that to world units when a mesh is supplied.

import * as THREE from 'three';
import { evaluatePixel } from './graph.js';

const SIZE = 256;

function buildCtxFactory(mesh) {
  let scale = 1; let cx = 0, cy = 0, cz = 0;
  if (mesh && mesh.geometry) {
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const bs = mesh.geometry.boundingSphere;
    if (bs) { scale = bs.radius || 1; cx = bs.center.x; cy = bs.center.y; cz = bs.center.z; }
  }
  // Single ctx object reused per pixel — keeps GC pressure flat for 65k
  // evaluations. eval()s should never retain references.
  const ctx = { u: 0, v: 0, x: 0, y: 0, size: SIZE,
                worldX: 0, worldY: 0, worldZ: 0 };
  return (px, py) => {
    const u = px / (SIZE - 1);
    const v = py / (SIZE - 1);
    ctx.u = u; ctx.v = v; ctx.x = px; ctx.y = py;
    ctx.worldX = cx + (u * 2 - 1) * scale;
    ctx.worldY = cy;
    ctx.worldZ = cz + (v * 2 - 1) * scale;
    return ctx;
  };
}

// Bake the graph to a fresh ImageData and return both the canvas + dataURL.
export function bakeGraphToCanvas(graph, mesh) {
  const canvas = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : null;
  if (!canvas) {
    // Headless worker fallback: pack into a DataTexture-friendly Uint8.
    const data = new Uint8Array(SIZE * SIZE * 4);
    const mk = buildCtxFactory(mesh);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = evaluatePixel(graph, mk(x, y));
        const i = (y * SIZE + x) * 4;
        data[i]     = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
        data[i + 1] = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
        data[i + 2] = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
        data[i + 3] = 255;
      }
    }
    return { canvas: null, data, size: SIZE, dataUrl: null };
  }
  canvas.width = SIZE; canvas.height = SIZE;
  const cctx = canvas.getContext('2d');
  const img = cctx.createImageData(SIZE, SIZE);
  const arr = img.data;
  const mk = buildCtxFactory(mesh);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = evaluatePixel(graph, mk(x, y));
      const i = (y * SIZE + x) * 4;
      arr[i]     = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
      arr[i + 1] = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
      arr[i + 2] = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
      arr[i + 3] = 255;
    }
  }
  cctx.putImageData(img, 0, 0);
  let dataUrl = null;
  try { dataUrl = canvas.toDataURL('image/png'); } catch (_) { dataUrl = null; }
  return { canvas, data: arr, size: SIZE, dataUrl };
}

export function bakeGraphToTexture(graph, mesh) {
  const baked = bakeGraphToCanvas(graph, mesh);
  let tex;
  if (baked.canvas) {
    tex = new THREE.CanvasTexture(baked.canvas);
  } else {
    tex = new THREE.DataTexture(baked.data, baked.size, baked.size, THREE.RGBAFormat);
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return { tex, dataUrl: baked.dataUrl };
}

// Apply the baked texture to the supplied mesh's material as `.map`.
// Upgrades a non-standard material to MeshStandardMaterial so PBR maps
// flow through correctly (preserves color when possible).
export function applyGraphToMesh(graph, mesh) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const { tex, dataUrl } = bakeGraphToTexture(graph, mesh);
  let mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat || !(mat instanceof THREE.MeshStandardMaterial)) {
    const oldColor = mat && mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
    if (mat && mat.dispose) mat.dispose();
    mat = new THREE.MeshStandardMaterial({ color: oldColor, roughness: 0.7, metalness: 0.05 });
    if (Array.isArray(mesh.material)) mesh.material[0] = mat;
    else mesh.material = mat;
  }
  if (mat.map && mat.map.dispose) mat.map.dispose();
  mat.map = tex;
  // White base so the map's color survives the multiplication.
  if (mat.color) mat.color.set(0xffffff);
  mat.needsUpdate = true;
  // Persist a marker so callers can detect a graph-driven mesh.
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioShaderGraph = true;
  return { ok: true, dataUrl, size: 256 };
}
