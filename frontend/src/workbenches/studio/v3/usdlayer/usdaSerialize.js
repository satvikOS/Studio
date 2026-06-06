// ArchDisc Studio V3 — Pixar USDA text-format serializer (slice 761).
//
// Emits a valid Pixar `.usda` ASCII file given a composed prim tree
// (produced by `composeStack`).  USDA is the text form of USD; binary
// .usdc is the same data structure with a Crate encoding.
//
// The emitter follows the canonical USDA grammar:
//
//   #usda 1.0
//   (
//     defaultPrim = "World"
//   )
//
//   def Xform "World"
//   {
//       def Xform "Box" (
//       )
//       {
//           double3 xformOp:translate = (1, 0, 0)
//           uniform token[] xformOpOrder = ["xformOp:translate"]
//       }
//   }
//
// We support these attribute value shapes (USD's most common):
//   • number          → `double` (1.234)
//   • boolean         → `bool` (true / false)
//   • string          → `string` ("hello")
//   • [n,n,n]         → `double3` ((x, y, z)) — typical xformOp:translate
//   • [n,n,n,n]       → `double4` ((x, y, z, w))
//   • [n,n]           → `double2` ((u, v))
//   • [string,...]    → `string[]` (["a", "b"])
//   • [number,...]    → `double[]` ([1.0, 2.0])
//
// Prims are nested by path: each path is split on '/', the deepest
// parent is found in the composed tree, and definitions are emitted
// hierarchically so the result reads exactly like a Pixar USDA file
// you could open in `usdview`.

// ───────────────────────────────────────────────────────────────────────
// Value formatting
// ───────────────────────────────────────────────────────────────────────

function _fmtNum(n) {
  if (Number.isInteger(n)) return `${n}`;
  // Always trail a decimal so USD parsers see this as a float; trim
  // overlong representations the way Pixar's writer does.
  return Number(n).toString();
}

function _fmtString(s) {
  // Escape backslashes + double quotes so the output is parsable USDA.
  const escaped = String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function _attrTypeForValue(v) {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'double';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'double[]';
    const allNum = v.every((x) => typeof x === 'number');
    const allStr = v.every((x) => typeof x === 'string');
    if (allNum) {
      if (v.length === 2) return 'double2';
      if (v.length === 3) return 'double3';
      if (v.length === 4) return 'double4';
      return 'double[]';
    }
    if (allStr) return 'string[]';
  }
  return 'token'; // fallback
}

function _fmtValue(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return _fmtNum(v);
  if (typeof v === 'string') return _fmtString(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const allNum = v.every((x) => typeof x === 'number');
    const allStr = v.every((x) => typeof x === 'string');
    if (allNum) {
      if (v.length >= 2 && v.length <= 4) {
        return `(${v.map(_fmtNum).join(', ')})`;
      }
      return `[${v.map(_fmtNum).join(', ')}]`;
    }
    if (allStr) return `[${v.map(_fmtString).join(', ')}]`;
  }
  return _fmtString(String(v));
}

// ───────────────────────────────────────────────────────────────────────
// Prim tree assembly
// ───────────────────────────────────────────────────────────────────────
//
// We arrive with a flat list [{path, typeName, attrs}].  Turn it into
// a nested tree keyed by the leaf segment name so the USDA emitter can
// walk it depth-first.
//
// Synthetic Xform nodes are inserted at intermediate paths if the
// caller didn't author them explicitly (USD requires every parent on
// the prim's path to exist).

function _buildTree(prims) {
  const root = { children: new Map(), prim: null, segment: '' };
  for (const p of prims) {
    const segs = p.path.split('/').filter(Boolean);
    let node = root;
    let acc = '';
    for (let i = 0; i < segs.length; i++) {
      acc += '/' + segs[i];
      let next = node.children.get(segs[i]);
      if (!next) {
        next = { children: new Map(), prim: null, segment: segs[i], path: acc };
        node.children.set(segs[i], next);
      }
      node = next;
    }
    node.prim = p;
  }
  return root;
}

// ───────────────────────────────────────────────────────────────────────
// USDA emit
// ───────────────────────────────────────────────────────────────────────

function _emitNode(node, indent, out) {
  if (!node) return;
  const ind = '    '.repeat(indent);
  const typeName = (node.prim && node.prim.typeName) || 'Xform';
  // Use sorted child keys for deterministic output.
  const childKeys = Array.from(node.children.keys()).sort();

  out.push(`${ind}def ${typeName} "${node.segment}"`);
  out.push(`${ind}{`);

  if (node.prim && node.prim.attrs) {
    // Sort attr keys for deterministic output.
    const keys = Object.keys(node.prim.attrs).sort();
    for (const k of keys) {
      const v = node.prim.attrs[k];
      const type = _attrTypeForValue(v);
      out.push(`${ind}    ${type} ${k} = ${_fmtValue(v)}`);
    }
  }
  if (node.prim && childKeys.length) out.push('');

  for (let i = 0; i < childKeys.length; i++) {
    _emitNode(node.children.get(childKeys[i]), indent + 1, out);
    if (i < childKeys.length - 1) out.push('');
  }

  out.push(`${ind}}`);
}

// Public API: serialise a composed prim list to a USDA text string.
//
//   prims: [{ path, typeName, attrs }]
//   opts: { defaultPrim?: string }
//
// Returns: string in valid USDA syntax.
export function serializeUSDA(prims, opts) {
  const o = opts || {};
  const root = _buildTree(prims || []);

  const out = [];
  out.push('#usda 1.0');
  out.push('(');
  if (o.defaultPrim) out.push(`    defaultPrim = "${o.defaultPrim}"`);
  out.push('    doc = "ArchDisc Studio V3 — composed USD layer stack (slice 761)"');
  out.push(')');
  out.push('');

  // Emit top-level prims.
  const topKeys = Array.from(root.children.keys()).sort();
  for (let i = 0; i < topKeys.length; i++) {
    _emitNode(root.children.get(topKeys[i]), 0, out);
    if (i < topKeys.length - 1) out.push('');
  }

  // USD files end with a newline.
  out.push('');
  return out.join('\n');
}

// Convenience: same input shape as the LayerStack.compose() result.
export function serializeComposed(composeResult, opts) {
  if (!composeResult || !composeResult.ok) {
    return { ok: false, error: (composeResult && composeResult.error) || 'no composed result' };
  }
  return { ok: true, usda: serializeUSDA(composeResult.prims, opts) };
}

export const __internal = {
  _fmtValue,
  _attrTypeForValue,
  _buildTree,
};
