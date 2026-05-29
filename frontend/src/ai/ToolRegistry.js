/**
 * ArchDisc Studio — AI Tool Registry.
 *
 * Machine-readable catalogue of EVERY ribbon action, primitive,
 * property knob, and programmatic entry-point Studio exposes. The
 * autonomous loop (Planner -> PlanExecutor -> Verifier and Archie's
 * data-driven recipes) reads this to know what it can dispatch and
 * how to dispatch it. ANY provider (cloud or local SLM) can read
 * this registry to emit valid plans the executor will run.
 *
 * Each entry has the same shape:
 *   - id          machine-stable name (matches the data-attr / fn name)
 *   - kind        primitive | ribbon-action | primitive-special |
 *                 light | material | brush | sculpt | array | scatter |
 *                 texture | comp | proc | text3d | reference |
 *                 discipline | property | entry-point
 *   - discipline  modeling | sculpting | uv-texture | rigging |
 *                 animation | vfx-sim | rendering | compositing | global
 *   - category    short ribbon-section name (Modeling / Modifier / Sculpt / …)
 *   - description one-line human-readable
 *   - exec        { type, … } — how the executor dispatches it:
 *                   {type:'click-action', id}        — click [data-studio-ribbon-action="id"]
 *                   {type:'click-primitive', id}     — click [data-studio-primitive="id"]
 *                   {type:'click-discipline', id}    — switch discipline tab
 *                   {type:'set-param', group, knob}  — set [data-studio-<group>="<knob>"]
 *                   {type:'set-selection', axis}     — set [data-studio-selection-edit="<axis>"]
 *                   {type:'fn', name}                — call window.__studio<Name>(...)
 */

// ─── PRIMITIVES (20) ─────────────────────────────────────────────────
const PRIMITIVE_IDS = [
  'cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus',
  'arch', 'ogee', 'torus-knot', 'icosahedron', 'dodecahedron',
  'tetrahedron', 'voxel-cube', 'voxel-sphere', 'suzanne', 'teapot',
  'color-cube', 'spline-helix', 'spline-wave', 'spline-trefoil',
];

// Specialty primitives spawned via their own buttons (B-rep / NURBS / loft).
const SPECIAL_PRIMITIVE_IDS = [
  'brep-boolean', 'nurbs-curve', 'nurbs-surface',
  'sweep-loft', 'trimmed-surface',
];

// ─── RIBBON ACTIONS — discipline -> category -> [ids] ────────────────
// The id matches the data-studio-ribbon-action attribute exactly.
// Categories follow SKILL.md so plans align with what users see.
const RIBBON_ACTIONS = {
  modeling: {
    'Mesh Edit': [
      'extrude', 'inset', 'bevel', 'loop-cut', 'loop-subdivide',
      'subdivide', 'catmull-clark', 'bisect', 'bridge-edges',
      'merge-by-distance', 'weld', 'fill-holes', 'separate',
      'spin-y', 'screw', 'solidify', 'remesh', 'multires',
      'decimate', 'decimate-collapse', 'decimate-unsub', 'decimate-planar',
      'triangulate', 'mark-seam', 'mark-sharp', 'mark-crease',
      'clear-sharp', 'select-all', 'invert-sel', 'loop-select',
      'ring-select', 'flip-normals', 'recalc-normals', 'auto-smooth',
      'set-smooth-face', 'set-flat-face', 'origin-com', 'origin-to-geo',
      'apply-xform', 'clear-xform', 'snap-cursor', 'snap-grid',
      'cursor-sel', 'fracture', 'hide-sel', 'reveal-all', 'lock-xform',
      'repeat-last', 'edge-split', 'beauty-faces', 'weighted-normals',
      'radial-normals', 'symmetrize', 'smooth-n',
      'stretch', 'taper', 'bend', 'twist', 'warp', 'wave',
    ],
    'Modifier Stack': [
      'mod-bevel', 'mod-solidify', 'mod-skin', 'mod-wireframe',
      'mod-triangulate', 'shrinkwrap', 'cast-sphere', 'cast-cuboid',
      'lattice', 'hook', 'laplacian-deform', 'mesh-deform',
      'corrective-smooth', 'displace-noise',
      'apply-mod-stack', 'mod-up', 'mod-down', 'skin-mod', 'wireframe-mod',
    ],
    'Curves & Text': [
      'add-bezier', 'add-nurbs-path', 'draw-curve', 'curve-res', 'curve-mod',
    ],
    'Arrays & Instancing': [
      'apply-array',
      'gn-distribute', 'gn-instance', 'gn-set-pos', 'gn-transform',
      'gn-join', 'gn-mesh-to-points', 'gn-convex-hull', 'gn-bbox',
      'mograph-cloner',
    ],
    'Boolean & Generator': [
      'dynamesh',
    ],
    'Import': [
      'import-fbx', 'import-gltf', 'import-obj', 'import-usd',
    ],
    'Editors': [
      'node-editor', 'material-editor', 'material-instance',
    ],
  },
  sculpting: {
    'Whole-Mesh Sculpt': [
      'sculpt-clay', 'sculpt-scrape', 'sculpt-crease', 'sculpt-pinch',
      'sculpt-flatten', 'sculpt-grab', 'sculpt-layer', 'sculpt-polish',
      'sculpt-mask', 'sculpt-erode', 'sculpt-weather',
    ],
    'Brush': [
      'brush-toggle', 'brush-symmetry-x',
    ],
    'Mask': [
      'mask', 'mask-clear', 'mask-invert',
    ],
    'Retopology': [
      'quad-remesh', 'field-quad-remesh',
    ],
  },
  'uv-texture': {
    'UV': [
      'uv-pack', 'uv-reset', 'uv-cube-proj', 'uv-cyl-proj', 'uv-sph-proj',
      'uv-from-view', 'smart-uv', 'uv-warp',
    ],
    'Shader Graph': [
      'shader-voronoi', 'shader-wave', 'shader-brick',
      'shader-noise', 'shader-magic', 'shader-color-ramp',
    ],
    'Paint': [
      'vertex-paint', 'weight-paint', 'tex-paint-commit',
    ],
    'Bake': [
      'bake-ao', 'bake-normal', 'bake-normals', 'bake-position',
    ],
  },
  rigging: {
    'Armature': [
      'ik-solver', 'pose-mode',
    ],
    'Constraints': [
      'copy-location', 'track-to', 'limit-distance', 'driver-scale',
    ],
  },
  animation: {
    'Keyframes': [
      'build-anim', 'ease-linear', 'ease-constant', 'ease-bezier',
    ],
    'Graph Editors': [
      'animbp-play', 'behavior-tree', 'behaviortree-editor',
      'blueprint-editor', 'blueprint-node',
      'sequencer', 'sequencer-track', 'seq-image', 'camera-path',
      'niagara-editor',
    ],
    'Grease Pencil': [
      'gpencil-layer',
    ],
  },
  'vfx-sim': {
    'Physics': [
      'rigidbody-sim', 'softbody', 'surface-collision',
    ],
    'Particles & FX': [
      'niagara-burst', 'preset-fire', 'preset-smoke', 'preset-sparkle',
    ],
    'Environment': [
      'ocean', 'vol-fog',
    ],
    'AI / Gameplay': [
      'navmesh', 'trigger-volume', 'audio-source',
    ],
  },
  rendering: {
    'Engine': [
      'engine-cycles', 'engine-eevee', 'engine-workbench',
    ],
    'Shading Mode': [
      'shade-solid', 'shade-material', 'shade-rendered',
    ],
    'Lights': [
      'light-point', 'light-sun', 'light-spot', 'light-area',
      'sky-light', 'reflection-probe',
    ],
    'World': [
      'world-hdri', 'world-solid', 'world-fog', 'world-cell',
      'lightmass', 'foliage', 'landscape', 'world-partition',
    ],
    'XR': [
      'enter-xr',
    ],
  },
  compositing: {
    'Post-Process': [
      'comp-bloom', 'comp-vignette', 'comp-pixelate',
      'comp-lens', 'comp-chromatic',
      'pp-ssao', 'pp-motion-blur', 'pp-dof', 'pp-film-grain',
      'pp-lens-flare', 'pp-tone-map', 'pp-auto-exposure',
    ],
  },
  global: {
    'Reference': [
      'ref-front', 'ref-side', 'ref-top', 'ref-clear', 'reference-overlay',
    ],
    'Snapping': [
      'snap-mode',
    ],
    'Palette': [
      'cmd-palette',
    ],
  },
};

// ─── PROPERTY KNOBS — data-studio-<group>="<knob>" ───────────────────
// The executor uses these to type into the right input.
const PROPERTY_KNOBS = {
  material: ['color', 'metalness', 'roughness', 'emissive', 'wireframe'],
  lighting: ['color', 'intensity'],
  brush:    ['active', 'mode', 'radius', 'strength'],
  sculpt:   ['strength'],
  array:    ['mode', 'count', 'radius', 'offsetX', 'offsetY', 'offsetZ'],
  scatter:  ['kind', 'count', 'scale'],
  texture:  ['pattern', 'tiles'],
  proc:     ['depth', 'branches'],
  text3d:   ['input', 'size'],
  compositing: ['filter'],
};

// Selection-edit knobs the executor types into.
const SELECTION_AXES = [
  'position-x', 'position-y', 'position-z',
  'rotation-x', 'rotation-y', 'rotation-z',
  'scale-x', 'scale-y', 'scale-z',
];

// ─── ENTRY-POINT FNS — window.__studio<Name> we call directly ────────
// These bypass the DOM for speed/precision (e.g. polypaint a single
// world-space dab, import an asset buffer, run one physics step).
const ENTRY_POINTS = [
  'AddAudioSource', 'AddNurbsCurve', 'AddNurbsSurface', 'AddRefPlane',
  'AnimBPSet', 'AnimBPStep', 'ApplyMaterialGraph',
  'AudioState',
  'BakeAO', 'BakeNormalFromHeight',
  'BRepBoolean',
  'BrushStrokeAt',
  'BTGraphState', 'BTTick',
  'ClearMask', 'ClearReference', 'Deselect',
  'DynaMesh',
  'EnterXR',
  'EvalNiagara', 'EvalNodeGraph',
  'ExportGltfString',
  'FieldQuadRemesh', 'FrameAll',
  'GetKeyframes',
  'ImportAsset', 'InsertKeyframeAt',
  'InvertMask',
  'LastGltf',
  'ModStackAdd', 'ModStackGet', 'ModStackRemove', 'ModStackReorder',
  'NiagaraStep',
  'PaintMaskAt', 'PaintTextureAt',
  'PhysicsState', 'PhysicsStep',
  'PolyPaintAt',
  'QuadRemesh',
  'ReadNormalTexel', 'ReadTexel', 'ReadVertexColor',
  'ReferenceState',
  'ResetPhysics', 'RevealAll', 'RunBlueprint',
  'SelectMesh', 'SelectedMesh',
  'SetFrame', 'SetListener', 'SetReference',
  'StreamAround', 'SweepLoft', 'SyncDisplay',
  'TrimmedSurface', 'XRSupport',
];

// ─── COMPILE THE FLAT REGISTRY ───────────────────────────────────────
const _registry = [];

for (const id of PRIMITIVE_IDS) {
  _registry.push({
    id, kind: 'primitive', discipline: 'modeling', category: 'Primitive',
    description: `Spawn a ${id.replace('-', ' ')} primitive on the grid.`,
    exec: { type: 'click-primitive', id },
  });
}
for (const id of SPECIAL_PRIMITIVE_IDS) {
  _registry.push({
    id, kind: 'primitive-special', discipline: 'modeling', category: 'Generator',
    description: `Spawn a ${id.replace('-', ' ')} specialty body.`,
    exec: { type: 'click-primitive', id },
  });
}
for (const [discipline, sections] of Object.entries(RIBBON_ACTIONS)) {
  for (const [category, ids] of Object.entries(sections)) {
    for (const id of ids) {
      _registry.push({
        id, kind: 'ribbon-action', discipline, category,
        description: humanise(id, category, discipline),
        exec: { type: 'click-action', id },
      });
    }
  }
}
for (const [group, knobs] of Object.entries(PROPERTY_KNOBS)) {
  for (const knob of knobs) {
    _registry.push({
      id: `${group}:${knob}`, kind: group, discipline: disciplineFor(group),
      category: 'Property',
      description: `Set ${group}.${knob} via [data-studio-${group}="${knob}"].`,
      exec: { type: 'set-param', group, knob },
    });
  }
}
for (const axis of SELECTION_AXES) {
  _registry.push({
    id: `selection:${axis}`, kind: 'property', discipline: 'global',
    category: 'Transform',
    description: `Set selected mesh ${axis} via [data-studio-selection-edit="${axis}"].`,
    exec: { type: 'set-selection', axis },
  });
}
for (const id of ['modeling', 'sculpting', 'uv-texture', 'rigging',
                  'animation', 'vfx-sim', 'rendering', 'compositing']) {
  _registry.push({
    id: `discipline:${id}`, kind: 'discipline', discipline: id,
    category: 'Ribbon Tab',
    description: `Switch active discipline tab to ${id}.`,
    exec: { type: 'click-discipline', id },
  });
}
for (const fnSuffix of ENTRY_POINTS) {
  _registry.push({
    id: `fn:${fnSuffix}`, kind: 'entry-point', discipline: 'global',
    category: 'Programmatic',
    description: `Call window.__studio${fnSuffix}(args).`,
    exec: { type: 'fn', name: `__studio${fnSuffix}` },
  });
}

function disciplineFor(group) {
  switch (group) {
    case 'material': return 'modeling';
    case 'lighting': return 'rendering';
    case 'brush':
    case 'sculpt':   return 'sculpting';
    case 'array':
    case 'scatter':  return 'modeling';
    case 'texture':  return 'uv-texture';
    case 'compositing': return 'compositing';
    case 'proc':
    case 'text3d':   return 'modeling';
    default:         return 'global';
  }
}

// Shorten id -> "Mark Sharp Edges", "Mod Bevel" — good enough for
// the planner's prompt without a 212-entry manual description table.
function humanise(id, category, discipline) {
  const pretty = id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${pretty} (${discipline} / ${category}).`;
}

export const TOOL_REGISTRY = _registry;

/** Build a tool lookup map for fast O(1) plan dispatching. */
export const TOOL_BY_ID = Object.fromEntries(_registry.map((t) => [t.id, t]));

/** Find a tool by id. Returns null if unknown. */
export function findTool(id) { return TOOL_BY_ID[id] || null; }

/** Filter tools by discipline. */
export function toolsForDiscipline(d) {
  return _registry.filter((t) => t.discipline === d);
}

/** Filter tools by kind. */
export function toolsForKind(k) { return _registry.filter((t) => t.kind === k); }

/** All ids the planner is allowed to emit. */
export const ALL_TOOL_IDS = _registry.map((t) => t.id);

/**
 * JSON Schema for a STEP-ARRAY plan (the lower-level format the
 * PlanExecutor runs one entry at a time). The higher-level Studio
 * plan (used by Archie / Planner.js) is the data-driven recipe
 * {goal, scene, bodies, expect} — see Planner.js for that shape.
 */
export const PLAN_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['tool'],
    properties: {
      tool: { type: 'string', enum: ALL_TOOL_IDS,
        description: 'Exact id from TOOL_REGISTRY.' },
      comment: { type: 'string', description: 'Why this step.' },
      params: { type: 'object', additionalProperties: true,
        description: 'Per-tool args (value for property knobs, '
          + 'args for entry-point fns, dwellMs for ribbon actions).' },
    },
  },
};

/** Quick diagnostics — total + per-discipline + per-kind counts. */
export function registrySummary() {
  const byDiscipline = {}, byKind = {};
  for (const t of _registry) {
    byDiscipline[t.discipline] = (byDiscipline[t.discipline] || 0) + 1;
    byKind[t.kind] = (byKind[t.kind] || 0) + 1;
  }
  return { total: _registry.length, byDiscipline, byKind };
}
