// ArchDisc Studio V3 — motion vector MRT pass (slice 929).
// Render a screen-space motion vector buffer by tracking each mesh's
// previous-frame matrixWorld and writing per-pixel screen-velocity into
// a separate render target. Drives slice 912 motion blur + slice 916 TAA.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _prevMatrices = new WeakMap();
let _target = null;
let _vsMaterial = null;
function _ensureTarget(width = 1024, height = 768) {
  if (_target && _target.width === width && _target.height === height) return _target;
  if (_target) _target.dispose();
  _target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  return _target;
}
function _ensureMaterial() {
  if (_vsMaterial) return _vsMaterial;
  _vsMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPrevModelViewProj: { value: new THREE.Matrix4() },
      uCurModelViewProj:  { value: new THREE.Matrix4() },
    },
    vertexShader: `
      uniform mat4 uPrevModelViewProj;
      uniform mat4 uCurModelViewProj;
      varying vec4 vCurClip;
      varying vec4 vPrevClip;
      void main() {
        vCurClip = uCurModelViewProj * vec4(position, 1.0);
        vPrevClip = uPrevModelViewProj * vec4(position, 1.0);
        gl_Position = vCurClip;
      }
    `,
    fragmentShader: `
      varying vec4 vCurClip;
      varying vec4 vPrevClip;
      void main() {
        vec2 curNdc  = vCurClip.xy  / vCurClip.w;
        vec2 prevNdc = vPrevClip.xy / vPrevClip.w;
        vec2 mv = (curNdc - prevNdc) * 0.5;
        gl_FragColor = vec4(mv, 0.0, 1.0);
      }
    `,
  });
  return _vsMaterial;
}
function _capture(width = 1024, height = 768) {
  const vp = window.__archdiscViewport;
  if (!vp?.renderer || !vp?.scene || !vp?.camera) return { ok: false };
  const target = _ensureTarget(width, height);
  const mat = _ensureMaterial();
  const overrides = [];
  vp.scene.traverse((o) => {
    if (!o.isMesh || !o.userData?.archdiscStudioPrimitive) return;
    overrides.push({ mesh: o, prevMat: o.material });
    const prev = _prevMatrices.get(o) || o.matrixWorld.clone();
    const matInstance = mat.clone();
    matInstance.uniforms.uPrevModelViewProj = { value: new THREE.Matrix4()
      .multiplyMatrices(vp.camera.projectionMatrix, new THREE.Matrix4().multiplyMatrices(vp.camera.matrixWorldInverse, prev)) };
    matInstance.uniforms.uCurModelViewProj = { value: new THREE.Matrix4()
      .multiplyMatrices(vp.camera.projectionMatrix, new THREE.Matrix4().multiplyMatrices(vp.camera.matrixWorldInverse, o.matrixWorld)) };
    o.material = matInstance;
    _prevMatrices.set(o, o.matrixWorld.clone());
  });
  const prevTarget = vp.renderer.getRenderTarget();
  vp.renderer.setRenderTarget(target);
  vp.renderer.setClearColor(0x000000, 0);
  vp.renderer.clear();
  if (vp.renderer.__studioOrigRender) vp.renderer.__studioOrigRender(vp.scene, vp.camera);
  else vp.renderer.render(vp.scene, vp.camera);
  vp.renderer.setRenderTarget(prevTarget);
  for (const ov of overrides) {
    ov.mesh.material.dispose?.();
    ov.mesh.material = ov.prevMat;
  }
  return { ok: true, width, height, targetUuid: target.texture.uuid };
}
export function installMotionVecMRT() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioMotionVecMRTCapture: _capture,
    __studioMotionVecMRTGetTarget: () => ({ ok: true, target: _target, hasTarget: !!_target }),
    __studioMotionVecMRTReset: () => { if (_target) { _target.dispose(); _target = null; } return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Motion vector MRT pass');
  return { ok: true };
}
export default installMotionVecMRT;
