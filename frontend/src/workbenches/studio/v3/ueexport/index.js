// Slice 729 — Unreal Sequencer MP4/webm export.

import { registerOps } from '../common/registry.js';
import {
  startRecording, stopRecording, isRecording, getRecordingState, renderCine,
} from './mp4.js';

let _installed = false;

export function installUEExport() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioUEExportStart: startRecording,
    __studioUEExportStop: stopRecording,
    __studioUEExportIsRecording: isRecording,
    __studioUEExportState: getRecordingState,
    __studioUEExportRenderCine: renderCine,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'Sequencer canvas recording — webm/mp4 export via MediaRecorder');
}
