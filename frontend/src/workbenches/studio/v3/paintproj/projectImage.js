// ArchDisc Studio V3 — Mari-style whole-image projection.
//
// `projectImageFromCamera(meshUuid, imageDataUrl)` takes a 2D image
// (PNG / JPG data URL), walks every pixel mapped onto the current
// viewport's view frustum, and:
//   1. Builds an NDC ray for that pixel.
//   2. Casts the ray against the scene.
//   3. If the hit is on the target mesh, the pixel's RGBA is written
//      into the mesh's mat.map at the hit UV coord.
//
// This is the "decal" half of projection painting — exactly how Mari /
// Substance Painter project a photograph onto a 3D surface.
//
// Notes:
//   - We sample the source image at the target pixel resolution
//     (PROJECTION_SAMPLE_RES × PROJECTION_SAMPLE_RES) by drawing it into
//     an offscreen canvas — that keeps raycast count bounded regardless
//     of source image size. Default 192×192 ≈ 36 864 rays, runs in
//     well under a second on a modern CPU.
//   - Only pixels whose closest hit is on the requested mesh contribute
//     (so projection respects occlusion — back faces & occluded faces
//     get the front-most pixel's colour, not the back's).
//   - `meshUuid` may be null / undefined → projects onto whichever mesh
//     each ray hits first.

import * as THREE from 'three';
import { gatherPaintables, uvAtHit } from './raycaster.js';
import { getOrCreateCanvas, writeTexel, DEFAULT_TEX_SIZE, PAINTPROJ_MARKER } from './canvasPaint.js';

export const PROJECTION_SAMPLE_RES = 192;

function _viewport() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscViewport || null;
}

function _decodeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') return reject(new Error('no Image'));
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e || new Error('image decode failed'));
    try {
      // Canvas is fine for same-origin / data URLs (no CORS taint).
      img.crossOrigin = 'anonymous';
    } catch (_) {}
    img.src = dataUrl;
  });
}

// Internal — sample the source image into an `ImageData` of size sxs
// using a 2D canvas.  Caller does NOT need to worry about flipY: we
// match the orientation of the user's image (top-left origin).
function _sampleImage(img, size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

// Public — project an image onto a single mesh's mat.map from the
// current camera viewpoint. Returns a Promise → { ok, pixelsPainted }.
export async function projectImageFromCamera(meshUuid, imageDataUrl, opts) {
  const o = opts || {};
  const sampleRes = Math.max(8, (o.sampleRes | 0) || PROJECTION_SAMPLE_RES);
  const vp = _viewport();
  if (!vp || !vp.scene || !vp.camera) return { ok: false, error: 'no viewport' };
  if (!imageDataUrl || typeof imageDataUrl !== 'string') return { ok: false, error: 'no image' };

  let img;
  try { img = await _decodeImage(imageDataUrl); }
  catch (e) { return { ok: false, error: 'decode failed: ' + (e && e.message || e) }; }

  const pixels = _sampleImage(img, sampleRes);
  const data = pixels.data; // Uint8ClampedArray, RGBA

  // Resolve the target mesh — `null` ⇒ paint whichever mesh each ray
  // hits first (still respects occlusion).
  let targetMesh = null;
  if (meshUuid) {
    vp.scene.traverse((m) => { if (m.uuid === meshUuid) targetMesh = m; });
    if (!targetMesh) return { ok: false, error: 'mesh uuid not found' };
  }

  const meshes = gatherPaintables(vp.scene);
  if (!meshes.length) return { ok: false, error: 'no paintable meshes' };

  // Cache the target canvas / ctx once so the inner loop is allocation-free.
  let canvasCache = null;
  if (targetMesh) {
    canvasCache = getOrCreateCanvas(targetMesh, DEFAULT_TEX_SIZE);
    if (!canvasCache) return { ok: false, error: 'no canvas' };
  }

  // Reuse a single Raycaster + Vector2 to keep GC quiet.
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const ndc = new THREE.Vector2();
  vp.camera.updateMatrixWorld(true);
  if (vp.camera.matrixWorldInverse) vp.camera.matrixWorldInverse.copy(vp.camera.matrixWorld).invert();

  let painted = 0;
  let hitTotal = 0;

  // Walk every pixel of the sampled image. (i, j) in image-pixel space
  // → NDC. Image origin is top-left, NDC y is +up, so we flip y.
  for (let j = 0; j < sampleRes; j++) {
    const ndcY = -((j + 0.5) / sampleRes * 2 - 1);
    for (let i = 0; i < sampleRes; i++) {
      const ndcX = (i + 0.5) / sampleRes * 2 - 1;
      ndc.x = ndcX; ndc.y = ndcY;
      ray.setFromCamera(ndc, vp.camera);
      const hits = ray.intersectObjects(meshes, false);
      if (!hits.length) continue;
      hitTotal++;
      const h = hits[0];
      // If we have a target mesh, only paint when the closest hit is
      // on that mesh — respects occlusion (back faces / occluded faces
      // are dropped, which is what Mari does).
      const obj = h.object;
      if (targetMesh && obj.uuid !== targetMesh.uuid) continue;
      const uv = uvAtHit(h);
      if (!uv) continue;

      const px = (j * sampleRes + i) * 4;
      const r = data[px], g = data[px + 1], b = data[px + 2], a = data[px + 3];
      if (a === 0) continue;
      // For non-target paths we may need to fetch the right canvas.
      let cache = canvasCache;
      if (!cache) cache = getOrCreateCanvas(obj, DEFAULT_TEX_SIZE);
      if (!cache) continue;
      const { canvas, ctx, tex } = cache;
      const W = canvas.width, H = canvas.height;
      const u = Math.max(0, Math.min(1, uv[0]));
      const v = Math.max(0, Math.min(1, uv[1]));
      const x = Math.round(u * (W - 1));
      const y = Math.round((1 - v) * (H - 1));
      // The brush "radius" here is sized so adjacent NDC samples blend
      // into each other on the texture (no gaps when the source image
      // covers a large surface area). Compute the radius from the
      // hit's distance to the next pixel's hit by projecting one
      // sample step in NDC into world-space — but for cost reasons we
      // pre-pick a 2-px radius which works well for sampleRes = 192.
      const radius = Math.max(1, Math.round(W / sampleRes / 6));
      ctx.save();
      ctx.globalAlpha = a / 255;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (tex) tex.needsUpdate = true;
      // Tag the mesh as projection-painted so the export pipeline picks it up.
      obj.userData = obj.userData || {};
      obj.userData[PAINTPROJ_MARKER] = {
        ts: Date.now(),
        texSize: [W, H],
        source: 'projection',
      };
      painted++;
    }
  }
  return { ok: true, pixelsPainted: painted, raysCast: sampleRes * sampleRes, raysHit: hitTotal, sampleRes };
}

// Re-export writeTexel for tests that want to stamp a single texel by
// UV after projection (e.g. dot-the-i sanity check).
export { writeTexel };
