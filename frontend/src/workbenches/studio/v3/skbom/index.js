// Slice 720 — SketchUp Generate Report (Bill of Materials).

import { registerOps } from '../common/registry.js';
import { generateReport, exportCSV, renderToCanvas } from './report.js';

let _installed = false;

export function installSKBom() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSKBomGenerate: generateReport,
    __studioSKBomExportCSV: exportCSV,
    __studioSKBomRenderToCanvas: renderToCanvas,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'arch', 'SketchUp Bill of Materials — group by name/tag/material/kind + export CSV/PNG');
}
