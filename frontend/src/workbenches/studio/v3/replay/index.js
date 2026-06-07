// ArchDisc Studio V3 — replay / input recording (slice 910).
// Deterministic input recording + playback for game testing + speedruns.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _recording = false;
let _playing = false;
let _startTime = 0;
let _events = [];
let _playIdx = 0;
let _origDispatch = null;
function _record() {
  _recording = true; _events = []; _startTime = performance.now();
  if (typeof window === 'undefined') return { ok: false };
  const origAddEventListener = window.addEventListener.bind(window);
  if (!_origDispatch) {
    _origDispatch = window.dispatchEvent.bind(window);
  }
  // Capture keydown/keyup/pointerdown/pointerup
  const cap = (kind, ev) => {
    if (!_recording) return;
    _events.push({
      t: performance.now() - _startTime,
      kind,
      code: ev.code, key: ev.key,
      x: ev.clientX, y: ev.clientY,
      button: ev.button,
    });
  };
  window.addEventListener('keydown', (e) => cap('keydown', e), { capture: true });
  window.addEventListener('keyup', (e) => cap('keyup', e), { capture: true });
  window.addEventListener('pointerdown', (e) => cap('pointerdown', e), { capture: true });
  window.addEventListener('pointerup', (e) => cap('pointerup', e), { capture: true });
  return { ok: true };
}
function _stop() { _recording = false; return { ok: true, eventCount: _events.length }; }
function _play() {
  if (_recording) return { ok: false };
  _playing = true; _playIdx = 0; _startTime = performance.now();
  function _tick() {
    if (!_playing || _playIdx >= _events.length) { _playing = false; return; }
    const elapsed = performance.now() - _startTime;
    while (_playIdx < _events.length && _events[_playIdx].t <= elapsed) {
      const ev = _events[_playIdx];
      let synthetic;
      if (ev.kind.startsWith('key')) synthetic = new KeyboardEvent(ev.kind, { code: ev.code, key: ev.key, bubbles: true });
      else synthetic = new PointerEvent(ev.kind, { clientX: ev.x, clientY: ev.y, button: ev.button, bubbles: true });
      try { _origDispatch?.(synthetic); window.dispatchEvent(synthetic); } catch (_) {}
      _playIdx++;
    }
    requestAnimationFrame(_tick);
  }
  _tick();
  return { ok: true };
}
export function installReplay() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioReplayRecord: _record,
    __studioReplayStop: _stop,
    __studioReplayPlay: _play,
    __studioReplayExport: () => ({ ok: true, events: _events.slice() }),
    __studioReplayImport: ({ events } = {}) => { _events = Array.isArray(events) ? events.slice() : []; return { ok: true }; },
    __studioReplayStats: () => ({ ok: true, recording: _recording, playing: _playing, events: _events.length }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'game', 'Replay / input recording');
  return { ok: true };
}
export default installReplay;
