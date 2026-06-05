// ArchDisc Studio V3 — Voxel Volume (palette-index uint8 grid).
//
// MagicaVoxel-style fixed grid storage. Each cell holds a palette index
// (uint8). Zero (0) is the empty / no-voxel sentinel; values 1..255 are
// indices into the active palette (see ./palette.js).
//
// The volume is dense (not sparse). For a 32^3 grid that's 32 KiB —
// dwarfed by anything else on the page, and gives O(1) random access
// for the dragger + the mesh builder. Coordinates are integer cell
// indices in [0..sizeX), [0..sizeY), [0..sizeZ).
//
// JSON round-trip uses base64 encoding for the cell buffer so the
// payload is compact + safe to send through __studioVoxelExportJson +
// __studioVoxelImportJson without losing precision.

const MAX_SIDE = 256;

export class Volume {
  constructor(sizeX, sizeY, sizeZ) {
    const sx = clampSide(sizeX, 16);
    const sy = clampSide(sizeY, 16);
    const sz = clampSide(sizeZ, 16);
    this.sizeX = sx;
    this.sizeY = sy;
    this.sizeZ = sz;
    this.cells = new Uint8Array(sx * sy * sz);
    this.filled = 0;
  }

  // Index helper. Returns -1 if (x,y,z) is out of bounds.
  _idx(x, y, z) {
    if (x < 0 || y < 0 || z < 0) return -1;
    if (x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) return -1;
    // x varies fastest, then z, then y — matches typical voxel grid
    // expectations and is what mesh.js iterates over.
    return x + this.sizeX * (z + this.sizeZ * y);
  }

  /**
   * Set cell (x,y,z) to paletteIdx. 0 clears the cell.
   * Returns true if the cell value changed (caller can use this to skip
   * a mesh rebuild).
   */
  set(x, y, z, paletteIdx) {
    const i = this._idx(x | 0, y | 0, z | 0);
    if (i < 0) return false;
    const v = clampIdx(paletteIdx);
    const prev = this.cells[i];
    if (prev === v) return false;
    this.cells[i] = v;
    if (prev === 0 && v !== 0) this.filled++;
    else if (prev !== 0 && v === 0) this.filled--;
    return true;
  }

  /**
   * Read cell value. Returns 0 for out-of-bounds (treats out-of-volume
   * as empty space — convenient for mesh.js's neighbor-culling test).
   */
  get(x, y, z) {
    const i = this._idx(x | 0, y | 0, z | 0);
    if (i < 0) return 0;
    return this.cells[i];
  }

  clear() {
    this.cells.fill(0);
    this.filled = 0;
  }

  /**
   * Iterate every filled cell. Callback signature: (x, y, z, idx).
   * Skips zero entries — typical caller is mesh.js building geometry.
   */
  forEach(cb) {
    const { sizeX, sizeY, sizeZ, cells } = this;
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const rowBase = sizeX * (z + sizeZ * y);
        for (let x = 0; x < sizeX; x++) {
          const v = cells[rowBase + x];
          if (v !== 0) cb(x, y, z, v);
        }
      }
    }
  }

  // ─── JSON round-trip ────────────────────────────────────────────────
  toJSON() {
    return {
      kind: 'archdisc-voxel-volume',
      v: 1,
      sizeX: this.sizeX,
      sizeY: this.sizeY,
      sizeZ: this.sizeZ,
      cells: u8ToB64(this.cells),
      filled: this.filled,
    };
  }

  fromJSON(j) {
    if (!j || j.kind !== 'archdisc-voxel-volume') {
      throw new Error('volume.fromJSON: not a voxel-volume payload');
    }
    const sx = clampSide(j.sizeX, this.sizeX);
    const sy = clampSide(j.sizeY, this.sizeY);
    const sz = clampSide(j.sizeZ, this.sizeZ);
    this.sizeX = sx;
    this.sizeY = sy;
    this.sizeZ = sz;
    const want = sx * sy * sz;
    const buf = b64ToU8(j.cells || '');
    this.cells = new Uint8Array(want);
    const n = Math.min(want, buf.length);
    this.cells.set(buf.subarray(0, n));
    // Re-count filled to stay honest even if the payload was tampered.
    let filled = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] !== 0) filled++;
    this.filled = filled;
    return this;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────
function clampSide(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.max(1, Math.min(MAX_SIDE, Math.floor(v)));
}

function clampIdx(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.max(0, Math.min(255, Math.floor(v)));
}

// Base64 helpers — work in both browser (atob/btoa) and Node-style envs
// (Buffer). Studio runs in Electron so both are available; this keeps
// the unit tests headless-safe too.
function u8ToB64(u8) {
  if (typeof btoa === 'function') {
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }
  // eslint-disable-next-line no-undef
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  return '';
}

function b64ToU8(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64 || '');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // eslint-disable-next-line no-undef
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64 || '', 'base64'));
  return new Uint8Array(0);
}

export default Volume;
