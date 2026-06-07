// ArchDisc Studio V3 — IFC (Industry Foundation Classes) import/export
// (slice 839). Pure-JS minimal IFC4 SPF (STEP Physical File) writer for
// BIM exchange — emits IfcWall/IfcSlab/IfcWindow/IfcDoor stubs.

import { registerOps } from '../common/registry.js';
let _installed = false;
function _exportScene() {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const lines = [];
  let id = 1;
  function _next() { return `#${id++}`; }
  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push(`FILE_DESCRIPTION(('ArchDisc Studio IFC export'),'2;1');`);
  lines.push(`FILE_NAME('archdisc.ifc','${new Date().toISOString()}',(),(),'archdisc-studio','none','none');`);
  lines.push(`FILE_SCHEMA(('IFC4'));`);
  lines.push('ENDSEC;');
  lines.push('DATA;');
  const ifcProject = _next();
  lines.push(`${ifcProject}=IFCPROJECT('00000000000000000000000000','ArchDiscProject',$,$,$,$,$,$,$);`);
  let primCount = 0;
  scene.traverse((o) => {
    if (!o.userData?.archdiscStudioPrimitive) return;
    const kind = o.userData.archdiscStudioPrimitiveKind || 'unknown';
    const ref = _next();
    if (kind === 'stairs') {
      lines.push(`${ref}=IFCSTAIR('${o.uuid.replace(/-/g, '').slice(0, 22)}','Stairs',$,$,$,$,$,$,.STRAIGHT_RUN_STAIR.);`);
    } else if (kind === 'door') {
      lines.push(`${ref}=IFCDOOR('${o.uuid.replace(/-/g, '').slice(0, 22)}','Door',$,$,$,$,$,$,$,$);`);
    } else if (kind === 'window') {
      lines.push(`${ref}=IFCWINDOW('${o.uuid.replace(/-/g, '').slice(0, 22)}','Window',$,$,$,$,$,$,$,$);`);
    } else {
      lines.push(`${ref}=IFCBUILDINGELEMENTPROXY('${o.uuid.replace(/-/g, '').slice(0, 22)}','${kind}',$,$,$,$,$,$,$);`);
    }
    primCount++;
  });
  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  return { ok: true, ifc: lines.join('\n'), primCount };
}
function _importIFC({ ifcText } = {}) {
  // Stub: count IFC entities by type
  const text = String(ifcText || '');
  const counts = {};
  for (const m of text.matchAll(/IFC([A-Z]+)\(/g)) {
    const k = m[1];
    counts[k] = (counts[k] || 0) + 1;
  }
  return { ok: true, entityCounts: counts };
}
export function installIFC() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioIFCExport: _exportScene,
    __studioIFCImport: _importIFC,
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'IFC4 import/export for BIM');
  return { ok: true };
}
export default installIFC;
