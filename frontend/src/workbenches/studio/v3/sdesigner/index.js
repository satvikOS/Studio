// ArchDisc Studio V3 — sdesigner install entry.
//
// `installSDesigner()` triggers the register pass exactly once per
// page-load. Re-imports / re-installs are no-ops. A public
// `__studioSDesignerInstall` window function is exposed for ad-hoc
// reruns from devtools / tests, and pinned under the V3 command
// palette so a single allowlist line covers all 25 nodes.

import { registerSDesignerNodes } from './register.js';
import { SDESIGNER_NODE_KIND_LIST } from './morenodes.js';
import { registerOp } from '../common/registry.js';

let _installed = false;

export function installSDesigner() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) {
    return { ok: true, already: true, count: SDESIGNER_NODE_KIND_LIST.length };
  }
  _installed = true;

  const r = registerSDesignerNodes();

  // Tiny re-runner so the user can poke from the console.
  window.__studioSDesignerInstall = () => {
    _installed = false;
    return installSDesigner();
  };

  registerOp('__studioSDesignerInstall', window.__studioSDesignerInstall, 'shader',
    'Re-run the Substance-Designer-style node-kind registration pass');

  return {
    ok: true,
    count: SDESIGNER_NODE_KIND_LIST.length,
    hostAvailable: r.hostAvailable,
    hostRegistered: r.hostRegistered,
  };
}

export { SDESIGNER_NODE_KIND_LIST };
