// ArchDisc Studio V3 — AutoCAD 2D drawing layer installer (slice 774).
//
// Wires the named-drawing CAD2D ops onto window so the cmd palette,
// menubar, and e2e specs can create / edit / export 2D drawings
// without touching the Drawing class directly. State lives in a
// module-local Map<name, Drawing>; the drawing name is the public
// handle (the user picks it via __studioCAD2DCreateDrawing).
//
// Ops registered (all under category 'arch' alongside dwgblocks /
// dwgsheets / caslayers / archeng):
//
//   __studioCAD2DCreateDrawing({name})                     → { ok, name }
//   __studioCAD2DAddLine({drawingName, p1, p2, layer?, color?})
//                                                          → { ok, entityId }
//   __studioCAD2DAddPolyline({drawingName, points, layer?, color?, closed?})
//                                                          → { ok, entityId }
//   __studioCAD2DAddArc({drawingName, center, radius, startAngle, endAngle, layer?, color?})
//                                                          → { ok, entityId }
//   __studioCAD2DAddCircle({drawingName, center, radius, layer?, color?})
//                                                          → { ok, entityId }
//   __studioCAD2DAddRectangle({drawingName, p1, p2, layer?, color?})
//                                                          → { ok, entityId }
//   __studioCAD2DAddDimension({drawingName, p1, p2, offset, layer?, color?})
//                                                          → { ok, entityId }
//   __studioCAD2DAddText({drawingName, position, content, size, layer?, color?})
//                                                          → { ok, entityId }
//   __studioCAD2DDefineLayer({drawingName, layer, color?, visible?})
//                                                          → { ok }
//   __studioCAD2DSetEntityLayer({drawingName, entityId, layer})
//                                                          → { ok }
//   __studioCAD2DRemoveEntity({drawingName, entityId})     → { ok }
//   __studioCAD2DExportSVG({drawingName})                  → { ok, svg, name }
//   __studioCAD2DList()                                    → { ok, drawings }
//   __studioCAD2DDelete({drawingName})                     → { ok }
//   __studioCAD2DStats({drawingName})                      → { ok, stats }
//
// Pure JS — these ops don't touch the 3D scene, so they're safe to
// run before the viewport mounts.

import { registerOps, unregisterOps } from '../common/registry.js';
import { Drawing } from './drawing.js';
import {
  line, polyline, arc, circle, rectangle, dimensionLinear, text,
} from './entities.js';

let _installed = false;
const _drawings = new Map();  // name → Drawing

// ─── helpers ───────────────────────────────────────────────────────────────

function _argObj(args) { return (args && typeof args === 'object') ? args : {}; }

function _resolveDrawing(name) {
  if (!name || typeof name !== 'string') return null;
  return _drawings.get(name) || null;
}

function _entityOpts(args) {
  const o = _argObj(args);
  const out = {};
  if (typeof o.layer === 'string' && o.layer) out.layer = o.layer;
  if (typeof o.color === 'string' && o.color) out.color = o.color;
  if (o.closed !== undefined) out.closed = !!o.closed;
  return out;
}

function _addAndReturn(drawing, ent) {
  const r = drawing.addEntity(ent);
  if (!r.ok) return { ok: false, error: r.error || 'add-failed' };
  return { ok: true, entityId: r.entityId, kind: ent.kind };
}

// ─── op implementations ────────────────────────────────────────────────────

export function createDrawing(args) {
  const o = _argObj(args);
  const name = (typeof o.name === 'string' && o.name) ? o.name : null;
  if (!name) return { ok: false, error: 'name-required' };
  if (_drawings.has(name)) return { ok: false, error: 'name-exists', name };
  _drawings.set(name, new Drawing(name));
  return { ok: true, name };
}

export function addLine(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  return _addAndReturn(d, line(o.p1, o.p2, _entityOpts(o)));
}

export function addPolyline(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  if (!Array.isArray(o.points) || o.points.length < 2) {
    return { ok: false, error: 'points-needs-at-least-2' };
  }
  return _addAndReturn(d, polyline(o.points, _entityOpts(o)));
}

export function addArc(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  return _addAndReturn(d, arc(o.center, o.radius, o.startAngle, o.endAngle, _entityOpts(o)));
}

export function addCircle(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  return _addAndReturn(d, circle(o.center, o.radius, _entityOpts(o)));
}

export function addRectangle(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  return _addAndReturn(d, rectangle(o.p1, o.p2, _entityOpts(o)));
}

export function addDimension(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  return _addAndReturn(d, dimensionLinear(o.p1, o.p2, o.offset, _entityOpts(o)));
}

export function addText(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  return _addAndReturn(d, text(o.position, o.content, o.size, _entityOpts(o)));
}

export function defineLayer(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  if (!o.layer || typeof o.layer !== 'string') {
    return { ok: false, error: 'layer-required' };
  }
  return d.defineLayer(o.layer, { color: o.color, visible: o.visible });
}

export function setEntityLayer(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  return d.setLayer(o.entityId, o.layer, { color: o.color, visible: o.visible });
}

export function removeEntity(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  const removed = d.removeEntity(o.entityId);
  return { ok: !!removed, removed: removed ? removed.kind : null };
}

export function exportSVG(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  let svg;
  try {
    svg = d.toSVG({ margin: o.margin });
  } catch (e) {
    return { ok: false, error: 'toSVG-threw: ' + (e && e.message ? e.message : String(e)) };
  }
  return { ok: true, name: d.name, svg };
}

export function listDrawings() {
  const drawings = [];
  for (const d of _drawings.values()) {
    drawings.push({
      name: d.name,
      entityCount: d.entities.length,
      layerCount: d.layers.size,
    });
  }
  return { ok: true, count: drawings.length, drawings };
}

export function deleteDrawing(args) {
  const o = _argObj(args);
  if (!o.drawingName || typeof o.drawingName !== 'string') {
    return { ok: false, error: 'drawingName-required' };
  }
  const had = _drawings.delete(o.drawingName);
  return { ok: had, deleted: o.drawingName };
}

export function statsDrawing(args) {
  const o = _argObj(args);
  const d = _resolveDrawing(o.drawingName);
  if (!d) return { ok: false, error: 'drawing-not-found' };
  return { ok: true, stats: d.stats() };
}

// Exposed for tests / hot-reload — wipes the in-memory drawing map.
export function _resetCAD2DState() {
  _drawings.clear();
}

// ─── installer ─────────────────────────────────────────────────────────────

export function installCAD2D() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioCAD2DInstalled) {
    return { ok: true, already: true, drawingCount: _drawings.size };
  }
  _installed = true;
  window.__studioCAD2DInstalled = true;

  registerOps({
    __studioCAD2DCreateDrawing: [createDrawing,
      'CAD 2D — create a new named drawing (AutoCAD-style 2D layer).'],
    __studioCAD2DAddLine: [addLine,
      'CAD 2D — add a Line entity (p1, p2) to a drawing.'],
    __studioCAD2DAddPolyline: [addPolyline,
      'CAD 2D — add a Polyline entity (chained line segments through N points) to a drawing.'],
    __studioCAD2DAddArc: [addArc,
      'CAD 2D — add an Arc entity (center, radius, startAngle, endAngle in radians) to a drawing.'],
    __studioCAD2DAddCircle: [addCircle,
      'CAD 2D — add a Circle entity (center, radius) to a drawing.'],
    __studioCAD2DAddRectangle: [addRectangle,
      'CAD 2D — add a Rectangle entity (corners p1, p2) to a drawing.'],
    __studioCAD2DAddDimension: [addDimension,
      'CAD 2D — add a linear Dimension entity (p1, p2, offset) to a drawing; renders the measured length as text.'],
    __studioCAD2DAddText: [addText,
      'CAD 2D — add a single-line Text annotation (position, content, size) to a drawing.'],
    __studioCAD2DDefineLayer: [defineLayer,
      'CAD 2D — define or update a named layer (color, visibility).'],
    __studioCAD2DSetEntityLayer: [setEntityLayer,
      'CAD 2D — re-assign an entity to a different layer (auto-creates the layer).'],
    __studioCAD2DRemoveEntity: [removeEntity,
      'CAD 2D — remove a single entity from a drawing by entityId.'],
    __studioCAD2DExportSVG: [exportSVG,
      'CAD 2D — export a drawing to a self-contained SVG XML string.'],
    __studioCAD2DList: [listDrawings,
      'CAD 2D — list every named drawing with its entity / layer counts.'],
    __studioCAD2DDelete: [deleteDrawing,
      'CAD 2D — drop a drawing from the in-memory document store.'],
    __studioCAD2DStats: [statsDrawing,
      'CAD 2D — drawing statistics (per-kind counts, bbox, totals).'],
  }, 'arch', 'AutoCAD-style 2D drawing layer — Line / Polyline / Arc / Circle / Rectangle / Dimension / Text + SVG export.');

  return { ok: true, drawingCount: _drawings.size };
}

export function uninstallCAD2D() {
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioCAD2DCreateDrawing', '__studioCAD2DAddLine', '__studioCAD2DAddPolyline',
    '__studioCAD2DAddArc', '__studioCAD2DAddCircle', '__studioCAD2DAddRectangle',
    '__studioCAD2DAddDimension', '__studioCAD2DAddText',
    '__studioCAD2DDefineLayer', '__studioCAD2DSetEntityLayer', '__studioCAD2DRemoveEntity',
    '__studioCAD2DExportSVG', '__studioCAD2DList', '__studioCAD2DDelete', '__studioCAD2DStats',
  ]);
  _installed = false;
  if (typeof window !== 'undefined') window.__studioCAD2DInstalled = false;
  return { ok: true };
}

export default installCAD2D;
