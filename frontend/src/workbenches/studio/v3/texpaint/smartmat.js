// ArchDisc Studio V3 — smart materials (Substance "smart material" cousin).
//
// Each smart material is a recipe that pushes 3–4 layers onto the
// active material's stack. Masks are driven procedurally from
// world-position or UV gradients so the result feels organic rather
// than a flat fill.
//
// Materials shipped here:
//   • worn-metal       — steel base + bronze rim + scratches mask.
//   • painted-plastic  — coloured base + glossy specks + UV-edge dirt.
//   • wood-planks      — warm base + plank lines + grain noise + edges.
//   • concrete-cracks  — cool grey base + crack mask + dirt + speckle.

import { addLayer, TEX_SIZE } from './layerstack.js';
import { dirt, edges } from './maskgen.js';

// Produce a procedural pattern as a data URL — used as the canvasDataUrl
// for generator layers. Each pattern is rasterised on a fresh 512×512
// canvas with a fillStyle + light noise pass.
function _canvas() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = TEX_SIZE; c.height = TEX_SIZE;
  return c;
}
function _url(c) { try { return c.toDataURL('image/png'); } catch (_) { return null; } }

// Salted-noise overlay on top of a base colour.
function _noiseTile(base, mag) {
  const c = _canvas(); if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * mag;
    d[i]     = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  return _url(c);
}

// Horizontal plank lines for wood. `period` is plank height in px.
function _planks(baseColor, lineColor, period) {
  const c = _canvas(); if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  for (let y = period; y < TEX_SIZE; y += period) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(TEX_SIZE, y + 0.5);
    ctx.stroke();
  }
  // Grain — vertical streaks with low opacity.
  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * TEX_SIZE;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 12, TEX_SIZE);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
  return _url(c);
}

// Random scratch streaks for worn metal.
function _scratches(color, density) {
  const c = _canvas(); if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.strokeStyle = color;
  for (let i = 0; i < density; i++) {
    ctx.globalAlpha = 0.1 + Math.random() * 0.4;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    const x0 = Math.random() * TEX_SIZE;
    const y0 = Math.random() * TEX_SIZE;
    const len = 20 + Math.random() * 120;
    const ang = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
  return _url(c);
}

// Crack lines for concrete — random walk strokes.
function _cracks(color, count) {
  const c = _canvas(); if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.0;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.4 + Math.random() * 0.5;
    let x = Math.random() * TEX_SIZE;
    let y = Math.random() * TEX_SIZE;
    let ang = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 30 + Math.floor(Math.random() * 60);
    for (let s = 0; s < steps; s++) {
      ang += (Math.random() - 0.5) * 0.6;
      x += Math.cos(ang) * 4;
      y += Math.sin(ang) * 4;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
  return _url(c);
}

// Material recipes. Each pushes layers onto the supplied material and
// returns the layers added (their uuids).
function _wornMetal(material) {
  const added = [];
  added.push(addLayer(material, 'fill', { color: '#7a7e85', blend: 'normal', opacity: 1.0, name: 'Steel base' }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: _noiseTile('#8b8378', 30),
    blend: 'overlay', opacity: 0.6, name: 'Bronze rim',
  }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: _scratches('#d9d6cf', 220),
    blend: 'screen', opacity: 0.55, name: 'Scratches',
  }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: dirt({ cells: 64, seed: 11 }).dataUrl,
    blend: 'multiply', opacity: 0.45, name: 'Wear dirt',
  }));
  return added;
}

function _paintedPlastic(material) {
  const added = [];
  added.push(addLayer(material, 'fill', { color: '#256ee2', blend: 'normal', opacity: 1.0, name: 'Plastic base' }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: _noiseTile('#3b85f0', 14),
    blend: 'overlay', opacity: 0.35, name: 'Glossy specks',
  }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: edges({ thickness: 64 }).dataUrl,
    blend: 'multiply', opacity: 0.30, name: 'Edge dirt',
  }));
  return added;
}

function _woodPlanks(material) {
  const added = [];
  added.push(addLayer(material, 'fill', { color: '#7a4a25', blend: 'normal', opacity: 1.0, name: 'Wood base' }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: _planks('#9a5e30', '#3a230f', 96),
    blend: 'normal', opacity: 0.95, name: 'Planks',
  }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: _noiseTile('#5a3618', 22),
    blend: 'multiply', opacity: 0.40, name: 'Grain',
  }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: edges({ thickness: 32 }).dataUrl,
    blend: 'multiply', opacity: 0.25, name: 'Edge wear',
  }));
  return added;
}

function _concreteCracks(material) {
  const added = [];
  added.push(addLayer(material, 'fill', { color: '#8e8e90', blend: 'normal', opacity: 1.0, name: 'Concrete base' }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: _noiseTile('#9b9aa0', 24),
    blend: 'overlay', opacity: 0.55, name: 'Speckle',
  }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: _cracks('#2a2a2c', 26),
    blend: 'multiply', opacity: 0.85, name: 'Cracks',
  }));
  added.push(addLayer(material, 'generator', {
    canvasDataUrl: dirt({ cells: 128, seed: 7 }).dataUrl,
    blend: 'multiply', opacity: 0.40, name: 'Crevice dirt',
  }));
  return added;
}

const RECIPES = {
  'worn-metal':      _wornMetal,
  'painted-plastic': _paintedPlastic,
  'wood-planks':     _woodPlanks,
  'concrete-cracks': _concreteCracks,
};

export const SMART_MATERIAL_NAMES = Object.keys(RECIPES);

export function apply(material, name) {
  const fn = RECIPES[name];
  if (!fn) return { ok: false, error: 'unknown smart material' };
  const added = fn(material);
  return { ok: true, layersAdded: added.length, uuids: added.map((l) => l.uuid) };
}

export function listSmartMaterials() {
  return { ok: true, names: SMART_MATERIAL_NAMES.slice() };
}
