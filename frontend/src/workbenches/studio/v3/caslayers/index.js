// Slice 717 — Cascadeur animation layers.

import { registerOps } from '../common/registry.js';
import {
  attach, addLayer, setKey, setFrame, play, pause,
  setWeight, setEnabled, removeLayer, listLayers, detach,
} from './layers.js';

let _installed = false;

export function installCasLayers() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioCasLayersAttach: attach,
    __studioCasLayersAddLayer: addLayer,
    __studioCasLayersSetKey: setKey,
    __studioCasLayersSetFrame: setFrame,
    __studioCasLayersPlay: play,
    __studioCasLayersPause: pause,
    __studioCasLayersSetWeight: setWeight,
    __studioCasLayersSetEnabled: setEnabled,
    __studioCasLayersRemoveLayer: removeLayer,
    __studioCasLayersList: listLayers,
    __studioCasLayersDetach: detach,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'anim', 'Cascadeur animation layers — additive + override blend modes');
}
