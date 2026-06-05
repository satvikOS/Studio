// ArchDisc Studio V3 — Outliner tree traversal.
//
// Pure function. Walks the live three.js Scene from window.__archdiscScene
// (or whatever scene the caller passes), classifies each Object3D, and
// returns a flattened-but-tree-sorted array of row descriptors the React
// panel renders verbatim.
//
// Row shape:
//   {
//     uuid:        string,    // three.js object uuid
//     name:        string,    // object.name or '<unnamed kind>'
//     kind:        string,    // 'mesh' | 'skinnedMesh' | 'group' | 'light'
//                             // | 'camera' | 'helper' | 'bone' | 'line'
//                             // | 'points' | 'object' | 'scene'
//     depth:       number,    // root scene = 0, its children = 1, …
//     parentUuid:  string|null,
//     visible:     boolean,   // object.visible
//     frozen:      boolean,   // userData.archdiscStudioFrozen
//     hasChildren: boolean,   // any traversal-visible children
//   }
//
// Helper / gizmo objects flagged via `userData.archdiscStudioHelper === true`
// (or three's `isHelper`) are tagged 'helper'. The viewport's own
// TransformControls + grid + axes are typically marked with
// userData.archdiscStudioHidden = true; we still emit them so the tree is
// honest, but tag them 'helper' so the React layer can apply a dimmed
// style. The tree is sorted by traversal order — i.e. the order children
// appear in `parent.children`. We do NOT alpha-sort, because Blender's
// outliner preserves insertion order too.

const HIDDEN_USERDATA_KEYS = [
  'archdiscStudioHidden',
];

export function classifyObject(o) {
  if (!o) return 'object';
  if (o.isScene) return 'scene';
  if (o.isBone) return 'bone';
  if (o.isSkinnedMesh) return 'skinnedMesh';
  if (o.isLight) return 'light';
  if (o.isCamera) return 'camera';
  // Three's helpers don't all set isHelper, so consult userData as well.
  if (o.isHelper || (o.userData && (o.userData.isHelper || o.userData.archdiscStudioHelper))) return 'helper';
  if (o.isLineSegments || o.isLine) return 'line';
  if (o.isPoints) return 'points';
  if (o.isMesh) return 'mesh';
  if (o.isGroup) return 'group';
  return 'object';
}

export function displayName(o) {
  if (!o) return '<null>';
  if (typeof o.name === 'string' && o.name.length > 0) return o.name;
  const kind = classifyObject(o);
  return `<unnamed ${kind}>`;
}

// True when the row should be hidden from the tree entirely. Currently
// only used for objects flagged with archdiscStudioHidden — these are
// internal viewport scaffolding (e.g. selection outline mesh swaps).
function isFullyHidden(o) {
  if (!o || !o.userData) return false;
  for (const k of HIDDEN_USERDATA_KEYS) if (o.userData[k]) return true;
  return false;
}

function visibleChildren(o) {
  if (!o || !Array.isArray(o.children)) return [];
  const out = [];
  for (const c of o.children) if (!isFullyHidden(c)) out.push(c);
  return out;
}

// Walk in depth-first traversal order, pre-order so parents appear before
// children. Optionally honours an "expanded" predicate so callers can pass
// a Set<uuid> of expanded nodes and we only descend into those (Blender
// outliner behaviour) — when no predicate is passed, every node is walked.
export function tree(scene, opts = {}) {
  if (!scene) return [];
  const rows = [];
  const isExpanded = typeof opts.isExpanded === 'function'
    ? opts.isExpanded
    : () => true;
  const includeRoot = opts.includeRoot !== false; // default true

  const pushRow = (o, depth, parentUuid) => {
    const kids = visibleChildren(o);
    rows.push({
      uuid: o.uuid,
      name: displayName(o),
      kind: classifyObject(o),
      depth,
      parentUuid,
      visible: o.visible !== false,
      frozen: !!(o.userData && o.userData.archdiscStudioFrozen),
      hasChildren: kids.length > 0,
    });
    if (!isExpanded(o.uuid)) return;
    for (const c of kids) pushRow(c, depth + 1, o.uuid);
  };

  if (includeRoot) {
    pushRow(scene, 0, null);
  } else {
    const kids = visibleChildren(scene);
    for (const c of kids) pushRow(c, 0, null);
  }
  return rows;
}

// Convenience: pull from window.__archdiscScene with the same options.
export function treeFromWindow(opts = {}) {
  if (typeof window === 'undefined') return [];
  return tree(window.__archdiscScene || null, opts);
}

// Quick counts for the panel header. Returns the same shape regardless of
// expansion state, so the header text stays stable.
export function countAll(scene) {
  if (!scene) return { total: 0, byKind: {} };
  let total = 0;
  const byKind = {};
  scene.traverse((o) => {
    if (isFullyHidden(o)) return;
    total += 1;
    const k = classifyObject(o);
    byKind[k] = (byKind[k] || 0) + 1;
  });
  return { total, byKind };
}
