// ArchDisc Studio V3 — HDR EXR I/O (slice 906).
// 16-bit half-float read + write for OpenEXR-style HDR images. Pure-JS
// half-precision conversion; canvas-style ImageData × half-float
// interchange so the compositing graph can stay 32-bit float internally.

import { registerOps } from '../common/registry.js';
let _installed = false;
// IEEE 754 binary16 ↔ Float32
function _f32ToF16(val) {
  const f32 = new Float32Array(1); f32[0] = val;
  const u32 = new Uint32Array(f32.buffer)[0];
  const sign = (u32 >> 31) & 0x1;
  const exp = (u32 >> 23) & 0xff;
  const mant = u32 & 0x7fffff;
  let h = 0;
  if (exp === 0xff) h = (sign << 15) | 0x7c00 | (mant ? 1 : 0);
  else if (exp > 142) h = (sign << 15) | 0x7c00; // overflow → inf
  else if (exp < 113) {
    if (exp < 103) h = sign << 15;
    else {
      const m = (mant | 0x800000) >> (126 - exp);
      h = (sign << 15) | m;
    }
  } else h = (sign << 15) | ((exp - 112) << 10) | (mant >> 13);
  return h & 0xffff;
}
function _f16ToF32(half) {
  const sign = (half >> 15) & 0x1;
  const exp = (half >> 10) & 0x1f;
  const mant = half & 0x3ff;
  if (exp === 0) {
    if (mant === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * Math.pow(2, -14) * (mant / 1024);
  }
  if (exp === 0x1f) return mant === 0 ? (sign ? -Infinity : Infinity) : NaN;
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mant / 1024);
}
// EXR is complex (Piz/Zip/raw compression, multi-channel). We implement
// a minimal RAW-uncompressed scanline-EXR writer + reader sufficient for
// CG/VFX exchange between Studio passes.
function _writeEXR({ width, height, rgbF32 }) {
  // Minimal scanline RAW EXR (compression: none, single RGB channels).
  const headerStr = `MAGIC[20000630]channels:R,G,B;dataWindow:0,0,${width-1},${height-1};compression:NONE`;
  const enc = new TextEncoder();
  const headerBytes = enc.encode(headerStr);
  const pixelBytes = width * height * 3 * 2; // 3 channels × half-float
  const buf = new ArrayBuffer(headerBytes.length + 8 + pixelBytes);
  const view = new DataView(buf);
  let o = 0;
  for (const b of headerBytes) view.setUint8(o++, b);
  view.setUint32(o, width, true); o += 4;
  view.setUint32(o, height, true); o += 4;
  for (let i = 0; i < width * height * 3; i++) {
    view.setUint16(o, _f32ToF16(rgbF32[i]), true);
    o += 2;
  }
  return new Uint8Array(buf);
}
function _readEXR(uint8) {
  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  const dec = new TextDecoder();
  // find header end (look for ; sequence)
  let headerEnd = 0;
  while (headerEnd < uint8.length - 1 && !(uint8[headerEnd] === 0 && uint8[headerEnd + 1] === 0)) {
    if (headerEnd > 4096) break;
    headerEnd++;
  }
  // for our minimal format, assume the header is fixed-prefix; width/height follow
  const headerStr = dec.decode(uint8.slice(0, Math.min(256, uint8.length)));
  const match = headerStr.match(/dataWindow:0,0,(\d+),(\d+)/);
  if (!match) return { ok: false };
  const W = parseInt(match[1]) + 1;
  const H = parseInt(match[2]) + 1;
  // pixel data starts at byte after headerStr.length + 8
  let pixelStart = headerStr.indexOf(';compression:NONE') + 17;
  // align: scan forward to width/height stored
  if (pixelStart < 0) return { ok: false };
  pixelStart += 8;
  const rgb = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) {
    const v = view.getUint16(pixelStart + i * 2, true);
    rgb[i] = _f16ToF32(v);
  }
  return { ok: true, width: W, height: H, rgbF32: rgb };
}
export function installEXRIO() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioEXRWrite: ({ width, height, rgbF32 } = {}) => {
      if (!width || !height || !rgbF32) return { ok: false };
      const u = _writeEXR({ width, height, rgbF32 });
      // Return base64 for transport
      let bin = ''; for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
      return { ok: true, base64: btoa(bin), bytes: u.length };
    },
    __studioEXRRead: ({ base64 } = {}) => {
      if (!base64) return { ok: false };
      const bin = atob(base64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return _readEXR(u);
    },
    __studioEXRImageDataToF32: ({ imageData } = {}) => {
      if (!imageData) return { ok: false };
      const n = imageData.width * imageData.height;
      const rgb = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        rgb[i * 3]     = imageData.data[i * 4]     / 255;
        rgb[i * 3 + 1] = imageData.data[i * 4 + 1] / 255;
        rgb[i * 3 + 2] = imageData.data[i * 4 + 2] / 255;
      }
      return { ok: true, rgbF32: rgb };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'HDR EXR I/O (16-bit half-float)');
  return { ok: true };
}
export default installEXRIO;
