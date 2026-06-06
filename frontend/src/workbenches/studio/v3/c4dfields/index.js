// Slice 709 — Cinema 4D field system.

import { registerOps } from '../common/registry.js';
import { createField, sample, listFields, deleteField, applyToClones } from './fields.js';

let _installed = false;

export function installC4DFields() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioC4DFieldCreate: createField,
    __studioC4DFieldSample: sample,
    __studioC4DFieldList: listFields,
    __studioC4DFieldDelete: deleteField,
    __studioC4DFieldApplyToClones: applyToClones,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'mograph', 'C4D field system — linear/spherical/box/cylinder/random/cone/torus/formula');
}
