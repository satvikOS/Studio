// ArchDisc Studio V3 — text → 3D mesh.
//
// `createText(text, opts)` builds a real extruded TextGeometry mesh
// from the supplied string using a bundled three/examples FontLoader.
// The default font is the canonical Helvetiker JSON shipped with
// three.js examples — fetched once over the network and cached for
// the lifetime of the page (subsequent calls are synchronous after
// the first await).
//
// `listFonts()` returns the registry of cached fonts (URL → ok/error).
// `setActiveFont(url)` switches which font subsequent createText
// calls will use.
//
// Failure modes:
//   • Fetch error / 404 / offline → returns { ok: false, error }
//     with NO scene mutation.
//   • TextGeometry construction throw → same.
//   • Empty `text` → returns { ok: false, error: 'empty text' }.
//
// Caching strategy:
//   _fonts: Map<url, { state: 'pending'|'ready'|'error',
//                      promise?: Promise, font?: Font, error?: string }>
//   First call per URL kicks off the FontLoader.load and stores the
//   pending promise so concurrent createText calls don't issue a
//   second network round-trip.

import * as THREE from 'three';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';

export const DEFAULT_FONT_URL =
  'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json';

const _fonts = new Map();
let _activeFontUrl = DEFAULT_FONT_URL;

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function attachAndSelect(mesh) {
  const s = getScene();
  if (!s) return false;
  s.add(mesh);
  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return true;
}

// Load (or return cached) Font for the given URL. Subsequent calls
// for the same URL share the in-flight promise.
function loadFont(url) {
  const u = String(url || DEFAULT_FONT_URL);
  const entry = _fonts.get(u);
  if (entry) {
    if (entry.state === 'ready') return Promise.resolve({ ok: true, font: entry.font, url: u });
    if (entry.state === 'pending') return entry.promise;
    if (entry.state === 'error') return Promise.resolve({ ok: false, error: entry.error, url: u });
  }
  const loader = new FontLoader();
  const promise = new Promise((resolve) => {
    loader.load(
      u,
      (font) => {
        _fonts.set(u, { state: 'ready', font });
        resolve({ ok: true, font, url: u });
      },
      undefined,
      (err) => {
        const msg = (err && err.message) ? err.message : 'font fetch failed';
        _fonts.set(u, { state: 'error', error: msg });
        resolve({ ok: false, error: msg, url: u });
      },
    );
  });
  _fonts.set(u, { state: 'pending', promise });
  return promise;
}

export function listFonts() {
  const fonts = [];
  for (const [url, entry] of _fonts.entries()) {
    fonts.push({
      url,
      state: entry.state,
      active: url === _activeFontUrl,
      error: entry.error || null,
    });
  }
  // Always include the default + active even if never loaded.
  if (!_fonts.has(DEFAULT_FONT_URL)) {
    fonts.push({
      url: DEFAULT_FONT_URL, state: 'unloaded',
      active: _activeFontUrl === DEFAULT_FONT_URL, error: null,
    });
  }
  if (_activeFontUrl !== DEFAULT_FONT_URL && !_fonts.has(_activeFontUrl)) {
    fonts.push({ url: _activeFontUrl, state: 'unloaded', active: true, error: null });
  }
  return { ok: true, active: _activeFontUrl, fonts };
}

export function setActiveFont(url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, error: 'invalid url' };
  }
  _activeFontUrl = url;
  return { ok: true, active: _activeFontUrl };
}

export async function createText(text, opts) {
  const t = (text == null) ? '' : String(text);
  if (!t.length) return { ok: false, error: 'empty text' };
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };

  const o = opts || {};
  const size = Number(o.size) || 0.5;
  const depth = Number(o.depth != null ? o.depth : o.height != null ? o.height : size * 0.3);
  const curveSegments = Math.max(1, Math.min(24, Number(o.curveSegments) || 8));
  const bevel = o.bevel === false ? false : true;
  const bevelSize = Number(o.bevelSize != null ? o.bevelSize : size * 0.015);
  const bevelThickness = Number(o.bevelThickness != null ? o.bevelThickness : size * 0.02);
  const bevelSegments = Math.max(1, Math.min(8, Number(o.bevelSegments) || 2));
  const fontUrl = o.fontUrl || _activeFontUrl;
  const color = o.color != null ? o.color : 0xdddddd;

  const fontResult = await loadFont(fontUrl);
  if (!fontResult.ok) return { ok: false, error: fontResult.error, fontUrl };

  let geometry;
  try {
    geometry = new TextGeometry(t, {
      font: fontResult.font,
      size,
      depth,
      curveSegments,
      bevelEnabled: bevel && bevelSize > 0,
      bevelSize,
      bevelThickness,
      bevelSegments,
    });
  } catch (e) {
    return { ok: false, error: 'TextGeometry failed: ' + (e && e.message ? e.message : String(e)) };
  }
  geometry.center();

  const material = new THREE.MeshStandardMaterial({
    color, roughness: 0.4, metalness: 0.15, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `studio-vector-text-${t.slice(0, 16)}`;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'vector-text';
  mesh.userData.archdiscStudioVectorText = {
    text: t, size, depth, fontUrl,
  };
  mesh.userData.pickable = true;
  if (Array.isArray(o.position)) {
    mesh.position.set(o.position[0] || 0, o.position[1] || 0, o.position[2] || 0);
  }

  attachAndSelect(mesh);

  const verts = geometry.attributes.position
    ? geometry.attributes.position.count
    : 0;

  return {
    ok: true,
    uuid: mesh.uuid,
    text: t,
    size,
    depth,
    fontUrl,
    verts,
  };
}
