// Slice 785 — auto-installer for OpenVDB-tier sparse-volume ops.
//
// Wires the window.__studioVDBAdvect / Dilate / Erode / Smooth /
// Gradient / Divergence ops on top of the slice-751 sparse VDB store.
import { installVDBOps } from './index.js';
Promise.resolve().then(installVDBOps);
