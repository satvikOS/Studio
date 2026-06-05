// ArchDisc Studio V3 — GPU path tracer scene packer.
//
// Walks the live `__archdiscScene` graph, extracts every traceable mesh
// (filtered against gizmos / helpers / wireframes / UI overlays, same
// rules the CPU tracer in rt/pathtracer.js uses), and packs the
// resulting triangle soup into Float32 DataTextures that the fragment
// shader fetches via `texelFetch`.
//
// Texture layout
// ──────────────
// Every texel is RGBA32F (the WebGL2 minimum-supported sized format
// for Float32 sampling + render-target attachment is RGBA16F, but
// FLOAT positions need full precision — sampling-only Float32 textures
// are widely supported via OES_texture_float_linear). We never *render*
// into these textures so the render-target restriction doesn't apply.
//
//   posTex (uTexPos)    width × 3   — vertex positions (xyz, w=0)
//   nrmTex (uTexNrm)    width × 3   — vertex normals   (xyz, w=0)
//   albTex (uTexAlb)    width × 1   — albedo.rgb + emissive flag (a)
//
// where `width` is the next-power-of-2 ≥ triangleCount, capped at 4096
// (WebGL2's guaranteed minimum max texture size). With width = 4096 the
// soup tops out at ~4096 triangles, which is the documented v1 limit.
// Larger scenes still build — we just emit the first 4096 tris and a
// `truncated` flag the caller can surface.
//
// Public API
// ──────────
//   collectTraceableMeshes(scene)  → Mesh[]
//   buildSceneTextures(scene)      → { posTex, nrmTex, albTex, triCount,
//                                      truncated, sunDir, sunColor,
//                                      skyTop, skyBot, hashKey }
//   disposeSceneTextures(scenePack)
//
// The returned `hashKey` is a coarse fingerprint of (mesh count + first
// few mesh UUIDs + total tri count) so the renderer can cheap-detect
// whether the scene has changed since the last rebuild.

import * as THREE from 'three';

// Hard upper bound — matches the texture-width cap encoded in
// pathshader.frag.js's `for (int i = 0; i < 4096; i++)` loop.
export const MAX_TRIANGLES = 4096;

// Predicate copied from rt/pathtracer.js with minor inlining. Keeping a
// local copy avoids a cross-module dep on the CPU tracer (and lets the
// two paths diverge if/when one needs different filtering).
function _isTraceableMesh(obj) {
  if (!obj || !obj.isMesh) return false;
  if (obj.userData) {
    if (obj.userData.isHelper) return false;
    if (obj.userData.archdiscStudioHelper) return false;
    if (obj.userData.archdiscStudioGizmo) return false;
    if (obj.userData.archdiscStudioGrid) return false;
    if (obj.userData.archdiscStudioGround) return false;
    if (obj.userData.archdiscStudioCameraHelper) return false;
    if (obj.userData.pickable === false && !obj.userData.archdiscStudioPrimitive) return false;
  }
  const nm = (obj.name || '').toLowerCase();
  if (nm.startsWith('__')) return false;
  if (nm.includes('helper')) return false;
  if (nm.includes('gizmo')) return false;
  if (nm.includes('grid')) return false;
  if (obj.material && obj.material.wireframe) return false;
  // Skip TransformControls / helper subtrees.
  let p = obj.parent;
  while (p) {
    if (p.isTransformControls) return false;
    if (p.userData && (p.userData.isHelper || p.userData.archdiscStudioHelper)) return false;
    p = p.parent;
  }
  return true;
}

export function collectTraceableMeshes(scene) {
  const out = [];
  if (!scene || typeof scene.traverse !== 'function') return out;
  scene.traverse((o) => {
    if (_isTraceableMesh(o)
      && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      out.push(o);
    }
  });
  return out;
}

// Read the first DirectionalLight in the scene (sun-key) — same logic
// as the CPU tracer so the GPU pass agrees on lighting direction.
function _findSun(scene) {
  if (!scene || !scene.traverse) return null;
  let sun = null;
  scene.traverse((o) => {
    if (sun) return;
    if (o.isDirectionalLight && o.visible !== false && (o.intensity || 0) > 0) sun = o;
  });
  if (!sun) return null;
  const dir = new THREE.Vector3();
  if (sun.target && sun.target.isObject3D) {
    dir.subVectors(sun.position, sun.target.position).normalize();
  } else {
    dir.copy(sun.position).normalize();
  }
  return {
    dir: [dir.x, dir.y, dir.z],
    color: [sun.color.r * sun.intensity,
            sun.color.g * sun.intensity,
            sun.color.b * sun.intensity],
  };
}

// Read background gradient stops if api.js's `__studioGetSkyGradient` is
// installed; otherwise fall back to the same cool-sky / warm-ground mix
// the CPU tracer uses so both engines agree about the environment.
function _skyStops() {
  try {
    if (typeof window !== 'undefined' && typeof window.__studioGetSkyGradient === 'function') {
      const g = window.__studioGetSkyGradient();
      if (g && g.top && g.bot) {
        return { top: [g.top.r, g.top.g, g.top.b], bot: [g.bot.r, g.bot.g, g.bot.b] };
      }
    }
  } catch (_) { /* ignore */ }
  return {
    top: [0.55, 0.72, 1.00],   // cool sky
    bot: [0.85, 0.75, 0.60],   // warm ground bounce
  };
}

function _albedoFor(material) {
  const m = Array.isArray(material) ? material[0] : material;
  if (!m) return { r: 0.7, g: 0.7, b: 0.7, emissive: 0 };
  const c = m.color || { r: 0.7, g: 0.7, b: 0.7 };
  const e = m.emissive || null;
  const ei = (typeof m.emissiveIntensity === 'number') ? m.emissiveIntensity : 1.0;
  const emr = e ? e.r * ei : 0;
  const emg = e ? e.g * ei : 0;
  const emb = e ? e.b * ei : 0;
  const emissive = (emr + emg + emb) > 0.05;
  return {
    r: c.r != null ? c.r : 0.7,
    g: c.g != null ? c.g : 0.7,
    b: c.b != null ? c.b : 0.7,
    emissive: emissive ? 1.0 : 0.0,
  };
}

// Round triCount up to the next pixel-aligned width so the texture is
// always a whole number of texels. Capped at MAX_TRIANGLES.
function _texWidthFor(triCount) {
  if (triCount <= 0) return 1;
  // The packed textures must be sampled with integer coords — we don't
  // need POT, just a width ≥ triCount. Cap at MAX_TRIANGLES.
  return Math.min(MAX_TRIANGLES, Math.max(1, triCount));
}

function _makeFloat32Texture(width, height) {
  const data = new Float32Array(width * height * 4);
  const tex = new THREE.DataTexture(
    data, width, height,
    THREE.RGBAFormat, THREE.FloatType,
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Build a coarse identity key so the renderer can detect "scene changed
// enough to rebuild". Avoids re-packing each frame.
function _hashScene(meshes) {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ meshes.length, 16777619) >>> 0;
  for (let i = 0; i < Math.min(meshes.length, 8); i++) {
    const u = meshes[i].uuid || '';
    for (let k = 0; k < u.length; k++) {
      h = Math.imul(h ^ u.charCodeAt(k), 16777619) >>> 0;
    }
    // Mix in transform so simple moves bust the cache.
    meshes[i].updateWorldMatrix(true, false);
    const m = meshes[i].matrixWorld.elements;
    for (let k = 0; k < 16; k++) {
      const v = (m[k] * 1e4) | 0;
      h = Math.imul(h ^ (v + 0x9E3779B9), 16777619) >>> 0;
    }
  }
  return h >>> 0;
}

export function buildSceneTextures(scene) {
  const meshes = collectTraceableMeshes(scene);

  // Pre-pass to count triangles (capped at MAX_TRIANGLES).
  let triCount = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    triCount += idx ? (idx.count / 3) : (pos.count / 3);
  }
  const truncated = triCount > MAX_TRIANGLES;
  if (truncated) triCount = MAX_TRIANGLES;

  // Always allocate at least 1 texel so the texture stays valid even
  // for empty scenes (lets Start() succeed and the user can add meshes
  // and call __studioRTGPURebuildScene later).
  const width = _texWidthFor(triCount);
  const posTex = _makeFloat32Texture(width, 3);
  const nrmTex = _makeFloat32Texture(width, 3);
  const albTex = _makeFloat32Texture(width, 1);

  const posData = posTex.image.data;
  const nrmData = nrmTex.image.data;
  const albData = albTex.image.data;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  let written = 0;

  outer: for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    normalMatrix.getNormalMatrix(m.matrixWorld);
    const pos = m.geometry.attributes.position;
    const nrm = m.geometry.attributes.normal;
    const idx = m.geometry.index;
    const triN = idx ? (idx.count / 3) : (pos.count / 3);
    const alb = _albedoFor(m.material);

    for (let t = 0; t < triN; t++) {
      if (written >= MAX_TRIANGLES) break outer;
      const i0 = idx ? idx.getX(t * 3) : (t * 3);
      const i1 = idx ? idx.getX(t * 3 + 1) : (t * 3 + 1);
      const i2 = idx ? idx.getX(t * 3 + 2) : (t * 3 + 2);
      a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);

      // Normals: prefer per-vertex normals (smooth shading) and
      // fall back to the geometric face normal when the geometry
      // doesn't carry a normal attribute.
      if (nrm) {
        na.fromBufferAttribute(nrm, i0).applyMatrix3(normalMatrix).normalize();
        nb.fromBufferAttribute(nrm, i1).applyMatrix3(normalMatrix).normalize();
        nc.fromBufferAttribute(nrm, i2).applyMatrix3(normalMatrix).normalize();
      } else {
        const fnx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const fny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const fnz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const fl = Math.hypot(fnx, fny, fnz) || 1;
        na.set(fnx / fl, fny / fl, fnz / fl);
        nb.copy(na);
        nc.copy(na);
      }

      // Write three vertex rows per triangle: row 0 stores vertex 0
      // (at column = triIdx), row 1 stores vertex 1, row 2 stores vertex 2.
      const col = written;
      const stride0 = (0 * width + col) * 4;
      const stride1 = (1 * width + col) * 4;
      const stride2 = (2 * width + col) * 4;
      posData[stride0    ] = a.x;
      posData[stride0 + 1] = a.y;
      posData[stride0 + 2] = a.z;
      posData[stride0 + 3] = 0;
      posData[stride1    ] = b.x;
      posData[stride1 + 1] = b.y;
      posData[stride1 + 2] = b.z;
      posData[stride1 + 3] = 0;
      posData[stride2    ] = c.x;
      posData[stride2 + 1] = c.y;
      posData[stride2 + 2] = c.z;
      posData[stride2 + 3] = 0;
      nrmData[stride0    ] = na.x;
      nrmData[stride0 + 1] = na.y;
      nrmData[stride0 + 2] = na.z;
      nrmData[stride0 + 3] = 0;
      nrmData[stride1    ] = nb.x;
      nrmData[stride1 + 1] = nb.y;
      nrmData[stride1 + 2] = nb.z;
      nrmData[stride1 + 3] = 0;
      nrmData[stride2    ] = nc.x;
      nrmData[stride2 + 1] = nc.y;
      nrmData[stride2 + 2] = nc.z;
      nrmData[stride2 + 3] = 0;
      // Albedo row (one row, column = triIdx).
      const ao = col * 4;
      albData[ao    ] = alb.r;
      albData[ao + 1] = alb.g;
      albData[ao + 2] = alb.b;
      albData[ao + 3] = alb.emissive;
      written++;
    }
  }

  posTex.needsUpdate = true;
  nrmTex.needsUpdate = true;
  albTex.needsUpdate = true;

  const sun = _findSun(scene);
  const sky = _skyStops();
  return {
    posTex, nrmTex, albTex,
    triCount: written,
    truncated,
    sunDir:  sun ? sun.dir   : [0.5, 0.8, 0.3],
    sunColor: sun ? sun.color : [1.0, 0.95, 0.85],
    skyTop:  sky.top,
    skyBot:  sky.bot,
    hashKey: _hashScene(meshes),
    meshCount: meshes.length,
  };
}

export function disposeSceneTextures(pack) {
  if (!pack) return;
  try { pack.posTex && pack.posTex.dispose(); } catch (_) {}
  try { pack.nrmTex && pack.nrmTex.dispose(); } catch (_) {}
  try { pack.albTex && pack.albTex.dispose(); } catch (_) {}
}

// Internals exposed for unit/debug introspection.
export const __internals__ = {
  _isTraceableMesh, _findSun, _albedoFor, _makeFloat32Texture, _hashScene,
};
