// Slice 722 — Scene templates / "New > ..." starter scenes. One-call
// presets that populate the scene with curated content. Includes:
// emptyStudio, product3point (cyclorama + 3-point lighting),
// architectVisualizer (sun + ground + sky), characterScene (rigged
// figure + ground), heroShot (hero light + background), animationStage.

import * as THREE from 'three';

export function emptyStudio() {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  // Just a grid + ambient.
  scene.add(new THREE.GridHelper(20, 20, 0x444444, 0x333333));
  scene.add(new THREE.AmbientLight(0x404060, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 8, 5);
  scene.add(dir);
  return { ok: true };
}

export function product3PointScene() {
  if (typeof window.__studioStage3Point === 'function') window.__studioStage3Point();
  if (typeof window.__studioStageCyclorama === 'function') window.__studioStageCyclorama({ radius: 6, height: 4 });
  // Add a placeholder pedestal.
  const scene = window.__archdiscScene;
  if (scene) {
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.7, 0.4, 32),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3, metalness: 0.7 }));
    pedestal.position.y = 0.2;
    pedestal.name = 'pedestal';
    scene.add(pedestal);
  }
  return { ok: true };
}

export function architectVisualizer() {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  if (typeof window.__studioSketchUpSetSolar === 'function') {
    window.__studioSketchUpSetSolar(new Date().toISOString(), 40.7, -74.0);
  }
  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x787a6c, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  scene.add(ground);
  // Sky.
  scene.background = new THREE.Color(0xc4d8e8);
  return { ok: true };
}

export function characterScene() {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  emptyStudio();
  if (typeof window.__studioHumanIKAutoRig === 'function') {
    // Create a placeholder humanoid mesh.
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.25, 1.2, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0xb8a079, roughness: 0.7 }));
    body.position.y = 0.85;
    body.name = 'humanoid';
    scene.add(body);
    try { window.__studioHumanIKAutoRig(body.uuid); } catch (_) {}
  }
  return { ok: true };
}

export function heroShot() {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  scene.background = new THREE.Color(0x222233);
  if (typeof window.__studioStageRimLight === 'function') window.__studioStageRimLight({ intensity: 2.5 });
  const fill = new THREE.AmbientLight(0x202830, 0.3);
  scene.add(fill);
  return { ok: true };
}

export function animationStage() {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  emptyStudio();
  // Floor with grid.
  scene.add(new THREE.GridHelper(40, 40, 0x666666, 0x444444));
  if (typeof window.__studioOceanCreate === 'function') {
    // (Skip ocean — too heavy for animation stage default.)
  }
  return { ok: true };
}

export function applyTemplate(name) {
  switch (name) {
    case 'emptyStudio': return emptyStudio();
    case 'product3point': return product3PointScene();
    case 'architectVisualizer': return architectVisualizer();
    case 'characterScene': return characterScene();
    case 'heroShot': return heroShot();
    case 'animationStage': return animationStage();
    default: return { ok: false, error: 'unknown template' };
  }
}

export function listTemplates() {
  return {
    ok: true,
    templates: [
      { name: 'emptyStudio', label: 'Empty Studio' },
      { name: 'product3point', label: 'Product 3-Point' },
      { name: 'architectVisualizer', label: 'Architecture Visualizer' },
      { name: 'characterScene', label: 'Character Scene' },
      { name: 'heroShot', label: 'Hero Shot' },
      { name: 'animationStage', label: 'Animation Stage' },
    ],
  };
}
