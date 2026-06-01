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
import { registerRefSnapOps, unregisterRefSnapOps } from './refsnapops';
import { registerEditAuxOps, unregisterEditAuxOps } from './editauxops';
import { registerCursorOps, unregisterCursorOps } from './cursorops';
import { registerCameraViewOps, unregisterCameraViewOps } from './cameraviewops';
import { registerSelectionOps, unregisterSelectionOps } from './selectionops';
import { registerMarkerOps, unregisterMarkerOps } from './markerops';
import { registerUtilOps, unregisterUtilOps } from './utilops';
import { registerDisplayOps, unregisterDisplayOps } from './displayops';

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

// ─── KeymapCheatsheet ────────────────────────────────────────────────────
// Slice 432 — F1 / ? overlay listing the V3 hotkeys. Listens to
// __studioToggleCheatSheet's event so other UI / the cmdbar can also
// open it.
const KEYMAP = [
  { section: 'Mode', rows: [
    ['Tab', 'Cycle edit mode (object → vert → edge → face → sculpt)'],
    ['1 / 2 / 3', 'Vert / Edge / Face (only in sub-object mode)'],
    ['Esc', 'Drop active tool back to Select'],
  ] },
  { section: 'Transform', rows: [
    ['G', 'Move tool'],
    ['R', 'Rotate tool'],
    ['S', 'Scale tool'],
  ] },
  { section: 'Selection', rows: [
    ['A', 'Toggle select-all / deselect-all'],
    ['Shift+D', 'Duplicate selected'],
    ['X / Delete', 'Delete selected mesh'],
    ['H', 'Hide selected'],
    ['Alt+H', 'Reveal everything'],
  ] },
  { section: 'View / Cmd', rows: [
    ['Space', 'Play / pause animation'],
    ['.', 'Frame selected (fallback: frame all)'],
    ['Cmd+Z', 'Undo'],
    ['Cmd+Shift+Z', 'Redo'],
    ['Cmd+S', 'Save scene (download .studio.json)'],
    ['Cmd+O', 'Open scene file'],
    ['Cmd+T', 'Toggle theme'],
    ['Cmd+/', 'Focus command bar'],
    ['F1 / ?', 'This cheatsheet'],
  ] },
];
function KeymapCheatsheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onToggle = (ev) => { if (ev && ev.detail) setOpen(!!ev.detail.open); };
    window.addEventListener('studio-cheatsheet-toggle', onToggle);
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (e.key === 'F1' || (e.key === '?' && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
        // Mirror to the op event slot so other listeners can react.
        window.__studioCheatSheetOpen = !window.__studioCheatSheetOpen;
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('studio-cheatsheet-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      data-studio-v3-cheatsheet
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 540, width: '88vw',
          background: 'var(--studio-bg, #0d1117)',
          border: '1px solid var(--studio-ink-mute, #1f2733)',
          borderRadius: 8,
          padding: '20px 24px',
          color: 'var(--studio-ink, #e6edf3)',
          fontFamily: 'inherit', fontSize: 12,
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.55)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <strong style={{ fontSize: 14, color: 'var(--studio-accent, #1de9b6)', letterSpacing: '0.04em' }}>Keymap</strong>
          <span style={{ opacity: 0.6, fontSize: 11, fontFamily: 'var(--studio-mono, ui-monospace)' }}>F1 · ? · Esc</span>
        </div>
        {KEYMAP.map((sec) => (
          <div key={sec.section} data-studio-v3-cheatsheet-section={sec.section} style={{ marginBottom: 12 }}>
            <div style={{ opacity: 0.55, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{sec.section}</div>
            {sec.rows.map(([key, desc]) => (
              <div key={key} style={{ display: 'flex', gap: 12, padding: '2px 0', alignItems: 'baseline' }}>
                <code style={{
                  minWidth: 70, fontFamily: 'var(--studio-mono, ui-monospace)',
                  color: 'var(--studio-accent, #1de9b6)', fontSize: 11,
                }}>{key}</code>
                <span style={{ opacity: 0.85 }}>{desc}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── WelcomeCard ─────────────────────────────────────────────────────────
// Slice 427 — Centered card in the viewport while the scene has no
// Studio primitives. Studio teal title + brief muscle-memory hints.
// Fades out the moment the user spawns the first mesh.
function WelcomeCard() {
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const tick = () => {
      let n = 0;
      const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
      if (s) {
        try { s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; }); } catch (_) {}
      }
      setEmpty(n === 0);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);
  if (!empty) return null;
  return (
    <div
      data-studio-v3-welcome
      style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', zIndex: 21,
        background: 'rgba(13, 17, 23, 0.78)',
        border: '1px solid var(--studio-ink-mute, #1f2733)',
        borderRadius: 6,
        padding: '18px 22px',
        color: 'var(--studio-ink, #e6edf3)',
        fontFamily: 'inherit', fontSize: 12,
        pointerEvents: 'none',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        minWidth: 260, textAlign: 'center',
      }}
    >
      <div style={{
        fontSize: 13, fontWeight: 600, marginBottom: 8,
        color: 'var(--studio-accent, #1de9b6)', letterSpacing: '0.03em',
      }}>ArchDisc Studio</div>
      <div style={{ marginBottom: 10, opacity: 0.8 }}>
        Pick a primitive in the toolbar to start.
      </div>
      <div style={{ fontSize: 11, opacity: 0.55, fontFamily: 'var(--studio-mono, ui-monospace)' }}>
        Tab — edit mode<br />
        1 · 2 · 3 — vert · edge · face<br />
        Cmd+/ — focus command bar
      </div>
    </div>
  );
}

// ─── Viewport HUD (edit-mode chips + axis chips + sub-object sel count) ──
function ViewportHUD({ editMode, setEditMode, axis, setAxis }) {
  // Slice 426 — Live count of selected verts/edges/faces. Only renders
  // in sub-object modes; reads __studioGetEditSelection on pick events.
  const [counts, setCounts] = useState({ vertices: 0, edges: 0, faces: 0 });
  useEffect(() => {
    const readSel = () => {
      if (window.__studioGetEditSelection) {
        const s = window.__studioGetEditSelection();
        setCounts({ vertices: s.vertices.length, edges: s.edges.length, faces: s.faces.length });
      }
    };
    const refresh = () => { queueMicrotask(readSel); };
    window.addEventListener('studio-pick', refresh);
    window.addEventListener('studio-edit-mode-changed', refresh);
    readSel();
    return () => {
      window.removeEventListener('studio-pick', refresh);
      window.removeEventListener('studio-edit-mode-changed', refresh);
    };
  }, []);
  const subMode = editMode === 'vertex' || editMode === 'edge' || editMode === 'face';
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
        {subMode && (
          <span
            className="studio-vp-hud-counts"
            data-studio-v3-edit-counts
            data-studio-v3-edit-v={counts.vertices}
            data-studio-v3-edit-e={counts.edges}
            data-studio-v3-edit-f={counts.faces}
            title={`Selected — verts ${counts.vertices} · edges ${counts.edges} · faces ${counts.faces}`}
            style={{
              marginLeft: 8, padding: '2px 8px',
              background: 'var(--studio-bg-elev)', border: '1px solid var(--studio-ink-mute)',
              borderRadius: 3, color: 'var(--studio-accent)',
              fontSize: 10, fontFamily: 'var(--studio-mono)',
              letterSpacing: '0.04em',
            }}
          >
            v{counts.vertices} · e{counts.edges} · f{counts.faces}
          </span>
        )}
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
            {/* Slice 433 — Edit Tools buttons surface the slice 388/389/390/
                386/387 edit-mode ops as one-click actions in V3 inspector.
                Only shown in a sub-object mode. */}
            {(editMode === 'vertex' || editMode === 'edge' || editMode === 'face') && (
              <div className="studio-right-section" data-studio-v3-edit-tools>
                <div className="studio-right-section-title">Edit tools</div>
                {[
                  { id: 'extrude',   label: 'Extrude  0.005',  call: () => window.__studioExtrudeSelectedFaces && window.__studioExtrudeSelectedFaces(0.005) },
                  { id: 'inset',     label: 'Inset  0.3',      call: () => window.__studioInsetSelectedFaces && window.__studioInsetSelectedFaces(0.3) },
                  { id: 'subdivide', label: 'Subdivide  1→4',  call: () => window.__studioSubdivideSelectedFaces && window.__studioSubdivideSelectedFaces() },
                  { id: 'invert',    label: 'Invert',          call: () => window.__studioInvertEditSelection && window.__studioInvertEditSelection(editMode) },
                  { id: 'all',       label: 'Select All',      call: () => window.__studioSelectAllEdit && window.__studioSelectAllEdit(editMode) },
                  { id: 'clear',     label: 'Clear',           call: () => window.__studioClearEditSelection && window.__studioClearEditSelection() },
                ].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    data-studio-v3-edit-tool={b.id}
                    onClick={b.call}
                    style={{
                      display: 'block', width: '100%', marginBottom: 3,
                      padding: '3px 8px', textAlign: 'left',
                      background: 'var(--studio-bg-elev)',
                      color: 'var(--studio-ink)',
                      border: '1px solid var(--studio-ink-mute)',
                      borderRadius: 3, cursor: 'pointer',
                      fontSize: 11, fontFamily: 'inherit',
                    }}
                  >{b.label}</button>
                ))}
              </div>
            )}
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
  // Slice 425 — selected-mesh V / T pinned to the right of primitive count.
  // Polls once per second to keep the strip cheap.
  const [meshStats, setMeshStats] = useState(null);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    let lastSel = 0;
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
      if (now - lastSel >= 1000) {
        lastSel = now;
        const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
        if (!m || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) {
          setMeshStats(null);
        } else {
          const v = m.geometry.attributes.position.count;
          const t = m.geometry.index ? Math.floor(m.geometry.index.array.length / 3) : Math.floor(v / 3);
          setMeshStats({ v, t });
        }
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
      {meshStats && (
        <span data-studio-v3-status="mesh" data-studio-v3-mesh-v={meshStats.v} data-studio-v3-mesh-t={meshStats.t}>
          v {meshStats.v} · t {meshStats.t}
        </span>
      )}
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
  // Slice 426 — Keep React editMode in sync with window.__studioEditModeRef.
  // Without this, programmatic window.__studioSetEditMode() doesn't update
  // the HUD chip / counts badge until the user clicks a chip.
  useEffect(() => {
    const onChange = (ev) => { if (ev && ev.detail && ev.detail.mode) setEditMode(ev.detail.mode); };
    window.addEventListener('studio-edit-mode-changed', onChange);
    return () => window.removeEventListener('studio-edit-mode-changed', onChange);
  }, []);
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
    registerRefSnapOps();
    registerEditAuxOps();
    registerCursorOps();
    registerCameraViewOps();
    registerSelectionOps();
    registerMarkerOps();
    registerUtilOps();
    registerDisplayOps();
    return () => {
      unregisterDisplayOps();
      unregisterUtilOps();
      unregisterMarkerOps();
      unregisterSelectionOps();
      unregisterCameraViewOps();
      unregisterCursorOps();
      unregisterEditAuxOps();
      unregisterRefSnapOps();
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
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 'z') {
        // Slice 437 — Cmd/Ctrl+Z = undo. Honors text input.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioUndo) window.__studioUndo();
        e.preventDefault();
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'z') {
        // Cmd/Ctrl+Shift+Z = redo.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioRedo) window.__studioRedo();
        e.preventDefault();
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 's') {
        // Slice 438 — Cmd/Ctrl+S downloads the scene as JSON.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioDownloadScene) window.__studioDownloadScene();
        e.preventDefault();
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 'o') {
        // Slice 439 — Cmd/Ctrl+O opens a .studio.json file picker.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioOpenSceneFile) window.__studioOpenSceneFile();
        e.preventDefault();
      } else if (meta && e.key === '/') {
        e.preventDefault();
        // No dock in V3 — focus the cmdbar input as the most useful alias.
        const inp = document.querySelector('[data-studio-v3-cmdbar-input]');
        if (inp) inp.focus();
      } else if (!meta && e.key === 'Escape') {
        setActiveTool('select');
      } else if (!meta && !e.shiftKey && !e.altKey && e.key === 'Tab') {
        // Slice 428 — Blender Tab cycle: object → vertex → edge → face → sculpt → object.
        // Honors text inputs by checking the focused element.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        const cycle = ['object', 'vertex', 'edge', 'face', 'sculpt'];
        const cur = window.__studioGetEditMode && window.__studioGetEditMode();
        const i = cycle.indexOf(cur);
        const next = cycle[(i + 1) % cycle.length];
        if (window.__studioSetEditMode) window.__studioSetEditMode(next);
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
        // 1/2/3 flip vert/edge/face — ONLY when already in a sub-object
        // mode (avoids stealing the numpad-1/3 camera views in object mode).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const cur = window.__studioGetEditMode && window.__studioGetEditMode();
        if (cur === 'vertex' || cur === 'edge' || cur === 'face') {
          const map = { '1': 'vertex', '2': 'edge', '3': 'face' };
          if (window.__studioSetEditMode) window.__studioSetEditMode(map[e.key]);
          e.preventDefault();
        }
      } else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'g' || e.key === 'r' || e.key === 's')) {
        // Slice 429 — G/R/S set active transform tool (Blender muscle memory).
        // Honors text inputs.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const map = { g: 'move', r: 'rotate', s: 'scale' };
        setActiveTool(map[e.key]);
        e.preventDefault();
      } else if (!meta && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        // Slice 430 — H hides selected, Alt+H reveals all (Blender H parity).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (e.altKey) {
          if (window.__studioRevealAll) window.__studioRevealAll();
        } else {
          const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
          if (sel) sel.visible = false;
        }
        e.preventDefault();
      } else if (!meta && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        // Slice 431 — A toggles select-all ↔ deselect-all (Blender A parity).
        // Alt+A is deselect; bare A selects everything when nothing is selected
        // and deselects when something is selected.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const set = (window.__studioSelectedMeshes && window.__studioSelectedMeshes()) || [];
        if (set.length === 0) {
          if (window.__studioSelectAll) window.__studioSelectAll();
        } else {
          if (window.__studioDeselect) window.__studioDeselect();
        }
        e.preventDefault();
      } else if (!meta && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        // Slice 434 — Shift+D duplicates the selected mesh (Blender Shift+D).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
        const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
        if (sel && s) {
          const clone = sel.clone();
          if (clone.geometry) clone.geometry = clone.geometry.clone();
          if (Array.isArray(clone.material)) clone.material = clone.material.map((m) => m.clone());
          else if (clone.material) clone.material = clone.material.clone();
          clone.position.set(sel.position.x + 0.02, sel.position.y, sel.position.z + 0.02);
          clone.userData = { ...sel.userData };
          clone.name = (sel.name || 'mesh') + '-copy';
          s.add(clone);
          if (window.__studioSelectMesh) window.__studioSelectMesh(clone);
        }
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && e.key === ' ') {
        // Slice 440 — Space toggles animation play/pause (Blender Space).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (window.__studioToggleAnimating) window.__studioToggleAnimating();
        e.preventDefault();
      } else if (!meta && !e.shiftKey && !e.altKey && e.key === '.') {
        // Slice 435 — '.' frames the selected mesh in the viewport
        // (Blender Numpad-. parity). Falls back to FrameAll if nothing
        // is selected.
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
        if (sel && window.__studioFitSelected) window.__studioFitSelected();
        else if (window.__studioFrameAll) window.__studioFrameAll();
        e.preventDefault();
      }
      // Slice 436 — X / Delete remove the active mesh from the scene
      // (Blender X / Maya Backspace parity). V3 owns this directly now —
      // the prior V2 headless-mount delegation is gone in V3-only mode.
      else if (!meta && !e.shiftKey && !e.altKey && (e.key === 'x' || e.key === 'X' || e.key === 'Delete' || e.key === 'Backspace')) {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
        const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
        if (sel && s) {
          if (window.__studioPushUndo) window.__studioPushUndo();
          if (sel.geometry) sel.geometry.dispose();
          if (Array.isArray(sel.material)) sel.material.forEach((m) => m.dispose && m.dispose());
          else if (sel.material && sel.material.dispose) sel.material.dispose();
          s.remove(sel);
          // Detach gizmo + clear active selection.
          const vp = window.__archdiscViewport;
          if (vp && vp.transformControls && vp.transformControls.object === sel) vp.transformControls.detach();
          if (window.__studioDeselect) window.__studioDeselect();
        }
        e.preventDefault();
      }
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
        <WelcomeCard />
        <KeymapCheatsheet />
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
