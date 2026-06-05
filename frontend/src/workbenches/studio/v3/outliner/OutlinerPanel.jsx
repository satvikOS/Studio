// ArchDisc Studio V3 — Outliner (floating Blender-style scene tree).
//
// Pure React + pure JS — no extra deps. Reads window.__archdiscScene
// every `pollMs` ms (default 1000) AND on the optional
// `studio-scene-updated` window event, then renders a flat virtualised
// list of rows derived from `tree()`.
//
// Per-row controls (left to right):
//   • indent spacer ........... 12 px × depth
//   • expand/collapse chevron . hidden when leaf
//   • kind glyph .............. tiny unicode badge so kinds are scannable
//   • name span / inline edit . single-click selects; dbl-click renames
//   • eye toggle .............. flips object.visible
//   • lock toggle ............. flips userData.archdiscStudioFrozen
//
// Selection visualisation: the row whose uuid === current selected uuid
// (from window.__studioSelectedMesh()) gets a highlight band.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tree, countAll, classifyObject } from './tree.js';

const ROW_H = 22;
const INDENT_PX = 12;

// ─── Kind → little glyph map ─────────────────────────────────────────────
// Blender uses dedicated icons; we get away with monochrome unicode so we
// stay 100 % code-only.
const KIND_GLYPH = {
  scene:       '◆',  // ◆
  mesh:        '■',  // ■
  skinnedMesh: '▣',  // ▣
  group:       '◫',  // ◫
  light:       '☼',  // ☼
  camera:      '□',  // □ (a CCD-ish square)
  helper:      '○',  // ○
  bone:        '⥠',  // ⥠
  line:        '─',  // ─
  points:      '…',  // …
  object:      '◇',  // ◇
};

const KIND_COLOR = {
  scene:       '#dbe5f1',
  mesh:        '#9bd5ff',
  skinnedMesh: '#9bd5ff',
  group:       '#c9a8ff',
  light:       '#ffd66b',
  camera:      '#8be5b1',
  helper:      '#6e8aaa',
  bone:        '#ff9aa8',
  line:        '#d7e3f1',
  points:      '#d7e3f1',
  object:      '#cdd6e2',
};

// ─── Styles (inline so we don't need a CSS module) ───────────────────────
const PANEL_STYLE = {
  position: 'fixed',
  top: '64px',
  right: '24px',
  width: '320px',
  maxHeight: 'calc(100vh - 96px)',
  zIndex: 9210,
  background: 'rgba(13,17,23,0.96)',
  border: '1px solid #2a3a52',
  borderRadius: '10px',
  boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  color: '#cdd6e2',
  font: '12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  backdropFilter: 'blur(8px)',
};

const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  borderBottom: '1px solid #1d2937',
  background: 'linear-gradient(180deg, #182030 0%, #131923 100%)',
};

const TITLE_STYLE = { fontWeight: 600, letterSpacing: '0.04em', color: '#ecf3fb' };
const COUNT_STYLE = { color: '#6e8aaa', fontSize: '11px', marginLeft: '8px' };

const TOOLBAR_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 10px',
  borderBottom: '1px solid #1d2937',
  background: '#0d1218',
};

const TOOL_BTN = {
  background: '#0d1218',
  border: '1px solid #2a3a52',
  color: '#cdd6e2',
  borderRadius: '5px',
  padding: '3px 8px',
  cursor: 'pointer',
  font: 'inherit',
};

const SEARCH_STYLE = {
  flex: '1 1 auto',
  background: '#0d1218',
  border: '1px solid #2a3a52',
  color: '#cdd6e2',
  borderRadius: '5px',
  padding: '3px 8px',
  font: 'inherit',
};

const LIST_STYLE = {
  overflow: 'auto',
  flex: '1 1 auto',
  padding: '4px 0',
};

const EMPTY_STYLE = {
  padding: '24px',
  textAlign: 'center',
  color: '#6e8aaa',
  fontStyle: 'italic',
};

function rowStyle({ selected, frozen, visible }) {
  return {
    display: 'flex',
    alignItems: 'center',
    height: `${ROW_H}px`,
    padding: '0 6px',
    cursor: 'default',
    background: selected ? 'rgba(58,90,138,0.32)' : 'transparent',
    color: visible ? '#cdd6e2' : '#5b6a82',
    opacity: frozen ? 0.78 : 1,
    userSelect: 'none',
    borderLeft: selected ? '2px solid #3a8af0' : '2px solid transparent',
  };
}

const CHEV_STYLE = {
  width: '14px',
  textAlign: 'center',
  cursor: 'pointer',
  color: '#7b8aa3',
  fontSize: '10px',
  flex: '0 0 14px',
};

const GLYPH_STYLE = {
  width: '16px',
  textAlign: 'center',
  fontSize: '13px',
  flex: '0 0 16px',
  marginRight: '4px',
};

const NAME_STYLE = {
  flex: '1 1 auto',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  padding: '0 4px',
};

const NAME_INPUT_STYLE = {
  ...NAME_STYLE,
  background: '#0d1218',
  border: '1px solid #3a8af0',
  color: '#ecf3fb',
  borderRadius: '3px',
  padding: '0 4px',
  font: 'inherit',
  outline: 'none',
};

const ICON_BTN = {
  width: '20px',
  height: '20px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  color: '#7b8aa3',
  cursor: 'pointer',
  borderRadius: '4px',
  flex: '0 0 20px',
  font: 'inherit',
  fontSize: '11px',
};

// Eye / lock glyphs picked from unicode so we never load an SVG sprite.
const EYE_OPEN = '●'; // ●  (visible)
const EYE_HID  = '○'; // ○  (hidden)
const LOCK_ON  = '♦'; // ♦  (frozen)
const LOCK_OFF = '♢'; // ♢  (free)

export default function OutlinerPanel({
  expandedRef, setExpandedRev,
  pollMs = 1000,
  onSelect, onRename, onToggleVisible, onToggleFrozen,
  onCollapseAll, onExpandAll,
  onCloseRequest,
  refreshSignal = 0,
}) {
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const [editingUuid, setEditingUuid] = useState(null);
  const [editingDraft, setEditingDraft] = useState('');
  const listRef = useRef(null);

  // Cheap polling — Blender's outliner also redraws on a timer.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), pollMs);
    const onEvt = () => setTick((t) => t + 1);
    window.addEventListener('studio-scene-updated', onEvt);
    return () => {
      clearInterval(id);
      window.removeEventListener('studio-scene-updated', onEvt);
    };
  }, [pollMs]);

  // External refresh signal — bumped by the installer's __studioOutlinerRefresh.
  useEffect(() => { setTick((t) => t + 1); }, [refreshSignal]);

  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;

  const expandedSet = expandedRef.current;
  const isExpanded = useCallback((uuid) => expandedSet.has(uuid), [expandedSet, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!scene) return [];
    return tree(scene, { isExpanded });
  }, [scene, tick, isExpanded]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    // When searching, ignore collapse state and show every match with its
    // depth preserved so the hierarchy is still readable.
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q));
  }, [rows, search]);

  const counts = useMemo(() => countAll(scene), [scene, tick]);

  const selectedUuid = useMemo(() => {
    try {
      const sel = window.__studioSelectedMesh && window.__studioSelectedMesh();
      return sel ? sel.uuid : null;
    } catch (_) { return null; }
  }, [tick]);

  const toggleExpand = useCallback((uuid) => {
    if (expandedSet.has(uuid)) expandedSet.delete(uuid);
    else expandedSet.add(uuid);
    setExpandedRev((r) => r + 1);
  }, [expandedSet, setExpandedRev]);

  const commitRename = useCallback(() => {
    if (editingUuid && onRename) onRename(editingUuid, editingDraft);
    setEditingUuid(null);
    setEditingDraft('');
  }, [editingUuid, editingDraft, onRename]);

  return (
    <div data-studio-v3-outliner="" style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>
        <span>
          <span style={TITLE_STYLE}>Outliner</span>
          <span style={COUNT_STYLE} data-studio-v3-outliner-count={counts.total}>
            {counts.total} {counts.total === 1 ? 'object' : 'objects'}
          </span>
        </span>
        <button
          type="button"
          style={TOOL_BTN}
          data-studio-v3-outliner-close=""
          onClick={() => onCloseRequest && onCloseRequest()}
        >
          Close
        </button>
      </div>

      <div style={TOOLBAR_STYLE}>
        <button
          type="button"
          style={TOOL_BTN}
          data-studio-v3-outliner-expand-all=""
          title="Expand all"
          onClick={() => onExpandAll && onExpandAll()}
        >
          {'⌄⌄'}
        </button>
        <button
          type="button"
          style={TOOL_BTN}
          data-studio-v3-outliner-collapse-all=""
          title="Collapse all"
          onClick={() => onCollapseAll && onCollapseAll()}
        >
          {'⌃⌃'}
        </button>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter…"
          style={SEARCH_STYLE}
          data-studio-v3-outliner-search=""
        />
      </div>

      <div style={LIST_STYLE} ref={listRef} data-studio-v3-outliner-list="">
        {filtered.length === 0 && (
          <div style={EMPTY_STYLE}>{scene ? 'No matches.' : 'No scene attached.'}</div>
        )}
        {filtered.map((r) => {
          const selected = r.uuid === selectedUuid;
          const glyph = KIND_GLYPH[r.kind] || KIND_GLYPH.object;
          const glyphColor = KIND_COLOR[r.kind] || KIND_COLOR.object;
          const isEditing = editingUuid === r.uuid;
          return (
            <div
              key={r.uuid}
              style={rowStyle({ selected, frozen: r.frozen, visible: r.visible })}
              data-studio-v3-outliner-row={r.uuid}
              data-studio-v3-outliner-kind={r.kind}
              data-studio-v3-outliner-depth={r.depth}
              data-studio-v3-outliner-selected={selected ? '1' : '0'}
              onClick={(e) => {
                if (isEditing) return;
                e.stopPropagation();
                if (onSelect) onSelect(r.uuid);
              }}
            >
              <div style={{ width: `${r.depth * INDENT_PX}px`, flex: `0 0 ${r.depth * INDENT_PX}px` }} />
              <div
                style={CHEV_STYLE}
                data-studio-v3-outliner-chevron={r.uuid}
                onClick={(e) => {
                  e.stopPropagation();
                  if (r.hasChildren) toggleExpand(r.uuid);
                }}
                title={r.hasChildren ? (expandedSet.has(r.uuid) ? 'Collapse' : 'Expand') : ''}
              >
                {r.hasChildren ? (expandedSet.has(r.uuid) ? '▼' : '▶') : ''}
              </div>
              <div style={{ ...GLYPH_STYLE, color: glyphColor }} title={r.kind}>{glyph}</div>
              {isEditing ? (
                <input
                  autoFocus
                  type="text"
                  value={editingDraft}
                  onChange={(e) => setEditingDraft(e.target.value)}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                    else if (e.key === 'Escape') { e.preventDefault(); setEditingUuid(null); setEditingDraft(''); }
                  }}
                  style={NAME_INPUT_STYLE}
                  data-studio-v3-outliner-name-input={r.uuid}
                />
              ) : (
                <span
                  style={NAME_STYLE}
                  data-studio-v3-outliner-name={r.uuid}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingUuid(r.uuid);
                    setEditingDraft(r.name);
                  }}
                  title={`${r.name} (${r.kind})`}
                >
                  {r.name}
                </span>
              )}
              <button
                type="button"
                style={{ ...ICON_BTN, color: r.visible ? '#cdd6e2' : '#5b6a82' }}
                data-studio-v3-outliner-eye={r.uuid}
                data-studio-v3-outliner-eye-on={r.visible ? '1' : '0'}
                title={r.visible ? 'Hide' : 'Show'}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onToggleVisible) onToggleVisible(r.uuid);
                }}
              >
                {r.visible ? EYE_OPEN : EYE_HID}
              </button>
              <button
                type="button"
                style={{ ...ICON_BTN, color: r.frozen ? '#ffd66b' : '#5b6a82' }}
                data-studio-v3-outliner-lock={r.uuid}
                data-studio-v3-outliner-lock-on={r.frozen ? '1' : '0'}
                title={r.frozen ? 'Unlock' : 'Lock'}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onToggleFrozen) onToggleFrozen(r.uuid);
                }}
              >
                {r.frozen ? LOCK_ON : LOCK_OFF}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Re-exported so the index installer can build the same expansion default.
export { classifyObject };
