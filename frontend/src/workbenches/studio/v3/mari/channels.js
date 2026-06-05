// ArchDisc Studio V3 — Mari-style per-channel UDIM texture stacks.
//
// Mari paints into multiple PBR channels simultaneously: a single brush
// stroke can deposit colour into Diffuse, deepen Roughness, lift
// Metallic, add Height bumps, and stamp Normal-map perturbations all in
// one stroke. Each channel keeps its own per-UDIM CanvasTexture stack
// so 4K characters with multiple tiles still get full channel-paint
// authority.
//
// Storage shape, attached to the mesh:
//   mesh.userData.archdiscStudioMariChannels : Map<channelName, ChannelState>
//
// ChannelState = {
//   enabled: boolean,
//   color:   '#rrggbb',   // brush colour for this channel
//   tiles:   Map<udim, { canvas: HTMLCanvasElement, tex: CanvasTexture }>,
//   // composited "output" tile per udim, ready to bind to mat.<map>.
// }
//
// Channels:
//   diffuse, roughness, metallic, normal, height, emissive

import * as THREE from 'three';
import { UDIM_TEX_SIZE, blankUDIMCanvas } from './udim.js';

// Channel registry — order matters: diffuse first (visual primary),
// height last (fine displacement). Each entry maps to the material slot
// that bake-and-apply writes to.
export const CHANNELS = [
  { name: 'diffuse',   matSlot: 'map',             defaultColor: '#888888', srgb: true  },
  { name: 'roughness', matSlot: 'roughnessMap',    defaultColor: '#7f7f7f', srgb: false },
  { name: 'metallic',  matSlot: 'metalnessMap',    defaultColor: '#000000', srgb: false },
  { name: 'normal',    matSlot: 'normalMap',       defaultColor: '#8080ff', srgb: false },
  { name: 'height',    matSlot: 'displacementMap', defaultColor: '#808080', srgb: false },
  { name: 'emissive',  matSlot: 'emissiveMap',     defaultColor: '#000000', srgb: true  },
];

export const CHANNEL_NAMES = CHANNELS.map((c) => c.name);

const _byName = new Map(CHANNELS.map((c) => [c.name, c]));

// Top-level toggle state shared across meshes — Mari's channel-enabled
// switches are a "global brush" concept (the brush stamps whichever
// channels are armed, regardless of which mesh you're on).
const _globalEnabled = new Map(CHANNELS.map((c) => [c.name, c.name === 'diffuse']));
const _globalColor   = new Map(CHANNELS.map((c) => [c.name, c.defaultColor]));

export function channelMeta(name) { return _byName.get(name) || null; }

// Read / write the global enable flag (which channels does a brush
// stroke stamp into?). Diffuse is on by default.
export function isChannelEnabled(name) {
  return _globalEnabled.has(name) ? !!_globalEnabled.get(name) : false;
}
export function setChannelEnabled(name, on) {
  if (!_byName.has(name)) return false;
  _globalEnabled.set(name, !!on);
  return true;
}
export function enabledChannels() {
  return CHANNEL_NAMES.filter((n) => isChannelEnabled(n));
}

// Read / write the per-channel brush colour.
export function getChannelColor(name) {
  return _globalColor.has(name) ? _globalColor.get(name) : (channelMeta(name)?.defaultColor || '#888888');
}
export function setChannelColor(name, color) {
  if (!_byName.has(name)) return false;
  if (typeof color !== 'string' || !color.length) return false;
  _globalColor.set(name, color);
  return true;
}

// ── Per-mesh storage ─────────────────────────────────────────────────
function _ensureMeshChannels(mesh) {
  if (!mesh) return null;
  mesh.userData = mesh.userData || {};
  if (!mesh.userData.archdiscStudioMariChannels) {
    mesh.userData.archdiscStudioMariChannels = new Map();
  }
  return mesh.userData.archdiscStudioMariChannels;
}

function _ensureChannelState(mesh, channel) {
  if (!_byName.has(channel)) return null;
  const store = _ensureMeshChannels(mesh);
  if (!store) return null;
  let s = store.get(channel);
  if (!s) {
    s = { tiles: new Map() };
    store.set(channel, s);
  }
  return s;
}

// Decode a data URL into a canvas asynchronously while returning the
// canvas synchronously. Used by setChannelAt when the caller provides
// a baked PNG instead of writing pixels directly.
function _canvasFromDataUrl(dataUrl) {
  const c = blankUDIMCanvas(null);
  if (!c || !dataUrl || typeof Image === 'undefined') return c;
  const img = new Image();
  img.src = dataUrl;
  const draw = () => {
    try {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, UDIM_TEX_SIZE, UDIM_TEX_SIZE);
      ctx.drawImage(img, 0, 0, UDIM_TEX_SIZE, UDIM_TEX_SIZE);
      c._archdiscMariDecoded = true;
    } catch (_) {}
  };
  if (img.decode) img.decode().then(draw).catch(() => {});
  else { img.onload = draw; }
  return c;
}

// Get (or lazily allocate) the canvas + CanvasTexture for a channel's
// UDIM tile. If the tile doesn't exist we pre-fill it with the
// channel's default colour so subsequent strokes blend correctly.
export function getChannelTile(mesh, channel, udim) {
  const s = _ensureChannelState(mesh, channel);
  if (!s) return null;
  const n = Number(udim);
  let entry = s.tiles.get(n);
  if (entry) return entry;
  const meta = channelMeta(channel);
  const canvas = blankUDIMCanvas(meta ? meta.defaultColor : null);
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = (meta && meta.srgb) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  entry = { canvas, tex };
  s.tiles.set(n, entry);
  return entry;
}

// Replace a channel tile with a baked image. `dataUrlOrCanvas` may be a
// data URL or an HTMLCanvasElement (mostly used by tests + the panel
// "load image" affordance).
export function setChannelAt(mesh, channel, udim, dataUrlOrCanvas) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!_byName.has(channel)) return { ok: false, error: 'unknown channel' };
  const s = _ensureChannelState(mesh, channel);
  if (!s) return { ok: false, error: 'no state' };
  const n = Number(udim);
  if (!Number.isFinite(n)) return { ok: false, error: 'bad udim' };
  let canvas;
  if (dataUrlOrCanvas && dataUrlOrCanvas.tagName === 'CANVAS') {
    canvas = dataUrlOrCanvas;
  } else if (typeof dataUrlOrCanvas === 'string') {
    canvas = _canvasFromDataUrl(dataUrlOrCanvas);
  } else {
    const meta = channelMeta(channel);
    canvas = blankUDIMCanvas(meta ? meta.defaultColor : null);
  }
  if (!canvas) return { ok: false, error: 'no canvas' };
  const prev = s.tiles.get(n);
  if (prev && prev.tex && prev.tex.dispose) { try { prev.tex.dispose(); } catch (_) {} }
  const meta = channelMeta(channel);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = (meta && meta.srgb) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  s.tiles.set(n, { canvas, tex });
  return { ok: true, channel, udim: n };
}

// Read the canvas dataUrl for a channel tile (panel previews use this).
export function getChannelTextureDataUrl(mesh, channel, udim) {
  const s = _ensureChannelState(mesh, channel);
  if (!s) return null;
  const e = s.tiles.get(Number(udim));
  if (!e || !e.canvas) return null;
  try { return e.canvas.toDataURL('image/png'); } catch (_) { return null; }
}

// List every channel state for a mesh — used by the panel.
export function listChannels(mesh) {
  const out = [];
  for (const c of CHANNELS) {
    const state = mesh ? _ensureChannelState(mesh, c.name) : null;
    out.push({
      name: c.name,
      matSlot: c.matSlot,
      enabled: isChannelEnabled(c.name),
      color: getChannelColor(c.name),
      tileCount: state ? state.tiles.size : 0,
    });
  }
  return out;
}

// Composite a channel's UDIM stack: for the Mari V1 surface, a
// "channel stack" is a single tile (Mari's per-UDIM layering would be a
// dedicated slice). compositeChannelStack returns the active tile's
// CanvasTexture so MariPanel can hand it to the material slot.
export function compositeChannelStack(mesh, channel, udim) {
  const s = _ensureChannelState(mesh, channel);
  if (!s) return null;
  const e = s.tiles.get(Number(udim));
  if (!e) return null;
  if (e.tex) e.tex.needsUpdate = true;
  return e.tex;
}

// Composite every channel into the material's relevant map slot. Picks
// the first available UDIM tile per channel (for V1; multi-tile atlas
// generation is a follow-up slice). Returns a summary of which slots
// were written.
export function applyToMaterial(mesh) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  let mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat) return { ok: false, error: 'no material' };
  if (!(mat instanceof THREE.MeshStandardMaterial)) {
    const oldColor = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
    if (mat.dispose) mat.dispose();
    mat = new THREE.MeshStandardMaterial({ color: oldColor, roughness: 0.65, metalness: 0.05 });
    if (Array.isArray(mesh.material)) mesh.material[0] = mat;
    else mesh.material = mat;
  }
  const store = _ensureMeshChannels(mesh);
  if (!store) return { ok: false, error: 'no channels' };
  const writes = [];
  for (const c of CHANNELS) {
    const state = store.get(c.name);
    if (!state || !state.tiles.size) continue;
    // Pick the lowest-numbered UDIM tile as the "active" one for V1.
    const sorted = Array.from(state.tiles.keys()).sort((a, b) => a - b);
    const udim = sorted[0];
    const tex = compositeChannelStack(mesh, c.name, udim);
    if (!tex) continue;
    // Dispose existing slot only if it's a different texture instance.
    const prev = mat[c.matSlot];
    if (prev && prev !== tex && prev.dispose) { try { prev.dispose(); } catch (_) {} }
    mat[c.matSlot] = tex;
    // Some slots need a non-default tuning so they're actually visible:
    if (c.matSlot === 'displacementMap') {
      // Keep displacement subtle; a 1.0 scale would explode the mesh.
      if (typeof mat.displacementScale === 'number') mat.displacementScale = 0.05;
    }
    if (c.matSlot === 'emissiveMap' && mat.emissive) {
      mat.emissive.setRGB(1, 1, 1);
    }
    writes.push({ channel: c.name, slot: c.matSlot, udim });
  }
  // If a diffuse map was written, normalise mat.color so it doesn't
  // tint the bake. Otherwise leave the user-set base colour alone.
  if (mat.map && mat.color) mat.color.set(0xffffff);
  mat.needsUpdate = true;
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioMari = true;
  return { ok: true, writes, count: writes.length };
}

// Test-only: drop the per-mesh channel store.
export function clearChannels(mesh) {
  if (!mesh || !mesh.userData) return false;
  const store = mesh.userData.archdiscStudioMariChannels;
  if (!store) return false;
  for (const [, s] of store) {
    if (!s || !s.tiles) continue;
    for (const [, e] of s.tiles) {
      if (e.tex && e.tex.dispose) { try { e.tex.dispose(); } catch (_) {} }
    }
    s.tiles.clear();
  }
  store.clear();
  return true;
}
