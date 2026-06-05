// ArchDisc Studio V3 — shaderdeep install entry.
//
// `installShaderDeep()` triggers the register pass exactly once per
// page-load. Re-imports / re-installs are no-ops. We expose a public
// `__studioShaderDeepInstall` window function for ad-hoc reruns from
// devtools or tests, and surface the kind list under the V3 command
// palette so a single allowlist line covers all 20.

import { registerShaderDeepNodes } from './register.js';
import { MORE_NODE_KIND_LIST } from './morenodes.js';

let _installed = false;

export function installShaderDeep() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) {
    return { ok: true, already: true, count: MORE_NODE_KIND_LIST.length };
  }
  _installed = true;

  const r = registerShaderDeepNodes();

  // Tiny re-runner so the user can poke from the console.
  window.__studioShaderDeepInstall = () => {
    _installed = false;
    return installShaderDeep();
  };

  const reg = window.__studioCommandRegister;
  if (typeof reg === 'function') {
    reg('__studioShaderDeepInstall', window.__studioShaderDeepInstall, {
      category: 'shader',
      description: 'Re-run the shaderdeep node-kind registration pass',
    });
  }

  return {
    ok: true,
    count: MORE_NODE_KIND_LIST.length,
    hostAvailable: r.hostAvailable,
    hostRegistered: r.hostRegistered,
  };
}

export { MORE_NODE_KIND_LIST };
