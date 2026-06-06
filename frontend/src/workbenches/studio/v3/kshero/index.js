// Slice 725 — KeyShot Hero Shot animation preset.

import { registerOps } from '../common/registry.js';
import { heroOrbit, heroPan, heroReveal } from './preset.js';

let _installed = false;

export function installKSHero() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioKSHeroOrbit: heroOrbit,
    __studioKSHeroPan: heroPan,
    __studioKSHeroReveal: heroReveal,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'KeyShot Hero Shot animation presets — orbit / pan / reveal');
}
