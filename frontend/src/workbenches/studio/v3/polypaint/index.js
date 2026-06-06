// Slice 714 — ZBrush Polypaint vertex color brush + layer stack.

import { registerOps } from '../common/registry.js';
import {
  setActiveMesh, setBrush, paintAt, addLayer, removeLayer,
  setLayerOpacity, setLayerVisible, setLayerBlend, listLayers, fillLayer,
} from './brush.js';

let _installed = false;

export function installPolyPaint() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioPolyPaintSetActiveMesh: setActiveMesh,
    __studioPolyPaintSetBrush: setBrush,
    __studioPolyPaintPaintAt: paintAt,
    __studioPolyPaintAddLayer: addLayer,
    __studioPolyPaintRemoveLayer: removeLayer,
    __studioPolyPaintSetLayerOpacity: setLayerOpacity,
    __studioPolyPaintSetLayerVisible: setLayerVisible,
    __studioPolyPaintSetLayerBlend: setLayerBlend,
    __studioPolyPaintListLayers: listLayers,
    __studioPolyPaintFillLayer: fillLayer,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sculpt', 'ZBrush Polypaint — vertex color brush + layer stack with blending');
}
