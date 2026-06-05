# ArchDisc Studio V3 — common/ dedup audit

This file records every duplicated utility this dedup pass consolidated,
along with the resolution (which inline copy was deleted + which import
replaced it) and the approximate line-count savings.

External `__studio*` op surface is unchanged. The dedup is purely
internal: each module still publishes its window globals with the same
shapes, return contracts, and side effects.

## common/random.js — `mulberry32`, `seededRandom01`, `fnv1a32`

Before: 5 inline copies of `mulberry32`, 1 of `hashString` (FNV-1a).

| Module                       | Inline body | Replacement                            |
| ---------------------------- | ----------: | -------------------------------------- |
| mograph/effector.js          | 10 lines + 8-line `hashString` | `import { mulberry32, fnv1a32 as hashString }` |
| mograph/field.js             | 10 lines    | `import { mulberry32 }`                |
| geomnodes/nodes.js           | 10 lines    | `import { mulberry32 }`                |
| geomtotal/nodes.js           | 10 lines    | `import { mulberry32 }`                |
| geomdeep/morenodes.js        | 10 lines    | `import { mulberry32 }`                |

rt/pathtracer.js's `_mulberry` is INTENTIONALLY kept inline — its
normalisation differs (`% 0xffffff / 0xffffff` vs `/ 4294967296`) and the
path tracer's accumulation test asserts on exact bit pattern.

Lines saved: ~60.

## common/noise.js — `hash2`, `valueNoise2D`, `valueNoise3D`, `smoothValueNoise3D`, `voronoi2D`

Before: 3 inline `valueNoise` flavours + 1 trilinear-interpolated copy.

| Module                  | Inline body          | Replacement                                |
| ----------------------- | -------------------: | ------------------------------------------ |
| shader/nodes.js         | 17 lines (hash2 + valueNoise) | re-exports via `import { hash2 as _commonHash2, valueNoise2D as _commonValueNoise2D }` |
| shaderdeep/morenodes.js | 14 lines             | `import { hash2, valueNoise2D as valueNoise }` |
| geomdeep/morenodes.js   | 5 lines              | `import { valueNoise3D as valueNoise }`    |
| modstack/stack.js       | 32 lines (`_hashNoise` + `_smoothNoise`) | wraps `smoothValueNoise3D` from common/ |

Lines saved: ~55.

## common/brush.js — `softFalloff`, `smoothFalloff`, `applyBrushOnVertices`

| Module                       | Inline body | Replacement |
| ---------------------------- | ----------: | ----------- |
| sculptbrushes/brushes.js     | 5-line `_falloff`             | `import { smoothFalloff as _smoothFalloff }`; `_falloff` now wraps it |

api.js's slice-621 brush keeps its inline Pow falloff because it
exposes the same constants live on `window.__studioSculptBrush` —
external callers (Archie scripts) read those numbers; rewriting via the
shared helper would be a pure-internal restructure of a slot the brief
explicitly forbids touching.

Lines saved: ~5 directly; future sculpt/sculptbrushes/paintproj brushes
can all consume the shared helper.

## common/scatter.js — `scatterOnSurface`

| Module                  | Inline body | Replacement |
| ----------------------- | ----------: | ----------- |
| geomtotal/nodes.js      | The area-weighted scatter in the `pointsOnFaces` node is left as-is (it returns a point-cloud geometry, not flat arrays) but reads the same `mulberry32` from common/random.js. |

The canonical helper is now available to mograph/foliage/fx/etc. Wave-8
foliage will consume it directly.

Lines saved: contributes to future-slice savings; no immediate inline
deletion because the existing call sites were already specialised.

## common/subdivide.js — `loopSubdivide`, `simpleSplitSubdivide`

| Module                  | Inline body | Replacement |
| ----------------------- | ----------: | ----------- |
| geomnodes/nodes.js      | 35-line midpoint split | `simpleSplitSubdivide(base, n)`            |
| modstack/stack.js       | 36-line indexed split  | `loopSubdivide(g, iters)`                  |

api.js's `__studioSubdivide` (slice 623) is explicitly excluded from
edits per brief; the algorithm is identical.

Lines saved: ~70.

## common/instance.js — `makeInstancedMesh`, `setInstanceMatrices`, `recolorInstances`

Canonical builder. The mograph/cloner.js call sites already use
`emitInstancedMesh`; the common/ version is bit-identical and tagged so
foliage + wave-8 instance ops can adopt it without changing their
contract. Not yet rewriting mograph internally because it depends on a
specific userData shape (archdiscStudioCloner.baseMatrices) the canonical
helper now writes the same way.

Lines saved: 0 immediate; ~25 expected when foliage lands.

## common/panel.js — `mountPanel`, `unmountPanel`

Replaces the ~6-line "createElement / setAttribute / appendChild /
createRoot" boilerplate in EVERY editor / side-panel module.

| Module                 | Inline body | Replacement |
| ---------------------- | ----------: | ----------- |
| anim/index.js          | 12 lines    | `_panel = mountPanel('anim-graph-editor')` |
| bp/index.js            | 13 lines    | `_panel = mountPanel('bp-editor')`         |
| modstack/index.js      | 9 lines     | `_panel = mountPanel('modstack')`          |
| matlib/index.js        | 12 lines    | `_panel = mountPanel('matlib')`            |
| audio/index.js         | 12 lines    | `_panel = mountPanel('audio-panel')`       |
| compositor/index.js    | 11 lines    | `_panel = mountPanel('compositor-editor')` |
| geomnodes/index.js     | 11 lines    | `_panel = mountPanel('geomnodes-editor')`  |
| shader/index.js        | 9 lines     | `_panel = mountPanel('shader-editor')`     |
| texpaint/index.js      | 9 lines     | `_panel = mountPanel('texpaint')`          |
| vex/index.js           | 9 lines     | `_panel = mountPanel('vex-editor')`        |
| vse/index.js           | 11 lines    | `_panel = mountPanel('vse-editor')`        |
| gp/index.js            | 9 lines     | `_panel = mountPanel('gp')`                |
| snap2/index.js         | 11 lines    | `_panel = mountPanel('snap2')`             |
| animadv/index.js       | 11 lines    | `_panel = mountPanel('animadv-nla-editor')` |
| multiview/index.js     | 13 lines    | `_panel = mountPanel('multiview')`         |
| simbake/index.js       | 9 lines     | `_panel = mountPanel('simbake')`           |
| outliner/index.js      | 9 lines     | `_panel = mountPanel('outliner')`          |
| assetbrowser/index.js  | 9 lines     | `_panel = mountPanel('assetbrowser')`      |

Also collapsed the matching teardown (`_root.unmount()` +
`_host.parentNode.removeChild(_host)`) into a single `unmountPanel()`
call per uninstall path.

Lines saved: ~180.

## common/registry.js — `registerOp`, `registerOps`, `unregisterOps`

Replaces the manual "register + retry-on-cold-start" boilerplate from
EVERY install path (~15-30 lines each).

| Module                       | Inline body | Replacement |
| ---------------------------- | ----------: | ----------- |
| anim/index.js                | 25 lines    | one-line `registerOp(name, fn, 'anim', desc)` wrapper |
| animadv/index.js             | 25 lines    | same                                                 |
| audio/index.js               | 16 lines    | same                                                 |
| assetbrowser/index.js        | 6 lines (no retry)  | `registerOp` (adds retry)                   |
| bp/index.js                  | 7 lines     | `registerOps({...}, 'bp')`                           |
| compositor/index.js          | 17 lines    | `registerOp(name, fn, 'compositor', desc)`          |
| fx/index.js                  | 17 lines    | `registerOp(name, fn, 'fx', desc)`                  |
| geomnodes/index.js           | 6 lines (no retry)  | `registerOps({...}, 'geomnodes')`           |
| gp/index.js                  | 12 lines    | `registerOp(name, fn, 'gp', desc)`                  |
| matlib/index.js              | 6 lines (no retry)  | `registerOp(name, fn, 'matlib', desc)`     |
| modstack/index.js            | 11 lines    | `registerOp(name, fn, 'modstack', desc)`            |
| mograph/index.js             | 12 lines    | `registerOp(name, fn, 'mograph', desc)`             |
| multiview/index.js           | 14 lines    | `registerOp(name, fn, 'multiview', desc)`           |
| outliner/index.js            | 6 lines     | `registerOp(name, fn, 'outliner', desc)`            |
| rig/index.js                 | 22 lines    | `registerOp(name, fn, 'rig', desc)`                 |
| rigui/index.js               | 17 lines    | `registerOp(name, fn, 'rig', desc)`                 |
| rt/index.js                  | 17 lines    | `registerOp(name, fn, 'rt', desc)`                  |
| rtgpu/index.js               | 17 lines    | `registerOp(name, fn, 'rt', desc)`                  |
| sculpt/index.js              | 12 lines    | `registerOp(name, fn, 'sculpt', desc)`              |
| sculptbrushes/index.js       | 13 lines    | `registerOp(name, fn, 'sculpt', desc)`              |
| shader/index.js              | 6 lines (no retry)  | `registerOps({...}, 'shader')`              |
| sim/index.js                 | 17 lines    | `registerOp(name, fn, 'sim', desc)`                 |
| simbake/index.js             | 11 lines    | `registerOp(name, fn, 'sim', desc)`                 |
| snap2/index.js               | 16 lines    | `registerOp(name, fn, 'snap', desc)`                |
| texpaint/index.js            | 8 lines     | `registerOp(name, fn, 'texpaint', desc)`            |
| vector/index.js              | 14 lines    | `registerOp(name, fn, 'vector', desc)`              |
| vex/index.js                 | 12 lines    | `registerOp(name, fn, 'vex', desc)`                 |
| vse/index.js                 | 16 lines    | `registerOp(name, fn, 'vse', desc)`                 |
| vsefx/index.js               | 16 lines    | `registerOp(name, fn, 'vse', desc)`                 |
| editmore/index.js            | 18 lines    | `registerOp(name, fn, 'edit', desc)`                |

Per-module uninstall blocks (manual `delete window[k]` + optional
`__studioCommandUnregister(k)` loop) all collapsed into a single
`unregisterOps([...])` call. ~10 modules so refactored.

Lines saved: ~340.

## common/sample-texture.js — `sampleMaterialTextureAtUV`

| Module                  | Inline body | Replacement |
| ----------------------- | ----------: | ----------- |
| rt/pathtracer.js        | 33 lines    | `import { sampleMaterialTextureAtUV as _sampleMaterialTextureAtUV }` |

The slice-693 rtgpu module currently builds its own GPU textures rather
than calling this CPU sampler, so no duplication exists there yet. The
shaderptbridge that wave-8 will introduce will consume this helper too.

Lines saved: ~33.

## common/anim-tick.js — `chainIntoAnimTick`, `unchainFromAnimTick`, `isChained`

Replaces the manual "preserve prev, tag wrapper, splice chain on
detach" boilerplate.

| Module                       | Inline body | Replacement |
| ---------------------------- | ----------: | ----------- |
| anim/playback.js             | 23 lines    | `chainIntoAnimTick('animGraph', tickFn)`           |
| bp/runtime.js                | 33 lines    | `chainIntoAnimTick('bp', tickFn)` + `unchainFromAnimTick('bp')` |
| fx/index.js                  | 22 lines    | same, label 'fx'                                   |
| multiview/index.js           | 38 lines    | same, label 'multiview'                            |
| sim/index.js                 | 25 lines    | same, label 'sim'                                  |

rt/index.js + rtgpu/index.js have bespoke composer-style ticks that do
more than just call a user fn (they branch on `_active`, paint the
buffer, hash camera state) — left as-is. They still don't call the
shared helper but each has been collapsed at the registration boundary.

Lines saved: ~140.

## Total

Approximately 880 lines of inline duplication consolidated into 10 new
files (`random.js`, `noise.js`, `raycast.js`, `brush.js`, `scatter.js`,
`subdivide.js`, `instance.js`, `panel.js`, `registry.js`,
`sample-texture.js`, `anim-tick.js`).

External op surface (`window.__studio*`) unchanged. `npm run build`
passes. Headless smoke test of each common/ module's main export
exercised against synthetic args without throwing.
