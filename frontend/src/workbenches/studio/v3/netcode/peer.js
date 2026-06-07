// ArchDisc Studio V3 — REAL WebRTC peer-to-peer netcode (slice 888).
//
// This file is the low-level WebRTC layer used by replication.js + index.js
// to build multiplayer game sessions on top of native RTCPeerConnection.
//
// Two roles:
//   • Offer peer — calls createOfferPeer() to generate an SDP offer.
//     The offer is shared out-of-band (copy-paste / QR / signalling
//     service) to the answer peer. When the answerer sends back its
//     answer SDP, the offer peer feeds it to completeOfferPeer().
//   • Answer peer — receives the offer SDP, calls createAnswerPeer(offer)
//     and returns an answer SDP. The answer peer's data channel is
//     "remote" — i.e. it arrives via the ondatachannel event.
//
// We use a single ordered+reliable data channel ('archdisc-net') for the
// initial signalling-style handshake; replication.js opens additional
// out-of-order channels for high-frequency transform updates.
//
// STUN servers (no TURN — pure peer-to-peer, no relays) from Google's
// public list provide NAT traversal.

export const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

// Default RTC configuration. Bundle policy + DTLS-SRTP are browser
// defaults — we just supply the ICE servers.
export function defaultRtcConfig() {
  return {
    iceServers: [{ urls: STUN_SERVERS }],
    // Use 'all' bundlePolicy (the default) so we share a single ICE
    // transport for every data channel.
    bundlePolicy: 'max-bundle',
  };
}

// Subscribed message handlers, keyed by channel name. Filled by
// replication.js + index.js.
const _channelHandlers = new Map();

export function onChannelMessage(channelName, handler) {
  if (typeof handler !== 'function') return () => {};
  let list = _channelHandlers.get(channelName);
  if (!list) { list = []; _channelHandlers.set(channelName, list); }
  list.push(handler);
  return () => {
    const arr = _channelHandlers.get(channelName);
    if (!arr) return;
    const i = arr.indexOf(handler);
    if (i >= 0) arr.splice(i, 1);
  };
}

// Internal: route a JSON-parsed message to all subscribers. Errors in
// individual handlers don't break the channel.
function _dispatchMessage(channelName, msg) {
  const list = _channelHandlers.get(channelName);
  if (!list) return;
  for (const fn of list) {
    try { fn(msg); } catch (_) { /* keep the data channel alive */ }
  }
}

// Wire a data channel's onmessage to JSON-parse + dispatch. Idempotent
// (safe to call twice on the same channel).
function _wireChannel(channel) {
  if (!channel || channel.__archdiscWired) return;
  channel.__archdiscWired = true;
  channel.addEventListener('message', (ev) => {
    let payload = ev.data;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) { /* leave as string */ }
    }
    _dispatchMessage(channel.label, payload);
  });
}

// Wait until ICE gathering finishes so the SDP we hand out includes
// every candidate (trickle ICE is unnecessary for our copy-paste +
// out-of-band signalling model — we deliver one fat SDP).
function _waitForIceComplete(peer) {
  return new Promise((resolve) => {
    if (peer.iceGatheringState === 'complete') { resolve(); return; }
    const onChange = () => {
      if (peer.iceGatheringState === 'complete') {
        peer.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    };
    peer.addEventListener('icegatheringstatechange', onChange);
    // Belt + braces fallback in case the event never fires (e.g. when a
    // mock peer is used by the unit test harness).
    setTimeout(resolve, 4000);
  });
}

// Wrapper around an RTCPeerConnection that exposes the lifecycle hooks
// our replication layer needs.
class PeerWrapper {
  constructor(peer, role, opts = {}) {
    this.peer = peer;
    this.role = role; // 'offer' | 'answer'
    this.id = opts.id || `peer-${Math.random().toString(36).slice(2, 10)}`;
    this.channels = new Map(); // name → RTCDataChannel
    this.openListeners = new Set();
    this.closeListeners = new Set();
    this.state = 'new';
    // Hook lifecycle events for status tracking.
    peer.addEventListener('connectionstatechange', () => {
      this.state = peer.connectionState;
      if (peer.connectionState === 'connected') {
        for (const fn of this.openListeners) { try { fn(); } catch (_) {} }
      }
      if (peer.connectionState === 'closed' || peer.connectionState === 'failed') {
        for (const fn of this.closeListeners) { try { fn(); } catch (_) {} }
      }
    });
    // Incoming data channels from the remote peer (i.e. created by the
    // offerer and surfaced on the answerer).
    peer.addEventListener('datachannel', (ev) => {
      const ch = ev.channel;
      this.channels.set(ch.label, ch);
      _wireChannel(ch);
    });
  }
  addChannel(name, opts = {}) {
    if (this.channels.has(name)) return this.channels.get(name);
    const ch = this.peer.createDataChannel(name, {
      ordered: opts.ordered !== false,
      maxRetransmits: opts.maxRetransmits,
    });
    this.channels.set(name, ch);
    _wireChannel(ch);
    return ch;
  }
  send(channelName, payload) {
    const ch = this.channels.get(channelName);
    if (!ch || ch.readyState !== 'open') return false;
    const wire = typeof payload === 'string' ? payload : JSON.stringify(payload);
    try { ch.send(wire); return true; } catch (_) { return false; }
  }
  onOpen(fn) { this.openListeners.add(fn); return () => this.openListeners.delete(fn); }
  onClose(fn) { this.closeListeners.add(fn); return () => this.closeListeners.delete(fn); }
  close() {
    for (const ch of this.channels.values()) { try { ch.close(); } catch (_) {} }
    this.channels.clear();
    try { this.peer.close(); } catch (_) {}
    this.state = 'closed';
  }
}

// Create the offer-side peer. Returns { peer (PeerWrapper), offer (SDP) }.
//   • peer.peer       — the underlying RTCPeerConnection
//   • peer.channels   — Map<label, RTCDataChannel> seeded with the
//                       'archdisc-net' default channel
//   • offer            — an RTCSessionDescription { type: 'offer', sdp }
export async function createOfferPeer(opts = {}) {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new Error('WebRTC not available — RTCPeerConnection is undefined');
  }
  const peer = new RTCPeerConnection(defaultRtcConfig());
  const wrapper = new PeerWrapper(peer, 'offer', opts);
  // Offerer creates its data channels first so they get bundled into
  // the offer SDP; the answerer then surfaces them via the ondatachannel
  // event.
  wrapper.addChannel('archdisc-net', { ordered: true });
  if (opts.replicate !== false) {
    // Unreliable + unordered for high-rate transform replication.
    wrapper.addChannel('archdisc-replicate', { ordered: false, maxRetransmits: 0 });
  }
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await _waitForIceComplete(peer);
  // localDescription now contains the final SDP with ICE candidates.
  const finalOffer = peer.localDescription;
  return { peer: wrapper, offer: finalOffer };
}

// Create the answer-side peer from a received offer SDP. Returns
// { peer (PeerWrapper), answer (SDP) }.
export async function createAnswerPeer(offer, opts = {}) {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new Error('WebRTC not available — RTCPeerConnection is undefined');
  }
  if (!offer || !offer.sdp || !offer.type) {
    throw new Error('createAnswerPeer requires an RTCSessionDescription-like offer');
  }
  const peer = new RTCPeerConnection(defaultRtcConfig());
  const wrapper = new PeerWrapper(peer, 'answer', opts);
  await peer.setRemoteDescription(offer);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  await _waitForIceComplete(peer);
  const finalAnswer = peer.localDescription;
  return { peer: wrapper, answer: finalAnswer };
}

// Finalise the offerer side once the remote answer SDP arrives.
export async function completeOfferPeer(wrapperOrPeer, answer) {
  if (!wrapperOrPeer) throw new Error('completeOfferPeer requires a peer');
  if (!answer || !answer.sdp || !answer.type) {
    throw new Error('completeOfferPeer requires an RTCSessionDescription-like answer');
  }
  const peer = wrapperOrPeer.peer || wrapperOrPeer;
  await peer.setRemoteDescription(answer);
  return { ok: true, state: peer.connectionState };
}

// Helper: serialise an RTCSessionDescription to a portable string. The
// browser's RTCSessionDescription has a built-in .toJSON() so any
// transport (clipboard, REST endpoint, signalling server) works.
export function describeToString(desc) {
  if (!desc) return null;
  if (typeof desc.toJSON === 'function') return JSON.stringify(desc.toJSON());
  return JSON.stringify({ type: desc.type, sdp: desc.sdp });
}

// Helper: re-hydrate the wire string back into a plain SDP object that
// RTCPeerConnection.setRemoteDescription accepts.
export function parseDescription(str) {
  if (!str) return null;
  if (typeof str === 'object' && str.sdp && str.type) return str;
  const obj = JSON.parse(str);
  return obj;
}

export { PeerWrapper };
