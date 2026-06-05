// ArchDisc Studio V3 — architectural dimension lines.
//
// addDimensionLine() mirrors the slice 637 annotation dimension
// (__studioAddDimension) but tags the resulting group with the arch
// category so the dimension-list UI can filter by intent. Each
// dimension is:
//   • A THREE.Line between p1 and p2 (cyan by default for arch).
//   • Two small tick marks at the endpoints (extension lines).
//   • A canvas-sprite label at the midpoint showing the distance.
//
// The whole thing is returned as a THREE.Group so the caller can
// remove() it from the scene in one step.

import * as THREE from 'three';

export function addDimensionLine(p1, p2, opts) {
  const o = opts || {};
  const a = _toVec3(p1);
  const b = _toVec3(p2);
  const dist = a.distanceTo(b);
  if (!isFinite(dist) || dist < 1e-9) {
    return { ok: false, error: 'degenerate dimension', distance: dist };
  }

  const color = (o.color != null) ? o.color : 0x44ddff;
  const labelSize = (typeof o.size === 'number' && isFinite(o.size) && o.size > 0) ? o.size : 0.35;
  const labelFont = o.font || 'sans-serif';
  const labelBg = o.background || 'rgba(15, 20, 28, 0.85)';
  const labelInk = o.color != null && typeof o.color === 'string' ? o.color : (o.labelColor || '#ecf3fb');
  const fontSize = (o.fontSize || 32);

  const group = new THREE.Group();
  group.name = o.name || 'arch-dimension';

  // Main spanning line.
  const lineGeo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const lineMat = new THREE.LineBasicMaterial({
    color: typeof color === 'string' ? color : color,
  });
  const line = new THREE.Line(lineGeo, lineMat);
  line.name = 'arch-dimension-line';
  group.add(line);

  // Tick marks at endpoints: short perpendicular bars in the plane of
  // the dim line and the world up axis. If the dimension is purely
  // vertical we fall back to the world X axis.
  const dir = b.clone().sub(a).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  let perp = new THREE.Vector3().crossVectors(dir, up);
  if (perp.lengthSq() < 1e-9) perp = new THREE.Vector3(1, 0, 0);
  perp.normalize().multiplyScalar(labelSize * 0.25);
  const tickA = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      a.clone().sub(perp), a.clone().add(perp),
    ]),
    lineMat,
  );
  tickA.name = 'arch-dimension-tick-a';
  const tickB = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      b.clone().sub(perp), b.clone().add(perp),
    ]),
    lineMat,
  );
  tickB.name = 'arch-dimension-tick-b';
  group.add(tickA);
  group.add(tickB);

  // Distance label as a CanvasTexture sprite. We format to two
  // decimal places — typical architectural dims use mm or cm but the
  // op signature is unit-less so we leave that to the caller.
  const labelText = (typeof o.label === 'string') ? o.label : `${dist.toFixed(2)} m`;
  const { tex, aspect } = _label(labelText, fontSize, labelFont, labelBg, labelInk);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(labelSize * aspect, labelSize, 1);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  sprite.position.copy(mid).add(new THREE.Vector3(0, labelSize * 0.6, 0));
  sprite.name = 'arch-dimension-label';
  group.add(sprite);

  group.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'arch-dimension',
    archdiscStudioAnnotation: {
      kind: 'arch-dimension',
      a: [a.x, a.y, a.z],
      b: [b.x, b.y, b.z],
      distance: dist,
      label: labelText,
    },
  };
  group.updateMatrixWorld(true);
  return { ok: true, group, distance: dist };
}

function _toVec3(p) {
  if (!p) return new THREE.Vector3();
  if (p.isVector3) return new THREE.Vector3(p.x, p.y, p.z);
  if (Array.isArray(p)) return new THREE.Vector3(p[0] || 0, p[1] || 0, p[2] || 0);
  if (typeof p === 'object') return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
  return new THREE.Vector3();
}

function _label(text, fontPx, font, bg, ink) {
  const W = (typeof globalThis !== 'undefined') ? globalThis : null;
  const win = W ? W.window || W : null;
  const dpr = (win && win.devicePixelRatio) || 1;
  const fontSize = fontPx * dpr;
  const padding = 8 * dpr;
  const canvas = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : { width: 0, height: 0, getContext() { return { measureText() { return { width: 0 }; }, fillText() {}, fillRect() {}, strokeRect() {}, set font(_v) {}, set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {}, set textBaseline(_v) {} }; } };
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px ${font}`;
  const w = (ctx.measureText(text).width || (fontSize * text.length * 0.6)) + padding * 2;
  const h = fontSize + padding * 2;
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3a4a5c';
  ctx.lineWidth = dpr;
  ctx.strokeRect(0, 0, w, h);
  ctx.font = `${fontSize}px ${font}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = ink;
  ctx.fillText(text, padding, padding);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / h };
}
