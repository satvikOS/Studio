// ArchDisc Studio V3 — object replication over WebRTC (slice 888).
//
// Auto-sync the transform of any scene primitive across a WebRTC peer
// connection at 20 Hz (50 ms tick). Each tick we walk the active set of
// replicated objects and serialise their position/quaternion/scale to
// the 'archdisc-replicate' data channel as a single batched message.
//
// Receivers subscribe per-UUID via subscribeReplication() to drive their
// local copy of the object.

import { onChannelMessage } from './peer.js';

const REPLICATE_HZ = 20;
const REPLICATE_INTERVAL_MS = Math.round(1000 / REPLICATE_HZ);
const REPLICATE_CHANNEL = 'archdisc-replicate';

// uuid → { obj, last: { p, q, s }, sent: number }
const _tracked = new Map();
// uuid → array of callbacks
const _subscribers = new Map();
// Set of PeerWrapper instances active in the session.
const _peers = new Set();
let _tickTimer = null;
let _wired = false;

// Internal: when an incoming replication message arrives, fan it out to
// subscribers and (optionally) apply it to local scene objects if their
// UUID matches.
function _onIncoming(msg) {
  if (!msg || msg.kind !== 'replicate' || !Array.isArray(msg.entries)) return;
  for (const e of msg.entries) {
    // Apply to local scene object if present + not currently tracked
    // (avoid echoing our own broadcasts back into the scene).
    const local = _findSceneObject(e.uuid);
    if (local && !_tracked.has(e.uuid)) {
      if (Array.isArray(e.p)) local.position.set(e.p[0], e.p[1], e.p[2]);
      if (Array.isArray(e.q)) local.quaternion.set(e.q[0], e.q[1], e.q[2], e.q[3]);
      if (Array.isArray(e.s)) local.scale.set(e.s[0], e.s[1], e.s[2]);
    }
    const subs = _subscribers.get(e.uuid);
    if (subs) {
      for (const fn of subs) {
        try { fn(e); } catch (_) { /* keep loop alive */ }
      }
    }
  }
}

function _findSceneObject(uuid) {
  const scene = window.__archdiscScene;
  if (!scene) return null;
  let found = null;
  scene.traverse((o) => { if (!found && o.uuid === uuid) found = o; });
  return found;
}

// Build a transform payload for one tracked object. Returns null if the
// transform hasn't changed (within epsilon) since the last send so we
// don't waste bandwidth on idle objects.
function _captureEntry(track) {
  const o = track.obj;
  if (!o) return null;
  const p = [o.position.x, o.position.y, o.position.z];
  const q = [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w];
  const s = [o.scale.x, o.scale.y, o.scale.z];
  const last = track.last;
  const EPS = 1e-5;
  if (last) {
    const dp = Math.abs(last.p[0] - p[0]) + Math.abs(last.p[1] - p[1]) + Math.abs(last.p[2] - p[2]);
    const dq = Math.abs(last.q[0] - q[0]) + Math.abs(last.q[1] - q[1]) + Math.abs(last.q[2] - q[2]) + Math.abs(last.q[3] - q[3]);
    const ds = Math.abs(last.s[0] - s[0]) + Math.abs(last.s[1] - s[1]) + Math.abs(last.s[2] - s[2]);
    if (dp + dq + ds < EPS) return null;
  }
  track.last = { p, q, s };
  track.sent++;
  return { uuid: o.uuid, p, q, s };
}

function _tick() {
  if (_tracked.size === 0 || _peers.size === 0) return;
  const entries = [];
  for (const track of _tracked.values()) {
    const e = _captureEntry(track);
    if (e) entries.push(e);
  }
  if (entries.length === 0) return;
  const msg = { kind: 'replicate', t: performance.now(), entries };
  for (const peer of _peers) {
    try { peer.send(REPLICATE_CHANNEL, msg); } catch (_) { /* drop */ }
  }
}

function _ensureTick() {
  if (_tickTimer) return;
  _tickTimer = setInterval(_tick, REPLICATE_INTERVAL_MS);
}

function _wireChannelOnce() {
  if (_wired) return;
  _wired = true;
  onChannelMessage(REPLICATE_CHANNEL, _onIncoming);
}

// Register a PeerWrapper to receive replication broadcasts.
export function addReplicationPeer(peer) {
  if (!peer) return;
  _peers.add(peer);
  _wireChannelOnce();
  _ensureTick();
}

export function removeReplicationPeer(peer) {
  _peers.delete(peer);
}

// Replicate an object's transform at 20 Hz. Pass either the THREE.Object3D
// directly or its uuid; if a uuid is given we resolve it from the scene.
// Idempotent — repeated calls with the same object just reset the
// last-snapshot baseline.
export function replicateObject(objOrUuid) {
  let obj = objOrUuid;
  if (typeof objOrUuid === 'string') obj = _findSceneObject(objOrUuid);
  if (!obj || !obj.uuid) return { ok: false, reason: 'object-not-found' };
  _tracked.set(obj.uuid, { obj, last: null, sent: 0 });
  _wireChannelOnce();
  _ensureTick();
  return { ok: true, uuid: obj.uuid };
}

export function unreplicateObject(uuidOrObj) {
  const uuid = typeof uuidOrObj === 'string' ? uuidOrObj : uuidOrObj?.uuid;
  if (!uuid) return { ok: false };
  _tracked.delete(uuid);
  return { ok: true };
}

// Subscribe to incoming replication updates for a specific UUID. The
// callback receives { uuid, p, q, s } whenever the remote peer pushes a
// transform update. Returns an unsubscribe function.
export function subscribeReplication(uuid, callback) {
  if (!uuid || typeof callback !== 'function') return () => {};
  let list = _subscribers.get(uuid);
  if (!list) { list = []; _subscribers.set(uuid, list); }
  list.push(callback);
  return () => {
    const arr = _subscribers.get(uuid);
    if (!arr) return;
    const i = arr.indexOf(callback);
    if (i >= 0) arr.splice(i, 1);
  };
}

export function replicationStats() {
  return {
    tracked: _tracked.size,
    peers: _peers.size,
    subscribers: _subscribers.size,
    hz: REPLICATE_HZ,
  };
}

// Test hook — stop the replication tick. Used by uninstall paths +
// unit tests; harmless otherwise.
export function stopReplication() {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  _tracked.clear();
  _peers.clear();
  _subscribers.clear();
}
