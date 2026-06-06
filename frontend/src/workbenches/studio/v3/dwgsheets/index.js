// Slice 716 — AutoCAD layout sheets + viewports.

import { registerOps } from '../common/registry.js';
import {
  createSheet, addViewport, renderSheet, exportAsPNG, listSheets, deleteSheet,
} from './sheets.js';

let _installed = false;

export function installDWGSheets() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioDWGSheetCreate: createSheet,
    __studioDWGSheetAddViewport: addViewport,
    __studioDWGSheetRender: renderSheet,
    __studioDWGSheetExportPNG: exportAsPNG,
    __studioDWGSheetList: listSheets,
    __studioDWGSheetDelete: deleteSheet,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'arch', 'AutoCAD layout sheets — paper space + viewport tiles + title block');
}
