// Slice 729 — C4D Volume Builder + Volume Mesher.

import { registerOps } from '../common/registry.js';
import {
  createBuilder, addInput, build, setVoxelSize, clearInputs,
  listBuilders, deleteBuilder,
} from './volume.js';

let _installed = false;

export function installC4DVolume() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioC4DVolCreateBuilder: createBuilder,
    __studioC4DVolAddInput: addInput,
    __studioC4DVolBuild: build,
    __studioC4DVolSetVoxelSize: setVoxelSize,
    __studioC4DVolClearInputs: clearInputs,
    __studioC4DVolList: listBuilders,
    __studioC4DVolDelete: deleteBuilder,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'mograph', 'C4D Volume Builder + Mesher — mesh → SDF (union/subtract/intersect + smoothing) → mesh');
}
