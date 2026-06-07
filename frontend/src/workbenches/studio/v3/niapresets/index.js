// ArchDisc Studio V3 — Niagara 50+ preset library (slice 807).
import { registerOps } from '../common/registry.js';
let _installed = false;
const NAMES = [
  'fire', 'smoke', 'explosion', 'sparks', 'dust', 'snow', 'rain', 'leaves', 'embers', 'confetti',
  'magic', 'portal', 'lightning', 'blood', 'water_splash', 'flame_burst', 'comet', 'firework',
  'aurora', 'lasers', 'holo', 'glitter', 'sparkle', 'firefly', 'butterfly', 'petals',
  'cherry_blossoms', 'glass_shard', 'coin', 'star', 'heart', 'note', 'bubble', 'ash', 'electric',
  'nebula', 'cosmic', 'laser_beam', 'plasma', 'halo', 'divine_light', 'rune', 'meteor',
  'lava', 'volcano_ash', 'falling_stars', 'wind_streak', 'spell', 'enchant', 'damage_text',
  'heal_text', 'levelup', 'pickup',
];
function _build(name) {
  // Synthetic emitter spec — tuned per name category.
  const lowered = name.toLowerCase();
  let count = 200, lifeMin = 0.5, lifeMax = 2, velMin = [-0.3, 0, -0.3], velMax = [0.3, 1, 0.3];
  let gravity = [0, -0.5, 0], drag = 0.05;
  let colorOverLife = [[1, 0.8, 0.3, 1], [1, 0.3, 0.1, 0]];
  if (lowered.includes('fire') || lowered.includes('explosion') || lowered.includes('lava')) {
    colorOverLife = [[1, 1, 0.8, 1], [1, 0.4, 0, 0]];
    velMax = [0.5, 1.5, 0.5];
  } else if (lowered.includes('smoke') || lowered.includes('ash') || lowered.includes('dust')) {
    colorOverLife = [[0.5, 0.5, 0.5, 0.8], [0.3, 0.3, 0.3, 0]];
    gravity = [0, 0.3, 0];
  } else if (lowered.includes('snow') || lowered.includes('rain') || lowered.includes('petal')) {
    colorOverLife = [[1, 1, 1, 1], [0.9, 0.9, 1, 0]];
    gravity = [0, -0.8, 0];
  } else if (lowered.includes('magic') || lowered.includes('rune') || lowered.includes('aurora')) {
    colorOverLife = [[0.6, 0.3, 1, 1], [0.2, 0.1, 0.5, 0]];
  } else if (lowered.includes('star') || lowered.includes('sparkle') || lowered.includes('glitter')) {
    colorOverLife = [[1, 1, 0.6, 1], [1, 0.8, 0.2, 0]];
  } else if (lowered.includes('blood') || lowered.includes('heart')) {
    colorOverLife = [[0.8, 0, 0, 1], [0.4, 0, 0, 0]];
  } else if (lowered.includes('electric') || lowered.includes('laser') || lowered.includes('plasma')) {
    colorOverLife = [[0.5, 0.8, 1, 1], [0.2, 0.3, 0.8, 0]];
  }
  return { count, spawnRate: count, lifeMin, lifeMax, velocityMin: velMin, velocityMax: velMax, gravity, drag, colorOverLife, seed: 1337 };
}
export function installNiaPresets() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioNiaPresetsList: () => ({ ok: true, names: NAMES.slice() }),
    __studioNiaPresetsGet: ({ name } = {}) => ({ ok: true, preset: _build(name || 'fire') }),
    __studioNiaPresetsSpawn: ({ name } = {}) => {
      if (typeof window.__studioNia2Create !== 'function') return { ok: false, error: 'slice 764 nia2 not loaded' };
      return window.__studioNia2Create(_build(name || 'fire'));
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'fx', 'Niagara preset library');
  return { ok: true };
}
export default installNiaPresets;
