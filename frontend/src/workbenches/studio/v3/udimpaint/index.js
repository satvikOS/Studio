// Slice 728 — UDIM-aware painting.

import { registerOps } from '../common/registry.js';
import {
  attachUDIM, paintStrokeAtUV, getTileCanvas, listTiles, exportTile, exportAll, clearTile,
} from './tiles.js';

let _installed = false;

export function installUDIMPaint() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioUDIMAttach: attachUDIM,
    __studioUDIMPaint: paintStrokeAtUV,
    __studioUDIMGetTile: getTileCanvas,
    __studioUDIMListTiles: listTiles,
    __studioUDIMExportTile: exportTile,
    __studioUDIMExportAll: exportAll,
    __studioUDIMClearTile: clearTile,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'texpaint', 'UDIM-aware painting — per-tile canvases for multi-tile UV layouts');
}
