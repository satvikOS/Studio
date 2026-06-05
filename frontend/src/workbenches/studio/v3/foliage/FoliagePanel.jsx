// ArchDisc Studio V3 — foliage side panel.
//
// Side-docked over the viewport: scatter source picker, target picker,
// instance count, scale variance, LOD low-mesh + distance, wind
// strength, paint-mode toggle. Reads through the install layer's
// public helpers — never reaches into THREE directly so the panel
// stays decoupled from the scene graph.
//
// Mounts into a body-attached host (`data-studio-v3-foliage-panel-host`)
// so we never touch StudioShellV3.jsx.

import React, { useEffect, useState } from 'react';
import { listFoliage, scatterOnSurface, deleteFoliage } from './scatter.js';
import { setupLOD, removeLOD, setLODDistance, listLOD } from './lod.js';
import { setWind, clearWind, listWind } from './wind.js';
import { enterPaintMode, exitPaintMode, paintModeStatus } from './paint.js';

const PANEL_W = 320;

function listSceneMeshes() {
  if (typeof window === 'undefined') return [];
  const vp = window.__archdiscViewport;
  const scene = (window.__archdiscScene)
    || (vp && vp.scene)
    || null;
  if (!scene) return [];
  const arr = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh && o.userData && o.userData.archdiscStudioPrimitiveKind === 'foliage-lod-low') return;
    arr.push({
      uuid: o.uuid,
      name: o.name || '(unnamed)',
      kind: (o.userData && o.userData.archdiscStudioPrimitiveKind) || (o.isInstancedMesh ? 'instanced' : 'mesh'),
    });
  });
  return arr;
}

export default function FoliagePanel(props) {
  const { onCloseRequest } = props || {};
  const [, force] = useState(0);
  const tick = () => force((v) => (v + 1) | 0);

  const [sourceUuid, setSourceUuid] = useState('');
  const [targetUuid, setTargetUuid] = useState('');
  const [count, setCount] = useState(500);
  const [variance, setVariance] = useState(0.25);
  const [seed, setSeed] = useState(1337);
  const [lowUuid, setLowUuid] = useState('');
  const [lodDist, setLodDist] = useState(10);
  const [windStr, setWindStr] = useState(0.15);
  const [selectedScatter, setSelectedScatter] = useState('');
  const [painting, setPainting] = useState(false);
  const [meshTick, setMeshTick] = useState(0);

  // Re-pump every 800ms so newly-spawned meshes show up in the
  // dropdowns without forcing the user to close + reopen the panel.
  useEffect(() => {
    const id = setInterval(() => setMeshTick((v) => v + 1), 800);
    return () => clearInterval(id);
  }, []);

  const meshes = listSceneMeshes(); // eslint-disable-line no-unused-vars
  // (use it to make eslint happy and keep the effect-trigger var alive)
  void meshTick;
  const foliage = listFoliage().foliage;
  const lods = listLOD().lods;
  const winds = listWind().winds;
  const pStatus = paintModeStatus();

  // Sync paint state.
  useEffect(() => {
    if (pStatus.active !== painting) setPainting(!!pStatus.active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pStatus.active]);

  const live = foliage.find((f) => f.uuid === selectedScatter) || foliage[0] || null;
  const liveUuid = live && live.uuid;

  const doScatter = () => {
    if (!sourceUuid || !targetUuid) return;
    const r = scatterOnSurface(sourceUuid, targetUuid, +count, {
      seed: +seed, scaleVariance: +variance,
    });
    if (r && r.ok) {
      setSelectedScatter(r.uuid);
      tick();
    }
  };
  const doDelete = (uuid) => {
    if (painting && pStatus.scatterUuid === uuid) exitPaintMode();
    deleteFoliage(uuid);
    if (uuid === selectedScatter) setSelectedScatter('');
    tick();
  };
  const doSetupLOD = () => {
    if (!liveUuid || !lowUuid) return;
    setupLOD(liveUuid, lowUuid, +lodDist);
    tick();
  };
  const doRemoveLOD = () => {
    if (!liveUuid) return;
    removeLOD(liveUuid);
    tick();
  };
  const doLODDist = (v) => {
    setLodDist(v);
    if (liveUuid) setLODDistance(liveUuid, v);
  };
  const doWind = (s) => {
    setWindStr(s);
    if (liveUuid) setWind(liveUuid, s);
  };
  const doClearWind = () => {
    setWindStr(0);
    if (liveUuid) clearWind(liveUuid);
    tick();
  };
  const togglePaint = () => {
    if (!liveUuid) return;
    if (painting) { exitPaintMode(); setPainting(false); }
    else { enterPaintMode(liveUuid); setPainting(true); }
  };

  const labelStyle = {
    display: 'block', fontSize: 10,
    textTransform: 'uppercase', letterSpacing: '0.06em',
    color: 'var(--studio-ink-dim, #9aa6b2)', marginBottom: 3, marginTop: 8,
  };
  const buttonBase = {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '4px 10px', borderRadius: 4,
    fontSize: 11, cursor: 'pointer',
  };
  const inputBase = {
    width: '100%', background: 'rgba(13,17,23,0.65)', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.25)', borderRadius: 4,
    padding: '4px 6px', fontSize: 11,
    fontFamily: 'var(--studio-mono, ui-monospace)',
  };
  const rowBase = { display: 'flex', alignItems: 'center', gap: 8 };

  const sceneMeshes = listSceneMeshes();

  return (
    <div
      data-studio-v3-foliage-panel
      style={{
        position: 'fixed', right: 18, top: 90, zIndex: 9332,
        width: PANEL_W,
        background: 'var(--studio-bg-elev, #161b22)',
        color: 'var(--studio-ink, #e6edf3)',
        border: '1px solid rgba(154,166,178,0.25)',
        borderTop: '2px solid var(--studio-accent, #1de9b6)',
        borderRadius: 6,
        boxShadow: '0 16px 32px rgba(0,0,0,0.45)',
        fontFamily: 'inherit', fontSize: 12,
        maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div
        data-studio-v3-foliage-header
        style={{
          ...rowBase,
          padding: '8px 10px',
          borderBottom: '1px solid rgba(154,166,178,0.18)',
        }}
      >
        <strong style={{
          color: 'var(--studio-accent, #1de9b6)',
          fontSize: 12, letterSpacing: '0.05em',
        }}>Foliage</strong>
        <span style={{
          opacity: 0.6, fontSize: 11,
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}>{foliage.length} scatters · {lods.length} LOD · {winds.length} wind</span>
        <div style={{ flex: 1 }} />
        <button data-studio-v3-foliage-close
          onClick={() => onCloseRequest && onCloseRequest()} style={buttonBase}>Close</button>
      </div>

      <div style={{ padding: '8px 10px' }}>
        {/* Source mesh */}
        <label style={labelStyle}>Source mesh</label>
        <select
          data-studio-v3-foliage-source
          value={sourceUuid}
          onChange={(e) => setSourceUuid(e.target.value)}
          style={inputBase}
        >
          <option value="">— pick source —</option>
          {sceneMeshes.map((m) => (
            <option key={m.uuid} value={m.uuid}>{m.name} · {m.kind}</option>
          ))}
        </select>

        {/* Target surface */}
        <label style={labelStyle}>Target surface</label>
        <select
          data-studio-v3-foliage-target
          value={targetUuid}
          onChange={(e) => setTargetUuid(e.target.value)}
          style={inputBase}
        >
          <option value="">— pick target —</option>
          {sceneMeshes.map((m) => (
            <option key={m.uuid} value={m.uuid}>{m.name} · {m.kind}</option>
          ))}
        </select>

        <div style={{ ...rowBase, marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Count</label>
            <input
              data-studio-v3-foliage-count
              type="number" min={1} max={1000000} step={100}
              value={count} onChange={(e) => setCount(Number(e.target.value) || 1)}
              style={inputBase}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Variance</label>
            <input
              data-studio-v3-foliage-variance
              type="number" min={0} max={1} step={0.05}
              value={variance} onChange={(e) => setVariance(Number(e.target.value) || 0)}
              style={inputBase}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Seed</label>
            <input
              data-studio-v3-foliage-seed
              type="number" step={1}
              value={seed} onChange={(e) => setSeed(Number(e.target.value) | 0)}
              style={inputBase}
            />
          </div>
        </div>

        <div style={{ ...rowBase, marginTop: 10 }}>
          <button
            data-studio-v3-foliage-scatter
            onClick={doScatter}
            disabled={!sourceUuid || !targetUuid}
            style={{ ...buttonBase, flex: 1 }}
          >Scatter on surface</button>
        </div>
      </div>

      {/* Scatter list */}
      <div
        data-studio-v3-foliage-list
        style={{
          borderTop: '1px solid rgba(154,166,178,0.18)',
          padding: '4px 0',
        }}
      >
        {foliage.length === 0 && (
          <div style={{ padding: '8px 12px', opacity: 0.55, fontSize: 11 }}>
            No scatters yet — pick source + target above.
          </div>
        )}
        {foliage.map((f) => (
          <div
            data-studio-v3-foliage-item={f.uuid}
            key={f.uuid}
            onClick={() => setSelectedScatter(f.uuid)}
            style={{
              ...rowBase,
              padding: '4px 10px',
              cursor: 'pointer',
              background: f.uuid === liveUuid ? 'rgba(29,233,182,0.08)' : 'transparent',
              borderLeft: f.uuid === liveUuid
                ? '2px solid var(--studio-accent, #1de9b6)'
                : '2px solid transparent',
            }}
          >
            <span style={{
              flex: 1, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontSize: 11,
            }}>{f.uuid.slice(0, 6)} · {f.count} inst</span>
            <span style={{
              opacity: 0.6, fontSize: 10,
              fontFamily: 'var(--studio-mono, ui-monospace)',
            }}>{f.hasLOD ? 'LOD' : ''} {f.hasWind ? 'wind' : ''}</span>
            <button
              data-studio-v3-foliage-delete={f.uuid}
              onClick={(ev) => { ev.stopPropagation(); doDelete(f.uuid); }}
              style={{ ...buttonBase, padding: '2px 6px' }}
            >×</button>
          </div>
        ))}
      </div>

      {/* LOD + wind + paint operate on selectedScatter */}
      {liveUuid && (
        <div style={{
          padding: '8px 10px',
          borderTop: '1px solid rgba(154,166,178,0.18)',
        }}>
          <strong style={{ fontSize: 11, opacity: 0.85 }}>
            Selected · {liveUuid.slice(0, 8)}
          </strong>

          <label style={labelStyle}>LOD low mesh</label>
          <select
            data-studio-v3-foliage-low
            value={lowUuid}
            onChange={(e) => setLowUuid(e.target.value)}
            style={inputBase}
          >
            <option value="">— pick low —</option>
            {sceneMeshes.map((m) => (
              <option key={m.uuid} value={m.uuid}>{m.name} · {m.kind}</option>
            ))}
          </select>

          <label style={labelStyle}>LOD distance ({lodDist.toFixed(2)})</label>
          <input
            data-studio-v3-foliage-lod-dist
            type="range" min={0.5} max={200} step={0.5}
            value={lodDist} onChange={(e) => doLODDist(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={{ ...rowBase, marginTop: 6 }}>
            <button
              data-studio-v3-foliage-setup-lod
              onClick={doSetupLOD}
              disabled={!lowUuid}
              style={{ ...buttonBase, flex: 1 }}
            >Setup LOD</button>
            <button
              data-studio-v3-foliage-remove-lod
              onClick={doRemoveLOD}
              style={{ ...buttonBase, flex: 1 }}
            >Remove LOD</button>
          </div>

          <label style={labelStyle}>Wind strength ({windStr.toFixed(2)})</label>
          <input
            data-studio-v3-foliage-wind
            type="range" min={0} max={1} step={0.01}
            value={windStr} onChange={(e) => doWind(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={{ ...rowBase, marginTop: 6 }}>
            <button
              data-studio-v3-foliage-clear-wind
              onClick={doClearWind}
              style={{ ...buttonBase, flex: 1 }}
            >Stop wind</button>
          </div>

          <label style={labelStyle}>Paint mode</label>
          <div style={rowBase}>
            <button
              data-studio-v3-foliage-paint-toggle
              onClick={togglePaint}
              style={{
                ...buttonBase, flex: 1,
                background: painting ? 'rgba(29,233,182,0.18)' : 'transparent',
                borderColor: painting ? 'var(--studio-accent, #1de9b6)' : 'rgba(154,166,178,0.35)',
              }}
            >{painting ? 'Exit paint mode' : 'Enter paint mode'}</button>
          </div>
          <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4 }}>
            Drag to add · shift-drag to remove
          </div>
        </div>
      )}
    </div>
  );
}
