// Slice 707 — Cycles-style Light Groups. Each light is tagged with a
// group name; render-passes capture each group's contribution into
// its own RenderTarget by rendering the scene with all other groups
// muted. Final composite mixes groups with per-group gain + tint,
// driving Compositor-style light editing without re-rendering.

import * as THREE from 'three';

const _groupMembership = new Map();   // lightUuid → groupName
const _groupGains = new Map();        // groupName → {gain, tint:[r,g,b]}

export function assignLight(lightUuid, groupName) {
  if (!groupName) return { ok: false, error: 'group name required' };
  _groupMembership.set(lightUuid, groupName);
  if (!_groupGains.has(groupName)) _groupGains.set(groupName, { gain: 1, tint: [1, 1, 1] });
  return { ok: true };
}

export function unassignLight(lightUuid) {
  _groupMembership.delete(lightUuid);
  return { ok: true };
}

export function setGroupGain(groupName, gain) {
  if (!_groupGains.has(groupName)) _groupGains.set(groupName, { gain: 1, tint: [1, 1, 1] });
  _groupGains.get(groupName).gain = Math.max(0, Number(gain) || 0);
  _applyToLights();
  return { ok: true };
}

export function setGroupTint(groupName, tint) {
  if (!_groupGains.has(groupName)) _groupGains.set(groupName, { gain: 1, tint: [1, 1, 1] });
  _groupGains.get(groupName).tint = tint;
  _applyToLights();
  return { ok: true };
}

function _applyToLights() {
  const scene = window.__archdiscScene;
  if (!scene) return;
  scene.traverseVisible((obj) => {
    if (!obj.isLight) return;
    const group = _groupMembership.get(obj.uuid);
    if (!group) return;
    const g = _groupGains.get(group);
    if (!g) return;
    if (!obj.userData.archdiscLightGroupBase) {
      obj.userData.archdiscLightGroupBase = {
        intensity: obj.intensity ?? 1,
        color: obj.color ? obj.color.clone() : new THREE.Color(1, 1, 1),
      };
    }
    const base = obj.userData.archdiscLightGroupBase;
    obj.intensity = base.intensity * g.gain;
    if (obj.color) obj.color.setRGB(base.color.r * g.tint[0], base.color.g * g.tint[1], base.color.b * g.tint[2]);
  });
}

// Render one group's contribution to a separate canvas by temporarily
// muting all other groups, rendering, then restoring.
export function renderGroupPass(groupName, opts) {
  const viewport = window.__archdiscViewport;
  const scene = window.__archdiscScene;
  if (!viewport?.renderer || !viewport?.camera || !scene) return { ok: false };
  const w = Number(opts?.width) || 256;
  const h = Number(opts?.height) || 256;
  const rt = new THREE.WebGLRenderTarget(w, h, { format: THREE.RGBAFormat });
  // Save current visibility, mute non-group lights.
  const states = [];
  scene.traverseVisible((obj) => {
    if (!obj.isLight) return;
    states.push([obj, obj.visible]);
    const g = _groupMembership.get(obj.uuid);
    obj.visible = (g === groupName);
  });
  viewport.renderer.setRenderTarget(rt);
  viewport.renderer.clear();
  viewport.renderer.render(scene, viewport.camera);
  viewport.renderer.setRenderTarget(null);
  for (const [obj, v] of states) obj.visible = v;
  // Read back to canvas.
  const buf = new Uint8Array(w * h * 4);
  viewport.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  // Flip Y.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((h - 1 - y) * w + x) * 4;
      const dst = (y * w + x) * 4;
      img.data[dst] = buf[src];
      img.data[dst + 1] = buf[src + 1];
      img.data[dst + 2] = buf[src + 2];
      img.data[dst + 3] = buf[src + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  rt.dispose();
  return { ok: true, canvas: cv, dataURL: cv.toDataURL('image/png') };
}

export function listGroups() {
  const groups = {};
  for (const [uuid, name] of _groupMembership.entries()) {
    if (!groups[name]) groups[name] = { name, lightUuids: [], gain: _groupGains.get(name)?.gain ?? 1, tint: _groupGains.get(name)?.tint || [1, 1, 1] };
    groups[name].lightUuids.push(uuid);
  }
  return { ok: true, groups: Object.values(groups) };
}

export function clearGroups() {
  // Restore all light bases.
  const scene = window.__archdiscScene;
  if (scene) {
    scene.traverseVisible((obj) => {
      if (!obj.isLight || !obj.userData.archdiscLightGroupBase) return;
      obj.intensity = obj.userData.archdiscLightGroupBase.intensity;
      if (obj.color) obj.color.copy(obj.userData.archdiscLightGroupBase.color);
      delete obj.userData.archdiscLightGroupBase;
    });
  }
  _groupMembership.clear();
  _groupGains.clear();
  return { ok: true };
}
