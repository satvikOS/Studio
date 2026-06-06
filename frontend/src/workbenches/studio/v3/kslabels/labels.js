// Slice 718 — KeyShot Labels + Decals. Project a 2D image onto a 3D
// mesh surface from a chosen direction. Each label is a small mesh
// (cylinder cap or plane) parented to the target mesh with the image
// as a CanvasTexture; supports rotation, scale, alpha mask. Mirrors
// KeyShot's Labels feature (used for product branding renders).

import * as THREE from 'three';

const _labels = new Map();
let _seq = 1;
function _uid() { return `kl-${_seq++}-${Date.now().toString(36)}`; }

function _textCanvas(text, opts) {
  const cv = document.createElement('canvas');
  const fontSize = Number(opts?.fontSize) || 48;
  const padding = 16;
  // Measure.
  const tmp = cv.getContext('2d');
  tmp.font = `${fontSize}px ${opts?.fontFamily || 'Arial'}`;
  const w = Math.ceil(tmp.measureText(text).width) + padding * 2;
  const h = fontSize + padding * 2;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = opts?.bgColor || 'rgba(255,255,255,0)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = opts?.color || '#000000';
  ctx.font = `${fontSize}px ${opts?.fontFamily || 'Arial'}`;
  ctx.textBaseline = 'top';
  ctx.fillText(text, padding, padding);
  return cv;
}

export function addTextLabel(meshUuid, text, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  const cv = _textCanvas(text, opts);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const w = Number(opts?.width) || 0.3;
  const h = w * cv.height / cv.width;
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const labelMesh = new THREE.Mesh(geo, mat);
  // Default placement: a bit above the mesh.
  const bbox = new THREE.Box3().setFromObject(mesh);
  labelMesh.position.set(
    (bbox.min.x + bbox.max.x) / 2,
    bbox.max.y + 0.1,
    (bbox.min.z + bbox.max.z) / 2,
  );
  if (opts?.position) labelMesh.position.set(...opts.position);
  if (opts?.rotation) labelMesh.rotation.set(...opts.rotation);
  mesh.add(labelMesh);
  const id = _uid();
  _labels.set(id, { id, meshUuid: mesh.uuid, labelMesh, canvas: cv });
  return { ok: true, id, labelUuid: labelMesh.uuid };
}

export function addImageLabel(meshUuid, dataURL, opts) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d').drawImage(img, 0, 0);
      const scene = window.__archdiscScene;
      const mesh = scene?.getObjectByProperty('uuid', meshUuid);
      if (!mesh) { resolve({ ok: false }); return; }
      const tex = new THREE.CanvasTexture(cv);
      const w = Number(opts?.width) || 0.3;
      const h = w * cv.height / cv.width;
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
      const labelMesh = new THREE.Mesh(geo, mat);
      const bbox = new THREE.Box3().setFromObject(mesh);
      labelMesh.position.set(
        (bbox.min.x + bbox.max.x) / 2,
        bbox.max.y + 0.1,
        (bbox.min.z + bbox.max.z) / 2,
      );
      if (opts?.position) labelMesh.position.set(...opts.position);
      if (opts?.rotation) labelMesh.rotation.set(...opts.rotation);
      mesh.add(labelMesh);
      const id = _uid();
      _labels.set(id, { id, meshUuid: mesh.uuid, labelMesh, canvas: cv });
      resolve({ ok: true, id, labelUuid: labelMesh.uuid });
    };
    img.onerror = () => resolve({ ok: false, error: 'image load failed' });
    img.src = dataURL;
  });
}

export function projectLabel(id, projectFromDirection, projectionDistance) {
  // Re-place the label so it's centered on the line from the mesh
  // centroid going in `projectFromDirection` for `projectionDistance`.
  const label = _labels.get(id);
  if (!label) return { ok: false };
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', label.meshUuid);
  if (!mesh) return { ok: false };
  const bbox = new THREE.Box3().setFromObject(mesh);
  const center = bbox.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(...projectFromDirection).normalize();
  const dist = Number(projectionDistance) || 1;
  label.labelMesh.position.copy(center).addScaledVector(dir, dist);
  label.labelMesh.lookAt(center);
  return { ok: true };
}

export function setLabelTransform(id, position, rotation, scale) {
  const label = _labels.get(id);
  if (!label) return { ok: false };
  if (position) label.labelMesh.position.set(...position);
  if (rotation) label.labelMesh.rotation.set(...rotation);
  if (scale !== undefined) label.labelMesh.scale.setScalar(scale);
  return { ok: true };
}

export function removeLabel(id) {
  const label = _labels.get(id);
  if (!label) return { ok: false };
  if (label.labelMesh.parent) label.labelMesh.parent.remove(label.labelMesh);
  label.labelMesh.geometry.dispose();
  label.labelMesh.material.dispose();
  _labels.delete(id);
  return { ok: true };
}

export function listLabels(meshUuid) {
  return {
    ok: true,
    labels: Array.from(_labels.values())
      .filter((l) => !meshUuid || l.meshUuid === meshUuid)
      .map((l) => ({ id: l.id, meshUuid: l.meshUuid, labelUuid: l.labelMesh.uuid })),
  };
}
