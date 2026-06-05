// ArchDisc Studio V3 — voxel palette (64 entries, HSL grid).
//
// 16 hues × 4 lightnesses, plus index 0 = empty sentinel. We store the
// palette as a flat array of THREE.Color instances so the mesh builder
// can read RGB directly without re-parsing hex. The "active" index is
// the colour the dragger paints with on click.
//
// Indices 1..16 are the brightest row; 17..32 medium-bright; 33..48
// medium; 49..64 darkest. Within each row the hues sweep 0..360 deg.
//
// The 0th slot is always the "empty" sentinel — never used for paint,
// represented as a transparent black so any accidental render-time read
// produces a visible zero instead of silently picking up colour 1.

import * as THREE from 'three';

export const PALETTE_SIZE = 65;     // 0 (empty) + 64 paint slots
export const PALETTE_HUES = 16;
export const PALETTE_SHADES = 4;

const _palette = new Array(PALETTE_SIZE);
let _activeIdx = 1;                  // first paintable slot by default

function buildDefault() {
  _palette[0] = new THREE.Color(0, 0, 0);
  // Lightness curve picked to feel like MagicaVoxel's stock palette:
  // bright pastels on top, deep saturated tones at the bottom.
  const lightnesses = [0.78, 0.58, 0.40, 0.22];
  for (let shade = 0; shade < PALETTE_SHADES; shade++) {
    const L = lightnesses[shade];
    for (let hue = 0; hue < PALETTE_HUES; hue++) {
      const idx = 1 + shade * PALETTE_HUES + hue;
      const H = hue / PALETTE_HUES;
      const c = new THREE.Color();
      c.setHSL(H, 0.82, L);
      _palette[idx] = c;
    }
  }
}
buildDefault();

/**
 * Read the entire palette as a plain RGB triple list. We return new
 * arrays per call so callers can't mutate the underlying colours.
 */
export function getPalette() {
  return _palette.map((c) => [c.r, c.g, c.b]);
}

/** Read one entry as a THREE.Color clone (safe to mutate). */
export function getPaletteColor(idx) {
  const i = Math.max(0, Math.min(PALETTE_SIZE - 1, idx | 0));
  return _palette[i].clone();
}

/** Read one entry as an RGB triple. */
export function getPaletteRGB(idx) {
  const i = Math.max(0, Math.min(PALETTE_SIZE - 1, idx | 0));
  const c = _palette[i];
  return [c.r, c.g, c.b];
}

/** Overwrite a palette slot (hex string '#rrggbb' or 0xRRGGBB number). */
export function setPaletteEntry(idx, hex) {
  const i = idx | 0;
  if (i < 1 || i >= PALETTE_SIZE) {
    return { ok: false, error: `idx out of range: ${i}` };
  }
  try {
    const c = new THREE.Color(hex);
    _palette[i] = c;
    return { ok: true, idx: i, hex: '#' + c.getHexString() };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

export function getActiveIdx() {
  return _activeIdx;
}

export function setActiveIdx(idx) {
  const i = idx | 0;
  if (i < 1 || i >= PALETTE_SIZE) {
    return { ok: false, error: `idx out of range: ${i}` };
  }
  _activeIdx = i;
  return { ok: true, idx: i };
}

/** Reset to the built-in HSL grid (used by tests + the panel "reset"). */
export function resetPalette() {
  buildDefault();
  _activeIdx = 1;
  return { ok: true };
}

export default {
  PALETTE_SIZE, PALETTE_HUES, PALETTE_SHADES,
  getPalette, getPaletteColor, getPaletteRGB,
  setPaletteEntry, getActiveIdx, setActiveIdx, resetPalette,
};
