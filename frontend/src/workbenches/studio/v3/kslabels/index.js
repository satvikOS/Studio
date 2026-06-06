// Slice 718 — KeyShot Labels + Decals.

import { registerOps } from '../common/registry.js';
import {
  addTextLabel, addImageLabel, projectLabel,
  setLabelTransform, removeLabel, listLabels,
} from './labels.js';

let _installed = false;

export function installKSLabels() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioKSLabelText: addTextLabel,
    __studioKSLabelImage: addImageLabel,
    __studioKSLabelProject: projectLabel,
    __studioKSLabelSetTransform: setLabelTransform,
    __studioKSLabelRemove: removeLabel,
    __studioKSLabelList: listLabels,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'KeyShot Labels — text + image decals projected onto product');
}
