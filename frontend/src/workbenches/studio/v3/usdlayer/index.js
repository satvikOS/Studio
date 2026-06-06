// ArchDisc Studio V3 — Pixar USD layer composition install (slice 761).
//
// Wires `LayerStack` + `serializeUSDA` to the V3 window op surface.
// The model is purely in-memory: no Pixar libraries, no file IO. The
// user creates layers by name, adds prims to them, parents weaker
// layers as sublayers of stronger ones, composes the stack, and asks
// for the USDA text form of the result.
//
// Ops (all auto-registered on the v3 command palette):
//
//   __studioUSDLayerCreate(name)
//     → { ok: true, name }                            create a new Layer
//
//   __studioUSDLayerAddPrim(layerName, path, typeName, attrs)
//     → { ok: true }                                  add a prim to layer
//
//   __studioUSDLayerAddSublayer(parentLayerName, childLayerName)
//     → { ok: true }                                  parent → child arc
//
//   __studioUSDLayerCompose(rootLayerName)
//     → { ok: true, prims: [...] }                    composed prim tree
//
//   __studioUSDLayerExportUSDA(rootLayerName)
//     → { ok: true, usda: <string> }                  full USDA text
//
//   __studioUSDLayerList()
//     → { ok: true, names: [...] }                    list of layer names
//
//   __studioUSDLayerAddReference(layerName, path, refLayerName)
//     → { ok: true }                                  reference arc
//
//   __studioUSDLayerAddVariant(layerName, variantName, variantLayerName)
//   __studioUSDLayerSetVariantSelection(layerName, variantName)
//     → { ok: true }                                  variants
//
//   __studioUSDLayerReset()
//     → { ok: true }                                  wipe the registry
//
// Idempotent install.  Re-running `installUSDLayer()` is a no-op.

import { registerOps, unregisterOps } from '../common/registry.js';
import { Layer, LayerStack, composeStack } from './layerStack.js';
import { serializeUSDA } from './usdaSerialize.js';

let _installed = false;

// One stack per Studio session.  Layers are created lazily and tracked
// by name so other modules (and tests) can poke them by name.
const _stack = new LayerStack();

function _ensureLayer(name) {
  let l = _stack.getLayer(name);
  if (!l) {
    l = new Layer(name);
    _stack.register(l);
  }
  return l;
}

// ───────────────────────────────────────────────────────────────────────
// Op implementations
// ───────────────────────────────────────────────────────────────────────

function __studioUSDLayerCreate(name) {
  if (!name || typeof name !== 'string') {
    return { ok: false, error: 'name required' };
  }
  if (_stack.getLayer(name)) {
    return { ok: true, name, alreadyExists: true };
  }
  const layer = new Layer(name);
  _stack.register(layer);
  if (!_stack.rootLayer) _stack.rootLayer = layer;
  return { ok: true, name };
}

function __studioUSDLayerAddPrim(layerName, path, typeName, attrs) {
  if (!layerName) return { ok: false, error: 'layerName required' };
  if (!path || typeof path !== 'string' || !path.startsWith('/')) {
    return { ok: false, error: 'path must be an absolute USD path' };
  }
  const layer = _ensureLayer(layerName);
  try {
    layer.addPrim(path, typeName || 'Xform', attrs || {});
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
  return { ok: true };
}

function __studioUSDLayerAddSublayer(parentLayerName, childLayerName) {
  if (!parentLayerName || !childLayerName) {
    return { ok: false, error: 'parent + child layer names required' };
  }
  const parent = _ensureLayer(parentLayerName);
  const child = _ensureLayer(childLayerName);
  if (parent === child) {
    return { ok: false, error: 'cannot sublayer self' };
  }
  parent.addSublayer(child);
  return { ok: true };
}

function __studioUSDLayerAddReference(layerName, path, refLayerName) {
  if (!layerName || !refLayerName) {
    return { ok: false, error: 'layerName + refLayerName required' };
  }
  if (!path || typeof path !== 'string' || !path.startsWith('/')) {
    return { ok: false, error: 'path must be an absolute USD path' };
  }
  const layer = _ensureLayer(layerName);
  _ensureLayer(refLayerName);
  layer.addReference(path, refLayerName);
  return { ok: true };
}

function __studioUSDLayerAddVariant(layerName, variantName, variantLayerName) {
  if (!layerName || !variantName || !variantLayerName) {
    return { ok: false, error: 'layerName + variantName + variantLayerName required' };
  }
  const layer = _ensureLayer(layerName);
  const variantLayer = _ensureLayer(variantLayerName);
  layer.addVariant(variantName, variantLayer);
  return { ok: true };
}

function __studioUSDLayerSetVariantSelection(layerName, variantName) {
  if (!layerName) return { ok: false, error: 'layerName required' };
  const layer = _stack.getLayer(layerName);
  if (!layer) return { ok: false, error: `no layer ${layerName}` };
  try {
    layer.setVariantSelection(variantName);
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
  return { ok: true };
}

function __studioUSDLayerCompose(rootLayerName) {
  const root = rootLayerName
    ? _stack.getLayer(rootLayerName)
    : _stack.rootLayer;
  if (!root) {
    return { ok: false, error: `no layer ${rootLayerName || '(root)'}`, prims: [] };
  }
  return composeStack(root, _stack);
}

function __studioUSDLayerExportUSDA(rootLayerName) {
  const composed = __studioUSDLayerCompose(rootLayerName);
  if (!composed.ok) return composed;
  const defaultPrim = composed.prims.length
    ? composed.prims[0].path.split('/').filter(Boolean)[0]
    : undefined;
  const usda = serializeUSDA(composed.prims, { defaultPrim });
  return { ok: true, usda };
}

function __studioUSDLayerList() {
  return { ok: true, names: Array.from(_stack.layers.keys()) };
}

function __studioUSDLayerReset() {
  _stack.layers.clear();
  _stack.rootLayer = null;
  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────
// Install / uninstall
// ───────────────────────────────────────────────────────────────────────

const OP_NAMES = [
  '__studioUSDLayerCreate',
  '__studioUSDLayerAddPrim',
  '__studioUSDLayerAddSublayer',
  '__studioUSDLayerAddReference',
  '__studioUSDLayerAddVariant',
  '__studioUSDLayerSetVariantSelection',
  '__studioUSDLayerCompose',
  '__studioUSDLayerExportUSDA',
  '__studioUSDLayerList',
  '__studioUSDLayerReset',
];

export function installUSDLayer() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioUSDLayerInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioUSDLayerInstalled = true;

  const ops = {
    __studioUSDLayerCreate: [
      __studioUSDLayerCreate,
      'USD layer composition — create a named Layer',
    ],
    __studioUSDLayerAddPrim: [
      __studioUSDLayerAddPrim,
      'USD layer composition — add a prim to a layer',
    ],
    __studioUSDLayerAddSublayer: [
      __studioUSDLayerAddSublayer,
      'USD layer composition — parent → child sublayer arc',
    ],
    __studioUSDLayerAddReference: [
      __studioUSDLayerAddReference,
      'USD layer composition — reference arc at a target path',
    ],
    __studioUSDLayerAddVariant: [
      __studioUSDLayerAddVariant,
      'USD layer composition — register a variant on a layer',
    ],
    __studioUSDLayerSetVariantSelection: [
      __studioUSDLayerSetVariantSelection,
      'USD layer composition — pick which variant is active',
    ],
    __studioUSDLayerCompose: [
      __studioUSDLayerCompose,
      'USD layer composition — compose a stack to a prim tree',
    ],
    __studioUSDLayerExportUSDA: [
      __studioUSDLayerExportUSDA,
      'USD layer composition — emit Pixar USDA text',
    ],
    __studioUSDLayerList: [
      __studioUSDLayerList,
      'USD layer composition — list all known layer names',
    ],
    __studioUSDLayerReset: [
      __studioUSDLayerReset,
      'USD layer composition — wipe the registry',
    ],
  };

  registerOps(ops, 'usdlayer', 'Pixar USD layer composition + USDA serialization');
  return { ok: true, ops: OP_NAMES.length };
}

export function uninstallUSDLayer() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioUSDLayerInstalled = false;
  return { ok: true };
}

// Exposed for unit tests and other modules that want to drive the
// in-memory model directly.
export const __internal = {
  _stack,
  Layer,
  LayerStack,
  composeStack,
  serializeUSDA,
};

export default installUSDLayer;
