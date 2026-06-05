// ArchDisc Studio V3 — floating audio panel.
//
// A Blender-VSE-style strip dock that lives over the viewport. Lists
// every loaded clip; for the active one renders its waveform image
// (via waveform.js → toDataURL), a transport row (play/pause/stop,
// time read-out, scrub slider), and a volume slider.
//
// Pure React + window-side helpers + standard DOM file input. No npm
// packages, no globalised state — the panel reads through props the
// host injects from `index.js`. Mounts into its own body-attached host
// so we never touch StudioShellV3.jsx.

import React, { useEffect, useRef, useState } from 'react';
import { listEntries, generateSineWave, loadAudio, unloadAudio } from './load.js';
import {
  play, pause, stop, setVolume, getVolume, getCurrentTime,
  isPlaying as isPlayingState, destroyState, listPlaybackStates,
} from './playback.js';
import { renderWaveform } from './waveform.js';

const PANEL_W = 540;
const WAVE_W = 480;
const WAVE_H = 80;

function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m.toString().padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
}

export default function AudioPanel(props) {
  const { onCloseRequest } = props || {};
  const [, force] = useState(0);
  const tick = () => force((v) => (v + 1) | 0);
  const [activeUuid, setActiveUuid] = useState(null);
  const [waveDataUrl, setWaveDataUrl] = useState('');
  const [waveTick, setWaveTick] = useState(0);
  const fileInputRef = useRef(null);
  const rafRef = useRef(0);

  const entries = listEntries();
  // Pick a sane active uuid: last user-chosen if still present, else
  // the first available, else null.
  const active = entries.find((e) => e.uuid === activeUuid) || entries[0] || null;
  const liveUuid = active ? active.uuid : null;

  // Render the waveform for the active clip whenever it (or the
  // entries set) changes.
  useEffect(() => {
    if (!liveUuid) {
      setWaveDataUrl('');
      return;
    }
    const r = renderWaveform(liveUuid, WAVE_W, WAVE_H, {
      bg: 'rgba(13,17,23,0.0)',
      fg: '#1de9b6',
      mid: 'rgba(154,166,178,0.35)',
    });
    setWaveDataUrl((r && r.dataUrl) || '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveUuid, entries.length, waveTick]);

  // Pump a 30fps re-render while any clip is playing so the playhead
  // tracks the audio.
  useEffect(() => {
    const step = () => {
      let anyPlaying = false;
      const states = listPlaybackStates();
      for (const s of states) if (s.playing) { anyPlaying = true; break; }
      if (anyPlaying) tick();
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, []);

  const curTime = liveUuid ? getCurrentTime(liveUuid) : 0;
  const playing = liveUuid ? isPlayingState(liveUuid) : false;
  const volume = liveUuid ? getVolume(liveUuid) : 1;
  const duration = active ? active.duration : 0;

  const onPickFile = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };
  const onFileChange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const ab = await f.arrayBuffer();
      const r = await loadAudio(ab, { name: f.name });
      if (r && r.ok) {
        setActiveUuid(r.uuid);
        setWaveTick((v) => v + 1);
      }
    } catch (_) { /* surface via DOM nothing here */ }
    // Clear the input so picking the same file again still fires onChange.
    e.target.value = '';
  };
  const onAddSine = () => {
    const r = generateSineWave(440, 1.5);
    if (r && r.ok) {
      setActiveUuid(r.uuid);
      setWaveTick((v) => v + 1);
    }
  };
  const onPlay = () => {
    if (!liveUuid) return;
    if (playing) { pause(liveUuid); }
    else { play(liveUuid, curTime >= duration - 0.01 ? 0 : undefined); }
    tick();
  };
  const onStop = () => {
    if (!liveUuid) return;
    stop(liveUuid);
    tick();
  };
  const onScrub = (e) => {
    if (!liveUuid) return;
    const v = Number(e.target.value);
    const wasPlaying = playing;
    stop(liveUuid);
    if (wasPlaying) {
      play(liveUuid, v);
    } else {
      // Update pausedAt so the next play() resumes from here.
      play(liveUuid, v); pause(liveUuid);
    }
    tick();
  };
  const onVol = (e) => {
    if (!liveUuid) return;
    setVolume(liveUuid, Number(e.target.value));
    tick();
  };
  const onSelect = (uuid) => {
    setActiveUuid(uuid);
    setWaveTick((v) => v + 1);
  };
  const onDelete = (uuid) => {
    stop(uuid);
    destroyState(uuid);
    unloadAudio(uuid);
    if (uuid === activeUuid) setActiveUuid(null);
    setWaveTick((v) => v + 1);
    tick();
  };

  const buttonBase = {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '4px 10px', borderRadius: 4,
    fontSize: 11, cursor: 'pointer',
  };
  const rowBase = {
    display: 'flex', alignItems: 'center', gap: 8,
  };

  return (
    <div
      data-studio-v3-audio-panel
      style={{
        position: 'fixed', right: 18, bottom: 80, zIndex: 9330,
        width: PANEL_W,
        background: 'var(--studio-bg-elev, #161b22)',
        color: 'var(--studio-ink, #e6edf3)',
        border: '1px solid rgba(154,166,178,0.25)',
        borderTop: '2px solid var(--studio-accent, #1de9b6)',
        borderRadius: 6,
        boxShadow: '0 16px 32px rgba(0,0,0,0.45)',
        fontFamily: 'inherit',
        fontSize: 12,
      }}
    >
      {/* Header */}
      <div
        data-studio-v3-audio-header
        style={{
          ...rowBase,
          padding: '8px 10px',
          borderBottom: '1px solid rgba(154,166,178,0.18)',
        }}
      >
        <strong style={{
          color: 'var(--studio-accent, #1de9b6)',
          fontSize: 12, letterSpacing: '0.05em',
        }}>Audio timeline</strong>
        <span style={{
          opacity: 0.6, fontSize: 11,
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}>{entries.length} clips</span>
        <div style={{ flex: 1 }} />
        <button data-studio-v3-audio-load
          onClick={onPickFile} style={buttonBase}>Load file</button>
        <button data-studio-v3-audio-sine
          onClick={onAddSine} style={buttonBase}>+ Sine</button>
        <button data-studio-v3-audio-close
          onClick={() => onCloseRequest && onCloseRequest()} style={buttonBase}>Close</button>
        <input
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.flac"
          ref={fileInputRef}
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* Waveform + scrubber */}
      <div style={{ padding: '10px 10px 6px 10px' }}>
        <div
          data-studio-v3-audio-wave
          style={{
            width: '100%', height: WAVE_H,
            background: 'rgba(13,17,23,0.65)',
            border: '1px solid rgba(154,166,178,0.18)',
            borderRadius: 4,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {waveDataUrl ? (
            <img
              data-studio-v3-audio-wave-img
              src={waveDataUrl}
              alt="waveform"
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                imageRendering: 'pixelated',
              }}
            />
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', opacity: 0.5, fontSize: 11,
            }}>{active ? 'Rendering…' : 'No audio loaded'}</div>
          )}
          {active && (
            <div
              data-studio-v3-audio-playhead
              style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${(curTime / Math.max(duration, 1e-6)) * 100}%`,
                width: 1,
                background: 'var(--studio-accent, #1de9b6)',
                pointerEvents: 'none',
                boxShadow: '0 0 4px rgba(29,233,182,0.7)',
              }}
            />
          )}
        </div>
        <input
          data-studio-v3-audio-scrub
          type="range"
          min={0}
          max={Math.max(0.001, duration)}
          step={0.001}
          value={Math.min(duration, curTime)}
          onChange={onScrub}
          disabled={!active}
          style={{ width: '100%', marginTop: 6 }}
        />
      </div>

      {/* Transport row */}
      <div style={{ ...rowBase, padding: '4px 10px 8px 10px' }}>
        <button data-studio-v3-audio-play
          onClick={onPlay} disabled={!active} style={buttonBase}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button data-studio-v3-audio-stop
          onClick={onStop} disabled={!active} style={buttonBase}>Stop</button>
        <span data-studio-v3-audio-time style={{
          fontFamily: 'var(--studio-mono, ui-monospace)',
          fontSize: 11, opacity: 0.85,
        }}>{fmtTime(curTime)} / {fmtTime(duration)}</span>
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.6, fontSize: 11 }}>vol</span>
        <input
          data-studio-v3-audio-volume
          type="range"
          min={0} max={1} step={0.01}
          value={volume}
          onChange={onVol}
          disabled={!active}
          style={{ width: 100 }}
        />
      </div>

      {/* Clip list */}
      <div
        data-studio-v3-audio-list
        style={{
          maxHeight: 140,
          overflow: 'auto',
          borderTop: '1px solid rgba(154,166,178,0.18)',
          padding: '4px 0',
        }}
      >
        {entries.length === 0 && (
          <div style={{ padding: '8px 12px', opacity: 0.55, fontSize: 11 }}>
            No clips loaded — pick a file or add a sine wave.
          </div>
        )}
        {entries.map((e) => (
          <div
            data-studio-v3-audio-item={e.uuid}
            key={e.uuid}
            onClick={() => onSelect(e.uuid)}
            style={{
              ...rowBase,
              padding: '4px 10px',
              cursor: 'pointer',
              background: e.uuid === liveUuid ? 'rgba(29,233,182,0.08)' : 'transparent',
              borderLeft: e.uuid === liveUuid
                ? '2px solid var(--studio-accent, #1de9b6)'
                : '2px solid transparent',
            }}
          >
            <span style={{
              flex: 1, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontSize: 11,
            }}>{e.name || e.uuid}</span>
            <span style={{
              opacity: 0.6, fontSize: 10,
              fontFamily: 'var(--studio-mono, ui-monospace)',
            }}>{e.duration.toFixed(2)}s · {e.channels}ch · {Math.round(e.sampleRate)}Hz</span>
            <button
              data-studio-v3-audio-delete={e.uuid}
              onClick={(ev) => { ev.stopPropagation(); onDelete(e.uuid); }}
              style={{ ...buttonBase, padding: '2px 6px' }}
            >×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
