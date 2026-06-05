// ArchDisc Studio V3 — Mari multi-channel brush stamper.
//
// Given a UV coordinate, paintMultiChannel() stamps a soft brush dab
// into every enabled channel's UDIM tile simultaneously. The brush
// colour per channel is the channel's globally-armed colour (set via
// channels.setChannelColor); brushOpts can override size, hardness,
// opacity, or supply a per-channel colour override map.
//
//   __studioMariPaintMultiChannel(meshUuid, uv, {
//     size: 24,           // px in the 512×512 tile
//     hardness: 0.5,      // 0 = soft, 1 = solid disc
//     opacity: 0.85,      // 0..1 alpha
//     colors: {           // per-channel overrides (optional)
//       roughness: '#101010',
//       metallic:  '#ffffff',
//     },
//   });
//
// The brush is identical in shape across channels — only the colour
// changes — so a single stroke deposits matching impressions in every
// armed channel's CanvasTexture.

import { getUDIMTile, UDIM_TEX_SIZE } from './udim.js';
import {
  CHANNELS, enabledChannels, getChannelColor, getChannelTile,
} from './channels.js';

// Convert a string colour to "rgba(r,g,b,alpha)" for the radial-gradient
// transparent stop. Supports #rgb, #rrggbb, rgb(), rgba(), and falls
// back to transparent black for anything else.
function _withAlpha(color, alpha) {
  if (typeof color !== 'string') return `rgba(0,0,0,${alpha})`;
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    let r, g, b;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      return `rgba(0,0,0,${alpha})`;
    }
    if (![r, g, b].every(Number.isFinite)) return `rgba(0,0,0,${alpha})`;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (c.startsWith('rgba')) return c.replace(/,[^,]+\)$/, `, ${alpha})`);
  if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  return `rgba(0,0,0,${alpha})`;
}

// Draw a soft round brush at (cx, cy) on a 2D context.
function _drawBrush(ctx, cx, cy, radius, color, hardness, opacity) {
  const r = Math.max(0.5, radius);
  const inner = Math.max(0, Math.min(r, r * (typeof hardness === 'number' ? hardness : 0.4)));
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = Math.max(0, Math.min(1, typeof opacity === 'number' ? opacity : 1));
  if (inner < r) {
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, _withAlpha(color, 0));
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = color;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Paint a single multi-channel dab. uv is [u, v] in object UV space;
// values outside [0,1) address higher UDIM tiles. brushOpts:
//   { size, hardness, opacity, colors: { [channel]: '#rrggbb' } }
// Returns { ok, udim, tileX, tileY, channels: [{name, color, x, y, r}] }.
export function paintMultiChannel(mesh, uv, brushOpts) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(uv) || uv.length < 2) return { ok: false, error: 'bad uv' };
  const o = brushOpts || {};
  const tile = getUDIMTile(Number(uv[0]), Number(uv[1]));
  if (!tile.ok) return tile;
  const armed = enabledChannels();
  if (!armed.length) return { ok: false, error: 'no channels armed' };
  const radius = Math.max(0.5, Number(o.size) || 18);
  const hardness = typeof o.hardness === 'number' ? o.hardness : 0.4;
  const opacity = typeof o.opacity === 'number' ? o.opacity : 1.0;
  const colorOverrides = (o.colors && typeof o.colors === 'object') ? o.colors : {};

  // UV → tile-local px. Canvas Y is flipped vs. UV's bottom-left
  // origin so we mirror V.
  const x = tile.localU * (UDIM_TEX_SIZE - 1);
  const y = (1 - tile.localV) * (UDIM_TEX_SIZE - 1);

  const writes = [];
  for (const name of armed) {
    const entry = getChannelTile(mesh, name, tile.udim);
    if (!entry || !entry.canvas) continue;
    const ctx = entry.canvas.getContext('2d');
    if (!ctx) continue;
    const color = colorOverrides[name] || getChannelColor(name);
    _drawBrush(ctx, x, y, radius, color, hardness, opacity);
    if (entry.tex) entry.tex.needsUpdate = true;
    writes.push({ name, color, x, y, r: radius });
  }
  if (!writes.length) return { ok: false, error: 'no writes' };
  return {
    ok: true,
    udim: tile.udim, tileX: tile.tileX, tileY: tile.tileY,
    channels: writes, count: writes.length,
  };
}

// Bulk multi-channel stroke — runs paintMultiChannel for every UV in a
// list. Returns { ok, count, udims: [...] } summarising which tiles
// got touched.
export function paintMultiChannelStroke(mesh, uvs, brushOpts) {
  if (!Array.isArray(uvs) || uvs.length === 0) return { ok: false, error: 'no uvs' };
  const touched = new Set();
  let okCount = 0;
  for (const uv of uvs) {
    const r = paintMultiChannel(mesh, uv, brushOpts);
    if (r && r.ok) { okCount++; touched.add(r.udim); }
  }
  return { ok: okCount > 0, count: okCount, udims: Array.from(touched).sort((a, b) => a - b) };
}

// Convenience: return the list of channel names that would receive a
// stamp right now — handy for the panel + agent introspection.
export function activeStampChannels() {
  return enabledChannels().slice();
}

// Re-export the channel metadata table so MariPanel can render the
// channel toggles without importing channels.js directly.
export function listChannelMeta() {
  return CHANNELS.map((c) => ({ name: c.name, matSlot: c.matSlot }));
}
