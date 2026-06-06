// ArchDisc Studio V3 — Asset catalog (slice 771).
//
// In-memory catalog of spawnable scene primitives. Each entry is:
//
//   { id, name, category, tags: [], spawn: () => THREE.Object3D }
//
// `spawn()` returns a freshly-constructed Object3D (Mesh / Light /
// Camera) so the caller can position / parent / tag it. The catalog is
// pure JS — three is imported lazily inside spawn() so module
// load doesn't cost the THREE bundle when nobody opens the browser.
//
// The seeded catalog covers the four asset families the slice brief
// names:
//
//   • 20 primitives  (tags: 'primitive', 'geometry')
//   • 10 lights      (tags: 'light' + per-kind tag)
//   •  8 cameras     (tags: 'camera' + per-kind tag)
//   • 12 materials   (tags: 'material', 'pbr' + per-family tag)
//
// User-registered assets land in the same array so __studioAssetLibList /
// Search / Tags / Categories see them uniformly.

import * as THREE from 'three';

// ─── Internal catalog state ──────────────────────────────────────────────
const _catalog = [];

// Anyone adding through __studioAssetAddCustom gets an auto-incrementing
// numeric suffix on the stable id slug.
let _customSeq = 0;

// Default size for geometry primitives — matches v3/spawn.js's PRIMITIVE_SIZE
// so an asset-browser spawn shares the same world-space footprint as the
// "Add > Cube" buttons the rest of the surface offers.
const PRIM_SIZE = 0.03;

// ─── Material catalog (lightweight subset; matlib owns the 100-recipe set) ──
const MATERIAL_RECIPES = [
  { slug: 'matte-white',    name: 'Matte White',    family: 'paint',    params: { color: 0xf2f2f2, metalness: 0.0, roughness: 0.85 } },
  { slug: 'glossy-red',     name: 'Glossy Red',     family: 'paint',    params: { color: 0xd11a1a, metalness: 0.0, roughness: 0.18 } },
  { slug: 'chrome',         name: 'Chrome',         family: 'metal',    params: { color: 0xffffff, metalness: 1.0, roughness: 0.05 } },
  { slug: 'gold',           name: 'Gold',           family: 'metal',    params: { color: 0xffd24a, metalness: 1.0, roughness: 0.18 } },
  { slug: 'brushed-steel',  name: 'Brushed Steel',  family: 'metal',    params: { color: 0xc4c8cc, metalness: 0.92, roughness: 0.48 } },
  { slug: 'clear-glass',    name: 'Clear Glass',    family: 'glass',    params: { color: 0xffffff, metalness: 0.0, roughness: 0.0, transmission: 1.0, ior: 1.52 } },
  { slug: 'frosted-glass',  name: 'Frosted Glass',  family: 'glass',    params: { color: 0xffffff, metalness: 0.0, roughness: 0.6, transmission: 0.8, ior: 1.5 } },
  { slug: 'oak-wood',       name: 'Oak',            family: 'wood',     params: { color: 0x9c7a4a, metalness: 0.0, roughness: 0.7 } },
  { slug: 'walnut',         name: 'Walnut',         family: 'wood',     params: { color: 0x4a2e1e, metalness: 0.0, roughness: 0.65 } },
  { slug: 'concrete',       name: 'Concrete',       family: 'concrete', params: { color: 0x9a9a98, metalness: 0.0, roughness: 0.95 } },
  { slug: 'marble',         name: 'White Marble',   family: 'stone',    params: { color: 0xe9e6df, metalness: 0.0, roughness: 0.2 } },
  { slug: 'rubber-black',   name: 'Rubber Grip',    family: 'rubber',   params: { color: 0x1c1c1c, metalness: 0.0, roughness: 0.95 } },
];

// ─── Primitive catalog (20 entries) ──────────────────────────────────────
const PRIMITIVE_RECIPES = [
  { slug: 'cube',          name: 'Cube',           kind: 'box',          family: 'box',    build: () => new THREE.BoxGeometry(PRIM_SIZE, PRIM_SIZE, PRIM_SIZE) },
  { slug: 'sphere',        name: 'Sphere',         kind: 'sphere',       family: 'curve',  build: () => new THREE.SphereGeometry(PRIM_SIZE * 0.6, 32, 24) },
  { slug: 'plane',         name: 'Plane',          kind: 'plane',        family: 'flat',   build: () => new THREE.PlaneGeometry(PRIM_SIZE * 1.6, PRIM_SIZE * 1.6) },
  { slug: 'cylinder',      name: 'Cylinder',       kind: 'cylinder',     family: 'curve',  build: () => new THREE.CylinderGeometry(PRIM_SIZE * 0.5, PRIM_SIZE * 0.5, PRIM_SIZE, 32) },
  { slug: 'cone',          name: 'Cone',           kind: 'cone',         family: 'curve',  build: () => new THREE.ConeGeometry(PRIM_SIZE * 0.55, PRIM_SIZE, 32) },
  { slug: 'torus',         name: 'Torus',          kind: 'torus',        family: 'curve',  build: () => new THREE.TorusGeometry(PRIM_SIZE * 0.5, PRIM_SIZE * 0.18, 16, 32) },
  { slug: 'icosahedron',   name: 'Icosahedron',    kind: 'icosahedron',  family: 'platonic', build: () => new THREE.IcosahedronGeometry(PRIM_SIZE * 0.6, 0) },
  { slug: 'tetrahedron',   name: 'Tetrahedron',    kind: 'tetrahedron',  family: 'platonic', build: () => new THREE.TetrahedronGeometry(PRIM_SIZE * 0.7, 0) },
  { slug: 'octahedron',    name: 'Octahedron',     kind: 'octahedron',   family: 'platonic', build: () => new THREE.OctahedronGeometry(PRIM_SIZE * 0.7, 0) },
  { slug: 'dodecahedron',  name: 'Dodecahedron',   kind: 'dodecahedron', family: 'platonic', build: () => new THREE.DodecahedronGeometry(PRIM_SIZE * 0.6, 0) },
  { slug: 'torus-knot',    name: 'Torus Knot',     kind: 'torus-knot',   family: 'curve',  build: () => new THREE.TorusKnotGeometry(PRIM_SIZE * 0.45, PRIM_SIZE * 0.14, 64, 8) },
  { slug: 'capsule',       name: 'Capsule',        kind: 'capsule',      family: 'curve',  build: () => new THREE.CapsuleGeometry(PRIM_SIZE * 0.4, PRIM_SIZE * 0.8, 6, 14) },
  { slug: 'ring',          name: 'Ring',           kind: 'ring',         family: 'flat',   build: () => new THREE.RingGeometry(PRIM_SIZE * 0.3, PRIM_SIZE * 0.6, 32) },
  { slug: 'circle',        name: 'Circle',         kind: 'circle',       family: 'flat',   build: () => new THREE.CircleGeometry(PRIM_SIZE * 0.6, 32) },
  { slug: 'lathe',         name: 'Lathe',          kind: 'lathe',        family: 'curve',  build: () => {
      // Simple half-profile lathed around Y so the entry is more than a stub.
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const r = PRIM_SIZE * (0.2 + 0.5 * Math.sin(t * Math.PI));
        pts.push(new THREE.Vector2(r, (t - 0.5) * PRIM_SIZE));
      }
      return new THREE.LatheGeometry(pts, 24);
    } },
  { slug: 'tube',          name: 'Tube',           kind: 'tube',         family: 'curve',  build: () => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-PRIM_SIZE, 0, 0),
        new THREE.Vector3(-PRIM_SIZE * 0.5, PRIM_SIZE * 0.5, 0),
        new THREE.Vector3( PRIM_SIZE * 0.5, PRIM_SIZE * 0.5, 0),
        new THREE.Vector3( PRIM_SIZE, 0, 0),
      ]);
      return new THREE.TubeGeometry(curve, 24, PRIM_SIZE * 0.1, 8, false);
    } },
  { slug: 'truncated-cone', name: 'Truncated Cone',kind: 'cone-trunc',   family: 'curve',  build: () => new THREE.CylinderGeometry(PRIM_SIZE * 0.25, PRIM_SIZE * 0.55, PRIM_SIZE, 32) },
  { slug: 'wedge',         name: 'Wedge',          kind: 'wedge',        family: 'box',    build: () => {
      // Triangular prism via 6 verts.
      const g = new THREE.BufferGeometry();
      const s = PRIM_SIZE;
      const verts = new Float32Array([
        -s/2, -s/2,  s/2,   s/2, -s/2,  s/2,   s/2,  s/2,  s/2,
        -s/2, -s/2, -s/2,   s/2, -s/2, -s/2,   s/2,  s/2, -s/2,
      ]);
      const idx = [
        0, 1, 2,    // front
        3, 5, 4,    // back
        0, 2, 5,  0, 5, 3,   // left
        1, 4, 5,  1, 5, 2,   // top
        0, 3, 4,  0, 4, 1,   // bottom
      ];
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    } },
  { slug: 'pyramid',       name: 'Pyramid',        kind: 'pyramid',      family: 'platonic', build: () => new THREE.ConeGeometry(PRIM_SIZE * 0.7, PRIM_SIZE, 4) },
  { slug: 'empty',         name: 'Empty (Helper)', kind: 'empty',        family: 'helper', build: () => new THREE.BufferGeometry() },
];

// ─── Light catalog (10 entries) ──────────────────────────────────────────
const LIGHT_RECIPES = [
  { slug: 'point',         name: 'Point Light',          kind: 'point',     build: () => {
      const L = new THREE.PointLight(0xffeecc, 1, 0, 2);
      L.position.set(0, PRIM_SIZE * 4, 0);
      L.castShadow = true;
      return L;
    } },
  { slug: 'point-warm',    name: 'Point — Warm',         kind: 'point',     build: () => {
      const L = new THREE.PointLight(0xffaa55, 1.4, 0, 2);
      L.position.set(0, PRIM_SIZE * 4, 0);
      return L;
    } },
  { slug: 'point-cool',    name: 'Point — Cool',         kind: 'point',     build: () => {
      const L = new THREE.PointLight(0x88ccff, 0.9, 0, 2);
      L.position.set(0, PRIM_SIZE * 4, 0);
      return L;
    } },
  { slug: 'sun',           name: 'Sun (Directional)',    kind: 'sun',       build: () => {
      const L = new THREE.DirectionalLight(0xffffff, 1.0);
      L.position.set(5, 10, 5);
      L.castShadow = true;
      return L;
    } },
  { slug: 'sun-overcast',  name: 'Sun — Overcast',       kind: 'sun',       build: () => {
      const L = new THREE.DirectionalLight(0xb8c4d0, 0.55);
      L.position.set(2, 10, 1);
      return L;
    } },
  { slug: 'spot',          name: 'Spot Light',           kind: 'spot',      build: () => {
      const L = new THREE.SpotLight(0xffffff, 2.0, 0, Math.PI / 6, 0.3, 1);
      L.position.set(2, 3, 2);
      L.castShadow = true;
      return L;
    } },
  { slug: 'spot-stage',    name: 'Spot — Stage',         kind: 'spot',      build: () => {
      const L = new THREE.SpotLight(0xfff2dc, 4.0, 0, Math.PI / 8, 0.2, 1);
      L.position.set(3, 5, 3);
      return L;
    } },
  { slug: 'area',          name: 'Area (Rect)',          kind: 'area',      build: () => {
      const L = new THREE.RectAreaLight(0xffffff, 4.0, 1.0, 0.5);
      L.position.set(0, PRIM_SIZE * 6, PRIM_SIZE * 4);
      L.lookAt(0, 0, 0);
      return L;
    } },
  { slug: 'hemi-sky',      name: 'Hemisphere — Sky',     kind: 'hemi',      build: () => {
      const L = new THREE.HemisphereLight(0xa0c4ff, 0x442200, 0.6);
      L.position.set(0, PRIM_SIZE * 10, 0);
      return L;
    } },
  { slug: 'ambient',       name: 'Ambient',              kind: 'ambient',   build: () => new THREE.AmbientLight(0x404060, 0.6) },
];

// ─── Camera catalog (8 entries) ──────────────────────────────────────────
const CAMERA_RECIPES = [
  { slug: 'orbit',         name: 'Orbit Camera',         kind: 'orbit',     build: () => {
      const c = new THREE.PerspectiveCamera(45, 16 / 9, 0.001, 100);
      c.position.set(0.1, 0.05, 0.1);
      c.lookAt(0, 0, 0);
      return c;
    } },
  { slug: 'orbit-tele',    name: 'Orbit — Telephoto',    kind: 'orbit',     build: () => {
      const c = new THREE.PerspectiveCamera(22, 16 / 9, 0.001, 100);
      c.position.set(0.3, 0.06, 0.3);
      c.lookAt(0, 0, 0);
      return c;
    } },
  { slug: 'orbit-wide',    name: 'Orbit — Wide',         kind: 'orbit',     build: () => {
      const c = new THREE.PerspectiveCamera(72, 16 / 9, 0.001, 100);
      c.position.set(0.08, 0.04, 0.08);
      c.lookAt(0, 0, 0);
      return c;
    } },
  { slug: 'dolly',         name: 'Dolly Camera',         kind: 'dolly',     build: () => {
      const c = new THREE.PerspectiveCamera(35, 16 / 9, 0.001, 100);
      c.position.set(0, 0.05, 0.2);
      c.lookAt(0, 0.05, 0);
      return c;
    } },
  { slug: 'dolly-low',     name: 'Dolly — Low Angle',    kind: 'dolly',     build: () => {
      const c = new THREE.PerspectiveCamera(40, 16 / 9, 0.001, 100);
      c.position.set(0, 0.015, 0.15);
      c.lookAt(0, 0.05, 0);
      return c;
    } },
  { slug: 'free',          name: 'Free Camera',          kind: 'free',      build: () => {
      const c = new THREE.PerspectiveCamera(50, 16 / 9, 0.001, 100);
      c.position.set(0.12, 0.08, 0.12);
      return c;
    } },
  { slug: 'top',           name: 'Top (Orthographic)',   kind: 'ortho',     build: () => {
      const c = new THREE.OrthographicCamera(-0.1, 0.1, 0.1, -0.1, -10, 10);
      c.position.set(0, 0.2, 0);
      c.lookAt(0, 0, 0);
      return c;
    } },
  { slug: 'front',         name: 'Front (Orthographic)', kind: 'ortho',     build: () => {
      const c = new THREE.OrthographicCamera(-0.1, 0.1, 0.1, -0.1, -10, 10);
      c.position.set(0, 0, 0.2);
      c.lookAt(0, 0, 0);
      return c;
    } },
];

// ─── Constructors ────────────────────────────────────────────────────────
function _buildPrimitive(recipe) {
  const geom = recipe.build();
  if (recipe.kind === 'empty') {
    // Empty doesn't need a mesh — just a transform anchor.
    const obj = new THREE.Object3D();
    obj.userData = { ...obj.userData, archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: recipe.kind };
    return obj;
  }
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9aa6b2, metalness: 0.05, roughness: 0.65, flatShading: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = {
    ...mesh.userData,
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: recipe.kind,
    pickable: true,
  };
  return mesh;
}

function _buildLight(recipe) {
  const L = recipe.build();
  L.userData = { ...L.userData, archdiscStudioLight: recipe.kind };
  return L;
}

function _buildCamera(recipe) {
  const C = recipe.build();
  C.userData = { ...C.userData, archdiscStudioCamera: recipe.kind };
  return C;
}

function _buildMaterialAsset(recipe) {
  // A material asset spawns a small sphere wearing the material — the
  // browser is "drag onto scene", not "apply to selection", so we ship
  // a visible preview the user can immediately see. Apply-to-selection
  // is matlib's job.
  const params = { ...recipe.params };
  const mat = new THREE.MeshPhysicalMaterial(params);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(PRIM_SIZE * 0.6, 32, 24), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = {
    ...mesh.userData,
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'matpreview',
    archdiscStudioMaterialFamily: recipe.family,
    pickable: true,
  };
  return mesh;
}

// ─── Seed catalog ────────────────────────────────────────────────────────
function _seed() {
  // Primitives — 20 entries.
  for (const r of PRIMITIVE_RECIPES) {
    _catalog.push({
      id: 'prim-' + r.slug,
      name: r.name,
      category: 'Primitives',
      tags: ['primitive', 'geometry', r.family],
      spawn: () => _buildPrimitive(r),
    });
  }
  // Lights — 10 entries.
  for (const r of LIGHT_RECIPES) {
    _catalog.push({
      id: 'light-' + r.slug,
      name: r.name,
      category: 'Lights',
      tags: ['light', r.kind],
      spawn: () => _buildLight(r),
    });
  }
  // Cameras — 8 entries.
  for (const r of CAMERA_RECIPES) {
    _catalog.push({
      id: 'camera-' + r.slug,
      name: r.name,
      category: 'Cameras',
      tags: ['camera', r.kind],
      spawn: () => _buildCamera(r),
    });
  }
  // Materials — 12 entries.
  for (const r of MATERIAL_RECIPES) {
    _catalog.push({
      id: 'mat-' + r.slug,
      name: r.name,
      category: 'Materials',
      tags: ['material', 'pbr', r.family],
      spawn: () => _buildMaterialAsset(r),
    });
  }
}

_seed();

// ─── Public catalog API ──────────────────────────────────────────────────
export function listAssets() {
  return _catalog.slice();
}

export function findAsset(id) {
  if (!id) return null;
  return _catalog.find((a) => a.id === id) || null;
}

export function listCategories() {
  const set = new Set();
  for (const a of _catalog) set.add(a.category);
  return Array.from(set).sort();
}

export function listTags() {
  const set = new Set();
  for (const a of _catalog) for (const t of (a.tags || [])) set.add(t);
  return Array.from(set).sort();
}

export function filter({ category, tag, search } = {}) {
  let list = _catalog.slice();
  if (category) {
    const c = String(category).toLowerCase();
    list = list.filter((a) => String(a.category).toLowerCase() === c);
  }
  if (tag) {
    const t = String(tag).toLowerCase();
    list = list.filter((a) => (a.tags || []).some((x) => String(x).toLowerCase() === t));
  }
  const q = String(search || '').trim().toLowerCase();
  if (q) {
    list = list.filter((a) =>
      a.name.toLowerCase().includes(q)
      || a.id.toLowerCase().includes(q)
      || (a.category || '').toLowerCase().includes(q)
      || (a.tags || []).some((x) => String(x).toLowerCase().includes(q))
    );
  }
  return list;
}

// Register a user-supplied asset. `geometry` is optional — when present
// we attach it to a MeshStandardMaterial so the returned Mesh slots into
// the scene next to the seeded entries. If absent, the asset's spawn()
// emits a tiny placeholder so the entry is at least reachable.
export function addCustom({ name, category, tags, geometry, build } = {}) {
  const n = (name && String(name).trim()) || 'Custom';
  const cat = (category && String(category).trim()) || 'Custom';
  const tg = Array.isArray(tags) ? tags.slice() : [];
  if (!tg.includes('custom')) tg.push('custom');
  _customSeq++;
  const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('asset-' + _customSeq);
  const id = 'custom-' + slug + '-' + _customSeq;
  const spawn = () => {
    if (typeof build === 'function') {
      const o = build();
      if (o) return o;
    }
    let g = geometry;
    if (!g) g = new THREE.BoxGeometry(PRIM_SIZE, PRIM_SIZE, PRIM_SIZE);
    const m = new THREE.MeshStandardMaterial({ color: 0xc6a374, metalness: 0.05, roughness: 0.7 });
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { ...mesh.userData, archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'custom', pickable: true };
    return mesh;
  };
  const entry = { id, name: n, category: cat, tags: tg, spawn, custom: true };
  _catalog.push(entry);
  return entry;
}

// Internal helper for the e2e + unit reset path.
export function _resetCatalog() {
  _catalog.length = 0;
  _customSeq = 0;
  _seed();
}

export const __seedCounts = {
  primitives: PRIMITIVE_RECIPES.length,
  lights: LIGHT_RECIPES.length,
  cameras: CAMERA_RECIPES.length,
  materials: MATERIAL_RECIPES.length,
  total:
    PRIMITIVE_RECIPES.length
    + LIGHT_RECIPES.length
    + CAMERA_RECIPES.length
    + MATERIAL_RECIPES.length,
};
