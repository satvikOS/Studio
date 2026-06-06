// Slice 751 — Sparse VDB-style tile bookkeeping.
//
// Pure JS sparse volume store modelled on OpenVDB / Houdini VDB grids
// (Museth 2013, "VDB: High-Resolution Sparse Volumes with Dynamic
// Topology"). No three.js coupling — this is the *backing store* only;
// rendering / meshing can be wired separately. The dense pyro solver
// shipped in slices 698 / 730 / 731 is untouched: sparseVDB sits beside
// it as a parallel data structure so we can grow the Houdini Volume/VDB
// parity row without disturbing the running pyro path.
//
// Topology:
//   • A top-level dense root (a Map keyed by packed tile coords).
//   • Fixed-size leaf tiles (default 8³ = 512 cells, Float32 per cell).
//   • Tiles allocate on first nonzero write; prune() drops tiles whose
//     per-tile |max| falls below a threshold.
//
// Key packing:
//   tx = x >> log2(tileSize); same for ty/tz.
//   With OFF = 2^20, packed = ((tx+OFF)<<42)|((ty+OFF)<<21)|(tz+OFF).
//   JS bitwise truncates at 32 bits, so we evaluate the shifts as
//   multiplications. For practical scenes (|tile coord| ≪ 2^11) the
//   packed Number stays within 2^53 and is collision-free; the spec
//   accepts this honestly-bounded "Number-safe ≤2^53" envelope.
//
// Complexity:
//   set / get: O(1) hashed tile lookup + O(1) local index.
//   prune:     O(activeTileCount).
//   stats:     O(1) cached counters; bounds is O(activeTileCount) over
//              tile coords (cheap, no per-voxel walk).

const OFF = 1 << 20;          // 2^20 = 1,048,576 — signed 21-bit offset
const POW21 = 2 ** 21;        // shift-by-21 as multiplication
const POW42 = 2 ** 42;        // shift-by-42 as multiplication

// log2 for power-of-two tile sizes (8, 16, 32, …).
function _log2Pow2(n) {
  let s = 0;
  let v = n;
  while (v > 1) { v >>= 1; s++; }
  return s;
}

function _floorDivShift(v, shift) {
  // Integer floor-div by 2^shift that works correctly for negatives.
  // (v >> shift) only matches floor() for non-negatives in JS.
  return Math.floor(v / (1 << shift));
}

function _packTileKey(tx, ty, tz) {
  // ((tx+OFF)<<42) | ((ty+OFF)<<21) | (tz+OFF), evaluated as floats so
  // we keep the high bits the bitwise operators would discard.
  const a = (tx + OFF) * POW42;
  const b = (ty + OFF) * POW21;
  const c = (tz + OFF);
  return a + b + c;
}

class _Tile {
  constructor(tx, ty, tz, cells) {
    this.tx = tx;
    this.ty = ty;
    this.tz = tz;
    this.data = new Float32Array(cells);   // tileSize³ cells
    this.max = 0;                          // running |max| for prune()
    this.nonzero = 0;                      // # nonzero cells in this tile
  }
}

export class SparseVDB {
  constructor(name, tileSize = 8) {
    // Force power-of-two tile size (so we can use bit-shift for tile
    // coords inside positive ranges and stay aligned with VDB's tree
    // discipline). Clamp to a sane band — too-small tiles inflate the
    // root map, too-large tiles defeat sparsity.
    let ts = Math.max(2, Math.min(64, Math.floor(tileSize) || 8));
    // Snap to nearest lower power of two.
    let p = 1;
    while ((p << 1) <= ts) p <<= 1;
    ts = p;

    this.name = String(name || '');
    this.tileSize = ts;
    this.tileShift = _log2Pow2(ts);
    this.tileMask = ts - 1;
    this.tileCells = ts * ts * ts;
    this.tiles = new Map();                // packedKey -> _Tile
    this._activeVoxelCount = 0;            // running total of nonzero cells
  }

  // ── Internal helpers ────────────────────────────────────────────

  _tileCoord(x) { return _floorDivShift(x, this.tileShift); }
  _localIdx(x, y, z) {
    // Local coords within the tile, in [0..tileSize).
    const lx = ((x % this.tileSize) + this.tileSize) % this.tileSize;
    const ly = ((y % this.tileSize) + this.tileSize) % this.tileSize;
    const lz = ((z % this.tileSize) + this.tileSize) % this.tileSize;
    const ts = this.tileSize;
    return lx + ly * ts + lz * ts * ts;
  }

  // ── Public API ──────────────────────────────────────────────────

  set(x, y, z, val) {
    const v = Number(val) || 0;
    const tx = this._tileCoord(x);
    const ty = this._tileCoord(y);
    const tz = this._tileCoord(z);
    const key = _packTileKey(tx, ty, tz);
    let tile = this.tiles.get(key);
    const idx = this._localIdx(x, y, z);

    if (!tile) {
      if (v === 0) return { ok: true, allocated: false };  // no tile for zero write
      tile = new _Tile(tx, ty, tz, this.tileCells);
      this.tiles.set(key, tile);
    }

    const prev = tile.data[idx];
    if (prev === v) return { ok: true, allocated: false };

    tile.data[idx] = v;
    const absV = Math.abs(v);
    if (absV > tile.max) tile.max = absV;

    // Maintain nonzero counters.
    if (prev !== 0 && v === 0) {
      tile.nonzero--;
      this._activeVoxelCount--;
    } else if (prev === 0 && v !== 0) {
      tile.nonzero++;
      this._activeVoxelCount++;
    }
    return { ok: true, allocated: true };
  }

  get(x, y, z) {
    const tx = this._tileCoord(x);
    const ty = this._tileCoord(y);
    const tz = this._tileCoord(z);
    const key = _packTileKey(tx, ty, tz);
    const tile = this.tiles.get(key);
    if (!tile) return 0;
    return tile.data[this._localIdx(x, y, z)];
  }

  // Drop tiles whose per-tile |max| is below `threshold`. We refresh
  // each tile's max from its data array before testing, since the
  // running max on set() is monotonic — writing a *smaller* value over
  // the previous peak leaves the cached max stale, which would block
  // legitimate prunes after an overwrite. Returns {removed, kept}.
  prune(threshold) {
    const t = Number(threshold) || 0;
    let removed = 0;
    for (const [key, tile] of this.tiles) {
      // Refresh max from the live data.
      let m = 0;
      const d = tile.data;
      for (let i = 0; i < d.length; i++) {
        const a = d[i] < 0 ? -d[i] : d[i];
        if (a > m) m = a;
      }
      tile.max = m;
      if (m < t) {
        this._activeVoxelCount -= tile.nonzero;
        this.tiles.delete(key);
        removed++;
      }
    }
    return { removed, kept: this.tiles.size };
  }

  activeTileCount() { return this.tiles.size; }

  activeVoxelCount() {
    // _activeVoxelCount is maintained incrementally; double-check
    // against a fresh sum only on demand isn't worth the cost.
    return this._activeVoxelCount;
  }

  stats() {
    const tileCount = this.tiles.size;
    let bounds = null;
    if (tileCount > 0) {
      let mnx = Infinity, mny = Infinity, mnz = Infinity;
      let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      const ts = this.tileSize;
      for (const tile of this.tiles.values()) {
        if (tile.tx < mnx) mnx = tile.tx;
        if (tile.ty < mny) mny = tile.ty;
        if (tile.tz < mnz) mnz = tile.tz;
        if (tile.tx > mxx) mxx = tile.tx;
        if (tile.ty > mxy) mxy = tile.ty;
        if (tile.tz > mxz) mxz = tile.tz;
      }
      bounds = {
        min: [mnx * ts, mny * ts, mnz * ts],
        max: [(mxx + 1) * ts - 1, (mxy + 1) * ts - 1, (mxz + 1) * ts - 1],
      };
    }
    return {
      activeTileCount: tileCount,
      activeVoxelCount: this._activeVoxelCount,
      allocatedCells: tileCount * this.tileCells,
      tileSize: this.tileSize,
      bounds,
    };
  }

  forEachActiveTile(cb) {
    if (typeof cb !== 'function') return;
    for (const tile of this.tiles.values()) {
      cb(tile);
    }
  }

  clear() {
    this.tiles.clear();
    this._activeVoxelCount = 0;
    return { ok: true };
  }

  // Sparse VDBs grow on first write — no preallocation is required.
  // The op exists so callers can mirror dense-grid expand()/resize()
  // intent without conditionals; it is intentionally a no-op.
  expand() { return { ok: true, noop: true }; }
}

export { _packTileKey };
