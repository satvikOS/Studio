// Slice 707 — Cycles Light Groups.

import { registerOps } from '../common/registry.js';
import {
  assignLight, unassignLight, setGroupGain, setGroupTint,
  renderGroupPass, listGroups, clearGroups,
} from './groups.js';

let _installed = false;

export function installLightGroups() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioLightGroupAssign: assignLight,
    __studioLightGroupUnassign: unassignLight,
    __studioLightGroupSetGain: setGroupGain,
    __studioLightGroupSetTint: setGroupTint,
    __studioLightGroupRenderPass: renderGroupPass,
    __studioLightGroupList: listGroups,
    __studioLightGroupClear: clearGroups,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'Cycles Light Groups (per-group gain/tint + isolated render passes)');
}
