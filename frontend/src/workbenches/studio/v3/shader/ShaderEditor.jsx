// ArchDisc Studio V3 — minimal canvas-based shader graph editor.
//
// Rendered into a host <div data-studio-v3-shader-editor> attached
// directly to <body>, so we don't have to modify StudioShellV3 to mount
// it inside the React tree. The wrapper component below owns its own
// open/close state and listens for window events:
//   • studio-shader-editor-toggle / open / close
//
// Nodes are draggable rectangles on an SVG canvas. Wires are drawn as
// quadratic beziers between socket centres. The right-hand props panel
// edits the selected node's `params` live; a change triggers a re-bake
// + apply if the user clicks Apply.

import React, { useEffect, useRef, useState } from 'react';
import { NODE_KINDS, listKinds } from './nodes.js';

const NODE_W = 170;
const NODE_H_BASE = 56;
const ROW_H = 18;

function nodeHeight(def) {
  const slots = Math.max(def.inputs.length, def.outputs.length);
  return NODE_H_BASE + slots * ROW_H;
}

function socketXY(node, def, kind, idx) {
  const h = nodeHeight(def);
  const headerY = node.y + 28;
  const x = kind === 'output' ? node.x + NODE_W : node.x;
  const y = headerY + idx * ROW_H + 6;
  return { x, y };
}

function wirePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export default function ShaderEditor({ getGraph, evalAndApply, evalOnly, onCloseRequest }) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const svgRef = useRef(null);
  const dragRef = useRef(null);   // { kind:'node', id, ox, oy } | { kind:'wire', srcId, srcOut, x, y }
  const [selectedId, setSelectedId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const graph = getGraph();

  // Auto-bake preview when graph changes (debounced).
  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        const r = evalOnly();
        if (r && r.dataUrl) setPreviewUrl(r.dataUrl);
      } catch (_) { /* ignore */ }
    }, 250);
    return () => clearTimeout(handle);
  });

  const handleMouseMove = (e) => {
    if (!dragRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const d = dragRef.current;
    if (d.kind === 'node') {
      const node = graph.nodes.get(d.id);
      if (node) { node.x = x - d.ox; node.y = y - d.oy; tick(); }
    } else if (d.kind === 'wire') {
      d.x = x; d.y = y; tick();
    }
  };

  const handleMouseUp = (e) => {
    const d = dragRef.current;
    if (d && d.kind === 'wire') {
      // Hit-test an input socket on any node.
      const rect = svgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (const n of graph.nodes.values()) {
        const def = NODE_KINDS[n.kind];
        for (let i = 0; i < def.inputs.length; i++) {
          const p = socketXY(n, def, 'input', i);
          if (Math.hypot(p.x - x, p.y - y) < 9 && n.id !== d.srcId) {
            // Connect via the graph helper exposed on window so disconnect/cycle checks run.
            if (window.__studioShaderNodeConnect) {
              window.__studioShaderNodeConnect(d.srcId, d.srcOut, n.id, def.inputs[i].name);
            }
            break;
          }
        }
      }
    }
    dragRef.current = null;
    tick();
  };

  const startNodeDrag = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragRef.current = { kind: 'node', id: node.id, ox: x - node.x, oy: y - node.y };
    setSelectedId(node.id);
  };

  const startWireDrag = (e, node, outName) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragRef.current = { kind: 'wire', srcId: node.id, srcOut: outName, x, y };
  };

  const addKind = (kind) => {
    if (window.__studioShaderNodeAdd) {
      const r = window.__studioShaderNodeAdd(kind, {});
      if (r && r.uuid) setSelectedId(r.uuid);
      tick();
    }
  };

  const removeSelected = () => {
    if (!selectedId) return;
    if (window.__studioShaderNodeRemove) window.__studioShaderNodeRemove(selectedId);
    setSelectedId(null);
    tick();
  };

  const apply = () => {
    try {
      const r = evalAndApply();
      if (r && r.dataUrl) setPreviewUrl(r.dataUrl);
    } catch (_) { /* ignore */ }
  };

  const selected = selectedId ? graph.nodes.get(selectedId) : null;
  const selectedDef = selected ? NODE_KINDS[selected.kind] : null;

  const setParam = (key, value) => {
    if (!selected) return;
    selected.params = { ...selected.params, [key]: value };
    tick();
  };

  return (
    <div
      data-studio-v3-shader-editor
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        position: 'fixed', inset: 0, zIndex: 9300,
        background: 'rgba(13,17,23,0.78)',
        display: 'flex', flexDirection: 'column',
        color: 'var(--studio-ink, #e6edf3)', fontFamily: 'inherit',
      }}
    >
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px',
        background: 'var(--studio-bg-elev, #161b22)',
        borderBottom: '1px solid var(--studio-accent, #1de9b6)',
      }}>
        <strong style={{ color: 'var(--studio-accent, #1de9b6)', fontSize: 13, letterSpacing: '0.04em' }}>
          Shader graph
        </strong>
        <span style={{ opacity: 0.55, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
          {graph.nodes.size} nodes · {graph.wires.length} wires
        </span>
        <div style={{ flex: 1 }} />
        {listKinds().map((k) => (
          <button
            key={k}
            data-studio-v3-shader-add={k}
            onClick={() => addKind(k)}
            style={{
              background: 'transparent', color: 'inherit',
              border: '1px solid rgba(154,166,178,0.35)',
              padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            }}
          >+ {NODE_KINDS[k].title}</button>
        ))}
        <button
          data-studio-v3-shader-apply
          onClick={apply}
          style={{
            background: 'var(--studio-accent, #1de9b6)', color: '#0d1117',
            border: 'none', padding: '4px 12px', borderRadius: 4,
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >Apply</button>
        <button
          data-studio-v3-shader-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={{
            background: 'transparent', color: 'inherit',
            border: '1px solid rgba(154,166,178,0.35)',
            padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
          }}
        >Close (Esc)</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Graph canvas */}
        <svg
          ref={svgRef}
          data-studio-v3-shader-svg
          style={{ flex: 1, background: 'rgba(13,17,23,0.4)' }}
          onClick={() => setSelectedId(null)}
        >
          {/* Wires */}
          {graph.wires.map((w, i) => {
            const src = graph.nodes.get(w.srcId);
            const dst = graph.nodes.get(w.dstId);
            if (!src || !dst) return null;
            const srcDef = NODE_KINDS[src.kind];
            const dstDef = NODE_KINDS[dst.kind];
            const oIdx = srcDef.outputs.findIndex((o) => o.name === w.srcOut);
            const iIdx = dstDef.inputs.findIndex((o) => o.name === w.dstIn);
            const a = socketXY(src, srcDef, 'output', oIdx);
            const b = socketXY(dst, dstDef, 'input', iIdx);
            return (
              <path
                key={i}
                data-studio-v3-shader-wire={`${w.srcId}:${w.srcOut}->${w.dstId}:${w.dstIn}`}
                d={wirePath(a, b)}
                stroke="rgba(255, 255, 255, 0.55)" strokeWidth="1.4" fill="none"
              />
            );
          })}
          {/* Drag-wire preview */}
          {dragRef.current && dragRef.current.kind === 'wire' && (() => {
            const src = graph.nodes.get(dragRef.current.srcId);
            if (!src) return null;
            const srcDef = NODE_KINDS[src.kind];
            const oIdx = srcDef.outputs.findIndex((o) => o.name === dragRef.current.srcOut);
            const a = socketXY(src, srcDef, 'output', oIdx);
            return (
              <path
                d={wirePath(a, { x: dragRef.current.x, y: dragRef.current.y })}
                stroke="rgba(255, 255, 255, 0.8)" strokeWidth="1.4" fill="none" strokeDasharray="4 3"
              />
            );
          })()}
          {/* Nodes */}
          {Array.from(graph.nodes.values()).map((n) => {
            const def = NODE_KINDS[n.kind];
            const h = nodeHeight(def);
            const isSel = n.id === selectedId;
            return (
              <g
                key={n.id}
                data-studio-v3-shader-node={n.id}
                data-studio-v3-shader-node-kind={n.kind}
                onClick={(e) => { e.stopPropagation(); setSelectedId(n.id); }}
                onMouseDown={(e) => startNodeDrag(e, n)}
              >
                <rect
                  x={n.x} y={n.y} width={NODE_W} height={h} rx={5}
                  fill="rgba(22,27,34,0.92)"
                  stroke={isSel ? 'var(--studio-accent, #1de9b6)' : 'rgba(154,166,178,0.55)'}
                  strokeWidth={isSel ? 1.4 : 0.8}
                />
                <text
                  x={n.x + 8} y={n.y + 18}
                  fill="var(--studio-accent, #1de9b6)" fontSize="12" fontWeight="600"
                  style={{ pointerEvents: 'none' }}
                >{def.title}</text>
                {/* Input sockets */}
                {def.inputs.map((slot, i) => {
                  const p = socketXY(n, def, 'input', i);
                  return (
                    <g key={`in-${slot.name}`} data-studio-v3-shader-sock-in={slot.name}>
                      <circle cx={p.x} cy={p.y} r={5} fill="rgba(13,17,23,0.95)" stroke="rgba(154,166,178,0.7)" />
                      <text x={p.x + 8} y={p.y + 3} fill="rgba(230,237,243,0.75)" fontSize="10" style={{ pointerEvents: 'none' }}>
                        {slot.name}
                      </text>
                    </g>
                  );
                })}
                {/* Output sockets */}
                {def.outputs.map((slot, i) => {
                  const p = socketXY(n, def, 'output', i);
                  return (
                    <g
                      key={`out-${slot.name}`}
                      data-studio-v3-shader-sock-out={slot.name}
                      onMouseDown={(e) => startWireDrag(e, n, slot.name)}
                      style={{ cursor: 'crosshair' }}
                    >
                      <circle cx={p.x} cy={p.y} r={5} fill="var(--studio-accent, #1de9b6)" />
                      <text x={p.x - 8} y={p.y + 3} fill="rgba(230,237,243,0.75)" fontSize="10" textAnchor="end" style={{ pointerEvents: 'none' }}>
                        {slot.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Props panel */}
        <div
          data-studio-v3-shader-props
          style={{
            width: 260, padding: 14,
            borderLeft: '1px solid rgba(154,166,178,0.3)',
            background: 'var(--studio-bg-elev, #161b22)',
            overflowY: 'auto',
          }}
        >
          {selected && selectedDef ? (
            <div>
              <div style={{
                color: 'var(--studio-accent, #1de9b6)', fontSize: 12,
                fontWeight: 600, marginBottom: 10, letterSpacing: '0.04em',
              }}>{selectedDef.title} props</div>
              {Object.entries(selected.params).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 8, fontSize: 11 }}>
                  <label style={{ display: 'block', opacity: 0.6, marginBottom: 2 }}>{key}</label>
                  {typeof value === 'number' ? (
                    <input
                      data-studio-v3-shader-param={key}
                      type="number"
                      step="0.01"
                      value={value}
                      onChange={(e) => setParam(key, +e.target.value)}
                      style={{
                        width: '100%', padding: 3,
                        background: 'rgba(13,17,23,0.6)', color: 'inherit',
                        border: '1px solid rgba(154,166,178,0.3)', borderRadius: 3,
                      }}
                    />
                  ) : Array.isArray(value) && value.length === 3 && typeof value[0] === 'number' ? (
                    <input
                      data-studio-v3-shader-param={key}
                      type="color"
                      value={`#${[0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(value[i] * 255))).toString(16).padStart(2, '0')).join('')}`}
                      onChange={(e) => {
                        const hex = e.target.value.replace('#', '');
                        const r = parseInt(hex.slice(0, 2), 16) / 255;
                        const g = parseInt(hex.slice(2, 4), 16) / 255;
                        const b = parseInt(hex.slice(4, 6), 16) / 255;
                        setParam(key, [r, g, b]);
                      }}
                      style={{ width: '100%', height: 26, background: 'transparent', border: 'none' }}
                    />
                  ) : typeof value === 'string' ? (
                    <input
                      data-studio-v3-shader-param={key}
                      value={value}
                      onChange={(e) => setParam(key, e.target.value)}
                      style={{
                        width: '100%', padding: 3,
                        background: 'rgba(13,17,23,0.6)', color: 'inherit',
                        border: '1px solid rgba(154,166,178,0.3)', borderRadius: 3,
                      }}
                    />
                  ) : (
                    <div style={{ opacity: 0.5 }}>{JSON.stringify(value).slice(0, 40)}</div>
                  )}
                </div>
              ))}
              <button
                data-studio-v3-shader-remove
                onClick={removeSelected}
                style={{
                  marginTop: 10, padding: '4px 10px',
                  background: 'rgba(229,57,53,0.18)', color: '#ff7361',
                  border: '1px solid rgba(229,57,53,0.45)', borderRadius: 4,
                  fontSize: 11, cursor: 'pointer',
                }}
              >Remove node</button>
            </div>
          ) : (
            <div style={{ opacity: 0.55, fontSize: 11 }}>
              Select a node to edit its parameters.
              <br /><br />
              Drag from an output socket onto an input socket to connect.
            </div>
          )}

          {previewUrl ? (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Bake preview</div>
              <img
                data-studio-v3-shader-preview
                src={previewUrl} alt="bake"
                style={{ width: '100%', imageRendering: 'pixelated', border: '1px solid rgba(154,166,178,0.3)', borderRadius: 4 }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
