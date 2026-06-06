// Slice 722 — Scene templates / starter scenes.

import { registerOps } from '../common/registry.js';
import {
  emptyStudio, product3PointScene, architectVisualizer, characterScene,
  heroShot, animationStage, applyTemplate, listTemplates,
} from './templates.js';

let _installed = false;

export function installSceneTemplates() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSceneTplEmpty: emptyStudio,
    __studioSceneTplProduct: product3PointScene,
    __studioSceneTplArchitect: architectVisualizer,
    __studioSceneTplCharacter: characterScene,
    __studioSceneTplHeroShot: heroShot,
    __studioSceneTplAnimStage: animationStage,
    __studioSceneTplApply: applyTemplate,
    __studioSceneTplList: listTemplates,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'multiview', 'Scene templates — empty / product / architect / character / hero / animation');
}
