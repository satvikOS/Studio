// ArchDisc Studio V3 — WebRTC peer-to-peer netcode (slice 888).
// Real RTCPeerConnection setup for multiplayer game sessions. Host
// creates an offer SDP, sends it (out of band) to a client, the client
// returns an answer SDP, host accepts it, and both peers can then send
// JSON messages on named data channels or auto-replicate scene objects.

import {
  createOfferPeer,
  createAnswerPeer,
  completeOfferPeer,
  describeToString,
  parseDescription,
  onChannelMessage,
} from './peer.js';
import {
  replicateObject,
  unreplicateObject,
  subscribeReplication,
  addReplicationPeer,
  removeReplicationPeer,
  replicationStats,
  stopReplication,
} from './replication.js';
import { registerOps } from '../common/registry.js';

let _installed = false;

// Session state. We only run one local peer at a time (a peer-to-peer
// game doesn't need a swarm).
const _state = {
  role: null,        // 'host' | 'client' | null
  peer: null,        // PeerWrapper
  offer: null,       // last offer SDP (string form)
  answer: null,      // last answer SDP (string form)
  channelSubs: new Map(), // channelName → [unsubscribe fns]
};

function _resetState() {
  if (_state.peer) {
    try { removeReplicationPeer(_state.peer); } catch (_) {}
    try { _state.peer.close(); } catch (_) {}
  }
  for (const [, fns] of _state.channelSubs) {
    for (const fn of fns) { try { fn(); } catch (_) {} }
  }
  _state.channelSubs.clear();
  _state.role = null;
  _state.peer = null;
  _state.offer = null;
  _state.answer = null;
}

// ─── Op: Host a session ──────────────────────────────────────────────
async function _netHost() {
  if (_state.peer) _resetState();
  try {
    const { peer, offer } = await createOfferPeer();
    _state.role = 'host';
    _state.peer = peer;
    _state.offer = describeToString(offer);
    addReplicationPeer(peer);
    return { ok: true, offer: _state.offer };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// ─── Op: Join a session (act as client) ─────────────────────────────
async function _netJoin({ offer } = {}) {
  if (!offer) return { ok: false, error: 'missing-offer' };
  if (_state.peer) _resetState();
  try {
    const desc = parseDescription(offer);
    const { peer, answer } = await createAnswerPeer(desc);
    _state.role = 'client';
    _state.peer = peer;
    _state.offer = typeof offer === 'string' ? offer : describeToString(offer);
    _state.answer = describeToString(answer);
    addReplicationPeer(peer);
    return { ok: true, answer: _state.answer };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// ─── Op: Accept an answer (host finalises) ──────────────────────────
async function _netAccept({ answer } = {}) {
  if (!_state.peer || _state.role !== 'host') {
    return { ok: false, error: 'not-hosting' };
  }
  if (!answer) return { ok: false, error: 'missing-answer' };
  try {
    const desc = parseDescription(answer);
    await completeOfferPeer(_state.peer, desc);
    _state.answer = typeof answer === 'string' ? answer : describeToString(answer);
    return { ok: true, state: _state.peer.peer.connectionState };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// ─── Op: Send a JSON message on a named channel ─────────────────────
function _netSend({ channel = 'archdisc-net', payload } = {}) {
  if (!_state.peer) return { ok: false, error: 'not-connected' };
  // If the channel doesn't exist on our peer, create it on the fly. Only
  // the side that originated the connection (host) can create new
  // channels mid-session; on the client we fall back to the default
  // 'archdisc-net' channel.
  if (!_state.peer.channels.has(channel)) {
    if (_state.role === 'host') _state.peer.addChannel(channel);
    else return { ok: false, error: 'unknown-channel' };
  }
  const sent = _state.peer.send(channel, payload);
  return sent ? { ok: true } : { ok: false, error: 'channel-not-open' };
}

// ─── Op: Subscribe to messages on a named channel ───────────────────
function _netOn({ channel = 'archdisc-net', callback } = {}) {
  if (typeof callback !== 'function') return { ok: false, error: 'missing-callback' };
  const off = onChannelMessage(channel, callback);
  let list = _state.channelSubs.get(channel);
  if (!list) { list = []; _state.channelSubs.set(channel, list); }
  list.push(off);
  return { ok: true };
}

// ─── Op: Auto-replicate a scene object at 20 Hz ─────────────────────
function _netReplicate({ uuid } = {}) {
  if (!uuid) return { ok: false, error: 'missing-uuid' };
  if (!_state.peer) return { ok: false, error: 'not-connected' };
  return replicateObject(uuid);
}

function _netUnreplicate({ uuid } = {}) {
  if (!uuid) return { ok: false, error: 'missing-uuid' };
  return unreplicateObject(uuid);
}

// ─── Op: Subscribe to incoming replication updates ──────────────────
function _netSubscribe({ uuid, callback } = {}) {
  if (!uuid || typeof callback !== 'function') return { ok: false, error: 'bad-args' };
  subscribeReplication(uuid, callback);
  return { ok: true };
}

// ─── Op: List connected peers ───────────────────────────────────────
function _netGetPeers() {
  const peers = [];
  if (_state.peer) {
    peers.push({
      id: _state.peer.id,
      role: _state.role,
      state: _state.peer.peer.connectionState,
      iceState: _state.peer.peer.iceConnectionState,
      channels: [..._state.peer.channels.keys()],
    });
  }
  return { ok: true, peers };
}

function _netDisconnect() {
  _resetState();
  return { ok: true };
}

function _netStats() {
  return {
    ok: true,
    role: _state.role,
    connected: !!_state.peer && _state.peer.state === 'connected',
    replication: replicationStats(),
  };
}

export function installNetcode() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioNetHost: _netHost,
    __studioNetJoin: _netJoin,
    __studioNetAccept: _netAccept,
    __studioNetSend: _netSend,
    __studioNetOn: _netOn,
    __studioNetReplicate: _netReplicate,
    __studioNetUnreplicate: _netUnreplicate,
    __studioNetSubscribe: _netSubscribe,
    __studioNetGetPeers: _netGetPeers,
    __studioNetDisconnect: _netDisconnect,
    __studioNetStats: _netStats,
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Multiplayer WebRTC P2P netcode');
  return { ok: true };
}

export function uninstallNetcode() {
  _resetState();
  stopReplication();
  _installed = false;
}

export default installNetcode;
