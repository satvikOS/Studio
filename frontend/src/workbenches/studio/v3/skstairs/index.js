// Slice 709 — SketchUp depth: scenes + schematic floors + solar.

import { registerOps } from '../common/registry.js';
import {
  saveScene, recallScene, listScenes, deleteScene,
  generateSchematicFloor, setSolar, clearSolar,
} from './levels.js';

let _installed = false;

export function installSketchUpDepth() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSketchUpSaveScene: saveScene,
    __studioSketchUpRecallScene: recallScene,
    __studioSketchUpListScenes: listScenes,
    __studioSketchUpDeleteScene: deleteScene,
    __studioSketchUpSchematicFloor: generateSchematicFloor,
    __studioSketchUpSetSolar: setSolar,
    __studioSketchUpClearSolar: clearSolar,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'arch', 'SketchUp depth — scenes / schematic floor / solar path');
}
