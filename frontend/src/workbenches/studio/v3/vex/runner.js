// ArchDisc Studio V3 — ASL runner.
//
// Glue between the parser/interpreter and a three.js BufferGeometry:
// parse once, then loop over every vertex applying the interpreter and
// writing back the updated position attribute. Recomputes vertex
// normals and bounds so the viewport (and any downstream BVH raycast
// listener) sees a consistent mesh after the run.
//
// Hard limits:
//   • Max 200 000 vertices per run (matches the existing scriptops.js
//     guard so behaviour stays consistent with the legacy slot).
//   • A single failing vertex aborts the run and reverts the position
//     attribute — partial writes can leave a mesh in a broken state
//     that's hard to undo from a text editor.

import * as THREE from 'three';
import { parse } from './parser.js';
import { evalBlock, makeEnv, RuntimeError } from './interpreter.js';

export const MAX_VERTS = 200000;

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function getActiveMesh() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try {
      const m = window.__studioSelectedMesh();
      if (m && m.isMesh && m.geometry) return m;
    } catch (_) { /* fall through */ }
  }
  const vp = window.__archdiscViewport;
  if (vp && typeof vp.getSelected === 'function') {
    try {
      const m = vp.getSelected();
      if (m && m.isMesh && m.geometry) return m;
    } catch (_) { /* fall through */ }
  }
  return null;
}

function findMeshByUuid(uuid) {
  const scene = getScene();
  if (!scene || typeof scene.getObjectByProperty !== 'function') return null;
  const m = scene.getObjectByProperty('uuid', uuid);
  if (m && m.isMesh && m.geometry) return m;
  return null;
}

/**
 * Parse-only — used by the editor for live validation.
 * @returns {{ ok: boolean, error?: string, line?: number, col?: number }}
 */
export function parseScript(script) {
  const r = parse(String(script || ''));
  if (!r.ok) return { ok: false, error: r.error, line: r.line, col: r.col };
  return { ok: true };
}

/**
 * Run an ASL script against a specific mesh by uuid.
 *   - parses once
 *   - walks every vertex
 *   - writes the position attribute back + recomputes normals + bounds
 *
 * On any RuntimeError, the original position buffer is restored so the
 * mesh is unchanged and the caller sees a clean error.
 *
 * @param {string} uuid
 * @param {string} script
 * @returns {{ ok: boolean, touched?: number, error?: string, line?: number, col?: number }}
 */
export function runOnMesh(uuid, script) {
  const mesh = findMeshByUuid(uuid);
  if (!mesh) return { ok: false, error: 'mesh not found' };
  return _runOn(mesh, script);
}

/**
 * Run an ASL script against the currently selected mesh.
 * @returns {{ ok: boolean, touched?: number, error?: string, line?: number, col?: number }}
 */
export function runOnSelection(script) {
  const mesh = getActiveMesh();
  if (!mesh) return { ok: false, error: 'no mesh selected' };
  return _runOn(mesh, script);
}

function _runOn(mesh, script) {
  const g = mesh.geometry;
  const posAttr = g && g.attributes && g.attributes.position;
  if (!posAttr) return { ok: false, error: 'mesh has no position attribute' };
  if (posAttr.count > MAX_VERTS) {
    return { ok: false, error: `vertex cap exceeded (${posAttr.count} > ${MAX_VERTS})` };
  }

  const parsed = parse(String(script || ''));
  if (!parsed.ok) return { ok: false, error: parsed.error, line: parsed.line, col: parsed.col };

  // Snapshot the position buffer so a failing vertex aborts cleanly.
  const original = new Float32Array(posAttr.array.length);
  original.set(posAttr.array);

  // Make sure normals exist so per-vertex `nor` is readable. We only
  // compute them if missing — otherwise we'd clobber custom normals.
  let norAttr = g.attributes.normal;
  if (!norAttr) {
    g.computeVertexNormals();
    norAttr = g.attributes.normal;
  }

  const env = makeEnv();
  env.count = posAttr.count;
  let touched = 0;
  try {
    for (let i = 0; i < posAttr.count; i++) {
      env.idx = i;
      env.pos.x = posAttr.getX(i);
      env.pos.y = posAttr.getY(i);
      env.pos.z = posAttr.getZ(i);
      if (norAttr) {
        env.nor.x = norAttr.getX(i);
        env.nor.y = norAttr.getY(i);
        env.nor.z = norAttr.getZ(i);
      } else {
        env.nor.x = 0; env.nor.y = 0; env.nor.z = 0;
      }

      evalBlock(parsed.ast, env);

      const nx = env.pos.x, ny = env.pos.y, nz = env.pos.z;
      if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) {
        throw new RuntimeError(
          `non-finite position at vertex ${i} (${nx}, ${ny}, ${nz})`,
          parsed.ast.line, parsed.ast.col,
        );
      }
      posAttr.setXYZ(i, nx, ny, nz);
      touched += 1;
    }
  } catch (e) {
    // Roll back the buffer so the mesh stays in its pre-run state.
    posAttr.array.set(original);
    posAttr.needsUpdate = true;
    if (e instanceof RuntimeError) {
      return { ok: false, error: e.message, line: e.line, col: e.col };
    }
    return { ok: false, error: String(e && e.message || e) };
  }

  posAttr.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  // Tag for diagnostics so other tools can see this mesh has been
  // touched by the VEX runner — matches the pattern used by
  // scriptops.js for its legacy expression evaluator.
  mesh.userData.archdiscStudioVexAslRuns =
    (mesh.userData.archdiscStudioVexAslRuns || 0) + 1;
  mesh.userData.archdiscStudioVexAslLast = String(script || '').slice(0, 4096);

  return { ok: true, touched, uuid: mesh.uuid };
}

/**
 * Built-in example library — six scripts the editor surfaces in a
 * dropdown. Each is intentionally short, runs on a stock sphere/cube,
 * and uses a different language feature so the editor doubles as a
 * tutorial.
 */
export const EXAMPLES = Object.freeze({
  'twist-y': [
    '// Twist around Y axis by a height-dependent angle.',
    'a = pos.y * 1.5;',
    'x = pos.x * cos(a) - pos.z * sin(a);',
    'z = pos.x * sin(a) + pos.z * cos(a);',
    'pos.x = x;',
    'pos.z = z;',
  ].join('\n'),

  'bend-x': [
    '// Bend along X — pushes vertices forward in Z proportional to x*x.',
    'pos.z = pos.z + pos.x * pos.x * 0.6;',
  ].join('\n'),

  'noise-displace': [
    '// Push every vertex along its normal by deterministic noise.',
    'n = noise(pos.x, pos.y, pos.z);',
    'pos.x = pos.x + nor.x * n * 0.25;',
    'pos.y = pos.y + nor.y * n * 0.25;',
    'pos.z = pos.z + nor.z * n * 0.25;',
  ].join('\n'),

  inflate: [
    '// Inflate along normals — like a soft balloon.',
    'pos.x = pos.x + nor.x * 0.2;',
    'pos.y = pos.y + nor.y * 0.2;',
    'pos.z = pos.z + nor.z * 0.2;',
  ].join('\n'),

  'mirror-x': [
    '// Reflect every vertex across the YZ plane.',
    'pos.x = 0 - pos.x;',
  ].join('\n'),

  'radial-pinch': [
    '// Pinch toward the Y axis based on distance from it.',
    'r = sqrt(pos.x * pos.x + pos.z * pos.z);',
    'k = clamp(1 - r, 0, 1);',
    'pos.x = pos.x * (1 - k * 0.6);',
    'pos.z = pos.z * (1 - k * 0.6);',
  ].join('\n'),
});

export const EXAMPLE_NAMES = Object.freeze(Object.keys(EXAMPLES));

// Tiny export of THREE so consumers can attach material/geometry hooks
// in the future without re-importing.
export { THREE };
