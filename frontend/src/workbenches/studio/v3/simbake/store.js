// ArchDisc Studio V3 — sim-bake cache store.
//
// Module-level Map of cached bakes keyed by source uuid. Each bake
// entry is a plain object:
//
//   {
//     uuid:        string           // source object uuid (cloth / fluid /
//                                   // softbody / particle system / hair)
//     kind:        string           // 'particles' | 'cloth' | 'softbody'
//                                   // 'fluid'    | 'hair'
//     fps:         number           // bake sample rate (Hz)
//     frames:      number           // total snapshots captured
//     durationSec: number           // fps · frames seconds of sim
//     vertCount:   number           // floats-per-frame / 3
//     buffer:      Float32Array     // length = frames · vertCount · 3
//     bytes:       number           // buffer.byteLength
//     name:        string           // human-friendly label (mesh.name)
//     bakedAt:     number           // performance.now() snapshot for UX
//     paused:      boolean          // playCached driver pause flag
//     // hair-only: arrays-per-strand of (segCount+1)·3 floats per frame
//     strands:     { count, segCount }  // structural metadata for hair
//   }
//
// Only this module reaches into `_bakes`; everything else goes through
// the exported helpers. Idempotent across hot-reload guarded by a single
// well-known global symbol so multiple imports share the same Map.

const _SYM = Symbol.for('archdiscStudioSimBakeStore');

function _getStore() {
  if (typeof globalThis === 'undefined') return new Map();
  if (!globalThis[_SYM]) globalThis[_SYM] = new Map();
  return globalThis[_SYM];
}

// Public API ──────────────────────────────────────────────────────────────

export function setCached(uuid, entry) {
  if (!uuid || !entry) return { ok: false, error: 'missing args' };
  _getStore().set(uuid, entry);
  return { ok: true, uuid, frames: entry.frames || 0, bytes: entry.bytes || 0 };
}

export function getCached(uuid) {
  if (!uuid) return null;
  return _getStore().get(uuid) || null;
}

export function hasCached(uuid) {
  return _getStore().has(uuid);
}

export function listCached() {
  const out = [];
  _getStore().forEach((entry, uuid) => {
    out.push({
      uuid,
      kind:        entry.kind,
      name:        entry.name,
      fps:         entry.fps,
      frames:      entry.frames,
      durationSec: entry.durationSec,
      bytes:       entry.bytes,
      vertCount:   entry.vertCount,
      bakedAt:     entry.bakedAt,
    });
  });
  return out;
}

// clearCache(null|undefined)        → clear every bake.
// clearCache(uuid)                  → clear one bake.
export function clearCache(uuid) {
  const store = _getStore();
  if (uuid == null) {
    const n = store.size;
    store.clear();
    return { ok: true, cleared: n };
  }
  const had = store.delete(uuid);
  return { ok: true, cleared: had ? 1 : 0 };
}

export function getCacheBytes() {
  let total = 0;
  const perBake = [];
  _getStore().forEach((entry, uuid) => {
    const b = entry.bytes || 0;
    total += b;
    perBake.push({ uuid, name: entry.name, bytes: b, frames: entry.frames });
  });
  return { total, perBake };
}

export function size() {
  return _getStore().size;
}
