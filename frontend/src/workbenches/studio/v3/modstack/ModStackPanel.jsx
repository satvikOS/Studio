// ArchDisc Studio V3 — non-destructive modifier stack side panel.
//
// Lists the active mesh's modifier stack with:
//   - eye toggle  → setEnabled
//   - viewport eye → setViewport (preview off without removing mod)
//   - drag handle  → reorder
//   - per-kind editor → setParams
//   - × delete
//   - global add picker (kind dropdown), apply-all, reset-to-base, clear
//
// Mounted body-attached so we don't touch StudioShellV3.jsx.

import React, { useEffect, useState } from 'react';
import { SUPPORTED_KINDS } from './stack.js';

const PANEL_W = 340;

// Per-kind param schema → drives the editor row.
const PARAM_SCHEMA = {
  subdivide: [{ key: 'iterations', label: 'Iter', kind: 'int', min: 1, max: 4, step: 1, def: 1 }],
  solidify:  [{ key: 'thickness',  label: 'Thick', kind: 'float', min: -0.5, max: 0.5, step: 0.005, def: 0.05 }],
  mirror: [
    { key: 'axis',  label: 'Axis',  kind: 'enum', options: ['x', 'y', 'z'], def: 'x' },
    { key: 'merge', label: 'Weld',  kind: 'bool', def: false },
  ],
  array: [
    { key: 'count',   label: 'N',    kind: 'int',   min: 1, max: 64, step: 1, def: 3 },
    { key: 'offsetX', label: 'ΔX',   kind: 'float', min: -5, max: 5, step: 0.05, def: 1 },
    { key: 'offsetY', label: 'ΔY',   kind: 'float', min: -5, max: 5, step: 0.05, def: 0 },
    { key: 'offsetZ', label: 'ΔZ',   kind: 'float', min: -5, max: 5, step: 0.05, def: 0 },
  ],
  decimate: [{ key: 'ratio', label: 'Reduce', kind: 'float', min: 0, max: 0.95, step: 0.01, def: 0.5 }],
  bend: [
    { key: 'axis',  label: 'Axis',  kind: 'enum',  options: ['x', 'y', 'z'], def: 'y' },
    { key: 'angle', label: 'Angle', kind: 'float', min: -3.14, max: 3.14, step: 0.05, def: 0.52 },
  ],
  twist: [
    { key: 'axis',  label: 'Axis',  kind: 'enum',  options: ['x', 'y', 'z'], def: 'y' },
    { key: 'angle', label: 'Angle', kind: 'float', min: -6.28, max: 6.28, step: 0.1, def: 3.14 },
  ],
  taper: [
    { key: 'axis',        label: 'Axis',  kind: 'enum',  options: ['x', 'y', 'z'], def: 'y' },
    { key: 'topScale',    label: 'Top',   kind: 'float', min: 0, max: 4, step: 0.05, def: 0.2 },
    { key: 'bottomScale', label: 'Bot',   kind: 'float', min: 0, max: 4, step: 0.05, def: 1 },
  ],
  displace: [
    { key: 'strength', label: 'Amp',   kind: 'float', min: -1, max: 1, step: 0.01, def: 0.1 },
    { key: 'scale',    label: 'Freq',  kind: 'float', min: 0.1, max: 20, step: 0.1, def: 4 },
    { key: 'seed',     label: 'Seed',  kind: 'int',   min: 0, max: 9999, step: 1, def: 1234 },
  ],
  smooth: [
    { key: 'iterations', label: 'Iter',   kind: 'int',   min: 1, max: 20, step: 1, def: 1 },
    { key: 'factor',     label: 'Factor', kind: 'float', min: 0, max: 1, step: 0.05, def: 0.5 },
  ],
};

function _meshLabel(mesh) {
  if (!mesh) return 'no selection';
  const k = mesh.userData && mesh.userData.archdiscStudioPrimitiveKind;
  return k ? `${k} · ${mesh.uuid.slice(0, 6)}` : `mesh · ${mesh.uuid.slice(0, 6)}`;
}

export default function ModStackPanel({
  getSelectedMesh,
  listMods,
  onAdd, onSetEnabled, onSetViewport, onSetParams,
  onReorder, onRemove, onClear, onApplyAll, onResetToBase,
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const [dragFrom, setDragFrom] = useState(null);
  const [pickKind, setPickKind] = useState('');

  // Cheap polling refresh — program-driven calls (Archie / palette) get
  // reflected without us having to wire an event bus.
  useEffect(() => {
    const id = setInterval(tick, 600);
    return () => clearInterval(id);
  }, []);

  const mesh = getSelectedMesh();
  const data = listMods();
  const mods = data.mods || [];

  return (
    <div
      data-studio-v3-modstack-panel
      style={{
        position: 'fixed',
        top: 70, right: 14,
        width: PANEL_W,
        maxHeight: 'calc(100vh - 100px)',
        zIndex: 9300,
        background: 'var(--studio-bg-elev, #161b22)',
        border: '1px solid rgba(154,166,178,0.35)',
        borderRadius: 6,
        color: 'var(--studio-ink, #e6edf3)',
        fontFamily: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{
        padding: '8px 12px',
        background: 'rgba(13,17,23,0.6)',
        borderBottom: '1px solid rgba(29,233,182,0.45)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <strong style={{ color: 'var(--studio-accent, #1de9b6)', fontSize: 12, letterSpacing: '0.05em' }}>
          Modifier stack
        </strong>
        <span style={{ opacity: 0.55, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
          {_meshLabel(mesh)} · {data.count} {data.count === 1 ? 'mod' : 'mods'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-modstack-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={iconBtn()}
          title="Close"
        >×</button>
      </div>

      <div style={{
        display: 'flex', gap: 6, padding: '8px 10px',
        borderBottom: '1px solid rgba(154,166,178,0.2)', alignItems: 'center',
      }}>
        <select
          data-studio-v3-modstack-add-kind
          value={pickKind}
          onChange={(e) => setPickKind(e.target.value)}
          style={{ ...selStyle(), flex: 1 }}
        >
          <option value="">Add modifier…</option>
          {SUPPORTED_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <button
          data-studio-v3-modstack-add-go
          disabled={!pickKind}
          onClick={() => {
            if (pickKind) { onAdd(pickKind); setPickKind(''); tick(); }
          }}
          style={primaryBtn()}
        >+ Add</button>
      </div>

      <div style={{
        display: 'flex', gap: 6, padding: '4px 10px 8px',
        borderBottom: '1px solid rgba(154,166,178,0.2)',
      }}>
        <button
          data-studio-v3-modstack-apply-all
          onClick={() => { onApplyAll(); tick(); }}
          style={btnStyle()}
          title="Bake current stack into base + clear stack"
        >Apply all</button>
        <button
          data-studio-v3-modstack-reset
          onClick={() => { onResetToBase(); tick(); }}
          style={btnStyle()}
          title="Restore base geometry, keep stack"
        >Reset</button>
        <button
          data-studio-v3-modstack-clear
          onClick={() => { onClear(); tick(); }}
          style={{ ...btnStyle(), color: '#ff7361' }}
        >Clear</button>
      </div>

      {mods.length === 0 ? (
        <div style={{ padding: 18, fontSize: 11, opacity: 0.55 }}>
          No modifiers yet. Pick a kind above and click + Add. The base
          geometry is preserved — every mod evaluates from the base
          top-to-bottom on every edit.
        </div>
      ) : (
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {mods.map((m, i) => (
            <div
              key={m.uuid}
              data-studio-v3-modstack-row={m.uuid}
              data-studio-v3-modstack-row-kind={m.kind}
              data-studio-v3-modstack-row-index={i}
              draggable
              onDragStart={() => setDragFrom(m.uuid)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom && dragFrom !== m.uuid) {
                  onReorder(dragFrom, i);
                  tick();
                }
                setDragFrom(null);
              }}
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid rgba(154,166,178,0.15)',
                opacity: m.enabled ? 1 : 0.42,
                background: dragFrom === m.uuid ? 'rgba(29,233,182,0.08)' : 'transparent',
                display: 'flex', flexDirection: 'column', gap: 4,
                cursor: 'grab',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <button
                  data-studio-v3-modstack-eye={m.uuid}
                  onClick={() => { onSetEnabled(m.uuid, !m.enabled); tick(); }}
                  title={m.enabled ? 'Disable' : 'Enable'}
                  style={iconBtn()}
                >{m.enabled ? '◉' : '○'}</button>
                <button
                  data-studio-v3-modstack-vp={m.uuid}
                  onClick={() => { onSetViewport(m.uuid, !m.viewport); tick(); }}
                  title={m.viewport ? 'Hide viewport preview' : 'Show viewport preview'}
                  style={iconBtn()}
                >{m.viewport ? '👁' : '⊘'}</button>
                <span style={{ flex: 1, fontWeight: 500, color: 'var(--studio-accent, #1de9b6)' }}>
                  {m.kind}
                </span>
                <span style={{ fontSize: 9, opacity: 0.55, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
                  #{i + 1}
                </span>
                <button
                  data-studio-v3-modstack-del={m.uuid}
                  onClick={() => { onRemove(m.uuid); tick(); }}
                  title="Remove"
                  style={{ ...iconBtn(), color: '#ff7361' }}
                >×</button>
              </div>
              <ParamEditor
                kind={m.kind}
                params={m.params || {}}
                uuid={m.uuid}
                onSetParams={onSetParams}
                tick={tick}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ParamEditor({ kind, params, uuid, onSetParams, tick }) {
  const schema = PARAM_SCHEMA[kind] || [];
  if (schema.length === 0) return null;
  const change = (key, value) => {
    const next = { ...params, [key]: value };
    onSetParams(uuid, next);
    tick();
  };
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: schema.length > 2 ? '1fr 1fr' : '1fr',
      gap: '3px 8px',
      fontSize: 10,
    }}>
      {schema.map((s) => (
        <label
          key={s.key}
          data-studio-v3-modstack-param={`${uuid}:${s.key}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            color: 'rgba(230,237,243,0.78)',
          }}
        >
          <span style={{ width: 38, opacity: 0.75 }}>{s.label}</span>
          {s.kind === 'bool' ? (
            <input
              type="checkbox"
              data-studio-v3-modstack-param-bool={s.key}
              checked={params[s.key] !== undefined ? !!params[s.key] : !!s.def}
              onChange={(e) => change(s.key, e.target.checked)}
              style={{ accentColor: 'var(--studio-accent, #1de9b6)' }}
            />
          ) : s.kind === 'enum' ? (
            <select
              data-studio-v3-modstack-param-enum={s.key}
              value={params[s.key] !== undefined ? params[s.key] : s.def}
              onChange={(e) => change(s.key, e.target.value)}
              style={{ ...selStyle(), flex: 1, fontSize: 10 }}
            >
              {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type="number"
              data-studio-v3-modstack-param-num={s.key}
              value={params[s.key] !== undefined ? params[s.key] : s.def}
              min={s.min}
              max={s.max}
              step={s.step}
              onChange={(e) => {
                const v = s.kind === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                if (Number.isFinite(v)) change(s.key, v);
              }}
              style={{
                background: 'rgba(13,17,23,0.6)', color: 'inherit',
                border: '1px solid rgba(154,166,178,0.35)',
                padding: '1px 4px', borderRadius: 3, fontSize: 10,
                flex: 1, minWidth: 0,
              }}
            />
          )}
        </label>
      ))}
    </div>
  );
}

function btnStyle() {
  return {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
  };
}
function primaryBtn() {
  return {
    background: 'var(--studio-accent, #1de9b6)', color: '#0d1117',
    border: '1px solid rgba(29,233,182,0.55)',
    padding: '3px 10px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
    fontWeight: 600,
  };
}
function selStyle() {
  return {
    background: 'rgba(13,17,23,0.6)', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '2px 4px', borderRadius: 3, fontSize: 11,
  };
}
function iconBtn() {
  return {
    background: 'transparent', color: 'inherit',
    border: 'none', padding: 0, width: 18, height: 18,
    fontSize: 12, cursor: 'pointer', lineHeight: 1,
  };
}
