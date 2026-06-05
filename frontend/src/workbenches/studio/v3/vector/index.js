// ArchDisc Studio V3 — vector / SVG 3D installer.
//
// `installVector()` attaches every vector op to window.__studioVector*
// and registers them with the V3 command palette under category
// 'vector'. Idempotent — re-calling no-ops via the
// window.__studioVectorInstalled flag.
//
// Op surface
//   __studioVectorImportSvg(svgString, depth=0.1, bevel=0.005)
//   __studioVectorCreateText(text, opts)
//   __studioVectorLogoFromPaths(pathsJson, depth, bevel)
//   __studioVectorOffsetPath(points, dist)
//   __studioVectorChamferPath(points, size)
//   __studioVectorClosePath(points)
//   __studioVectorListFonts()
//   __studioVectorSetActiveFont(fontUrl)

import { importSvgString } from './svgImport.js';
import { createText, listFonts, setActiveFont, DEFAULT_FONT_URL } from './textMesh.js';
import { extrudeFromPaths } from './logoExtrude.js';
import { offsetPath, chamferPath, closePath } from './pathOps.js';

function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister === 'function') {
      try {
        window.__studioCommandRegister(name, fn, { category: 'vector', description });
        return true;
      } catch (_) { return false; }
    }
    return false;
  };
  if (!tryReg()) {
    // Palette may not be live yet (autoload races registerV3Api).
    setTimeout(() => { tryReg(); }, 0);
  }
}

const OP_NAMES = [
  '__studioVectorImportSvg',
  '__studioVectorCreateText',
  '__studioVectorLogoFromPaths',
  '__studioVectorOffsetPath',
  '__studioVectorChamferPath',
  '__studioVectorClosePath',
  '__studioVectorListFonts',
  '__studioVectorSetActiveFont',
];

export function installVector() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioVectorInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioVectorInstalled = true;
  window.__studioVectorDefaultFontUrl = DEFAULT_FONT_URL;

  reg(
    '__studioVectorImportSvg',
    (svgString, depth, bevel) => importSvgString(
      svgString,
      depth == null ? 0.1 : depth,
      bevel == null ? 0.005 : bevel,
    ),
    'Parse an SVG string and add an extruded mesh per <path>. depth+bevel in world units.',
  );

  reg(
    '__studioVectorCreateText',
    (text, opts) => createText(text, opts || {}),
    'Build a 3D TextGeometry mesh from a string (Helvetiker by default).',
  );

  reg(
    '__studioVectorLogoFromPaths',
    (pathsJson, depth, bevel) => extrudeFromPaths(
      pathsJson,
      depth == null ? 0.1 : depth,
      bevel == null ? 0.005 : bevel,
    ),
    'Extrude an array of {points,holes,color} JSON paths into a single grouped mesh.',
  );

  reg(
    '__studioVectorOffsetPath',
    (points, dist) => offsetPath(points, dist),
    'Offset every vertex of a 2D polyline outward by dist along the averaged edge normal.',
  );

  reg(
    '__studioVectorChamferPath',
    (points, size) => chamferPath(points, size),
    'Replace each interior corner of a 2D polyline with two vertices inset by size.',
  );

  reg(
    '__studioVectorClosePath',
    (points) => closePath(points),
    'Append the first vertex to the end of a 2D polyline (unless already closed).',
  );

  reg(
    '__studioVectorListFonts',
    () => listFonts(),
    'List every Font cache entry: url, state, active, error.',
  );

  reg(
    '__studioVectorSetActiveFont',
    (fontUrl) => setActiveFont(fontUrl),
    'Set which font URL subsequent __studioVectorCreateText calls will use.',
  );

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallVector() {
  if (typeof window === 'undefined') return { ok: false };
  if (!window.__studioVectorInstalled) return { ok: true };
  for (const k of OP_NAMES) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  delete window.__studioVectorDefaultFontUrl;
  window.__studioVectorInstalled = false;
  return { ok: true };
}
