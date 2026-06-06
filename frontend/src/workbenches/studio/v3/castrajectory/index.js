// Slice 724 — Cascadeur trajectory editor.

import { registerOps } from '../common/registry.js';
import {
  record, recordFrame, moveKey, exportTrajectory, listTrajectories, deleteTrajectory,
} from './traj.js';

let _installed = false;

export function installCasTrajectory() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioCasTrajectoryRecord: record,
    __studioCasTrajectoryRecordFrame: recordFrame,
    __studioCasTrajectoryMoveKey: moveKey,
    __studioCasTrajectoryExport: exportTrajectory,
    __studioCasTrajectoryList: listTrajectories,
    __studioCasTrajectoryDelete: deleteTrajectory,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'anim', 'Cascadeur trajectory editor — record + visualize + edit bone paths');
}
