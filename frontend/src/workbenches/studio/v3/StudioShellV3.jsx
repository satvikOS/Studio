import React, { useState, useEffect, useRef } from 'react';
import './tokens.css';
import { StudioMark, StudioWordmark } from './StudioLogo';
import { Icon } from './Icons';
import { spawnPrimitive } from './spawn';
import Viewport3D from '../../../components/Viewport3D';
import { registerV3Api, unregisterV3Api } from './api';
import { registerEditOps, unregisterEditOps } from './editops';
import { registerCameraOps, unregisterCameraOps } from './cameraops';
import { registerModOps, unregisterModOps } from './modops';
import { registerLightingOps, unregisterLightingOps } from './lightingops';
import { registerAnimPhysOps, unregisterAnimPhysOps } from './animphysops';
import { registerPaintOps, unregisterPaintOps } from './paintops';
import { registerSurfOps, unregisterSurfOps } from './surfops';
import { registerAudioXROps, unregisterAudioXROps } from './audioxrops';
import { registerTerrainVoxOps, unregisterTerrainVoxOps } from './terrainvoxops';
import { registerRemeshOps, unregisterRemeshOps } from './remeshops';
import { registerScriptOps, unregisterScriptOps } from './scriptops';
import { registerMographOps, unregisterMographOps } from './mographops';
import { registerIOOps, unregisterIOOps } from './ioops';

// Slice 401 — V3 stops using V2. V3 owns its own Viewport3D mount + its
// own spawn / selection / undo / file-io implementations (built up in
// subsequent slices). The 206-strong V2 API surface gets ported into
// v3-native modules one batch at a time.

// ArchDisc Studio V3 — application shell.
//
// Mirrors the proven 7-zone CSS-grid architecture from Forge v4:
//   topbar · qat · wb-rail · toolbar · viewport · right · statusbar · cmdbar
//
// Why this layout: every zone has a fixed role and never overlaps another.
// The same shell holds every discipline — the workbench rail picks the
// active discipline, the toolbar swaps out per discipline, the right
// panel cycles through Inspector / Outliner / Layers per discipline.
// The always-on Archie command bar at the bottom is Studio's primary
// natural-language entry point and follows the user across every tool.
//
// Mounted behind ?v3=1 / localStorage.studioV3 — V2 stays default during
// the rollout so the 50+ e2e specs targeting V2 attrs keep passing.

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

const STORE = 'studio.v3';
const lstor = {
  get: (k, d) => {
    if (typeof localStorage === 'undefined') return d;
    try { const r = localStorage.getItem(`${STORE}.${k}`); return r ? JSON.parse(r) : d; }
    catch { return d; }
  },
  set: (k, v) => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(`${STORE}.${k}`, JSON.stringify(v)); } catch {}
  },
};

// ─── DISCIPLINES ─────────────────────────────────────────────────────────
// 15 Studio disciplines. Each entry maps to a workbench rail tab + a
// distinct toolbar group set + a right-panel content set. icons come
// from Icons.jsx (disc-* custom marks, no library).
const DISCIPLINES = [
  { id: 'model',  label: 'Model',   icon: 'disc-model'  },
  { id: 'sculpt', label: 'Sculpt',  icon: 'disc-sculpt' },
  { id: 'paint',  label: 'Paint',   icon: 'disc-paint'  },
  { id: 'shade',  label: 'Shade',   icon: 'disc-shade'  },
  { id: 'anim',   label: 'Anim',    icon: 'disc-anim'   },
  { id: 'rig',    label: 'Rig',     icon: 'disc-rig'    },
  { id: 'render', label: 'Render',  icon: 'disc-render' },
  { id: 'fx',     label: 'FX',      icon: 'disc-fx'     },
  { id: 'world',  label: 'World',   icon: 'disc-world'  },
  { id: 'nurbs',  label: 'NURBS',   icon: 'disc-nurbs'  },
  { id: 'phys',   label: 'Physics', icon: 'disc-phys'   },
  { id: 'audio',  label: 'Audio',   icon: 'disc-audio'  },
  { id: 'xr',     label: 'XR',      icon: 'disc-xr'     },
  { id: 'script', label: 'Script',  icon: 'disc-script' },
  { id: 'archie', label: 'Archie',  icon: 'disc-archie' },
];

// Toolbar groups per discipline. Each group is a labelled cluster of
// tools; tool ids map into Icons.jsx names so the glyph stays crisp.
const TOOLBAR = {
  model: [
    { label: 'Add',       tools: ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'icosahedron', 'text', 'curve', 'empty'] },
    { label: 'Transform', tools: ['select', 'move', 'rotate', 'scale'] },
    { label: 'Mesh',      tools: ['extrude', 'inset', 'subdivide', 'bevel', 'mirror'] },
    { label: 'View',      tools: ['eye', 'camera', 'light', 'material'] },
  ],
  sculpt: [
    { label: 'Brush',     tools: ['select', 'move', 'scale'] },
    { label: 'Smooth',    tools: ['subdivide', 'mirror'] },
    { label: 'View',      tools: ['eye', 'material'] },
  ],
  paint: [
    { label: 'Brush',     tools: ['select', 'move'] },
    { label: 'Layers',    tools: ['extrude', 'inset'] },
    { label: 'View',      tools: ['eye', 'material'] },
  ],
  shade: [
    { label: 'Materials', tools: ['material', 'eye'] },
    { label: 'Topology',  tools: ['cube', 'sphere'] },
  ],
  anim: [
    { label: 'Playback',  tools: ['play', 'pause'] },
    { label: 'Keys',      tools: ['extrude', 'inset'] },
    { label: 'View',      tools: ['eye', 'camera'] },
  ],
  rig: [
    { label: 'Bones',     tools: ['move', 'rotate'] },
    { label: 'Constraints', tools: ['mirror', 'extrude'] },
  ],
  render: [
    { label: 'Capture',   tools: ['camera', 'eye'] },
    { label: 'Light',     tools: ['light', 'material'] },
    { label: 'Output',    tools: ['settings'] },
  ],
  fx: [
    { label: 'Emitters',  tools: ['cube', 'sphere'] },
    { label: 'Forces',    tools: ['move', 'rotate'] },
  ],
  world: [
    { label: 'Terrain',   tools: ['plane', 'subdivide'] },
    { label: 'Light',     tools: ['light', 'material'] },
  ],
  nurbs: [
    { label: 'Curves',    tools: ['curve', 'cylinder'] },
    { label: 'Surfaces',  tools: ['extrude', 'subdivide'] },
  ],
  phys: [
    { label: 'Bodies',    tools: ['cube', 'sphere'] },
    { label: 'Sim',       tools: ['play', 'pause'] },
  ],
  audio: [
    { label: 'Source',    tools: ['cube'] },
    { label: 'Mix',       tools: ['play', 'pause'] },
  ],
  xr: [
    { label: 'Stage',     tools: ['cube', 'plane'] },
    { label: 'Hands',     tools: ['select', 'move'] },
  ],
  script: [
    { label: 'Run',       tools: ['play'] },
    { label: 'Debug',     tools: ['eye'] },
  ],
  archie: [
    { label: 'Thread',    tools: ['eye'] },
    { label: 'Tools',     tools: ['settings'] },
  ],
};

const EDIT_MODES = [
  { id: 'object', label: 'Object', icon: 'object-mode' },
  { id: 'vertex', label: 'Vertex', icon: 'vertex-mode' },
  { id: 'edge',   label: 'Edge',   icon: 'edge-mode'   },
  { id: 'face',   label: 'Face',   icon: 'face-mode'   },
  { id: 'sculpt', label: 'Sculpt', icon: 'sculpt-mode' },
];

const AXES = [
  { id: 'top',   label: 'T' },
  { id: 'front', label: 'F' },
  { id: 'side',  label: 'S' },
  { id: 'persp', label: 'P' },
];

// ─── TopBar ───────────────────────────────────────────────────────────────
function TopBar({ onCycleTheme, theme }) {
  return (
    <div className="studio-topbar" data-studio-v3-topbar>
      <div className="studio-topbar-brand">
        <StudioMark size={18} ink="var(--studio-ink)" />
        <StudioWordmark size={12} color="var(--studio-ink)" />
      </div>
      <div className="studio-topbar-menus">
        {['File', 'Edit', 'Select', 'View', 'Window', 'Help'].map((m) => (
          <button
            key={m}
            type="button"
            className="studio-topbar-menu"
            data-studio-v3-menu={m.toLowerCase()}
          >{m}</button>
        ))}
      </div>
      <div className="studio-topbar-spacer" />
      <button
        type="button"
        className="studio-topbar-menu"
        data-studio-v3-theme-toggle
        onClick={onCycleTheme}
        title="Toggle theme (Cmd+T)"
      >{theme === 'dark' ? 'Dark' : 'Light'}</button>
    </div>
  );
}

// ─── QuickAccessBar ───────────────────────────────────────────────────────
function QuickAccessBar({ onAction }) {
  const items = [
    { id: 'new',      icon: 'empty',    label: 'New' },
    { id: 'open',     icon: 'tshelf',   label: 'Open' },
    { id: 'save',     icon: 'check',    label: 'Save' },
    null,
    { id: 'undo',     icon: 'undo',     label: 'Undo' },
    { id: 'redo',     icon: 'redo',     label: 'Redo' },
    null,
    { id: 'play',     icon: 'play',     label: 'Play' },
    { id: 'pause',    icon: 'pause',    label: 'Pause' },
    null,
    { id: 'settings', icon: 'settings', label: 'Settings' },
  ];
  return (
    <div className="studio-qat" data-studio-v3-qat>
      {items.map((it, i) => it ? (
        <button
          key={it.id}
          type="button"
          className="studio-qat-btn"
          data-studio-v3-qat-btn={it.id}
          title={it.label}
          onClick={() => onAction && onAction(it.id)}
        ><Icon name={it.icon} size={13} /></button>
      ) : (
        <span key={`s-${i}`} className="studio-qat-sep" />
      ))}
    </div>
  );
}

// ─── WorkbenchRail (left, 15 disciplines) ────────────────────────────────
function WorkbenchRail({ activeId, onSwitch }) {
  return (
    <div className="studio-wb-rail" data-studio-v3-wb-rail>
      {DISCIPLINES.map((d) => (
        <button
          key={d.id}
          type="button"
          className="studio-wb-tab"
          data-studio-v3-wb={d.id}
          data-active={d.id === activeId ? 'true' : 'false'}
          title={d.label}
          onClick={() => onSwitch(d.id)}
        >
          <span className="studio-wb-tab-glyph"><Icon name={d.icon} size={22} /></span>
          <span className="studio-wb-tab-label">{d.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Toolbar (per-discipline) ─────────────────────────────────────────────
// Primitive tools (cube/sphere/etc) spawn instantly on click; transform
// tools toggle into the active-tool slot; mesh ops run on the current
// selection; view tools are deferred to slice 396+. The discriminator is
// the GROUP label — Add groups always spawn, Transform groups always
// toggle. Keeps the click semantics predictable per discipline.
const PRIMITIVE_KINDS = new Set([
  'cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus',
  'icosahedron', 'text', 'curve', 'empty',
]);
const TRANSFORM_TOOLS = new Set(['select', 'move', 'rotate', 'scale']);

function Toolbar({ wbId, activeTool, setTool, onInvoke }) {
  const groups = TOOLBAR[wbId] || TOOLBAR.model;
  return (
    <div className="studio-toolbar" data-studio-v3-toolbar>
      {groups.map((g, i) => (
        <div key={`${g.label}-${i}`} className="studio-toolbar-group" data-studio-v3-toolbar-group={g.label.toLowerCase()}>
          <span className="studio-toolbar-group-label">{g.label}</span>
          {g.tools.map((t) => {
            const isTransform = g.label === 'Transform' || TRANSFORM_TOOLS.has(t);
            const active = isTransform && t === activeTool;
            return (
              <button
                key={t}
                type="button"
                className="studio-tool"
                data-studio-v3-tool={t}
                data-studio-v3-tool-group={g.label.toLowerCase()}
                data-active={active ? 'true' : 'false'}
                title={t}
                onClick={() => {
                  if (isTransform) setTool(t);
                  else onInvoke && onInvoke(t, g.label.toLowerCase());
                }}
              ><Icon name={t} size={16} /></button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Viewport HUD (edit-mode chips + axis chips) ─────────────────────────
function ViewportHUD({ editMode, setEditMode, axis, setAxis }) {
  return (
    <>
      <div className="studio-vp-hud" data-studio-v3-vp-hud>
        {EDIT_MODES.map((em, i) => (
          <React.Fragment key={em.id}>
            <button
              type="button"
              className="studio-vp-hud-btn"
              data-studio-v3-edit-mode={em.id}
              data-active={em.id === editMode ? 'true' : 'false'}
              title={em.label}
              onClick={() => setEditMode(em.id)}
            >
              <Icon name={em.icon} size={11} />
              <span>{em.label}</span>
            </button>
            {i === 0 && <span className="studio-vp-hud-sep" />}
          </React.Fragment>
        ))}
      </div>
      <div className="studio-vp-axes" data-studio-v3-vp-axes>
        {AXES.map((ax) => (
          <button
            key={ax.id}
            type="button"
            className="studio-vp-axis"
            data-studio-v3-axis={ax.id}
            data-active={ax.id === axis ? 'true' : 'false'}
            title={`View · ${ax.id}`}
            onClick={() => setAxis(ax.id)}
          >{ax.label}</button>
        ))}
      </div>
    </>
  );
}

// ─── RightPanel (Inspector / Outliner / Layers) ──────────────────────────
function RightPanel({ collapsed, onToggle, activeWb, editMode, selection }) {
  const [tab, setTab] = useState('inspector');
  if (collapsed) {
    return (
      <aside className="studio-right" data-studio-v3-right data-collapsed="true">
        <div className="studio-right-collapsed">
          <button
            type="button"
            className="studio-right-collapsed-btn"
            data-studio-v3-right-expand
            onClick={onToggle}
            title="Expand inspector"
          ><Icon name="npanel" size={14} /></button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="studio-right" data-studio-v3-right data-collapsed="false">
      <div className="studio-right-tabs" data-studio-v3-right-tabs>
        {['inspector', 'outliner', 'layers'].map((t) => (
          <button
            key={t}
            type="button"
            className="studio-right-tab"
            data-studio-v3-right-tab={t}
            data-active={t === tab ? 'true' : 'false'}
            onClick={() => setTab(t)}
          >{t}</button>
        ))}
        <button
          type="button"
          className="studio-right-tab"
          data-studio-v3-right-collapse
          title="Collapse"
          onClick={onToggle}
          style={{ flex: '0 0 32px' }}
        ><Icon name="close" size={11} /></button>
      </div>
      <div className="studio-right-body" data-studio-v3-right-body={tab}>
        {tab === 'inspector' && (
          <>
            <div className="studio-right-section">
              <div className="studio-right-section-title">Active</div>
              <div className="studio-right-row"><span>Discipline</span><strong style={{ textTransform: 'capitalize' }}>{activeWb}</strong></div>
              <div className="studio-right-row"><span>Mode</span><strong style={{ textTransform: 'capitalize' }}>{editMode}</strong></div>
            </div>
            {selection && (
              <div className="studio-right-section" data-studio-v3-inspector-selection>
                <div className="studio-right-section-title">Selected · {selection.type || 'object'}</div>
                {selection.name && (
                  <div className="studio-right-row"><span>Name</span><strong>{selection.name}</strong></div>
                )}
                {selection.position && (
                  <>
                    <div className="studio-right-row"><span>X</span><strong style={{ fontFamily: 'var(--studio-mono)' }}>{selection.position.x}</strong></div>
                    <div className="studio-right-row"><span>Y</span><strong style={{ fontFamily: 'var(--studio-mono)' }}>{selection.position.y}</strong></div>
                    <div className="studio-right-row"><span>Z</span><strong style={{ fontFamily: 'var(--studio-mono)' }}>{selection.position.z}</strong></div>
                  </>
                )}
              </div>
            )}
            <div className="studio-right-section">
              <div className="studio-right-section-title">Edit selection</div>
              <SelectionRows />
            </div>
          </>
        )}
        {tab === 'outliner' && <OutlinerRows />}
        {tab === 'layers' && (
          <div className="studio-right-section">
            <div className="studio-right-section-title">Layers</div>
            <div className="studio-right-row" style={{ color: 'var(--studio-ink-mute)', fontStyle: 'italic' }}>
              Layer manager lands in slice 395+.
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function SelectionRows() {
  const [s, setS] = useState({ vertices: 0, edges: 0, faces: 0 });
  useEffect(() => {
    const read = () => {
      if (window.__studioGetEditSelection) {
        const sel = window.__studioGetEditSelection();
        setS({ vertices: sel.vertices.length, edges: sel.edges.length, faces: sel.faces.length });
      }
    };
    const id = setInterval(read, 400);
    read();
    return () => clearInterval(id);
  }, []);
  return (
    <>
      <div className="studio-right-row"><span>Vertices</span><strong>{s.vertices}</strong></div>
      <div className="studio-right-row"><span>Edges</span><strong>{s.edges}</strong></div>
      <div className="studio-right-row"><span>Faces</span><strong>{s.faces}</strong></div>
    </>
  );
}

function OutlinerRows() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const read = () => {
      const out = [];
      if (window.__archdiscScene) {
        try {
          window.__archdiscScene.traverse((o) => {
            if (o.userData && o.userData.archdiscStudioPrimitive) {
              out.push({ uuid: o.uuid, name: o.name || o.userData.archdiscStudioPrimitiveKind || 'mesh' });
            }
          });
        } catch (_) {}
      }
      setItems(out);
    };
    const id = setInterval(read, 600);
    read();
    return () => clearInterval(id);
  }, []);
  if (!items.length) {
    return (
      <div className="studio-right-section">
        <div className="studio-right-section-title">Scene</div>
        <div className="studio-right-row" style={{ color: 'var(--studio-ink-mute)', fontStyle: 'italic' }}>
          Empty — add a primitive from the toolbar.
        </div>
      </div>
    );
  }
  return (
    <div className="studio-right-section">
      <div className="studio-right-section-title">Scene · {items.length}</div>
      {items.map((it) => (
        <div key={it.uuid} className="studio-right-row" data-studio-v3-outliner-item={it.uuid}>
          <span style={{ textTransform: 'capitalize' }}>{it.name}</span>
          <strong style={{ fontFamily: 'var(--studio-mono)', fontSize: 10, color: 'var(--studio-ink-mute)' }}>{it.uuid.slice(0, 6)}</strong>
        </div>
      ))}
    </div>
  );
}

// ─── StatusBar ───────────────────────────────────────────────────────────
function StatusBar({ wb, editMode }) {
  const [fps, setFps] = useState(0);
  const [calls, setCalls] = useState(0);
  const [primCount, setPrimCount] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        const vp = window.__archdiscViewport;
        if (vp && vp.renderer && vp.renderer.info) setCalls(vp.renderer.info.render.calls);
        let n = 0;
        if (window.__archdiscScene) {
          try { window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; }); } catch (_) {}
        }
        setPrimCount(n);
        frames = 0; last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="studio-statusbar" data-studio-v3-statusbar>
      <span data-studio-v3-status="brand"><strong>Studio</strong></span>
      <span data-studio-v3-status="wb" style={{ textTransform: 'capitalize' }}>{wb}</span>
      <span data-studio-v3-status="mode" style={{ textTransform: 'capitalize' }}>{editMode}</span>
      <span data-studio-v3-status="primitives">{primCount} prim</span>
      <span className="studio-statusbar-spacer" />
      <span data-studio-v3-status="fps">{fps} fps</span>
      <span data-studio-v3-status="calls">{calls} calls</span>
      <span data-studio-v3-status="units">mm</span>
      <span data-studio-v3-status="ready"><span className="studio-statusbar-dot" />ready</span>
    </div>
  );
}

// ─── CommandBar (always-on Archie input) ──────────────────────────────────
// Slice 398 — direct-call mode: any cmdbar string that matches the shape
// `studioFoo arg1 arg2 ...` (V2 window-API style) invokes the matching
// window.__studioFoo(...args) with JSON-parsed numeric / boolean / array
// args, and pushes the result back into the dock as a tool message. NL
// queries fall through to the (future) Archie router. This is how "no
// V2 capability is missed" stays provable — the user can hit any of
// V2's 206 APIs by typing the name.
function callDirectIfPossible(input) {
  const m = input.match(/^\s*(?:\/)?(studio[A-Za-z]+)\s*(.*)$/);
  if (!m) return null;
  const fname = '__' + m[1];
  const fn = window[fname];
  if (typeof fn !== 'function') return { ok: false, fname, error: `${fname} is not a function` };
  const rest = m[2].trim();
  let args = [];
  if (rest.length) {
    try {
      args = JSON.parse(`[${rest}]`);
    } catch (_) {
      args = rest.split(/\s+/).map((s) => {
        const n = Number(s);
        if (!Number.isNaN(n) && s.trim() !== '') return n;
        if (s === 'true') return true;
        if (s === 'false') return false;
        if (s === 'null') return null;
        return s;
      });
    }
  }
  try {
    const result = fn(...args);
    return { ok: true, fname, args, result };
  } catch (err) {
    return { ok: false, fname, args, error: String(err) };
  }
}

function CommandBar({ onSubmit }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="studio-cmdbar" data-studio-v3-cmdbar>
      <span className="studio-cmdbar-glyph" title="Archie">◐</span>
      <input
        ref={ref}
        className="studio-cmdbar-input"
        data-studio-v3-cmdbar-input
        placeholder="Ask Archie — or type a Studio API: studioListSceneStats / studioExtrudeSelectedFaces 0.005"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            const v = e.currentTarget.value.trim();
            e.currentTarget.value = '';
            onSubmit && onSubmit(v);
          }
        }}
      />
      <span className="studio-cmdbar-hint">
        <kbd>⌘K</kbd>
      </span>
    </div>
  );
}

// ─── ArchieThread (inline strip above cmdbar) ─────────────────────────────
// Slice 407 — replaces the right-side ArchieDock. Archie now lives ONLY
// at the bottom of the shell so its surface area matches Forge exactly.
// When there are messages the strip slides up above the cmdbar showing
// the most recent 8 entries; user can clear to collapse.
function ArchieThread({ thread, onClear }) {
  if (!thread.length) return null;
  return (
    <div className="studio-archie-thread" data-studio-v3-archie-thread>
      <div className="studio-archie-thread-head">
        <span className="studio-archie-thread-spark">◐</span>
        <span>Archie · {thread.length}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="studio-archie-thread-clear"
          data-studio-v3-archie-clear
          onClick={onClear}
          title="Clear thread"
        ><Icon name="close" size={11} /></button>
      </div>
      <div className="studio-archie-thread-body">
        {thread.slice(-8).map((m, i) => (
          <div key={i} className="studio-archie-msg" data-role={m.role}>{m.text}</div>
        ))}
      </div>
    </div>
  );
}

// ─── Top-level shell ──────────────────────────────────────────────────────
export function StudioShellV3({ mode = 'dark' }) {
  const [theme, setTheme] = useState(() => lstor.get('theme', mode));
  const [activeWb, setActiveWb] = useState(() => lstor.get('wb', 'model'));
  const [activeTool, setActiveTool] = useState('select');
  const [editMode, setEditMode] = useState('object');
  const [axis, setAxis] = useState('persp');
  // Slice 396 — selected-object summary surfaced from Viewport3D so the
  // status bar + inspector can read it without owning the raycaster.
  const [selection, setSelection] = useState(null);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [thread, setThread] = useState([]);
  // Slice 407 — Archie's side dock removed; thread strip lives above the
  // cmdbar instead, only visible when there are messages. Cmd+/ now
  // focuses the cmdbar input (most useful alias of the old toggle).

  // Slice 401 — register V3's native window.__studio* API surface on
  // mount; unregister on unmount so re-mounts don't leak.
  useEffect(() => {
    registerV3Api();
    registerEditOps();
    registerCameraOps();
    registerModOps();
    registerLightingOps();
    registerAnimPhysOps();
    registerPaintOps();
    registerSurfOps();
    registerAudioXROps();
    registerTerrainVoxOps();
    registerRemeshOps();
    registerScriptOps();
    registerMographOps();
    registerIOOps();
    return () => {
      unregisterIOOps();
      unregisterMographOps();
      unregisterScriptOps();
      unregisterRemeshOps();
      unregisterTerrainVoxOps();
      unregisterAudioXROps();
      unregisterSurfOps();
      unregisterPaintOps();
      unregisterAnimPhysOps(); unregisterLightingOps(); unregisterModOps();
      unregisterCameraOps(); unregisterEditOps(); unregisterV3Api();
    };
  }, []);

  // Theme → document attribute so tokens.css applies the right palette.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-studio-theme', theme);
    lstor.set('theme', theme);
  }, [theme]);
  useEffect(() => { lstor.set('wb', activeWb); }, [activeWb]);

  // Mirror edit-mode to the V2 window API so existing e2e specs + the
  // V2 click router keep working while V3 stabilises.
  useEffect(() => {
    if (window.__studioSetEditMode && window.__studioGetEditMode &&
        window.__studioGetEditMode() !== editMode) {
      window.__studioSetEditMode(editMode);
    }
  }, [editMode]);

  // Cmd+T cycle theme; Cmd+/ toggle dock; Esc clears active tool;
  // X deletes the selected mesh (Blender X / Maya Backspace parity).
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setTheme((t) => t === 'dark' ? 'light' : 'dark');
      } else if (meta && e.key === '/') {
        e.preventDefault();
        // No dock in V3 — focus the cmdbar input as the most useful alias.
        const inp = document.querySelector('[data-studio-v3-cmdbar-input]');
        if (inp) inp.focus();
      } else if (!meta && e.key === 'Escape') {
        setActiveTool('select');
      }
      // X-key delete handled by the V2 headless mount (its own X
      // handler covers undo + ref cleanup). Adding another here would
      // double-delete.
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Slice 396 — drive the Viewport3D gizmo from the active Transform tool.
  useEffect(() => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.transformControls) return;
    if (activeTool === 'select') {
      vp.transformControls.detach();
    } else if (activeTool === 'move' || activeTool === 'rotate' || activeTool === 'scale') {
      try {
        vp.transformControls.setMode(activeTool === 'move' ? 'translate' : activeTool);
        const sel = vp.getSelected && vp.getSelected();
        if (sel && !vp.transformControls.object) vp.transformControls.attach(sel);
      } catch (_) {}
    }
  }, [activeTool]);

  const onCmdSubmit = (text) => {
    // Direct V3-API call path — any `studioFoo arg1 arg2` runs the API
    // and pushes the result. Thread strip auto-opens.
    const direct = callDirectIfPossible(text);
    if (direct) {
      setThread((t) => [
        ...t,
        { role: 'user', text },
        direct.ok
          ? { role: 'tool', text: `${direct.fname}(${(direct.args || []).map(JSON.stringify).join(', ')}) → ${JSON.stringify(direct.result)}` }
          : { role: 'tool', text: `${direct.fname}: ${direct.error}` },
      ]);
      return;
    }
    setThread((t) => [...t, { role: 'user', text }, { role: 'archie', text: `(NL routing wired in a follow-up) — heard: "${text}"` }]);
  };

  // Slice 400/407 — QAT actions call V3 APIs and push a tool-message
  // into the thread strip (which auto-shows above the cmdbar).
  const onQatAction = (id) => {
    const pushTool = (text) => setThread((t) => [...t, { role: 'tool', text }]);
    if (id === 'undo') {
      const r = window.__studioUndo && window.__studioUndo();
      pushTool(`__studioUndo → ${JSON.stringify(r)}`);
    } else if (id === 'redo') {
      const r = window.__studioRedo && window.__studioRedo();
      pushTool(`__studioRedo → ${JSON.stringify(r)}`);
    } else if (id === 'play') {
      const r = window.__studioToggleAnimating && window.__studioToggleAnimating();
      pushTool(`__studioToggleAnimating → ${JSON.stringify(r)}`);
    } else if (id === 'pause') {
      const r = window.__studioToggleAnimating && window.__studioToggleAnimating();
      pushTool(`__studioToggleAnimating → ${JSON.stringify(r)}`);
    } else if (id === 'save') {
      const json = window.__studioSaveScene && window.__studioSaveScene();
      pushTool(`__studioSaveScene → ${json ? json.length + ' bytes' : 'null'}`);
      // Drop the JSON into a downloadable blob so the user can persist it.
      if (json) {
        try {
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `studio-scene-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
    } else if (id === 'open') {
      // Trigger a file picker; on pick, call __studioLoadScene with the
      // file's JSON text.
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const text = await f.text();
        const r = window.__studioLoadScene && window.__studioLoadScene(text);
        pushTool(`__studioLoadScene("${f.name}") → ${JSON.stringify(r)}`);
      };
      inp.click();
    } else if (id === 'new') {
      const r = window.__studioRevealAll && window.__studioRevealAll();
      pushTool(`new — __studioRevealAll → ${JSON.stringify(r)}`);
    } else if (id === 'settings') {
      pushTool('settings — preferences panel lands in a follow-up');
    }
  };

  return (
    <div
      className="studio-app"
      data-studio-v3-shell
      data-studio-v3-mode={theme}
    >
      <TopBar
        theme={theme}
        onCycleTheme={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
      />
      <QuickAccessBar onAction={onQatAction} />
      <WorkbenchRail
        activeId={activeWb}
        onSwitch={(id) => { setActiveWb(id); setActiveTool('select'); }}
      />
      <Toolbar
        wbId={activeWb}
        activeTool={activeTool}
        setTool={setActiveTool}
        onInvoke={(toolId, group) => {
          // Add group → spawn primitive into the live scene.
          if (group === 'add' && PRIMITIVE_KINDS.has(toolId)) {
            const scene = window.__archdiscScene;
            if (scene) spawnPrimitive(toolId, scene);
            return;
          }
          // Mesh ops → call into the slice 388/389/390 window APIs if
          // V2 is mounted alongside (won't be in v3-only mode yet, but
          // future slices port these into V3).
          if (group === 'mesh') {
            const m = toolId;
            if (m === 'extrude' && window.__studioExtrudeSelectedFaces) window.__studioExtrudeSelectedFaces(0.005);
            else if (m === 'inset' && window.__studioInsetSelectedFaces) window.__studioInsetSelectedFaces(0.3);
            else if (m === 'subdivide' && window.__studioSubdivideSelectedFaces) window.__studioSubdivideSelectedFaces();
            return;
          }
          // Other groups — placeholder; surfaced in slice 396+.
        }}
      />
      <main className="studio-viewport studio-viewport-canvas" data-studio-v3-viewport>
        {/* V3's own Viewport3D — owns the scene + camera + gizmo +
            raycaster. No V2 dependency. */}
        <Viewport3D
          canvasId="render-canvas-studio-v3"
          domain="studio"
          onSelectionChange={(s) => setSelection(s)}
        />
        <ViewportHUD
          editMode={editMode}
          setEditMode={setEditMode}
          axis={axis}
          setAxis={(a) => { setAxis(a); if (window.__studioSetCameraAxis) window.__studioSetCameraAxis(a); }}
        />
      </main>
      {/* Slice 407 — right side is always the RightPanel now. Archie no
          longer overlays this slot; it lives only at the bottom. */}
      <RightPanel
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed((v) => !v)}
        activeWb={activeWb}
        editMode={editMode}
        selection={selection}
      />
      <StatusBar wb={activeWb} editMode={editMode} />
      <ArchieThread thread={thread} onClear={() => setThread([])} />
      <CommandBar onSubmit={onCmdSubmit} />
    </div>
  );
}

export default StudioShellV3;
