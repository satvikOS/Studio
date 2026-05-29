import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NODE_TYPES } from './nodeGraphEval.js';

/*
 * Studio Geometry Node Graph — visual editor (Houdini SOP / Blender Geometry
 * Nodes / Grasshopper style). Monotone OLED overlay over the viewport: draggable
 * node cards, SVG wires, click-output-then-input to connect, inline params, and
 * an Evaluate button that hands {nodes,edges} to the parent to drop into the
 * scene. The live graph mirrors to window.__studioNodeGraphState for e2e/Archie.
 */

let _uid = 1;
const newId = (t) => `${t}${_uid++}`;
const NODE_W = 158;
const HEAD_H = 26;
const PORT_DY = 18;

function seed() {
  const a = { id: newId('primitive'), type: 'primitive', x: 40, y: 70, params: { kind: 'cube', size: 1 } };
  const b = { id: newId('subdivide'), type: 'subdivide', x: 250, y: 70, params: { iterations: 1 } };
  const c = { id: newId('bevel'), type: 'bevel', x: 460, y: 70, params: { amount: 0.35 } };
  const o = { id: newId('output'), type: 'output', x: 670, y: 70, params: {} };
  return {
    nodes: [a, b, c, o],
    edges: [
      { from: { node: a.id, port: 'geometry' }, to: { node: b.id, port: 'geometry' } },
      { from: { node: b.id, port: 'geometry' }, to: { node: c.id, port: 'geometry' } },
      { from: { node: c.id, port: 'geometry' }, to: { node: o.id, port: 'geometry' } },
    ],
  };
}

const portY = (node, ports, idx) => node.y + HEAD_H + 8 + idx * PORT_DY + 5;

export default function NodeGraphEditor({
  open, onClose, onEvaluate,
  nodeTypes = NODE_TYPES,
  title = 'Geometry Nodes',
  subtitle = 'Houdini SOP / Blender Geometry Nodes / Grasshopper',
  seedGraph,
  mirrorKey = '__studioNodeGraphState',
  kind = 'geometry',
}) {
  const [{ nodes, edges }, setGraph] = useState(() => (seedGraph ? seedGraph() : seed()));
  const [pendingFrom, setPendingFrom] = useState(null); // { node, port }
  const [status, setStatus] = useState('');
  const dragRef = useRef(null);

  // Mirror the live graph for e2e + Archie introspection / programmatic eval.
  useEffect(() => {
    window[mirrorKey] = { nodes, edges };
    return () => { try { delete window[mirrorKey]; } catch (_) { /* */ } };
  }, [nodes, edges, mirrorKey]);

  const addNode = useCallback((type) => {
    const t = nodeTypes[type];
    const params = {};
    (t.params || []).forEach((p) => { params[p.key] = p.default; });
    setGraph((g) => ({ ...g, nodes: [...g.nodes, { id: newId(type), type, x: 60 + (g.nodes.length % 5) * 40, y: 280 + (g.nodes.length % 4) * 30, params }] }));
  }, [nodeTypes]);

  const removeNode = useCallback((id) => {
    setGraph((g) => ({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from.node !== id && e.to.node !== id) }));
  }, []);

  const setParam = useCallback((id, key, value) => {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === id ? { ...n, params: { ...n.params, [key]: value } } : n) }));
  }, []);

  const onPortClick = useCallback((node, port, isOutput) => {
    if (isOutput) { setPendingFrom({ node: node.id, port }); setStatus(`from ${node.type}.${port} — click an input`); return; }
    if (pendingFrom) {
      setGraph((g) => {
        const edges2 = g.edges.filter((e) => !(e.to.node === node.id && e.to.port === port)); // one wire per input
        edges2.push({ from: pendingFrom, to: { node: node.id, port } });
        return { ...g, edges: edges2 };
      });
      setPendingFrom(null); setStatus('connected');
    }
  }, [pendingFrom]);

  // node drag
  const onHeadDown = (node, e) => {
    e.preventDefault();
    dragRef.current = { id: node.id, ox: e.clientX - node.x, oy: e.clientY - node.y };
  };
  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current; if (!d) return;
      setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === d.id ? { ...n, x: Math.max(0, e.clientX - d.ox), y: Math.max(40, e.clientY - d.oy) } : n) }));
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const evaluate = () => {
    const r = onEvaluate ? onEvaluate({ nodes, edges }) : null;
    if (r && r.error) setStatus(`error: ${r.error}`);
    else if (r && r.message) setStatus(r.message);
    else if (r) setStatus(`evaluated -> ${r.vertices} verts to scene`);
  };

  if (!open) return null;

  const nodeById = (id) => nodes.find((n) => n.id === id);
  const wirePath = (e) => {
    const fn = nodeById(e.from.node), tn = nodeById(e.to.node);
    if (!fn || !tn) return null;
    const ft = nodeTypes[fn.type], tt = nodeTypes[tn.type];
    const fIdx = (ft.outputs || []).indexOf(e.from.port);
    const tIdx = (tt.inputs || []).indexOf(e.to.port);
    const x1 = fn.x + NODE_W, y1 = portY(fn, ft.outputs, fIdx < 0 ? 0 : fIdx);
    const x2 = tn.x, y2 = portY(tn, tt.inputs, tIdx < 0 ? 0 : tIdx);
    const dx = Math.max(30, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div data-studio-nodegraph={kind} style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.92)', color: '#dcdcdc', fontSize: 12, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#0c0c0c', borderBottom: '1px solid #222' }}>
        <strong style={{ letterSpacing: 0.5 }}>{title}</strong>
        <span style={{ opacity: 0.5 }}>{subtitle}</span>
        <div style={{ flex: 1 }} />
        <button data-studio-nodegraph-action="evaluate" onClick={evaluate} style={btn(true)}>Evaluate → Scene</button>
        <button data-studio-nodegraph-action="clear" onClick={() => setGraph({ nodes: [], edges: [] })} style={btn()}>Clear</button>
        <button data-studio-nodegraph-action="close" onClick={onClose} style={btn()}>Close</button>
      </div>
      {/* palette */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '5px 10px', background: '#0a0a0a', borderBottom: '1px solid #1c1c1c' }}>
        <span style={{ opacity: 0.5, alignSelf: 'center' }}>Add:</span>
        {Object.keys(nodeTypes).map((t) => (
          <button key={t} data-studio-nodegraph-add={t} onClick={() => addNode(t)} style={btn()}>{nodeTypes[t].label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.55, alignSelf: 'center' }} data-studio-nodegraph-status>{status}</span>
      </div>
      {/* canvas */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }} data-studio-nodegraph-canvas onClick={(e) => { if (e.target === e.currentTarget) setPendingFrom(null); }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {edges.map((e, i) => { const d = wirePath(e); return d ? <path key={i} d={d} fill="none" stroke="#6a6a6a" strokeWidth="1.6" /> : null; })}
        </svg>
        {nodes.map((node) => {
          const t = nodeTypes[node.type];
          if (!t) return null;
          return (
            <div key={node.id} data-studio-nodegraph-node={node.type} style={{ position: 'absolute', left: node.x, top: node.y, width: NODE_W, background: '#161616', border: '1px solid #2a2a2a', borderRadius: 4 }}>
              <div onPointerDown={(e) => onHeadDown(node, e)} style={{ height: HEAD_H, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', background: '#1f1f1f', borderBottom: '1px solid #2a2a2a', cursor: 'move', borderRadius: '4px 4px 0 0' }}>
                <span>{t.label}</span>
                {node.type !== 'output' && <span onClick={() => removeNode(node.id)} style={{ cursor: 'pointer', opacity: 0.5 }}>×</span>}
              </div>
              <div style={{ padding: '6px 6px 8px' }}>
                {/* input ports */}
                {(t.inputs || []).map((p) => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 5, height: PORT_DY }}>
                    <span data-studio-nodegraph-inport={`${node.id}:${p}`} onClick={() => onPortClick(node, p, false)} style={dot('#4a4a4a')} />
                    <span style={{ opacity: 0.7 }}>{p}</span>
                  </div>
                ))}
                {/* params */}
                {(t.params || []).map((pr) => (
                  <div key={pr.key} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                    <span style={{ opacity: 0.55, width: 56, fontSize: 11 }}>{pr.key}</span>
                    {pr.type === 'enum'
                      ? <select data-studio-nodegraph-param={`${node.id}:${pr.key}`} value={node.params[pr.key]} onChange={(e) => setParam(node.id, pr.key, e.target.value)} style={inp}>{pr.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      : pr.type === 'color'
                        ? <input data-studio-nodegraph-param={`${node.id}:${pr.key}`} type="color" value={node.params[pr.key]} onChange={(e) => setParam(node.id, pr.key, e.target.value)} style={{ ...inp, width: 64, height: 18, padding: 0 }} />
                        : <input data-studio-nodegraph-param={`${node.id}:${pr.key}`} type="number" step="0.1" value={node.params[pr.key]} onChange={(e) => setParam(node.id, pr.key, parseFloat(e.target.value))} style={inp} />}
                  </div>
                ))}
                {/* output ports */}
                {(t.outputs || []).map((p) => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, height: PORT_DY }}>
                    <span style={{ opacity: 0.7 }}>{p}</span>
                    <span data-studio-nodegraph-outport={`${node.id}:${p}`} onClick={() => onPortClick(node, p, true)} style={dot(pendingFrom && pendingFrom.node === node.id ? '#cfcfcf' : '#6a6a6a')} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const btn = (primary) => ({ background: primary ? '#2a2a2a' : '#161616', color: '#dcdcdc', border: '1px solid #333', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer' });
const inp = { background: '#0c0c0c', color: '#dcdcdc', border: '1px solid #2a2a2a', borderRadius: 2, fontSize: 11, width: 64, padding: '1px 3px' };
const dot = (c) => ({ width: 9, height: 9, borderRadius: '50%', background: c, border: '1px solid #000', cursor: 'pointer', display: 'inline-block' });
