// ArchDisc Studio V3 — primitive spawn helpers.
//
// Standalone primitive-spawn library so V3 can build a real working
// scene without V2 mounted. Matches V2's geometry shapes (PRIMITIVE_SIZE
// = 0.03 m so the Viewport3D mm-scale CAD camera frames them right) and
// the same `userData.archdiscStudioPrimitive = true` marker so the
// existing window.__studio* utilities (outliner traversal, BVH raycast,
// select-all, scene stats) all see V3-spawned meshes.
//
// One public entry point: spawnPrimitive(kind, scene, { material }).
// Returns the spawned Three.Mesh.

import * as THREE from 'three';

export const PRIMITIVE_SIZE = 0.03;

function buildGeometry(kind) {
  const S = PRIMITIVE_SIZE;
  switch (kind) {
    case 'cube':        return new THREE.BoxGeometry(S, S, S);
    case 'sphere':      return new THREE.SphereGeometry(S * 0.6, 32, 24);
    case 'plane':       return new THREE.PlaneGeometry(S * 1.6, S * 1.6);
    case 'cylinder':    return new THREE.CylinderGeometry(S * 0.5, S * 0.5, S, 32);
    case 'cone':        return new THREE.ConeGeometry(S * 0.55, S, 32);
    case 'torus':       return new THREE.TorusGeometry(S * 0.5, S * 0.18, 16, 32);
    case 'icosahedron': return new THREE.IcosahedronGeometry(S * 0.6, 0);
    case 'curve': {
      // Curves are unmeshable in this primitive helper — emit a thin
      // visible BufferGeometry line strip so the outliner counts it.
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        pts.push(new THREE.Vector3((t - 0.5) * S * 2, Math.sin(t * Math.PI * 2) * S * 0.4, 0));
      }
      return new THREE.BufferGeometry().setFromPoints(pts);
    }
    case 'empty': {
      // Empty (helper / null object) — a tiny invisible BoxGeometry so
      // the scene gets a transform anchor.
      const g = new THREE.BoxGeometry(0.0001, 0.0001, 0.0001);
      return g;
    }
    case 'text':
      // Text glyph stub — small flat plane until TextGeometry is wired
      // (font loader; lands in a later slice).
      return new THREE.PlaneGeometry(S * 1.2, S * 0.5);
    default:
      return new THREE.BoxGeometry(S, S, S);
  }
}

// Slightly off-position each new primitive so they don't overlap exactly
// when the user spam-clicks the same button.
let _spawnIndex = 0;
const _jitter = () => {
  _spawnIndex++;
  return [
    ((_spawnIndex * 7) % 5 - 2) * PRIMITIVE_SIZE * 0.4,
    ((_spawnIndex * 11) % 3 - 1) * PRIMITIVE_SIZE * 0.4,
    ((_spawnIndex * 5) % 5 - 2) * PRIMITIVE_SIZE * 0.4,
  ];
};

export function spawnPrimitive(kind, scene, opts = {}) {
  if (!scene) return null;
  const geom = buildGeometry(kind);
  const mat = opts.material || new THREE.MeshStandardMaterial({
    color: 0x9aa6b2,
    metalness: 0.05,
    roughness: 0.65,
    flatShading: false,
  });
  let mesh;
  if (kind === 'curve') {
    mesh = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xebecef }));
  } else if (kind === 'empty') {
    mesh = new THREE.Object3D();
  } else {
    mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  const [jx, jy, jz] = _jitter();
  mesh.position.set(jx, PRIMITIVE_SIZE * 0.5 + jy * 0, jz);
  mesh.name = `${kind}-${_spawnIndex}`;
  mesh.userData = {
    ...mesh.userData,
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: kind,
    pickable: true,
  };
  scene.add(mesh);
  // Mirror to V2's selected-mesh ref slot so any V2-leftover ops still
  // work if they happen to be loaded in the same window.
  if (window.__studioSelectMesh) {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return mesh;
}

export function clearPrimitives(scene) {
  if (!scene) return 0;
  const doomed = [];
  scene.traverse((o) => {
    if (o.userData && o.userData.archdiscStudioPrimitive) doomed.push(o);
  });
  doomed.forEach((o) => {
    scene.remove(o);
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose && m.dispose());
      else o.material.dispose && o.material.dispose();
    }
  });
  return doomed.length;
}

export function countPrimitives(scene) {
  if (!scene) return 0;
  let n = 0;
  scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
  return n;
}
