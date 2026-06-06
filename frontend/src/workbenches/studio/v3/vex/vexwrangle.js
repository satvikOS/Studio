// ArchDisc Studio V3 — VEX wrangle geometry runner (slice 745).
//
// Parses a VEX program once, then walks every point of a THREE
// BufferGeometry running the program with `@P @N @Cd @id @pt @npt`
// bound to live attribute slots. Writes mutated positions / normals /
// colours back, auto-creating a `color` attribute on first @Cd write.
//
// Returns { ok, touched, modifiedAttrs, error?, line?, col? }.

import { tokenize, VexParseError } from './vexLexer.js';
import { parse } from './vexParser.js';
import { runProgram, BUILTIN_NAMES } from './vexInterpreter.js';

export { BUILTIN_NAMES };

const ATTR_NAMES = ['@P', '@N', '@Cd', '@id', '@pt', '@npt'];
export function attrNames() { return ATTR_NAMES.slice(); }

export function compileVex(source) {
  try {
    const tokens = tokenize(String(source || ''));
    const ast = parse(tokens);
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof VexParseError) {
      return { ok: false, error: e.message, line: e.line, col: e.col };
    }
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

export function runWrangleOnGeometry(geometry, source) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return { ok: false, error: 'geometry has no position attribute' };
  }
  const c = compileVex(source);
  if (!c.ok) return c;
  const ast = c.ast;
  const pos = geometry.attributes.position;
  const npts = pos.count;

  // Normals attribute — create from computeVertexNormals if absent so
  // @N is meaningful.
  if (!geometry.attributes.normal) {
    try { geometry.computeVertexNormals(); } catch (_) { /* ignore */ }
  }
  const nor = geometry.attributes.normal || null;

  // Probe whether the program touches @Cd. If yes, ensure color attr exists.
  const touchesCd = /@Cd\b/.test(source);
  let col = geometry.attributes.color || null;
  if (touchesCd && !col) {
    const arr = new Float32Array(npts * 3);
    for (let i = 0; i < npts * 3; i++) arr[i] = 1; // start white
    const THREE = (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
    if (THREE) {
      col = new THREE.BufferAttribute(arr, 3);
      geometry.setAttribute('color', col);
    } else {
      // No THREE on the global — minimal duck-typed wrapper.
      col = {
        array: arr, count: npts, itemSize: 3,
        needsUpdate: false,
        getX(i) { return arr[i*3]; },
        getY(i) { return arr[i*3+1]; },
        getZ(i) { return arr[i*3+2]; },
        setXYZ(i, x, y, z) { arr[i*3]=x; arr[i*3+1]=y; arr[i*3+2]=z; },
      };
      geometry.attributes.color = col;
    }
  }

  let touchedAny = false;
  let touchedCount = 0;
  const modified = new Set();

  // Preserve original P/N for non-touching scripts so we don't kick a
  // needsUpdate when nothing changed.
  for (let i = 0; i < npts; i++) {
    const env = {
      P:  [pos.getX(i), pos.getY(i), pos.getZ(i)],
      N:  nor ? [nor.getX(i), nor.getY(i), nor.getZ(i)] : [0, 1, 0],
      Cd: col ? [col.getX(i), col.getY(i), col.getZ(i)] : [1, 1, 1],
      id: i,
      pt: i,
      npt: npts,
      locals: Object.create(null),
      _touchedP: false,
      _touchedN: false,
      _touchedCd: false,
      _touchedId: false,
      _returned: undefined,
    };
    try {
      runProgram(ast, env);
    } catch (e) {
      return { ok: false, error: String(e.message || e), pt: i };
    }
    if (env._touchedP) { pos.setXYZ(i, env.P[0], env.P[1], env.P[2]); modified.add('P'); touchedAny = true; }
    if (env._touchedN && nor) { nor.setXYZ(i, env.N[0], env.N[1], env.N[2]); modified.add('N'); touchedAny = true; }
    if (env._touchedCd && col) { col.setXYZ(i, env.Cd[0], env.Cd[1], env.Cd[2]); modified.add('Cd'); touchedAny = true; }
    touchedCount++;
  }

  if (modified.has('P')) {
    pos.needsUpdate = true;
    try { geometry.computeBoundingSphere(); } catch (_) {}
    try { geometry.computeBoundingBox(); } catch (_) {}
  }
  if (modified.has('N') && nor) nor.needsUpdate = true;
  if (modified.has('Cd') && col) col.needsUpdate = true;

  // Op stamp for introspection / e2e.
  if (!geometry.userData) geometry.userData = {};
  geometry.userData.archdiscStudioVEXWrangle =
    (geometry.userData.archdiscStudioVEXWrangle || 0) + 1;

  return {
    ok: true,
    touched: touchedCount,
    modifiedAttrs: Array.from(modified),
    anyAttrChanged: touchedAny,
  };
}

export function runWrangleOnMesh(mesh, source) {
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh.geometry' };
  const r = runWrangleOnGeometry(mesh.geometry, source);
  if (!r.ok) return r;
  return { ok: true, ...r, uuid: mesh.uuid };
}

export function getActiveMesh() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try { return window.__studioSelectedMesh() || null; } catch (_) { return null; }
  }
  return null;
}

export function findMeshByUuid(uuid) {
  if (typeof window === 'undefined' || !window.__archdiscScene) return null;
  return window.__archdiscScene.getObjectByProperty('uuid', uuid) || null;
}
