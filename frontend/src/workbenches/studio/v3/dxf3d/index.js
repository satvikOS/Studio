// Slice 710 — DXF 3D entity exporter.

import { registerOps } from '../common/registry.js';
import { exportScene3D, exportPaperSpaceLayout } from './exporter.js';

let _installed = false;

export function installDXF3D() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioDXF3DExport: exportScene3D,
    __studioDXF3DExportPaperSpace: exportPaperSpaceLayout,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'arch', 'DXF 3D exporter (3DFACE per triangle + layers + paper-space layout)');
}
