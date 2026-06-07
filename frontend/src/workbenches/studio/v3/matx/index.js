// ArchDisc Studio V3 — MaterialX export (slice 836).
// Pure-JS MaterialX 1.38 XML writer for a THREE material. Emits the
// nodegraph + standard_surface shader equivalent.

import { registerOps } from '../common/registry.js';
let _installed = false;
function _toMatX({ meshUuid } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const m = scene.getObjectByProperty('uuid', meshUuid); if (!m?.material) return { ok: false };
  const mat = m.material;
  const r = (mat.color?.r ?? 0.7).toFixed(3);
  const g = (mat.color?.g ?? 0.7).toFixed(3);
  const b = (mat.color?.b ?? 0.7).toFixed(3);
  const rough = (mat.roughness ?? 0.5).toFixed(3);
  const metal = (mat.metalness ?? 0).toFixed(3);
  const xml = `<?xml version="1.0"?>
<materialx version="1.38">
  <nodegraph name="NG_main">
    <constant name="base_color" type="color3">
      <input name="value" type="color3" value="${r},${g},${b}"/>
    </constant>
    <constant name="roughness" type="float">
      <input name="value" type="float" value="${rough}"/>
    </constant>
    <constant name="metalness" type="float">
      <input name="value" type="float" value="${metal}"/>
    </constant>
    <output name="out_base_color" type="color3" nodename="base_color"/>
    <output name="out_roughness" type="float" nodename="roughness"/>
    <output name="out_metalness" type="float" nodename="metalness"/>
  </nodegraph>
  <standard_surface name="MyShader" type="surfaceshader">
    <input name="base_color" type="color3" nodegraph="NG_main" output="out_base_color"/>
    <input name="specular_roughness" type="float" nodegraph="NG_main" output="out_roughness"/>
    <input name="metalness" type="float" nodegraph="NG_main" output="out_metalness"/>
  </standard_surface>
  <surfacematerial name="Material" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="MyShader"/>
  </surfacematerial>
</materialx>`;
  return { ok: true, xml, mtlPath: 'Material' };
}
export function installMatX() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = { __studioMatXExport: _toMatX };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'MaterialX 1.38 export');
  return { ok: true };
}
export default installMatX;
