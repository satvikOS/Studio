// ArchDisc Studio V3 — live mocap streaming (slice 942).
// Unreal LiveLink / Xsens MVN / Vicon Tracker / Rokoko Smartsuit parsers
// with humanoid retarget.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false;
const _sources = new Map();
const _bindings = new Map();
const _stats = { framesReceived: 0, framesApplied: 0, framesDropped: 0, lastFrameAt: 0 };

const HUMANOID = [
  'Hips','Spine','Spine1','Spine2','Neck','Head',
  'LeftShoulder','LeftArm','LeftForeArm','LeftHand',
  'RightShoulder','RightArm','RightForeArm','RightHand',
  'LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase',
  'RightUpLeg','RightLeg','RightFoot','RightToeBase',
  'HeadEnd',
];

const SOURCE_DEFAULTS = {
  iphone:  { transport: 'udp', port: 11111, protocol: 'liveLink', skeletonMap: 'arkit' },
  xsens:   { transport: 'tcp', port: 9763,  protocol: 'mvn',      skeletonMap: 'xsens23' },
  vicon:   { transport: 'udp', port: 801,   protocol: 'datastream',skeletonMap: 'vicon' },
  rokoko:  { transport: 'udp', port: 14043, protocol: 'rokokoJSON',skeletonMap: 'rokoko' },
};

function _parseLiveLink(buf) {
  // LiveLink: JSON frame `{subject, role, ts, bones: [{name, t, r}]}`
  try { return JSON.parse(typeof buf === 'string' ? buf : new TextDecoder().decode(buf)); }
  catch { return null; }
}
function _parseXsensMvn(buf) {
  // MVN BVH-Live: per-frame line of `tx ty tz rx ry rz` × 23 joints, space-sep.
  const txt = typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
  const vals = txt.trim().split(/\s+/).map(Number);
  if (vals.length < 6 * 23) return null;
  const bones = [];
  for (let i = 0; i < 23; i++) {
    bones.push({
      name: HUMANOID[i] || `Bone${i}`,
      t: [vals[i * 6], vals[i * 6 + 1], vals[i * 6 + 2]],
      r: [vals[i * 6 + 3], vals[i * 6 + 4], vals[i * 6 + 5]],
    });
  }
  return { subject: 'xsens', ts: Date.now(), bones };
}
function _parseVicon(buf) {
  // Vicon DataStream packet: simplified — comma-sep "subject,markerName,x,y,z" lines
  const txt = typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
  const bones = [];
  for (const line of txt.split(/\n/)) {
    const [sub, name, x, y, z] = line.split(',');
    if (!sub) continue;
    bones.push({ name, t: [+x, +y, +z], r: [0, 0, 0] });
  }
  return bones.length ? { subject: 'vicon', ts: Date.now(), bones } : null;
}
function _parseRokoko(buf) {
  // Rokoko Smartsuit Pro JSON stream
  try {
    const j = JSON.parse(typeof buf === 'string' ? buf : new TextDecoder().decode(buf));
    return { subject: j.scene?.[0]?.actors?.[0]?.name || 'rokoko', ts: j.scene?.timestamp || Date.now(), bones: (j.scene?.[0]?.actors?.[0]?.body?.bones || []) };
  } catch { return null; }
}

function _euler(rx, ry, rz) { return new THREE.Euler(rx, ry, rz, 'YXZ'); }

function _applyFrame(frame, rig) {
  if (!rig?.bones) return false;
  for (const b of frame.bones || []) {
    const target = rig.bones[b.name];
    if (!target) continue;
    if (b.r) target.rotation.copy(_euler(b.r[0], b.r[1], b.r[2]));
    if (b.t && target === rig.bones.Hips) target.position.set(b.t[0], b.t[1], b.t[2]);
  }
  rig.skeleton?.update?.();
  return true;
}

let _latestFrame = new Map();
function _enqueueFrame(sourceKey, frame) {
  _stats.framesReceived++;
  _stats.lastFrameAt = Date.now();
  const prev = _latestFrame.get(sourceKey);
  if (prev) _stats.framesDropped++;
  _latestFrame.set(sourceKey, frame);
  // Apply latest-wins on next tick
  Promise.resolve().then(() => {
    const f = _latestFrame.get(sourceKey);
    if (!f) return;
    _latestFrame.delete(sourceKey);
    for (const [rigKey, binding] of _bindings) {
      if (binding.sourceKey !== sourceKey) continue;
      if (_applyFrame(f, binding.rig)) _stats.framesApplied++;
    }
  });
}

export function installMocapLive() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioMocapLiveConnect: ({ source, host = '127.0.0.1', port } = {}) => {
      const cfg = SOURCE_DEFAULTS[source];
      if (!cfg) return { ok: false, error: `unknown source: ${source}` };
      const key = `${source}:${host}:${port || cfg.port}`;
      if (_sources.has(key)) return { ok: true, already: true, key };
      // Electron-side socket connect via IPC if available
      const handle = { source, host, port: port || cfg.port, protocol: cfg.protocol, transport: cfg.transport, connected: !!window.electronAPI?.mocapConnect, subject: source };
      if (window.electronAPI?.mocapConnect) {
        window.electronAPI.mocapConnect({ ...handle, onFrame: (raw) => {
          let frame = null;
          if (cfg.protocol === 'liveLink') frame = _parseLiveLink(raw);
          else if (cfg.protocol === 'mvn') frame = _parseXsensMvn(raw);
          else if (cfg.protocol === 'datastream') frame = _parseVicon(raw);
          else if (cfg.protocol === 'rokokoJSON') frame = _parseRokoko(raw);
          if (frame) _enqueueFrame(key, frame);
        } });
      }
      _sources.set(key, handle);
      return { ok: true, key, ...handle };
    },
    __studioMocapLiveBind: ({ sourceKey, rigUuid }) => {
      const vp = window.__archdiscViewport;
      if (!vp?.scene) return { ok: false, error: 'no viewport' };
      let rig = null;
      vp.scene.traverse((o) => { if (o.uuid === rigUuid) rig = o; });
      if (!rig) return { ok: false, error: 'no rig' };
      const bones = {};
      rig.traverse((o) => { if (o.isBone) bones[o.name] = o; });
      _bindings.set(rigUuid, { sourceKey, rig, bones });
      return { ok: true, boneCount: Object.keys(bones).length };
    },
    __studioMocapLiveDisconnect: ({ sourceKey }) => {
      window.electronAPI?.mocapDisconnect?.({ sourceKey });
      return { ok: _sources.delete(sourceKey) };
    },
    __studioMocapLiveGetSources: () => ({ ok: true, sources: Object.keys(SOURCE_DEFAULTS), defaults: SOURCE_DEFAULTS }),
    __studioMocapLiveGetSubjects: () => ({ ok: true, subjects: [..._sources.values()].map((s) => s.subject) }),
    __studioMocapLiveGetStats: () => ({ ok: true, ..._stats, sources: _sources.size, bindings: _bindings.size }),
    __studioMocapLiveInjectFrame: ({ sourceKey, frame }) => { _enqueueFrame(sourceKey, frame); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'mocap', 'Live mocap streaming (LiveLink/Xsens/Vicon/Rokoko)');
  return { ok: true };
}
export default installMocapLive;
