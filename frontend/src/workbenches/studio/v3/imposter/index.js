// ArchDisc Studio V3 — imposter generation (slice 820).
// Render a mesh from N viewpoints into an octahedral atlas, then emit a
// camera-facing quad textured with the atlas. Unreal / SpeedTree
// imposter workflow for distant foliage.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _bake({ meshUuid, atlasSize = 1024, viewsPerAxis = 4 } = {}) {
  const vp = window.__archdiscViewport; if (!vp) return { ok: false };
  const scene = window.__archdiscScene;
  const m = scene?.getObjectByProperty('uuid', meshUuid); if (!m) return { ok: false };
  const { renderer } = vp;
  if (!renderer) return { ok: false, error: 'no renderer' };
  // Reserve a render target
  const cellSize = Math.floor(atlasSize / viewsPerAxis);
  const target = new THREE.WebGLRenderTarget(atlasSize, atlasSize);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const tempScene = new THREE.Scene();
  tempScene.background = new THREE.Color(0x000000);
  tempScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(2, 3, 1); tempScene.add(dir);
  // Bbox sphere fit
  m.geometry.computeBoundingSphere();
  const center = m.geometry.boundingSphere.center.clone().applyMatrix4(m.matrixWorld);
  const radius = m.geometry.boundingSphere.radius * 1.4;
  const camDist = radius / Math.sin(cam.fov * Math.PI / 360);
  const proxy = m.clone(); tempScene.add(proxy);
  for (let v = 0; v < viewsPerAxis; v++) {
    for (let u = 0; u < viewsPerAxis; u++) {
      const phi = (u / viewsPerAxis) * Math.PI * 2;
      const theta = (v / (viewsPerAxis - 1)) * Math.PI - Math.PI / 2;
      cam.position.set(
        center.x + Math.cos(theta) * Math.cos(phi) * camDist,
        center.y + Math.sin(theta) * camDist,
        center.z + Math.cos(theta) * Math.sin(phi) * camDist,
      );
      cam.lookAt(center);
      renderer.setRenderTarget(target);
      renderer.setViewport(u * cellSize, v * cellSize, cellSize, cellSize);
      renderer.setScissor(u * cellSize, v * cellSize, cellSize, cellSize);
      renderer.setScissorTest(true);
      renderer.render(tempScene, cam);
    }
  }
  renderer.setScissorTest(false);
  renderer.setRenderTarget(null);
  // Make a quad textured with the atlas
  const tex = target.texture;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 });
  const quadGeom = new THREE.PlaneGeometry(radius * 2, radius * 2);
  const imposter = new THREE.Mesh(quadGeom, mat);
  imposter.position.copy(center);
  imposter.userData.archdiscStudioPrimitive = true;
  imposter.userData.archdiscStudioPrimitiveKind = 'imposter';
  imposter.userData.archdiscStudioImposterRef = meshUuid;
  scene.add(imposter);
  return { ok: true, uuid: imposter.uuid, views: viewsPerAxis * viewsPerAxis, atlasSize };
}
export function installImposter() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioImposterBake: _bake,
    __studioImposterList: () => {
      const items = [];
      window.__archdiscScene?.traverse((o) => { if (o.userData?.archdiscStudioPrimitiveKind === 'imposter') items.push(o.uuid); });
      return { ok: true, items };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'edit', 'Imposter bake (Unreal / SpeedTree imposter atlas)');
  return { ok: true };
}
export default installImposter;
