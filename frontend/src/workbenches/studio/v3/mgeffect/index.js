// Slice 704 — Cinema 4D MoGraph effectors (sound / formula / shader / step / time).

import { registerOps } from '../common/registry.js';
import {
  soundEffector, attachAudioElement, formulaEffector,
  shaderEffector, stepEffector, timeEffector,
} from './effectors.js';

let _installed = false;

export function installMGEffect() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMGEffectSound: soundEffector,
    __studioMGEffectAttachAudio: attachAudioElement,
    __studioMGEffectFormula: formulaEffector,
    __studioMGEffectShader: shaderEffector,
    __studioMGEffectStep: stepEffector,
    __studioMGEffectTime: timeEffector,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'mograph', 'C4D MoGraph effectors: sound / formula / shader / step / time');
}
