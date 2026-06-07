// ArchDisc Studio V3 — USDA round-trip (slice 790).
// Pure-JS .usda parser + writer + scene adapter. Builds on slice 761.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false;

// ── Parser ────────────────────────────────────────────────────────────
function _tokenize(text) {
  const tokens = [];
  let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '#') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '"') {
      let s = ''; i++;
      while (i < n && text[i] !== '"') { s += text[i++]; }
      i++;
      tokens.push({ kind: 'STRING', value: s });
      continue;
    }
    if (c === '{' || c === '}' || c === '(' || c === ')' || c === '[' || c === ']' || c === ',' || c === '=') {
      tokens.push({ kind: c, value: c }); i++; continue;
    }
    // Identifier or number
    let s = '';
    while (i < n && !/[\s={}()\[\],"]/.test(text[i])) { s += text[i++]; }
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) {
      tokens.push({ kind: 'NUMBER', value: Number(s) });
    } else if (s) {
      tokens.push({ kind: 'IDENT', value: s });
    }
  }
  return tokens;
}

export function parseUSDA(text) {
  const tokens = _tokenize(text);
  let i = 0;
  const prims = [];
  function _peek() { return tokens[i]; }
  function _eat(kind) {
    const t = tokens[i];
    if (!t || t.kind !== kind) throw new Error(`Expected ${kind}, got ${t?.kind} '${t?.value}'`);
    i++; return t;
  }
  function _parseValue() {
    const t = tokens[i];
    if (t.kind === 'NUMBER') { i++; return t.value; }
    if (t.kind === 'STRING') { i++; return t.value; }
    if (t.kind === '(') {
      i++;
      const arr = [];
      while (tokens[i] && tokens[i].kind !== ')') {
        if (tokens[i].kind === ',') { i++; continue; }
        arr.push(_parseValue());
      }
      _eat(')');
      return arr;
    }
    if (t.kind === '[') {
      i++;
      const arr = [];
      while (tokens[i] && tokens[i].kind !== ']') {
        if (tokens[i].kind === ',') { i++; continue; }
        arr.push(_parseValue());
      }
      _eat(']');
      return arr;
    }
    if (t.kind === 'IDENT') { i++; return t.value; }
    i++;
    return null;
  }
  function _parsePrim(parentPath = '') {
    // def Xform "name" { ... }
    _eat('IDENT'); // 'def' or 'over'
    const typeName = tokens[i].value; i++;
    const name = _eat('STRING').value;
    const path = parentPath + '/' + name;
    const attrs = {};
    if (tokens[i] && tokens[i].kind === '{') {
      i++;
      while (tokens[i] && tokens[i].kind !== '}') {
        if (tokens[i].kind === 'IDENT' && (tokens[i].value === 'def' || tokens[i].value === 'over')) {
          const child = _parsePrim(path);
          prims.push(child);
          continue;
        }
        // attr line: typeName attrName = value
        if (tokens[i].kind === 'IDENT') {
          i++; // attr type token
          if (tokens[i]?.kind === 'IDENT') {
            const attrName = tokens[i].value; i++;
            if (tokens[i]?.kind === '=') {
              i++;
              attrs[attrName] = _parseValue();
            }
          }
          continue;
        }
        i++;
      }
      _eat('}');
    }
    return { path, typeName, attrs };
  }
  while (i < tokens.length) {
    if (tokens[i].kind === 'IDENT' && (tokens[i].value === 'def' || tokens[i].value === 'over')) {
      prims.push(_parsePrim(''));
    } else {
      i++;
    }
  }
  return prims;
}

// ── Writer ────────────────────────────────────────────────────────────
function _writeValue(v) {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `"${v}"`;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'number')) return `(${v.join(', ')})`;
    return `[${v.map(_writeValue).join(', ')}]`;
  }
  return 'null';
}

export function writeUSDA(prims) {
  let out = '#usda 1.0\n\n';
  for (const prim of prims) {
    const name = prim.path.split('/').filter(Boolean).pop() || 'Unnamed';
    out += `def ${prim.typeName} "${name}" {\n`;
    for (const [k, v] of Object.entries(prim.attrs)) {
      out += `    custom ${k} = ${_writeValue(v)}\n`;
    }
    out += '}\n\n';
  }
  return out;
}

// ── Scene adapter ─────────────────────────────────────────────────────
function _sceneToUSDA() {
  if (typeof window === 'undefined') return '';
  const scene = window.__archdiscScene;
  if (!scene) return '';
  const prims = [];
  scene.traverse((o) => {
    if (!o.userData?.archdiscStudioPrimitive) return;
    const attrs = {
      translate: [o.position.x, o.position.y, o.position.z],
      rotateXYZ: [o.rotation.x, o.rotation.y, o.rotation.z],
      scale: [o.scale.x, o.scale.y, o.scale.z],
      kind: o.userData.archdiscStudioPrimitiveKind || 'unknown',
    };
    const name = o.name || `mesh_${o.uuid.slice(0, 8)}`;
    prims.push({ path: '/World/' + name, typeName: 'Xform', attrs });
  });
  return writeUSDA(prims);
}

function _usdaToScene(usdaText) {
  if (typeof window === 'undefined') return { ok: false };
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const prims = parseUSDA(usdaText);
  let imported = 0;
  for (const prim of prims) {
    const t = prim.attrs.translate || [0, 0, 0];
    const r = prim.attrs.rotateXYZ || [0, 0, 0];
    const s = prim.attrs.scale || [1, 1, 1];
    const geom = new THREE.BoxGeometry(0.03, 0.03, 0.03);
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(t[0], t[1], t[2]);
    mesh.rotation.set(r[0], r[1], r[2]);
    mesh.scale.set(s[0], s[1], s[2]);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = prim.attrs.kind || 'cube';
    scene.add(mesh);
    imported++;
  }
  return { ok: true, importedCount: imported };
}

export function installUSDRT() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioUSDRTExportScene: () => ({ ok: true, usda: _sceneToUSDA() }),
    __studioUSDRTImportScene: ({ usda } = {}) => _usdaToScene(String(usda || '')),
    __studioUSDRTParse: ({ usda } = {}) => ({ ok: true, prims: parseUSDA(String(usda || '')) }),
    __studioUSDRTSerialize: ({ prims } = {}) => ({ ok: true, usda: writeUSDA(prims || []) }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'USDA read+write round-trip');
  return { ok: true };
}

export default installUSDRT;
