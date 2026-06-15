// ArchDisc Studio V3 — Organic sculpt engine + form composer.
//
// The legacy systems/SculptEngine.js is mouse-driven, per-click, with O(n²)
// symmetry and flat per-vertex displacement — it can't produce, and Archie can't
// drive, a genuinely organic form. This is a headless, deterministic, brush-based
// sculpt engine on a WELDED multi-resolution icosphere (shared edges → no cracks)
// with real DCC-style brushes (clay / draw / inflate / crease / pinch / flatten /
// scrape / smooth / grab / erode / polish), X-symmetry, and multi-octave surface
// noise. composeOrganic() drives stroke recipes to 1:1 organic forms (rock, skull,
// stump, vessel, creature) so Archie gets a real sculpt, not a primitive blockout.
//
// window.__studioSculptOrganic(formId, seed) clears the scene and builds the form.

import * as THREE from 'three';

/* ---------- deterministic RNG + value noise ---------- */
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash3(ix, iy, iz, seed) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 362437) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
function fbm(x, y, z, seed, octaves = 4) {
  let f = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { f += amp * vnoise(x * freq, y * freq, z * freq, seed + o * 17); norm += amp; amp *= 0.5; freq *= 2.03; }
  return f / norm; // [0,1]
}

/* ---------- welded subdivided icosphere (even topology for sculpting) ---------- */
function icosphere(radius, subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const mid = new Map();
  const midpoint = (a, b) => {
    const key = a < b ? a + '_' + b : b + '_' + a;
    const hit = mid.get(key); if (hit !== undefined) return hit;
    const va = verts[a], vb = verts[b];
    let m = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
    const l = Math.hypot(m[0], m[1], m[2]); m = [m[0] / l, m[1] / l, m[2] / l];
    const idx = verts.length; verts.push(m); mid.set(key, idx); return idx;
  };
  for (let s = 0; s < subdiv; s++) {
    const nf = [];
    for (const [a, b, c] of faces) { const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = nf;
  }
  const pos = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) { pos[i * 3] = verts[i][0] * radius; pos[i * 3 + 1] = verts[i][1] * radius; pos[i * 3 + 2] = verts[i][2] * radius; }
  const idx = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) { idx[i * 3] = faces[i][0]; idx[i * 3 + 1] = faces[i][1]; idx[i * 3 + 2] = faces[i][2]; }
  return { pos, idx };
}

/* ---------- sculpt session ---------- */
export class SculptSession {
  constructor(radius = 1, subdiv = 5) {
    const { pos, idx } = icosphere(radius, subdiv);
    this.pos = pos; this.idx = idx; this.N = pos.length / 3;
    this.nrm = new Float32Array(pos.length);
    this.adj = null;                 // built lazily for smooth/polish
    this.recomputeNormals();
  }
  recomputeNormals() {
    const { pos, idx, nrm } = this; nrm.fill(0);
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f] * 3, b = idx[f + 1] * 3, c = idx[f + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
      nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
      nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  }
  _buildAdj() {
    const adj = Array.from({ length: this.N }, () => new Set());
    const { idx } = this;
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f], b = idx[f + 1], c = idx[f + 2];
      adj[a].add(b); adj[a].add(c); adj[b].add(a); adj[b].add(c); adj[c].add(a); adj[c].add(b);
    }
    this.adj = adj.map((s) => Array.from(s));
  }
  // One brush dab. brush: clay|draw|inflate|crease|pinch|flatten|scrape|smooth|grab|erode|polish
  stroke({ brush = 'clay', center = [0, 0, 0], radius = 0.35, strength = 0.25, hardness = 1.4, dir = null, freq = 6, noiseSeed = 1, sign = 1 }) {
    const { pos, nrm, N } = this;
    const [cx, cy, cz] = center; const R2 = radius * radius;
    if ((brush === 'smooth' || brush === 'polish') && !this.adj) this._buildAdj();
    const buf = (brush === 'smooth' || brush === 'polish') ? pos.slice() : null;
    for (let i = 0; i < N; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const dx = x - cx, dy = y - cy, dz = z - cz; const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2) continue;
      const d = Math.sqrt(d2); let f = 1 - d / radius; if (f <= 0) continue; f = Math.pow(f, hardness);
      const s = strength * f;
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      if (brush === 'clay') { const ff = Math.min(1, f * 1.6) * strength; pos[i * 3] += nx * ff * radius * sign; pos[i * 3 + 1] += ny * ff * radius * sign; pos[i * 3 + 2] += nz * ff * radius * sign; }
      else if (brush === 'draw' || brush === 'inflate') { const k = (brush === 'inflate' ? 1.25 : 1) * s * radius * sign; pos[i * 3] += nx * k; pos[i * 3 + 1] += ny * k; pos[i * 3 + 2] += nz * k; }
      else if (brush === 'crease') { const k = Math.pow(f, 2.2) * strength * radius * sign; pos[i * 3] -= nx * k; pos[i * 3 + 1] -= ny * k; pos[i * 3 + 2] -= nz * k; /* + slight pinch */ pos[i * 3] += dx * -0.25 * s; pos[i * 3 + 1] += dy * -0.25 * s; pos[i * 3 + 2] += dz * -0.25 * s; }
      else if (brush === 'pinch') { pos[i * 3] -= dx * 0.6 * s; pos[i * 3 + 1] -= dy * 0.6 * s; pos[i * 3 + 2] -= dz * 0.6 * s; }
      else if (brush === 'flatten' || brush === 'scrape') {
        let pnx = nx, pny = ny, pnz = nz; if (dir) { pnx = dir[0]; pny = dir[1]; pnz = dir[2]; }
        const dot = (x - cx) * pnx + (y - cy) * pny + (z - cz) * pnz; // signed dist to plane@center
        const k = dot * s * (brush === 'scrape' ? 1.1 : 0.9);
        pos[i * 3] -= pnx * k; pos[i * 3 + 1] -= pny * k; pos[i * 3 + 2] -= pnz * k;
      } else if (brush === 'grab') { const g = dir || [0, 0, 0]; pos[i * 3] += g[0] * f; pos[i * 3 + 1] += g[1] * f; pos[i * 3 + 2] += g[2] * f; }
      else if (brush === 'erode') { const nval = fbm(x * freq, y * freq, z * freq, noiseSeed, 4) - 0.5; const k = nval * strength * radius * 2; pos[i * 3] += nx * k; pos[i * 3 + 1] += ny * k; pos[i * 3 + 2] += nz * k; }
      else if (brush === 'smooth' || brush === 'polish') {
        const ns = this.adj[i]; if (!ns.length) continue; let ax = 0, ay = 0, az = 0;
        for (const j of ns) { ax += buf[j * 3]; ay += buf[j * 3 + 1]; az += buf[j * 3 + 2]; }
        ax /= ns.length; ay /= ns.length; az /= ns.length;
        const lf = s; pos[i * 3] += (ax - x) * lf; pos[i * 3 + 1] += (ay - y) * lf; pos[i * 3 + 2] += (az - z) * lf;
      }
    }
    return this;
  }
  // symmetric (X) dab — applies at center and its mirror, flipping x of dir.
  symStroke(opts) { this.stroke(opts); const c = opts.center; const d = opts.dir; this.stroke({ ...opts, center: [-c[0], c[1], c[2]], dir: d ? [-d[0], d[1], d[2]] : null }); return this; }
  // global multi-octave organic skin
  erodeAll({ strength = 0.06, freq = 5, seed = 1, octaves = 4 } = {}) {
    const { pos, nrm, N } = this;
    for (let i = 0; i < N; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const k = (fbm(x * freq, y * freq, z * freq, seed, octaves) - 0.5) * strength * 2;
      pos[i * 3] += nrm[i * 3] * k; pos[i * 3 + 1] += nrm[i * 3 + 1] * k; pos[i * 3 + 2] += nrm[i * 3 + 2] * k;
    }
    return this;
  }
  toGeometry() {
    this.recomputeNormals();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    g.setIndex(new THREE.BufferAttribute(this.idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/* ---------- organic form recipes ---------- */
// Each recipe sculpts the icosphere into a recognisable organic form. Strokes are
// seeded so a form renders identically per seed. Returns the SculptSession.
const FORMS = {
  rock(seed) {
    const rng = mulberry32(seed); const S = new SculptSession(1, 5);
    S.stroke({ brush: 'flatten', center: [0, -1, 0], dir: [0, 1, 0], radius: 1.6, strength: 0.9, hardness: 0.8 }); // sit flat
    for (let k = 0; k < 10; k++) { const a = rng() * 6.28, e = (rng() - 0.3); const c = [Math.cos(a) * (0.5 + rng() * 0.5), e, Math.sin(a) * (0.5 + rng() * 0.5)]; S.stroke({ brush: 'clay', center: c, radius: 0.4 + rng() * 0.5, strength: 0.2 + rng() * 0.3, sign: rng() < 0.7 ? 1 : -1 }); S.recomputeNormals(); }
    for (let k = 0; k < 6; k++) { const a = rng() * 6.28; S.stroke({ brush: 'crease', center: [Math.cos(a), (rng() - 0.5) * 1.4, Math.sin(a)], radius: 0.25 + rng() * 0.25, strength: 0.5, hardness: 2.5 }); S.recomputeNormals(); }
    S.erodeAll({ strength: 0.09, freq: 4, seed, octaves: 5 });
    S.erodeAll({ strength: 0.03, freq: 13, seed: seed + 9, octaves: 3 });
    S.stroke({ brush: 'polish', center: [0, 1, 0], radius: 1.2, strength: 0.2 });
    return S;
  },
  skull(seed) {
    const rng = mulberry32(seed); const S = new SculptSession(1, 5);
    S.stroke({ brush: 'grab', center: [0, 0.45, 0.15], dir: [0, 0.45, 0.2], radius: 1.35, strength: 1 });    // tall cranium
    S.stroke({ brush: 'grab', center: [0, -0.75, 0.45], dir: [0, -0.45, 0.5], radius: 0.95, strength: 1 });  // jaw/snout fwd-down
    S.stroke({ brush: 'flatten', center: [0, -0.2, 1.05], dir: [0, 0, 1], radius: 0.7, strength: 0.45 });    // flatten the face plane
    S.recomputeNormals();
    // deep eye sockets — crease in, then carve with a small grab inward
    S.symStroke({ brush: 'crease', center: [0.33, 0.08, 0.82], radius: 0.36, strength: 1.0, hardness: 3.2 });
    S.symStroke({ brush: 'grab', center: [0.33, 0.08, 0.9], dir: [0, 0, -0.28], radius: 0.3, strength: 1 });
    S.recomputeNormals();
    S.symStroke({ brush: 'clay', center: [0.36, 0.34, 0.74], radius: 0.32, strength: 0.34 });                // brow ridge
    S.symStroke({ brush: 'crease', center: [0.62, 0.12, 0.55], radius: 0.34, strength: 0.55, hardness: 2.8 }); // temple hollow
    S.symStroke({ brush: 'scrape', center: [0.55, -0.3, 0.55], dir: [0.7, -0.1, 0.5], radius: 0.42, strength: 0.55 }); // cheek hollow
    S.symStroke({ brush: 'clay', center: [0.5, -0.35, 0.6], radius: 0.26, strength: 0.26 });                  // cheekbone
    S.recomputeNormals();
    S.stroke({ brush: 'crease', center: [0, -0.05, 1.08], radius: 0.18, strength: 0.55, hardness: 3.2 });     // nasal ridge
    S.symStroke({ brush: 'crease', center: [0.12, -0.18, 1.06], radius: 0.13, strength: 0.7, hardness: 3.5 });// nostril hint
    S.stroke({ brush: 'crease', center: [0, -0.62, 1.02], radius: 0.34, strength: 0.7, hardness: 2.6 });      // mouth line
    S.symStroke({ brush: 'crease', center: [0.16, -0.62, 1.0], radius: 0.06, strength: 0.5, hardness: 4 });   // teeth gaps
    S.symStroke({ brush: 'crease', center: [0.3, -0.62, 0.96], radius: 0.06, strength: 0.5, hardness: 4 });
    S.recomputeNormals();
    S.erodeAll({ strength: 0.03, freq: 9, seed, octaves: 4 });
    S.erodeAll({ strength: 0.012, freq: 24, seed: seed + 5, octaves: 2 }); // fine bone-pore micro-detail
    S.stroke({ brush: 'polish', center: [0, 0.35, 0.85], radius: 0.8, strength: 0.22 });                       // polish the dome only
    return S;
  },
  stump(seed) {
    const rng = mulberry32(seed); const S = new SculptSession(1, 5);
    S.stroke({ brush: 'grab', center: [0, 1, 0], dir: [0, 1.1, 0], radius: 2.2, strength: 1 });            // elongate up
    S.stroke({ brush: 'flatten', center: [0, 1.9, 0], dir: [0, 1, 0], radius: 1.2, strength: 0.8 });        // cut top
    S.stroke({ brush: 'flatten', center: [0, -1.0, 0], dir: [0, 1, 0], radius: 1.4, strength: 0.8 });       // base
    for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28 + rng() * 0.3; S.stroke({ brush: 'grab', center: [Math.cos(a) * 0.9, -0.85, Math.sin(a) * 0.9], dir: [Math.cos(a) * 0.5, -0.2, Math.sin(a) * 0.5], radius: 0.5, strength: 1 }); } // root flares
    S.recomputeNormals();
    for (let k = 0; k < 14; k++) { const a = k / 14 * 6.28; S.stroke({ brush: 'crease', center: [Math.cos(a) * 1.0, rng() * 1.4 - 0.3, Math.sin(a) * 1.0], radius: 0.16, strength: 0.45, hardness: 3 }); } // bark ridges
    S.recomputeNormals();
    S.erodeAll({ strength: 0.05, freq: 6, seed, octaves: 4 });
    S.erodeAll({ strength: 0.02, freq: 18, seed: seed + 3, octaves: 2 });
    return S;
  },
  vessel(seed) {
    const S = new SculptSession(1, 5);
    S.stroke({ brush: 'grab', center: [0, 1, 0], dir: [0, 0.7, 0], radius: 2.2, strength: 1 });
    S.stroke({ brush: 'pinch', center: [0, 1.4, 0], radius: 0.9, strength: 0.5 });    // neck
    S.stroke({ brush: 'inflate', center: [0, 0.1, 0], radius: 1.3, strength: 0.2 });  // belly
    S.stroke({ brush: 'flatten', center: [0, -1.0, 0], dir: [0, 1, 0], radius: 1.0, strength: 0.8 }); // base
    S.recomputeNormals();
    S.erodeAll({ strength: 0.02, freq: 9, seed, octaves: 3 });
    S.stroke({ brush: 'polish', center: [0, 0.2, 0], radius: 1.6, strength: 0.3 });
    return S;
  },
  creature(seed) {
    const rng = mulberry32(seed); const S = new SculptSession(1, 5);
    S.stroke({ brush: 'grab', center: [0, 0.6, 0.3], dir: [0, 0.5, 0.5], radius: 1.2, strength: 1 });        // head lob
    S.symStroke({ brush: 'grab', center: [0.9, -0.2, 0], dir: [0.6, -0.1, 0], radius: 0.7, strength: 1 });    // side limbs
    for (let k = 0; k < 8; k++) { const a = rng() * 6.28, e = rng() * 2 - 1; S.stroke({ brush: 'clay', center: [Math.cos(a), e, Math.sin(a)], radius: 0.3 + rng() * 0.3, strength: 0.25, sign: rng() < 0.8 ? 1 : -1 }); }
    S.recomputeNormals();
    S.symStroke({ brush: 'crease', center: [0.3, 0.5, 0.9], radius: 0.26, strength: 0.6, hardness: 2.6 });    // eyes
    S.stroke({ brush: 'crease', center: [0, 0.1, 1.05], radius: 0.3, strength: 0.55, hardness: 2.2 });         // mouth
    S.erodeAll({ strength: 0.05, freq: 7, seed, octaves: 4 });
    S.erodeAll({ strength: 0.018, freq: 22, seed: seed + 7, octaves: 2 }); // fine skin micro-detail
    return S;
  },
};

export const ORGANIC_FORMS = Object.keys(FORMS);

const MATERIAL = {
  rock:     { color: 0x8a8278, roughness: 0.95, metalness: 0.0 },
  skull:    { color: 0xcdc3a8, roughness: 0.7,  metalness: 0.0 },
  stump:    { color: 0x6b4f33, roughness: 0.92, metalness: 0.0 },
  vessel:   { color: 0xb06a44, roughness: 0.55, metalness: 0.05 },
  creature: { color: 0x6f8a5a, roughness: 0.78, metalness: 0.0 },
};

// Build the form and add it to the scene (cleared of prior organic builds), scaled
// to dominate the viewer. Returns {mesh, stats}.
export function composeOrganic(formId, scene, seed = 7, opts = {}) {
  const THREEref = (typeof window !== 'undefined' && window.__archdiscTHREE) || THREE;
  scene = scene || (typeof window !== 'undefined' && window.__archdiscScene) || null;
  const id = FORMS[formId] ? formId : 'rock';
  const S = FORMS[id](seed >>> 0 || 7);
  const geo = S.toGeometry();
  const m = MATERIAL[id] || MATERIAL.rock;
  const mat = new THREEref.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness, flatShading: false });
  const mesh = new THREEref.Mesh(geo, mat);
  const scale = opts.scale || 2.2; mesh.scale.setScalar(scale);
  // Centre on origin (sculpts are centred geometry) so the default
  // OrbitControls target frames them; opt-in sit-on-ground for scene use.
  geo.computeBoundingBox(); const ctr = geo.boundingBox.getCenter(new THREEref.Vector3());
  if (opts.sit) { mesh.position.y = -geo.boundingBox.min.y * scale; }
  else { mesh.position.set(-ctr.x * scale, -ctr.y * scale, -ctr.z * scale); }
  mesh.name = `organic:${id}`;
  mesh.userData.archdiscStudioPrimitive = true; mesh.userData.archdiscPrimitive = true; mesh.userData.organic = id;
  if (scene) {
    for (let i = scene.children.length - 1; i >= 0; i--) { const c = scene.children[i]; if (c && c.userData && c.userData.organic) scene.remove(c); }
    scene.add(mesh);
  }
  return { mesh, stats: { form: id, verts: S.N, tris: S.idx.length / 3, seed: seed >>> 0 || 7 } };
}

export function installOrganicSculpt() {
  if (typeof window === 'undefined') return;
  window.__studioSculptOrganic = (formId, seed, opts) => composeOrganic(formId, null, seed, opts || {});
  window.__studioOrganicForms = ORGANIC_FORMS;
}

export default installOrganicSculpt;
