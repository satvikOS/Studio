// ArchDisc Studio V3 — Pixar USD layer composition (slice 761).
//
// A pure-JS, dependency-free model of Pixar USD's scene-composition core:
// a layer stack with sublayer override semantics.  This is the part of
// the USD pipeline that Maya / Houdini / Katana all sit on top of, and
// that the binary loaders we already ship (USDZLoader in slice 162)
// don't model: the LayerStack itself.
//
// Mental model (USD docs / Pixar spec):
//
//   • A Layer holds a flat dict of prims indexed by their absolute path
//     ('/World/Box').  Each prim record is {typeName, attrs}.
//   • A Layer can sublayer OTHER layers (the sublayer arc).  When the
//     stack is composed, the sublayer with the highest opinion strength
//     wins; in USD that's the FIRST listed sublayer being STRONGEST and
//     each subsequent sublayer being WEAKER (LIVRPS strength ordering).
//     We mirror that here: layer.sublayers[0] is strongest among the
//     children; the parent's own opinions are stronger than its
//     sublayers'.
//   • A Layer can also carry references (an arc to another layer
//     loaded at a target prim path) and variants (named sub-layers
//     selected by a variantSelection on the layer).  These are
//     light-weight in this slice: references compose like sublayers
//     scoped to a path; variants pick one of the named layers and
//     splice its opinions into the composed result.
//
// `compose()` / `composeStack(rootLayer)` walks the layer tree in
// strength order (parent before sublayers; first sublayer before its
// siblings) and merges attribute opinions: a stronger opinion replaces
// a weaker one for the same {primPath, attr} pair, but typeName
// inherits from the strongest layer that introduces the prim.
//
// The composed scene is returned as an array of plain JS prim records:
//   [{ path, typeName, attrs }]
// which `usdaSerialize.js` consumes to emit a valid .usda text file.

// ───────────────────────────────────────────────────────────────────────
// Layer
// ───────────────────────────────────────────────────────────────────────

export class Layer {
  constructor(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('Layer: name must be a non-empty string');
    }
    this.name = name;
    // primPath ('/World/Box') -> { typeName: string, attrs: Map<key, value> }
    this.prims = new Map();
    // child layers; strength order = sublayers[0] strongest.
    this.sublayers = [];
    // [{ path: '/Group/X', layerName: 'asset-A' }] — references arcs
    // resolved by LayerStack name lookup.
    this.references = [];
    // variant name -> Layer; pick one via setVariantSelection().
    this.variants = new Map();
    // Active variant selection (string name into `variants`), or null.
    this.variantSelection = null;
  }

  addPrim(path, typeName, attrs) {
    if (!path || typeof path !== 'string' || !path.startsWith('/')) {
      throw new Error('Layer.addPrim: path must be absolute (start with /)');
    }
    const attrMap = new Map();
    if (attrs && typeof attrs === 'object') {
      for (const k of Object.keys(attrs)) attrMap.set(k, attrs[k]);
    }
    this.prims.set(path, {
      typeName: typeName || 'Xform',
      attrs: attrMap,
    });
    return this;
  }

  setAttr(path, key, value) {
    const p = this.prims.get(path);
    if (!p) throw new Error(`Layer.setAttr: no prim at ${path}`);
    p.attrs.set(key, value);
    return this;
  }

  addSublayer(child) {
    if (!(child instanceof Layer)) {
      throw new Error('Layer.addSublayer: child must be a Layer');
    }
    this.sublayers.push(child);
    return this;
  }

  addReference(path, layerName) {
    if (!path || typeof path !== 'string') {
      throw new Error('Layer.addReference: path must be a string');
    }
    if (!layerName || typeof layerName !== 'string') {
      throw new Error('Layer.addReference: layerName must be a string');
    }
    this.references.push({ path, layerName });
    return this;
  }

  addVariant(name, layer) {
    if (!name || typeof name !== 'string') {
      throw new Error('Layer.addVariant: name must be a string');
    }
    if (!(layer instanceof Layer)) {
      throw new Error('Layer.addVariant: layer must be a Layer');
    }
    this.variants.set(name, layer);
    return this;
  }

  setVariantSelection(name) {
    if (name !== null && !this.variants.has(name)) {
      throw new Error(`Layer.setVariantSelection: no variant ${name}`);
    }
    this.variantSelection = name;
    return this;
  }
}

// ───────────────────────────────────────────────────────────────────────
// LayerStack
// ───────────────────────────────────────────────────────────────────────

export class LayerStack {
  constructor(rootLayer) {
    this.rootLayer = null;
    // name → Layer; layers are tracked by name so reference arcs can
    // resolve through the same registry.
    this.layers = new Map();
    if (rootLayer) this.setRoot(rootLayer);
  }

  register(layer) {
    if (!(layer instanceof Layer)) {
      throw new Error('LayerStack.register: arg must be a Layer');
    }
    this.layers.set(layer.name, layer);
    return this;
  }

  setRoot(layer) {
    this.register(layer);
    this.rootLayer = layer;
    return this;
  }

  getLayer(name) {
    return this.layers.get(name) || null;
  }

  // Compose the stack rooted at `this.rootLayer` and return the prim
  // tree.  See `composeStack` below for the algorithm.
  compose() {
    if (!this.rootLayer) {
      return { ok: false, error: 'no root layer', prims: [] };
    }
    return composeStack(this.rootLayer, this);
  }
}

// ───────────────────────────────────────────────────────────────────────
// composeStack
// ───────────────────────────────────────────────────────────────────────
//
// Walk the layer tree in strength order and merge prim opinions into a
// single composed map.  Stronger layers override weaker layers for the
// same {primPath, attr} key.
//
// Strength order for a layer L:
//   1. L's own opinions  (strongest)
//   2. L.sublayers[0]    — recurse
//   3. L.sublayers[1]    — recurse
//   …
//   N. L.sublayers[N-1]  (weakest among children)
//
// Reference arcs ({path, layerName}) bring in another layer's prims
// remapped under the reference target path, ranked alongside the
// sublayers (treated as the weakest of the parent's child arcs so that
// local sublayer opinions win over a referenced asset's defaults — this
// matches USD's default 'append' arc semantics where the local
// rootLayer is strongest).
//
// Variants: if a layer carries `variantSelection`, the selected variant
// layer is spliced in as the STRONGEST child arc, just under the
// layer's own opinions.  This lines up with USD's variant strength.
//
// The merge rule for a single primPath:
//   • The first writer wins for `typeName`.
//   • The first writer wins for every attribute key.
//   • Later (weaker) writers can introduce ATTRS the stronger layers
//     didn't set; they cannot override existing ones.
//
// We seed the visit order top-down (strength-first), so "first writer
// wins" is exactly "strongest opinion wins".

export function composeStack(rootLayer, stack) {
  if (!(rootLayer instanceof Layer)) {
    return { ok: false, error: 'rootLayer must be a Layer', prims: [] };
  }
  const composed = new Map(); // path → { path, typeName, attrs }
  const seen = new Set();      // cycle guard on layer name

  function visit(layer) {
    if (!layer) return;
    if (seen.has(layer.name)) return; // cycle guard
    seen.add(layer.name);

    // (1) layer's own opinions: strongest at this level.
    for (const [path, prim] of layer.prims) {
      const existing = composed.get(path);
      if (!existing) {
        const attrMap = new Map();
        for (const [k, v] of prim.attrs) attrMap.set(k, v);
        composed.set(path, {
          path,
          typeName: prim.typeName,
          attrs: attrMap,
        });
      } else {
        for (const [k, v] of prim.attrs) {
          if (!existing.attrs.has(k)) existing.attrs.set(k, v);
        }
      }
    }

    // (2) variant selection: spliced in next.  In USD strength order
    // variants come between local opinions and sublayers; matches the
    // standard "L V S" strength ordering (Local > Variant > Sublayer).
    if (layer.variantSelection !== null
        && layer.variants.has(layer.variantSelection)) {
      visit(layer.variants.get(layer.variantSelection));
    }

    // (3) sublayers: in declaration order (sublayers[0] strongest).
    for (const child of layer.sublayers) {
      visit(child);
    }

    // (4) references: resolved against the stack by name; remapped
    // under the target path.  Weaker than sublayers in this model.
    if (stack && layer.references.length) {
      for (const ref of layer.references) {
        const refLayer = stack.getLayer(ref.layerName);
        if (!refLayer) continue;
        // Build a remapped layer-shaped record: every prim's path is
        // prefixed with the reference target.
        const remapped = new Layer(`${layer.name}@ref:${ref.layerName}`);
        for (const [path, prim] of refLayer.prims) {
          // `/World/Box` referenced at `/Set/Group` → `/Set/Group/Box`
          // If the prim path inside the referenced layer is exactly
          // `/`, the reference replaces the target itself.
          let composedPath;
          if (path === '/') {
            composedPath = ref.path;
          } else {
            composedPath = ref.path + path;
          }
          remapped.prims.set(composedPath, {
            typeName: prim.typeName,
            attrs: new Map(prim.attrs),
          });
        }
        visit(remapped);
      }
    }
  }

  visit(rootLayer);

  const prims = [];
  // Stable output order: sorted by path so screenshots / USDA bytes
  // are reproducible across runs.
  for (const path of Array.from(composed.keys()).sort()) {
    const p = composed.get(path);
    const attrsObj = {};
    for (const [k, v] of p.attrs) attrsObj[k] = v;
    prims.push({
      path: p.path,
      typeName: p.typeName,
      attrs: attrsObj,
    });
  }
  return { ok: true, prims };
}

// ───────────────────────────────────────────────────────────────────────
// Internals exported for tests
// ───────────────────────────────────────────────────────────────────────

export const __internal = {
  // expose helpers if a unit test wants them
};
