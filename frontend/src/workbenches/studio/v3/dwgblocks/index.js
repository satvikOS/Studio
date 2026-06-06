// Slice 715 — AutoCAD Dynamic Block library.

import { registerOps } from '../common/registry.js';
import {
  defineBlock, placeInstance, listBlocks, listInstances,
  updateInstance, deleteInstance, redefineBlock,
} from './blocks.js';

let _installed = false;

export function installDWGBlocks() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioDWGBlockDefine: defineBlock,
    __studioDWGBlockPlace: placeInstance,
    __studioDWGBlockListBlocks: listBlocks,
    __studioDWGBlockListInstances: listInstances,
    __studioDWGBlockUpdateInstance: updateInstance,
    __studioDWGBlockDeleteInstance: deleteInstance,
    __studioDWGBlockRedefine: redefineBlock,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'arch', 'AutoCAD Dynamic Block library — define / place / parameter overrides');
}
