// ArchDisc Studio V3 — EffectComposer wiring (slice 923).
// Central post-process composer registry. Other slices register
// their ShaderPass instances here; this module wires the composer
// into the slice 752 viewport render loop and orders the passes.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { registerOps } from '../common/registry.js';

let _installed = false;
let _composer = null;
const _passes = new Map(); // name → {pass, order, enabled}

function _getOrCreate() {
  if (typeof window === 'undefined') return null;
  const vp = window.__archdiscViewport;
  if (!vp?.renderer || !vp.scene || !vp.camera) return null;
  if (_composer) return _composer;
  _composer = new EffectComposer(vp.renderer);
  _composer.addPass(new RenderPass(vp.scene, vp.camera));
  _composer.addPass(new OutputPass());
  // Override renderer.render so the existing loop drives composer instead.
  const origRender = vp.renderer.render.bind(vp.renderer);
  vp.renderer.__studioOrigRender = origRender;
  vp.renderer.render = (scene, camera) => {
    if (_composer && _passes.size > 0) {
      // Update RenderPass camera + scene
      const rp = _composer.passes[0];
      if (rp?.scene) rp.scene = scene;
      if (rp?.camera) rp.camera = camera;
      _composer.render();
    } else {
      origRender(scene, camera);
    }
  };
  return _composer;
}

function _rebuildPassChain() {
  if (!_composer) return;
  // Reset composer passes
  while (_composer.passes.length > 1) _composer.passes.pop();
  const sorted = [..._passes.entries()].sort((a, b) => a[1].order - b[1].order);
  for (const [name, entry] of sorted) {
    if (entry.enabled) _composer.addPass(entry.pass);
  }
  // Always end with OutputPass
  _composer.addPass(new OutputPass());
}

export function installComposerWire() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioComposerRegister: ({ name, pass, order = 100, enabled = true } = {}) => {
      _getOrCreate();
      if (!name || !pass) return { ok: false };
      _passes.set(name, { pass, order, enabled });
      _rebuildPassChain();
      return { ok: true, name, registered: true };
    },
    __studioComposerEnable: ({ name, on } = {}) => {
      const e = _passes.get(name); if (!e) return { ok: false };
      e.enabled = !!on; _rebuildPassChain(); return { ok: true };
    },
    __studioComposerSetUniform: ({ name, key, value } = {}) => {
      const e = _passes.get(name); if (!e?.pass?.uniforms) return { ok: false };
      const u = e.pass.uniforms[key];
      if (!u) return { ok: false };
      u.value = value; return { ok: true };
    },
    __studioComposerList: () => ({
      ok: true,
      passes: [..._passes.entries()].map(([name, e]) => ({ name, order: e.order, enabled: e.enabled })),
    }),
    __studioComposerRemove: ({ name } = {}) => {
      _passes.delete(name); _rebuildPassChain(); return { ok: true };
    },
    __studioComposerResize: ({ width, height } = {}) => {
      if (_composer && width && height) {
        _composer.setSize(width, height);
        return { ok: true, width, height };
      }
      return { ok: false };
    },
    __studioComposerGetComposer: () => ({ ok: true, hasComposer: !!_composer }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'EffectComposer post-process wiring');
  return { ok: true };
}
export default installComposerWire;
