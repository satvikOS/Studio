// Slice 713 — Unreal Sequencer cinematic tracks.

import { registerOps } from '../common/registry.js';
import {
  createCine, setCameraPath, setLookAtTrack, setDOFTrack,
  play, pause, stop, setFrame, listCines,
} from './tracks.js';

let _installed = false;

export function installCineTracks() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioCineCreate: createCine,
    __studioCineSetCameraPath: setCameraPath,
    __studioCineSetLookAt: setLookAtTrack,
    __studioCineSetDOF: setDOFTrack,
    __studioCinePlay: play,
    __studioCinePause: pause,
    __studioCineStop: stop,
    __studioCineSetFrame: setFrame,
    __studioCineList: listCines,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'anim', 'Unreal Sequencer cinematic tracks — camera path / look-at / DOF');
}
