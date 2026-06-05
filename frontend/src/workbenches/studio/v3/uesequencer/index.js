// Slice 699 — Unreal Sequencer-style master timeline.

import { registerOps } from '../common/registry.js';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';
import {
  getState, addTrack, removeTrack, addKey, removeKey,
  setFrame, play, pause, setRange, setFps, tick,
  applyFrame, listTracks, setTrackMuted, clearTimeline, exportJson, importJson,
} from './timeline.js';

let _installed = false;

export function installUESeq() {
  if (_installed) return;
  _installed = true;

  chainIntoAnimTick('uesequencer', tick);

  const ops = {
    __studioUESeqAddTrack: addTrack,
    __studioUESeqRemoveTrack: removeTrack,
    __studioUESeqAddKey: addKey,
    __studioUESeqRemoveKey: removeKey,
    __studioUESeqSetFrame: setFrame,
    __studioUESeqPlay: play,
    __studioUESeqPause: pause,
    __studioUESeqSetRange: setRange,
    __studioUESeqSetFps: setFps,
    __studioUESeqApplyFrame: applyFrame,
    __studioUESeqListTracks: () => ({ ok: true, tracks: listTracks() }),
    __studioUESeqSetTrackMuted: setTrackMuted,
    __studioUESeqClear: clearTimeline,
    __studioUESeqExport: () => ({ ok: true, json: exportJson() }),
    __studioUESeqImport: importJson,
    __studioUESeqGetState: () => {
      const s = getState();
      return { ok: true, currentFrame: s.currentFrame, startFrame: s.startFrame, endFrame: s.endFrame, fps: s.fps, playing: s.playing, tracks: s.tracks.length };
    },
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'anim', 'Unreal Sequencer-style master timeline');
}
