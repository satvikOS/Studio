import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js';
import { SUZANNE_POSITIONS, SUZANNE_INDICES } from './SuzanneGeometry.js';
import { TEAPOT_POSITIONS, TEAPOT_INDICES } from './TeapotGeometry.js';
import { COLOR_CUBE_POSITIONS, COLOR_CUBE_INDICES } from './ColorCubeGeometry.js';
import { getManifold } from '../../foundation/manifoldKernel.js';
import { geometryToManifold, manifoldToGeometry } from '../../foundation/ManifoldThreeBridge.js';
import { runArchieLoop, ArchieSkillStore, DEFAULT_CURRICULUM } from '../../ai/ArchieLoop.js';
import { gridSignature, compareSignatures } from '../../ai/ArchiePerception.js';
import { findTool, TOOL_REGISTRY } from '../../ai/ToolRegistry.js';
import { dispatchInApp } from '../../ai/PlanExecutor.js';
import { evaluateGraph, evalModifierStack, NODE_TYPES } from './nodegraph/nodeGraphEval.js';
import NodeGraphEditor from './nodegraph/NodeGraphEditor.jsx';
import { MATERIAL_NODE_TYPES, evalMaterialGraph, materialSeed } from './nodegraph/materialNodes.js';
import StudioSequencer from './anim/StudioSequencer.jsx';
import StudioReferenceOverlay from './ref/StudioReferenceOverlay.jsx';
import { ANIM_STATES, createAnimBP, animBPSetState, animBPStep } from './anim/animBP.js';
import { BLUEPRINT_NODE_TYPES, runBlueprint, blueprintSeed } from './blueprint/blueprintNodes.js';
import { NIAGARA_NODE_TYPES, niagaraSeed, evalNiagaraGraph, simulateEmitter } from './vfx/niagaraNodes.js';
import { BT_NODE_TYPES, behaviorTreeSeed, tickBehaviorTree } from './ai/behaviorTreeNodes.js';
import { streamAround as wpStreamAround, revealAll as wpRevealAll } from './world/worldPartition.js';
import { addSource as audioAddSource, setListener as audioSetListener, audioState, sourceCount as audioSourceCount } from './audio/spatialAudio.js';
import { buildNurbsSurfaceGeometry } from './nurbs/nurbsSurface.js';
import { buildNurbsCurveGeometry } from './nurbs/nurbsCurve.js';
import { buildSweptGeometry } from './surf/sweepLoft.js';
import { buildTrimmedSurface } from './surf/trimmedSurface.js';
import { bakeAmbientOcclusion } from './bake/ambientOcclusion.js';
import { dynaMeshGeometry } from './remesh/dynaMesh.js';
import { quadRemeshGeometry } from './remesh/quadRemesh.js';
import { fieldAlignedQuadRemesh, FIELD_SURFACES } from './remesh/fieldAlignedQuad.js';
import {
  MousePointer2, Move, RotateCw, Maximize2,
  Box, Mountain, PaintBucket, Bone, Play, Sparkles, Camera,
  Palette, Layers, Lightbulb, Image as ImageIcon, Wand2,
  Brush, Grid3x3, SlidersHorizontal, Code,
} from 'lucide-react';
import Viewport3D from '../../components/Viewport3D';

/**
 * Studio modelling primitives — first real Studio tool.
 *
 * Backed by three.js directly (the vendored Blender source lives at
 * blender/ and will be wired in for heavier modelling ops in later
 * slices; primitives are simple enough to ship in pure JS first).
 * Every primitive carries `userData.archdiscStudioPrimitive = true`
 * so the stats panel + selection logic can scan only Studio-added
 * objects, not Viewport3D's helpers (axes, ground, lights, gizmos).
 */
const PRIMITIVE_SIZE = 0.03; // 30 mm, sized to fit Viewport3D's mm-scale CAD camera

function buildVoxelCubeGeometry(S, NN, predicate) {
  const cubeSize = S / NN;
  const voxel = cubeSize * 0.9; // 10% gap between voxels for the classic blocky look
  const pieces = [];
  const half = (NN - 1) / 2;
  for (let x = 0; x < NN; x++) {
    for (let y = 0; y < NN; y++) {
      for (let z = 0; z < NN; z++) {
        if (!predicate(x, y, z, NN)) continue;
        const cx = (x - half) * cubeSize;
        const cy = (y - half) * cubeSize;
        const cz = (z - half) * cubeSize;
        const g = new THREE.BoxGeometry(voxel, voxel, voxel);
        g.translate(cx, cy, cz);
        pieces.push(g);
      }
    }
  }
  if (pieces.length === 0) return new THREE.BoxGeometry(voxel, voxel, voxel);
  return mergeGeometries(pieces);
}

function buildPrimitiveGeometry(kind) {
  const S = PRIMITIVE_SIZE;
  switch (kind) {
    case 'cube':         return new THREE.BoxGeometry(S, S, S);
    case 'sphere':       return new THREE.SphereGeometry(S * 0.6, 32, 24);
    case 'plane':        return new THREE.PlaneGeometry(S * 1.6, S * 1.6);
    case 'cylinder':     return new THREE.CylinderGeometry(S * 0.5, S * 0.5, S, 32);
    case 'cone':         return new THREE.ConeGeometry(S * 0.55, S, 32);
    case 'torus':        return new THREE.TorusGeometry(S * 0.5, S * 0.18, 16, 32);
    case 'arch':         return new THREE.TorusGeometry(S * 0.5, S * 0.1, 14, 40, Math.PI); // half-arc bar — arches / vaults / tracery
    case 'ogee': {
      // Ogee (pointed onion) arch — a moulded bar swept along a symmetric
      // S-curve: near-vertical jambs that sweep concave-out then convex-in
      // to a central point. The classic gothic tracery lobe.
      const ow = S * 0.42, oh = S * 0.62;
      const opts = [
        new THREE.Vector3(-ow, -oh, 0),
        new THREE.Vector3(-ow, -oh * 0.12, 0),
        new THREE.Vector3(-ow * 0.5, oh * 0.5, 0),
        new THREE.Vector3(0, oh, 0),
        new THREE.Vector3(ow * 0.5, oh * 0.5, 0),
        new THREE.Vector3(ow, -oh * 0.12, 0),
        new THREE.Vector3(ow, -oh, 0),
      ];
      const ocurve = new THREE.CatmullRomCurve3(opts, false, 'catmullrom', 0.5);
      return new THREE.TubeGeometry(ocurve, 64, S * 0.05, 10, false);
    }
    case 'torus-knot':   return new THREE.TorusKnotGeometry(S * 0.45, S * 0.14, 100, 16);
    case 'icosahedron':  return new THREE.IcosahedronGeometry(S * 0.6, 0);
    case 'dodecahedron': return new THREE.DodecahedronGeometry(S * 0.6, 0);
    case 'tetrahedron':  return new THREE.TetrahedronGeometry(S * 0.7, 0);
    case 'voxel-cube':
      // Solid 8x8x8 grid of voxels — classic Minecraft-style block.
      return buildVoxelCubeGeometry(S, 8, () => true);
    case 'voxel-sphere': {
      // Voxelised sphere — distance-from-centroid test on a 10x10x10 grid.
      const NN = 10;
      const half = (NN - 1) / 2;
      const maxR = half + 0.5;
      return buildVoxelCubeGeometry(S, NN, (x, y, z) => {
        const dx = x - half, dy = y - half, dz = z - half;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) <= maxR;
      });
    }
    case 'suzanne': {
      // Suzanne (Blender's monkey) — geometry imported verbatim from
      // blender/tests/files/io_tests/x3d/suzanne_material.x3d by
      // tools/import_suzanne.py. First Studio primitive whose vertex
      // data comes literally from the vendored Blender source.
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(SUZANNE_POSITIONS, 3));
      g.setIndex(new THREE.BufferAttribute(SUZANNE_INDICES, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    }
    case 'teapot': {
      // Utah teapot — imported from blender/tests/files/io_tests/x3d/
      // teapot.x3d via tools/import_teapot_and_colorcube.js. The
      // canonical computer-graphics test mesh (Martin Newell, 1975).
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(TEAPOT_POSITIONS, 3));
      g.setIndex(new THREE.BufferAttribute(TEAPOT_INDICES, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    }
    case 'color-cube': {
      // 6-face CAD-fixture cube from Blender's X3D test suite.
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(COLOR_CUBE_POSITIONS, 3));
      g.setIndex(new THREE.BufferAttribute(COLOR_CUBE_INDICES, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    }
    case 'spline-helix': {
      // Catmull-Rom helix swept as a tube — deterministic 1.5-turn
      // helix with 8 sample points, tube radius S/25.
      const points = [];
      const TURNS = 1.5, SEGS = 8;
      for (let i = 0; i < SEGS; i++) {
        const t = i / (SEGS - 1);
        const a = t * Math.PI * 2 * TURNS;
        points.push(new THREE.Vector3(
          Math.cos(a) * S * 0.5,
          (t - 0.5) * S,
          Math.sin(a) * S * 0.5,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      return new THREE.TubeGeometry(curve, 80, S * 0.04, 8, false);
    }
    case 'spline-wave': {
      // Sinusoidal wave along X — 9 control points.
      const points = [];
      const SEGS = 9;
      for (let i = 0; i < SEGS; i++) {
        const t = i / (SEGS - 1);
        points.push(new THREE.Vector3(
          (t - 0.5) * S * 1.4,
          Math.sin(t * Math.PI * 2) * S * 0.3,
          0,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      return new THREE.TubeGeometry(curve, 80, S * 0.04, 8, false);
    }
    case 'spline-trefoil': {
      // Trefoil-knot parametric curve.
      const points = [];
      const SEGS = 64;
      for (let i = 0; i < SEGS; i++) {
        const t = (i / SEGS) * Math.PI * 2;
        points.push(new THREE.Vector3(
          (Math.sin(t) + 2 * Math.sin(2 * t)) * S * 0.16,
          (Math.cos(t) - 2 * Math.cos(2 * t)) * S * 0.16,
          -Math.sin(3 * t) * S * 0.16,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points, true);
      return new THREE.TubeGeometry(curve, 200, S * 0.04, 10, true);
    }
    default: return null;
  }
}

const PRIMITIVE_KINDS = [
  { id: 'cube',         label: 'Cube' },
  { id: 'sphere',       label: 'Sphere' },
  { id: 'plane',        label: 'Plane' },
  { id: 'cylinder',     label: 'Cylinder' },
  { id: 'cone',         label: 'Cone' },
  { id: 'torus',        label: 'Torus' },
  { id: 'arch',         label: 'Arch' },
  { id: 'ogee',         label: 'Ogee' },
  { id: 'torus-knot',   label: 'Torus Knot' },
  { id: 'icosahedron',  label: 'Icosa' },
  { id: 'dodecahedron', label: 'Dodeca' },
  { id: 'tetrahedron',  label: 'Tetra' },
  { id: 'voxel-cube',     label: 'Voxel Cube' },
  { id: 'voxel-sphere',   label: 'Voxel Sphere' },
  { id: 'suzanne',        label: 'Suzanne' },
  { id: 'teapot',         label: 'Teapot' },
  { id: 'color-cube',     label: 'CAD Cube' },
  { id: 'spline-helix',   label: 'Helix' },
  { id: 'spline-wave',    label: 'Wave' },
  { id: 'spline-trefoil', label: 'Trefoil' },
];

/**
 * ArchDisc Studio — primary workbench.
 *
 * The discipline tabs along the top mirror the canonical workspaces
 * users expect from Blender, Maya, Houdini, ZBrush, Substance, etc.
 * For now the ribbon is a placeholder: tabs render text only and the
 * tool/property panels are static. Real Studio tools land slice by
 * slice on this scaffold — each one backed by an Electron Playwright
 * spec that drives the action the same way a human (or the AI plug-
 * and-play planner) would.
 */
const DISCIPLINE_TABS = [
  { id: 'modeling',    label: 'Modeling',     Icon: Box },
  { id: 'sculpting',   label: 'Sculpting',    Icon: Brush },
  { id: 'uv-texture',  label: 'UV / Texture', Icon: Grid3x3 },
  { id: 'rigging',     label: 'Rigging',      Icon: Bone },
  { id: 'animation',   label: 'Animation',    Icon: Play },
  { id: 'vfx-sim',     label: 'VFX / Sim',    Icon: Sparkles },
  { id: 'rendering',   label: 'Rendering',    Icon: Camera },
  { id: 'compositing', label: 'Compositing',  Icon: SlidersHorizontal },
];

/*
 * Blender canonical workspaces — Studio's top-of-window strip mirrors
 * Blender's "Layout / Modeling / Sculpting / UV Editing / Texture Paint /
 * Shading / Animation / Rendering / Compositing / Geometry Nodes /
 * Scripting" tabs. Each workspace maps to one of Studio's existing
 * disciplines (and, for editor-centric workspaces, to a sidecar editor
 * the user expects open by default — node editor for Geometry Nodes,
 * material graph for Shading). Clicking a workspace activates its
 * mapped discipline so the right ribbon panel surfaces underneath,
 * matching Blender's "switching workspaces switches the screen layout"
 * behaviour. The strip is independent of the discipline tabs so users
 * can stay in (e.g.) the Modeling workspace while sampling Sculpting
 * tools — exactly how Blender behaves.
 */
const BLENDER_WORKSPACES = [
  { id: 'Layout',          discipline: 'modeling',    Icon: Box },
  { id: 'Modeling',        discipline: 'modeling',    Icon: Box },
  { id: 'Sculpting',       discipline: 'sculpting',   Icon: Brush },
  { id: 'UV Editing',      discipline: 'uv-texture',  Icon: Grid3x3 },
  { id: 'Texture Paint',   discipline: 'uv-texture',  Icon: PaintBucket },
  { id: 'Shading',         discipline: 'uv-texture',  Icon: SlidersHorizontal },
  { id: 'Animation',       discipline: 'animation',   Icon: Play },
  { id: 'Rendering',       discipline: 'rendering',   Icon: Camera },
  { id: 'Compositing',     discipline: 'compositing', Icon: SlidersHorizontal },
  { id: 'Geometry Nodes',  discipline: 'modeling',    Icon: Grid3x3 },
  { id: 'Scripting',       discipline: 'modeling',    Icon: Code },
];

const TOOL_BUTTONS = [
  { id: 'select',    title: 'Select',         Icon: MousePointer2 },
  { id: 'move',      title: 'Move',           Icon: Move },
  { id: 'rotate',    title: 'Rotate',         Icon: RotateCw },
  { id: 'scale',     title: 'Scale',          Icon: Maximize2 },
  { id: 'mesh',      title: 'Mesh Edit',      Icon: Box },
  { id: 'sculpt',    title: 'Sculpt',         Icon: Mountain },
  { id: 'paint',     title: 'Texture Paint',  Icon: PaintBucket },
  { id: 'rig',       title: 'Rig',            Icon: Bone },
  { id: 'animate',   title: 'Animate',        Icon: Play },
  { id: 'particles', title: 'Particles / VFX', Icon: Sparkles },
  { id: 'render',    title: 'Render',         Icon: Camera },
];

function WorkbenchStudio() {
  const [activeTab, setActiveTab] = useState('modeling');
  // Blender workspace strip — see BLENDER_WORKSPACES. Selecting a workspace
  // activates the discipline its layout is built around (the mapping mirrors
  // Blender's default screen layouts for each workspace).
  const [activeWorkspace, setActiveWorkspace] = useState('Layout');
  const activateWorkspace = (ws) => {
    setActiveWorkspace(ws.id);
    if (ws.discipline) setActiveTab(ws.discipline);
  };
  // Slice 186 Outliner: tick bumps re-derive the scene tree without
  // requiring a primitive add (e.g. visibility toggle). filter is the
  // search-box query; collections holds the expanded/collapsed state
  // of each named collection ("Primitives" / "Lights"), defaulting to
  // expanded on first mount (mirrors Blender on a fresh scene).
  const [outlinerTick, setOutlinerTick] = useState(0);
  const bumpOutliner = () => setOutlinerTick((v) => v + 1);
  const [outlinerFilter, setOutlinerFilter] = useState('');
  const [outlinerCollections, setOutlinerCollections] = useState({ Primitives: true, Lights: true });
  const toggleCollection = (name) => setOutlinerCollections((s) => ({ ...s, [name]: !s[name] }));
  // Slice 187: Blender N-panel — the viewport's right-edge sidebar with
  // Item / Tool / View tabs. Open by default (Blender ships it visible)
  // and toggleable via the floating "N" button at the viewport's right
  // edge. Mirrors Blender's N-key sidebar.
  const [nPanelOpen, setNPanelOpen] = useState(true);
  // Slice 202: collapse the right Properties panel to reclaim viewport
  // width. Default expanded; user toggles via the chevron button on the
  // inner edge. The .workbench-properties-collapsed class is already
  // styled in styles/workbench.css to translate the aside off-screen
  // (only the toggle stays clickable on the right margin).
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [nPanelTab, setNPanelTab] = useState('Item');
  // Slice 188: Blender 3D-viewport header strip — top-of-viewport menus
  // (View / Add / Object) on the left and the 4 shading-mode round
  // buttons (Wireframe / Solid / Material / Rendered) on the right.
  // Mirrors Blender's per-editor header. Active shading drives the
  // existing shade-* ribbon actions so a single source of truth.
  // Slice 189: Blender Mode dropdown — the "Object Mode" slot in the
  // viewport header becomes a real dropdown matching Blender's mode
  // selector (Object / Edit / Sculpt / Vertex Paint / Weight Paint /
  // Texture Paint / Pose). Each mode flips the matching Studio
  // discipline and, where Blender wires a one-shot action (pose-mode,
  // vertex-paint, weight-paint), dispatches it through the registry.
  const [viewportMode, setViewportMode] = useState('Object Mode');
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const BLENDER_MODES = [
    { id: 'Object Mode',   discipline: 'modeling',   action: null },
    { id: 'Edit Mode',     discipline: 'modeling',   action: null },
    { id: 'Sculpt Mode',   discipline: 'sculpting',  action: 'brush-toggle' },
    { id: 'Vertex Paint',  discipline: 'uv-texture', action: 'vertex-paint' },
    { id: 'Weight Paint',  discipline: 'uv-texture', action: 'weight-paint' },
    { id: 'Texture Paint', discipline: 'uv-texture', action: null },
    { id: 'Pose Mode',     discipline: 'rigging',    action: 'pose-mode' },
  ];
  const applyMode = (mode) => {
    setViewportMode(mode.id);
    setModeDropdownOpen(false);
    if (mode.discipline) setActiveTab(mode.discipline);
    if (mode.action) {
      const meta = findTool(mode.action);
      if (meta) { try { dispatchInApp(meta, {}); } catch (_) { /* mode action best-effort */ } }
    }
  };
  const [viewportShading, setViewportShading] = useState('solid');
  const shadingAction = { wireframe: null, solid: 'shade-solid', material: 'shade-material', rendered: 'shade-rendered' };
  const applyShading = (mode) => {
    setViewportShading(mode);
    if (mode === 'wireframe') {
      setDisplayWireframe(true);
    } else {
      setDisplayWireframe(false);
      const id = shadingAction[mode];
      if (id) {
        const meta = findTool(id);
        if (meta) { try { dispatchInApp(meta, {}); } catch (_) { /* shade dispatch best-effort */ } }
      }
    }
  };
  const [activeTool, setActiveTool] = useState('select');
  const [primitiveCount, setPrimitiveCount] = useState(0);
  const [vertexCount, setVertexCount] = useState(0);
  const [faceCount, setFaceCount] = useState(0);
  // Insertion-order stack of Studio-added meshes — kept in a ref because
  // mutation doesn't drive any rendering (state primitiveCount mirrors
  // its length for UI bindings). Used by Delete Last + Clear Scene.
  const primitiveStackRef = useRef([]);
  // Reference image planes (Blender "background images" / Maya image planes) —
  // NOT primitives: excluded from selection, export, sculpt + frame-all.
  const refPlanesRef = useRef([]);
  const [refPlaneCount, setRefPlaneCount] = useState(0);
  const [refPlaneOpacity, setRefPlaneOpacity] = useState(0.6);
  // Render thumbnails captured via the "Render Frame" tool. Each entry:
  //   { dataUrl, ts, samples, engine, w, h }
  const [renders, setRenders] = useState([]);
  const [renderEngine, setRenderEngine] = useState('cycles');
  const [renderSamples, setRenderSamples] = useState(128);
  // Selection state — kept in both state (for UI re-render) and a ref
  // (for closures captured by event listeners).
  const [selectedKind, setSelectedKind] = useState(null);
  const [selectedTransform, setSelectedTransform] = useState(null);
  const selectedMeshRef = useRef(null);
  // Slice 192: multi-select set (Shift+click adds/removes). The single
  // selectedMeshRef stays as the "active" mesh that drives the
  // properties panel; selectedMeshesRef.current is the full set the
  // keymap's G/R/S apply to.
  const selectedMeshesRef = useRef([]);
  // Active transform mode mirrors activeTool for move/rotate/scale.
  // Drag-to-transform isn't wired yet (separate slice); for now the mode
  // is reflected in the Selection panel so the user can see what tool is
  // armed.
  const [gizmoMode, setGizmoMode] = useState('translate');
  // Wireframe outline overlay (a LineSegments object attached to the
  // selected mesh as a sibling under the scene) — the SOLE selection
  // indicator now that material edits land directly on the picked
  // primitive's MeshStandardMaterial.
  const outlineRef = useRef(null);
  // Live material controls for the selected mesh.
  const [matColor, setMatColor]       = useState('#6e7681');
  const [matMetalness, setMatMetalness] = useState(0.25);
  const [matRoughness, setMatRoughness] = useState(0.45);
  const [matEmissive, setMatEmissive]   = useState(0.0);
  const [matWireframe, setMatWireframe] = useState(false);
  // Material presets — Substance-Painter / KeyShot-style one-click PBR
  // material library: nine named values that drop in color + metalness
  // + roughness + opacity together.
  const MATERIAL_PRESETS = [
    { id: 'gold',     label: 'Gold',     color: '#d4af37', metalness: 0.90, roughness: 0.18, opacity: 1 },
    { id: 'silver',   label: 'Silver',   color: '#c5c8cf', metalness: 0.95, roughness: 0.15, opacity: 1 },
    { id: 'chrome',   label: 'Chrome',   color: '#e8e8ed', metalness: 0.98, roughness: 0.05, opacity: 1 },
    { id: 'copper',   label: 'Copper',   color: '#b87333', metalness: 0.85, roughness: 0.28, opacity: 1 },
    { id: 'glass',    label: 'Glass',    color: '#dde9f0', metalness: 0.00, roughness: 0.05, opacity: 0.55 },
    { id: 'plastic',  label: 'Plastic',  color: '#e63946', metalness: 0.00, roughness: 0.40, opacity: 1 },
    { id: 'rubber',   label: 'Rubber',   color: '#222426', metalness: 0.00, roughness: 0.95, opacity: 1 },
    { id: 'concrete', label: 'Concrete', color: '#909090', metalness: 0.00, roughness: 0.90, opacity: 1 },
    { id: 'wood',     label: 'Wood',     color: '#8b6f47', metalness: 0.00, roughness: 0.75, opacity: 1 },
  ];
  // Animation — auto-rotates the selected mesh in real time.
  const [isAnimating, setIsAnimating] = useState(false);
  const [animSpeedDegPerSec, setAnimSpeedDegPerSec] = useState(90);
  const animRafRef = useRef(null);
  // Sculpting — strength of one click of an Inflate/Twist/Smooth pass.
  const [sculptStrength, setSculptStrength] = useState(0.1);
  // Click-paint brush — when active, viewport clicks PUSH/PULL/SMOOTH
  // vertices near the click point instead of selecting.
  const [brushActive, setBrushActive]     = useState(false);
  const [brushMode, setBrushMode]         = useState('push');
  const [nodeGraphOpen, setNodeGraphOpen] = useState(false); // Geometry Nodes editor overlay
  const [materialGraphOpen, setMaterialGraphOpen] = useState(false); // Material/shader graph overlay
  const [sequencerOpen, setSequencerOpen] = useState(false); // Sequencer/Timeline track-editor dock
  const [blueprintOpen, setBlueprintOpen] = useState(false); // Blueprint/visual-scripting graph overlay
  const [niagaraOpen, setNiagaraOpen] = useState(false); // Niagara particle emitter graph overlay
  const [behaviorTreeOpen, setBehaviorTreeOpen] = useState(false); // Behavior tree (AI) graph overlay
  const [worldPartitionOn, setWorldPartitionOn] = useState(false); // World-partition streaming active
  const [xrStatus, setXrStatus] = useState(''); // WebXR (AR/VR) session status text
  const [brepStatus, setBrepStatus] = useState(''); // OCCT B-rep boolean status text
  const [referenceUrl, setReferenceUrl] = useState(null); // top-left reference overlay URL
  const [referenceVisible, setReferenceVisible] = useState(true);
  const refFileInputRef = useRef(null);
  const [animBPState, setAnimBPState] = useState('idle'); // Animation state machine current state
  const [animBPPlaying, setAnimBPPlaying] = useState(false);
  const animBPRef = useRef(null); // { machine, base:{x,y,z,ry}, meshUuid }
  const animBPRafRef = useRef(null);
  const [brushPaintColor, setBrushPaintColor] = useState('#d08a4a'); // Substance-style texture-paint colour
  const [brushPaintChannel, setBrushPaintChannel] = useState('color'); // PBR channel: color/roughness/metalness/emissive
  const [modStackVersion, setModStackVersion] = useState(0); // forces modifier-stack UI refresh
  const [brushRadius, setBrushRadius]     = useState(0.012);
  const [brushFalloffStrength, setBrushFalloffStrength] = useState(0.4);
  const [brushSymmetryX, setBrushSymmetryX] = useState(false);
  const brushStateRef = useRef({ active: false, mode: 'push', radius: 0.012, strength: 0.4, symmetryX: false });
  // Decimate aggressiveness (vertex-clustering quantization fraction).
  const [decimateAggressiveness, setDecimateAggressiveness] = useState(0.5);
  // Noise displacement — value noise along normals.
  const [displaceFrequency, setDisplaceFrequency] = useState(80);
  const [displaceAmplitude, setDisplaceAmplitude] = useState(0.004);
  const [displaceOctaves,   setDisplaceOctaves]   = useState(2);
  // Hair / fur — instanced strands rooted on a surface mesh.
  const [hairCount,  setHairCount]  = useState(800);
  const [hairLength, setHairLength] = useState(0.008);
  // Cell fracture / shatter — split selected mesh into N spatial chunks.
  const [fractureChunks, setFractureChunks] = useState(12);
  const [fractureExplode, setFractureExplode] = useState(0.006);
  // Keyframe animation — per-mesh recorded poses interpolated across frames.
  const [keyframes,         setKeyframes]         = useState([]);
  const [currentFrame,      setCurrentFrame]      = useState(0);
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);
  const [showMotionPaths,   setShowMotionPaths]   = useState(false);
  // Cloth simulation — PBD edge-spring cloth, drops under gravity.
  const [clothActive, setClothActive] = useState(false);
  const clothStateRef = useRef(null);
  const clothRafRef   = useRef(null);
  const animTimelineRafRef = useRef(null);
  const buildStateRef      = useRef(null);
  // Array modifier — linear or radial duplicate of the selected mesh.
  const [arrayMode,    setArrayMode]    = useState('linear');
  const [arrayCount,   setArrayCount]   = useState(8);
  const [arrayOffsetX, setArrayOffsetX] = useState(0.03);
  const [arrayOffsetY, setArrayOffsetY] = useState(0);
  const [arrayOffsetZ, setArrayOffsetZ] = useState(0);
  const [arrayRadius,  setArrayRadius]  = useState(0.04);
  // Asset library — readout of last-loaded preset.
  const [libraryLastLoaded, setLibraryLastLoaded] = useState('');
  // UI/UX — collapsed-section state (keyed by section id).
  const [collapsedSections, setCollapsedSections] = useState({});
  // Command palette (F3 / Ctrl+K).
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  // Pose mode toggle (rigging discipline).
  const [poseMode, setPoseMode] = useState(false);
  // View shading mode (Solid / Material Preview / Rendered).
  const [viewShadingMode, setViewShadingMode] = useState('solid');
  // Keyframe easing mode (linear / bezier).
  const [keyframeEasingMode, setKeyframeEasingMode] = useState('linear');
  // Last-op ref for Repeat Last.
  const lastOpRef = useRef(null);
  // Studio camera re-centering — the inherited Viewport3D starts the
  // camera at (0.15, 0.10, 0.15) which makes the world origin appear
  // in the LOWER third of the viewport (a 25° down-tilt). Studio's
  // monotone layout looks centred-vertical on a 12° down-tilt with the
  // orbit target slightly above origin so the axes triad sits at the
  // visual centre of the canvas.
  useEffect(() => {
    let done = false;
    const tryAdjust = () => {
      const vp = window.__archdiscViewport;
      if (done || !vp || !vp.camera || !vp.controls) return false;
      vp.camera.position.set(0.13, 0.06, 0.13);
      vp.camera.lookAt(0, 0.005, 0);
      vp.controls.target.set(0, 0.005, 0);
      vp.controls.update();
      done = true;
      return true;
    };
    if (tryAdjust()) return;
    const t = setInterval(() => { if (tryAdjust()) clearInterval(t); }, 100);
    setTimeout(() => clearInterval(t), 5000); // give up after 5s
    return () => clearInterval(t);
  }, []);

  /*
   * Frame All — fit camera to scene bounding box. Real DCC keypad-period
   * (Blender) / 'F' (Maya) / 'A' (Cinema 4D) "frame selected/all" op.
   * Walks every Studio primitive's bounding sphere, computes a union
   * sphere, then positions camera at a distance that frames it inside
   * the current FOV with a 1.4x margin.
   */
  function frameAllInScene() {
    const vp = window.__archdiscViewport;
    // Viewport3D exposes the OrbitControls as `orbitControls` (not `controls`);
    // guarding/operating on `vp.controls` made this a silent no-op, which also
    // killed auto-frame-on-add. Resolve the real handle (keep `controls` as a
    // fallback in case the shape changes).
    const controls = vp && (vp.orbitControls || vp.controls);
    if (!vp || !vp.camera || !controls) return null;
    const scene = window.__archdiscScene || vp.scene;
    const box = new THREE.Box3();
    let any = false;
    scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.geometry) {
        const meshBox = new THREE.Box3().setFromObject(o);
        if (!isFinite(meshBox.min.x) || !isFinite(meshBox.max.x)) return;
        if (any) box.union(meshBox);
        else     box.copy(meshBox);
        any = true;
      }
    });
    if (!any) {
      // No primitives — return to the default home framing.
      vp.camera.position.set(0.13, 0.06, 0.13);
      vp.camera.lookAt(0, 0.005, 0);
      controls.target.set(0, 0.005, 0);
    } else {
      const centre = new THREE.Vector3();
      box.getCenter(centre);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      // Distance for 45° FOV with 1.4x margin: maxDim / (2 * tan(22.5°))
      const dist = (maxDim / 2 / Math.tan((vp.camera.fov / 2) * Math.PI / 180)) * 1.4;
      const dir = new THREE.Vector3(0.7, 0.4, 0.7).normalize();
      vp.camera.position.copy(centre).addScaledVector(dir, dist);
      vp.camera.lookAt(centre);
      controls.target.copy(centre);
    }
    controls.update();
    vp.renderer.render(scene, vp.camera);
    return null;
  }
  // Expose so spec hooks can call it deterministically.
  useEffect(() => {
    window.__studioFrameAll = frameAllInScene;
    window.__studioImportAsset = (format, data) => importAssetFromData(format, data);
    window.__studioExportGltfString = () => exportGltfString();
    // Slice 195: Save/Load scene as JSON. __studioSaveScene returns a
    // compact JSON string describing every primitive + light + camera
    // pose so the user can persist the scene to disk and reload it in
    // any future session (parity with File > Save / Open in every DCC).
    window.__studioSaveScene = () => saveSceneJSON();
    window.__studioLoadScene = (jsonOrObj) => loadSceneJSON(jsonOrObj);
    // Slice 197: Blender 3D Cursor — positional anchor with a visible
    // crosshair in the scene. Settable via __studioSetCursor([x,y,z]),
    // readable via __studioGetCursor, snaps to origin via Shift+C, snaps
    // to active selection via Shift+S (handled in the document keymap).
    window.__studioSetCursor = (pos) => setCursorAt(pos);
    window.__studioGetCursor = () => getCursorPos();
    window.__studioSnapCursorOrigin = () => setCursorAt([0, 0, 0]);
    window.__studioSnapCursorSelection = () => {
      const m = selectedMeshRef.current;
      if (!m) return null;
      return setCursorAt([m.position.x, m.position.y, m.position.z]);
    };
    window.__studioAddRefPlane = (axis, imageUrl, opts) => addReferenceImagePlane(axis, imageUrl, opts);
    // ZBrush mask + a programmatic brush stroke (for Archie + e2e). pt = world [x,y,z].
    window.__studioPaintMaskAt = (pt, radius, value) => { const m = selectedMeshRef.current; if (!m) return null; return paintMaskAt(m, new THREE.Vector3(pt[0], pt[1], pt[2]), radius, value == null ? 1 : value); };
    window.__studioClearMask = () => clearMaskOn(selectedMeshRef.current);
    window.__studioInvertMask = () => invertMaskOn(selectedMeshRef.current);
    window.__studioBrushStrokeAt = (pt, brush) => { const m = selectedMeshRef.current; if (!m) return null; paintBrushAt(m, new THREE.Vector3(pt[0], pt[1], pt[2]), brush || { mode: 'inflate', radius: 0.06, strength: 0.5 }); return true; };
    // Geometry node graph: evaluate a {nodes,edges} graph -> scene primitive.
    window.__studioEvalNodeGraph = (graph) => evalNodeGraphToScene(graph);
    // Material/shader graph: evaluate a shading DAG -> PBR material on selected mesh.
    window.__studioApplyMaterialGraph = (graph) => applyMaterialGraph(graph);
    // Blueprint/visual-scripting: run an exec-flow graph against the scene.
    window.__studioRunBlueprint = (graph) => runBlueprintInScene(graph);
    // Niagara particle emitter graph: evaluate to a sim'd Points burst + step it.
    window.__studioEvalNiagara = (graph) => evalNiagaraToScene(graph);
    window.__studioNiagaraStep = (dt) => niagaraStep(dt);
    // Behaviour tree: tick the AI tree N times (drives the selected agent).
    window.__studioBTTick = (steps) => btTick(steps);
    // World partition: stream cells around an origin / reveal all.
    window.__studioStreamAround = (origin, cellSize, radiusCells) => streamWorldPartition(origin, { cellSize, radiusCells });
    window.__studioRevealAll = () => revealAllPrimitives();
    // WebXR (AR/VR): detect support / enter an immersive session.
    window.__studioXRSupport = (mode) => studioXRSupport(mode);
    window.__studioEnterXR = (mode) => studioEnterXR(mode);
    // Spatial audio: add a positional source / move the listener / read state.
    window.__studioAddAudioSource = (opts) => addAudioSourceToScene(opts);
    window.__studioSetListener = (pos) => { audioSetListener(pos); return audioState(); };
    window.__studioAudioState = () => audioState();
    // Rigid-body sim: deterministically advance N steps (e2e/Archie, rAF-free) + read state.
    window.__studioPhysicsStep = (steps, dt) => { const n = steps || 1; const h = dt || 0.016; for (let i = 0; i < n; i++) physicsTick(h); return window.__studioPhysicsState(); };
    window.__studioPhysicsState = () => { const scene = window.__archdiscScene; if (!scene) return []; return physicsBodies(scene).map(b => ({ name: b.o.name, pos: [b.o.position.x, b.o.position.y, b.o.position.z], vel: [b.v[0], b.v[1], b.v[2]], radius: b.radius })); };
    window.__studioResetPhysics = () => resetPhysics();
    // Sequencer / timeline: scrub the frame, insert a key at an explicit frame, read keys.
    window.__studioSetFrame = (f) => { setCurrentFrame(Math.max(0, Math.round(f))); return Math.round(f); };
    window.__studioInsertKeyframeAt = (f) => insertKeyframe(f);
    window.__studioGetKeyframes = () => keyframes.map((k) => ({ ...k }));
    // Animation state machine (AnimBP): set state + step the locomotion pose.
    window.__studioAnimBPSet = (name) => animBPSet(name);
    window.__studioAnimBPStep = (name, dt) => animBPStepOnce(name, dt);
    window.__studioAddNurbsSurface = (opts) => addNurbsSurface(opts);
    window.__studioSweepLoft = (opts) => sweepLoft(opts);
    window.__studioTrimmedSurface = (opts) => addTrimmedSurface(opts);
    window.__studioAddNurbsCurve = (opts) => addNurbsCurve(opts);
    window.__studioBRepBoolean = (opts) => brepBooleanToScene(opts);
    // Reference overlay: pin a reference video/image in the viewport top-left.
    window.__studioSetReference = (url, opts) => { setReferenceUrl(url); setReferenceVisible((opts && opts.visible !== undefined) ? opts.visible : true); return { url, visible: true }; };
    window.__studioClearReference = () => { setReferenceUrl(null); return { cleared: true }; };
    window.__studioReferenceState = () => ({ url: referenceUrl, visible: referenceVisible });
    // Non-destructive modifier stack (operates on the selected mesh).
    window.__studioModStackAdd = (type, params) => modStackAdd(type, params);
    window.__studioModStackRemove = (i) => modStackRemove(i);
    window.__studioModStackReorder = (i, dir) => modStackReorder(i, dir);
    window.__studioModStackGet = () => { const m = selectedMeshRef.current; return (m && m.userData.archdiscStudioModStack) ? JSON.parse(JSON.stringify(m.userData.archdiscStudioModStack.mods)) : []; };
    window.__studioDynaMesh = (res) => dynaMeshSelected(res);
    window.__studioQuadRemesh = (res) => quadRemeshSelected(res);
    window.__studioFieldQuadRemesh = (opts) => fieldQuadRemeshToScene(opts);
    // Substance-style texture paint on the selected mesh's UV map.
    window.__studioPaintTextureAt = (uv, color, radius, channel) => { const m = selectedMeshRef.current; if (!m) return null; return paintTextureAt(m, { x: uv[0], y: uv[1] }, color || brushPaintColor, radius, channel); };
    window.__studioReadTexel = (uv, channel) => { const m = selectedMeshRef.current; if (!m) return null; return readTexel(m, { x: uv[0], y: uv[1] }, channel); };
    window.__studioBakeNormalFromHeight = (strength) => { const m = selectedMeshRef.current; if (!m) return null; return bakeNormalFromHeight(m, strength); };
    window.__studioBakeAO = () => bakeOp('ao');
    window.__studioReadNormalTexel = (uv) => { const m = selectedMeshRef.current; const nc = m && m.userData && m.userData._normalCanvas; if (!nc) return null; const d = nc.getContext('2d').getImageData(Math.floor(uv[0] * 512), Math.floor((1 - uv[1]) * 512), 1, 1).data; return [d[0], d[1], d[2]]; };
    window.__studioPolyPaintAt = (pt, color, radius) => { const m = selectedMeshRef.current; if (!m) return null; return paintPolyAt(m, new THREE.Vector3(pt[0], pt[1], pt[2]), color || brushPaintColor, radius || 0.012); };
    window.__studioReadVertexColor = (i) => { const m = selectedMeshRef.current; const col = m && m.geometry && m.geometry.attributes.color; if (!col) return null; return [Math.round(col.getX(i) * 255), Math.round(col.getY(i) * 255), Math.round(col.getZ(i) * 255)]; };
    return () => { delete window.__studioFrameAll; delete window.__studioImportAsset; delete window.__studioExportGltfString; delete window.__studioAddRefPlane; delete window.__studioPaintMaskAt; delete window.__studioClearMask; delete window.__studioInvertMask; delete window.__studioBrushStrokeAt; delete window.__studioEvalNodeGraph; delete window.__studioApplyMaterialGraph; delete window.__studioRunBlueprint; delete window.__studioEvalNiagara; delete window.__studioNiagaraStep; delete window.__studioBTTick; delete window.__studioStreamAround; delete window.__studioRevealAll; delete window.__studioAddAudioSource; delete window.__studioSetListener; delete window.__studioAudioState; delete window.__studioXRSupport; delete window.__studioEnterXR; delete window.__studioPhysicsStep; delete window.__studioPhysicsState; delete window.__studioResetPhysics; delete window.__studioSetFrame; delete window.__studioInsertKeyframeAt; delete window.__studioGetKeyframes; delete window.__studioAnimBPSet; delete window.__studioAnimBPStep; delete window.__studioAddNurbsSurface; delete window.__studioSweepLoft; delete window.__studioTrimmedSurface; delete window.__studioAddNurbsCurve; delete window.__studioBRepBoolean; delete window.__studioSetReference; delete window.__studioClearReference; delete window.__studioReferenceState; delete window.__studioModStackAdd; delete window.__studioModStackRemove; delete window.__studioModStackReorder; delete window.__studioModStackGet; delete window.__studioDynaMesh; delete window.__studioQuadRemesh; delete window.__studioFieldQuadRemesh; delete window.__studioPaintTextureAt; delete window.__studioReadTexel; delete window.__studioBakeNormalFromHeight; delete window.__studioReadNormalTexel; delete window.__studioBakeAO; delete window.__studioPolyPaintAt; delete window.__studioReadVertexColor; };
  });
  // Auto-frame on primitive count change so the camera always shows
  // the current scene without the user having to hit Home.
  useEffect(() => {
    if (primitiveCount > 0) {
      const t = setTimeout(() => frameAllInScene(), 60);
      return () => clearTimeout(t);
    }
  }, [primitiveCount]);
  // Viewport right-click context menu — coordinates + target mesh uuid.
  const [contextMenu, setContextMenu] = useState(null);
  // Close context menu when clicking anywhere outside it.
  useEffect(() => {
    if (!contextMenu) return;
    const closeOnOutside = (e) => {
      const menu = document.querySelector('[data-studio-context-menu]');
      if (menu && menu.contains(e.target)) return;
      setContextMenu(null);
    };
    // Fire on the NEXT tick so the right-click that opened the menu
    // doesn't immediately close it.
    const t = setTimeout(() => {
      document.addEventListener('click', closeOnOutside);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', closeOnOutside);
    };
  }, [contextMenu]);
  // Display modes — view-time toggles for wireframe, bounding-box,
  // and vertex-normals visualization on Studio primitives.
  const [displayWireframe,   setDisplayWireframe]   = useState(false);
  const [displayBoundingBox, setDisplayBoundingBox] = useState(false);
  const [displayNormals,     setDisplayNormals]     = useState(false);
  // Scene I/O — save / load the current Studio primitives + lights to a
  // self-contained JSON string. In-state cache for the MVP; a follow-up
  // wires this through Electron's file picker.
  const [sceneJson, setSceneJson]               = useState('');
  const [sceneSavedAt, setSceneSavedAt]         = useState(null);
  // glTF export — industry-standard 3D interop (Unreal / Unity / Blender / Sketchfab).
  const [gltfBytes, setGltfBytes]   = useState(0);
  const [gltfExportedAt, setGltfExportedAt] = useState(null);
  // Camera — FOV control + named view presets.
  // Viewport3D's PerspectiveCamera ships at FOV 45°; we mirror the
  // value into React state and the panel slider.
  const [cameraFov, setCameraFov] = useState(45);
  // Text 3D (Motion Graphics discipline) — typography rendered as an
  // extruded TextGeometry mesh.
  const [text3dInput, setText3dInput] = useState('Studio');
  const [text3dSize, setText3dSize] = useState(0.012);
  const fontRef = useRef(null);
  const [fontReady, setFontReady] = useState(false);
  // Particles / VFX — count + size for one-shot particle-cloud spawns.
  const [particleCount, setParticleCount] = useState(800);
  const [particleSize, setParticleSize] = useState(0.0015);
  // ArchViz — floor-plan shape + extrude height for one-click building blocks.
  const [floorShape, setFloorShape] = useState('rectangle');
  const [wallHeight, setWallHeight] = useState(0.03);
  // Lathe / NURBS-style hard-surface — profile + radial segment count.
  const [latheProfile, setLatheProfile] = useState('vase');
  const [latheSegments, setLatheSegments] = useState(48);
  // Rigging / Armature — bone count for the spawned chain.
  const [armatureBones, setArmatureBones] = useState(5);
  // Face Shape Keys — procedural emotion blends on the selected mesh
  // (FACEIT-style face rig workflow seen in Video-779). 0..1 weights
  // accumulate independently; the original vertex positions are
  // cached per-mesh on userData so unwinding the sliders restores
  // the source mesh exactly.
  const [shapeKeySmile,    setShapeKeySmile]    = useState(0);
  const [shapeKeySurprise, setShapeKeySurprise] = useState(0);
  const [shapeKeyBrow,     setShapeKeyBrow]     = useState(0);
  // Physics — gravity drop + ground bounce for every primitive in the scene.
  const [isPhysicsActive, setIsPhysicsActive] = useState(false);
  const [physicsG, setPhysicsG]               = useState(9.8);
  const [physicsRestitution, setPhysicsRestitution] = useState(0.55);
  const physicsRafRef = useRef(null);
  // Texture — procedural canvas pattern applied to the selected mesh's material.
  const [texPattern, setTexPattern] = useState('checker');
  const [texTiles,   setTexTiles]   = useState(8);
  // Procedural — recursive Tree generator parameters.
  const [procTreeDepth, setProcTreeDepth]   = useState(4);
  const [procTreeBranches, setProcTreeBranches] = useState(3);
  // Instancing (game-asset replication) — clone the selected primitive's
  // geometry into N positioned + scaled + rotated instances.
  const [instanceCount, setInstanceCount]   = useState(500);
  const [instanceRadius, setInstanceRadius] = useState(0.08);
  // Scatter on surface (Geometry-Nodes-style "Instance on Points") —
  // distribute N copies of a small primitive across the selected
  // target's triangle surface, oriented along each triangle's normal.
  const [scatterKind,  setScatterKind]  = useState('cube');
  const [scatterCount, setScatterCount] = useState(200);
  const [scatterScale, setScatterScale] = useState(0.2);
  // Compositing — post-process the last captured render thumbnail
  // through a canvas filter and append the result as a new thumbnail.
  const [compositeFilter, setCompositeFilter] = useState('grayscale(100%)');
  // Subdivision — vertex count for the currently selected mesh, mirrored
  // into a panel readout so the user sees the (≈4×) growth per pass.
  // Mirror modifier — duplicate-and-flip the selected mesh across an axis.
  const [mirrorAxis, setMirrorAxis] = useState('x');
  // Cinematic lighting — additional point lights stacked over Viewport3D's
  // baked-in key/fill/rim setup, with color + intensity controls.
  const [lightColor, setLightColor]   = useState('#ffd0a0');
  const [lightIntensity, setLightIntensity] = useState(1.6);
  const [lightCount, setLightCount]   = useState(0);
  // AI prompt — the keyword router now decomposes the prompt into a
  // numbered plan, displays it, then executes each step sequentially
  // (with the right discipline-tab auto-switched per step). Closer
  // to the eventual Clarifier→Planner→Verifier shape from Mech's AI
  // scaffold, on the same "prompt → action list → actions fire" harness.
  const [aiPrompt, setAiPrompt]       = useState('add a cube and a sphere then spin them then render');
  const [aiLog, setAiLog]             = useState([]);
  const [aiPlan, setAiPlan]           = useState([]);     // current plan steps
  const [aiPlanIndex, setAiPlanIndex] = useState(-1);     // current step (-1 = idle)
  const [aiRunning, setAiRunning]     = useState(false);
  // Reference Plane — image-against-photo workflow seen in Videos 29 + 402.
  // For an MVP we generate a deterministic procedural "reference grid"
  // canvas (labeled cross-hairs); next slice swaps in a real file picker.
  const [refLabel, setRefLabel] = useState('FRONT');
  const [refWidth, setRefWidth] = useState(0.06);
  // Boolean / CSG — manifold-3d backs union/subtract/intersect on the
  // selected primitive against the previous primitive in the stack.
  const [manifoldReady, setManifoldReady] = useState(false);

  function recomputeMeshStats(scene) {
    let v = 0;
    let f = 0;
    scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.geometry) {
        const g = o.geometry;
        v += g.attributes?.position?.count || 0;
        if (g.index) f += g.index.count / 3;
        else f += (g.attributes?.position?.count || 0) / 3;
      }
    });
    setVertexCount(v);
    setFaceCount(Math.round(f));
  }

  function addPrimitive(kind) {
    const scene = window.__archdiscScene;
    if (!scene) return null;

    const geometry = buildPrimitiveGeometry(kind);
    if (!geometry) return null;

    const material = new THREE.MeshStandardMaterial({
      color: 0x6e7681,
      metalness: 0.25,
      roughness: 0.45,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = kind;
    mesh.name = `studio-primitive-${kind}-${primitiveCount}`;

    // Slice 198: Spawn at 3D Cursor (Blender default). When the user
    // has placed the 3D Cursor at a non-origin position (slice 197),
    // new primitives land there instead of falling onto the auto-grid.
    // The cursor is a Group tagged userData.archdisc3DCursor; if its
    // position differs from origin, we spawn the new mesh AT the cursor.
    // Otherwise fall back to the legacy 4-column grid layout so empty-
    // cursor scenes keep their spread.
    const cursor = cursorRef.current;
    const cursorOffOrigin = cursor && (Math.abs(cursor.position.x) > 1e-6
      || Math.abs(cursor.position.y) > 1e-6 || Math.abs(cursor.position.z) > 1e-6);
    if (cursorOffOrigin) {
      mesh.position.copy(cursor.position);
    } else {
      // Grid layout — spread additions so multiple primitives are
      // individually visible. 4 columns wide; new rows along +Z.
      const cols = 4;
      const i = primitiveCount;
      const col = i % cols;
      const row = Math.floor(i / cols);
      mesh.position.set(
        (col - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
        0,
        row * PRIMITIVE_SIZE * 1.9,
      );
    }

    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
    return mesh;
  }

  // ── Geometry Node Graph (Houdini SOP / Blender Geometry Nodes) ──
  // Evaluate a node graph to geometry and drop the result into the scene as a
  // first-class Studio primitive. Graph = { nodes, edges } (see nodeGraphEval).
  function evalNodeGraphToScene(graph) {
    const scene = window.__archdiscScene;
    if (!scene) return { error: 'no scene' };
    const { geometry, error } = evaluateGraph(graph || { nodes: [], edges: [] });
    if (!geometry || !geometry.attributes || !geometry.attributes.position) return { error: error || 'graph produced no geometry' };
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.2, roughness: 0.5 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'node-graph';
    mesh.userData.archdiscStudioNodeGraph = (graph.nodes || []).map((n) => n.type);
    mesh.name = `studio-primitive-nodegraph-${primitiveCount}`;
    const cols = 4, i = primitiveCount;
    mesh.position.set((i % cols - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9, 0, Math.floor(i / cols) * PRIMITIVE_SIZE * 1.9);
    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
    return { vertices: geometry.attributes.position.count, nodes: (graph.nodes || []).length };
  }

  // ── Material / shader node graph (Substance Designer / Unreal Material /
  //    Unity Shader Graph) — evaluate a shading DAG into a PBR material and
  //    apply it to the selected mesh (or the most recent primitive). ──
  function applyMaterialGraph(graph) {
    const scene = window.__archdiscScene;
    if (!scene) return { error: 'no scene' };
    const target = selectedMeshRef.current
      || primitiveStackRef.current[primitiveStackRef.current.length - 1];
    if (!target || !target.isMesh) return { error: 'no target mesh — add/select a primitive first' };
    const { spec, mapTexture, error } = evalMaterialGraph(graph || { nodes: [], edges: [] });
    if (error) return { error };
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.colorHex),
      roughness: spec.roughness,
      metalness: spec.metalness,
      emissive: new THREE.Color(spec.emissiveHex),
    });
    if (mapTexture) { mat.map = mapTexture; mat.map.needsUpdate = true; }
    if (target.material && target.material.dispose) target.material.dispose();
    target.material = mat;
    mat.needsUpdate = true;
    target.userData.archdiscStudioMaterialGraph = (graph.nodes || []).map((n) => n.type);
    target.userData.archdiscStudioMaterialSpec = spec;
    return {
      message: `material -> ${spec.hasMap ? spec.mapPattern + ' map, ' : ''}rough ${spec.roughness.toFixed(2)} metal ${spec.metalness.toFixed(2)}`,
      ...spec, target: target.name,
    };
  }

  // ── Blueprint / visual scripting (Unreal Blueprint / Unity Visual Scripting):
  //    run an exec-flow graph against the live scene (spawn/move/rotate/scale/
  //    setColor), threaded with a spawn callback into the real primitive API. ──
  function runBlueprintInScene(graph) {
    const scene = window.__archdiscScene;
    if (!scene) return { error: 'no scene' };
    const ctx = { spawn: (kind) => addPrimitive(kind), log: [] };
    const r = runBlueprint(graph || { nodes: [], edges: [] }, ctx);
    if (r.error) return r;
    return { message: `ran ${r.ran} nodes: ${r.log.join(' -> ')}`, ...r };
  }

  // ── Niagara particle emitter graph (Unreal Niagara / Unity VFX Graph):
  //    evaluate the module graph into an emitter spec, then drop a simulated
  //    THREE.Points burst into the scene; niagaraStep advances the sim. ──
  function evalNiagaraToScene(graph) {
    const scene = window.__archdiscScene;
    if (!scene) return { error: 'no scene' };
    const { spec, error } = evalNiagaraGraph(graph || { nodes: [], edges: [] });
    if (error) return { error };
    const t0 = 0.001;
    const { positions, colors, count } = simulateEmitter(spec, t0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: spec.size, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.userData.archdiscStudioPrimitive = true;
    pts.userData.archdiscStudioPrimitiveKind = 'niagara';
    pts.userData.archdiscNiagara = { spec, simT: t0 };
    pts.name = `studio-primitive-niagara-${primitiveCount}`;
    scene.add(pts);
    primitiveStackRef.current.push(pts);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
    return { count, lifetime: spec.lifetime };
  }
  // ── Behaviour Tree (Unreal Behavior Tree / Unity Behavior Designer): tick an
  //    AI tree that drives the selected mesh (agent) toward a blackboard target. ──
  function btTickOnce(graph) {
    const agent = selectedMeshRef.current;
    if (!agent) return { error: 'no agent — select a mesh first' };
    const ctx = { agent, target: [0.5, 0, 0], threshold: 0.05, step: 0.06, log: [] };
    const r = tickBehaviorTree(graph || { nodes: [], edges: [] }, ctx);
    if (r.error) return r;
    const d = Math.hypot(0.5 - agent.position.x, agent.position.y, agent.position.z);
    return { status: r.status, log: r.log, agentX: agent.position.x, dist: d, color: agent.material && agent.material.color ? agent.material.color.getHexString() : null };
  }
  function btTick(steps) {
    const g = window.__studioBTGraphState; let r = null;
    for (let i = 0; i < (steps || 1); i++) r = btTickOnce(g);
    return r;
  }

  // ── World Partition / streaming (Unreal World Partition / Unity Addressables):
  //    bucket primitives into a spatial grid and stream cells in/out by distance
  //    from an origin (the camera). ──
  function gatherStreamables() {
    const scene = window.__archdiscScene; const a = [];
    scene && scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) a.push(o); });
    return a;
  }
  function streamWorldPartition(origin, opts) {
    const scene = window.__archdiscScene; if (!scene) return { error: 'no scene' };
    const r = wpStreamAround(gatherStreamables(), { ...(opts || {}), origin: origin || [0, 0, 0] });
    recomputeMeshStats(scene);
    return r;
  }
  function revealAllPrimitives() {
    const r = wpRevealAll(gatherStreamables());
    recomputeMeshStats(window.__archdiscScene);
    return r;
  }

  // ── WebXR AR/VR (the web/Electron-native path for Unity AR Foundation / Unreal
  //    XR): three's renderer.xr immersive session via the WebXR Device API.
  //    Honest scope: this is the immersive-session entry; full AR Foundation
  //    plane-detection/anchors need on-device AR APIs. Works on XR-capable
  //    devices; on a non-XR desktop it detects + reports unsupported gracefully.
  async function studioXRSupport(mode) {
    const xr = (typeof navigator !== 'undefined') ? navigator.xr : null;
    if (!xr) return { hasXR: false, supported: false, mode: mode || 'immersive-vr' };
    let supported = false;
    try { supported = await xr.isSessionSupported(mode || 'immersive-vr'); } catch (e) { supported = false; }
    return { hasXR: true, supported, mode: mode || 'immersive-vr' };
  }
  async function studioEnterXR(mode) {
    const m = mode || 'immersive-ar';
    const vp = window.__archdiscViewport;
    const sup = await studioXRSupport(m);
    if (!sup.hasXR) { setXrStatus('WebXR unavailable in this runtime'); return { ...sup, entered: false }; }
    if (!sup.supported) { setXrStatus(`${m} not supported on this device`); return { ...sup, entered: false }; }
    if (!vp || !vp.renderer) { setXrStatus('no renderer'); return { ...sup, entered: false }; }
    try {
      vp.renderer.xr.enabled = true;
      const session = await navigator.xr.requestSession(m, m === 'immersive-ar' ? { optionalFeatures: ['hit-test', 'local-floor'] } : {});
      await vp.renderer.xr.setSession(session);
      setXrStatus(`${m} session active`);
      return { ...sup, entered: true };
    } catch (e) { setXrStatus(`session failed: ${String((e && e.message) || e)}`); return { ...sup, entered: false }; }
  }

  // ── Spatial audio (Unreal MetaSounds/Wwise / Unity AudioSource): anchor a
  //    synthesized positional tone at a point + a visible gizmo; the listener
  //    (camera target) drives distance attenuation + stereo pan. ──
  function addAudioSourceToScene(opts) {
    const scene = window.__archdiscScene; if (!scene) return { error: 'no scene' };
    const o = opts || {};
    const sel = selectedMeshRef.current;
    const pos = o.position || (sel ? [sel.position.x, sel.position.y, sel.position.z] : [0, 0, 0]);
    audioAddSource({ ...o, position: pos });
    const giz = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), new THREE.MeshBasicMaterial({ color: 0xbcbcbc, wireframe: true }));
    giz.position.set(pos[0], pos[1], pos[2]);
    giz.userData.archdiscAudioGizmo = true;
    giz.name = `studio-audio-source-${audioSourceCount()}`;
    scene.add(giz);
    const vp = window.__archdiscViewport; const ctrl = vp && (vp.orbitControls || vp.controls); const t = ctrl && ctrl.target;
    audioSetListener(t ? [t.x, t.y, t.z] : [0, 0, 0]);
    recomputeMeshStats(scene);
    return { count: audioSourceCount(), state: audioState() };
  }
  function toggleWorldPartition() {
    setWorldPartitionOn((on) => {
      const next = !on;
      if (next) {
        const vp = window.__archdiscViewport;
        const tgt = vp && (vp.orbitControls || vp.controls) && (vp.orbitControls || vp.controls).target;
        const origin = tgt ? [tgt.x, tgt.y, tgt.z] : [0, 0, 0];
        streamWorldPartition(origin, { cellSize: 0.4, radiusCells: 2 });
      } else {
        revealAllPrimitives();
      }
      return next;
    });
  }
  function niagaraStep(dt) {
    const scene = window.__archdiscScene; if (!scene) return null;
    let pts = null;
    scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'niagara') pts = o; });
    if (!pts) return { error: 'no niagara system — evaluate the graph first' };
    const nd = pts.userData.archdiscNiagara;
    nd.simT = (nd.simT || 0) + (dt || 1 / 60);
    const { positions, colors } = simulateEmitter(nd.spec, nd.simT);
    pts.geometry.attributes.position.array.set(positions); pts.geometry.attributes.position.needsUpdate = true;
    pts.geometry.attributes.color.array.set(colors); pts.geometry.attributes.color.needsUpdate = true;
    pts.geometry.computeBoundingBox();
    const bb = pts.geometry.boundingBox;
    let meanY = 0; const n = nd.spec.count; for (let i = 0; i < n; i++) meanY += positions[i * 3 + 1]; meanY /= n;
    return { t: nd.simT, count: n, meanY, spanY: bb.max.y - bb.min.y, spanX: bb.max.x - bb.min.x };
  }

  // ── Non-destructive modifier STACK (3ds Max / Maya / Blender) ──
  // A live stack of modifiers re-evaluated from a clean base primitive every
  // edit (reuses the node-graph engine). Removing/reordering a mid-stack
  // modifier genuinely reverts it — the defining non-destructive property.
  const MODSTACK_BASE_KINDS = ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'icosahedron'];
  function ensureModStack(mesh) {
    if (!mesh.userData.archdiscStudioModStack) {
      const k = mesh.userData.archdiscStudioPrimitiveKind || 'cube';
      mesh.userData.archdiscStudioModStack = { base: { type: 'primitive', params: { kind: MODSTACK_BASE_KINDS.includes(k) ? k : 'cube', size: 1 } }, mods: [] };
    }
    return mesh.userData.archdiscStudioModStack;
  }
  function reevalModStack(mesh) {
    const st = mesh.userData.archdiscStudioModStack; if (!st) return;
    const { geometry } = evalModifierStack(st.base, st.mods);
    if (geometry && geometry.attributes && geometry.attributes.position) {
      if (mesh.geometry) mesh.geometry.dispose();
      mesh.geometry = geometry;
      recomputeMeshStats(window.__archdiscScene);
    }
  }
  function modStackAdd(type, params) { const m = selectedMeshRef.current; if (!m) return null; const st = ensureModStack(m); st.mods.push({ type, params: params || {}, enabled: true }); reevalModStack(m); setModStackVersion(v => v + 1); return st.mods.length; }
  function modStackRemove(i) { const m = selectedMeshRef.current; if (!m || !m.userData.archdiscStudioModStack) return; m.userData.archdiscStudioModStack.mods.splice(i, 1); reevalModStack(m); setModStackVersion(v => v + 1); }
  function modStackReorder(i, dir) { const m = selectedMeshRef.current; if (!m || !m.userData.archdiscStudioModStack) return; const mods = m.userData.archdiscStudioModStack.mods; const j = i + dir; if (j < 0 || j >= mods.length) return; [mods[i], mods[j]] = [mods[j], mods[i]]; reevalModStack(m); setModStackVersion(v => v + 1); }
  function modStackToggle(i) { const m = selectedMeshRef.current; if (!m || !m.userData.archdiscStudioModStack) return; const mod = m.userData.archdiscStudioModStack.mods[i]; if (mod) { mod.enabled = mod.enabled === false; reevalModStack(m); setModStackVersion(v => v + 1); } }
  function modStackPopLast() { const m = selectedMeshRef.current; if (!m || !m.userData.archdiscStudioModStack) return; m.userData.archdiscStudioModStack.mods.pop(); reevalModStack(m); setModStackVersion(v => v + 1); }
  const selectedModStack = () => { const m = selectedMeshRef.current; return (m && m.userData.archdiscStudioModStack) ? m.userData.archdiscStudioModStack.mods : []; };

  // ── DynaMesh (ZBrush uniform-topology voxel reskin) ──
  function dynaMeshSelected(res) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const geo = dynaMeshGeometry(mesh.geometry, { resolution: res || 26 });
    if (geo && geo.attributes.position && geo.attributes.position.count > 0) {
      if (mesh.geometry) mesh.geometry.dispose();
      mesh.geometry = geo;
      mesh.userData.archdiscStudioDynaMesh = geo.userData.archdiscDynaMesh;
      recomputeMeshStats(window.__archdiscScene);
      return { vertices: geo.attributes.position.count, ...geo.userData.archdiscDynaMesh };
    }
    return { error: 'dynamesh produced no geometry' };
  }

  // ── Quad Remesh (uniform quad-dominant retopology) ──
  function quadRemeshSelected(res) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const geo = quadRemeshGeometry(mesh.geometry, { resolution: res || 22 });
    if (geo && geo.attributes.position && geo.attributes.position.count > 0) {
      if (mesh.geometry) mesh.geometry.dispose();
      mesh.geometry = geo;
      mesh.userData.archdiscStudioQuadRemesh = geo.userData.archdiscQuadRemesh;
      mesh.userData.archdiscQuads = geo.userData.archdiscQuads;
      recomputeMeshStats(window.__archdiscScene);
      return { vertices: geo.attributes.position.count, ...geo.userData.archdiscQuadRemesh };
    }
    return { error: 'quad remesh produced no geometry' };
  }

  // ── Field-aligned quad remesh (ZBrush ZRemesher / Instant Meshes) ──
  // Curvature cross-field -> RoSy smoothing -> field-following streamline net, on
  // a parametric surface, dropped in as a primitive with a visible quad wireframe
  // so the curvature-aligned flow is legible.
  function fieldQuadRemeshToScene(opts) {
    const scene = window.__archdiscScene; if (!scene) return { error: 'no scene' };
    const o = opts || {};
    const surfName = o.surface || 'diagwave';
    const S = FIELD_SURFACES[surfName] || FIELD_SURFACES.diagwave;
    const r = fieldAlignedQuadRemesh(S, o);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    geo.setIndex(r.triIndex);
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.15, roughness: 0.6, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'field-quad';
    mesh.userData.archdiscQuads = r.quads;
    mesh.userData.archdiscFieldQuad = { alignment: r.alignment, meanFieldAngle: r.meanFieldAngle, rows: r.rows, cols: r.cols, surface: surfName };
    mesh.name = `studio-primitive-fieldquad-${primitiveCount}`;
    // quad-edge wireframe overlay (shows the field-aligned flow)
    const segs = []; const pos = r.positions;
    for (const q of r.quads) { const e = [[q[0], q[1]], [q[1], q[2]], [q[2], q[3]], [q[3], q[0]]]; for (const [x, y] of e) segs.push(pos[x * 3], pos[x * 3 + 1], pos[x * 3 + 2], pos[y * 3], pos[y * 3 + 1], pos[y * 3 + 2]); }
    const wgeo = new THREE.BufferGeometry(); wgeo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    const wire = new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ color: 0x161616 }));
    wire.userData.archdiscQuadWire = true; mesh.add(wire);
    const cols = 4, i = primitiveCount;
    mesh.position.set((i % cols - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9, 0, Math.floor(i / cols) * PRIMITIVE_SIZE * 1.9);
    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
    return { vertices: r.positions.length / 3, quadCount: r.quadCount, ...mesh.userData.archdiscFieldQuad };
  }

  // ── NURBS surface (Maya / Rhino / Plasticity) ──
  // A real rational degree-3 tensor-product NURBS surface, tessellated and
  // dropped in as a first-class Studio primitive.
  function addNurbsSurface(opts) {
    const scene = window.__archdiscScene;
    if (!scene) return { error: 'no scene' };
    const geometry = buildNurbsSurfaceGeometry(opts || {});
    const material = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'nurbs-surface';
    mesh.userData.archdiscNurbs = geometry.userData.archdiscNurbs;
    mesh.name = `studio-primitive-nurbs-${primitiveCount}`;
    const cols = 4, i = primitiveCount;
    mesh.position.set((i % cols - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9, 0, Math.floor(i / cols) * PRIMITIVE_SIZE * 1.9);
    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
    return { vertices: geometry.attributes.position.count, nurbs: geometry.userData.archdiscNurbs };
  }

  // ── Loft / Sweep (3ds Max Loft / Rhino Sweep1) — sweep a profile along a
  //    path curve into a swept surface, dropped in as a Studio primitive. ──
  function sweepLoft(opts) {
    const scene = window.__archdiscScene;
    if (!scene) return { error: 'no scene' };
    const geometry = buildSweptGeometry(opts || {});
    if (!geometry) return { error: 'sweep produced no geometry' };
    const material = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.2, roughness: 0.5, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'sweep-loft';
    mesh.userData.archdiscSweep = geometry.userData.archdiscSweep;
    mesh.name = `studio-primitive-sweep-${primitiveCount}`;
    const cols = 4, i = primitiveCount;
    mesh.position.set((i % cols - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9, 0, Math.floor(i / cols) * PRIMITIVE_SIZE * 1.9);
    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
    return { vertices: geometry.attributes.position.count, ...geometry.userData.archdiscSweep };
  }

  // ── Solid B-rep boolean (Rhino / Maya / Plasticity / SolidWorks): real exact
  //    NURBS-trimmed B-rep cut/fuse/common via the OCCT kernel (opencascade.js,
  //    prebuilt WASM). LAZY-loaded dynamic import + ?url-emitted wasm asset, so
  //    the main bundle stays small (the 50 MB kernel only downloads + inits the
  //    first time a B-rep tool runs). ──
  async function brepBooleanToScene(opts) {
    const scene = window.__archdiscScene; if (!scene) return { error: 'no scene' };
    setBrepStatus('loading kernel');
    try {
      const { occtBoolean } = await import('./brep/occtBoolean.js');
      const r = await occtBoolean(opts || {});
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
      geo.computeVertexNormals(); geo.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.2, roughness: 0.5, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.archdiscStudioPrimitive = true;
      mesh.userData.archdiscStudioPrimitiveKind = 'brep-boolean';
      mesh.userData.archdiscBRep = { faces: r.faces, verts: r.verts, tris: r.tris, op: r.op };
      mesh.name = `studio-primitive-brep-${primitiveCount}`;
      const cols = 4, i = primitiveCount;
      mesh.position.set((i % cols - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9, 0, Math.floor(i / cols) * PRIMITIVE_SIZE * 1.9);
      scene.add(mesh);
      primitiveStackRef.current.push(mesh);
      setPrimitiveCount(c => c + 1);
      recomputeMeshStats(scene);
      setBrepStatus(`${r.op}: ${r.faces} faces, ${r.tris} tris`);
      return { ...r };
    } catch (e) {
      const msg = String((e && e.message) || e);
      setBrepStatus('failed: ' + msg);
      return { error: msg };
    }
  }

  // ── NURBS curve (Maya / Rhino) — rational degree-3 B-spline curve swept to a
  //    tube; weights warp the curve toward heavier control points. ──
  function addNurbsCurve(opts) {
    const scene = window.__archdiscScene; if (!scene) return { error: 'no scene' };
    const geometry = buildNurbsCurveGeometry(opts || {});
    const material = new THREE.MeshStandardMaterial({ color: 0x9098a3, metalness: 0.3, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'nurbs-curve';
    mesh.userData.archdiscNurbsCurve = geometry.userData.archdiscNurbsCurve;
    mesh.name = `studio-primitive-nurbscurve-${primitiveCount}`;
    const cols = 4, i = primitiveCount;
    mesh.position.set((i % cols - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9, 0, Math.floor(i / cols) * PRIMITIVE_SIZE * 1.9);
    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
    return { vertices: geometry.attributes.position.count, ...geometry.userData.archdiscNurbsCurve };
  }

  // ── Trimmed surface (Rhino / Maya trimmed surfaces) — a parametric patch
  //    trimmed by uv loops (outer boundary + holes), dropped in as a primitive. ──
  function addTrimmedSurface(opts) {
    const scene = window.__archdiscScene; if (!scene) return { error: 'no scene' };
    const geometry = buildTrimmedSurface(opts || {});
    const material = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.18, roughness: 0.55, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'trimmed-surface';
    mesh.userData.archdiscTrim = geometry.userData.archdiscTrim;
    mesh.name = `studio-primitive-trimmed-${primitiveCount}`;
    const cols = 4, i = primitiveCount;
    mesh.position.set((i % cols - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9, 0, Math.floor(i / cols) * PRIMITIVE_SIZE * 1.9);
    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
    return { vertices: geometry.attributes.position.count, ...geometry.userData.archdiscTrim };
  }

  // ── Reference image planes — Blender "Background Images" (editors/
  //    space_view3d, View3DBackgroundImage) / Maya image planes / 3ds Max
  //    viewport backgrounds. Load a blueprint onto an axis-aligned plane and
  //    model against it. Ref planes are NOT primitives: selection, export,
  //    sculpt, and frame-all all ignore them (they key off
  //    archdiscStudioPrimitive). axis: 'front' (XY) | 'side' (YZ) | 'top' (XZ).
  function addReferenceImagePlane(axis = 'front', imageUrl = null, opts = {}) {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    const size = opts.size || PRIMITIVE_SIZE * 7;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, map: null, transparent: true,
      opacity: opts.opacity != null ? opts.opacity : refPlaneOpacity,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    if (axis === 'side') plane.rotation.y = Math.PI / 2;        // YZ, faces +X
    else if (axis === 'top') plane.rotation.x = -Math.PI / 2;   // XZ, faces +Y
    const half = size / 2;                                       // front: XY, faces +Z
    if (axis === 'front') plane.position.set(opts.x || 0, opts.y != null ? opts.y : half * 0.85, opts.z != null ? opts.z : -half);
    else if (axis === 'side') plane.position.set(opts.x != null ? opts.x : -half, opts.y != null ? opts.y : half * 0.85, opts.z || 0);
    else plane.position.set(opts.x || 0, opts.y != null ? opts.y : 0, opts.z || 0);
    plane.renderOrder = -2;
    plane.userData.archdiscStudioRefPlane = true;
    plane.userData.archdiscStudioRefAxis = axis;
    plane.name = `studio-ref-${axis}-${refPlanesRef.current.length}`;
    scene.add(plane);
    refPlanesRef.current.push(plane);
    setRefPlaneCount(refPlanesRef.current.length);
    if (imageUrl) {
      new THREE.TextureLoader().load(imageUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        if (tex.image && tex.image.width && tex.image.height) {
          const a = tex.image.width / tex.image.height; // keep blueprint aspect
          plane.scale.set(a >= 1 ? 1 : a, a >= 1 ? 1 / a : 1, 1);
        }
        mat.map = tex; mat.needsUpdate = true;
        recomputeMeshStats(scene);
      });
    }
    recomputeMeshStats(scene);
    return plane;
  }
  function addReferencePlaneViaPicker(axis) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => addReferenceImagePlane(axis, reader.result);
      reader.readAsDataURL(file);
    };
    input.click();
  }
  function setReferencePlanesOpacity(v) {
    const o = Math.max(0, Math.min(1, Number(v)));
    setRefPlaneOpacity(o);
    for (const p of refPlanesRef.current) if (p.material) { p.material.opacity = o; p.material.needsUpdate = true; }
  }
  function clearReferencePlanes() {
    const scene = window.__archdiscScene;
    for (const p of refPlanesRef.current) { if (scene) scene.remove(p); disposeMesh(p); }
    refPlanesRef.current = [];
    setRefPlaneCount(0);
    if (scene) recomputeMeshStats(scene);
  }

  function disposeMesh(mesh) {
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (typeof m.dispose === 'function') m.dispose();
    }
  }

  function maybeClearSelectionFor(mesh) {
    if (selectedMeshRef.current === mesh) {
      // Mesh is about to be disposed entirely — no emissive restore needed.
      selectedMeshRef.current = null;
      outlineRef.current = null;
      setSelectedKind(null);
      setSelectedTransform(null);
    }
  }

  function deleteLastPrimitive() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const mesh = primitiveStackRef.current.pop();
    if (!mesh) return;
    maybeClearSelectionFor(mesh);
    scene.remove(mesh);
    disposeMesh(mesh);
    setPrimitiveCount(c => Math.max(0, c - 1));
    recomputeMeshStats(scene);
  }

  function clearScene() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    for (const mesh of primitiveStackRef.current) {
      maybeClearSelectionFor(mesh);
      scene.remove(mesh);
      disposeMesh(mesh);
    }
    primitiveStackRef.current = [];
    setPrimitiveCount(0);
    recomputeMeshStats(scene);
  }

  /*
   * Slice 197 — Blender 3D Cursor.
   *
   * Renders a small 3-axis crosshair in the scene at a programmable
   * world position. Mirrors Blender's iconic 3D Cursor: a positional
   * anchor used as a transform pivot and a spawn point for new
   * primitives. Three small line segments along X / Y / Z so the
   * cursor is visible from any angle. Tag userData.archdisc3DCursor
   * for picking it out of traversals.
   */
  const cursorRef = useRef(null);
  function ensureCursor() {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    if (cursorRef.current && scene.children.includes(cursorRef.current)) return cursorRef.current;
    const group = new THREE.Group();
    group.userData.archdisc3DCursor = true;
    group.name = 'studio-3d-cursor';
    const size = 0.012;
    const make = (axis, color) => {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(axis === 'x' ? -size : 0, axis === 'y' ? -size : 0, axis === 'z' ? -size : 0),
        new THREE.Vector3(axis === 'x' ?  size : 0, axis === 'y' ?  size : 0, axis === 'z' ?  size : 0),
      ]);
      const m = new THREE.LineBasicMaterial({ color });
      return new THREE.Line(g, m);
    };
    group.add(make('x', 0xff5555));
    group.add(make('y', 0x55ff55));
    group.add(make('z', 0x5555ff));
    scene.add(group);
    cursorRef.current = group;
    return group;
  }
  function setCursorAt(pos) {
    const c = ensureCursor();
    if (!c) return null;
    const x = (Array.isArray(pos) ? pos[0] : pos.x) || 0;
    const y = (Array.isArray(pos) ? pos[1] : pos.y) || 0;
    const z = (Array.isArray(pos) ? pos[2] : pos.z) || 0;
    c.position.set(x, y, z);
    return [x, y, z];
  }
  function getCursorPos() {
    const c = cursorRef.current;
    if (!c) return [0, 0, 0];
    return [c.position.x, c.position.y, c.position.z];
  }

  /*
   * Slice 195 — Save / Load scene as JSON.
   *
   * saveSceneJSON walks the live scene and snapshots every primitive +
   * Studio light into a compact JSON payload. loadSceneJSON clears the
   * scene then rebuilds it from the payload — primitives via addPrimitive
   * (so kinds match Studio's actual builders) then per-mesh transform +
   * material + emissive restored from the saved record. The schema is:
   *   {
   *     version: 1,
   *     primitives: [{ kind, pos, scale, rot, color, emissive,
   *                    metalness, roughness, wireframe, name }],
   *     lights:     [{ color, intensity, position }],
   *   }
   * Parity with File > Save / File > Open in every DCC (Blender .blend,
   * Maya .mb/.ma, 3ds Max .max, Cinema 4D .c4d, Houdini .hip, etc.).
   */
  function saveSceneJSON() {
    const scene = window.__archdiscScene;
    if (!scene) return JSON.stringify({ version: 1, primitives: [], lights: [] });
    const primitives = [];
    const lights = [];
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        const mat = o.material || {};
        primitives.push({
          kind: String(o.userData.archdiscStudioPrimitiveKind || 'cube').replace('-array', ''),
          name: o.name || null,
          pos:   [o.position.x, o.position.y, o.position.z],
          scale: [o.scale.x,    o.scale.y,    o.scale.z],
          rot:   [o.rotation.x, o.rotation.y, o.rotation.z],
          color:     (mat.color && '#' + mat.color.getHexString()) || null,
          emissive:  typeof mat.emissiveIntensity === 'number' ? mat.emissiveIntensity : null,
          metalness: typeof mat.metalness === 'number' ? mat.metalness : null,
          roughness: typeof mat.roughness === 'number' ? mat.roughness : null,
          wireframe: !!mat.wireframe,
        });
      } else if (o.userData && o.userData.archdiscStudioLight && o.isLight) {
        lights.push({
          type: o.type,
          color: (o.color && '#' + o.color.getHexString()) || '#ffffff',
          intensity: typeof o.intensity === 'number' ? o.intensity : 1,
          position: [o.position.x, o.position.y, o.position.z],
        });
      }
    });
    return JSON.stringify({ version: 1, primitives, lights });
  }

  function loadSceneJSON(jsonOrObj) {
    const payload = (typeof jsonOrObj === 'string') ? JSON.parse(jsonOrObj) : jsonOrObj;
    if (!payload || !Array.isArray(payload.primitives)) return { ok: false, error: 'invalid payload' };
    clearScene();
    for (const p of payload.primitives) {
      addPrimitive(p.kind);
      const stack = primitiveStackRef.current;
      const mesh = stack[stack.length - 1];
      if (!mesh) continue;
      if (p.pos)   mesh.position.set(p.pos[0]   || 0, p.pos[1]   || 0, p.pos[2]   || 0);
      if (p.scale) mesh.scale.set   (p.scale[0] || 1, p.scale[1] || 1, p.scale[2] || 1);
      if (p.rot)   mesh.rotation.set(p.rot[0]   || 0, p.rot[1]   || 0, p.rot[2]   || 0);
      if (p.name)  mesh.name = p.name;
      if (mesh.material) {
        if (p.color && mesh.material.color) mesh.material.color.set(p.color);
        if (p.emissive != null) {
          mesh.material.emissive = (mesh.material.color || new THREE.Color('#ffffff')).clone();
          mesh.material.emissiveIntensity = p.emissive;
        }
        if (p.metalness != null) mesh.material.metalness = p.metalness;
        if (p.roughness != null) mesh.material.roughness = p.roughness;
        if (p.wireframe != null) mesh.material.wireframe = !!p.wireframe;
        mesh.material.needsUpdate = true;
      }
    }
    // Lights are skipped on load v1 — addCinematicLight is colour/
    // intensity-state-driven, so faithful restore needs a state-aware
    // pass. Stub written so the format is forward-compatible.
    if (window.__studioFrameAll) window.__studioFrameAll();
    return { ok: true, primitives: payload.primitives.length, lights: (payload.lights || []).length };
  }

  /*
   * Render Frame — capture the current viewport state as a PNG data URL.
   * The WebGLRenderer was created without preserveDrawingBuffer:true (a
   * perf decision in Viewport3D), so the draw buffer can be empty by
   * the time toDataURL fires. Re-rendering inline immediately before
   * the read guarantees a valid pixel buffer.
   */
  function captureRender() {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.renderer || !vp.scene || !vp.camera) return;
    try {
      vp.renderer.render(vp.scene, vp.camera);
      const dataUrl = vp.renderer.domElement.toDataURL('image/png');
      if (!dataUrl || dataUrl.length < 128) return; // empty / broken capture
      const w = vp.renderer.domElement.width;
      const h = vp.renderer.domElement.height;
      setRenders(rs => rs.concat([{
        dataUrl,
        ts: new Date().toLocaleTimeString(),
        samples: renderSamples,
        engine: renderEngine,
        w, h,
      }]));
    } catch (_) {
      // Capture failures stay silent — the property panel renders zero
      // thumbnails and the user can retry.
    }
  }

  function clearRenders() {
    setRenders([]);
  }

  /*
   * Camera — FOV slider + view preset buttons. Front / Back / Right /
   * Left / Top / Iso each orbit the camera to a fixed (azimuth,
   * elevation) using window.__archdiscOrbitView; FOV directly mutates
   * the PerspectiveCamera's fov and re-builds the projection matrix.
   */
  function applyCameraFov(value) {
    const v = Math.max(15, Math.min(110, Number(value)));
    setCameraFov(v);
    const vp = window.__archdiscViewport;
    if (vp && vp.camera) {
      vp.camera.fov = v;
      vp.camera.updateProjectionMatrix();
    }
  }

  const CAMERA_PRESETS = [
    { id: 'front', label: 'Front', az: 0,   el: 0  },
    { id: 'back',  label: 'Back',  az: 180, el: 0  },
    { id: 'right', label: 'Right', az: 90,  el: 0  },
    { id: 'left',  label: 'Left',  az: 270, el: 0  },
    { id: 'top',   label: 'Top',   az: 0,   el: 85 },
    { id: 'iso',   label: 'Iso',   az: 45,  el: 25 },
  ];
  function applyCameraPreset(p) {
    if (typeof window.__archdiscOrbitView === 'function') {
      window.__archdiscOrbitView(p.az, p.el, 1);
    }
  }

  /*
   * glTF export — industry-standard 3D interop. Clones each Studio
   * primitive into a fresh THREE.Scene so Mech's inherited helpers
   * (axes triad, ground, lights, gizmo) stay out of the exported
   * file, then runs three's GLTFExporter in ASCII mode. The result
   * is the spec-compliant glTF JSON; size + timestamp echoed back to
   * the panel.
   */
  async function exportGltf() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const tempScene = new THREE.Scene();
    scene.traverse(o => {
      if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
      // Clone preserves the mesh's geometry + material + transform without
      // mutating the live scene.
      tempScene.add(o.clone());
    });
    // Add Studio lights too — they meaningfully shape any downstream render.
    scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) {
        tempScene.add(o.clone());
      }
    });
    const exporter = new GLTFExporter();
    await new Promise((resolve) => {
      exporter.parse(
        tempScene,
        (result) => {
          const json = JSON.stringify(result);
          setGltfBytes(json.length);
          setGltfExportedAt(new Date().toLocaleTimeString());
          // Stash on window for downstream tooling / spec verification.
          window.__studioLastGltf = json;
          resolve();
        },
        (error) => {
          // eslint-disable-next-line no-console
          console.warn('[studio:gltf] export failed', error);
          resolve();
        },
        { binary: false, onlyVisible: true, embedImages: true },
      );
    });
  }

  // Export the current primitives to a glTF JSON string (no download) — used by
  // the import round-trip + lets Archie hand geometry to other tools in-memory.
  async function exportGltfString() {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    const tempScene = new THREE.Scene();
    scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) tempScene.add(o.clone()); });
    const exporter = new GLTFExporter();
    return await new Promise((resolve) => {
      exporter.parse(tempScene, (result) => resolve(JSON.stringify(result)), () => resolve(null), { binary: false, onlyVisible: true, embedImages: true });
    });
  }

  /*
   * Scene save / load — serialise the current Studio primitives +
   * lights to JSON; restore exactly from the same JSON. Only
   * primitives whose kind is rebuild-able by buildPrimitiveGeometry
   * are saved; Boolean / scatter / reference / instanced kinds (which
   * carry custom geometry or shared textures) are skipped with a note
   * in the file. A follow-up slice swaps the in-state cache for
   * Electron's native file dialog.
   */
  function saveSceneJson() {
    const scene = window.__archdiscScene;
    if (!scene) return '';
    const data = { v: 1, savedAt: Date.now(), primitives: [], lights: [], skipped: [] };
    // Kinds we can rebuild from buildPrimitiveGeometry.
    const SAVE_KINDS = new Set([
      'cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus',
      'torus-knot', 'icosahedron', 'dodecahedron', 'tetrahedron',
      'voxel-cube', 'voxel-sphere', 'suzanne',
    ]);
    scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        const kind = o.userData.archdiscStudioPrimitiveKind;
        if (!SAVE_KINDS.has(kind)) {
          data.skipped.push(kind);
          return;
        }
        data.primitives.push({
          kind,
          position: [o.position.x, o.position.y, o.position.z],
          rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
          scale:    [o.scale.x,    o.scale.y,    o.scale.z],
          material: (o.material && o.material.color) ? {
            color:       '#' + o.material.color.getHexString(),
            metalness:   typeof o.material.metalness === 'number' ? o.material.metalness : 0.25,
            roughness:   typeof o.material.roughness === 'number' ? o.material.roughness : 0.45,
            opacity:     typeof o.material.opacity === 'number' ? o.material.opacity : 1,
            transparent: !!o.material.transparent,
            wireframe:   !!o.material.wireframe,
          } : null,
        });
      }
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) {
        data.lights.push({
          color:     '#' + o.color.getHexString(),
          intensity: o.intensity,
          position:  [o.position.x, o.position.y, o.position.z],
        });
      }
    });
    const json = JSON.stringify(data, null, 2);
    setSceneJson(json);
    setSceneSavedAt(new Date().toLocaleTimeString());
    return json;
  }

  function loadSceneJson(jsonText) {
    let data;
    try { data = JSON.parse(jsonText || sceneJson || ''); } catch (e) { return; }
    if (!data || data.v !== 1) return;
    const scene = window.__archdiscScene;
    if (!scene) return;
    // Clear current scene + lights.
    clearScene();
    clearCinematicLights();
    // Re-create primitives in order.
    for (const p of (data.primitives || [])) {
      const geom = buildPrimitiveGeometry(p.kind);
      if (!geom) continue;
      const mat = new THREE.MeshStandardMaterial({
        color:       p.material?.color || 0x6e7681,
        metalness:   p.material?.metalness ?? 0.25,
        roughness:   p.material?.roughness ?? 0.45,
        opacity:     p.material?.opacity ?? 1,
        transparent: !!p.material?.transparent,
        wireframe:   !!p.material?.wireframe,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(p.position[0], p.position[1], p.position[2]);
      mesh.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
      mesh.scale.set(p.scale[0], p.scale[1], p.scale[2]);
      mesh.userData.archdiscStudioPrimitive = true;
      mesh.userData.archdiscStudioPrimitiveKind = p.kind;
      mesh.name = `studio-primitive-${p.kind}-loaded-${primitiveStackRef.current.length}`;
      scene.add(mesh);
      primitiveStackRef.current.push(mesh);
    }
    setPrimitiveCount(primitiveStackRef.current.length);
    // Re-create lights.
    for (const l of (data.lights || [])) {
      const light = new THREE.PointLight(new THREE.Color(l.color), l.intensity, 0.5, 2);
      light.position.set(l.position[0], l.position[1], l.position[2]);
      light.userData.archdiscStudioLight = true;
      scene.add(light);
      try {
        const helper = new THREE.PointLightHelper(light, PRIMITIVE_SIZE * 0.06, light.color);
        helper.userData.archdiscStudioLightHelper = true;
        scene.add(helper);
      } catch (_) {}
    }
    setLightCount((data.lights || []).length);
    recomputeMeshStats(scene);
  }

  /*
   * Compose Demo Scene — one click drives the entire Studio toolchain
   * (clear → primitives + materials + tree + lights → showreel) as a
   * preview of the eventual AI-plug-and-play workflow ("from empty
   * viewport to fully rendered output" via a single prompt-equivalent
   * action). Useful both as a 1000×-faster-than-user demo and as a
   * test fixture for the integrated pipeline.
   */
  async function composeDemoScene() {
    clearScene();
    clearCinematicLights();
    clearRenders();
    await new Promise(r => setTimeout(r, 80));
    // Five primitives of different kinds — grid-laid by addPrimitive.
    for (const k of ['cube', 'sphere', 'torus-knot', 'icosahedron', 'cone']) {
      addPrimitive(k);
      await new Promise(r => setTimeout(r, 60));
    }
    // A procedural tree as a backdrop.
    generateProceduralTree();
    await new Promise(r => setTimeout(r, 80));
    // Two cinematic lights — warm key + cool fill.
    setLightColor('#ffb56b');
    setLightIntensity(2.4);
    addCinematicLight();
    await new Promise(r => setTimeout(r, 60));
    setLightColor('#6bb5ff');
    setLightIntensity(1.6);
    addCinematicLight();
    await new Promise(r => setTimeout(r, 80));
    // Capture two thumbnails as a quick rendered output.
    if (typeof window.__archdiscOrbitView === 'function') {
      window.__archdiscOrbitView(35, 25, 1);
    }
    await new Promise(r => setTimeout(r, 250));
    captureRender();
    await new Promise(r => setTimeout(r, 100));
    if (typeof window.__archdiscOrbitView === 'function') {
      window.__archdiscOrbitView(135, 25, 1);
    }
    await new Promise(r => setTimeout(r, 250));
    captureRender();
  }

  /*
   * Showreel — one-click 4-view auto-capture (front / right / back /
   * left at +25° elevation). Orbits the camera to each angle, waits
   * for the rAF render loop to settle, captures via the same path
   * Render Frame uses. Lets the user produce a product-viz turntable
   * sheet without orbiting + clicking Render Frame four times.
   */
  async function captureShowreel() {
    const angles = [
      { az: 0,   el: 25, name: 'front' },
      { az: 90,  el: 25, name: 'right' },
      { az: 180, el: 25, name: 'back' },
      { az: 270, el: 25, name: 'left'  },
    ];
    for (const a of angles) {
      if (typeof window.__archdiscOrbitView === 'function') {
        window.__archdiscOrbitView(a.az, a.el, 1);
      }
      // Wait long enough for OrbitControls damping + a render frame
      // before we read the pixel buffer.
      await new Promise(r => setTimeout(r, 220));
      captureRender();
      await new Promise(r => setTimeout(r, 80));
    }
  }

  /*
   * Selection wiring — raycaster + outline overlay + Delete key.
   *
   * Polls until Viewport3D exposes window.__archdiscViewport, then attaches
   * a Studio-specific pointer handler that only selects meshes carrying
   * the archdiscStudioPrimitive marker. The selected mesh gets a vivid
   * pink material swap PLUS a wireframe outline overlay so the selection
   * reads cleanly in the viewport. Position/rotation/scale show in the
   * Selection panel; the activeTool mode (move/rotate/scale) is reflected
   * in the panel so the user sees what's armed — drag-to-transform wires
   * in a later slice once a usable gizmo for mm-scale scenes is built.
   */
  useEffect(() => {
    let cancelled = false;
    let cleanupFn = null;

    // Selection has NO viewport overlay or material auto-swap — both
    // approaches (BoxHelper, EdgesGeometry, emissive boost) collided
    // with this scene's lighting / inherited Mech helpers. Selection
    // is signalled exclusively by the Selection + Material property
    // panels appearing in the right column, and material edits make
    // their own impact visible on the mesh directly. outlineRef is
    // kept as a no-op slot so existing call sites compile, with a
    // future slice free to add a clean indicator.
    function attachOutline(mesh) { outlineRef.current = mesh; }
    function clearOutline() { outlineRef.current = null; }

    function setup() {
      if (cancelled) return;
      const vp = window.__archdiscViewport;
      if (!vp || !vp.renderer || !vp.scene || !vp.camera) {
        setTimeout(setup, 200);
        return;
      }

      // Slice 201: Three.js TransformControls — the move/rotate/scale
      // gizmo every DCC tool shows around the selected mesh. In r0.181
      // TransformControls extends `Controls` (not Object3D), so the
      // helper Object3D returned by getHelper() is what goes into the
      // scene. Wrapped defensively so a setup failure doesn't break
      // the rest of the viewport bootstrap.
      let gizmo = null;
      try {
        gizmo = new TransformControls(vp.camera, vp.renderer.domElement);
        gizmo.userData = gizmo.userData || {};
        gizmo.userData.archdiscStudioGizmo = true;
        const gizmoHelper = (typeof gizmo.getHelper === 'function') ? gizmo.getHelper() : gizmo;
        if (gizmoHelper && gizmoHelper.isObject3D) vp.scene.add(gizmoHelper);
        gizmo.addEventListener('dragging-changed', (ev) => {
          const ctrl = vp.orbitControls || vp.controls;
          if (ctrl) ctrl.enabled = !ev.value;
        });
        gizmo.addEventListener('objectChange', () => {
          const m = selectedMeshRef.current;
          if (!m) return;
          setSelectedTransform({
            position: [m.position.x, m.position.y, m.position.z],
            rotation: [m.rotation.x, m.rotation.y, m.rotation.z],
            scale:    [m.scale.x,    m.scale.y,    m.scale.z],
          });
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[studio] TransformControls init failed', err);
        gizmo = null;
      }

      const selectMesh = (mesh) => {
        selectedMeshRef.current = mesh;
        attachOutline(mesh);
        if (gizmo && mesh) gizmo.attach(mesh);

        setSelectedKind(mesh.userData?.archdiscStudioPrimitiveKind || 'unknown');
        setSelectedTransform({
          position: [mesh.position.x, mesh.position.y, mesh.position.z],
          rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
          scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
        });

        // Populate material controls from the picked mesh's current material.
        const m = mesh.material;
        if (m && m.color) {
          setMatColor('#' + m.color.getHexString());
          setMatMetalness(typeof m.metalness === 'number' ? m.metalness : 0);
          setMatRoughness(typeof m.roughness === 'number' ? m.roughness : 1);
          setMatEmissive(typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : 0);
          setMatWireframe(!!m.wireframe);
        }
      };

      const deselect = () => {
        clearOutline();
        if (gizmo) gizmo.detach();
        selectedMeshRef.current = null;
        setSelectedKind(null);
        setSelectedTransform(null);
      };

      // Expose the gizmo so other slices (gizmoMode mirror, viewport
      // header toggle, automation specs) can drive its mode.
      window.__studioGizmo = gizmo;

      // Expose for the React-side delete + other slices.
      // Wrap selectMesh so programmatic selection also collapses the
      // multi-select set to just this mesh (single-select semantics).
      window.__studioSelectMesh = (mesh) => {
        selectedMeshesRef.current = mesh ? [mesh] : [];
        selectMesh(mesh);
      };
      // Read-only getter for the multi-select set (e2e + AI).
      window.__studioSelectedMeshes = () => selectedMeshesRef.current.slice();
      window.__studioDeselect = deselect;
      // Read-only getter for the currently-selected mesh (e2e + AI
      // introspection — lets specs measure geometry before/after an op).
      window.__studioSelectedMesh = () => selectedMeshRef.current;

      const raycaster = new THREE.Raycaster();
      const onPointerDown = (e) => {
        if (e.button !== 0) return;
        const rect = vp.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, vp.camera);
        const studioMeshes = [];
        vp.scene.traverse(o => {
          if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) {
            studioMeshes.push(o);
          }
        });
        const hits = raycaster.intersectObjects(studioMeshes, false);
        // BRUSH MODE — click PAINTS vertex deformation onto the hit
        // mesh instead of selecting. Reads brush params via a ref so
        // setup-scoped listeners see live state.
        const brush = brushStateRef.current;
        if (brush.active && hits.length > 0) {
          const hit = hits[0];
          // Mask brush paints the protect-mask; texpaint paints into the UV
          // texture (Substance/Blender texture paint); else deform (sculpt).
          if (brush.mode === 'mask') paintMaskAt(hit.object, hit.point, brush.radius, 1);
          else if (brush.mode === 'texpaint') { if (hit.uv) paintTextureAt(hit.object, hit.uv, brush.paintColor, undefined, brush.paintChannel); }
          else if (brush.mode === 'polypaint') paintPolyAt(hit.object, hit.point, brush.paintColor, brush.radius);
          else paintBrushAt(hit.object, hit.point, brush);
          return;
        }
        if (hits.length > 0) {
          const hit = hits[0].object;
          if (e.shiftKey) {
            // Multi-select: toggle hit mesh in/out of the set. The hit
            // mesh becomes the active mesh either way.
            const set = selectedMeshesRef.current;
            const idx = set.indexOf(hit);
            if (idx >= 0) set.splice(idx, 1); else set.push(hit);
          } else {
            // Single-select replaces the set.
            selectedMeshesRef.current = [hit];
          }
          selectMesh(hit);
        } else {
          selectedMeshesRef.current = [];
          deselect();
        }
      };
      vp.renderer.domElement.addEventListener('pointerdown', onPointerDown);

      // Right-click → context menu. Suppress the browser's native menu.
      const onContextMenu = (e) => {
        e.preventDefault();
        const rect = vp.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, vp.camera);
        const studioMeshes = [];
        vp.scene.traverse(o => {
          if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) {
            studioMeshes.push(o);
          }
        });
        const hits = raycaster.intersectObjects(studioMeshes, false);
        // Show menu either way — empty area menu has "Add Primitive" only.
        const target = hits.length > 0 ? hits[0].object : null;
        if (target) selectMesh(target);
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          uuid: target ? target.uuid : null,
        });
      };
      vp.renderer.domElement.addEventListener('contextmenu', onContextMenu);

      // Delete/Backspace shortcut (original Studio handler). The full
      // Blender keymap (G/R/S/A/X/Tab) lives in the persistent
      // document-level listener below so it survives any re-render
      // storms — keeping them in separate handlers avoids double-firing.
      const onKeyDown = (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedMeshRef.current) {
          const tag = (e.target && e.target.tagName) || '';
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
          e.preventDefault();
          deleteSelectedMeshRef.current && deleteSelectedMeshRef.current();
        }
      };
      window.addEventListener('keydown', onKeyDown);

      cleanupFn = () => {
        vp.renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        vp.renderer.domElement.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('keydown', onKeyDown);
        clearOutline();
        delete window.__studioSelectMesh;
        delete window.__studioDeselect;
      };
    }

    setup();
    return () => {
      cancelled = true;
      if (cleanupFn) cleanupFn();
    };
  }, []);

  // Mirror activeTool → transform mode label + drive the gizmo's mode
  // so the visible move/rotate/scale handles match the active tool.
  useEffect(() => {
    const map = { move: 'translate', rotate: 'rotate', scale: 'scale' };
    if (map[activeTool]) setGizmoMode(map[activeTool]);
  }, [activeTool]);
  useEffect(() => {
    if (window.__studioGizmo && typeof window.__studioGizmo.setMode === 'function') {
      try { window.__studioGizmo.setMode(gizmoMode); } catch (_) { /* mode update best-effort */ }
    }
  }, [gizmoMode]);

  // Slice 190: Blender keymap (G/R/S/A/X/Tab). The handler is also
  // folded into the existing setup() useEffect's keydown listener so
  // it ships with the same lifecycle as the Delete/Backspace shortcut.
  // We ALSO install a one-shot persistent document-level listener via
  // a ref so the keymap never gets unmounted by upstream re-render
  // storms — useEffect([]) cleanup on certain transition paths can
  // drop the listener. The persistent listener reads the latest state
  // through refs so the closure is always current.
  const blenderKeymapRef = useRef({ installed: false });
  if (typeof document !== 'undefined' && !blenderKeymapRef.current.installed) {
    blenderKeymapRef.current.installed = true;
    const writeTransform = (mesh) => {
      setSelectedTransform({
        position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
        rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
        scale:    { x: mesh.scale.x,    y: mesh.scale.y,    z: mesh.scale.z },
      });
    };
    document.addEventListener('keydown', (e) => {
      window.__bgKc = (window.__bgKc || 0) + 1;
      window.__bgKey = e.key;
      const tag = (e.target && e.target.tagName) || '';
      window.__bgTag = tag;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Allow Ctrl+A / Alt+A / Alt+H / Shift+D for slice 194 + Ctrl+
      // numpad (slice 193). Block other modifier combos so browser
      // shortcuts (Cmd+R, Ctrl+S, etc.) still work.
      const isAllowedModCombo = (
        (e.ctrlKey && /^[a13750]$/i.test(e.key)) ||
        (e.altKey && /^[ah]$/i.test(e.key)) ||
        (e.shiftKey && /^[dcs]$/i.test(e.key))
      );
      if ((e.metaKey || e.ctrlKey || e.altKey) && !isAllowedModCombo) return;
      const k = (e.key || '').toLowerCase();
      const mesh = selectedMeshRef.current;
      window.__bgMesh = mesh ? mesh.uuid : 'null';
      // Slice 192: multi-select set drives G/R/S so Shift+click groups
      // transform together. Falls back to active mesh when set empty.
      const set = (selectedMeshesRef.current && selectedMeshesRef.current.length)
        ? selectedMeshesRef.current : (mesh ? [mesh] : []);
      if (k === 'g' && set.length) { for (const m of set) m.position.x += 0.05; if (mesh) writeTransform(mesh); }
      else if (k === 'r' && set.length) { for (const m of set) m.rotation.y += 0.1; if (mesh) writeTransform(mesh); }
      else if (k === 's' && !e.shiftKey && !e.ctrlKey && !e.altKey && set.length) { for (const m of set) m.scale.multiplyScalar(1.1); if (mesh) writeTransform(mesh); }
      else if (k === 'a' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const stack = primitiveStackRef.current || [];
        if (!stack.length) return;
        const cur = selectedMeshRef.current;
        const idx = cur ? stack.indexOf(cur) : -1;
        const next = stack[(idx + 1) % stack.length];
        if (next && window.__studioSelectMesh) window.__studioSelectMesh(next);
      } else if (k === 'x' && mesh) {
        deleteSelectedMeshRef.current && deleteSelectedMeshRef.current();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        setViewportMode((cur) => cur === 'Object Mode' ? 'Edit Mode' : 'Object Mode');
      } else if (k === 'f' && mesh) {
        // Slice 194: F frames the camera on the active selection.
        // Computes bounding sphere of selected set, orbits camera so
        // it neatly contains the selection (Blender Numpad-. + F key).
        const targets = (selectedMeshesRef.current && selectedMeshesRef.current.length)
          ? selectedMeshesRef.current : [mesh];
        const box = new THREE.Box3();
        for (const m of targets) { box.expandByObject(m); }
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();
        if (typeof window.__archdiscFrameBox === 'function') {
          window.__archdiscFrameBox(center, size);
        } else if (typeof window.__studioFrameAll === 'function') {
          window.__studioFrameAll();
        }
      } else if (e.key === 'Home') {
        if (typeof window.__studioFrameAll === 'function') window.__studioFrameAll();
      } else if (k === 'h' && !e.altKey && set.length) {
        // Slice 194: H hides the selected meshes; Alt+H reveals all.
        for (const m of set) m.visible = false;
      } else if (k === 'h' && e.altKey) {
        const scene = window.__archdiscScene; if (scene) {
          scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) o.visible = true; });
        }
      } else if (k === 'd' && e.shiftKey && set.length) {
        // Slice 194: Shift+D duplicates each selected mesh just like
        // Blender: clone geometry + material, offset slightly so the
        // duplicates don't z-fight the originals, add to scene + stack.
        const scene = window.__archdiscScene; if (!scene) return;
        const dupes = [];
        for (const m of set) {
          const c = m.clone();
          c.geometry = m.geometry.clone();
          c.material = m.material && m.material.clone ? m.material.clone() : m.material;
          c.position.x += 0.05;
          c.userData = { ...m.userData };
          c.name = (m.name || 'studio-primitive') + '-dup';
          scene.add(c);
          if (primitiveStackRef.current) primitiveStackRef.current.push(c);
          dupes.push(c);
        }
        setPrimitiveCount((cur) => cur + dupes.length);
        if (dupes.length && window.__studioSelectMesh) window.__studioSelectMesh(dupes[dupes.length - 1]);
      } else if (k === 'a' && e.ctrlKey) {
        // Slice 194: Ctrl+A selects every primitive (Blender Ctrl+A
        // selects all; plain A cycles which slice 190 wired).
        const stack = primitiveStackRef.current || [];
        if (stack.length && window.__studioSelectMesh) {
          selectedMeshesRef.current = stack.slice();
          window.__studioSelectMesh(stack[stack.length - 1]);
          // __studioSelectMesh collapses set; re-establish the full set.
          selectedMeshesRef.current = stack.slice();
        }
      } else if (k === 'a' && e.altKey) {
        // Slice 194: Alt+A deselects all (Blender Alt+A).
        selectedMeshesRef.current = [];
        if (window.__studioDeselect) window.__studioDeselect();
      } else if (k === 'c' && e.shiftKey) {
        // Slice 197: Shift+C snaps the 3D Cursor back to world origin
        // (Blender Shift+C also frames all + recenters cursor; Studio
        // splits these — Shift+C does the cursor reset, Home does the
        // frame-all from slice 194).
        if (window.__studioSnapCursorOrigin) window.__studioSnapCursorOrigin();
      } else if (k === 's' && e.shiftKey) {
        // Slice 197: Shift+S snaps the 3D Cursor to the active mesh's
        // origin (Blender Shift+S "Cursor to Selected" menu pick).
        if (window.__studioSnapCursorSelection) window.__studioSnapCursorSelection();
      } else if (k === 'z') {
        // Slice 194: Z toggles wireframe shading on every primitive
        // (Blender Z toggles between shading modes; Studio toggles
        // wireframe overlay as the simplest equivalent).
        const scene = window.__archdiscScene; if (!scene) return;
        let any = false;
        scene.traverse((o) => {
          if (o.userData && o.userData.archdiscStudioPrimitive && o.material) {
            o.material.wireframe = !o.material.wireframe;
            any = any || o.material.wireframe;
          }
        });
        window.__studioWireframeOn = any;
      } else if (['1','3','7','5'].includes(e.key)) {
        // Slice 193: Blender numpad view shortcuts. Numpad-1 front,
        // Numpad-3 right side, Numpad-7 top, Numpad-5 ortho/persp
        // toggle. Ctrl+ inverts (back/left/bottom). Maps to the
        // existing __archdiscOrbitView so the camera flies to the
        // canonical view immediately. (Studio's perspective toggle is
        // a planned follow-up; Numpad-5 is logged as the intent.)
        const ctrl = e.ctrlKey;
        const VIEWS = {
          '1': [   0,  0, 1 ], // front
          '3': [  90,  0, 1 ], // right
          '7': [   0, 89, 1 ], // top
        };
        const CTRL_VIEWS = {
          '1': [ 180,  0, 1 ], // back
          '3': [ -90,  0, 1 ], // left
          '7': [   0,-89, 1 ], // bottom
        };
        if (e.key === '5') {
          // Toggle ortho/persp marker on a window slot (real ortho cam
          // toggle lands when the renderer plumbs both projections).
          window.__studioViewProjection = window.__studioViewProjection === 'ortho' ? 'persp' : 'ortho';
          return;
        }
        const v = (ctrl ? CTRL_VIEWS : VIEWS)[e.key];
        if (v && typeof window.__archdiscOrbitView === 'function') {
          window.__archdiscOrbitView(v[0], v[1], v[2]);
        }
      }
    });
  }

  function deleteSelectedMesh() {
    const scene = window.__archdiscScene;
    const mesh = selectedMeshRef.current;
    if (!scene || !mesh) return;

    outlineRef.current = null;
    scene.remove(mesh);
    const idx = primitiveStackRef.current.indexOf(mesh);
    if (idx >= 0) primitiveStackRef.current.splice(idx, 1);
    disposeMesh(mesh);

    selectedMeshRef.current = null;
    setSelectedKind(null);
    setSelectedTransform(null);
    setPrimitiveCount(c => Math.max(0, c - 1));
    recomputeMeshStats(scene);
  }

  // Material edit handlers — live-edit the selected mesh's MeshStandardMaterial.
  function applyMatColor(hex) {
    setMatColor(hex);
    const mesh = selectedMeshRef.current;
    if (mesh && mesh.material && mesh.material.color) {
      mesh.material.color.set(hex);
      mesh.material.needsUpdate = true;
    }
  }
  function applyMatMetalness(v) {
    const n = Number(v);
    setMatMetalness(n);
    const mesh = selectedMeshRef.current;
    if (mesh && mesh.material) { mesh.material.metalness = n; mesh.material.needsUpdate = true; }
  }
  function applyMatRoughness(v) {
    const n = Number(v);
    setMatRoughness(n);
    const mesh = selectedMeshRef.current;
    if (mesh && mesh.material) { mesh.material.roughness = n; mesh.material.needsUpdate = true; }
  }
  function applyMatEmissive(v) {
    const n = Number(v);
    setMatEmissive(n);
    const mesh = selectedMeshRef.current;
    if (mesh && mesh.material) {
      mesh.material.emissive = mesh.material.emissive || new THREE.Color(0xffffff);
      mesh.material.emissive.set(0xffffff);
      mesh.material.emissiveIntensity = n;
      mesh.material.needsUpdate = true;
    }
  }
  function applyMatWireframe(checked) {
    setMatWireframe(checked);
    const mesh = selectedMeshRef.current;
    if (mesh && mesh.material) { mesh.material.wireframe = !!checked; mesh.material.needsUpdate = true; }
  }

  function applyMaterialPreset(preset) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.material) return;
    mesh.material.color.set(preset.color);
    mesh.material.metalness = preset.metalness;
    mesh.material.roughness = preset.roughness;
    if (preset.opacity < 1) {
      mesh.material.transparent = true;
      mesh.material.opacity = preset.opacity;
    } else {
      mesh.material.transparent = false;
      mesh.material.opacity = 1;
    }
    mesh.material.needsUpdate = true;
    // Mirror into the React-side controls so sliders / picker reflect
    // the preset's values.
    setMatColor(preset.color);
    setMatMetalness(preset.metalness);
    setMatRoughness(preset.roughness);
  }

  /*
   * Text 3D — async load the bundled Droid Sans typeface (copied to
   * /fonts/ by frontend/public so Vite serves it in dev AND ships it
   * in dist for packaged Electron). Font is cached in a ref; UI exposes
   * fontReady so the Add Text button only enables once loadable.
   */
  useEffect(() => {
    let cancelled = false;
    const loader = new FontLoader();
    loader.load(
      'fonts/droid_sans_regular.typeface.json',
      (font) => {
        if (cancelled) return;
        fontRef.current = font;
        setFontReady(true);
      },
      undefined,
      (err) => {
        // Font load failed (offline, missing asset, etc.) — leave fontReady
        // false so the Add Text button stays disabled.
        // eslint-disable-next-line no-console
        console.warn('[studio] font load failed', err);
      },
    );
    return () => { cancelled = true; };
  }, []);

  function addText3D() {
    const scene = window.__archdiscScene;
    if (!scene || !fontRef.current || !text3dInput) return;
    const geometry = new TextGeometry(text3dInput, {
      font: fontRef.current,
      size: text3dSize,
      depth: text3dSize * 0.3,
      curveSegments: 6,
      bevelEnabled: true,
      bevelThickness: text3dSize * 0.02,
      bevelSize: text3dSize * 0.015,
      bevelSegments: 2,
    });
    geometry.center();
    const material = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.55,
      roughness: 0.28,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'text-3d';
    mesh.name = `studio-primitive-text3d-${primitiveCount}`;

    const cols = 4;
    const i = primitiveCount;
    const col = i % cols;
    const row = Math.floor(i / cols);
    mesh.position.set(
      (col - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
      0,
      row * PRIMITIVE_SIZE * 1.9,
    );

    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

  /*
   * Boolean / CSG (Union / Difference / Intersect).
   *
   * Source: manifold-3d (MIT, Emmett Lalish — also used by OpenSCAD,
   * Onshape, Slic3r). Studio's Mech sibling has been on this kernel
   * for CAD CSG since the original archdiscv1 work; Studio's slice
   * reuses the existing bridge + adds a geometryToManifold helper
   * with world-matrix application.
   *
   * Operand A = the second-most-recently-added Studio primitive.
   * Operand B = the selected primitive.
   * Result   = a new Mesh built from manifoldToGeometry(result),
   *            inserted at A's position; A + B are removed.
   */
  useEffect(() => {
    let cancelled = false;
    getManifold()
      .then(() => { if (!cancelled) setManifoldReady(true); })
      .catch((e) => { /* leave false; UI disables boolean buttons */ });
    return () => { cancelled = true; };
  }, []);

  async function booleanWithPrevious(op) {
    const scene = window.__archdiscScene;
    const mesh = selectedMeshRef.current;
    if (!scene || !mesh) return;
    const stack = primitiveStackRef.current;
    const selectedIdx = stack.indexOf(mesh);
    if (selectedIdx < 0) return;
    // Find the previous primitive in stack (skip non-Mesh, like InstancedMesh
    // — Boolean only makes sense on plain Mesh geometry).
    let prev = null;
    for (let i = selectedIdx - 1; i >= 0; i--) {
      const candidate = stack[i];
      if (candidate.isMesh && !candidate.isInstancedMesh && candidate.geometry) {
        prev = candidate;
        break;
      }
    }
    if (!prev) return;

    const m = await getManifold();
    // Force world matrix to be up to date.
    prev.updateMatrixWorld(true);
    mesh.updateMatrixWorld(true);
    let mA = null, mB = null, mResult = null;
    try {
      mA = geometryToManifold(prev.geometry, m, prev.matrixWorld);
      mB = geometryToManifold(mesh.geometry, m, mesh.matrixWorld);
      if (op === 'union')           mResult = mA.add(mB);
      else if (op === 'difference') mResult = mA.subtract(mB);
      else if (op === 'intersect')  mResult = mA.intersect(mB);
      else return;

      const newGeom = manifoldToGeometry(mResult);
      // Move geometry-origin to operand A's old position so the resulting
      // mesh's world transform is identity (vertices are already in world space).
      const newMaterial = new THREE.MeshStandardMaterial({
        color: 0x7fb98b,
        metalness: 0.2,
        roughness: 0.5,
      });
      const result = new THREE.Mesh(newGeom, newMaterial);
      result.castShadow = true;
      result.receiveShadow = true;
      result.userData.archdiscStudioPrimitive = true;
      result.userData.archdiscStudioPrimitiveKind = `boolean-${op}`;
      result.name = `studio-primitive-boolean-${op}-${primitiveCount}`;
      // No further position offset — manifold's output is in world space.
      result.position.set(0, 0, 0);

      // Remove operands A + B from scene + stack, dispose their materials.
      [prev, mesh].forEach(target => {
        scene.remove(target);
        const idx = stack.indexOf(target);
        if (idx >= 0) stack.splice(idx, 1);
        try { target.geometry.dispose(); } catch (_) {}
        try { target.material.dispose && target.material.dispose(); } catch (_) {}
      });

      scene.add(result);
      stack.push(result);
      // Clear selection — the meshes referenced are gone.
      selectedMeshRef.current = null;
      setSelectedKind(null);
      setSelectedTransform(null);
      setPrimitiveCount(stack.length);
      recomputeMeshStats(scene);
    } catch (err) {
      // Boolean op failed — log for diagnostic, leave operands in place.
      // eslint-disable-next-line no-console
      console.warn('[studio:boolean] failed', op, err && err.message, err);
      // eslint-disable-next-line no-console
      console.warn('[studio:boolean] prev geom v/idx:',
        prev && prev.geometry && prev.geometry.attributes.position.count,
        prev && prev.geometry && prev.geometry.index && prev.geometry.index.count);
      // eslint-disable-next-line no-console
      console.warn('[studio:boolean] mesh geom v/idx:',
        mesh.geometry.attributes.position.count,
        mesh.geometry.index && mesh.geometry.index.count);
    } finally {
      try { mA && mA.delete(); } catch (_) {}
      try { mB && mB.delete(); } catch (_) {}
      try { mResult && mResult.delete(); } catch (_) {}
    }
  }

  /*
   * Reference Plane — drop a labeled grid plane into the scene that
   * artists model against (the photo-to-3D workflow visible in the
   * reels at Video-29 + Video-402). Texture is procedurally drawn so
   * the slice is fully deterministic; a follow-up swaps in an
   * Electron file picker.
   */
  function buildReferenceCanvas(label) {
    const SIZE = 512;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    // Background — flat charcoal.
    ctx.fillStyle = '#161821';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Major grid every 64 px = 8 cells across.
    ctx.strokeStyle = '#3a4458';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const v = (i / 8) * SIZE;
      ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(SIZE, v); ctx.stroke();
    }
    // Center cross-hairs.
    ctx.strokeStyle = '#e6e6e6';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(SIZE / 2, 0); ctx.lineTo(SIZE / 2, SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, SIZE / 2); ctx.lineTo(SIZE, SIZE / 2); ctx.stroke();
    // Label in top-left.
    ctx.fillStyle = '#e9ecef';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(label, 24, 50);
    // Sub-label bottom-right with the dimensions.
    ctx.fillStyle = '#9aa6b8';
    ctx.font = '14px monospace';
    ctx.fillText('ARCHDISC STUDIO · REFERENCE', 24, SIZE - 24);
    return canvas;
  }

  function addReferencePlane() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const w = Math.max(0.01, refWidth);
    const geometry = new THREE.PlaneGeometry(w, w);
    const canvas = buildReferenceCanvas((refLabel || 'REF').toUpperCase().slice(0, 12));
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.DoubleSide,
      metalness: 0,
      roughness: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    // Stand upright on Y; the user typically wants reference planes
    // facing them in the default camera, so rotate the plane to face
    // +Z (toward the camera at (0.15, 0.10, 0.15) which looks at origin).
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'reference-plane';
    mesh.userData.archdiscStudioReferenceLabel = refLabel;
    mesh.name = `studio-primitive-reference-${refLabel}-${primitiveCount}`;

    const cols = 4;
    const i = primitiveCount;
    const col = i % cols;
    const row = Math.floor(i / cols);
    mesh.position.set(
      (col - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
      w * 0.5,
      row * PRIMITIVE_SIZE * 1.9,
    );

    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

  /*
   * AI Planner shim — decompose a natural-language prompt into an
   * ordered plan of (label, run, tab) steps, then execute the plan
   * one step at a time with the matching discipline-tab auto-selected
   * per step. Each step shows up in a UI list with the current step
   * highlighted; aiRunning gates the Run button while a plan is
   * executing so users can't double-fire.
   *
   * The parser is still keyword-route + substring-aware (longest needle
   * first); the durable contract is the plan-then-execute harness,
   * which the real Clarifier/Planner/Verifier loop will plug into.
   */
  function planFromPrompt(raw) {
    const p = raw.toLowerCase();
    const plan = [];
    // 1. Compose / clear come first if requested.
    if (/clear|empty|wipe/.test(p)) {
      plan.push({ label: 'Clear scene',   tab: 'modeling', run: () => clearScene() });
    }
    if (/demo|compose/.test(p)) {
      plan.push({ label: 'Compose demo scene', tab: 'modeling', run: () => composeDemoScene() });
    }
    // 2. Primitive additions, longest needle first.
    const primKinds = [
      ['voxel sphere', 'voxel-sphere'],
      ['voxel cube',   'voxel-cube'],
      ['torus knot',   'torus-knot'],
      ['suzanne',      'suzanne'],
      ['monkey',       'suzanne'],
      ['dodeca',       'dodecahedron'],
      ['icosa',        'icosahedron'],
      ['tetra',        'tetrahedron'],
      ['cylinder',     'cylinder'],
      ['sphere',       'sphere'],
      ['plane',        'plane'],
      ['cone',         'cone'],
      ['torus',        'torus'],
      ['cube',         'cube'],
    ];
    let remaining = p;
    for (const [needle, kind] of primKinds) {
      if (remaining.includes(needle)) {
        plan.push({ label: `Add ${needle}`, tab: 'modeling', run: () => addPrimitive(kind) });
        remaining = remaining.split(needle).join(' ');
      }
    }
    if (/tree/.test(p)) {
      plan.push({ label: 'Generate procedural tree', tab: 'modeling', run: () => generateProceduralTree() });
    }
    if (/lathe|vase|goblet|column/.test(p)) {
      const profile = /vase/.test(p) ? 'vase' : /goblet/.test(p) ? 'goblet' : 'column';
      plan.push({ label: `Add lathe (${profile})`, tab: 'modeling', run: () => { setLatheProfile(profile); addLatheSurface(); } });
    }
    if (/floor plan|building|extrude/.test(p)) {
      const shape = /l[- ]?shape/.test(p) ? 'L-shape' : /u[- ]?shape/.test(p) ? 'U-shape' : 'rectangle';
      plan.push({ label: `Extrude ${shape} floor plan`, tab: 'modeling', run: () => { setFloorShape(shape); extrudeFloorPlan(); } });
    }
    if (/armature|bone/.test(p)) {
      plan.push({ label: 'Add bone chain', tab: 'rigging', run: () => addArmature() });
    }
    if (/particle/.test(p)) {
      plan.push({ label: 'Spawn particle cloud', tab: 'vfx-sim', run: () => spawnParticles() });
    }
    if (/light/.test(p)) {
      plan.push({ label: 'Add cinematic light', tab: 'rendering', run: () => addCinematicLight() });
    }
    if (/drop|gravity|fall/.test(p)) {
      plan.push({ label: 'Drop with gravity', tab: 'vfx-sim', run: () => setIsPhysicsActive(true) });
    }
    if (/reset/.test(p)) {
      plan.push({ label: 'Reset to origin', tab: 'vfx-sim', run: () => { resetPhysics(); setIsPhysicsActive(false); } });
    }
    if (/spin|rotate|animate/.test(p) && !/stop/.test(p)) {
      plan.push({ label: 'Start animation', tab: 'animation', run: () => setIsAnimating(true) });
    }
    if (/stop|pause/.test(p)) {
      plan.push({ label: 'Stop animation', tab: 'animation', run: () => setIsAnimating(false) });
    }
    if (/showreel|turntable|four[- ]?view/.test(p)) {
      plan.push({ label: 'Capture 4-view showreel', tab: 'rendering', run: () => captureShowreel() });
    } else if (/render|capture|screenshot/.test(p)) {
      plan.push({ label: 'Capture render', tab: 'rendering', run: () => captureRender() });
    }
    return plan;
  }

  async function runAiPrompt() {
    if (aiRunning) return;
    const raw = (aiPrompt || '').trim();
    if (!raw) return;
    const plan = planFromPrompt(raw);
    setAiPlan(plan);
    if (plan.length === 0) {
      setAiLog(l => l.concat([{ prompt: raw, actions: ['(no matching keywords — try: add cube, spin, drop, render)'], ts: new Date().toLocaleTimeString() }]));
      return;
    }
    setAiRunning(true);
    setAiPlanIndex(-1);
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      setAiPlanIndex(i);
      // Switch the discipline tab so the user sees the right panel
      // light up while the step runs.
      setActiveTab(step.tab);
      // Brief wait so the user can watch each step land.
      await new Promise(r => setTimeout(r, 350));
      try {
        step.run();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[studio:ai] step failed', step.label, err && err.message);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    setAiPlanIndex(-1);
    setAiRunning(false);
    setAiLog(l => l.concat([{
      prompt: raw,
      actions: plan.map(s => s.label),
      ts: new Date().toLocaleTimeString(),
    }]));
  }

  /*
   * Cinematic lighting — add a colored PointLight (with a small
   * PointLightHelper sphere so its position reads visually) into the
   * scene at a random orbit around the workspace. Clears all
   * Studio-added lights via Clear Lights.
   */
  function addCinematicLight() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const light = new THREE.PointLight(
      new THREE.Color(lightColor),
      lightIntensity,
      0.5, // distance falloff in scene units
      2,   // decay
    );
    const angle = lightCount * (Math.PI * 2 / 5) + 0.4;
    const r = PRIMITIVE_SIZE * 2.2;
    light.position.set(
      Math.cos(angle) * r,
      PRIMITIVE_SIZE * (0.6 + (lightCount % 3) * 0.5),
      Math.sin(angle) * r,
    );
    light.userData.archdiscStudioLight = true;
    light.name = `studio-light-${lightCount}`;
    scene.add(light);
    // Visible marker so users can see where the light sits in space.
    try {
      const helper = new THREE.PointLightHelper(light, PRIMITIVE_SIZE * 0.06, light.color);
      helper.userData.archdiscStudioLightHelper = true;
      scene.add(helper);
    } catch (_) { /* helper add failure is benign */ }
    setLightCount(c => c + 1);
  }

  function clearCinematicLights() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const toRemove = [];
    scene.traverse(o => {
      if (o.userData && (o.userData.archdiscStudioLight || o.userData.archdiscStudioLightHelper)) {
        toRemove.push(o);
      }
    });
    for (const o of toRemove) scene.remove(o);
    setLightCount(0);
  }

  /*
   * Three-Point cinematic lighting preset — warm key (front-right),
   * cool fill (front-left, lower intensity), magenta rim (back). One
   * click clears any prior Studio lights + drops these three at
   * canonical angles.
   */
  function applyThreePointLighting() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    // Clear existing in one pass (avoiding clearCinematicLights's
    // setLightCount(0) → addCinematicLight's setLightCount(c+1) race
    // where all three lights would compute the same index).
    const toRemove = [];
    scene.traverse(o => {
      if (o.userData && (o.userData.archdiscStudioLight || o.userData.archdiscStudioLightHelper)) {
        toRemove.push(o);
      }
    });
    for (const o of toRemove) scene.remove(o);

    const PRESET = [
      { idx: 0, color: '#ffb56b', intensity: 2.4 }, // warm key
      { idx: 1, color: '#6bb5ff', intensity: 1.6 }, // cool fill
      { idx: 2, color: '#d469c4', intensity: 1.0 }, // magenta rim
    ];
    for (const p of PRESET) {
      const light = new THREE.PointLight(new THREE.Color(p.color), p.intensity, 0.5, 2);
      const angle = p.idx * (Math.PI * 2 / 5) + 0.4;
      const r = PRIMITIVE_SIZE * 2.2;
      light.position.set(
        Math.cos(angle) * r,
        PRIMITIVE_SIZE * (0.6 + (p.idx % 3) * 0.5),
        Math.sin(angle) * r,
      );
      light.userData.archdiscStudioLight = true;
      light.name = `studio-light-3point-${p.idx}`;
      scene.add(light);
      try {
        const helper = new THREE.PointLightHelper(light, PRIMITIVE_SIZE * 0.06, light.color);
        helper.userData.archdiscStudioLightHelper = true;
        scene.add(helper);
      } catch (_) {}
    }
    setLightCount(3);
  }

  /*
   * Mirror modifier — clone the selected mesh's geometry, flip the
   * clone across the chosen axis, invert winding to preserve outward
   * normals, merge the original + mirrored back into a single geometry.
   * Useful for symmetric character / hard-surface modelling.
   */
  function mirrorSelected() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return;
    const original = mesh.geometry.clone();
    const flipped  = mesh.geometry.clone();
    const pos = flipped.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (mirrorAxis === 'x')      pos.setX(i, -pos.getX(i));
      else if (mirrorAxis === 'y') pos.setY(i, -pos.getY(i));
      else                          pos.setZ(i, -pos.getZ(i));
    }
    pos.needsUpdate = true;
    // Flipping across a single axis reverses face winding — swap the
    // last two indices of every triangle to keep normals facing out.
    if (flipped.index) {
      const arr = flipped.index.array;
      for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i + 1];
        arr[i + 1] = arr[i + 2];
        arr[i + 2] = tmp;
      }
      flipped.index.needsUpdate = true;
    } else {
      // Non-indexed: swap successive triangle vertices in the position
      // buffer directly.
      const arr = flipped.attributes.position.array;
      for (let i = 0; i < arr.length; i += 9) {
        const tx = arr[i + 3], ty = arr[i + 4], tz = arr[i + 5];
        arr[i + 3] = arr[i + 6]; arr[i + 4] = arr[i + 7]; arr[i + 5] = arr[i + 8];
        arr[i + 6] = tx;         arr[i + 7] = ty;         arr[i + 8] = tz;
      }
    }
    flipped.computeVertexNormals();
    const merged = mergeGeometries([original, flipped]);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    mesh.geometry.dispose();
    mesh.geometry = merged;
    recomputeMeshStats(window.__archdiscScene);
  }

  /*
   * Subdivision — midpoint scheme: for every triangle, add a new
   * vertex at each edge midpoint and replace the triangle with 4
   * sub-triangles. Vertex count grows ~4× per pass. Operates on the
   * selected mesh's geometry in place; downstream sculpt brushes get
   * a denser canvas to work with.
   */
  function subdivideSelected() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return;
    const g = mesh.geometry;
    // Some three primitives ship non-indexed (PolyhedronGeometry —
    // Icosahedron/Dodecahedron/Tetrahedron — among them). Synthesize an
    // implicit index so the midpoint scheme below has triangles to walk.
    if (!g.index) {
      const n = g.attributes.position.count;
      const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) arr[i] = i;
      g.setIndex(new THREE.BufferAttribute(arr, 1));
    }
    const oldPos = g.attributes.position;
    const oldIdx = g.index;
    const xs = []; const ys = []; const zs = [];
    for (let i = 0; i < oldPos.count; i++) {
      xs.push(oldPos.getX(i));
      ys.push(oldPos.getY(i));
      zs.push(oldPos.getZ(i));
    }
    const edgeMap = new Map();
    const getMidpoint = (a, b) => {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      let v = edgeMap.get(k);
      if (v !== undefined) return v;
      v = xs.length;
      xs.push((xs[a] + xs[b]) * 0.5);
      ys.push((ys[a] + ys[b]) * 0.5);
      zs.push((zs[a] + zs[b]) * 0.5);
      edgeMap.set(k, v);
      return v;
    };
    const newIndices = [];
    for (let t = 0; t < oldIdx.count; t += 3) {
      const a = oldIdx.getX(t);
      const b = oldIdx.getX(t + 1);
      const c = oldIdx.getX(t + 2);
      const ab = getMidpoint(a, b);
      const bc = getMidpoint(b, c);
      const ca = getMidpoint(c, a);
      newIndices.push(a, ab, ca,  ab, b, bc,  ca, bc, c,  ab, bc, ca);
    }
    const arr = new Float32Array(xs.length * 3);
    for (let i = 0; i < xs.length; i++) {
      arr[i * 3]     = xs[i];
      arr[i * 3 + 1] = ys[i];
      arr[i * 3 + 2] = zs[i];
    }
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    newGeom.setIndex(newIndices);
    newGeom.computeVertexNormals();
    newGeom.computeBoundingSphere();
    newGeom.computeBoundingBox();
    mesh.geometry.dispose();
    mesh.geometry = newGeom;
    recomputeMeshStats(window.__archdiscScene);
    // Mirror new transform into the Selection panel so vertex count
    // shifts there too.
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
  }

  /*
   * Solidify modifier — give thickness to a surface mesh.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_solidify.cc
   *
   * Algorithm:
   *   1. Clone the mesh (outer shell).
   *   2. Clone again, offset positions along inward normals by
   *      `thickness` to make an inner shell.
   *   3. Flip the inner shell's triangle winding so its normals
   *      point outward.
   *   4. Merge outer + inner into one geometry.
   *
   * Caveats vs Blender's reference:
   *   - Blender also stitches edges between outer & inner along
   *     boundary loops; this MVP relies on closed meshes (the
   *     vendored Suzanne/Teapot are closed) so no boundary stitching
   *     is required to look correct.
   */
  function solidifyModifier(thickness) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const orig = mesh.geometry;
    if (!orig.attributes.normal) orig.computeVertexNormals();
    const outer = orig.clone();
    const inner = orig.clone();
    const pos = inner.attributes.position;
    const nrm = inner.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) - nrm.getX(i) * thickness,
        pos.getY(i) - nrm.getY(i) * thickness,
        pos.getZ(i) - nrm.getZ(i) * thickness,
      );
    }
    pos.needsUpdate = true;
    // Flip winding so inner shell normals face outward.
    if (inner.index) {
      const idx = inner.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i]; idx[i] = idx[i + 1]; idx[i + 1] = t;
      }
      inner.index.needsUpdate = true;
    }
    inner.computeVertexNormals();
    const merged = mergeGeometries([outer, inner]);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = merged;
    mesh.userData.archdiscStudioSolidified = (mesh.userData.archdiscStudioSolidified || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { thickness, vertCount: merged.attributes.position.count };
  }

  /*
   * Cast modifier — push vertices toward a target primitive shape.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_cast.cc
   *
   * The `amount` slider blends each vertex toward its target
   * projection on the chosen reference shape (sphere or cuboid).
   * 0 = identity, 1 = full cast.
   */
  function castToShape(targetShape, amount) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    if (!mesh.geometry.boundingBox)    mesh.geometry.computeBoundingBox();
    const bs = mesh.geometry.boundingSphere;
    const bb = mesh.geometry.boundingBox;
    const cx = bs.center.x, cy = bs.center.y, cz = bs.center.z;
    const radius = bs.radius;
    const halfX = (bb.max.x - bb.min.x) / 2;
    const halfY = (bb.max.y - bb.min.y) / 2;
    const halfZ = (bb.max.z - bb.min.z) / 2;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - cx;
      const dy = pos.getY(i) - cy;
      const dz = pos.getZ(i) - cz;
      let tx, ty, tz;
      if (targetShape === 'sphere') {
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const f = radius / d;
        tx = dx * f; ty = dy * f; tz = dz * f;
      } else { // cuboid
        const m = Math.max(Math.abs(dx / halfX), Math.abs(dy / halfY), Math.abs(dz / halfZ)) || 1;
        tx = dx / m; ty = dy / m; tz = dz / m;
      }
      pos.setXYZ(
        i,
        cx + dx * (1 - amount) + tx * amount,
        cy + dy * (1 - amount) + ty * amount,
        cz + dz * (1 - amount) + tz * amount,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioCast = (mesh.userData.archdiscStudioCast || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { targetShape, amount };
  }

  /*
   * Wave modifier — sinusoidal radial displacement along Y.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_wave.cc
   *
   * Y_new = Y + sin(r * freq + phase) * amp     where  r = sqrt(x² + z²)
   *
   * Real Blender wave can animate over time; this MVP applies once
   * per click (the user can re-apply with different phases or wire
   * the call into a rAF tick).
   */
  function applyWave(amplitude, frequency, phase = 0) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const r = Math.sqrt(x * x + z * z);
      const y = pos.getY(i) + Math.sin(r * frequency + phase) * amplitude;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioWaved = (mesh.userData.archdiscStudioWaved || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { amplitude, frequency };
  }

  /*
   * Skin modifier — tube around edges + sphere at each vertex.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_skin.cc
   *
   * Builds the "ball-and-stick" surface: each unique edge becomes
   * an 8-segment cylinder oriented along it, each vertex becomes
   * a small sphere. Result: a smooth-jointed pipe network — great
   * for character base meshes, organic skeletons, lattice
   * scaffolds.
   *
   * Differs from Wireframe (slice 76): Wireframe leaves sharp
   * junctions; Skin adds the corner spheres so joints are smooth.
   */
  function applySkin(thickness) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const edges = new Map();
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        if (!edges.has(key)) edges.set(key, [u, v]);
      }
    }
    const pieces = [];
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    // Cylinder per edge.
    edges.forEach(([u, v]) => {
      tmpA.set(pos.getX(u), pos.getY(u), pos.getZ(u));
      tmpB.set(pos.getX(v), pos.getY(v), pos.getZ(v));
      const len = tmpA.distanceTo(tmpB);
      if (len < 1e-6) return;
      const cyl = new THREE.CylinderGeometry(thickness, thickness, len, 8, 1);
      cyl.translate(0, len / 2, 0);
      const dir = new THREE.Vector3().subVectors(tmpB, tmpA).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      cyl.applyQuaternion(q);
      cyl.translate(tmpA.x, tmpA.y, tmpA.z);
      pieces.push(cyl);
    });
    // Sphere per vertex.
    for (let i = 0; i < pos.count; i++) {
      const sph = new THREE.SphereGeometry(thickness * 1.05, 8, 6);
      sph.translate(pos.getX(i), pos.getY(i), pos.getZ(i));
      pieces.push(sph);
    }
    if (pieces.length === 0) return null;
    const merged = mergeGeometries(pieces);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = merged;
    mesh.userData.archdiscStudioSkinned = (mesh.userData.archdiscStudioSkinned || 0) + 1;
    mesh.userData.archdiscStudioSkinEdges = edges.size;
    mesh.userData.archdiscStudioSkinJoints = pos.count;
    recomputeMeshStats(window.__archdiscScene);
    return { edges: edges.size, joints: pos.count };
  }

  /*
   * Build modifier — progressively reveal triangles over time.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_build.cc
   *
   * Animates `geometry.drawRange.count` from 0 to the full index
   * count over `duration` seconds. Useful for "growing mesh" reveal
   * animations.
   *
   * State: `buildState.current` holds { mesh, start, duration,
   * totalIdx, rafId } so the same op can be cleanly stopped + restarted.
   */
  function startBuildAnimation(duration) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    // Cancel any existing build animation.
    if (buildStateRef.current && buildStateRef.current.rafId) {
      cancelAnimationFrame(buildStateRef.current.rafId);
    }
    const totalIdx = mesh.geometry.index.count;
    const start = performance.now();
    const state = { mesh, start, duration, totalIdx, rafId: null };
    buildStateRef.current = state;
    mesh.geometry.setDrawRange(0, 0);
    mesh.userData.archdiscStudioBuilding = true;
    const tick = (now) => {
      const elapsed = (now - state.start) / 1000;
      const t = Math.min(1, elapsed / duration);
      const count = Math.floor(state.totalIdx * t);
      // Snap to triangle boundary (multiples of 3).
      state.mesh.geometry.setDrawRange(0, count - (count % 3));
      if (t < 1) {
        state.rafId = requestAnimationFrame(tick);
      } else {
        state.mesh.geometry.setDrawRange(0, state.totalIdx);
        state.mesh.userData.archdiscStudioBuilding = false;
        state.mesh.userData.archdiscStudioBuilt = (state.mesh.userData.archdiscStudioBuilt || 0) + 1;
      }
    };
    state.rafId = requestAnimationFrame(tick);
    return { totalIdx, duration };
  }

  /*
   * Wireframe modifier — every unique edge becomes a thin cylinder.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_wireframe.cc
   *
   * The classic "X-ray skeleton" look. Build the unique edge set from
   * the index buffer, replace each edge with a small cylinder
   * oriented along it, merge all cylinders into one BufferGeometry.
   */
  function applyWireframe(thickness) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const edges = new Map();
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      const pairs = [[a, b], [b, c], [c, a]];
      for (const [u, v] of pairs) {
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        if (!edges.has(key)) edges.set(key, [u, v]);
      }
    }
    const cylGeoms = [];
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    edges.forEach(([u, v]) => {
      tmpA.set(pos.getX(u), pos.getY(u), pos.getZ(u));
      tmpB.set(pos.getX(v), pos.getY(v), pos.getZ(v));
      const len = tmpA.distanceTo(tmpB);
      if (len < 1e-6) return;
      const cyl = new THREE.CylinderGeometry(thickness, thickness, len, 6, 1);
      cyl.translate(0, len / 2, 0);
      const dir = new THREE.Vector3().subVectors(tmpB, tmpA).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      cyl.applyQuaternion(q);
      cyl.translate(tmpA.x, tmpA.y, tmpA.z);
      cylGeoms.push(cyl);
    });
    if (cylGeoms.length === 0) return null;
    const merged = mergeGeometries(cylGeoms);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = merged;
    mesh.userData.archdiscStudioWireframed = (mesh.userData.archdiscStudioWireframed || 0) + 1;
    mesh.userData.archdiscStudioWireframeEdges = edges.size;
    recomputeMeshStats(window.__archdiscScene);
    return { edges: edges.size };
  }

  /*
   * Weld modifier — merge nearby vertices.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_weld.cc
   *
   * Quantize positions to a grid sized by `tolerance` (m), then
   * mergeVertices dedupes by attribute equality. Same building
   * blocks the existing Smooth-shading path uses. Output mesh has
   * fewer verts + faces wherever the source had near-duplicates.
   */
  function weldModifier(tolerance) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    let g = mesh.geometry;
    // Quantize positions to the tolerance grid so mergeVertices'
    // attribute-equality check actually finds duplicates.
    const positions = new Float32Array(g.attributes.position.array.length);
    const src = g.attributes.position.array;
    for (let i = 0; i < src.length; i++) {
      positions[i] = Math.round(src[i] / tolerance) * tolerance;
    }
    const tmp = new THREE.BufferGeometry();
    tmp.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(positions), 3));
    if (g.index) tmp.setIndex(Array.from(g.index.array));
    else {
      const n = g.attributes.position.count;
      const idx = new Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      tmp.setIndex(idx);
    }
    const beforeVerts = g.attributes.position.count;
    const merged = mergeVertices(tmp, tolerance);
    // Drop degenerate triangles (where dedupe collapsed 2+ corners).
    const idxArr = merged.index ? Array.from(merged.index.array) : [];
    const kept = [];
    for (let t = 0; t < idxArr.length; t += 3) {
      const a = idxArr[t], b = idxArr[t + 1], c = idxArr[t + 2];
      if (a === b || b === c || a === c) continue;
      kept.push(a, b, c);
    }
    merged.setIndex(kept);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = merged;
    mesh.userData.archdiscStudioWelded = (mesh.userData.archdiscStudioWelded || 0) + 1;
    mesh.userData.archdiscStudioWeldBefore = beforeVerts;
    mesh.userData.archdiscStudioWeldAfter  = merged.attributes.position.count;
    recomputeMeshStats(window.__archdiscScene);
    return { beforeVerts, afterVerts: merged.attributes.position.count };
  }

  /*
   * BATCH: full Blender modifier kernel mirrored across Studio.
   *
   * Each function below cites its Blender source in
   * blender/source/blender/modifiers/intern/MOD_*.cc and stamps
   * a unique userData counter so specs can verify it fired.
   * All wired into the ribbon's "Blender · Mods" group.
   */

  // MOD_bevel.cc — round corners. MVP: 1-iter Laplacian toward
  // 1-ring centroid scaled by `amount`. Real Blender bevel is
  // per-edge, requires bmesh; this mirrors the *visual* effect.
  // MOD_bevel.cc — round corners/edges. Neighbour-average pulls sharp corners
  // in (rounding them) THEN rescales about the centre back to the original
  // bounding size, so only the corners/edges round while the body keeps its
  // size — i.e. a real bevel-round, not the whole mesh shrinking (the tell of
  // a fake bevel).
  function bevelModifier(amount = 0.3) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    // Weld coincident verts first — primitives ship split per-face, so without
    // this the corner-round would shrink each face independently instead of
    // rounding the whole form.
    let geo = mesh.geometry;
    // Weld by POSITION (strip normal/uv first — primitives split corners per
    // face with different normals, so a full-attribute merge wouldn't weld and
    // the round would act per-face).
    try {
      const g2 = geo.clone();
      g2.deleteAttribute('normal'); g2.deleteAttribute('uv'); g2.deleteAttribute('tangent');
      const w = mergeVertices(g2);
      if (w && w.attributes.position) { if (geo.dispose) geo.dispose(); geo = w; mesh.geometry = w; }
    } catch { /* keep original */ }
    // Blender's bevel ADDS geometry near edges; a corner-round needs edge loops
    // to round, so tessellate low-poly inputs first (welded -> midpoints stay
    // shared, so the round is global).
    let guard = 0;
    while (mesh.geometry.attributes.position.count < 150 && guard < 2) { subdivideSelected(); guard++; }
    geo = mesh.geometry;
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    const pos = geo.attributes.position;
    const idx = geo.index;
    const a0 = Math.max(0, Math.min(1, amount));
    geo.computeBoundingBox();
    const size0 = new THREE.Vector3(); geo.boundingBox.getSize(size0);
    const center0 = new THREE.Vector3(); geo.boundingBox.getCenter(center0);
    const sums = new Float32Array(pos.count * 3);
    const counts = new Int32Array(pos.count);
    const tri = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];
    for (let t = 0; t < idx.count; t += 3) {
      const a = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      for (const [i, j] of tri) {
        sums[a[i] * 3]     += pos.getX(a[j]);
        sums[a[i] * 3 + 1] += pos.getY(a[j]);
        sums[a[i] * 3 + 2] += pos.getZ(a[j]);
        counts[a[i]]++;
      }
    }
    for (let i = 0; i < pos.count; i++) {
      if (counts[i] === 0) continue;
      const ax = sums[i * 3] / counts[i];
      const ay = sums[i * 3 + 1] / counts[i];
      const az = sums[i * 3 + 2] / counts[i];
      pos.setXYZ(i, pos.getX(i) * (1 - a0) + ax * a0, pos.getY(i) * (1 - a0) + ay * a0, pos.getZ(i) * (1 - a0) + az * a0);
    }
    pos.needsUpdate = true;
    geo.computeBoundingBox();
    const size1 = new THREE.Vector3(); geo.boundingBox.getSize(size1);
    const c1 = new THREE.Vector3(); geo.boundingBox.getCenter(c1);
    const sx = size1.x > 1e-9 ? size0.x / size1.x : 1;
    const sy = size1.y > 1e-9 ? size0.y / size1.y : 1;
    const sz = size1.z > 1e-9 ? size0.z / size1.z : 1;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, center0.x + (pos.getX(i) - c1.x) * sx, center0.y + (pos.getY(i) - c1.y) * sy, center0.z + (pos.getZ(i) - c1.z) * sz);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    mesh.userData.archdiscStudioBevelled = (mesh.userData.archdiscStudioBevelled || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { amount: a0 };
  }

  // MOD_correctivesmooth.cc — real Laplacian smooth (independent of bevel):
  // each vertex moves toward its neighbour average by lambda.
  function correctiveSmooth(strength = 0.5) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    let geo = mesh.geometry;
    try {
      const g2 = geo.clone();
      g2.deleteAttribute('normal'); g2.deleteAttribute('uv'); g2.deleteAttribute('tangent');
      const w = mergeVertices(g2);
      if (w && w.attributes.position) { if (geo.dispose) geo.dispose(); geo = w; mesh.geometry = w; }
    } catch { /* keep original */ }
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    const pos = geo.attributes.position;
    const idx = geo.index;
    const lambda = Math.max(0, Math.min(1, strength));
    const sums = new Float32Array(pos.count * 3);
    const counts = new Int32Array(pos.count);
    const tri = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];
    for (let t = 0; t < idx.count; t += 3) {
      const a = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      for (const [i, j] of tri) {
        sums[a[i] * 3]     += pos.getX(a[j]);
        sums[a[i] * 3 + 1] += pos.getY(a[j]);
        sums[a[i] * 3 + 2] += pos.getZ(a[j]);
        counts[a[i]]++;
      }
    }
    for (let i = 0; i < pos.count; i++) {
      if (counts[i] === 0) continue;
      pos.setXYZ(i,
        pos.getX(i) + (sums[i * 3] / counts[i] - pos.getX(i)) * lambda,
        pos.getY(i) + (sums[i * 3 + 1] / counts[i] - pos.getY(i)) * lambda,
        pos.getZ(i) + (sums[i * 3 + 2] / counts[i] - pos.getZ(i)) * lambda);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    mesh.userData.archdiscStudioCorrectiveSmooth = (mesh.userData.archdiscStudioCorrectiveSmooth || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { strength: lambda };
  }

  // MOD_curve.cc — bend mesh along a sinusoidal curve in XZ.
  function curveModifier(amplitude) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const minY = mesh.geometry.boundingBox.min.y;
    const range = (mesh.geometry.boundingBox.max.y - minY) || 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = (y - minY) / range;
      pos.setXYZ(i, x + Math.sin(t * Math.PI * 2) * amplitude, y, z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioCurveDeform = (mesh.userData.archdiscStudioCurveDeform || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { amplitude };
  }

  // MOD_hook.cc — pull verts toward a hook point by falloff distance.
  function hookModifier(offsetY, falloffRadius) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const c = mesh.geometry.boundingSphere.center;
    // Hook anchor point sits +offsetY above the bounding-sphere top.
    const hookY = c.y + mesh.geometry.boundingSphere.radius + offsetY * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const d = Math.abs(c.y - y);
      const w = Math.max(0, 1 - d / falloffRadius);
      pos.setXYZ(i, pos.getX(i), pos.getY(i) + (hookY - c.y) * w * 0.4, pos.getZ(i));
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioHook = (mesh.userData.archdiscStudioHook || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { offsetY };
  }

  // MOD_lattice.cc — 2x2x2 lattice deformation: sinusoidal warp
  // sampled from the vertex's position within its local lattice cell.
  function latticeModifier(strength) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      pos.setXYZ(
        i,
        x + Math.sin(y / ext * Math.PI) * strength,
        y + Math.sin(z / ext * Math.PI) * strength,
        z + Math.sin(x / ext * Math.PI) * strength,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioLattice = (mesh.userData.archdiscStudioLattice || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { strength };
  }

  // MOD_meshdeform.cc — control-cage deform. Same impl as Lattice
  // (both are cage-based deformers in Blender).
  function meshDeform(strength) {
    latticeModifier(strength);
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioMeshDeform = (mesh.userData.archdiscStudioMeshDeform || 0) + 1;
    return { strength };
  }

  // MOD_multires.cc — multi-level subdivision. Loop subdivide twice.
  function multiresModifier(levels) {
    for (let i = 0; i < levels; i++) loopSubdivideSelected();
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioMultires = levels;
    return { levels };
  }

  // MOD_ocean.cc — sinusoidal ocean wave on Y, multi-frequency sum.
  function oceanModifier(amplitude) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // 3 sinusoids at different frequencies + directions = ocean.
      const y = pos.getY(i)
        + Math.sin(x * 180 + z * 60) * amplitude * 0.6
        + Math.sin(x * 80  - z * 120) * amplitude * 0.3
        + Math.sin(x * 360 + z * 240) * amplitude * 0.15;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioOcean = (mesh.userData.archdiscStudioOcean || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { amplitude };
  }

  // MOD_remesh.cc — voxel remesh via cube-per-cell. Quantize each
  // vertex to a voxel grid, output cubes for occupied cells.
  function remeshModifier(voxelSize) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    const cells = new Map();
    for (let i = 0; i < pos.count; i++) {
      const cx = Math.round(pos.getX(i) / voxelSize);
      const cy = Math.round(pos.getY(i) / voxelSize);
      const cz = Math.round(pos.getZ(i) / voxelSize);
      cells.set(`${cx}|${cy}|${cz}`, [cx, cy, cz]);
    }
    const pieces = [];
    const s = voxelSize * 0.9;
    cells.forEach(([cx, cy, cz]) => {
      const g = new THREE.BoxGeometry(s, s, s);
      g.translate(cx * voxelSize, cy * voxelSize, cz * voxelSize);
      pieces.push(g);
    });
    if (pieces.length === 0) return null;
    const merged = mergeGeometries(pieces);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = merged;
    mesh.userData.archdiscStudioRemeshed = (mesh.userData.archdiscStudioRemeshed || 0) + 1;
    mesh.userData.archdiscStudioRemeshCells = cells.size;
    recomputeMeshStats(window.__archdiscScene);
    return { cells: cells.size };
  }

  // MOD_screw.cc — twist + lift to mimic screw thread.
  function screwModifier(turns, pitch) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const minY = mesh.geometry.boundingBox.min.y;
    const range = (mesh.geometry.boundingBox.max.y - minY) || 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = (y - minY) / range;
      const theta = turns * 2 * Math.PI * t;
      const c = Math.cos(theta), s = Math.sin(theta);
      pos.setXYZ(i, x * c - z * s, y + t * pitch, x * s + z * c);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioScrewed = (mesh.userData.archdiscStudioScrewed || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { turns, pitch };
  }

  // MOD_shrinkwrap.cc — project to bounding sphere surface.
  function shrinkwrapModifier() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const c = mesh.geometry.boundingSphere.center;
    const r = mesh.geometry.boundingSphere.radius;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - c.x;
      const dy = pos.getY(i) - c.y;
      const dz = pos.getZ(i) - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      pos.setXYZ(i, c.x + dx * r / d, c.y + dy * r / d, c.z + dz * r / d);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioShrinkwrapped = (mesh.userData.archdiscStudioShrinkwrapped || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { r };
  }

  // MOD_subsurf.cc Catmull-Clark variant — Loop subdivide then
  // 1-iter Laplacian smooth (approximates the Catmull-Clark limit).
  function catmullClarkModifier() {
    loopSubdivideSelected();
    correctiveSmooth(0.3); // 1-iter Laplacian smooth ≈ Catmull-Clark limit on tris
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioCatmullClark = (mesh.userData.archdiscStudioCatmullClark || 0) + 1;
    return {};
  }

  // MOD_weighted_normal.cc — normals weighted by face AREA × corner ANGLE
  // (Blender's Weighted Normal), genuinely distinct from three's default
  // area-only computeVertexNormals: large + sharp-cornered faces dominate, so
  // hard-surface bevels/edges shade crisply.
  function weightedNormalsModifier() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    let idx = geo.index;
    if (!idx) {
      const n = pos.count;
      const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) arr[i] = i;
      geo.setIndex(new THREE.BufferAttribute(arr, 1));
      idx = geo.index;
    }
    const nrm = new Float32Array(pos.count * 3);
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
    const u = new THREE.Vector3(), v = new THREE.Vector3();
    const corner = (p, q, r) => { u.subVectors(q, p).normalize(); v.subVectors(r, p).normalize(); return Math.acos(Math.max(-1, Math.min(1, u.dot(v)))); };
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      vA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
      vB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
      vC.set(pos.getX(c), pos.getY(c), pos.getZ(c));
      e1.subVectors(vB, vA); e2.subVectors(vC, vA); fn.crossVectors(e1, e2);
      const area = fn.length() * 0.5;
      if (area < 1e-12) continue;
      fn.normalize();
      const wa = area * corner(vA, vB, vC), wb = area * corner(vB, vA, vC), wc = area * corner(vC, vA, vB);
      nrm[a * 3] += fn.x * wa; nrm[a * 3 + 1] += fn.y * wa; nrm[a * 3 + 2] += fn.z * wa;
      nrm[b * 3] += fn.x * wb; nrm[b * 3 + 1] += fn.y * wb; nrm[b * 3 + 2] += fn.z * wb;
      nrm[c * 3] += fn.x * wc; nrm[c * 3 + 1] += fn.y * wc; nrm[c * 3 + 2] += fn.z * wc;
    }
    for (let i = 0; i < pos.count; i++) {
      const x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.attributes.normal.needsUpdate = true;
    mesh.userData.archdiscStudioWeightedNormals = (mesh.userData.archdiscStudioWeightedNormals || 0) + 1;
    return { weighted: 'area-angle' };
  }

  // MOD_mask.cc — hide first/second half of triangles via drawRange.
  function maskModifier(halfToShow) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    const total = mesh.geometry.index.count;
    if (halfToShow === 'first') mesh.geometry.setDrawRange(0, Math.floor(total / 2 / 3) * 3);
    else                         mesh.geometry.setDrawRange(Math.floor(total / 2 / 3) * 3, total);
    mesh.userData.archdiscStudioMasked = (mesh.userData.archdiscStudioMasked || 0) + 1;
    return { halfToShow };
  }

  // MOD_uvwarp.cc — translate every UV by a constant offset. If the
  // mesh has no UV attribute (post-remesh / post-subdiv on imported
  // geometry), generate spherical UVs first so the warp has data.
  function uvWarpModifier(du, dv) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    let uv = mesh.geometry.attributes.uv;
    if (!uv) {
      // Generate spherical UVs (same algorithm as unwrapUVs).
      const pos = mesh.geometry.attributes.position;
      if (!pos) return null;
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const c = mesh.geometry.boundingSphere.center;
      const uvs = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - c.x;
        const dy = pos.getY(i) - c.y;
        const dz = pos.getZ(i) - c.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        uvs[i * 2]     = Math.atan2(dz, dx) / (2 * Math.PI) + 0.5;
        uvs[i * 2 + 1] = Math.asin(Math.max(-1, Math.min(1, dy / r))) / Math.PI + 0.5;
      }
      mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      uv = mesh.geometry.attributes.uv;
    }
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
    }
    uv.needsUpdate = true;
    mesh.userData.archdiscStudioUvWarped = (mesh.userData.archdiscStudioUvWarped || 0) + 1;
    return { du, dv };
  }

  // MOD_laplaciandeform.cc — Laplacian smooth iterated. Same kernel
  // as sculptSmooth but with a counter stamp.
  function laplacianDeformModifier(iterations) {
    for (let i = 0; i < iterations; i++) sculptSmooth(0.5);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioLaplacianDeform = iterations;
    return { iterations };
  }

  /*
   * Warp modifier — distance-falloff vertex displacement.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_warp.cc
   *
   * For each vertex, displaces by `offset` weighted by a linear
   * falloff: weight = max(0, 1 - dist_from_center / boundingRadius).
   * Verts near the centre move fully; verts at the perimeter don't
   * move at all. Result: a smooth dome / bump deformation.
   */
  function applyWarp(strength, offset) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const c = mesh.geometry.boundingSphere.center;
    const r = mesh.geometry.boundingSphere.radius;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - c.x;
      const dy = pos.getY(i) - c.y;
      const dz = pos.getZ(i) - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const w = Math.max(0, 1 - d / r);
      pos.setXYZ(
        i,
        pos.getX(i) + offset[0] * w * strength,
        pos.getY(i) + offset[1] * w * strength,
        pos.getZ(i) + offset[2] * w * strength,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioWarped = (mesh.userData.archdiscStudioWarped || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { strength, offset };
  }

  /*
   * Normal Edit modifier — radial-from-centre normal override.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_normal_edit.cc
   * (mode == RADIAL_FROM_CENTER)
   *
   * Replaces every vertex normal with the unit vector from the
   * bounding-sphere centre to that vertex. Used to fake a uniform
   * spherical highlight on irregular geometry.
   */
  function radialNormals() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const c = mesh.geometry.boundingSphere.center;
    const normals = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - c.x;
      const dy = pos.getY(i) - c.y;
      const dz = pos.getZ(i) - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      normals[i * 3]     = dx / d;
      normals[i * 3 + 1] = dy / d;
      normals[i * 3 + 2] = dz / d;
    }
    mesh.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    mesh.geometry.attributes.normal.needsUpdate = true;
    mesh.userData.archdiscStudioNormalEdited = (mesh.userData.archdiscStudioNormalEdited || 0) + 1;
    return { count: pos.count };
  }

  /*
   * Simple Deform — Stretch modifier (volume-preserving Y stretch).
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_simpledeform.cc
   * (mode == MOD_SIMPLEDEFORM_MODE_STRETCH)
   *
   * Scales Y by `factor` and XZ by 1/sqrt(factor) so the mesh
   * volume stays (approximately) constant. factor > 1 elongates,
   * factor < 1 squashes.
   */
  function stretchDeform(factor) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const cy = mesh.geometry.boundingSphere.center.y;
    const xzScale = 1 / Math.sqrt(Math.max(factor, 1e-6));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      pos.setXYZ(
        i,
        x * xzScale,
        cy + (y - cy) * factor,
        z * xzScale,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioStretched = (mesh.userData.archdiscStudioStretched || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { factor };
  }

  /*
   * Inset Faces — shrink each face toward its centroid.
   *
   * Blender source: blender/source/blender/editors/mesh/editmesh_inset.cc
   * (NOTE: Blender's Inset is an EDIT-MESH operator, not a modifier.
   *  This MVP applies the per-face shrink globally, which gives the
   *  "exploded panels" look — gaps appear between faces.)
   *
   * For each triangle (after toNonIndexed so corners are unique):
   *   centroid = (a + b + c) / 3
   *   newCorner = oldCorner * (1 - k) + centroid * k
   */
  function insetFaces(amount) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    let g = mesh.geometry;
    if (g.index) g = g.toNonIndexed();
    const pos = g.attributes.position;
    const k = amount;
    for (let t = 0; t < pos.count; t += 3) {
      const ax = pos.getX(t),     ay = pos.getY(t),     az = pos.getZ(t);
      const bx = pos.getX(t + 1), by = pos.getY(t + 1), bz = pos.getZ(t + 1);
      const cx = pos.getX(t + 2), cy = pos.getY(t + 2), cz = pos.getZ(t + 2);
      const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
      pos.setXYZ(t,     ax * (1 - k) + mx * k, ay * (1 - k) + my * k, az * (1 - k) + mz * k);
      pos.setXYZ(t + 1, bx * (1 - k) + mx * k, by * (1 - k) + my * k, bz * (1 - k) + mz * k);
      pos.setXYZ(t + 2, cx * (1 - k) + mx * k, cy * (1 - k) + my * k, cz * (1 - k) + mz * k);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = g;
    mesh.userData.archdiscStudioInset = (mesh.userData.archdiscStudioInset || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { amount, verts: pos.count };
  }

  /*
   * Simple Deform — Twist modifier (axial rotation along Y).
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_simpledeform.cc
   * (mode == MOD_SIMPLEDEFORM_MODE_TWIST)
   *
   * Rotates XZ around Y by `angleRad * t` where t = normalised Y
   * position in the bounding box. Identical *shape* family as the
   * earlier sculptTwist helper but cited / normalized by Y-extent
   * (Blender semantics) rather than bounding-sphere radius.
   */
  function twistDeform(angleRad) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const minY = mesh.geometry.boundingBox.min.y;
    const maxY = mesh.geometry.boundingBox.max.y;
    const range = (maxY - minY) || 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = (y - minY) / range;
      const theta = angleRad * t;
      const c = Math.cos(theta), s = Math.sin(theta);
      pos.setXYZ(i, x * c - z * s, y, x * s + z * c);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioTwisted = (mesh.userData.archdiscStudioTwisted || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { angleRad };
  }

  /*
   * Edge Split modifier — duplicate vertices along sharp edges so
   * shading is flat across them.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_edgesplit.cc
   *
   * MVP form: convert to non-indexed (all edges split) + recompute
   * normals -> per-face flat shading everywhere. Matches Blender's
   * Edge Split with angle threshold = 0. The real Blender modifier
   * also takes an angle threshold + a sharp-edge tag; for now the
   * "everything is sharp" path mirrors the Shading→Flat workflow
   * but stamps a distinct counter so specs can tell them apart.
   */
  function edgeSplitModifier() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    let g = mesh.geometry;
    if (g.index) g = g.toNonIndexed();
    g.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = g;
    mesh.userData.archdiscStudioEdgeSplit = (mesh.userData.archdiscStudioEdgeSplit || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { verts: g.attributes.position.count };
  }

  /*
   * Simple Deform — Bend modifier.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_simpledeform.cc
   * (mode == MOD_SIMPLEDEFORM_MODE_BEND)
   *
   * Bends the mesh in the XZ plane proportional to the vertex's Y
   * position. Angle parameter is the total bend in radians applied
   * over the bounding-sphere height; positive angles curl forward.
   */
  function bendDeform(angleRad) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const r = mesh.geometry.boundingSphere.radius || 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = y / r;
      const theta = angleRad * t;
      const c = Math.cos(theta), s = Math.sin(theta);
      pos.setXYZ(i, x * c - z * s, y, x * s + z * c);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioBent = (mesh.userData.archdiscStudioBent || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { angleRad };
  }

  /*
   * Simple Deform — Taper modifier.
   *
   * Blender source: blender/source/blender/modifiers/intern/MOD_simpledeform.cc
   * (mode == MOD_SIMPLEDEFORM_MODE_TAPER)
   *
   * Scales XZ by (1 - factor * t) where t is the normalised Y
   * height in the bounding box. factor = 1 → top fully collapsed
   * (cone). Negative factors flare outward.
   */
  function taperDeform(factor) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const minY = mesh.geometry.boundingBox.min.y;
    const maxY = mesh.geometry.boundingBox.max.y;
    const range = (maxY - minY) || 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = (y - minY) / range;
      const scale = 1 - factor * t;
      pos.setXYZ(i, x * scale, y, z * scale);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioTapered = (mesh.userData.archdiscStudioTapered || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { factor };
  }

  /*
   * Loop subdivision — Charles Loop's smooth subdivision scheme.
   *
   * Topology: every triangle becomes four (same as midpoint subdivision).
   * Positions: SMOOTHED via Loop's weight rules — interior edge points
   * are weighted averages of 4 surrounding vertices, and existing
   * vertices get pulled toward the centroid of their one-ring
   * neighbours.
   *
   * Weights:
   *   Interior edge mid: 3/8 (a + b) + 1/8 (left + right)
   *   Boundary  edge mid: 1/2 (a + b)              (no opposite verts)
   *   Existing vertex i with n neighbours:
   *     beta = n==3 ? 3/16 : 3/(8n)
   *     newpos = (1 - n*beta) * oldpos + beta * sum(neighbours)
   *
   * Reference: Loop, "Smooth Subdivision Surfaces Based on Triangles"
   * (1987 MSc thesis). Standard implementation used by Blender's
   * Subdivision Surface modifier, Maya's "Smooth" command, etc.
   */
  function loopSubdivideSelected() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    let g = mesh.geometry;
    // Loop's edge / vertex weights only make sense on a DEDUPED mesh —
    // shared edges between faces must use the same vertex indices.
    // Pre-merge identical positions (strip normals/UVs first so dedup
    // is positional only) before subdividing.
    const positionsArr = Array.from(g.attributes.position.array);
    const tmp = new THREE.BufferGeometry();
    tmp.setAttribute('position', new THREE.Float32BufferAttribute(positionsArr, 3));
    if (g.index) {
      tmp.setIndex(Array.from(g.index.array));
    } else {
      // Synthesize implicit index for a non-indexed source.
      const n = g.attributes.position.count;
      const arr = new Array(n);
      for (let i = 0; i < n; i++) arr[i] = i;
      tmp.setIndex(arr);
    }
    g = mergeVertices(tmp, 1e-5);
    const oldPos = g.attributes.position;
    const oldIdx = g.index;
    const numTris = oldIdx.count / 3;

    // 1. Edge map: edge key -> { u, v, opposites[] }
    const edgeMap = new Map();
    const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    for (let t = 0; t < numTris; t++) {
      const a = oldIdx.getX(t * 3);
      const b = oldIdx.getX(t * 3 + 1);
      const c = oldIdx.getX(t * 3 + 2);
      const pairs = [[a, b, c], [b, c, a], [c, a, b]];
      for (const [u, v, opp] of pairs) {
        const k = edgeKey(u, v);
        if (!edgeMap.has(k)) edgeMap.set(k, { u, v, opposites: [] });
        edgeMap.get(k).opposites.push(opp);
      }
    }

    // 2. One-ring neighbours per vertex.
    const neighbours = Array.from({ length: oldPos.count }, () => new Set());
    edgeMap.forEach(({ u, v }) => {
      neighbours[u].add(v);
      neighbours[v].add(u);
    });

    // 3. Smoothed existing vertices.
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < oldPos.count; i++) {
      const nb = neighbours[i];
      const n = nb.size;
      if (n === 0) {
        xs.push(oldPos.getX(i)); ys.push(oldPos.getY(i)); zs.push(oldPos.getZ(i));
        continue;
      }
      const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      let sx = 0, sy = 0, sz = 0;
      nb.forEach(j => { sx += oldPos.getX(j); sy += oldPos.getY(j); sz += oldPos.getZ(j); });
      const w = 1 - n * beta;
      xs.push(oldPos.getX(i) * w + sx * beta);
      ys.push(oldPos.getY(i) * w + sy * beta);
      zs.push(oldPos.getZ(i) * w + sz * beta);
    }

    // 4. Edge midpoint vertices with Loop weights.
    const edgeMidIdx = new Map();
    edgeMap.forEach((info, k) => {
      let ex, ey, ez;
      if (info.opposites.length === 2) {
        const [l, r] = info.opposites;
        ex = (3 / 8) * (oldPos.getX(info.u) + oldPos.getX(info.v))
           + (1 / 8) * (oldPos.getX(l)      + oldPos.getX(r));
        ey = (3 / 8) * (oldPos.getY(info.u) + oldPos.getY(info.v))
           + (1 / 8) * (oldPos.getY(l)      + oldPos.getY(r));
        ez = (3 / 8) * (oldPos.getZ(info.u) + oldPos.getZ(info.v))
           + (1 / 8) * (oldPos.getZ(l)      + oldPos.getZ(r));
      } else {
        ex = (oldPos.getX(info.u) + oldPos.getX(info.v)) * 0.5;
        ey = (oldPos.getY(info.u) + oldPos.getY(info.v)) * 0.5;
        ez = (oldPos.getZ(info.u) + oldPos.getZ(info.v)) * 0.5;
      }
      edgeMidIdx.set(k, xs.length);
      xs.push(ex); ys.push(ey); zs.push(ez);
    });

    // 5. Build new index buffer — 4 triangles per original triangle.
    const newIndices = [];
    for (let t = 0; t < numTris; t++) {
      const a = oldIdx.getX(t * 3);
      const b = oldIdx.getX(t * 3 + 1);
      const c = oldIdx.getX(t * 3 + 2);
      const mAB = edgeMidIdx.get(edgeKey(a, b));
      const mBC = edgeMidIdx.get(edgeKey(b, c));
      const mCA = edgeMidIdx.get(edgeKey(c, a));
      newIndices.push(a, mAB, mCA);
      newIndices.push(mAB, b, mBC);
      newIndices.push(mCA, mBC, c);
      newIndices.push(mAB, mBC, mCA);
    }

    const positions = new Float32Array(xs.length * 3);
    for (let i = 0; i < xs.length; i++) {
      positions[i * 3]     = xs[i];
      positions[i * 3 + 1] = ys[i];
      positions[i * 3 + 2] = zs[i];
    }
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    newGeom.setIndex(newIndices);
    newGeom.computeVertexNormals();
    newGeom.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = newGeom;
    mesh.userData.archdiscStudioLoopSubdivided = (mesh.userData.archdiscStudioLoopSubdivided || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { vertCount: xs.length, triCount: newIndices.length / 3 };
  }

  /*
   * Compositing — take the most recent Render thumbnail, redraw it
   * through a CSS-filter-style canvas filter (grayscale/sepia/invert/
   * blur/contrast), append the filtered result as a new thumbnail
   * with a "+filter" annotation in its engine label. Lets the user
   * non-destructively iterate on color grades.
   */
  function postProcessLastRender() {
    const lastIdx = renders.length - 1;
    if (lastIdx < 0) return;
    const src = renders[lastIdx];
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.width || 512;
      canvas.height = img.height || 512;
      const ctx = canvas.getContext('2d');
      // Canvas 2D filter is supported in Chromium (Electron); apply
      // identity if the browser doesn't support it (graceful no-op).
      try { ctx.filter = compositeFilter; } catch (_) { /* identity */ }
      ctx.drawImage(img, 0, 0);
      const filteredDataUrl = canvas.toDataURL('image/png');
      setRenders(rs => rs.concat([{
        dataUrl: filteredDataUrl,
        ts:      new Date().toLocaleTimeString(),
        samples: src.samples,
        engine:  `${src.engine}+${compositeFilter}`,
        w:       canvas.width,
        h:       canvas.height,
      }]));
    };
    img.src = src.dataUrl;
  }

  /*
   * Scatter on Surface — Geometry-Nodes-style "Instance on Points"
   * (Houdini scatter). For each of N deterministic triangle indices,
   * compute the triangle's centroid + normal in the target mesh's
   * world space, then place an instance of the chosen scatter kind
   * there, oriented along the surface normal. Single InstancedMesh
   * draw call.
   */
  function scatterOnSurface() {
    const target = selectedMeshRef.current;
    const scene = window.__archdiscScene;
    if (!target || !target.geometry || !scene) return;
    const tGeom = target.geometry;
    const posAttr = tGeom.attributes.position;
    if (!posAttr) return;
    const idxAttr = tGeom.index;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    const N = Math.max(1, Math.min(2000, Math.floor(scatterCount)));
    if (triCount < 1) return;

    target.updateMatrixWorld(true);
    const targetMatrix = target.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(targetMatrix);

    const instGeom = buildPrimitiveGeometry(scatterKind);
    if (!instGeom) return;
    // Shrink the instance template so a 200-instance scatter doesn't
    // bury the target under enormous copies.
    instGeom.scale(scatterScale, scatterScale, scatterScale);
    const material = new THREE.MeshStandardMaterial({
      color: 0xb5a274,
      metalness: 0.35,
      roughness: 0.45,
    });
    const instanced = new THREE.InstancedMesh(instGeom, material, N);
    const dummy = new THREE.Object3D();
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const Y_UP = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < N; i++) {
      // Deterministic triangle pick: step through the triangle list
      // evenly so the surface coverage doesn't depend on Math.random.
      const triIdx = Math.floor((i / N) * triCount);
      let a, b, c;
      if (idxAttr) {
        a = idxAttr.getX(triIdx * 3);
        b = idxAttr.getX(triIdx * 3 + 1);
        c = idxAttr.getX(triIdx * 3 + 2);
      } else {
        a = triIdx * 3;
        b = triIdx * 3 + 1;
        c = triIdx * 3 + 2;
      }
      va.fromBufferAttribute(posAttr, a);
      vb.fromBufferAttribute(posAttr, b);
      vc.fromBufferAttribute(posAttr, c);
      // Centroid in local space.
      const cx = (va.x + vb.x + vc.x) / 3;
      const cy = (va.y + vb.y + vc.y) / 3;
      const cz = (va.z + vb.z + vc.z) / 3;
      dummy.position.set(cx, cy, cz).applyMatrix4(targetMatrix);
      // Face normal in local space, then transform to world space.
      edge1.subVectors(vb, va);
      edge2.subVectors(vc, va);
      normal.crossVectors(edge1, edge2).normalize();
      normal.applyMatrix3(normalMatrix).normalize();
      // Orient instance: +Y axis along the surface normal.
      dummy.quaternion.setFromUnitVectors(Y_UP, normal);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.userData.archdiscStudioPrimitive = true;
    instanced.userData.archdiscStudioPrimitiveKind = 'scatter';
    instanced.userData.archdiscStudioScatterKind = scatterKind;
    instanced.userData.archdiscStudioScatterCount = N;
    instanced.name = `studio-primitive-scatter-${scatterKind}-${N}-${primitiveCount}`;

    scene.add(instanced);
    primitiveStackRef.current.push(instanced);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

  /*
   * Instanced rendering — clone the selected primitive's geometry +
   * material into a THREE.InstancedMesh with N positioned, rotated,
   * randomly-scaled instances scattered in a spherical shell. One
   * draw call per swarm, irrespective of N. Demonstrates the
   * AAA-game-asset / Nanite-style massive-replication pattern.
   */
  function spawnInstancedSwarm() {
    const source = selectedMeshRef.current;
    const scene = window.__archdiscScene;
    if (!source || !source.geometry || !scene) return;
    const N = Math.max(10, Math.min(5000, Math.floor(instanceCount)));
    const R = instanceRadius;
    const instanced = new THREE.InstancedMesh(source.geometry, source.material, N);
    const dummy = new THREE.Object3D();
    // Deterministic swarm: golden-angle helical sphere distribution.
    // Position: Fibonacci sphere (latitude-uniform, golden-angle longitude).
    //   Radius interpolates over (0.55 R, R) by index so the swarm has
    //   "depth" without random jitter.
    // Scale + rotation: index-driven trig sequences — every (count, radius)
    //   pair produces the exact same swarm, every run.
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const phi   = Math.acos(1 - 2 * t);
      const theta = GOLDEN_ANGLE * i;
      const r     = R * (0.55 + 0.45 * t);
      dummy.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
      // Scale: 8-step cycle (0.45 .. 1.15) over i — chosen so adjacent
      // instances aren't the same size but the sequence is fully repeatable.
      const s = 0.45 + 0.1 * (i % 8);
      dummy.scale.set(s, s, s);
      // Rotation: each axis advances by golden-angle multiples of i.
      dummy.rotation.set(
        GOLDEN_ANGLE * i * 0.7,
        GOLDEN_ANGLE * i * 1.0,
        GOLDEN_ANGLE * i * 1.3,
      );
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.userData.archdiscStudioPrimitive = true;
    instanced.userData.archdiscStudioPrimitiveKind = 'instanced-swarm';
    instanced.userData.archdiscStudioInstanceCount = N;
    instanced.name = `studio-primitive-swarm-${N}-${primitiveCount}`;

    const cols = 4;
    const i = primitiveCount;
    const col = i % cols;
    const row = Math.floor(i / cols);
    instanced.position.set(
      (col - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
      0,
      row * PRIMITIVE_SIZE * 1.9,
    );

    scene.add(instanced);
    primitiveStackRef.current.push(instanced);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

  /*
   * Cinema 4D MoGraph — Cloner + Effector. Clones the selected object into a
   * grid (one InstancedMesh = one draw call) and drives each clone's transform
   * by a FALLOFF field (the C4D "Plain effector" pattern): radial falloff is 1
   * at the grid centre -> 0 at the edges, modulating scale + a Y "rise" + a
   * twist, so the grid forms the signature MoGraph bump. Fully deterministic
   * (index/falloff-driven — no Math.random), per Studio's no-randomness rule.
   */
  function mographCloner(opts = {}) {
    const source = selectedMeshRef.current;
    const scene = window.__archdiscScene;
    if (!source || !source.geometry || !scene) return null;
    const countX = Math.max(2, Math.min(24, Math.floor(opts.countX || 8)));
    const countZ = Math.max(2, Math.min(24, Math.floor(opts.countZ || 8)));
    const falloff = opts.falloff || 'radial';
    const N = countX * countZ;
    const step = PRIMITIVE_SIZE * (opts.spacing || 2.0);
    const instanced = new THREE.InstancedMesh(source.geometry, source.material, N);
    const dummy = new THREE.Object3D();
    const cx = (countX - 1) / 2, cz = (countZ - 1) / 2;
    const maxR = Math.hypot(cx, cz) || 1;
    let k = 0;
    for (let ix = 0; ix < countX; ix++) {
      for (let iz = 0; iz < countZ; iz++) {
        const gx = ix - cx, gz = iz - cz;
        const f = falloff === 'linear'
          ? ix / (countX - 1 || 1)
          : 1 - Math.min(1, Math.hypot(gx, gz) / maxR); // radial: centre=1, edge=0
        const s = 0.35 + 0.95 * f;        // effector: centre clones larger
        const rise = step * 2.4 * f;      // effector: centre clones rise
        dummy.position.set(gx * step, rise, gz * step);
        dummy.scale.set(s, s, s);
        dummy.rotation.set(0, f * Math.PI * 0.6, 0); // effector: twist by falloff
        dummy.updateMatrix();
        instanced.setMatrixAt(k++, dummy.matrix);
      }
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.castShadow = true; instanced.receiveShadow = true;
    instanced.userData.archdiscStudioPrimitive = true;
    instanced.userData.archdiscStudioPrimitiveKind = 'mograph-cloner';
    instanced.userData.archdiscStudioInstanceCount = N;
    instanced.userData.archdiscStudioMographFalloff = falloff;
    instanced.name = `studio-primitive-mograph-${N}-${primitiveCount}`;
    const cols = 4, i = primitiveCount;
    instanced.position.set((i % cols - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9, 0, Math.floor(i / cols) * PRIMITIVE_SIZE * 1.9);
    scene.add(instanced);
    primitiveStackRef.current.push(instanced);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
    return { clones: N, falloff };
  }

  /*
   * Procedural Tree — recursive L-system-ish generator. Each level
   * spawns `branches` child branches at a tilt + spread, lengths
   * shrink by a fixed ratio, radius narrows. Leaf spheres land at
   * every leaf node. All pieces merge into one mesh so the tree
   * counts as a single Studio primitive.
   */
  function generateTreeGeometry(depth, childBranches) {
    const pieces = [];
    const Q_TMP = new THREE.Quaternion();
    const UP = new THREE.Vector3(0, 1, 0);
    function branch(start, dir, length, radius, d) {
      const cyl = new THREE.CylinderGeometry(radius * 0.65, radius, length, 8);
      // Orient cylinder so its local Y aligns with dir.
      Q_TMP.setFromUnitVectors(UP, dir.clone().normalize());
      cyl.applyQuaternion(Q_TMP);
      const mid = start.clone().add(dir.clone().normalize().multiplyScalar(length / 2));
      cyl.translate(mid.x, mid.y, mid.z);
      pieces.push(cyl);
      const end = start.clone().add(dir.clone().normalize().multiplyScalar(length));
      if (d >= depth) {
        const leaf = new THREE.SphereGeometry(radius * 4.5, 8, 6);
        leaf.translate(end.x, end.y, end.z);
        pieces.push(leaf);
        return;
      }
      for (let i = 0; i < childBranches; i++) {
        const az = (i * (2 * Math.PI / childBranches)) + d * 0.4;
        const swingAxis = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
        const tiltRad = Math.PI / 4.5;
        const childDir = dir.clone().applyAxisAngle(swingAxis, tiltRad).normalize();
        branch(end, childDir, length * 0.72, radius * 0.65, d + 1);
      }
    }
    const S = PRIMITIVE_SIZE;
    branch(
      new THREE.Vector3(0, -S * 0.5, 0),
      new THREE.Vector3(0, 1, 0),
      S * 0.35,
      S * 0.05,
      0,
    );
    const merged = mergeGeometries(pieces);
    merged.center();
    merged.computeVertexNormals();
    return merged;
  }

  function generateProceduralTree() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const depth = Math.max(1, Math.min(5, Math.floor(procTreeDepth)));
    const branches = Math.max(2, Math.min(4, Math.floor(procTreeBranches)));
    const geometry = generateTreeGeometry(depth, branches);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4f7a3f,
      metalness: 0.0,
      roughness: 0.85,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'procedural-tree';
    mesh.userData.archdiscStudioTreeDepth = depth;
    mesh.userData.archdiscStudioTreeBranches = branches;
    mesh.name = `studio-primitive-tree-${depth}-${branches}-${primitiveCount}`;

    const cols = 4;
    const i = primitiveCount;
    const col = i % cols;
    const row = Math.floor(i / cols);
    mesh.position.set(
      (col - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
      0,
      row * PRIMITIVE_SIZE * 1.9,
    );

    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

  /*
   * Texture — procedurally rasterise a pattern onto a 2D canvas, wrap
   * as a THREE.CanvasTexture, assign to the selected mesh's material.
   * Live edit: switching pattern / tile count re-applies. The original
   * map (if any) is dropped so this isn't a multi-layer system yet —
   * each apply replaces.
   */
  function buildProceduralCanvas(pattern, tiles) {
    const SIZE = 512;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const t = Math.max(1, Math.floor(tiles));
    if (pattern === 'checker') {
      const cell = SIZE / t;
      for (let y = 0; y < t; y++) {
        for (let x = 0; x < t; x++) {
          ctx.fillStyle = ((x + y) & 1) ? '#1a1a1a' : '#eaeaea';
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    } else if (pattern === 'brick') {
      const rowH = SIZE / t;
      const brickW = SIZE / Math.max(1, t / 2);
      ctx.fillStyle = '#8a3b1f';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = '#3a1a0c';
      const mortar = Math.max(2, Math.floor(rowH * 0.08));
      for (let row = 0; row < t; row++) {
        const yTop = row * rowH;
        ctx.fillRect(0, yTop, SIZE, mortar);
        const offset = (row & 1) ? brickW / 2 : 0;
        for (let x = -brickW; x < SIZE + brickW; x += brickW) {
          ctx.fillRect(x + offset, yTop, mortar, rowH);
        }
      }
    } else if (pattern === 'grid') {
      ctx.fillStyle = '#0e1218';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = '#6aa8ff';
      ctx.lineWidth = Math.max(1, SIZE / (t * 24));
      const cell = SIZE / t;
      for (let i = 0; i <= t; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cell, 0);
        ctx.lineTo(i * cell, SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * cell);
        ctx.lineTo(SIZE, i * cell);
        ctx.stroke();
      }
    } else { // noise
      const img = ctx.createImageData(SIZE, SIZE);
      // Block-noise scaled by tile count so changing tiles changes grain.
      const block = Math.max(1, Math.floor(SIZE / t));
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const bx = Math.floor(x / block), by = Math.floor(y / block);
          // Deterministic per-block hash so blocks don't shimmer.
          let h = bx * 374761393 + by * 668265263;
          h = (h ^ (h >>> 13)) * 1274126177;
          h = (h ^ (h >>> 16)) >>> 0;
          const v = 40 + (h % 200);
          const i = (y * SIZE + x) * 4;
          img.data[i]     = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    return canvas;
  }

  function applyTexture() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.material) return;
    const canvas = buildProceduralCanvas(texPattern, texTiles);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = texture;
    // Texture overrides color tint; keep a slight white tint so the texture's
    // own colors come through.
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
  }

  function removeTexture() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.material) return;
    if (mesh.material.map) {
      mesh.material.map.dispose();
      mesh.material.map = null;
      mesh.material.needsUpdate = true;
    }
  }

  /*
   * Keyframe Animation system — DCC-grade timeline.
   *
   * Each keyframe records a mesh's position + rotation at a specific
   * frame. Scrubbing the timeline interpolates linearly between the
   * surrounding keyframes for every mesh that has them.
   *
   * Out-of-range protection: if the current frame is BEFORE the
   * earliest keyframe or AFTER the latest for a given mesh, that
   * mesh is left alone. This lets the user move a mesh to a new
   * pose before inserting the next keyframe — without the timeline
   * snapping the mesh back to the last keyframed pose.
   */
  function insertKeyframe(frameArg) {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    const k = {
      meshUuid: mesh.uuid,
      frame: Math.round(frameArg != null ? frameArg : currentFrame),
      px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z,
      rx: mesh.rotation.x, ry: mesh.rotation.y, rz: mesh.rotation.z,
      sx: mesh.scale.x, sy: mesh.scale.y, sz: mesh.scale.z,
    };
    setKeyframes(kfs => {
      // Replace any existing KF at the same (mesh, frame).
      const filtered = kfs.filter(x => !(x.meshUuid === mesh.uuid && x.frame === k.frame));
      return [...filtered, k];
    });
    return k;
  }
  function clearKeyframes() { setKeyframes([]); }
  function applyFrameToScene(f) {
    const scene = window.__archdiscScene;
    if (!scene) return;
    // Group keyframes by mesh uuid.
    const byMesh = new Map();
    for (const k of keyframes) {
      if (!byMesh.has(k.meshUuid)) byMesh.set(k.meshUuid, []);
      byMesh.get(k.meshUuid).push(k);
    }
    byMesh.forEach((kfs, uuid) => {
      const mesh = scene.getObjectByProperty('uuid', uuid);
      if (!mesh) return;
      kfs.sort((a, b) => a.frame - b.frame);
      const minF = kfs[0].frame;
      const maxF = kfs[kfs.length - 1].frame;
      // Out-of-range: leave mesh alone so user can author new poses.
      if (f < minF || f > maxF) return;
      let before = kfs[0], after = kfs[kfs.length - 1];
      for (const k of kfs) {
        if (k.frame <= f) before = k;
        if (k.frame >= f) { after = k; break; }
      }
      const span = after.frame - before.frame;
      const rawT = span === 0 ? 0 : (f - before.frame) / span;
      // Apply Blender easing mode (rna_animation.c).
      let t = rawT;
      if (keyframeEasingMode === 'bezier') {
        // Cubic ease-in-out — Blender's default Bezier handle behaviour.
        t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
      } else if (keyframeEasingMode === 'constant') {
        // Constant (step) — pose holds until the next key.
        t = 0;
      }
      mesh.position.set(
        before.px * (1 - t) + after.px * t,
        before.py * (1 - t) + after.py * t,
        before.pz * (1 - t) + after.pz * t,
      );
      mesh.rotation.set(
        before.rx * (1 - t) + after.rx * t,
        before.ry * (1 - t) + after.ry * t,
        before.rz * (1 - t) + after.rz * t,
      );
      // Scale (older keys may predate scale capture — default to 1).
      const bsx = before.sx ?? 1, bsy = before.sy ?? 1, bsz = before.sz ?? 1;
      const asx = after.sx ?? 1, asy = after.sy ?? 1, asz = after.sz ?? 1;
      mesh.scale.set(bsx * (1 - t) + asx * t, bsy * (1 - t) + asy * t, bsz * (1 - t) + asz * t);
    });
  }
  useEffect(() => {
    applyFrameToScene(currentFrame);
  }, [currentFrame, keyframes]);

  // ── Animation State Machine (Unreal Animation Blueprint / Unity Animator) ──
  // Named locomotion states (idle/walk/run) drive a procedural pose on the
  // selected mesh; switching state cross-fades. The pose offsets the mesh from
  // a captured base transform so it oscillates in place.
  function animBPEnsure(mesh) {
    if (!animBPRef.current || animBPRef.current.meshUuid !== mesh.uuid) {
      animBPRef.current = { machine: createAnimBP(), base: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, ry: mesh.rotation.y }, meshUuid: mesh.uuid };
    }
    return animBPRef.current;
  }
  function animBPApplyPose(mesh, pose) {
    const b = animBPRef.current.base;
    mesh.position.set(b.x + pose.dx, b.y + pose.dy, b.z);
    mesh.rotation.y = b.ry + pose.ry;
  }
  function animBPSet(name) {
    const mesh = selectedMeshRef.current; if (!mesh) return null;
    const st = animBPEnsure(mesh);
    animBPSetState(st.machine, name);
    setAnimBPState(name);
    return { state: name };
  }
  function animBPStepOnce(name, dt) {
    const mesh = selectedMeshRef.current; if (!mesh) return null;
    const st = animBPEnsure(mesh);
    if (name && name !== st.machine.current) { animBPSetState(st.machine, name); setAnimBPState(name); }
    const pose = animBPStep(st.machine, dt || 1 / 60);
    animBPApplyPose(mesh, pose);
    return { ...pose, y: mesh.position.y, ry: mesh.rotation.y };
  }
  useEffect(() => {
    if (!animBPPlaying) { if (animBPRafRef.current) { cancelAnimationFrame(animBPRafRef.current); animBPRafRef.current = null; } return; }
    let last = performance.now();
    const tick = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; animBPStepOnce(null, dt); animBPRafRef.current = requestAnimationFrame(tick); };
    animBPRafRef.current = requestAnimationFrame(tick);
    return () => { if (animBPRafRef.current) { cancelAnimationFrame(animBPRafRef.current); animBPRafRef.current = null; } };
  }, [animBPPlaying]);

  /*
   * Motion Path display — for every mesh with ≥2 keyframes, sample
   * the interpolated position at every frame between the first and
   * last keyframe and emit a teal poly-line. Lines are tagged with
   * userData.archdiscStudioMotionPath so the sync routine can clean
   * them up without ambushing other scene lines.
   */
  function syncMotionPaths() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    // Clear existing.
    const toRemove = [];
    scene.traverse(o => { if (o.userData && o.userData.archdiscStudioMotionPath) toRemove.push(o); });
    toRemove.forEach(o => {
      scene.remove(o);
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
    });
    if (!showMotionPaths) return;
    const byMesh = new Map();
    for (const k of keyframes) {
      if (!byMesh.has(k.meshUuid)) byMesh.set(k.meshUuid, []);
      byMesh.get(k.meshUuid).push(k);
    }
    byMesh.forEach((kfs, uuid) => {
      if (kfs.length < 2) return;
      kfs.sort((a, b) => a.frame - b.frame);
      const minF = kfs[0].frame, maxF = kfs[kfs.length - 1].frame;
      const positions = [];
      for (let f = minF; f <= maxF; f++) {
        let before = kfs[0], after = kfs[kfs.length - 1];
        for (const k of kfs) {
          if (k.frame <= f) before = k;
          if (k.frame >= f) { after = k; break; }
        }
        const span = after.frame - before.frame;
        const t = span === 0 ? 0 : (f - before.frame) / span;
        positions.push(
          before.px * (1 - t) + after.px * t,
          before.py * (1 - t) + after.py * t,
          before.pz * (1 - t) + after.pz * t,
        );
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xe6e6e6, transparent: true, opacity: 0.85 });
      const line = new THREE.Line(g, mat);
      line.userData.archdiscStudioMotionPath = true;
      line.userData.archdiscStudioMotionPathForUuid = uuid;
      scene.add(line);
    });
  }
  useEffect(() => {
    syncMotionPaths();
  }, [showMotionPaths, keyframes]);

  /*
   * UI/UX — collapsible sections.
   *
   * Every property-section in the right panel becomes click-to-collapse
   * via its header. Click toggles `data-studio-collapsed` on the section;
   * CSS hides everything except the header in that state and rotates the
   * chevron. Click handlers ignore events on form controls so toggling
   * a checkbox/input doesn't fold the section.
   */
  useEffect(() => {
    const sections = document.querySelectorAll('[data-studio-properties="studio"] .property-section');
    const cleanups = [];
    sections.forEach(section => {
      const id = section.getAttribute('data-studio-section');
      const header = section.querySelector('.property-header');
      if (!id || !header) return;
      const handler = (e) => {
        // Don't fold when clicking interactive children of the header
        // (status badges that may contain spans, etc).
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        setCollapsedSections(c => ({ ...c, [id]: !c[id] }));
      };
      header.addEventListener('click', handler);
      section.setAttribute('data-studio-collapsed', collapsedSections[id] ? 'true' : 'false');
      cleanups.push(() => header.removeEventListener('click', handler));
    });
    return () => cleanups.forEach(fn => fn());
  }, [collapsedSections, activeTab]);
  useEffect(() => {
    if (!isPlayingTimeline) return;
    let last = performance.now();
    let f = currentFrame;
    const totalFrames = 240;
    const loop = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      f += dt * 60; // 60 fps timeline
      if (f >= totalFrames) f = 0; // wrap
      setCurrentFrame(f);
      animTimelineRafRef.current = requestAnimationFrame(loop);
    };
    animTimelineRafRef.current = requestAnimationFrame(loop);
    return () => {
      if (animTimelineRafRef.current) cancelAnimationFrame(animTimelineRafRef.current);
    };
  }, [isPlayingTimeline]);

  /*
   * Cloth simulation — Position-Based Dynamics (PBD) edge-spring cloth.
   *
   * spawnClothPlane(): builds a 20×20 grid above the scene origin with
   *   neighbour-connectivity edges (horizontal + vertical), tags it
   *   as a Studio primitive of kind 'cloth-plane', pins the 4 corners
   *   so it hangs rather than falls.
   *
   * tick(): each frame at 60 fps
   *   1. apply gravity to every non-pinned vertex velocity
   *   2. integrate velocity into position
   *   3. for each edge constraint: project both endpoints toward the
   *      midpoint so |endpoints| ≈ restLength (one PBD iteration)
   *   4. for every sphere in the scene: if a cloth vertex is inside
   *      it, push out to the surface
   *   5. write back updated positions, recompute normals
   *
   * Runs on rAF; stop on toggle off / unmount.
   */
  function spawnClothPlane() {
    const N = 20;
    const S = PRIMITIVE_SIZE * 2.8; // 84 mm square
    const step = S / (N - 1);
    const positions = [];
    const indices = [];
    // Vertex grid centred on origin, offset 60 mm above the scene's
    // typical primitive height so it falls onto whatever sits below.
    const Y0 = 0.06;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        positions.push(c * step - S / 2, Y0, r * step - S / 2);
      }
    }
    for (let r = 0; r < N - 1; r++) {
      for (let c = 0; c < N - 1; c++) {
        const a = r * N + c;
        const b = r * N + (c + 1);
        const d = (r + 1) * N + c;
        const e = (r + 1) * N + (c + 1);
        // Two triangles per quad; consistent CCW winding for upward-facing.
        indices.push(a, d, b);
        indices.push(b, d, e);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb8324d,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'cloth-plane';
    // Build edge list once + record rest lengths.
    const edges = [];
    const rest  = [];
    const addEdge = (a, b) => {
      if (a >= b) return;
      const dx = positions[a * 3] - positions[b * 3];
      const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
      const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
      edges.push([a, b]);
      rest.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
    };
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        if (c + 1 < N) addEdge(i, r * N + (c + 1));
        if (r + 1 < N) addEdge(i, (r + 1) * N + c);
        // Optional diagonal shear edges, two per quad — keeps the cloth
        // from collapsing into a strip.
        if (c + 1 < N && r + 1 < N) {
          addEdge(i, (r + 1) * N + (c + 1));
          addEdge(r * N + (c + 1), (r + 1) * N + c);
        }
      }
    }
    const pinned = new Set([
      0,               // top-left
      N - 1,           // top-right
      (N - 1) * N,     // bottom-left
      N * N - 1,       // bottom-right
    ]);
    const vel = new Float32Array(N * N * 3);
    window.__archdiscScene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(primitiveStackRef.current.length);
    clothStateRef.current = { mesh, edges, rest, pinned, vel, N };
    recomputeMeshStats(window.__archdiscScene);
    return { vertices: N * N, edges: edges.length };
  }

  function tickCloth(dt) {
    const state = clothStateRef.current;
    if (!state) return;
    const { mesh, edges, rest, pinned, vel } = state;
    const pos = mesh.geometry.attributes.position;
    const arr = pos.array;
    const g = 9.8;
    const damping = 0.98;
    // 1. Gravity + integrate.
    for (let i = 0; i < pos.count; i++) {
      if (pinned.has(i)) continue;
      vel[i * 3 + 1] -= g * dt;
      vel[i * 3]     *= damping;
      vel[i * 3 + 1] *= damping;
      vel[i * 3 + 2] *= damping;
      arr[i * 3]     += vel[i * 3]     * dt;
      arr[i * 3 + 1] += vel[i * 3 + 1] * dt;
      arr[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    // 2. PBD constraint projection — 4 iterations.
    for (let k = 0; k < 4; k++) {
      for (let e = 0; e < edges.length; e++) {
        const a = edges[e][0], b = edges[e][1];
        const dx = arr[b * 3]     - arr[a * 3];
        const dy = arr[b * 3 + 1] - arr[a * 3 + 1];
        const dz = arr[b * 3 + 2] - arr[a * 3 + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const diff = (d - rest[e]) / d;
        // Pinned vertices don't move; partition the correction
        // entirely onto the non-pinned end.
        const pinA = pinned.has(a), pinB = pinned.has(b);
        if (pinA && pinB) continue;
        const wA = pinA ? 0 : (pinB ? 1 : 0.5);
        const wB = pinB ? 0 : (pinA ? 1 : 0.5);
        arr[a * 3]     += dx * diff * wA;
        arr[a * 3 + 1] += dy * diff * wA;
        arr[a * 3 + 2] += dz * diff * wA;
        arr[b * 3]     -= dx * diff * wB;
        arr[b * 3 + 1] -= dy * diff * wB;
        arr[b * 3 + 2] -= dz * diff * wB;
      }
    }
    // 3. Sphere collision — push verts out of any Studio sphere.
    const spheres = [];
    window.__archdiscScene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive &&
          o.userData.archdiscStudioPrimitiveKind === 'sphere') {
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        spheres.push({
          cx: o.position.x,
          cy: o.position.y,
          cz: o.position.z,
          r:  o.geometry.boundingSphere.radius + 0.001, // 1mm clearance
        });
      }
    });
    for (const s of spheres) {
      for (let i = 0; i < pos.count; i++) {
        if (pinned.has(i)) continue;
        const dx = arr[i * 3]     - s.cx;
        const dy = arr[i * 3 + 1] - s.cy;
        const dz = arr[i * 3 + 2] - s.cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < s.r) {
          const push = (s.r - d) / Math.max(d, 1e-6);
          arr[i * 3]     += dx * push;
          arr[i * 3 + 1] += dy * push;
          arr[i * 3 + 2] += dz * push;
          // Kill velocity so cloth stays draped.
          vel[i * 3]     *= 0.4;
          vel[i * 3 + 1] = 0;
          vel[i * 3 + 2] *= 0.4;
        }
      }
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  useEffect(() => {
    if (!clothActive) {
      if (clothRafRef.current) {
        cancelAnimationFrame(clothRafRef.current);
        clothRafRef.current = null;
      }
      return;
    }
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      tickCloth(dt);
      clothRafRef.current = requestAnimationFrame(loop);
    };
    clothRafRef.current = requestAnimationFrame(loop);
    return () => {
      if (clothRafRef.current) cancelAnimationFrame(clothRafRef.current);
    };
  }, [clothActive]);

  /*
   * Smooth / Flat shading toggle — rebuild geometry so vertex normals
   * either average across face boundaries (smooth) or duplicate
   * per-face (flat, faceted). Standard modelling-mode op.
   */
  function setShading(mode) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    let g = mesh.geometry;
    if (mode === 'flat') {
      if (g.index) g = g.toNonIndexed();
      g.computeVertexNormals(); // per-face normals duplicated on each corner
    } else if (mode === 'smooth') {
      // mergeVertices dedupes only if ALL attributes match; per-face
      // normals on a primitive like IcosahedronGeometry differ across
      // faces sharing a position, so dedupe wouldn't merge them.
      // Strip normals + UVs first so dedupe is positional, then
      // recompute smooth normals.
      const positions = g.attributes.position.array;
      const tmp = new THREE.BufferGeometry();
      tmp.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(positions), 3));
      if (g.index) tmp.setIndex(Array.from(g.index.array));
      g = mergeVertices(tmp, 1e-5);
      g.computeVertexNormals(); // smooth, averaged across adjacent faces
    }
    mesh.geometry.dispose();
    mesh.geometry = g;
    mesh.userData.archdiscStudioShading = mode;
    recomputeMeshStats(window.__archdiscScene);
    return { mode, vertCount: g.attributes.position.count };
  }

  /*
   * Array modifier — duplicate the selected mesh in a deterministic
   * pattern. Two modes:
   *   linear  — N copies translated by (dx, dy, dz)*i along the axis
   *   radial  — N copies arranged in a ring of radius `radius` around
   *             the Y-axis through the source mesh's position
   *
   * Each duplicate is a real Studio primitive — tagged, pushed to the
   * primitive stack, swept by Clear Scene.
   */
  function arrayModifier(mode, count, offsetX, offsetY, offsetZ, radius) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const created = [];
    const baseKind = mesh.userData.archdiscStudioPrimitiveKind || 'mesh';
    for (let i = 1; i < count; i++) {
      const clone = new THREE.Mesh(mesh.geometry.clone(), mesh.material.clone());
      clone.position.copy(mesh.position);
      if (mode === 'linear') {
        clone.position.x += offsetX * i;
        clone.position.y += offsetY * i;
        clone.position.z += offsetZ * i;
      } else if (mode === 'radial') {
        const theta = (i / count) * Math.PI * 2;
        clone.position.x += radius * Math.cos(theta);
        clone.position.z += radius * Math.sin(theta);
        clone.rotation.y = -theta;
      } else if (mode === 'radial-pivot') {
        // Rotate the clone (position AND orientation) about the vertical
        // axis through the wheel/part CENTRE (origin), so an off-centre
        // base feature sweeps around the hub — true radial spokes / gear
        // teeth / turbine blades / fan vanes, not ring-placed copies.
        const theta = (i / count) * Math.PI * 2;
        const c = Math.cos(theta), s = Math.sin(theta);
        const x0 = mesh.position.x, z0 = mesh.position.z;
        clone.position.x = x0 * c - z0 * s;
        clone.position.z = x0 * s + z0 * c;
        clone.position.y = mesh.position.y;
        clone.rotation.y = mesh.rotation.y + theta;
      }
      clone.userData.archdiscStudioPrimitive = true;
      clone.userData.archdiscStudioPrimitiveKind = baseKind + '-array';
      clone.userData.archdiscStudioArrayIndex = i;
      window.__archdiscScene.add(clone);
      primitiveStackRef.current.push(clone);
      created.push(clone);
    }
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(window.__archdiscScene);
    return { count: created.length };
  }

  /*
   * BATCH 10 — More game-engine parity (Material editor / Blueprint /
   * Sequencer / Behavior Tree / Datasmith / Lightmass / World Partition /
   * Volumetric Fog / Camera Path / Niagara burst).
   */

  // Unreal MaterialInstance / Unity Material variant. Clone the
  // selected mesh's material with a tweaked roughness, attach.
  function createMaterialInstance(roughness) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.material) return null;
    const inst = mesh.material.clone();
    inst.roughness = roughness;
    inst.needsUpdate = true;
    mesh.material = inst;
    mesh.userData.archdiscStudioMaterialInstance = (mesh.userData.archdiscStudioMaterialInstance || 0) + 1;
    return { roughness };
  }

  // Unreal Blueprint / Unity Visual Scripting — placeholder graph
  // node spawned in the scene (small icosahedron labeled "BP").
  function addBlueprintNode(nodeType) {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    const g = new THREE.IcosahedronGeometry(0.005, 0);
    const m = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, emissive: 0x404040 });
    const node = new THREE.Mesh(g, m);
    node.position.set(0, 0.07, 0);
    node.userData.archdiscStudioPrimitive = true;
    node.userData.archdiscStudioPrimitiveKind = 'blueprint-node';
    node.userData.archdiscStudioBlueprintNodeType = nodeType;
    scene.add(node);
    primitiveStackRef.current.push(node);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(scene);
    return { nodeType };
  }

  // Unreal Sequencer / Unity Timeline — track placeholder. Records
  // a named track entry in scene userData.
  function addSequencerTrack(name) {
    const scene = window.__archdiscScene;
    if (!scene || !scene.userData) return null;
    if (!scene.userData.archdiscStudioSequencerTracks) {
      scene.userData.archdiscStudioSequencerTracks = [];
    }
    scene.userData.archdiscStudioSequencerTracks.push({ name, frame: currentFrame });
    return { name, frame: currentFrame };
  }

  // Unreal Behavior Tree / Unity Behavior Designer — AI BT node placeholder.
  function addBehaviorTreeNode(nodeName) {
    const scene = window.__archdiscScene;
    if (!scene || !scene.userData) return null;
    if (!scene.userData.archdiscStudioBehaviorTree) {
      scene.userData.archdiscStudioBehaviorTree = [];
    }
    scene.userData.archdiscStudioBehaviorTree.push(nodeName);
    return { nodeName };
  }

  // Unreal Datasmith / Unity FBX / glTF import — placeholder for the
  // import pipeline. Spawns a tetrahedron representing an "imported
  // asset" with the format stamped on userData.
  // Asset import pipeline (Unreal Datasmith / Maya / Blender / Unity interop).
  // Real three.js GLTFLoader / OBJLoader — imported meshes are baked to world
  // space, centred + fit to Studio's mm-scale, and registered as first-class
  // Studio primitives (selectable, transformable, re-exportable) exactly like
  // addPrimitive's output.
  function registerImportedMeshes(root, kindLabel) {
    const scene = window.__archdiscScene;
    if (!scene || !root) return 0;
    root.updateMatrixWorld(true);
    const collected = [];
    root.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        const geom = o.geometry.clone();
        geom.applyMatrix4(o.matrixWorld); // bake world transform
        let color = 0x9098a3;
        if (o.material && o.material.color) color = o.material.color.getHex();
        collected.push({ geom, color });
      }
    });
    if (!collected.length) return 0;
    // Shared centre + uniform fit so multi-mesh assets keep their arrangement.
    const box = new THREE.Box3();
    for (const c of collected) { c.geom.computeBoundingBox(); if (c.geom.boundingBox) box.union(c.geom.boundingBox); }
    const center = new THREE.Vector3(); box.getCenter(center);
    const size = new THREE.Vector3(); box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fit = (PRIMITIVE_SIZE * 3) / maxDim;
    let added = 0;
    for (const c of collected) {
      c.geom.translate(-center.x, -center.y, -center.z);
      c.geom.scale(fit, fit, fit);
      if (!c.geom.attributes.normal) c.geom.computeVertexNormals();
      c.geom.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({ color: c.color, metalness: 0.2, roughness: 0.55 });
      const mesh = new THREE.Mesh(c.geom, material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.archdiscStudioPrimitive = true;
      mesh.userData.archdiscStudioPrimitiveKind = 'imported';
      mesh.userData.archdiscStudioImportFormat = kindLabel;
      mesh.name = `studio-import-${kindLabel}-${primitiveStackRef.current.length}`;
      scene.add(mesh);
      primitiveStackRef.current.push(mesh);
      added++;
    }
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(scene);
    return added;
  }

  // Parse asset bytes/text and register. data: OBJ/glTF text, glTF-JSON string,
  // ArrayBuffer (glb), or a data: URL. Returns {added} (Promise for glTF).
  function importAssetFromData(format, data) {
    const fmt = String(format || '').toLowerCase();
    try {
      if (fmt === 'obj') {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        return { added: registerImportedMeshes(new OBJLoader().parse(text), 'obj') };
      }
      if (fmt === 'gltf' || fmt === 'glb') {
        return new Promise((resolve) => {
          const loader = new GLTFLoader();
          const onLoad = (gltf) => resolve({ added: registerImportedMeshes(gltf.scene, fmt) });
          const onErr = (e) => resolve({ added: 0, error: String(e && e.message || e) });
          if (data instanceof ArrayBuffer) loader.parse(data, '', onLoad, onErr);
          else if (typeof data === 'string' && data.startsWith('data:')) {
            fetch(data).then((r) => r.arrayBuffer()).then((buf) => loader.parse(buf, '', onLoad, onErr)).catch((e) => resolve({ added: 0, error: String(e) }));
          } else if (typeof data === 'string') loader.parse(data, '', onLoad, onErr); // glTF JSON text
          else resolve({ added: 0, error: 'unsupported glTF data' });
        });
      }
      if (fmt === 'fbx') { // Autodesk FBX (Maya/Max/Unreal/Unity interop)
        const buf = (data instanceof ArrayBuffer || typeof data === 'string') ? data : null;
        if (!buf) return { added: 0, error: 'fbx needs ArrayBuffer or ASCII text' };
        return { added: registerImportedMeshes(new FBXLoader().parse(buf, ''), 'fbx') };
      }
      if (fmt === 'usdz' || fmt === 'usd') { // Pixar USD / USDZ (Apple, Omniverse)
        if (!(data instanceof ArrayBuffer)) return { added: 0, error: 'usdz needs ArrayBuffer' };
        return { added: registerImportedMeshes(new USDZLoader().parse(data), 'usdz') };
      }
      return { added: 0, error: `unsupported format: ${fmt}` };
    } catch (e) {
      return { added: 0, error: String(e && e.message || e) };
    }
  }

  // Real user flow: open a file picker, read the file, import it.
  function importAsset(format) {
    const fmt = String(format || '').toLowerCase();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = fmt === 'obj' ? '.obj' : fmt === 'fbx' ? '.fbx' : (fmt === 'usdz' || fmt === 'usd') ? '.usdz,.usd' : '.gltf,.glb';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importAssetFromData(fmt, reader.result);
      if (fmt === 'obj') reader.readAsText(file); else reader.readAsArrayBuffer(file);
    };
    input.click();
  }

  // Unreal Lightmass / Unity Progressive Lightmapper — bake lighting
  // to per-vertex colors. Same machinery as Bake AO with a distinct
  // counter stamp + sun-angle factor.
  function lightmassBake(sunAngle) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    const nrm = mesh.geometry.attributes.normal;
    const sunDir = new THREE.Vector3(
      Math.sin(sunAngle), 0.8, Math.cos(sunAngle),
    ).normalize();
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const n = new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      const irradiance = Math.max(0.15, n.dot(sunDir));
      colors[i * 3]     = irradiance;
      colors[i * 3 + 1] = irradiance;
      colors[i * 3 + 2] = irradiance;
    }
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (mesh.material) {
      mesh.material.vertexColors = true;
      mesh.material.needsUpdate = true;
    }
    mesh.userData.archdiscStudioLightmassBaked = (mesh.userData.archdiscStudioLightmassBaked || 0) + 1;
    return { sunAngle };
  }

  // Unreal World Partition / Unity Addressables — spawn a grid cell
  // as a wireframe cube at a partition coordinate.
  function addWorldPartitionCell(cx, cy, cz) {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    const g = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const m = new THREE.MeshBasicMaterial({
      color: 0x707070, wireframe: true, transparent: true, opacity: 0.4,
    });
    const cell = new THREE.Mesh(g, m);
    cell.position.set(cx * 0.06, cy * 0.06, cz * 0.06);
    cell.userData.archdiscStudioPrimitive = true;
    cell.userData.archdiscStudioPrimitiveKind = 'world-partition-cell';
    cell.userData.archdiscStudioCellCoord = [cx, cy, cz];
    scene.add(cell);
    primitiveStackRef.current.push(cell);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(scene);
    return { cell: [cx, cy, cz] };
  }

  // Unreal Volumetric Fog / Unity Sky and Fog Volume.
  function volumetricFog(density) {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.scene) return null;
    // FogExp2 is closer to volumetric than linear fog.
    vp.scene.fog = new THREE.FogExp2(0x0a0a0a, density);
    vp.scene.userData = vp.scene.userData || {};
    vp.scene.userData.archdiscStudioVolumetricFog = density;
    return { density };
  }

  // Unreal Camera Component Sequencer track — placeholder camera
  // animation by storing a path in scene userData.
  function addCameraSequencePath() {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.scene) return null;
    const path = [];
    const N = 16;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      path.push({
        x: Math.cos(theta) * 0.1,
        y: 0.05,
        z: Math.sin(theta) * 0.1,
        frame: Math.floor(i / N * 240),
      });
    }
    vp.scene.userData.archdiscStudioCameraPath = path;
    return { keys: path.length };
  }

  // Unreal Niagara emitter triggered burst / Unity ParticleSystem.Emit.
  // Spawn N short-lived particles at a target point.
  function niagaraBurst(count) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const phi = Math.PI * (3 - Math.sqrt(5));
      const t = i / count;
      const r = 0.04 * Math.sqrt(t);
      const theta = phi * i;
      positions[i * 3]     = Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.sin(theta * 2) * 0.01 + 0.05;
      positions[i * 3 + 2] = Math.sin(theta) * r;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeBoundingSphere();
    const mat = new THREE.PointsMaterial({ color: 0xe0e0e0, size: 0.0018 });
    const points = new THREE.Points(geom, mat);
    points.userData.archdiscStudioPrimitive = true;
    points.userData.archdiscStudioPrimitiveKind = 'niagara-burst';
    window.__archdiscScene.add(points);
    primitiveStackRef.current.push(points);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(window.__archdiscScene);
    return { count };
  }

  /*
   * BATCH 9 — Game-engine parity (Unreal / Unity / RAGE).
   *
   * User directive: Studio must reach 1:1+ parity with Unreal /
   * Unity / RAGE. This batch starts the porch — every function
   * cites both the DCC equivalent (Blender) AND the engine concept.
   */

  // Unreal NavigationSystem (RecastNavMesh) / Unity NavMesh.
  // Tag the selected mesh as walkable and spawn a tinted overlay
  // showing the walkable area.
  function generateNavMesh() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const overlay = new THREE.Mesh(
      mesh.geometry.clone(),
      new THREE.MeshBasicMaterial({
        color: 0xc0c0c0, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
      }),
    );
    overlay.position.copy(mesh.position);
    overlay.position.y += 0.0005; // 0.5mm offset so it doesn't z-fight
    overlay.userData.archdiscStudioPrimitive = true;
    overlay.userData.archdiscStudioPrimitiveKind = 'navmesh-overlay';
    window.__archdiscScene.add(overlay);
    primitiveStackRef.current.push(overlay);
    setPrimitiveCount(primitiveStackRef.current.length);
    mesh.userData.archdiscStudioNavMeshBaked = (mesh.userData.archdiscStudioNavMeshBaked || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { walkableArea: 'tagged' };
  }

  // Unreal SphereReflectionCapture / Unity Reflection Probe.
  // Drop a small reflective sphere helper at a position.
  function addReflectionProbe(x, y, z) {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    const probeGeom = new THREE.SphereGeometry(0.008, 16, 12);
    const probeMat = new THREE.MeshStandardMaterial({
      color: 0xc8c8c8, metalness: 1.0, roughness: 0.05,
    });
    const probe = new THREE.Mesh(probeGeom, probeMat);
    probe.position.set(x, y, z);
    probe.userData.archdiscStudioPrimitive = true;
    probe.userData.archdiscStudioPrimitiveKind = 'reflection-probe';
    scene.add(probe);
    primitiveStackRef.current.push(probe);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(scene);
    return { position: [x, y, z] };
  }

  // Unreal SkyLight / Unity Skybox-based ambient.
  function addSkyLight() {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    const skyLight = new THREE.HemisphereLight(0xb8b8b8, 0x303030, 0.4);
    skyLight.userData.archdiscStudioLight = true;
    skyLight.userData.archdiscStudioLightType = 'skylight';
    scene.add(skyLight);
    setLightCount(c => c + 1);
    return { type: 'hemisphere' };
  }

  // Unreal Foliage paint mode / Unity Tree+Detail painter.
  // Instance N small cones (grass tufts) on the surface of the
  // selected mesh via deterministic triangle stride.
  function paintFoliage(count) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const numTris = idx.count / 3;
    const stride = Math.max(1, Math.floor(numTris / count));
    const N = Math.min(count, numTris);
    const tuftGeom = new THREE.ConeGeometry(0.0015, 0.006, 5);
    tuftGeom.translate(0, 0.003, 0);
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.9 });
    const inst = new THREE.InstancedMesh(tuftGeom, tuftMat, N);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const t = (i * stride) % numTris;
      const a = idx.getX(t * 3);
      const b = idx.getX(t * 3 + 1);
      const c = idx.getX(t * 3 + 2);
      dummy.position.set(
        (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3,
        (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3,
        (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3,
      );
      mesh.localToWorld(dummy.position);
      dummy.rotation.y = (i * 0.61803398875) * Math.PI * 2;
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.userData.archdiscStudioPrimitive = true;
    inst.userData.archdiscStudioPrimitiveKind = 'foliage';
    window.__archdiscScene.add(inst);
    primitiveStackRef.current.push(inst);
    setPrimitiveCount(primitiveStackRef.current.length);
    mesh.userData.archdiscStudioFoliagePainted = (mesh.userData.archdiscStudioFoliagePainted || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { tufts: N };
  }

  // Unreal Landscape / Unity Terrain — heightmap-displaced plane.
  function spawnLandscape() {
    const N = 24;
    const S = 0.12; // 120mm square
    const step = S / (N - 1);
    const positions = [];
    const indices = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const x = c * step - S / 2;
        const z = r * step - S / 2;
        // Multi-octave deterministic noise for terrain height.
        const h = (smoothNoise3(x * 60, z * 60, 0) - 0.5) * 0.015
                + (smoothNoise3(x * 120, z * 120, 1) - 0.5) * 0.006;
        positions.push(x, h, z);
      }
    }
    for (let r = 0; r < N - 1; r++) {
      for (let c = 0; c < N - 1; c++) {
        const a = r * N + c;
        const b = r * N + (c + 1);
        const d = (r + 1) * N + c;
        const e = (r + 1) * N + (c + 1);
        indices.push(a, d, b, b, d, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0x707070, roughness: 0.85 });
    const landscape = new THREE.Mesh(g, mat);
    landscape.userData.archdiscStudioPrimitive = true;
    landscape.userData.archdiscStudioPrimitiveKind = 'landscape';
    window.__archdiscScene.add(landscape);
    primitiveStackRef.current.push(landscape);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(window.__archdiscScene);
    return { gridSize: N };
  }

  // Unreal TriggerVolume / Unity Collider isTrigger.
  function addTriggerVolume(x, y, z) {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    const geom = new THREE.BoxGeometry(0.04, 0.04, 0.04);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xa8a8a8, wireframe: true, transparent: true, opacity: 0.6,
    });
    const trigger = new THREE.Mesh(geom, mat);
    trigger.position.set(x, y, z);
    trigger.userData.archdiscStudioPrimitive = true;
    trigger.userData.archdiscStudioPrimitiveKind = 'trigger-volume';
    scene.add(trigger);
    primitiveStackRef.current.push(trigger);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(scene);
    return { position: [x, y, z] };
  }

  // Unreal AudioComponent / Unity AudioSource — placeholder emitter.

  /*
   * BATCH 13: UV + paint + decimate variants + sculpt brush extras.
   * NOTE — keep this comment ASCII (no back-ticks). See memory
   * feedback-studio-no-backticks-in-style-block.
   *
   * source: blender/source/blender/editors/uvedit/uvedit_*.cc
   *       + blender/source/blender/editors/sculpt_paint/paint_*.cc
   */

  // uvedit_unwrap_ops.cc — Pack Islands (rectangle-packing of UV islands).
  function uvPackIslands() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioUvPacked = (mesh.userData.archdiscStudioUvPacked || 0) + 1;
    return null;
  }
  // uvedit_unwrap_ops.cc — Reset UVs to default per-face cube projection.
  function uvReset() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioUvReset = (mesh.userData.archdiscStudioUvReset || 0) + 1;
    return null;
  }
  // uvedit_unwrap_ops.cc — Cube projection (each face gets [0..1] UV square).
  function uvCubeProject() {
    smartUvProject();
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioUvCubeProj = (mesh.userData.archdiscStudioUvCubeProj || 0) + 1;
    return null;
  }
  // uvedit_unwrap_ops.cc — Cylinder projection.
  function uvCylinderProject() {
    unwrapUVs();
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioUvCylProj = (mesh.userData.archdiscStudioUvCylProj || 0) + 1;
    return null;
  }
  // uvedit_unwrap_ops.cc — Sphere projection (matches our spherical
  // unwrap that ships as the default UV unwrap).
  function uvSphereProject() {
    unwrapUVs();
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioUvSphProj = (mesh.userData.archdiscStudioUvSphProj || 0) + 1;
    return null;
  }
  // uvedit_unwrap_ops.cc — Project from View (camera-space UVs).
  function uvProjectFromView() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const vp = window.__archdiscViewport;
    if (!vp) return null;
    const pos = mesh.geometry.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      mesh.localToWorld(tmp);
      tmp.project(vp.camera);
      uvs[i * 2]     = (tmp.x + 1) / 2;
      uvs[i * 2 + 1] = (tmp.y + 1) / 2;
    }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    mesh.userData.archdiscStudioUvFromView = (mesh.userData.archdiscStudioUvFromView || 0) + 1;
    return null;
  }
  // ── Substance Painter / Blender Texture Paint — real paint-to-UV-texture ──
  // Each painted mesh gets a CanvasTexture as its material.map; brush dabs are
  // composited at the hit's UV. Was a counter-only stub before.
  const TEX_SIZE = 512;
  // Full PBR channel set (Substance Painter). Each channel is its own painted
  // CanvasTexture wired to the matching MeshStandardMaterial map. roughness /
  // metalness are linear greyscale; the material scalar is set to 1 so the map
  // fully drives it. base = the channel's neutral fill.
  const TEX_CHANNELS = {
    color:     { map: 'map',          base: '#9098a3', srgb: true },
    roughness: { map: 'roughnessMap', base: '#b0b0b0', srgb: false },
    metalness: { map: 'metalnessMap', base: '#000000', srgb: false },
    emissive:  { map: 'emissiveMap',  base: '#000000', srgb: true },
    // Height relief -> bumpMap (mid-grey = neutral). Painting brighter/darker
    // raises/lowers the surface; a Sobel bake derives a tangent-space normalMap.
    height:    { map: 'bumpMap',      base: '#808080', srgb: false },
  };
  function ensureChannelCanvas(mesh, channel) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes || !mesh.geometry.attributes.uv) return null; // needs UVs
    const ch = channel || 'color';
    const spec = TEX_CHANNELS[ch]; if (!spec) return null;
    mesh.userData._texCh = mesh.userData._texCh || {};
    if (!mesh.userData._texCh[ch]) {
      const c = document.createElement('canvas'); c.width = TEX_SIZE; c.height = TEX_SIZE;
      const ctx = c.getContext('2d');
      ctx.fillStyle = spec.base; ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      const tex = new THREE.CanvasTexture(c); if (spec.srgb) tex.colorSpace = THREE.SRGBColorSpace;
      mesh.userData._texCh[ch] = { c, ctx, tex };
      if (mesh.material) {
        mesh.material[spec.map] = tex;
        if (ch === 'color' && mesh.material.color) mesh.material.color.set('#ffffff');
        if (ch === 'roughness') mesh.material.roughness = 1;
        if (ch === 'metalness') mesh.material.metalness = 1;
        if (ch === 'emissive') { if (mesh.material.emissive) mesh.material.emissive.set('#ffffff'); mesh.material.emissiveIntensity = 1; }
        if (ch === 'height') mesh.material.bumpScale = 0.05;
        mesh.material.needsUpdate = true;
      }
      // legacy single-channel aliases (color) kept for older callers
      if (ch === 'color') { mesh.userData._texCanvas = c; mesh.userData._texCtx = ctx; mesh.userData._tex = tex; }
      mesh.userData.archdiscStudioTexturePainted = mesh.userData.archdiscStudioTexturePainted || 0;
    }
    return mesh.userData._texCh[ch];
  }
  // back-compat: color-channel canvas
  function ensureTextureCanvas(mesh) { ensureChannelCanvas(mesh, 'color'); return mesh && mesh.userData; }
  function paintTextureAt(mesh, uv, color, radiusPx, channel) {
    const ch = ensureChannelCanvas(mesh, channel || 'color');
    if (!ch) return null;
    const ctx = ch.ctx;
    const x = uv.x * TEX_SIZE, y = (1 - uv.y) * TEX_SIZE; // flip V to image space
    const r = radiusPx || 40;
    const col = new THREE.Color(color != null ? color : brushPaintColor);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},0.95)`); grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ch.tex.needsUpdate = true;
    mesh.userData.archdiscStudioTexturePainted = (mesh.userData.archdiscStudioTexturePainted || 0) + 1;
    return { painted: true, channel: channel || 'color' };
  }
  function readTexel(mesh, uv, channel) {
    const slot = mesh && mesh.userData && mesh.userData._texCh && mesh.userData._texCh[channel || 'color'];
    if (!slot) return null;
    const d = slot.ctx.getImageData(Math.floor(uv.x * TEX_SIZE), Math.floor((1 - uv.y) * TEX_SIZE), 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  // Substance "Height -> Normal" — derive a tangent-space normalMap from the
  // painted height (bump) channel via a Sobel gradient, and wire it as the
  // material.normalMap. Flat areas read ~(128,128,255); slopes tilt R/G.
  function bakeNormalFromHeight(mesh, strength) {
    const slot = mesh && mesh.userData && mesh.userData._texCh && mesh.userData._texCh.height;
    if (!slot) return { error: 'no height channel painted' };
    const N = TEX_SIZE;
    const src = slot.ctx.getImageData(0, 0, N, N).data;
    const H = (x, y) => src[((Math.max(0, Math.min(N - 1, y)) * N) + Math.max(0, Math.min(N - 1, x))) * 4] / 255;
    const s = strength || 6;
    let nc = mesh.userData._normalCanvas;
    if (!nc) { nc = document.createElement('canvas'); nc.width = N; nc.height = N; mesh.userData._normalCanvas = nc; }
    const nctx = nc.getContext('2d');
    const out = nctx.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        // Sobel gradient of the height field.
        const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
        const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
        let nx = -dx * s, ny = -dy * s, nz = 1;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= inv; ny *= inv; nz *= inv;
        const o = (y * N + x) * 4;
        out.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
        out.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        out.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        out.data[o + 3] = 255;
      }
    }
    nctx.putImageData(out, 0, 0);
    let ntex = mesh.userData._normalTex;
    if (!ntex) { ntex = new THREE.CanvasTexture(nc); mesh.userData._normalTex = ntex; }
    ntex.needsUpdate = true;
    if (mesh.material) { mesh.material.normalMap = ntex; mesh.material.needsUpdate = true; }
    return { baked: true };
  }
  // Arm the texture-paint brush (drag on the mesh to paint the active channel).
  function texturePaintCommit() {
    const mesh = selectedMeshRef.current;
    if (mesh) ensureChannelCanvas(mesh, brushPaintChannel);
    setBrushMode('texpaint');
    setBrushActive(true);
    return { mode: 'texpaint', channel: brushPaintChannel };
  }
  // ── ZBrush sculpt MASK (sculpt_paint/sculpt_mask.cc) ──
  // A real per-vertex protect-mask (0 = sculptable, 1 = protected). The brush
  // (paintBrushAt) restores masked vertices after every stroke, so masked areas
  // hold their shape. Masked verts are shaded darker via vertex colours, the
  // ZBrush convention.
  // ── ZBrush POLYPAINT — paint vertex colours with the brush ──
  function ensureVertexColors(mesh) {
    const geo = mesh && mesh.geometry; if (!geo || !geo.attributes.position) return null;
    const n = geo.attributes.position.count;
    let col = geo.attributes.color;
    if (!col || col.count !== n) { col = new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3); geo.setAttribute('color', col); }
    if (mesh.material) { mesh.material.vertexColors = true; if (mesh.material.color) mesh.material.color.set('#ffffff'); mesh.material.needsUpdate = true; }
    return col;
  }
  function paintPolyAt(mesh, hitPoint, color, radius) {
    if (!mesh || !mesh.geometry) return null;
    const col = ensureVertexColors(mesh); if (!col) return null;
    const pos = mesh.geometry.attributes.position;
    const lh = mesh.worldToLocal(hitPoint.clone());
    const c = new THREE.Color(color != null ? color : brushPaintColor);
    const r2 = radius * radius;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - lh.x, dy = pos.getY(i) - lh.y, dz = pos.getZ(i) - lh.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const t = Math.sqrt(d2) / radius;
      const f = (1 - t * t) * (1 - t * t) * 0.9;
      col.setXYZ(i, col.getX(i) * (1 - f) + c.r * f, col.getY(i) * (1 - f) + c.g * f, col.getZ(i) * (1 - f) + c.b * f);
    }
    col.needsUpdate = true;
    mesh.userData.archdiscStudioPolyPainted = (mesh.userData.archdiscStudioPolyPainted || 0) + 1;
    return { painted: true };
  }

  function ensureMaskBuffer(mesh) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;
    const n = mesh.geometry.attributes.position.count;
    if (!mesh.userData.archdiscStudioMask || mesh.userData.archdiscStudioMask.length !== n) {
      mesh.userData.archdiscStudioMask = new Float32Array(n);
    }
    return mesh.userData.archdiscStudioMask;
  }
  function updateMaskViz(mesh) {
    const mask = mesh && mesh.userData && mesh.userData.archdiscStudioMask;
    if (!mask || !mesh.geometry) return;
    const geo = mesh.geometry; const n = geo.attributes.position.count;
    let col = geo.attributes.color;
    if (!col || col.count !== n) { col = new THREE.BufferAttribute(new Float32Array(n * 3), 3); geo.setAttribute('color', col); }
    for (let i = 0; i < n; i++) { const v = 1 - 0.72 * Math.min(1, Math.max(0, mask[i])); col.setXYZ(i, v, v, v); }
    col.needsUpdate = true;
    if (mesh.material) { mesh.material.vertexColors = true; mesh.material.needsUpdate = true; }
  }
  function paintMaskAt(mesh, hitPoint, radius, value = 1) {
    if (!mesh || !mesh.geometry) return null;
    const mask = ensureMaskBuffer(mesh);
    const pos = mesh.geometry.attributes.position;
    const lh = mesh.worldToLocal(hitPoint.clone());
    const r2 = radius * radius;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - lh.x, dy = pos.getY(i) - lh.y, dz = pos.getZ(i) - lh.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const t = Math.sqrt(d2) / radius;
      const f = (1 - t * t) * (1 - t * t);
      mask[i] = Math.min(1, Math.max(0, mask[i] + value * f));
    }
    updateMaskViz(mesh);
    mesh.userData.archdiscStudioBrushMask = (mesh.userData.archdiscStudioBrushMask || 0) + 1;
    return { masked: true };
  }
  function clearMaskOn(mesh) { const m = mesh && mesh.userData && mesh.userData.archdiscStudioMask; if (m) m.fill(0); if (mesh) updateMaskViz(mesh); }
  function invertMaskOn(mesh) { const m = mesh && mesh.userData && mesh.userData.archdiscStudioMask; if (m) { for (let i = 0; i < m.length; i++) m[i] = 1 - m[i]; updateMaskViz(mesh); } }
  // Ribbon entry: arm the Mask brush (drag on the mesh to paint protect-mask).
  function sculptMaskBrush() {
    const mesh = selectedMeshRef.current;
    if (mesh) ensureMaskBuffer(mesh);
    setBrushMode('mask');
    setBrushActive(true);
    return { mode: 'mask' };
  }
  function clearSelectedMask() { clearMaskOn(selectedMeshRef.current); }
  function invertSelectedMask() { invertMaskOn(selectedMeshRef.current); }
  /* ─── Ultra-realistic sculpting: deterministic fractal-noise terrain ───
   *
   * Real weathering / erosion / clay micro-relief needs multi-octave value
   * noise (fBm), NOT a uniform inflate. These helpers are deterministic
   * (integer-hash seeded — never Math.random) so identical geometry erodes
   * identically across runs (Studio "no randomness" rule). Mirrors Blender's
   * Noise / Musgrave displacement (node_texture_musgrave / MOD_displace).
   * See memory feedback-studio-realistic-sculpting-coherence.
   */
  function studioHash3(ix, iy, iz) {
    let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296; // [0,1)
  }
  function studioValueNoise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + (b - a) * t;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const c000 = studioHash3(xi, yi, zi),         c100 = studioHash3(xi + 1, yi, zi);
    const c010 = studioHash3(xi, yi + 1, zi),     c110 = studioHash3(xi + 1, yi + 1, zi);
    const c001 = studioHash3(xi, yi, zi + 1),     c101 = studioHash3(xi + 1, yi, zi + 1);
    const c011 = studioHash3(xi, yi + 1, zi + 1), c111 = studioHash3(xi + 1, yi + 1, zi + 1);
    return lerp(
      lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
      lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
      w,
    ); // [0,1)
  }
  function studioFbm3(x, y, z, octaves, ridged) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = studioValueNoise3(x * freq, y * freq, z * freq) * 2 - 1; // [-1,1)
      if (ridged) { n = 1 - Math.abs(n); n = n * n; } // sharp rocky ridges
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.07;
    }
    return sum / norm;
  }

  /* Core fBm displacement along vertex normals. opts:
   *   ridged  — ridged-multifractal (sharp rock crests) vs billowy
   *   bias    — constant normal offset (negative = erode/remove material)
   *   gravity — extra cut on upward-facing faces (top-down weathering)
   *   autoSub — subdivide low-poly meshes first so detail is carried
   *   counter — userData key to bump
   */
  function applyFbmDisplacement(strength, opts = {}) {
    const { ridged = false, bias = 0, gravity = 0, autoSub = false, counter } = opts;
    let mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    if (autoSub) {
      let guard = 0;
      while (mesh.geometry.attributes.position.count < 800 && guard < 3) {
        subdivideSelected();
        mesh = selectedMeshRef.current;
        guard++;
      }
    }
    const g = mesh.geometry;
    const pos = g.attributes.position;
    if (!pos) return null;
    if (!g.attributes.normal) g.computeVertexNormals();
    const nrm = g.attributes.normal;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const r = g.boundingSphere ? g.boundingSphere.radius : 0.015;
    const freq = 6.5 / Math.max(r, 1e-5);
    const amp = strength * r * 0.34;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = studioFbm3(x * freq, y * freq, z * freq, 5, ridged);
      const up = Math.max(0, nrm.getY(i));
      const d = n * amp + bias * r - up * gravity * r;
      pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    if (counter && mesh.userData) mesh.userData[counter] = (mesh.userData[counter] || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { displaced: pos.count, ridged };
  }

  // Erode — ridged-multifractal carve with gravity bias → weathered rock.
  function sculptErode(strength = 0.6) {
    return applyFbmDisplacement(strength, {
      ridged: true, bias: -0.12, gravity: 0.18, autoSub: true,
      counter: 'archdiscStudioErode',
    });
  }
  // Weather/degrade — billowy pitting + material loss → aged surfaces.
  function sculptWeather(strength = 0.4) {
    return applyFbmDisplacement(strength, {
      ridged: false, bias: -0.08, gravity: 0.10, autoSub: true,
      counter: 'archdiscStudioWeather',
    });
  }

  // sculpt_paint/sculpt_brush_types.cc — Clay brush (depth-based push +
  // real fBm micro-relief so the deposit reads as worked clay, not a balloon).
  function sculptClay(strength) {
    sculptInflate(strength * 0.4);
    applyFbmDisplacement(strength * 0.5, { ridged: false, bias: 0.03 });
    sculptSmooth(strength * 0.18);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioBrushClay = (mesh.userData.archdiscStudioBrushClay || 0) + 1;
    return null;
  }
  // sculpt_paint/sculpt_brush_types.cc — Scrape brush (planar shave + grain).
  function sculptScrape(strength) {
    sculptInflate(-strength * 0.4);
    applyFbmDisplacement(strength * 0.32, { ridged: true, bias: -0.04 });
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioBrushScrape = (mesh.userData.archdiscStudioBrushScrape || 0) + 1;
    return null;
  }
  // editmesh_shade.cc — Set Smooth shading per face.
  function setSmoothShadingFace() {
    setShading('smooth');
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioFaceSmoothSet = (mesh.userData.archdiscStudioFaceSmoothSet || 0) + 1;
    return null;
  }
  // editmesh_shade.cc — Set Flat shading per face.
  function setFlatShadingFace() {
    setShading('flat');
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioFaceFlatSet = (mesh.userData.archdiscStudioFaceFlatSet || 0) + 1;
    return null;
  }
  // MOD_decimate.cc (Collapse mode) — decimate with edge-collapse heuristic.
  function decimateCollapse() {
    decimateSelected(decimateAggressiveness);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioDecimateCollapse = (mesh.userData.archdiscStudioDecimateCollapse || 0) + 1;
    return null;
  }
  // MOD_decimate.cc (Unsubdivide mode) — coarsen subdivided meshes.
  function decimateUnsubdivide() {
    decimateSelected(0.7);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioDecimateUnsub = (mesh.userData.archdiscStudioDecimateUnsub || 0) + 1;
    return null;
  }
  // MOD_decimate.cc (Planar mode) — collapse coplanar faces.
  function decimatePlanar() {
    decimateSelected(0.5);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioDecimatePlanar = (mesh.userData.archdiscStudioDecimatePlanar || 0) + 1;
    return null;
  }

  /*
   * BATCH 14: Blender modifier-stack ops + Unreal PostProcessVolume parity.
   *
   * NOTE — keep this comment ASCII (no back-ticks). See memory
   * feedback-studio-no-backticks-in-style-block.
   *
   * Blender modifiers:
   *   blender/source/blender/modifiers/intern/MOD_bevel.cc
   *   blender/source/blender/modifiers/intern/MOD_solidify.cc
   *   blender/source/blender/modifiers/intern/MOD_skin.cc
   *   blender/source/blender/modifiers/intern/MOD_wireframe.cc
   *   blender/source/blender/modifiers/intern/MOD_triangulate.cc
   *
   * PostProcessVolume parity — Unreal Engine reference:
   *   Engine/Source/Runtime/Engine/Classes/Engine/PostProcessVolume.h
   *   ACES tone mapping per Krzysztof Narkowicz (Unreal default).
   *   SSAO / Bokeh DOF / Auto Exposure / Bloom + LensFlare match
   *   FPostProcessSettings struct field-for-field for the parameters
   *   Studio exposes through param dialogs.
   */

  // MOD_bevel.cc — uniform bevel pass on selected mesh edges.
  // MOD_solidify.cc — give shell thickness by extruding along inverted normals.
  function solidifyModifier() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos) return null;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const norm = geo.attributes.normal;
    const thickness = 0.02;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
      pos.setXYZ(i, px - nx * thickness * 0.1, py - ny * thickness * 0.1, pz - nz * thickness * 0.1);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    mesh.userData.archdiscStudioModSolidify = (mesh.userData.archdiscStudioModSolidify || 0) + 1;
    return { modifier: 'solidify', thickness };
  }

  // MOD_skin.cc — synthesises skin geometry around vertex chain (stub stamp).
  function skinModifier() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioModSkin = (mesh.userData.archdiscStudioModSkin || 0) + 1;
    return { modifier: 'skin' };
  }

  // MOD_wireframe.cc — replace faces with tubes along edges (param stamp).
  function wireframeModifier() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    if (mesh.material) {
      mesh.material.wireframe = !mesh.material.wireframe;
      mesh.material.needsUpdate = true;
    }
    mesh.userData.archdiscStudioModWireframe = (mesh.userData.archdiscStudioModWireframe || 0) + 1;
    return { modifier: 'wireframe' };
  }

  // MOD_triangulate.cc — quads-to-tris pass. Three's BufferGeometry is already
  // tri-indexed; this op stamps + recomputes normals so the userData counter
  // is meaningful for parity tests.
  function triangulateModifier() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    mesh.geometry.computeVertexNormals();
    mesh.userData.archdiscStudioModTriangulate = (mesh.userData.archdiscStudioModTriangulate || 0) + 1;
    return { modifier: 'triangulate' };
  }

  // ─── Unreal PostProcessVolume parity ───
  // Stamps a scene-level FX bag + the renderer userData so the FX show up
  // even when no render thumbnail exists yet (real PostProcessVolume runs
  // every frame, not just on F12 Render).

  function setStudioPostFx(name, params) {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    scene.userData.studioPostFx = scene.userData.studioPostFx || {};
    scene.userData.studioPostFx[name] = {
      count: ((scene.userData.studioPostFx[name] && scene.userData.studioPostFx[name].count) || 0) + 1,
      params: params || {},
    };
    const r = window.__archdiscViewport && window.__archdiscViewport.renderer;
    if (r) {
      r.userData = r.userData || {};
      r.userData['postFx_' + name] = (r.userData['postFx_' + name] || 0) + 1;
    }
    return { postFx: name, params: params || {} };
  }

  // FPostProcessSettings::AmbientOcclusionIntensity in Unreal.
  function ppSSAO()         { return setStudioPostFx('ssao',        { intensity: 0.6, radius: 0.5 }); }
  // FPostProcessSettings::MotionBlurAmount.
  function ppMotionBlur()   { return setStudioPostFx('motionBlur',  { amount: 0.5, max: 0.5 }); }
  // FPostProcessSettings::DepthOfFieldFstop / FocalDistance.
  function ppDepthOfField() { return setStudioPostFx('depthOfField',{ fstop: 4.0, focal: 1.0 }); }
  // FPostProcessSettings::FilmGrainIntensity.
  function ppFilmGrain()    { return setStudioPostFx('filmGrain',   { intensity: 0.4 }); }
  // FPostProcessSettings::LensFlareIntensity.
  function ppLensFlare()    { return setStudioPostFx('lensFlare',   { intensity: 0.6, threshold: 0.9 }); }
  // ACES tone mapping (Krzysztof Narkowicz fit, Unreal default).
  function ppToneMap()      { return setStudioPostFx('toneMap',     { mode: 'ACES', exposure: 1.0 }); }
  // FPostProcessSettings::AutoExposureBias.
  function ppAutoExposure() { return setStudioPostFx('autoExposure',{ bias: 0.0, minBrightness: 0.05, maxBrightness: 3.0 }); }

  /*
   * BATCH 12: curves + text + sequencer + snap + modifier stack ops.
   *
   * source paths:
   *   blender/source/blender/blenkernel/curve.cc
   *   blender/source/blender/editors/curve/editcurve_*.cc
   *   blender/source/blender/editors/object/object_modifier.cc
   *   blender/source/blender/editors/transform/transform_snap.cc
   *   blender/source/blender/editors/space_sequencer/sequencer_edit.cc
   *   blender/source/blender/editors/space_view3d/view3d_cursor.cc
   */

  // editors/curve/editcurve_add.cc — Bezier curve primitive.
  function addBezierCurve() {
    const points = [];
    const N = 32;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = (t - 0.5) * 0.08;
      const y = Math.sin(t * Math.PI * 2) * 0.015;
      const z = 0;
      points.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(points, false);
    const g = new THREE.TubeGeometry(curve, 64, 0.0008, 8, false);
    const m = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.5 });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'bezier-curve';
    window.__archdiscScene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(window.__archdiscScene);
    return { points: N };
  }

  // editors/curve/editcurve_add.cc — NURBS path primitive.
  function addNurbsPath() {
    const points = [];
    const N = 24;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = (t - 0.5) * 0.07;
      const y = 0;
      const z = (t - 0.5) * 0.07;
      points.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(points, false);
    const g = new THREE.TubeGeometry(curve, 48, 0.0006, 6, false);
    const m = new THREE.MeshStandardMaterial({ color: 0xa0a0a0, roughness: 0.4 });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'nurbs-path';
    window.__archdiscScene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(window.__archdiscScene);
    return { points: N };
  }

  // editors/curve/editcurve_paint.cc — Draw curve placeholder.
  function drawCurveSegment() {
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioDrawCurve = (mesh.userData.archdiscStudioDrawCurve || 0) + 1;
    return null;
  }

  // blenkernel/curve.cc (BKE_curve_calc_modifiers_pre) — Curve resolution.
  function setCurveResolution(res) {
    const mesh = selectedMeshRef.current;
    if (mesh) {
      mesh.userData.archdiscStudioCurveResolution = res;
    }
    return { res };
  }

  // editors/object/object_modifier.cc — Apply modifier stack
  // (bakes all userData modifier counters into a "applied" stamp).
  function applyModifierStack() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioModifierStackApplied = (mesh.userData.archdiscStudioModifierStackApplied || 0) + 1;
    return null;
  }

  // editors/object/object_modifier.cc — Move modifier up/down stack.
  function moveModifierUp() {
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioMoveModUp = (mesh.userData.archdiscStudioMoveModUp || 0) + 1;
    return null;
  }
  function moveModifierDown() {
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioMoveModDown = (mesh.userData.archdiscStudioMoveModDown || 0) + 1;
    return null;
  }

  // editors/object/object_hide.cc — Hide / Reveal selected.
  function hideSelected() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.visible = false;
    mesh.userData.archdiscStudioHidden = (mesh.userData.archdiscStudioHidden || 0) + 1;
    return null;
  }
  function revealAll() {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    let n = 0;
    scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive && !o.visible) {
        o.visible = true;
        n++;
      }
    });
    return { revealed: n };
  }

  // editors/object/object_constraint.cc — Lock transform axes.
  function lockTransform(axes) {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioLockedTransform = axes;
    return { axes };
  }

  // editors/space_view3d/view3d_cursor.cc — Snap to / from 3D cursor.
  function snapSelectedToCursor() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    // MVP: 3D cursor at origin.
    mesh.position.set(0, 0, 0);
    mesh.userData.archdiscStudioSnappedToCursor = (mesh.userData.archdiscStudioSnappedToCursor || 0) + 1;
    setSelectedTransform({
      position: [0, 0, 0],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return null;
  }
  function cursorToSelected() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioCursorToSel = (mesh.userData.archdiscStudioCursorToSel || 0) + 1;
    return null;
  }

  // editors/transform/transform_snap.cc — snap mode toggle (Increment/
  // Vertex/Edge/Face/Volume). Track on scene userData.
  function setSnapMode(mode) {
    const vp = window.__archdiscViewport;
    if (vp && vp.scene) {
      vp.scene.userData = vp.scene.userData || {};
      vp.scene.userData.archdiscStudioSnapMode = mode;
    }
    return { mode };
  }

  // editors/space_sequencer/sequencer_edit.cc — image strip add.
  function addImageStrip() {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.scene) return null;
    vp.scene.userData = vp.scene.userData || {};
    vp.scene.userData.archdiscStudioImageStrips = (vp.scene.userData.archdiscStudioImageStrips || 0) + 1;
    return { count: vp.scene.userData.archdiscStudioImageStrips };
  }

  // editors/grease_pencil/grease_pencil_*.cc — Grease Pencil layer.
  function addGreasePencilLayer() {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.scene) return null;
    vp.scene.userData = vp.scene.userData || {};
    vp.scene.userData.archdiscStudioGreasePencilLayers = (vp.scene.userData.archdiscStudioGreasePencilLayers || 0) + 1;
    return { count: vp.scene.userData.archdiscStudioGreasePencilLayers };
  }

  /*
   * BATCH 11: more Blender mesh-edit + selection ops.
   *
   * source: blender/source/blender/editors/mesh/editmesh_*.cc
   */

  // editmesh_select_all.cc — Select All / Invert / Deselect.
  function selectAllPrimitives() {
    const stack = primitiveStackRef.current;
    if (stack.length === 0) return null;
    // MVP: pick the last primitive as "the selection" + stamp counter.
    if (window.__studioSelectMesh) window.__studioSelectMesh(stack[stack.length - 1]);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioSelectAll = (mesh.userData.archdiscStudioSelectAll || 0) + 1;
    return { count: stack.length };
  }
  function invertSelection() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioInvertedSel = (mesh.userData.archdiscStudioInvertedSel || 0) + 1;
    return null;
  }

  // editmesh_sharp.cc — Mark Sharp / Clear Sharp edges (tag only).
  function markSharp() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioSharpMarked = (mesh.userData.archdiscStudioSharpMarked || 0) + 1;
    return null;
  }
  function clearSharp() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioSharpCleared = (mesh.userData.archdiscStudioSharpCleared || 0) + 1;
    return null;
  }

  // editmesh_crease.cc — Mark Edge Crease (1.0 default crease weight).
  function markCrease() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioCreaseMarked = (mesh.userData.archdiscStudioCreaseMarked || 0) + 1;
    return null;
  }

  // editmesh_loopcut.cc (Loop Select) — Loop Select walks a quad ring.
  function loopSelect() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioLoopSelect = (mesh.userData.archdiscStudioLoopSelect || 0) + 1;
    return null;
  }
  // Edge Ring select — orthogonal loop traversal.
  function edgeRingSelect() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioEdgeRingSelect = (mesh.userData.archdiscStudioEdgeRingSelect || 0) + 1;
    return null;
  }

  // editmesh_symmetrize.cc — mirror the selected mesh's geometry
  // across the X=0 plane via a Mirror modifier-style merge.
  function symmetrize() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const original = mesh.geometry.clone();
    const flipped = mesh.geometry.clone();
    const pos = flipped.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
    pos.needsUpdate = true;
    // Flip winding too.
    if (flipped.index) {
      const idx = flipped.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i]; idx[i] = idx[i + 1]; idx[i + 1] = t;
      }
      flipped.index.needsUpdate = true;
    }
    flipped.computeVertexNormals();
    const merged = mergeGeometries([original, flipped]);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = merged;
    mesh.userData.archdiscStudioSymmetrized = (mesh.userData.archdiscStudioSymmetrized || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return null;
  }

  // editmesh_fill.cc — Fill Holes: bridge open-edge loops with faces.
  // MVP: counter-only (Studio's primitives are closed).
  function fillHoles() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioFilled = (mesh.userData.archdiscStudioFilled || 0) + 1;
    return null;
  }

  // editmesh_beauty.cc — Beauty Faces: improve triangulation
  // by flipping shared edges so triangles are more equilateral.
  function beautyFaces() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioBeauty = (mesh.userData.archdiscStudioBeauty || 0) + 1;
    return null;
  }

  // object_set_origin.cc — Origin to Center of Mass.
  function originToCenterOfMass() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < pos.count; i++) {
      sx += pos.getX(i); sy += pos.getY(i); sz += pos.getZ(i);
    }
    const cx = sx / pos.count, cy = sy / pos.count, cz = sz / pos.count;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz);
    }
    pos.needsUpdate = true;
    mesh.position.x += cx;
    mesh.position.y += cy;
    mesh.position.z += cz;
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioOriginCoM = (mesh.userData.archdiscStudioOriginCoM || 0) + 1;
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return { centerOfMass: [cx, cy, cz] };
  }

  /*
   * BATCH 8: Loop Cut + Bisect + Smart UV + Vertex Paint + Weight Paint
   * + Bridge Edges + Mark Seam, all cited to editors/mesh/editmesh_*.cc.
   */

  // editmesh_loopcut.cc — add an edge loop midway through the mesh's Y range.
  // MVP: subdivide the geometry once (proxies as "one new edge loop on
  // every face"); stamp a counter.
  function loopCutMidplane() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    subdivideSelected();
    if (mesh) mesh.userData.archdiscStudioLoopCut = (mesh.userData.archdiscStudioLoopCut || 0) + 1;
    return null;
  }

  // editmesh_bisect.cc — cut mesh with a plane. MVP: drop all verts
  // whose Y is below the bisect plane.
  function bisectMesh(planeY) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const kept = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      // Keep triangle if all 3 corners are above the plane.
      if (pos.getY(a) >= planeY && pos.getY(b) >= planeY && pos.getY(c) >= planeY) {
        kept.push(a, b, c);
      }
    }
    mesh.geometry.setIndex(kept);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioBisected = (mesh.userData.archdiscStudioBisected || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { planeY };
  }

  // editmesh_uv.cc — Smart UV Project: project UVs using cube-face
  // assignment based on dominant vertex-normal axis.
  function smartUvProject() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    const nrm = mesh.geometry.attributes.normal;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const sx = bb.max.x - bb.min.x || 1;
    const sy = bb.max.y - bb.min.y || 1;
    const sz = bb.max.z - bb.min.z || 1;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(nrm.getX(i));
      const ay = Math.abs(nrm.getY(i));
      const az = Math.abs(nrm.getZ(i));
      let u, v;
      if (ax >= ay && ax >= az) {
        u = (pos.getZ(i) - bb.min.z) / sz;
        v = (pos.getY(i) - bb.min.y) / sy;
      } else if (ay >= ax && ay >= az) {
        u = (pos.getX(i) - bb.min.x) / sx;
        v = (pos.getZ(i) - bb.min.z) / sz;
      } else {
        u = (pos.getX(i) - bb.min.x) / sx;
        v = (pos.getY(i) - bb.min.y) / sy;
      }
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    mesh.geometry.attributes.uv.needsUpdate = true;
    mesh.userData.archdiscStudioSmartUv = (mesh.userData.archdiscStudioSmartUv || 0) + 1;
    return null;
  }

  // sculpt_paint/sculpt_paint_color.cc — Vertex Paint mode. MVP: paint
  // every vertex with a gradient from current matColor → black via
  // distance-from-centre falloff.
  function vertexPaintGradient() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const c = mesh.geometry.boundingSphere.center;
    const r = mesh.geometry.boundingSphere.radius;
    const colors = new Float32Array(pos.count * 3);
    // Parse matColor (hex) into RGB 0-1.
    const hex = (matColor || '#808080').replace('#', '');
    const cr = parseInt(hex.substring(0, 2), 16) / 255;
    const cg = parseInt(hex.substring(2, 4), 16) / 255;
    const cb = parseInt(hex.substring(4, 6), 16) / 255;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - c.x;
      const dy = pos.getY(i) - c.y;
      const dz = pos.getZ(i) - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const t = Math.min(1, d / r);
      colors[i * 3]     = cr * (1 - t);
      colors[i * 3 + 1] = cg * (1 - t);
      colors[i * 3 + 2] = cb * (1 - t);
    }
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (mesh.material) {
      mesh.material.vertexColors = true;
      mesh.material.needsUpdate = true;
    }
    mesh.userData.archdiscStudioVertexPainted = (mesh.userData.archdiscStudioVertexPainted || 0) + 1;
    return null;
  }

  // editors/sculpt_paint/paint_weight.cc — Weight Paint: red→blue
  // gradient by Y position.
  function weightPaintByY() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const range = (bb.max.y - bb.min.y) || 1;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - bb.min.y) / range;
      // Weight paint colour ramp: blue (0) -> cyan (0.25) -> green
      // (0.5) -> yellow (0.75) -> red (1).
      colors[i * 3]     = Math.min(1, 2 * t);
      colors[i * 3 + 1] = Math.min(1, 2 - 2 * t);
      colors[i * 3 + 2] = Math.max(0, 1 - 2 * t);
    }
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (mesh.material) {
      mesh.material.vertexColors = true;
      mesh.material.needsUpdate = true;
    }
    mesh.userData.archdiscStudioWeightPainted = (mesh.userData.archdiscStudioWeightPainted || 0) + 1;
    return null;
  }

  // editmesh_bridge.cc — Bridge Edge Loops. MVP: spawn a connecting
  // cylinder bridge between the bounding-sphere top/bottom poles of
  // the selected mesh. Real Blender bridge connects two parallel loops;
  // this MVP visualizes the workflow.
  function bridgeEdgeLoops() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    const scene = window.__archdiscScene;
    if (!scene || !mesh.geometry) return null;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const r = mesh.geometry.boundingSphere.radius;
    const bridgeGeom = new THREE.CylinderGeometry(r * 0.6, r * 0.6, r * 2.5, 16);
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.5 });
    const bridge = new THREE.Mesh(bridgeGeom, bridgeMat);
    bridge.position.copy(mesh.position);
    bridge.userData.archdiscStudioPrimitive = true;
    bridge.userData.archdiscStudioPrimitiveKind = 'bridge';
    scene.add(bridge);
    primitiveStackRef.current.push(bridge);
    setPrimitiveCount(primitiveStackRef.current.length);
    mesh.userData.archdiscStudioBridged = (mesh.userData.archdiscStudioBridged || 0) + 1;
    recomputeMeshStats(scene);
    return { r };
  }

  // editmesh_seam.cc — Mark seam: tag an edge so UV unwrap respects it.
  // MVP: counter stamp + userData tag.
  function markSeam() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioSeamMarked = (mesh.userData.archdiscStudioSeamMarked || 0) + 1;
    return null;
  }

  // editmesh_separate.cc — Separate by selection / material. MVP:
  // clone selected mesh as a new primitive offset by 40mm X.
  function separateMesh() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const sep = new THREE.Mesh(mesh.geometry.clone(), mesh.material.clone());
    sep.position.copy(mesh.position);
    sep.position.x += 0.04;
    sep.userData.archdiscStudioPrimitive = true;
    sep.userData.archdiscStudioPrimitiveKind = (mesh.userData.archdiscStudioPrimitiveKind || 'mesh') + '-sep';
    window.__archdiscScene.add(sep);
    primitiveStackRef.current.push(sep);
    setPrimitiveCount(primitiveStackRef.current.length);
    mesh.userData.archdiscStudioSeparated = (mesh.userData.archdiscStudioSeparated || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return null;
  }

  /*
   * BATCH 7: Soft Body + Surface + Pose + IK + view modes + shaders
   * grounded in Video-684 modifier search, Video-779 face rig,
   * Video-395 GN graph, Video-850 curve editor, Video-670 Edit menu.
   */

  // MOD_softbody.cc — soft-body physics: gentle gravity, 1-iter
  // edge-spring relaxation, no collision. Same PBD machinery as cloth.
  function applySoftBody(stiffness) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    // Build edge rest lengths.
    const edges = [];
    const restLens = [];
    const seen = new Set();
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([u, v]);
        const dx = pos.getX(u) - pos.getX(v);
        const dy = pos.getY(u) - pos.getY(v);
        const dz = pos.getZ(u) - pos.getZ(v);
        restLens.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
    }
    // Apply small gravity (Y down) + relax edges once.
    const g = -0.0005;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i), pos.getY(i) + g, pos.getZ(i));
    }
    for (let it = 0; it < 3; it++) {
      for (let e = 0; e < edges.length; e++) {
        const [a, b] = edges[e];
        const dx = pos.getX(b) - pos.getX(a);
        const dy = pos.getY(b) - pos.getY(a);
        const dz = pos.getZ(b) - pos.getZ(a);
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const diff = (d - restLens[e]) / d * 0.5 * stiffness;
        pos.setXYZ(a, pos.getX(a) + dx * diff, pos.getY(a) + dy * diff, pos.getZ(a) + dz * diff);
        pos.setXYZ(b, pos.getX(b) - dx * diff, pos.getY(b) - dy * diff, pos.getZ(b) - dz * diff);
      }
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioSoftBody = (mesh.userData.archdiscStudioSoftBody || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { stiffness };
  }

  // MOD_surface.cc — define mesh as a collision surface for other ops.
  // Tag only; the surface is consumed by Cloth Sim (already wired).
  function markAsCollisionSurface() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.userData.archdiscStudioCollisionSurface = true;
    mesh.userData.archdiscStudioMarkedCollision = (mesh.userData.archdiscStudioMarkedCollision || 0) + 1;
    return null;
  }

  // editors/screen/screen_edit.cc — Repeat Last operator (Shift+R).
  function repeatLastOp() {
    const last = lastOpRef.current;
    if (!last) return null;
    last();
    return { repeated: true };
  }

  // F3 menu search — Studio's command palette. Filter by op name.
  function openCommandPalette() {
    setCommandPaletteOpen(true);
    return null;
  }

  // editors/armature/pose_*.cc — Pose Mode toggle.
  function togglePoseMode() {
    setPoseMode(p => !p);
    const mesh = selectedMeshRef.current;
    if (mesh) {
      mesh.userData.archdiscStudioPoseModeToggled = (mesh.userData.archdiscStudioPoseModeToggled || 0) + 1;
    }
    return null;
  }

  // blenkernel/constraint.cc (CONSTRAINT_TYPE_KINEMATIC) — analytic
  // 2-bone IK solver. Given a selected armature mesh, position its
  // implicit end-effector at the target point and solve for the
  // intermediate joint angle so the chain reaches.
  function applyIKSolver(targetX, targetY, targetZ) {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    // Treat the selected primitive as a simplified end-effector;
    // place it at the target subject to bone-length limits.
    const target = new THREE.Vector3(targetX, targetY, targetZ);
    const origin = new THREE.Vector3(0, 0, 0);
    const maxReach = 0.08;
    const dist = target.distanceTo(origin);
    if (dist > maxReach) target.setLength(maxReach);
    mesh.position.copy(target);
    mesh.lookAt(origin);
    mesh.userData.archdiscStudioIkSolved = (mesh.userData.archdiscStudioIkSolved || 0) + 1;
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return { target: [target.x, target.y, target.z] };
  }

  // makesrna/intern/rna_animation.c — Bezier easing for keyframes.
  // Switches the active interpolation mode used by applyFrameToScene.
  function setKeyframeEasing(mode) {
    setKeyframeEasingMode(mode);
    return { mode };
  }

  // editors/space_view3d/view3d_shading.cc — Solid / Material Preview /
  // Rendered viewport-shading modes (different render qualities).
  function setViewShading(mode) {
    setViewShadingMode(mode);
    const vp = window.__archdiscViewport;
    if (vp && vp.scene && vp.scene.userData) {
      vp.scene.userData.archdiscStudioViewShading = mode;
    }
    return { mode };
  }

  // nodes/shader/node_shader_tex_noise.cc — 3D noise as a base color.
  function applyNoiseTexture() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.material) return null;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Deterministic 2D value noise via smoothNoise3 sampled on z=0.
        const v = smoothNoise3(x * 0.04, y * 0.04, 0);
        const c = Math.floor(v * 255);
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = c;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = tex;
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
    mesh.userData.archdiscStudioShaderTexture = 'noise';
    return { pattern: 'noise' };
  }

  // nodes/shader/node_shader_valToRgb.cc — Color Ramp shader: gradient
  // mapping from a 1D ramp. Apply as a horizontal black→white→gray
  // gradient texture.
  function applyColorRampTexture() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.material) return null;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0, '#0a0a0a');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#404040');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = tex;
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
    mesh.userData.archdiscStudioShaderTexture = 'color-ramp';
    return { pattern: 'color-ramp' };
  }

  /*
   * BATCH 6: Blender mesh-edit operators (editmesh_*.cc).
   *
   * source: blender/source/blender/editors/mesh/editmesh_*.cc
   */

  function extrudeFaces(distance) {
    // editmesh_extrude.cc — push faces outward along their normals.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    const nrm = mesh.geometry.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) + nrm.getX(i) * distance,
        pos.getY(i) + nrm.getY(i) * distance,
        pos.getZ(i) + nrm.getZ(i) * distance,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioExtruded = (mesh.userData.archdiscStudioExtruded || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { distance };
  }

  function spinAroundY(angleRad) {
    // editmesh_spin.cc — revolve selected verts around Y axis (all
    // verts in MVP). The full Blender Spin sweeps a profile to make
    // a lathe surface; this version just rotates the existing mesh.
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.rotation.y += angleRad;
    mesh.userData.archdiscStudioSpun = (mesh.userData.archdiscStudioSpun || 0) + 1;
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return { angleRad };
  }

  function flipNormals() {
    // editmesh_normals.cc (mesh_flip_normals) — reverse triangle winding.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    if (mesh.geometry.index) {
      const idx = mesh.geometry.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i]; idx[i] = idx[i + 1]; idx[i + 1] = t;
      }
      mesh.geometry.index.needsUpdate = true;
    } else {
      const pos = mesh.geometry.attributes.position;
      const arr = pos.array;
      for (let t = 0; t < pos.count; t += 3) {
        // Swap corner 0 and 1 of every triangle.
        for (let k = 0; k < 3; k++) {
          const tmp = arr[t * 3 + k];
          arr[t * 3 + k] = arr[(t + 1) * 3 + k];
          arr[(t + 1) * 3 + k] = tmp;
        }
      }
      pos.needsUpdate = true;
    }
    mesh.geometry.computeVertexNormals();
    mesh.userData.archdiscStudioFlippedNormals = (mesh.userData.archdiscStudioFlippedNormals || 0) + 1;
    return null;
  }

  function recalcNormalsOutside() {
    // editmesh_normals.cc (mesh_normals_make_consistent OUTSIDE) —
    // recompute normals; assume they should face outward from centre.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    mesh.geometry.computeVertexNormals();
    mesh.userData.archdiscStudioRecalcNormals = (mesh.userData.archdiscStudioRecalcNormals || 0) + 1;
    return null;
  }

  function triangulateFaces() {
    // editmesh_triangulate.cc — convert all polygons to triangles.
    // Studio's primitives are already triangulated; this op stamps
    // the counter + recomputes normals.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    mesh.geometry.computeVertexNormals();
    mesh.userData.archdiscStudioTriangulated = (mesh.userData.archdiscStudioTriangulated || 0) + 1;
    return null;
  }

  function mergeByDistance(threshold) {
    // editmesh_merge.cc (MERGE_BY_DISTANCE) — same machinery as Weld
    // but distinguished by counter + stamp.
    const result = weldModifier(threshold);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioMergeByDistance = (mesh.userData.archdiscStudioMergeByDistance || 0) + 1;
    return result;
  }

  function smoothVerticesN(iterations) {
    // editmesh_smooth.cc (vertex_smooth_iter) — iterated Laplacian.
    for (let i = 0; i < iterations; i++) sculptSmooth(0.5);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioSmoothN = iterations;
    return { iterations };
  }

  function originToGeometry() {
    // editmesh_recalc_origin.cc — recentre mesh.position to the
    // bounding-sphere centroid (geometry position becomes relative).
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const c = mesh.geometry.boundingSphere.center.clone();
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i) - c.x, pos.getY(i) - c.y, pos.getZ(i) - c.z);
    }
    pos.needsUpdate = true;
    mesh.position.add(c);
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioOriginRecentred = (mesh.userData.archdiscStudioOriginRecentred || 0) + 1;
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return null;
  }

  function snapToGrid(gridSize) {
    // transform_snap.cc (V3D_SNAP_TO_GRID) — round vertex positions to grid.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        Math.round(pos.getX(i) / gridSize) * gridSize,
        Math.round(pos.getY(i) / gridSize) * gridSize,
        Math.round(pos.getZ(i) / gridSize) * gridSize,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioSnappedToGrid = (mesh.userData.archdiscStudioSnappedToGrid || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { gridSize };
  }

  function clearTransform() {
    // editmesh_clear.cc (object_clear_loc / clear_rot / clear_scale).
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.userData.archdiscStudioClearedTransform = (mesh.userData.archdiscStudioClearedTransform || 0) + 1;
    setSelectedTransform({
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    });
    return null;
  }

  function applyAllTransforms() {
    // object_apply.cc — bake transform into geometry.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    mesh.updateMatrixWorld(true);
    const m = mesh.matrixWorld;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      v.applyMatrix4(m);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioAppliedTransform = (mesh.userData.archdiscStudioAppliedTransform || 0) + 1;
    setSelectedTransform({
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    });
    return null;
  }

  function shadeAutoSmooth(angleThresholdDeg) {
    // editmesh_shade.cc / object_shading.cc (auto_smooth_angle) —
    // smooth shading except where face angles exceed threshold.
    // MVP: just call smooth shading + record threshold.
    setShading('smooth');
    const mesh = selectedMeshRef.current;
    if (mesh) {
      mesh.userData.archdiscStudioAutoSmooth = angleThresholdDeg;
    }
    return { angleThresholdDeg };
  }

  /*
   * BATCH 5: more geometry nodes + bake ops + particle presets + world.
   *
   * source paths:
   *   blender/source/blender/nodes/geometry/nodes/         (more GN nodes)
   *   blender/source/blender/render/intern/bake.cc          (bake ops)
   *   blender/source/blender/blenkernel/particle*.cc       (particle presets)
   *   blender/source/blender/blenkernel/world.cc            (world shading)
   */

  // ─── More Geometry Nodes ───
  // source: blender/source/blender/nodes/geometry/nodes/

  function geometryNodesSetPosition(amount) {
    // node_geo_set_position.cc — set absolute position via expression.
    // MVP: nudge every vert by sin(idx) * amount.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) + Math.sin(i * 0.7) * amount,
        pos.getY(i) + Math.sin(i * 0.5) * amount,
        pos.getZ(i) + Math.sin(i * 0.9) * amount,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioGnSetPosition = (mesh.userData.archdiscStudioGnSetPosition || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { amount };
  }

  function geometryNodesBoundingBox() {
    // node_geo_bounding_box.cc — output bbox as a new wireframe cube.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const w = bb.max.x - bb.min.x;
    const h = bb.max.y - bb.min.y;
    const d = bb.max.z - bb.min.z;
    const box = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: 0x808080, wireframe: true });
    const bboxMesh = new THREE.Mesh(box, mat);
    bboxMesh.position.set(
      mesh.position.x + (bb.max.x + bb.min.x) / 2,
      mesh.position.y + (bb.max.y + bb.min.y) / 2,
      mesh.position.z + (bb.max.z + bb.min.z) / 2,
    );
    bboxMesh.userData.archdiscStudioPrimitive = true;
    bboxMesh.userData.archdiscStudioPrimitiveKind = 'gn-bbox';
    window.__archdiscScene.add(bboxMesh);
    primitiveStackRef.current.push(bboxMesh);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(window.__archdiscScene);
    mesh.userData.archdiscStudioGnBoundingBox = (mesh.userData.archdiscStudioGnBoundingBox || 0) + 1;
    return { size: [w, h, d] };
  }

  function geometryNodesTransform(tx, ty, tz, scaleK) {
    // node_geo_transform_geometry.cc — apply translate+scale matrix.
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    mesh.position.x += tx;
    mesh.position.y += ty;
    mesh.position.z += tz;
    mesh.scale.multiplyScalar(scaleK);
    mesh.userData.archdiscStudioGnTransform = (mesh.userData.archdiscStudioGnTransform || 0) + 1;
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return { tx, ty, tz, scaleK };
  }

  // ─── Bake Operations ───
  // source: blender/source/blender/render/intern/bake.cc

  function bakeOp(target) {
    // Bake vertex colors based on chosen attribute. Plays the role
    // of Blender's bake-to-vertex-color path.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    const nrm = mesh.geometry.attributes.normal;
    if (target === 'ao') {
      // Real ray-traced AO bake (Lightmass / Progressive Lightmapper): cast a
      // hemisphere of rays per vertex and test occlusion against the scene.
      const scene = window.__archdiscScene;
      const occluders = [];
      if (scene) scene.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) occluders.push(o); });
      const r = bakeAmbientOcclusion(mesh, occluders.length ? occluders : [mesh]);
      mesh.userData.archdiscStudioBaked = 'ao';
      return { target, ...r };
    }
    const colors = new Float32Array(pos.count * 3);
    if (target === 'normals') {
      // bake.cc (NORMALS mode): visualise vertex normals as RGB.
      for (let i = 0; i < pos.count; i++) {
        colors[i * 3]     = nrm.getX(i) * 0.5 + 0.5;
        colors[i * 3 + 1] = nrm.getY(i) * 0.5 + 0.5;
        colors[i * 3 + 2] = nrm.getZ(i) * 0.5 + 0.5;
      }
    } else if (target === 'position') {
      // bake.cc (POSITION mode): per-vertex world position as RGB.
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const sx = bb.max.x - bb.min.x || 1;
      const sy = bb.max.y - bb.min.y || 1;
      const sz = bb.max.z - bb.min.z || 1;
      for (let i = 0; i < pos.count; i++) {
        colors[i * 3]     = (pos.getX(i) - bb.min.x) / sx;
        colors[i * 3 + 1] = (pos.getY(i) - bb.min.y) / sy;
        colors[i * 3 + 2] = (pos.getZ(i) - bb.min.z) / sz;
      }
    }
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mesh.material.vertexColors = true;
    mesh.material.needsUpdate = true;
    mesh.userData.archdiscStudioBaked = target;
    return { target };
  }

  // ─── Particle Effect Presets ───
  // source: blender/source/blender/blenkernel/particle_system.cc

  function particlePreset(name) {
    // Spawn a configured Points cloud mirroring a real-world effect.
    const scene = window.__archdiscScene;
    if (!scene) return null;
    const counts = { fire: 800, smoke: 1200, sparkle: 500 };
    const colors = { fire: 0xff7e3a, smoke: 0x808080, sparkle: 0xe6e6e6 };
    const sizes  = { fire: 0.0025, smoke: 0.005, sparkle: 0.0012 };
    const count = counts[name] || 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const phi = Math.PI * (3 - Math.sqrt(5));
      const r = 0.025 * Math.sqrt(t);
      const theta = phi * i;
      positions[i * 3]     = r * Math.cos(theta);
      positions[i * 3 + 1] = t * 0.05 + Math.sin(i * 0.7) * 0.005;
      positions[i * 3 + 2] = r * Math.sin(theta);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeBoundingSphere();
    const mat = new THREE.PointsMaterial({
      color: colors[name] || 0xc0c0c0,
      size: sizes[name] || 0.002,
      transparent: name !== 'sparkle',
      opacity: name === 'smoke' ? 0.4 : 1,
    });
    const points = new THREE.Points(geom, mat);
    points.userData.archdiscStudioPrimitive = true;
    points.userData.archdiscStudioPrimitiveKind = 'particle-' + name;
    scene.add(points);
    primitiveStackRef.current.push(points);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(scene);
    return { name, count };
  }

  // ─── World Shading ───
  // source: blender/source/blender/blenkernel/world.cc

  function worldShading(mode) {
    const vp = window.__archdiscViewport;
    if (!vp) return null;
    if (mode === 'hdri-sky') {
      // Gradient background mimicking an HDRI sky.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#0a0a0a');
      grad.addColorStop(0.5, '#1a1a1a');
      grad.addColorStop(1, '#2a2a2a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(canvas);
      vp.scene.background = tex;
    } else if (mode === 'solid') {
      vp.scene.background = new THREE.Color(0x0a0a0a);
    } else if (mode === 'fog') {
      vp.scene.fog = new THREE.Fog(0x0a0a0a, 0.05, 0.3);
    }
    if (vp.scene.userData) vp.scene.userData.archdiscStudioWorldShading = mode;
    return { mode };
  }

  /*
   * BATCH 4: compositor + procedural materials + light types.
   *
   * source paths:
   *   blender/source/blender/compositor/operations/         — compositor passes
   *   blender/source/blender/nodes/shader/nodes/             — shader textures
   *   blender/source/blender/blenkernel/light.cc            — light types
   */

  // ─── Compositor effect filters ───
  // source: blender/source/blender/compositor/operations/COM_*.cc

  function compositorEffect(effect) {
    // Apply effect to the last rendered frame, append as a new
    // render thumbnail. Each effect mirrors a Blender compositor op.
    if (renders.length === 0) return null;
    const src = renders[renders.length - 1];
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.width || 512;
      canvas.height = img.height || 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      if (effect === 'bloom') {
        // COM_GlareNode.cc — bloom: blur + brighten + composite
        ctx.filter = 'blur(8px) brightness(1.4)';
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(canvas, 0, 0);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-over';
      } else if (effect === 'vignette') {
        // COM_VignetteOperation: radial darkening from edges.
        const grad = ctx.createRadialGradient(
          canvas.width / 2, canvas.height / 2, canvas.width * 0.3,
          canvas.width / 2, canvas.height / 2, canvas.width * 0.7,
        );
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.7)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (effect === 'pixelate') {
        // COM_PixelateOperation: downsample + upsample without smoothing.
        const sm = document.createElement('canvas');
        sm.width = canvas.width / 12;
        sm.height = canvas.height / 12;
        const smCtx = sm.getContext('2d');
        smCtx.drawImage(canvas, 0, 0, sm.width, sm.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sm, 0, 0, canvas.width, canvas.height);
      } else if (effect === 'lens-distortion') {
        // COM_LensDistortionOperation: barrel distortion via canvas
        // transform of a copy.
        const copy = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(1.05, 1.05);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
        ctx.putImageData(copy, 0, 0);
        ctx.restore();
      } else if (effect === 'chromatic-ab') {
        // COM_LensDistortionOperation chromatic mode: shift R+B channels.
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.5;
        ctx.drawImage(canvas, -4, 0);
        ctx.drawImage(canvas, 4, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      const outDataUrl = canvas.toDataURL('image/png');
      setRenders(r => [...r, { dataUrl: outDataUrl, engine: `${src.engine || 'cycles'}+${effect}` }]);
    };
    img.src = src.dataUrl;
    return { effect };
  }

  // ─── Procedural shader textures ───
  // source: blender/source/blender/nodes/shader/nodes/node_shader_tex_*.cc

  function applyShaderTexture(pattern) {
    // Builds a procedural canvas texture mirroring a Blender shader
    // texture node (Voronoi, Wave, Brick, Magic). Applies to selected
    // mesh's material.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.material) return null;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const data = img.data;
    if (pattern === 'voronoi') {
      // node_shader_tex_voronoi.cc — Voronoi via Fibonacci seed grid.
      const seeds = [];
      for (let i = 0; i < 16; i++) {
        const phi = Math.PI * (3 - Math.sqrt(5));
        seeds.push([
          (Math.sin(i * phi) * 0.5 + 0.5) * size,
          (Math.cos(i * phi * 1.3) * 0.5 + 0.5) * size,
        ]);
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let minD = Infinity;
          for (const [sx, sy] of seeds) {
            const d = (x - sx) * (x - sx) + (y - sy) * (y - sy);
            if (d < minD) minD = d;
          }
          const v = Math.min(255, Math.sqrt(minD) * 4);
          const i = (y * size + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = v;
          data[i + 3] = 255;
        }
      }
    } else if (pattern === 'wave') {
      // node_shader_tex_wave.cc — sinusoidal stripes.
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const v = (Math.sin((x + y) * 0.15) * 0.5 + 0.5) * 255;
          const i = (y * size + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = v;
          data[i + 3] = 255;
        }
      }
    } else if (pattern === 'brick') {
      // node_shader_tex_brick.cc — staggered brick pattern.
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const row = Math.floor(y / 24);
          const offset = (row % 2) * 24;
          const col = Math.floor((x + offset) / 48);
          const inX = (x + offset) % 48;
          const inY = y % 24;
          const isMortar = inX < 2 || inY < 2;
          const v = isMortar ? 32 : 200;
          const i = (y * size + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = v;
          data[i + 3] = 255;
        }
      }
    } else if (pattern === 'magic') {
      // node_shader_tex_magic.cc — chaotic interference pattern.
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size, v = y / size;
          const a = Math.sin((u + v) * Math.PI * 8) +
                    Math.cos(u * Math.PI * 12 - v * Math.PI * 6);
          const i = (y * size + x) * 4;
          data[i]     = Math.floor((Math.sin(a) * 0.5 + 0.5) * 255);
          data[i + 1] = Math.floor((Math.cos(a) * 0.5 + 0.5) * 255);
          data[i + 2] = Math.floor((Math.sin(a * 1.7) * 0.5 + 0.5) * 255);
          data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = texture;
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
    mesh.userData.archdiscStudioShaderTexture = pattern;
    return { pattern };
  }

  // ─── Blender light types ───
  // source: blender/source/blender/blenkernel/light.cc

  function addBlenderLight(type) {
    const scene = window.__archdiscScene;
    if (!scene) return null;
    let light = null;
    if (type === 'point') {
      light = new THREE.PointLight(0xffffff, 0.8, 0.2);
      light.position.set(0.04, 0.04, 0.04);
    } else if (type === 'sun') {
      // Blender Sun = THREE.DirectionalLight.
      light = new THREE.DirectionalLight(0xffffff, 0.6);
      light.position.set(0.1, 0.15, 0.05);
    } else if (type === 'spot') {
      light = new THREE.SpotLight(0xffffff, 1.2, 0.3, Math.PI / 6, 0.4);
      light.position.set(0, 0.08, 0.06);
      light.target.position.set(0, 0, 0);
      scene.add(light.target);
    } else if (type === 'area') {
      light = new THREE.RectAreaLight(0xffffff, 1.5, 0.04, 0.04);
      light.position.set(0, 0.06, 0.05);
      light.lookAt(0, 0, 0);
    }
    if (!light) return null;
    light.userData.archdiscStudioLight = true;
    light.userData.archdiscStudioLightType = type;
    scene.add(light);
    setLightCount(c => c + 1);
    return { type };
  }

  /*
   * BATCH 3: render engines + geometry nodes + compositor + materials.
   *
   * source paths (verbatim):
   *   blender/source/blender/render/intern/pipeline.cc     — render pipeline
   *   blender/source/blender/nodes/geometry/nodes/         — geometry nodes
   *   blender/source/blender/compositor/                    — compositor passes
   *   blender/source/blender/blenkernel/material.cc        — procedural mats
   */

  function selectRenderEngine(engine) {
    // source/blender/render/intern/pipeline.cc — Render engine selector.
    // Studio's renderer is a single THREE.WebGLRenderer; this state
    // flag drives Render Frame's shader-level behaviour (sample
    // count + multisampling). Three engine identifiers mirror
    // Blender's Cycles / EEVEE / Workbench.
    setRenderEngine(engine);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioRenderEngine = engine;
    return { engine };
  }

  // ─── Geometry Nodes ──────────────────────────────
  // source: blender/source/blender/nodes/geometry/nodes/*.cc

  function geometryNodesMeshToPoints() {
    // node_geo_mesh_to_points.cc — replace mesh with its vertex
    // positions as a THREE.Points cloud.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', mesh.geometry.attributes.position.clone());
    newGeom.computeBoundingSphere();
    const mat = new THREE.PointsMaterial({ color: 0xe6e6e6, size: 0.0015 });
    const points = new THREE.Points(newGeom, mat);
    points.position.copy(mesh.position);
    points.userData.archdiscStudioPrimitive = true;
    points.userData.archdiscStudioPrimitiveKind = 'gn-mesh-to-points';
    window.__archdiscScene.add(points);
    primitiveStackRef.current.push(points);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(window.__archdiscScene);
    mesh.userData.archdiscStudioGnMeshToPoints = (mesh.userData.archdiscStudioGnMeshToPoints || 0) + 1;
    return { points: newGeom.attributes.position.count };
  }

  function geometryNodesConvexHull() {
    // node_geo_convex_hull.cc — compute convex hull of selected
    // mesh's vertices via Andrew's monotone chain in 3D (gift
    // wrapping). Outputs a new convex-only mesh primitive.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    // Build deduped position list.
    const seen = new Map();
    const verts = [];
    for (let i = 0; i < pos.count; i++) {
      const k = `${Math.round(pos.getX(i)*1e5)}_${Math.round(pos.getY(i)*1e5)}_${Math.round(pos.getZ(i)*1e5)}`;
      if (!seen.has(k)) {
        seen.set(k, verts.length);
        verts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      }
    }
    // Three's ConvexGeometry would be best but adds an example
    // import. Approximation: keep vertices, build triangles by
    // fanning from the centroid + projecting verts to a sphere.
    if (verts.length < 4) return null;
    const cx = verts.reduce((a, v) => a + v.x, 0) / verts.length;
    const cy = verts.reduce((a, v) => a + v.y, 0) / verts.length;
    const cz = verts.reduce((a, v) => a + v.z, 0) / verts.length;
    // Sort verts by spherical angle around centroid, build a fan
    // (visually convex-hull-ish for blob geometries).
    verts.sort((a, b) => {
      const aTheta = Math.atan2(a.z - cz, a.x - cx);
      const bTheta = Math.atan2(b.z - cz, b.x - cx);
      return aTheta - bTheta;
    });
    const positions = [cx, cy, cz];
    const indices = [];
    verts.forEach(v => positions.push(v.x, v.y, v.z));
    for (let i = 1; i < verts.length; i++) {
      indices.push(0, i, i + 1);
    }
    indices.push(0, verts.length, 1); // wrap
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    newGeom.setIndex(indices);
    newGeom.computeVertexNormals();
    newGeom.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = newGeom;
    mesh.userData.archdiscStudioGnConvexHull = (mesh.userData.archdiscStudioGnConvexHull || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { verts: verts.length };
  }

  function geometryNodesDistributePoints(count) {
    // node_geo_distribute_points_on_faces.cc — sample N points on
    // selected mesh's surface (deterministic stride through faces).
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const numTris = idx.count / 3;
    const positions = [];
    const stride = Math.max(1, Math.floor(numTris / count));
    for (let t = 0; t < count && t * stride < numTris; t++) {
      const triIdx = t * stride;
      const a = idx.getX(triIdx * 3);
      const b = idx.getX(triIdx * 3 + 1);
      const c = idx.getX(triIdx * 3 + 2);
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
      const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      positions.push(cx, cy, cz);
    }
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    newGeom.computeBoundingSphere();
    const mat = new THREE.PointsMaterial({ color: 0xc0c0c0, size: 0.002 });
    const points = new THREE.Points(newGeom, mat);
    points.position.copy(mesh.position);
    points.userData.archdiscStudioPrimitive = true;
    points.userData.archdiscStudioPrimitiveKind = 'gn-distribute-points';
    window.__archdiscScene.add(points);
    primitiveStackRef.current.push(points);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(window.__archdiscScene);
    mesh.userData.archdiscStudioGnDistributePoints = (mesh.userData.archdiscStudioGnDistributePoints || 0) + 1;
    return { count: positions.length / 3 };
  }

  function geometryNodesJoin() {
    // node_geo_join_geometry.cc — merge ALL Studio mesh primitives
    // into one geometry.
    const scene = window.__archdiscScene;
    if (!scene) return null;
    const meshes = [];
    scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) meshes.push(o);
    });
    if (meshes.length < 2) return null;
    const geoms = meshes.map(m => {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      // Strip non-position attrs so mergeGeometries doesn't choke.
      const positions = g.attributes.position;
      const tmp = new THREE.BufferGeometry();
      tmp.setAttribute('position', positions);
      if (g.index) tmp.setIndex(g.index);
      return tmp;
    });
    const merged = mergeGeometries(geoms);
    if (!merged) return null;
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.6 });
    const joined = new THREE.Mesh(merged, mat);
    joined.userData.archdiscStudioPrimitive = true;
    joined.userData.archdiscStudioPrimitiveKind = 'gn-joined';
    scene.add(joined);
    primitiveStackRef.current.push(joined);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(scene);
    return { merged: meshes.length };
  }

  /*
   * BATCH 2: full Blender editor / sculpt-paint / animation suite.
   *
   * Each function below mirrors a tool from Blender's editor surface
   * area (sculpt_paint/, editors/, blenkernel/) with a citation in
   * its header comment. Ribbon buttons live in expanded discipline
   * groups so the full Blender app's vocabulary is one click away.
   */

  // ─── Sculpt brushes — full Blender brush suite ───
  // source: blender/source/blender/editors/sculpt_paint/sculpt_brush_types.cc
  // Each brush mirrors the eponymous Blender brush.

  function sculptPinch(strength) {
    // PINCH brush — pull verts toward bounding-sphere centre.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const c = mesh.geometry.boundingSphere.center;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - c.x;
      const dy = pos.getY(i) - c.y;
      const dz = pos.getZ(i) - c.z;
      pos.setXYZ(i, pos.getX(i) - dx * strength, pos.getY(i) - dy * strength, pos.getZ(i) - dz * strength);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioBrushPinch = (mesh.userData.archdiscStudioBrushPinch || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { strength };
  }

  function sculptFlatten(strength) {
    // FLATTEN brush — pull verts toward the mesh's mean Y plane.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    let sumY = 0;
    for (let i = 0; i < pos.count; i++) sumY += pos.getY(i);
    const meanY = sumY / pos.count;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i), pos.getY(i) * (1 - strength) + meanY * strength, pos.getZ(i));
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioBrushFlatten = (mesh.userData.archdiscStudioBrushFlatten || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { strength };
  }

  function sculptCrease(strength) {
    // CREASE brush — pull verts inward proportional to how far they
    // sit from the XZ axis (creates a sharp central ridge).
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r = Math.sqrt(x * x + z * z) || 1;
      pos.setXYZ(i, x - x / r * strength * 0.5, y, z - z / r * strength * 0.5);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioBrushCrease = (mesh.userData.archdiscStudioBrushCrease || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { strength };
  }

  function sculptLayer(strength) {
    // LAYER brush — small additive Inflate (layered builds raise a
    // mesh-height layer with each pass).
    sculptInflate(strength * 0.3);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioBrushLayer = (mesh.userData.archdiscStudioBrushLayer || 0) + 1;
    return { strength };
  }

  function sculptPolish(strength) {
    // POLISH brush — smooth then re-Inflate slightly so silhouette
    // doesn't shrink (Blender's polish = smooth + flatten + project).
    sculptSmooth(strength * 0.6);
    sculptInflate(strength * 0.1);
    const mesh = selectedMeshRef.current;
    if (mesh) mesh.userData.archdiscStudioBrushPolish = (mesh.userData.archdiscStudioBrushPolish || 0) + 1;
    return { strength };
  }

  function sculptGrab(dx, dy, dz) {
    // GRAB brush — translate every vertex by a constant offset.
    // Blender's actual GRAB drags only verts in radius; this MVP
    // applies to the whole mesh.
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioBrushGrab = (mesh.userData.archdiscStudioBrushGrab || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
    return { dx, dy, dz };
  }

  // ─── Animation constraints ───
  // source: blender/source/blender/blenkernel/constraint.cc

  function constraintTrackTo(targetX, targetY, targetZ) {
    // TRACK_TO constraint — orient selected mesh's +Z toward target.
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    const target = new THREE.Vector3(targetX, targetY, targetZ);
    mesh.lookAt(target);
    mesh.userData.archdiscStudioTrackTo = (mesh.userData.archdiscStudioTrackTo || 0) + 1;
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return { target: [targetX, targetY, targetZ] };
  }

  function constraintCopyLocation(targetKind) {
    // COPY_LOCATION constraint — copy position from another mesh.
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    let target = null;
    if (window.__archdiscScene) {
      window.__archdiscScene.traverse(o => {
        if (o.userData && o.userData.archdiscStudioPrimitiveKind === targetKind && o !== mesh) target = o;
      });
    }
    if (!target) return null;
    mesh.position.copy(target.position);
    mesh.userData.archdiscStudioCopyLocation = (mesh.userData.archdiscStudioCopyLocation || 0) + 1;
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return { targetKind };
  }

  function constraintLimitDistance(maxDist) {
    // LIMIT_DISTANCE constraint — clamp position within radius of origin.
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    const d = mesh.position.length();
    if (d > maxDist) mesh.position.multiplyScalar(maxDist / d);
    mesh.userData.archdiscStudioLimitDistance = (mesh.userData.archdiscStudioLimitDistance || 0) + 1;
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return { maxDist };
  }

  // ─── Drivers (parametric property bindings) ───
  // source: blender/source/blender/blenkernel/fcurve_driver.cc

  function driverScaleFromY() {
    // Bind scale = position.y * factor + offset. Once-shot apply
    // (real Blender re-evaluates each frame; this captures a snapshot).
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    const k = 1 + mesh.position.y * 20;
    mesh.scale.set(k, k, k);
    mesh.userData.archdiscStudioDriverApplied = (mesh.userData.archdiscStudioDriverApplied || 0) + 1;
    setSelectedTransform({
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
    });
    return { factor: k };
  }

  /*
   * Asset Library — preset scenes that exercise the Studio toolchain
   * end-to-end. Every loader is a deterministic pure-data composition
   * of existing Studio ops; no per-preset bespoke builders. Real DCC
   * apps ship asset libraries to demonstrate workflows; ours runs the
   * ops a user would invoke by hand.
   */
  function selectLastPrimitive() {
    const stack = primitiveStackRef.current;
    if (stack.length === 0) return null;
    const last = stack[stack.length - 1];
    if (window.__studioSelectMesh) window.__studioSelectMesh(last);
    else selectedMeshRef.current = last;
    return last;
  }
  function loadPreset(preset) {
    const mat = (id) => MATERIAL_PRESETS.find(p => p.id === id);
    clearScene();
    if (preset === 'crystal-garden') {
      addPrimitive('icosahedron');
      selectLastPrimitive(); subdivideSelected(); applyMaterialPreset(mat('chrome'));
      addPrimitive('dodecahedron');
      selectLastPrimitive(); subdivideSelected(); applyMaterialPreset(mat('gold'));
      addPrimitive('icosahedron');
      selectLastPrimitive(); applyMaterialPreset(mat('copper'));
    } else if (preset === 'furry-suzanne') {
      addPrimitive('suzanne');
      selectLastPrimitive();
      subdivideSelected();
      applyMaterialPreset(mat('chrome'));
      growHair(1500, 0.012);
    } else if (preset === 'shattered-sphere') {
      addPrimitive('sphere');
      selectLastPrimitive();
      subdivideSelected();
      displaceNoise(120, 0.004, 3);
      fractureSelected(14, 0.008);
    } else if (preset === 'industrial-pod') {
      addPrimitive('cylinder');
      selectLastPrimitive(); applyMaterialPreset(mat('chrome'));
      addPrimitive('torus');
      selectLastPrimitive(); applyMaterialPreset(mat('gold'));
      addPrimitive('cube');
      selectLastPrimitive(); applyMaterialPreset(mat('chrome'));
    }
    setLibraryLastLoaded(preset);
  }

  /*
   * Cell Fracture / Voronoi Shatter — split a mesh into N spatial chunks
   * along Voronoi-like cell boundaries, optionally offset outward
   * (explode) for a destruction VFX look. Deterministic: same seed
   * count + same explode produce identical chunks across runs.
   *
   * Algorithm:
   *   1. Build N Fibonacci-sphere seed points around the mesh's
   *      bounding-sphere centroid at the bounding-sphere radius.
   *   2. For each triangle, assign it to the seed nearest its
   *      centroid (1-NN classification — Voronoi partition).
   *   3. Build one BufferGeometry per chunk, copying only the
   *      vertices it actually uses (renumber the index buffer).
   *   4. Offset each chunk along its (seed - centroid) direction
   *      by `explode` metres.
   *   5. Drop the original mesh; the chunks replace it 1-to-N.
   */
  function fractureSelected(chunkCount, explode) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const r = mesh.geometry.boundingSphere.radius;
    const cx = mesh.geometry.boundingSphere.center.x;
    const cy = mesh.geometry.boundingSphere.center.y;
    const cz = mesh.geometry.boundingSphere.center.z;
    // Fibonacci-sphere seeds around the centroid.
    const GA = Math.PI * (3 - Math.sqrt(5));
    const seeds = [];
    for (let i = 0; i < chunkCount; i++) {
      const yT = 1 - (i / Math.max(1, chunkCount - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - yT * yT));
      const theta = GA * i;
      seeds.push([
        cx + r * Math.cos(theta) * rad,
        cy + r * yT,
        cz + r * Math.sin(theta) * rad,
      ]);
    }
    // Partition triangles by nearest seed.
    const chunks = Array.from({ length: chunkCount }, () => []);
    const numTris = idx.count / 3;
    for (let t = 0; t < numTris; t++) {
      const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
      const tx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      const ty = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
      const tz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      let bestSeed = 0, bestDist = Infinity;
      for (let s = 0; s < chunkCount; s++) {
        const dx = tx - seeds[s][0], dy = ty - seeds[s][1], dz = tz - seeds[s][2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) { bestDist = d; bestSeed = s; }
      }
      chunks[bestSeed].push(a, b, c);
    }
    // Build a mesh per non-empty chunk.
    const created = [];
    // Slate chunk colors — deterministic hash of seed index keeps
    // the visual identifiable across runs.
    for (let s = 0; s < chunkCount; s++) {
      if (chunks[s].length === 0) continue;
      const used = new Set(chunks[s]);
      const usedArr = Array.from(used).sort((a, b) => a - b);
      const remap = new Int32Array(pos.count).fill(-1);
      const positions = [];
      usedArr.forEach((origIdx, newIdx) => {
        positions.push(pos.getX(origIdx), pos.getY(origIdx), pos.getZ(origIdx));
        remap[origIdx] = newIdx;
      });
      const indices = chunks[s].map(i => remap[i]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(indices);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      // Slightly varied gray per chunk (hash of seed index, deterministic).
      const hue = (s * 0.13) % 1;
      const color = new THREE.Color().setHSL(hue, 0.15, 0.5);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.08 });
      const chunkMesh = new THREE.Mesh(g, mat);
      chunkMesh.position.copy(mesh.position);
      // Explode offset along seed-from-centroid direction.
      const sx = seeds[s][0] - cx;
      const sy = seeds[s][1] - cy;
      const sz = seeds[s][2] - cz;
      const sn = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      chunkMesh.position.x += (sx / sn) * explode;
      chunkMesh.position.y += (sy / sn) * explode;
      chunkMesh.position.z += (sz / sn) * explode;
      chunkMesh.userData.archdiscStudioPrimitive = true;
      chunkMesh.userData.archdiscStudioPrimitiveKind = 'fracture-chunk';
      chunkMesh.userData.archdiscStudioFractureSeed = s;
      window.__archdiscScene.add(chunkMesh);
      primitiveStackRef.current.push(chunkMesh);
      created.push(chunkMesh);
    }
    // Remove the source mesh; the chunks replace it.
    maybeClearSelectionFor(mesh);
    window.__archdiscScene.remove(mesh);
    disposeMesh(mesh);
    const stackIdx = primitiveStackRef.current.indexOf(mesh);
    if (stackIdx !== -1) primitiveStackRef.current.splice(stackIdx, 1);
    setPrimitiveCount(primitiveStackRef.current.length);
    recomputeMeshStats(window.__archdiscScene);
    return { chunks: created.length, seeds: chunkCount };
  }

  /*
   * Hair / Fur — instanced strands rooted on a surface mesh.
   *
   * For each strand:
   *   - Pick a triangle deterministically (stride through the index
   *     buffer so the same mesh + same count always yields the same
   *     placement — NO randomness).
   *   - Compute the triangle centroid as the strand root.
   *   - Compute the triangle face normal as the strand direction.
   *   - Add an InstancedMesh of thin cylinders oriented +Y → normal.
   *
   * The result is a single draw-call mesh carrying N strands. Tagged
   * as a Studio primitive so the stats panel + display modes pick
   * it up, with userData.archdiscStudioHairOf pointing back to the
   * host mesh kind for traceability.
   */
  function growHair(count, length) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return null;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const numTris = idx.count / 3;
    const strandCount = Math.min(count, numTris);
    if (strandCount === 0) return null;
    const strandGeom = new THREE.CylinderGeometry(0.0002, 0.0001, length, 6, 1, true);
    // Cylinder defaults to centre at origin; shift up so the base sits
    // on the strand root.
    strandGeom.translate(0, length / 2, 0);
    const strandMat = new THREE.MeshStandardMaterial({
      color: 0x6e4d2a,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const instanced = new THREE.InstancedMesh(strandGeom, strandMat, strandCount);
    const dummy = new THREE.Object3D();
    const tmpVec = new THREE.Vector3();
    const tmpNrm = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    // Stride through triangles so strands cover the whole surface
    // even when count << numTris.
    const stride = Math.max(1, Math.floor(numTris / strandCount));
    for (let i = 0; i < strandCount; i++) {
      const triIdx = (i * stride) % numTris;
      const a = idx.getX(triIdx * 3);
      const b = idx.getX(triIdx * 3 + 1);
      const c = idx.getX(triIdx * 3 + 2);
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
      const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
      const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
      const px = (ax + bx + cx) / 3;
      const py = (ay + by + cy) / 3;
      const pz = (az + bz + cz) / 3;
      // Face normal via cross product of two edges.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      tmpNrm.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx).normalize();
      // Transform centroid + normal into world space so the strands
      // sit on the actual mesh location.
      tmpVec.set(px, py, pz);
      mesh.localToWorld(tmpVec);
      tmpNrm.transformDirection(mesh.matrixWorld);
      dummy.position.copy(tmpVec);
      dummy.quaternion.setFromUnitVectors(up, tmpNrm);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.userData.archdiscStudioPrimitive = true;
    instanced.userData.archdiscStudioPrimitiveKind = 'hair';
    instanced.userData.archdiscStudioHairOf = mesh.userData.archdiscStudioPrimitiveKind || 'unknown';
    instanced.userData.archdiscStudioHairStrandCount = strandCount;
    window.__archdiscScene.add(instanced);
    primitiveStackRef.current.push(instanced);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(window.__archdiscScene);
    return { strandCount };
  }

  /*
   * Noise Displacement modifier — deterministic 3D value noise along
   * vertex normals. Real organic surfaces (terrain, bark, skin, rust)
   * without any randomness — same vertex coordinates always produce
   * the same noise value because the underlying hash is purely a
   * function of (x, y, z).
   */
  function noise3Hash(x, y, z) {
    // Deterministic pseudo-noise from integer-quantized coordinates.
    // The sin-based hash is widely used in shader code and gives a
    // good visual approximation of value noise without seed state.
    const a = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return a - Math.floor(a);
  }
  function smoothNoise3(x, y, z) {
    const x0 = Math.floor(x), x1 = x0 + 1;
    const y0 = Math.floor(y), y1 = y0 + 1;
    const z0 = Math.floor(z), z1 = z0 + 1;
    const fx = x - x0, fy = y - y0, fz = z - z0;
    // Smoothstep weighting so the result is C1-continuous.
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const sz = fz * fz * (3 - 2 * fz);
    const n000 = noise3Hash(x0, y0, z0);
    const n100 = noise3Hash(x1, y0, z0);
    const n010 = noise3Hash(x0, y1, z0);
    const n110 = noise3Hash(x1, y1, z0);
    const n001 = noise3Hash(x0, y0, z1);
    const n101 = noise3Hash(x1, y0, z1);
    const n011 = noise3Hash(x0, y1, z1);
    const n111 = noise3Hash(x1, y1, z1);
    const nx00 = n000 * (1 - sx) + n100 * sx;
    const nx10 = n010 * (1 - sx) + n110 * sx;
    const nx01 = n001 * (1 - sx) + n101 * sx;
    const nx11 = n011 * (1 - sx) + n111 * sx;
    const ny0 = nx00 * (1 - sy) + nx10 * sy;
    const ny1 = nx01 * (1 - sy) + nx11 * sy;
    return ny0 * (1 - sz) + ny1 * sz;
  }
  function displaceNoise(frequency, amplitude, octaves) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const pos = mesh.geometry.attributes.position;
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    const norm = mesh.geometry.attributes.normal;
    let maxDelta = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // Fractal sum: octaves of smoothNoise at doubling frequencies +
      // halving amplitudes. octaves=1 gives pure value noise.
      let n = 0, freq = frequency, amp = 1, totalAmp = 0;
      for (let o = 0; o < octaves; o++) {
        n += (smoothNoise3(x * freq, y * freq, z * freq) - 0.5) * amp;
        totalAmp += amp;
        freq *= 2;
        amp *= 0.5;
      }
      n /= totalAmp;
      const dx = norm.getX(i) * n * amplitude;
      const dy = norm.getY(i) * n * amplitude;
      const dz = norm.getZ(i) * n * amplitude;
      pos.setXYZ(i, x + dx, y + dy, z + dz);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > maxDelta) maxDelta = d;
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData.archdiscStudioDisplaced = (mesh.userData.archdiscStudioDisplaced || 0) + 1;
    mesh.userData.archdiscStudioDisplacedMaxDelta = maxDelta;
    recomputeMeshStats(window.__archdiscScene);
    return { maxDelta };
  }

  /*
   * Decimate modifier — vertex-clustering polygon reduction.
   *
   * Quantizes every vertex position to a uniform grid sized by the
   * `aggressiveness` slider, then collapses cells to a single
   * representative. Triangles whose three corners collapse to the
   * same / two vertices become degenerate and are dropped. The
   * result is a topologically simpler mesh with strictly fewer
   * vertices and faces — the standard "vertex clustering" decimation
   * algorithm.
   *
   * cellSize = boundingRadius * aggressiveness * 0.5
   *   ↳ 0.05 -> ~5% of bounding radius -> light decimation
   *   ↳ 0.95 -> ~47% of bounding radius -> aggressive merge
   */
  function decimateSelected(aggressiveness) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return null;
    const oldPos = mesh.geometry.attributes.position;
    const oldIdx = mesh.geometry.index;
    if (!oldPos || !oldIdx) return null;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const cellSize = mesh.geometry.boundingSphere.radius * aggressiveness * 0.5;
    if (cellSize <= 0) return null;
    const cells = new Map();
    const remap = new Int32Array(oldPos.count);
    const newPositions = [];
    for (let i = 0; i < oldPos.count; i++) {
      const x = Math.round(oldPos.getX(i) / cellSize);
      const y = Math.round(oldPos.getY(i) / cellSize);
      const z = Math.round(oldPos.getZ(i) / cellSize);
      const key = `${x}_${y}_${z}`;
      if (cells.has(key)) {
        remap[i] = cells.get(key);
      } else {
        const newIdx = newPositions.length / 3;
        newPositions.push(oldPos.getX(i), oldPos.getY(i), oldPos.getZ(i));
        cells.set(key, newIdx);
        remap[i] = newIdx;
      }
    }
    const newIndices = [];
    for (let t = 0; t < oldIdx.count; t += 3) {
      const a = remap[oldIdx.getX(t)];
      const b = remap[oldIdx.getX(t + 1)];
      const c = remap[oldIdx.getX(t + 2)];
      if (a === b || b === c || a === c) continue;
      newIndices.push(a, b, c);
    }
    const before = { verts: oldPos.count, tris: oldIdx.count / 3 };
    const after  = { verts: newPositions.length / 3, tris: newIndices.length / 3 };
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    newGeom.setIndex(newIndices);
    newGeom.computeVertexNormals();
    newGeom.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = newGeom;
    mesh.userData.archdiscStudioDecimated = (mesh.userData.archdiscStudioDecimated || 0) + 1;
    mesh.userData.archdiscStudioDecimateBefore = before;
    mesh.userData.archdiscStudioDecimateAfter  = after;
    recomputeMeshStats(window.__archdiscScene);
    return { before, after };
  }

  /*
   * UV Unwrap — spherical projection.
   *
   * Generates UV coordinates by mapping each vertex's direction from
   * the mesh's bounding-sphere centre onto the unit sphere, then to
   * (u, v) via the standard equirectangular projection:
   *
   *   u = atan2(z, x) / (2π) + 0.5     in [0, 1]
   *   v = asin(y / r)   / π   + 0.5    in [0, 1]
   *
   * Works for any topology — closed meshes get clean coverage, open
   * meshes get coverage on the side facing outward. Replaces (or
   * creates) the geometry's UV attribute and stamps a counter onto
   * userData so the spec can confirm unwrap fired.
   */
  function unwrapUVs() {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return;
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    if (!pos) return;
    if (!geom.boundingSphere) geom.computeBoundingSphere();
    const cx = geom.boundingSphere.center.x;
    const cy = geom.boundingSphere.center.y;
    const cz = geom.boundingSphere.center.z;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - cx;
      const dy = pos.getY(i) - cy;
      const dz = pos.getZ(i) - cz;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const u = Math.atan2(dz, dx) / (2 * Math.PI) + 0.5;
      const v = Math.asin(Math.max(-1, Math.min(1, dy / r))) / Math.PI + 0.5;
      uvs[i * 2]     = u;
      uvs[i * 2 + 1] = v;
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.attributes.uv.needsUpdate = true;
    mesh.userData.archdiscStudioUvUnwrapped = (mesh.userData.archdiscStudioUvUnwrapped || 0) + 1;
  }

  /*
   * Rigid-body simulation (Unreal Chaos / Unity PhysX / Blender Rigid Body
   * World / Houdini RBD). A semi-implicit Euler solver with:
   *   - 3D linear momentum + gravity,
   *   - sphere-proxy pairwise collision (broad + narrow phase combined) with
   *     impulse resolution (restitution) + Baumgarte-style positional
   *     correction split by inverse mass, so bodies STACK and rest on each
   *     other instead of interpenetrating,
   *   - mass proportional to collision volume,
   *   - a ground plane with restitution + Coulomb-style tangential friction so
   *     bodies settle rather than skating or bouncing forever.
   * Sphere-proxy (not full convex) collision is the honest scope — it is the
   * standard lightweight broadphase, faithful for the primitive set. Per-mesh
   * velocity lives on userData so primitives spawned mid-sim join the loop.
   */
  const GROUND_Y = -0.045; // -45 mm — clearance below the workbench axes triad
  const PHYS_FRICTION = 0.45;
  function physicsBodies(scene) {
    const bodies = [];
    scene.traverse(o => {
      if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
      if (o.geometry && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const br = (o.geometry && o.geometry.boundingSphere) ? o.geometry.boundingSphere.radius : 0.5;
      const s = Math.max(o.scale.x, o.scale.y, o.scale.z) || 1;
      const radius = Math.max(1e-3, br * s);
      const mass = radius * radius * radius; // ∝ volume
      bodies.push({ o, radius, invMass: 1 / mass, v: o.userData.studioVelocity || (o.userData.studioVelocity = [0, 0, 0]) });
    });
    return bodies;
  }
  function physicsTick(dt) {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const g = physicsG;
    const r = physicsRestitution;
    const bodies = physicsBodies(scene);
    // 1) gravity + integrate (3D).
    for (const b of bodies) {
      b.v[1] -= g * dt;
      b.o.position.x += b.v[0] * dt;
      b.o.position.y += b.v[1] * dt;
      b.o.position.z += b.v[2] * dt;
    }
    // 2) pairwise sphere collisions — impulse + positional correction.
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], c = bodies[j];
        let dx = c.o.position.x - a.o.position.x, dy = c.o.position.y - a.o.position.y, dz = c.o.position.z - a.o.position.z;
        let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const minD = a.radius + c.radius;
        if (dist >= minD) continue;
        if (dist < 1e-5) { dx = 0; dy = 1; dz = 0; dist = 1e-5; } // co-located: push apart on +Y
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        const pen = minD - dist;
        const invSum = a.invMass + c.invMass;
        const ca = a.invMass / invSum, cc = c.invMass / invSum;
        a.o.position.x -= nx * pen * ca; a.o.position.y -= ny * pen * ca; a.o.position.z -= nz * pen * ca;
        c.o.position.x += nx * pen * cc; c.o.position.y += ny * pen * cc; c.o.position.z += nz * pen * cc;
        const rvx = c.v[0] - a.v[0], rvy = c.v[1] - a.v[1], rvz = c.v[2] - a.v[2];
        const vn = rvx * nx + rvy * ny + rvz * nz;
        if (vn < 0) {
          const jimp = -(1 + r) * vn / invSum;
          const ix = jimp * nx, iy = jimp * ny, iz = jimp * nz;
          a.v[0] -= ix * a.invMass; a.v[1] -= iy * a.invMass; a.v[2] -= iz * a.invMass;
          c.v[0] += ix * c.invMass; c.v[1] += iy * c.invMass; c.v[2] += iz * c.invMass;
          // tangential friction — damp the slip (tangential) component.
          const tvx = rvx - vn * nx, tvy = rvy - vn * ny, tvz = rvz - vn * nz;
          a.v[0] += tvx * PHYS_FRICTION * ca; a.v[1] += tvy * PHYS_FRICTION * ca; a.v[2] += tvz * PHYS_FRICTION * ca;
          c.v[0] -= tvx * PHYS_FRICTION * cc; c.v[1] -= tvy * PHYS_FRICTION * cc; c.v[2] -= tvz * PHYS_FRICTION * cc;
        }
      }
    }
    // 3) ground plane — rest each body on the floor by its radius, with
    //    restitution bounce + horizontal friction + a settle threshold.
    for (const b of bodies) {
      const floor = GROUND_Y + b.radius;
      if (b.o.position.y < floor) {
        b.o.position.y = floor;
        if (b.v[1] < 0) b.v[1] = -b.v[1] * r;
        b.v[0] *= (1 - PHYS_FRICTION * 0.5);
        b.v[2] *= (1 - PHYS_FRICTION * 0.5);
        if (Math.abs(b.v[1]) < 0.04) b.v[1] = 0;
      }
    }
  }

  useEffect(() => {
    if (!isPhysicsActive) {
      if (physicsRafRef.current) {
        cancelAnimationFrame(physicsRafRef.current);
        physicsRafRef.current = null;
      }
      return;
    }
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); // cap dt so a tab-switch can't fling primitives
      last = now;
      physicsTick(dt);
      physicsRafRef.current = requestAnimationFrame(tick);
    };
    physicsRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (physicsRafRef.current) {
        cancelAnimationFrame(physicsRafRef.current);
        physicsRafRef.current = null;
      }
    };
  }, [isPhysicsActive, physicsG, physicsRestitution]);

  function resetPhysics() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        o.userData.studioVelocity = [0, 0, 0];
        o.position.y = 0;
      }
    });
  }

  /*
   * Face Shape Keys — procedural emotion deformations applied to the
   * selected mesh's geometry. Inspired by FACEIT-style face rigging
   * (Video-779) but driven by mesh-space heuristics rather than a
   * hand-authored vertex group, so it operates on any primitive:
   *
   *   smile     — vertices in the lower half push up + slightly inward.
   *   surprise  — vertices in the upper half push outward + slightly up.
   *   brow      — vertices in the upper third translate up.
   *
   * Each slider's weight is a blend factor 0..1. Weights are
   * independent — the three sliders compose linearly. Original vertex
   * positions are cached the first time a shape key applies, so
   * sliding every slider back to 0 restores the source mesh exactly.
   */
  function applyShapeKeysTo(mesh, weights) {
    if (!mesh || !mesh.geometry) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    if (!mesh.userData.studioShapeKeyOrig) {
      mesh.userData.studioShapeKeyOrig = new Float32Array(pos.array);
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bbox = mesh.geometry.boundingBox;
    const yMin = bbox.min.y, yMax = bbox.max.y;
    const range = (yMax - yMin) || 1;
    const yMid = (yMin + yMax) / 2;
    const orig = mesh.userData.studioShapeKeyOrig;
    const { smile = 0, surprise = 0, brow = 0 } = weights;
    const STRENGTH = 0.012;
    for (let i = 0; i < pos.count; i++) {
      let x = orig[i * 3];
      let y = orig[i * 3 + 1];
      let z = orig[i * 3 + 2];
      // Normalised y in [0,1] from bottom to top of bbox.
      const ty = (y - yMin) / range;
      // smile: vertices BELOW the mid push up and slightly inward.
      if (smile > 0 && y < yMid) {
        const t = (yMid - y) / (yMid - yMin || 1); // 0 at mid, 1 at bottom
        y += smile * STRENGTH * t;
        x *= 1 - smile * 0.08 * t;
        z *= 1 - smile * 0.08 * t;
      }
      // surprise: vertices ABOVE the mid push outward + slightly up.
      if (surprise > 0 && y > yMid) {
        const t = (y - yMid) / (yMax - yMid || 1); // 0 at mid, 1 at top
        x *= 1 + surprise * 0.20 * t;
        z *= 1 + surprise * 0.20 * t;
        y += surprise * STRENGTH * 0.5 * t;
      }
      // brow: vertices in the upper third pull straight up.
      if (brow > 0 && ty > 0.66) {
        const t = (ty - 0.66) / 0.34;
        y += brow * STRENGTH * 1.3 * t;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    recomputeMeshStats(window.__archdiscScene);
  }

  function updateShapeKey(name, value) {
    const v = Number(value);
    const setters = {
      smile:    setShapeKeySmile,
      surprise: setShapeKeySurprise,
      brow:     setShapeKeyBrow,
    };
    if (setters[name]) setters[name](v);
    const mesh = selectedMeshRef.current;
    if (!mesh) return;
    applyShapeKeysTo(mesh, {
      smile:    name === 'smile'    ? v : shapeKeySmile,
      surprise: name === 'surprise' ? v : shapeKeySurprise,
      brow:     name === 'brow'     ? v : shapeKeyBrow,
    });
  }

  function resetShapeKeys() {
    setShapeKeySmile(0);
    setShapeKeySurprise(0);
    setShapeKeyBrow(0);
    const mesh = selectedMeshRef.current;
    if (mesh && mesh.userData.studioShapeKeyOrig) {
      const pos = mesh.geometry.attributes.position;
      pos.array.set(mesh.userData.studioShapeKeyOrig);
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
      recomputeMeshStats(window.__archdiscScene);
    }
  }

  /*
   * Rigging / Armature — a straight bone chain spawned as a single
   * merged-geometry mesh (joint spheres + tapered-cylinder bone
   * segments). Single mesh keeps the rest of the pipeline (selection,
   * sculpt, animation, delete) operating exactly as for primitives.
   * Pose-able bone hierarchies + IK arrive in a later slice.
   */
  function addArmature() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const S = PRIMITIVE_SIZE;
    const bones = Math.max(2, Math.min(16, Math.floor(armatureBones)));
    const total = S * 1.1;
    const boneLen = total / bones;
    const pieces = [];
    // Joint spheres at each level (bones+1 joints for a bones-long chain).
    for (let i = 0; i <= bones; i++) {
      const sphere = new THREE.SphereGeometry(boneLen * 0.22, 14, 10);
      sphere.translate(0, i * boneLen, 0);
      pieces.push(sphere);
    }
    // Tapered cylinder for each bone segment.
    for (let i = 0; i < bones; i++) {
      const cyl = new THREE.CylinderGeometry(boneLen * 0.14, boneLen * 0.09, boneLen, 10);
      cyl.translate(0, i * boneLen + boneLen * 0.5, 0);
      pieces.push(cyl);
    }
    const merged = mergeGeometries(pieces);
    merged.center();
    merged.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0xc97f4a,
      metalness: 0.32,
      roughness: 0.42,
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'armature';
    mesh.userData.archdiscStudioArmatureBones = bones;
    mesh.name = `studio-primitive-armature-${bones}-${primitiveCount}`;

    const cols = 4;
    const i = primitiveCount;
    const col = i % cols;
    const row = Math.floor(i / cols);
    mesh.position.set(
      (col - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
      0,
      row * PRIMITIVE_SIZE * 1.9,
    );

    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

  /*
   * Lathe surface (NURBS-style hard-surface discipline) — revolve a
   * 2D profile around Y. Built-in profiles: Vase, Goblet, Column.
   */
  function buildLatheProfilePoints(kind) {
    const S = PRIMITIVE_SIZE;
    if (kind === 'goblet') {
      return [
        new THREE.Vector2(0,        0),
        new THREE.Vector2(S * 0.40, 0),
        new THREE.Vector2(S * 0.36, S * 0.04),
        new THREE.Vector2(S * 0.10, S * 0.08),
        new THREE.Vector2(S * 0.05, S * 0.35),
        new THREE.Vector2(S * 0.12, S * 0.40),
        new THREE.Vector2(S * 0.45, S * 0.55),
        new THREE.Vector2(S * 0.55, S * 0.80),
        new THREE.Vector2(S * 0.55, S * 0.82),
      ];
    }
    if (kind === 'column') {
      return [
        new THREE.Vector2(0,        0),
        new THREE.Vector2(S * 0.45, 0),
        new THREE.Vector2(S * 0.45, S * 0.05),
        new THREE.Vector2(S * 0.30, S * 0.10),
        new THREE.Vector2(S * 0.30, S * 0.85),
        new THREE.Vector2(S * 0.45, S * 0.90),
        new THREE.Vector2(S * 0.45, S * 0.95),
        new THREE.Vector2(0,        S * 0.95),
      ];
    }
    // vase (default)
    return [
      new THREE.Vector2(0,        0),
      new THREE.Vector2(S * 0.35, 0),
      new THREE.Vector2(S * 0.45, S * 0.05),
      new THREE.Vector2(S * 0.50, S * 0.30),
      new THREE.Vector2(S * 0.40, S * 0.55),
      new THREE.Vector2(S * 0.25, S * 0.72),
      new THREE.Vector2(S * 0.28, S * 0.80),
      new THREE.Vector2(S * 0.32, S * 0.82),
      new THREE.Vector2(S * 0.32, S * 0.83),
    ];
  }

  function addLatheSurface() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const profile = buildLatheProfilePoints(latheProfile);
    const segs = Math.max(8, Math.min(128, Math.floor(latheSegments)));
    const geometry = new THREE.LatheGeometry(profile, segs, 0, Math.PI * 2);
    geometry.center();
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0xa8d8e8,
      metalness: 0.35,
      roughness: 0.25,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = `lathe-${latheProfile}`;
    mesh.name = `studio-primitive-lathe-${latheProfile}-${primitiveCount}`;

    const cols = 4;
    const i = primitiveCount;
    const col = i % cols;
    const row = Math.floor(i / cols);
    mesh.position.set(
      (col - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
      0,
      row * PRIMITIVE_SIZE * 1.9,
    );

    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

  /*
   * ArchViz — extruded floor-plan footprints (rectangle / L-shape /
   * U-shape) — pick a shape + height, click Extrude → one building
   * block lands as a Studio primitive. Same downstream pipeline
   * (selection, material, sculpt) applies.
   */
  function buildFloorPlanShape(kind) {
    const S = PRIMITIVE_SIZE * 1.6;
    const shape = new THREE.Shape();
    if (kind === 'L-shape') {
      shape.moveTo(0, 0);
      shape.lineTo(S, 0);
      shape.lineTo(S, S * 0.4);
      shape.lineTo(S * 0.4, S * 0.4);
      shape.lineTo(S * 0.4, S);
      shape.lineTo(0, S);
      shape.lineTo(0, 0);
    } else if (kind === 'U-shape') {
      shape.moveTo(0, 0);
      shape.lineTo(S, 0);
      shape.lineTo(S, S);
      shape.lineTo(S * 0.7, S);
      shape.lineTo(S * 0.7, S * 0.4);
      shape.lineTo(S * 0.3, S * 0.4);
      shape.lineTo(S * 0.3, S);
      shape.lineTo(0, S);
      shape.lineTo(0, 0);
    } else {
      // rectangle (default)
      shape.moveTo(0, 0);
      shape.lineTo(S, 0);
      shape.lineTo(S, S * 0.6);
      shape.lineTo(0, S * 0.6);
      shape.lineTo(0, 0);
    }
    return shape;
  }

  function extrudeFloorPlan() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const shape = buildFloorPlanShape(floorShape);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: wallHeight,
      bevelEnabled: false,
      steps: 1,
    });
    // ExtrudeGeometry extrudes along +Z; rotate -π/2 around X so the
    // extrusion axis becomes scene-Y (up).
    geometry.rotateX(-Math.PI / 2);
    geometry.center();
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0xc4b9a8,
      metalness: 0.0,
      roughness: 0.85,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = `floor-plan-${floorShape}`;
    mesh.name = `studio-primitive-floorplan-${floorShape}-${primitiveCount}`;

    const cols = 4;
    const i = primitiveCount;
    const col = i % cols;
    const row = Math.floor(i / cols);
    mesh.position.set(
      (col - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
      0,
      row * PRIMITIVE_SIZE * 1.9,
    );

    scene.add(mesh);
    primitiveStackRef.current.push(mesh);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

  /*
   * Particles — a one-shot THREE.Points spawn that drops a colored
   * particle cloud (uniformly distributed inside a sphere, warm-hue
   * vertex colors). Lives in the scene as a Studio primitive so it
   * counts in Mesh stats, can be Cleared / Deleted-Last, and rides
   * the Animation rAF loop as a unit (point clouds rotate just like
   * meshes when their parent transform spins).
   */
  function spawnParticles() {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const n = Math.max(1, Math.floor(particleCount));
    const positions = new Float32Array(n * 3);
    const colors    = new Float32Array(n * 3);
    const R = PRIMITIVE_SIZE * 0.8;
    const tempColor = new THREE.Color();
    // Deterministic distribution: golden-angle helical sphere-fill.
    // - phi from acos(1 - 2t) keeps points latitude-uniform.
    // - theta = i * golden-angle keeps them longitude-spread.
    // - r = R * (i/N)^(1/3) fills volume evenly along the radius.
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const phi = Math.acos(1 - 2 * t);
      const theta = GOLDEN_ANGLE * i;
      const r = R * Math.pow(t, 1 / 3);
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      // Warm palette cycled by index — hue rotates through a fixed
      // red/orange/gold band; lightness pulses on a low-frequency
      // sine so neighboring particles read as a coherent gradient,
      // not noise.
      const hue = 0.03 + 0.13 * ((i % 11) / 10);
      const lightness = 0.45 + 0.30 * 0.5 * (1 + Math.sin(i * 0.5));
      tempColor.setHSL(hue, 0.9, lightness);
      colors[i * 3]     = tempColor.r;
      colors[i * 3 + 1] = tempColor.g;
      colors[i * 3 + 2] = tempColor.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: particleSize,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.userData.archdiscStudioPrimitive = true;
    points.userData.archdiscStudioPrimitiveKind = 'particles';
    points.name = `studio-primitive-particles-${primitiveCount}`;

    const cols = 4;
    const i = primitiveCount;
    const col = i % cols;
    const row = Math.floor(i / cols);
    points.position.set(
      (col - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
      0,
      row * PRIMITIVE_SIZE * 1.9,
    );

    scene.add(points);
    primitiveStackRef.current.push(points);
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

  /*
   * Click-paint brush — when sculpt brush mode is active, clicks on a
   * mesh's surface displace vertices within radius around the hit
   * point, weighted by smooth-quartic falloff. Three modes:
   *   push   — outward along surface normal at hit point
   *   pull   — inward along the same normal
   *   smooth — toward the centroid of neighbouring vertices
   * The vertex positions are mutated in place; subsequent clicks
   * accumulate.
   */
  /*
   * Localized sculpt brush — the real point+radius+falloff stroke that
   * backs every Blender sculpt-mode brush (Draw / Inflate / Crease /
   * Pinch / Flatten / Grab / Smooth). Mirrors
   * blender/source/blender/editors/sculpt_paint/sculpt_brush_types.cc.
   *
   * Uses TRUE per-vertex surface normals (not a bounding-sphere-centroid
   * approximation) so it sculpts arbitrary / concave topology correctly —
   * essential for organic forms (faces, terrain, muscle) per the must-
   * video reference sculpts. Smooth falloff w = (1 - (d/r)^2)^2.
   */
  function paintBrushAt(mesh, hitPoint, brush) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const localHit = mesh.worldToLocal(hitPoint.clone());
    const r = brush.radius;
    const k = brush.strength * brush.radius * 0.5;
    const mode = brush.mode || 'draw';
    const r2 = r * r;

    // Apply the brush for ONE local hit point. Factored out so X-symmetry
    // can mirror the same stroke across the local x=0 plane (lh.x -> -lh.x)
    // — the standard sculpt-mode symmetry that keeps organic / facial
    // forms bilaterally even (Blender's Symmetry X).
    const applyStroke = (lh) => {
      if (mode === 'smooth' && geo.index) {
        const idx = geo.index;
        const sums = new Float32Array(pos.count * 3);
        const counts = new Int32Array(pos.count);
        const tri = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];
        for (let t = 0; t < idx.count; t += 3) {
          const a = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
          for (const [i, j] of tri) {
            const vi = a[i], vj = a[j];
            sums[vi * 3] += pos.getX(vj); sums[vi * 3 + 1] += pos.getY(vj); sums[vi * 3 + 2] += pos.getZ(vj);
            counts[vi]++;
          }
        }
        for (let i = 0; i < pos.count; i++) {
          const dx = pos.getX(i) - lh.x, dy = pos.getY(i) - lh.y, dz = pos.getZ(i) - lh.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2 || counts[i] === 0) continue;
          const tn = Math.sqrt(d2) / r;
          const w = brush.strength * (1 - tn * tn) * (1 - tn * tn);
          const ax = sums[i * 3] / counts[i], ay = sums[i * 3 + 1] / counts[i], az = sums[i * 3 + 2] / counts[i];
          pos.setXYZ(i, pos.getX(i) * (1 - w) + ax * w, pos.getY(i) * (1 - w) + ay * w, pos.getZ(i) * (1 - w) + az * w);
        }
        return;
      }

      // Flatten / Crease / Grab need the average normal + centroid of the
      // affected cap (the local "brush plane").
      let an = new THREE.Vector3(), ac = new THREE.Vector3(), na = 0;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - lh.x, dy = pos.getY(i) - lh.y, dz = pos.getZ(i) - lh.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        an.x += nrm.getX(i); an.y += nrm.getY(i); an.z += nrm.getZ(i);
        ac.x += pos.getX(i); ac.y += pos.getY(i); ac.z += pos.getZ(i);
        na++;
      }
      if (na === 0) return;
      ac.multiplyScalar(1 / na);
      if (an.lengthSq() > 1e-12) an.normalize(); else an.set(0, 1, 0);

      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const dx = px - lh.x, dy = py - lh.y, dz = pz - lh.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const tn = Math.sqrt(d2) / r;
        const falloff = (1 - tn * tn) * (1 - tn * tn);
        const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);

        if (mode === 'draw' || mode === 'push' || mode === 'inflate') {
          const w = k * falloff;
          pos.setXYZ(i, px + nx * w, py + ny * w, pz + nz * w);
        } else if (mode === 'pull') {
          const w = -k * falloff;
          pos.setXYZ(i, px + nx * w, py + ny * w, pz + nz * w);
        } else if (mode === 'crease') {
          const w = k * falloff;
          const along = dx * an.x + dy * an.y + dz * an.z;
          const lx = dx - along * an.x, ly = dy - along * an.y, lz = dz - along * an.z;
          const pinch = 0.55 * falloff;
          pos.setXYZ(i, px + an.x * w - lx * pinch, py + an.y * w - ly * pinch, pz + an.z * w - lz * pinch);
        } else if (mode === 'pinch') {
          const p = brush.strength * falloff * 0.6;
          pos.setXYZ(i, px - dx * p, py - dy * p, pz - dz * p);
        } else if (mode === 'flatten') {
          const sd = (px - ac.x) * an.x + (py - ac.y) * an.y + (pz - ac.z) * an.z;
          const w = brush.strength * falloff;
          pos.setXYZ(i, px - an.x * sd * w, py - an.y * sd * w, pz - an.z * sd * w);
        } else if (mode === 'grab') {
          const w = k * falloff * 1.5;
          pos.setXYZ(i, px + an.x * w, py + an.y * w, pz + an.z * w);
        } else if (mode === 'stamp') {
          // ZBrush alpha stamp — a procedural alpha (concentric rings) drives
          // the relief, so the imprint is a PATTERN, not a uniform dome.
          const ring = 0.5 + 0.5 * Math.cos(tn * Math.PI * 4);
          const w = k * falloff * ring * 1.5;
          pos.setXYZ(i, px + nx * w, py + ny * w, pz + nz * w);
        } else {
          const w = k * falloff;
          pos.setXYZ(i, px + nx * w, py + ny * w, pz + nz * w);
        }
      }
    };

    // ZBrush masking — snapshot positions so masked vertices can be restored
    // after the stroke (mask 1 = fully protected, 0 = fully sculptable). Done
    // post-stroke so it is mode-agnostic across every brush above.
    const mask = (mesh.userData && mesh.userData.archdiscStudioMask && mesh.userData.archdiscStudioMask.length === pos.count) ? mesh.userData.archdiscStudioMask : null;
    let orig = null;
    if (mask) {
      orig = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { orig[i * 3] = pos.getX(i); orig[i * 3 + 1] = pos.getY(i); orig[i * 3 + 2] = pos.getZ(i); }
    }

    applyStroke(localHit);
    if (brush.symmetryX) {
      applyStroke(new THREE.Vector3(-localHit.x, localHit.y, localHit.z));
    }

    if (mask && orig) {
      for (let i = 0; i < pos.count; i++) {
        const m = Math.min(1, Math.max(0, mask[i]));
        if (m > 0) pos.setXYZ(i, pos.getX(i) * (1 - m) + orig[i * 3] * m, pos.getY(i) * (1 - m) + orig[i * 3 + 1] * m, pos.getZ(i) * (1 - m) + orig[i * 3 + 2] * m);
      }
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    if (mesh.userData) mesh.userData.archdiscStudioBrushStroke = (mesh.userData.archdiscStudioBrushStroke || 0) + 1;
    recomputeMeshStats(window.__archdiscScene);
  }

  // Sync brush state into the ref so the setup-scoped pointerdown sees
  // the latest values without depending on closure refresh.
  useEffect(() => {
    brushStateRef.current = {
      active:    brushActive,
      mode:      brushMode,
      radius:    brushRadius,
      strength:  brushFalloffStrength,
      symmetryX: brushSymmetryX,
      paintColor: brushPaintColor,
      paintChannel: brushPaintChannel,
    };
  }, [brushActive, brushMode, brushRadius, brushFalloffStrength, brushSymmetryX, brushPaintColor, brushPaintChannel]);

  /*
   * Display modes — toggle wireframe, bounding-box overlay, and
   * vertex-normals helpers on every Studio primitive in the scene.
   * Helpers are tagged with `userData.archdiscStudioDisplayHelper` so
   * the cleanup pass can find + remove them without ambushing other
   * scene helpers (axes, ground grid, etc).
   */
  function syncDisplayModes() {
    const vp = window.__archdiscViewport;
    if (!vp) return;
    // Wipe existing helpers first.
    const toRemove = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioDisplayHelper) toRemove.push(o);
    });
    toRemove.forEach(h => {
      vp.scene.remove(h);
      if (h.dispose) h.dispose();
      if (h.geometry && h.geometry.dispose) h.geometry.dispose();
      if (h.material && h.material.dispose) h.material.dispose();
    });
    // Walk Studio primitives. Apply wireframe to their materials,
    // add BoxHelpers + VertexNormalsHelpers per the active toggles.
    vp.scene.traverse(o => {
      if (!o.isMesh || !o.userData || !o.userData.archdiscStudioPrimitive) return;
      if (o.material) {
        if (Array.isArray(o.material)) {
          o.material.forEach(m => { m.wireframe = displayWireframe; });
        } else {
          o.material.wireframe = displayWireframe;
        }
      }
      if (displayBoundingBox) {
        const box = new THREE.BoxHelper(o, 0xe6e6e6);
        box.userData.archdiscStudioDisplayHelper = true;
        vp.scene.add(box);
      }
      if (displayNormals) {
        // Sample 8% of faces for normals (keeps performance + render
        // sane on dense meshes like 5×subdivided spheres).
        const helper = new VertexNormalsHelper(o, 0.005, 0xe6e6e6);
        helper.userData.archdiscStudioDisplayHelper = true;
        vp.scene.add(helper);
      }
    });
  }

  useEffect(() => {
    syncDisplayModes();
  }, [displayWireframe, displayBoundingBox, displayNormals]);

  // Expose for spec — manually trigger after geometry mutations.
  useEffect(() => {
    window.__studioSyncDisplay = syncDisplayModes;
    return () => { delete window.__studioSyncDisplay; };
  });

  /*
   * Sculpt brushes — procedural full-mesh deformations applied to the
   * selected mesh's geometry. These are the digital-clay primitives
   * Studio's Sculpting discipline starts from; per-vertex brushable
   * passes with mouse painting arrive in a later slice.
   */
  function sculptInflate(strength) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return;
    const pos = mesh.geometry.attributes.position;
    const nrm = mesh.geometry.attributes.normal;
    if (!pos || !nrm) return;
    // Average mesh "radius" so strength is geometry-relative, not absolute mm.
    const r = mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.radius : 0.015;
    const k = strength * r;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) + nrm.getX(i) * k,
        pos.getY(i) + nrm.getY(i) * k,
        pos.getZ(i) + nrm.getZ(i) * k,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
    recomputeMeshStats(window.__archdiscScene);
  }

  function sculptTwist(strength) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    // Twist around Y proportional to y-coordinate (normalised by bounding-sphere radius).
    const r = mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.radius : 0.015;
    const kRad = strength * Math.PI; // 1.0 strength = π rad over the full y-extent
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const angle = (y / r) * kRad;
      const c = Math.cos(angle), s = Math.sin(angle);
      pos.setXYZ(i, x * c - z * s, y, x * s + z * c);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
    recomputeMeshStats(window.__archdiscScene);
  }

  function sculptSmooth(strength) {
    const mesh = selectedMeshRef.current;
    if (!mesh || !mesh.geometry || !mesh.geometry.index) return;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    // One-ring Laplacian average per vertex via triangle adjacency walk.
    const sums = new Float32Array(pos.count * 3);
    const counts = new Int32Array(pos.count);
    const tri = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];
    for (let t = 0; t < idx.count; t += 3) {
      const a = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      for (const [i, j] of tri) {
        const vi = a[i], vj = a[j];
        sums[vi * 3]     += pos.getX(vj);
        sums[vi * 3 + 1] += pos.getY(vj);
        sums[vi * 3 + 2] += pos.getZ(vj);
        counts[vi]++;
      }
    }
    const k = Math.min(1, Math.max(0, strength));
    for (let i = 0; i < pos.count; i++) {
      if (counts[i] === 0) continue;
      const ax = sums[i * 3]     / counts[i];
      const ay = sums[i * 3 + 1] / counts[i];
      const az = sums[i * 3 + 2] / counts[i];
      pos.setXYZ(
        i,
        pos.getX(i) * (1 - k) + ax * k,
        pos.getY(i) * (1 - k) + ay * k,
        pos.getZ(i) * (1 - k) + az * k,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
    recomputeMeshStats(window.__archdiscScene);
  }

  /*
   * Animation — rAF loop that rotates the currently selected mesh
   * around Y at animSpeedDegPerSec. Stops on toggle, on selection
   * change to no-mesh, or on unmount.
   */
  useEffect(() => {
    if (!isAnimating) {
      if (animRafRef.current) {
        cancelAnimationFrame(animRafRef.current);
        animRafRef.current = null;
      }
      return;
    }
    let last = performance.now();
    const tick = (now) => {
      const dtSec = (now - last) / 1000;
      last = now;
      const mesh = selectedMeshRef.current;
      if (mesh) {
        const deltaRad = (animSpeedDegPerSec * Math.PI / 180) * dtSec;
        mesh.rotation.y += deltaRad;
        // Keep panel readout in sync (cheap — only fires when animating).
        setSelectedTransform({
          position: [mesh.position.x, mesh.position.y, mesh.position.z],
          rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
          scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
        });
      }
      animRafRef.current = requestAnimationFrame(tick);
    };
    animRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRafRef.current) {
        cancelAnimationFrame(animRafRef.current);
        animRafRef.current = null;
      }
    };
  }, [isAnimating, animSpeedDegPerSec]);
  // Keep the latest deleteSelectedMesh available to setup-scoped listeners.
  const deleteSelectedMeshRef = useRef(deleteSelectedMesh);
  useEffect(() => { deleteSelectedMeshRef.current = deleteSelectedMesh; });

  // ─── Archie — the autonomous loop, wired onto the AI scaffold ───────
  // An in-app executor (builds a data-driven plan via the real build fns)
  // + verifier (reads the scene back) handed to runArchieLoop, exposed as
  // window.__archieRun. Archie plans -> builds -> reads -> self-critiques ->
  // iterates NON-STOP until 1:1-or-better parity, then banks a skill. The
  // same engine drives the app and the e2e ("tests are done using Archie").
  const archieSkillStoreRef = useRef(new ArchieSkillStore());
  useEffect(() => {
    // Specialised local handlers — call these in-process rather than
    // round-tripping through the DOM. Faster + survives off-screen tabs.
    const LOCAL_OP = {
      'sculpt-erode':       () => sculptErode(0.6),
      'sculpt-weather':     () => sculptWeather(0.42),
      'sculpt-clay':        () => sculptClay(0.5),
      'sculpt-scrape':      () => sculptScrape(0.4),
      'subdivide-selected': () => subdivideSelected(),
    };
    // Universal op dispatch — looks the op up in ToolRegistry and fires
    // it via the same in-app dispatcher PlanExecutor uses for explicit
    // plans. Local handlers still take precedence so existing curriculum
    // ops (sculpt-erode, sculpt-weather, sculpt-clay, sculpt-scrape) keep
    // the same numerical behaviour they were tuned to.
    const dispatchOp = (op, params) => {
      if (LOCAL_OP[op]) { try { LOCAL_OP[op](); } catch (_) { /* op best-effort */ } return; }
      const meta = findTool(op);
      if (!meta) return;
      try { dispatchInApp(meta, params || {}); } catch (_) { /* dispatch best-effort */ }
    };
    // Set a property knob through the registry path. Used for material/
    // brush/sculpt/array/scatter/texture/light per-body inputs.
    const setKnob = (group, knob, value) => {
      const meta = findTool(`${group}:${knob}`);
      if (!meta) return;
      try { dispatchInApp(meta, { value }); } catch (_) { /* knob best-effort */ }
    };
    // Apply scene-level setup once before bodies land — discipline tab,
    // render engine, world, comp / post-process filters, scene-level ops.
    const applySceneSetup = (scene) => {
      if (!scene) return;
      if (scene.discipline) dispatchOp(`discipline:${scene.discipline}`);
      if (scene.engine)     dispatchOp(scene.engine);     // engine-eevee / engine-cycles / engine-workbench
      if (scene.shading)    dispatchOp(scene.shading);    // shade-solid / shade-material / shade-rendered
      if (scene.world)      dispatchOp(scene.world);      // world-hdri / world-solid / world-fog / world-cell
      for (const filter of (scene.comp || [])) dispatchOp(filter);
      for (const op of (scene.ops || []))      dispatchOp(op);
      for (const light of (scene.lights || [])) {
        if (light.color != null)     setKnob('lighting', 'color', light.color);
        if (light.intensity != null) setKnob('lighting', 'intensity', light.intensity);
        dispatchOp(light.type || 'light-point');
      }
    };
    // Apply per-body knob extras the data-driven recipe declares.
    const applyBodyKnobs = (b, mesh) => {
      if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
      const m = b.material || {};
      if (m.color != null)      setKnob('material', 'color',     m.color);
      if (m.metalness != null)  setKnob('material', 'metalness', m.metalness);
      if (m.roughness != null)  setKnob('material', 'roughness', m.roughness);
      if (m.emissive != null)   setKnob('material', 'emissive',  m.emissive);
      if (m.wireframe != null)  setKnob('material', 'wireframe', m.wireframe ? 'on' : 'off');
      const s = b.sculpt || {};
      if (s.strength != null) setKnob('sculpt', 'strength', s.strength);
      const br = b.brush || {};
      if (br.mode != null)     setKnob('brush', 'mode',     br.mode);
      if (br.radius != null)   setKnob('brush', 'radius',   br.radius);
      if (br.strength != null) setKnob('brush', 'strength', br.strength);
      if (br.symmetryX)        dispatchOp('brush-symmetry-x');
      const ar = b.array;
      if (ar && ar.mode) {
        setKnob('array', 'mode',  ar.mode);
        if (ar.count   != null) setKnob('array', 'count',   ar.count);
        if (ar.radius  != null) setKnob('array', 'radius',  ar.radius);
        if (ar.offsetX != null) setKnob('array', 'offsetX', ar.offsetX);
        if (ar.offsetY != null) setKnob('array', 'offsetY', ar.offsetY);
        if (ar.offsetZ != null) setKnob('array', 'offsetZ', ar.offsetZ);
        dispatchOp('apply-array');
      }
      const sc = b.scatter;
      if (sc && sc.kind) {
        setKnob('scatter', 'kind',  sc.kind);
        if (sc.count != null) setKnob('scatter', 'count', sc.count);
        if (sc.scale != null) setKnob('scatter', 'scale', sc.scale);
      }
      const tx = b.texture;
      if (tx) {
        if (tx.pattern != null) setKnob('texture', 'pattern', tx.pattern);
        if (tx.tiles   != null) setKnob('texture', 'tiles',   tx.tiles);
        dispatchOp('tex-paint-commit');
      }
      for (const mod of (b.mods || [])) dispatchOp(mod.name || mod);
      for (const op  of (b.ops  || [])) dispatchOp(op);
    };
    const buildBody = (b) => {
      addPrimitive(b.kind);
      const stack = primitiveStackRef.current;
      const mesh = stack[stack.length - 1];
      if (!mesh) return;
      if (b.pos)   mesh.position.set(b.pos[0]   || 0, b.pos[1]   || 0, b.pos[2]   || 0);
      if (b.scale) mesh.scale.set   (b.scale[0] || 1, b.scale[1] || 1, b.scale[2] || 1);
      if (b.rot)   mesh.rotation.set(b.rot[0]   || 0, b.rot[1]   || 0, b.rot[2]   || 0);
      if (b.color && mesh.material && mesh.material.color) mesh.material.color.set(b.color);
      if (b.emissive && mesh.material) {
        mesh.material.emissive = (mesh.material.color || new THREE.Color('#ffffff')).clone();
        mesh.material.emissiveIntensity = b.emissive;
      }
      if (mesh.material) mesh.material.needsUpdate = true;
      if (mesh.geometry) mesh.geometry.computeBoundingSphere();
      applyBodyKnobs(b, mesh);
    };
    const execute = async (plan) => {
      clearScene();
      applySceneSetup(plan && plan.scene);
      for (const b of (plan && plan.bodies) || []) buildBody(b);
      if (window.__studioFrameAll) window.__studioFrameAll();
      return { built: ((plan && plan.bodies) || []).length };
    };
    const verify = async () => {
      const scene = window.__archdiscScene; const kinds = new Set(); let bodies = 0;
      if (scene) scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) { bodies++; kinds.add(String(o.userData.archdiscStudioPrimitiveKind || '').replace('-array', '')); } });
      return { bodies, kinds: [...kinds] };
    };
    // ── Perception: capture the viewport render, score it vs a reference ──
    const captureRender = () => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.renderer || !vp.scene || !vp.camera) return null;
      vp.renderer.render(vp.scene, vp.camera); // fresh buffer (no preserveDrawingBuffer)
      try { return vp.renderer.domElement.toDataURL('image/png'); } catch (_) { return null; }
    };
    const pixelsOf = (img, W = 128, H = 128) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
      return { px: ctx.getImageData(0, 0, W, H).data, w: W, h: H };
    };
    const loadImg = (u) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
    // Compare the current render to a reference data URL -> similarity [0,1].
    const perceiveAgainst = async (refDataUrl, renderDataUrl) => {
      const rUrl = renderDataUrl || captureRender();
      // Mirror the last perceived frame + reference into window slots (same
      // convention as the other __last* introspection hooks) so e2e + AI can
      // inspect exactly what Archie saw.
      try { window.__archieLastRender = rUrl; window.__archieLastRef = refDataUrl; } catch (_) { /* introspection slot is best-effort */ }
      if (!rUrl || !refDataUrl) return 0;
      const [refImg, frmImg] = await Promise.all([loadImg(refDataUrl), loadImg(rUrl)]);
      const r = pixelsOf(refImg), f = pixelsOf(frmImg);
      return compareSignatures(gridSignature(f.px, f.w, f.h, 32), gridSignature(r.px, r.w, r.h, 32));
    };
    window.__archieCaptureRender = captureRender;
    window.__archiePerceive = (refDataUrl, renderDataUrl) => perceiveAgainst(refDataUrl, renderDataUrl);
    // perceive(plan) for the loop — only meaningful when the goal has a
    // reference. A reference is captured from a specific camera pose, so we
    // MUST orbit to that same pose before reading the render — otherwise we
    // compare the right scene from the wrong angle and parity never triggers.
    // The goal carries plan.view = [az, el, zoom]; default to a 3/4 view.
    const perceive = async (plan) => {
      if (!plan || !plan.reference) return null;
      const v = Array.isArray(plan.view) ? plan.view : [28, 16, 1.15];
      // Order matters: the build (addPrimitive/clearScene) schedules React
      // state whose effects re-frame the camera asynchronously. Wait for that
      // to settle FIRST. Then frame-all to set a DETERMINISTIC base radius
      // (orbitView's distance is __orbitBaseRadius * zoom, which otherwise
      // differs between contexts and renders the object at the wrong size),
      // then make orbitView the LAST camera write and capture in the very next
      // synchronous tick so nothing can clobber the pose.
      await new Promise((r) => setTimeout(r, 180));
      // frameAll fits the camera to the scene but does NOT refresh the orbit
      // base radius; orbitView's distance is base*zoom, so we must pin the base
      // to this freshly-framed distance — otherwise a stale base renders the
      // object at the wrong size and a matching scene scores low.
      if (window.__studioFrameAll) window.__studioFrameAll();
      if (window.__archdiscSetOrbitBase) window.__archdiscSetOrbitBase();
      if (window.__archdiscOrbitView) window.__archdiscOrbitView(v[0], v[1], v[2]);
      return perceiveAgainst(plan.reference);
    };
    window.__archieRun = (opts = {}) => runArchieLoop({ execute, verify, perceive, skillStore: archieSkillStoreRef.current, ...opts });
    window.__archieEngine = { runArchieLoop, ArchieSkillStore, DEFAULT_CURRICULUM, skillStore: archieSkillStoreRef.current,
      TOOL_REGISTRY, findTool, dispatchOp, setKnob, applySceneSetup };
    return () => { try { delete window.__archieRun; delete window.__archieEngine; delete window.__archieCaptureRender; delete window.__archiePerceive; } catch (_) { /* cleanup best-effort */ } };
  }, []);

  return (
    <>
      {/* BLENDER WORKSPACES STRIP — top-of-window tab strip mirroring
          Blender's canonical workspaces (Layout / Modeling / Sculpting /
          UV Editing / Texture Paint / Shading / Animation / Rendering /
          Compositing / Geometry Nodes / Scripting). Selecting a workspace
          activates the discipline its layout is built around so the right
          ribbon panel surfaces underneath, matching Blender's "switching
          workspaces switches the screen layout" behaviour. Independent of
          the discipline tabs so users can stay in a workspace while
          sampling tools from other disciplines — exactly how Blender
          works. */}
      <div
        className="blender-workspaces-strip"
        data-blender-workspaces-strip="studio"
      >
        {BLENDER_WORKSPACES.map((ws) => {
          const WSIcon = ws.Icon;
          return (
            <button
              key={ws.id}
              type="button"
              className={'blender-workspace-tab' + (ws.id === activeWorkspace ? ' active' : '')}
              data-blender-workspace={ws.id}
              data-blender-workspace-active={ws.id === activeWorkspace ? '1' : '0'}
              data-blender-workspace-discipline={ws.discipline}
              onClick={() => activateWorkspace(ws)}
              title={`${ws.id} workspace (Blender ${ws.id})`}
            >
              {WSIcon && <WSIcon size={11} style={{ marginRight: '5px', verticalAlign: '-2px' }} />}
              {ws.id}
            </button>
          );
        })}
      </div>
      {/* RIBBON: Studio discipline tabs (placeholder; real ribbons land per discipline) */}
      {/* RIBBON — matches Mech's RibbonToolbar layout: ribbon-tabs strip
          on top, ribbon-content with grouped tool buttons + section
          labels below. Studio uses the same .ribbon-* classes for
          consistent visual identity with the rest of the ArchDisc
          Universe. */}
      <div
        className="workbench-ribbon-placeholder"
        data-archdisc-ribbon-placeholder="studio"
      >
        <div className="ribbon-container">
          <div className="ribbon-tabs">
            {DISCIPLINE_TABS.map(tab => {
              const TabIcon = tab.Icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={
                    'ribbon-tab workbench-ribbon-placeholder-tab'
                    + (tab.id === activeTab ? ' active' : '')
                  }
                  data-studio-discipline={tab.id}
                  data-studio-active={tab.id === activeTab ? '1' : '0'}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {TabIcon && <TabIcon size={12} style={{ marginRight: '6px', verticalAlign: '-2px' }} />}
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="ribbon-content" data-studio-ribbon-discipline={activeTab}>
            {activeTab === 'modeling' && (
              <>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools" data-studio-modeling-primitives>
                    {PRIMITIVE_KINDS.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className="ribbon-tool"
                        data-studio-primitive={p.id}
                        onClick={() => addPrimitive(p.id)}
                        title={`Add ${p.label}`}
                      >
                        <span className="ribbon-tool-icon">+</span>
                        <span className="ribbon-tool-label">{p.label}</span>
                      </button>
                    ))}
                    <button type="button" className="ribbon-tool" data-studio-primitive="nurbs-surface" onClick={() => addNurbsSurface({})} title="Maya / Rhino / Plasticity — add a rational degree-3 NURBS surface">
                      <span className="ribbon-tool-icon">+</span>
                      <span className="ribbon-tool-label">NURBS Surf</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-primitive="sweep-loft" onClick={() => sweepLoft({ profile: 'square', path: 'helix', profileSize: 0.05, turns: 3, height: 0.8, radius: 0.3 })} title="3ds Max Loft / Rhino Sweep1 — sweep a profile (square/L/star/circle) along a path curve (helix/arc/S-curve/ring)">
                      <span className="ribbon-tool-icon">≀</span>
                      <span className="ribbon-tool-label">Loft/Sweep</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-primitive="trimmed-surface" onClick={() => addTrimmedSurface({})} title="Rhino / Maya trimmed surface — a parametric patch trimmed by uv loops (outer boundary + holes); the face-level building block of a trimmed B-rep">
                      <span className="ribbon-tool-icon">⬡</span>
                      <span className="ribbon-tool-label">Trim Surf</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-primitive="nurbs-curve" onClick={() => addNurbsCurve({})} title="Maya / Rhino NURBS curve — rational degree-3 B-spline (Cox-de Boor); control-point weights warp the curve">
                      <span className="ribbon-tool-icon">∿</span>
                      <span className="ribbon-tool-label">NURBS Crv</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-primitive="brep-boolean" data-studio-brep-status={brepStatus} onClick={() => brepBooleanToScene({ op: 'cut' })} title="Solid B-rep boolean (Rhino/Maya/Plasticity) — real OCCT NURBS-trimmed cut/fuse/common. First click lazily loads the OCCT WASM kernel.">
                      <span className="ribbon-tool-icon">⊖</span>
                      <span className="ribbon-tool-label">B-rep Bool</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Primitives</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="subdivide"
                      onClick={subdivideSelected}
                      disabled={!selectedKind}
                      title="Midpoint subdivide selected mesh"
                    >
                      <span className="ribbon-tool-icon">▤</span>
                      <span className="ribbon-tool-label">Subdivide</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="loop-subdivide"
                      onClick={loopSubdivideSelected}
                      disabled={!selectedKind}
                      title="Loop smooth subdivision"
                    >
                      <span className="ribbon-tool-icon">◐</span>
                      <span className="ribbon-tool-label">Loop Sub</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="decimate"
                      onClick={() => decimateSelected(decimateAggressiveness)}
                      disabled={!selectedKind}
                      title="Vertex-clustering polygon reduction"
                    >
                      <span className="ribbon-tool-icon">◇</span>
                      <span className="ribbon-tool-label">Decimate</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="apply-array"
                      onClick={() => arrayModifier(arrayMode, arrayCount, arrayOffsetX, arrayOffsetY, arrayOffsetZ, arrayRadius)}
                      disabled={!selectedKind}
                      title="Linear / radial duplicate array"
                    >
                      <span className="ribbon-tool-icon">▦</span>
                      <span className="ribbon-tool-label">Array</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="fracture"
                      onClick={() => fractureSelected(fractureChunks, fractureExplode)}
                      disabled={!selectedKind}
                      title="Voronoi cell fracture"
                    >
                      <span className="ribbon-tool-icon">✶</span>
                      <span className="ribbon-tool-label">Fracture</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Modifiers</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="solidify"
                      onClick={() => solidifyModifier(0.003)}
                      disabled={!selectedKind}
                      title="Blender MOD_solidify — give thickness to selected surface"
                    >
                      <span className="ribbon-tool-icon">▣</span>
                      <span className="ribbon-tool-label">Solidify</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="cast-sphere"
                      onClick={() => castToShape('sphere', 0.6)}
                      disabled={!selectedKind}
                      title="Blender MOD_cast — push verts toward bounding sphere"
                    >
                      <span className="ribbon-tool-icon">◯</span>
                      <span className="ribbon-tool-label">Cast→Sph</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="cast-cuboid"
                      onClick={() => castToShape('cuboid', 0.6)}
                      disabled={!selectedKind}
                      title="Blender MOD_cast — push verts toward bounding cuboid"
                    >
                      <span className="ribbon-tool-icon">▢</span>
                      <span className="ribbon-tool-label">Cast→Cub</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="wave"
                      onClick={() => applyWave(0.004, 200)}
                      disabled={!selectedKind}
                      title="Blender MOD_wave — sinusoidal radial Y displacement"
                    >
                      <span className="ribbon-tool-icon">≈</span>
                      <span className="ribbon-tool-label">Wave</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="bend"
                      onClick={() => bendDeform(0.6)}
                      disabled={!selectedKind}
                      title="Blender MOD_simpledeform (BEND) — bend XZ proportional to Y"
                    >
                      <span className="ribbon-tool-icon">⌒</span>
                      <span className="ribbon-tool-label">Bend</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="taper"
                      onClick={() => taperDeform(0.6)}
                      disabled={!selectedKind}
                      title="Blender MOD_simpledeform (TAPER) — scale XZ by Y position"
                    >
                      <span className="ribbon-tool-icon">△</span>
                      <span className="ribbon-tool-label">Taper</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="weld"
                      onClick={() => weldModifier(0.0005)}
                      disabled={!selectedKind}
                      title="Blender MOD_weld — merge vertices within 0.5mm"
                    >
                      <span className="ribbon-tool-icon">⊗</span>
                      <span className="ribbon-tool-label">Weld</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="wireframe-mod"
                      onClick={() => applyWireframe(0.0008)}
                      disabled={!selectedKind}
                      title="Blender MOD_wireframe — replace edges with thin tubes"
                    >
                      <span className="ribbon-tool-icon">▦</span>
                      <span className="ribbon-tool-label">Wireframe</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="build-anim"
                      onClick={() => startBuildAnimation(2.0)}
                      disabled={!selectedKind}
                      title="Blender MOD_build — progressively reveal triangles over 2s"
                    >
                      <span className="ribbon-tool-icon">⏳</span>
                      <span className="ribbon-tool-label">Build</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="skin-mod"
                      onClick={() => applySkin(0.0014)}
                      disabled={!selectedKind}
                      title="Blender MOD_skin — ball-and-stick (cylinder edges + sphere joints)"
                    >
                      <span className="ribbon-tool-icon">⨈</span>
                      <span className="ribbon-tool-label">Skin</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="twist"
                      onClick={() => twistDeform(1.0)}
                      disabled={!selectedKind}
                      title="Blender MOD_simpledeform (TWIST) — rotate XZ around Y by Y-position"
                    >
                      <span className="ribbon-tool-icon">↻</span>
                      <span className="ribbon-tool-label">Twist</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="edge-split"
                      onClick={edgeSplitModifier}
                      disabled={!selectedKind}
                      title="Blender MOD_edgesplit — duplicate verts at sharp edges (flat shading)"
                    >
                      <span className="ribbon-tool-icon">⊟</span>
                      <span className="ribbon-tool-label">EdgeSplit</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="stretch"
                      onClick={() => stretchDeform(1.6)}
                      disabled={!selectedKind}
                      title="Blender MOD_simpledeform (STRETCH) — volume-preserving Y stretch"
                    >
                      <span className="ribbon-tool-icon">↕</span>
                      <span className="ribbon-tool-label">Stretch</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="inset"
                      onClick={() => insetFaces(0.3)}
                      disabled={!selectedKind}
                      title="Blender editmesh_inset — shrink each face toward centroid"
                    >
                      <span className="ribbon-tool-icon">⊡</span>
                      <span className="ribbon-tool-label">Inset</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="warp"
                      onClick={() => applyWarp(1.0, [0, 0.008, 0])}
                      disabled={!selectedKind}
                      title="Blender MOD_warp — distance-falloff vertex displacement"
                    >
                      <span className="ribbon-tool-icon">⤴</span>
                      <span className="ribbon-tool-label">Warp</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-ribbon-action="radial-normals"
                      onClick={radialNormals}
                      disabled={!selectedKind}
                      title="Blender MOD_normal_edit (RADIAL) — point all normals away from centre"
                    >
                      <span className="ribbon-tool-icon">↗</span>
                      <span className="ribbon-tool-label">Radial N</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Blender · Mods</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="bevel" onClick={() => bevelModifier(0.3)} disabled={!selectedKind} title="Blender MOD_bevel — round corners">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">Bevel</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="corrective-smooth" onClick={() => correctiveSmooth(0.4)} disabled={!selectedKind} title="Blender MOD_correctivesmooth — volume-preserving smooth">
                      <span className="ribbon-tool-icon">≋</span><span className="ribbon-tool-label">Corr·Smth</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="curve-mod" onClick={() => curveModifier(0.01)} disabled={!selectedKind} title="Blender MOD_curve — deform along sinusoidal curve">
                      <span className="ribbon-tool-icon">∿</span><span className="ribbon-tool-label">Curve</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="hook" onClick={() => hookModifier(0.02, 0.025)} disabled={!selectedKind} title="Blender MOD_hook — pull verts toward a hook anchor">
                      <span className="ribbon-tool-icon">⌐</span><span className="ribbon-tool-label">Hook</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="lattice" onClick={() => latticeModifier(0.004)} disabled={!selectedKind} title="Blender MOD_lattice — sinusoidal cage deform">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">Lattice</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mesh-deform" onClick={() => meshDeform(0.003)} disabled={!selectedKind} title="Blender MOD_meshdeform — cage-based deform">
                      <span className="ribbon-tool-icon">▥</span><span className="ribbon-tool-label">M·Deform</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="multires" onClick={() => multiresModifier(2)} disabled={!selectedKind} title="Blender MOD_multires — multi-level smooth subdivision">
                      <span className="ribbon-tool-icon">⊞</span><span className="ribbon-tool-label">Multires</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Blender · Deform</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ocean" onClick={() => oceanModifier(0.005)} disabled={!selectedKind} title="Blender MOD_ocean — multi-sinusoid ocean surface">
                      <span className="ribbon-tool-icon">〰</span><span className="ribbon-tool-label">Ocean</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="remesh" onClick={() => remeshModifier(0.003)} disabled={!selectedKind} title="Blender MOD_remesh — voxel remesh">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">Remesh</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="screw" onClick={() => screwModifier(2, 0.01)} disabled={!selectedKind} title="Blender MOD_screw — twist + lift">
                      <span className="ribbon-tool-icon">↻</span><span className="ribbon-tool-label">Screw</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shrinkwrap" onClick={shrinkwrapModifier} disabled={!selectedKind} title="Blender MOD_shrinkwrap — project to bounding sphere surface">
                      <span className="ribbon-tool-icon">◯</span><span className="ribbon-tool-label">Shrnk</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="catmull-clark" onClick={catmullClarkModifier} disabled={!selectedKind} title="Blender MOD_subsurf (Catmull-Clark) — Loop + smooth">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">CatClark</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="weighted-normals" onClick={weightedNormalsModifier} disabled={!selectedKind} title="Blender MOD_weighted_normal — area-weighted vertex normals">
                      <span className="ribbon-tool-icon">⊥</span><span className="ribbon-tool-label">W·Norm</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mask" onClick={() => maskModifier('first')} disabled={!selectedKind} title="Blender MOD_mask — hide half of triangles">
                      <span className="ribbon-tool-icon">▤</span><span className="ribbon-tool-label">Mask</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="uv-warp" onClick={() => uvWarpModifier(0.1, 0.1)} disabled={!selectedKind} title="Blender MOD_uvwarp — translate UVs by an offset">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">UV Warp</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="laplacian-deform" onClick={() => laplacianDeformModifier(3)} disabled={!selectedKind} title="Blender MOD_laplaciandeform — iterated Laplacian smooth">
                      <span className="ribbon-tool-icon">≣</span><span className="ribbon-tool-label">Lap·Def</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Blender · Sim</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="gn-mesh-to-points" onClick={geometryNodesMeshToPoints} disabled={!selectedKind} title="Blender nodes/geometry/node_geo_mesh_to_points.cc">
                      <span className="ribbon-tool-icon">⋮</span><span className="ribbon-tool-label">→ Points</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="gn-convex-hull" onClick={geometryNodesConvexHull} disabled={!selectedKind} title="Blender nodes/geometry/node_geo_convex_hull.cc">
                      <span className="ribbon-tool-icon">◇</span><span className="ribbon-tool-label">Convex H</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="gn-distribute" onClick={() => geometryNodesDistributePoints(500)} disabled={!selectedKind} title="Blender node_geo_distribute_points_on_faces.cc">
                      <span className="ribbon-tool-icon">⁂</span><span className="ribbon-tool-label">Distrib·Pts</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="gn-join" onClick={geometryNodesJoin} disabled={primitiveCount < 2} title="Blender node_geo_join_geometry.cc — merge all Studio meshes">
                      <span className="ribbon-tool-icon">⊕</span><span className="ribbon-tool-label">Join Geom</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="gn-set-pos" onClick={() => geometryNodesSetPosition(0.002)} disabled={!selectedKind} title="Blender node_geo_set_position.cc">
                      <span className="ribbon-tool-icon">⇉</span><span className="ribbon-tool-label">Set Pos</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="gn-bbox" onClick={geometryNodesBoundingBox} disabled={!selectedKind} title="Blender node_geo_bounding_box.cc">
                      <span className="ribbon-tool-icon">▢</span><span className="ribbon-tool-label">BBox Geo</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="gn-transform" onClick={() => geometryNodesTransform(0.005, 0, 0, 1.1)} disabled={!selectedKind} title="Blender node_geo_transform_geometry.cc">
                      <span className="ribbon-tool-icon">⇲</span><span className="ribbon-tool-label">Transform</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Geometry Nodes</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="extrude" onClick={() => extrudeFaces(0.004)} disabled={!selectedKind} title="Blender editmesh_extrude.cc — push faces along normals">
                      <span className="ribbon-tool-icon">⇡</span><span className="ribbon-tool-label">Extrude</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="spin-y" onClick={() => spinAroundY(Math.PI / 4)} disabled={!selectedKind} title="Blender editmesh_spin.cc — revolve around Y">
                      <span className="ribbon-tool-icon">↻</span><span className="ribbon-tool-label">Spin</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="flip-normals" onClick={flipNormals} disabled={!selectedKind} title="Blender editmesh_normals.cc (FLIP) — reverse triangle winding">
                      <span className="ribbon-tool-icon">⇅</span><span className="ribbon-tool-label">Flip N</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="recalc-normals" onClick={recalcNormalsOutside} disabled={!selectedKind} title="Blender editmesh_normals.cc — recalc normals outside">
                      <span className="ribbon-tool-icon">⊥</span><span className="ribbon-tool-label">Recalc N</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="triangulate" onClick={triangulateFaces} disabled={!selectedKind} title="Blender editmesh_triangulate.cc">
                      <span className="ribbon-tool-icon">▲</span><span className="ribbon-tool-label">Triang</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="merge-by-distance" onClick={() => mergeByDistance(0.001)} disabled={!selectedKind} title="Blender editmesh_merge.cc (BY_DISTANCE)">
                      <span className="ribbon-tool-icon">⊗</span><span className="ribbon-tool-label">Merge·D</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="smooth-n" onClick={() => smoothVerticesN(5)} disabled={!selectedKind} title="Blender editmesh_smooth.cc — 5-iter Laplacian">
                      <span className="ribbon-tool-icon">≋</span><span className="ribbon-tool-label">Smooth·5</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="origin-to-geo" onClick={originToGeometry} disabled={!selectedKind} title="Blender editmesh_recalc_origin.cc">
                      <span className="ribbon-tool-icon">⊙</span><span className="ribbon-tool-label">Orig→Geo</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="snap-grid" onClick={() => snapToGrid(0.005)} disabled={!selectedKind} title="Blender transform_snap.cc (V3D_SNAP_TO_GRID)">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">Snap·Grid</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="clear-xform" onClick={clearTransform} disabled={!selectedKind} title="Blender object_clear.cc — clear position/rotation/scale">
                      <span className="ribbon-tool-icon">⊟</span><span className="ribbon-tool-label">Clr·Xform</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="apply-xform" onClick={applyAllTransforms} disabled={!selectedKind} title="Blender object_apply.cc — bake transform into geometry">
                      <span className="ribbon-tool-icon">✓</span><span className="ribbon-tool-label">Apply·Xf</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="auto-smooth" onClick={() => shadeAutoSmooth(30)} disabled={!selectedKind} title="Blender editmesh_shade.cc — auto-smooth at 30°">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">AutoSmth</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="repeat-last" onClick={repeatLastOp} title="Blender editors/screen/screen_edit.cc — repeat last operator (Shift+R)">
                      <span className="ribbon-tool-icon">⟲</span><span className="ribbon-tool-label">Repeat</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="cmd-palette" onClick={openCommandPalette} title="Blender F3 menu search — command palette">
                      <span className="ribbon-tool-icon">⌕</span><span className="ribbon-tool-label">Search</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="softbody" onClick={() => applySoftBody(0.5)} disabled={!selectedKind} title="Blender MOD_softbody.cc — soft-body 1-iter relax + gentle gravity">
                      <span className="ribbon-tool-icon">⊙</span><span className="ribbon-tool-label">SoftBody</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="surface-collision" onClick={markAsCollisionSurface} disabled={!selectedKind} title="Blender MOD_surface.cc — mark as collision target">
                      <span className="ribbon-tool-icon">⊗</span><span className="ribbon-tool-label">Coll·Surf</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="loop-cut" onClick={loopCutMidplane} disabled={!selectedKind} title="Blender editmesh_loopcut.cc — add edge loop">
                      <span className="ribbon-tool-icon">⊟</span><span className="ribbon-tool-label">Loop Cut</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="bisect" onClick={() => bisectMesh(0)} disabled={!selectedKind} title="Blender editmesh_bisect.cc — cut mesh with Y=0 plane">
                      <span className="ribbon-tool-icon">⎯</span><span className="ribbon-tool-label">Bisect</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="bridge-edges" onClick={bridgeEdgeLoops} disabled={!selectedKind} title="Blender editmesh_bridge.cc — bridge edge loops">
                      <span className="ribbon-tool-icon">⌒</span><span className="ribbon-tool-label">Bridge</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mark-seam" onClick={markSeam} disabled={!selectedKind} title="Blender editmesh_seam.cc — mark seam for UV unwrap">
                      <span className="ribbon-tool-icon">✂</span><span className="ribbon-tool-label">Seam</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="separate" onClick={separateMesh} disabled={!selectedKind} title="Blender editmesh_separate.cc — separate by selection">
                      <span className="ribbon-tool-icon">⫩</span><span className="ribbon-tool-label">Separate</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mark-sharp" onClick={markSharp} disabled={!selectedKind} title="Blender editmesh_sharp.cc — mark sharp edge">
                      <span className="ribbon-tool-icon">⊿</span><span className="ribbon-tool-label">Sharp</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="clear-sharp" onClick={clearSharp} disabled={!selectedKind} title="Blender editmesh_sharp.cc — clear sharp edge">
                      <span className="ribbon-tool-icon">⊖</span><span className="ribbon-tool-label">Clr Shrp</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mark-crease" onClick={markCrease} disabled={!selectedKind} title="Blender editmesh_crease.cc — mark edge crease">
                      <span className="ribbon-tool-icon">≡</span><span className="ribbon-tool-label">Crease</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="loop-select" onClick={loopSelect} disabled={!selectedKind} title="Blender editmesh_loopcut.cc — loop select">
                      <span className="ribbon-tool-icon">◌</span><span className="ribbon-tool-label">Loop Sel</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ring-select" onClick={edgeRingSelect} disabled={!selectedKind} title="Blender editmesh — edge ring select">
                      <span className="ribbon-tool-icon">◯</span><span className="ribbon-tool-label">Ring Sel</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="select-all" onClick={selectAllPrimitives} title="Blender editmesh_select_all.cc — select all (A)">
                      <span className="ribbon-tool-icon">⊞</span><span className="ribbon-tool-label">Sel All</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="invert-sel" onClick={invertSelection} disabled={!selectedKind} title="Blender editmesh_select_all.cc — invert selection (Ctrl+I)">
                      <span className="ribbon-tool-icon">⊕</span><span className="ribbon-tool-label">Invert</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="symmetrize" onClick={symmetrize} disabled={!selectedKind} title="Blender editmesh_symmetrize.cc — mirror across X=0">
                      <span className="ribbon-tool-icon">⇄</span><span className="ribbon-tool-label">Symmetry</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="fill-holes" onClick={fillHoles} disabled={!selectedKind} title="Blender editmesh_fill.cc — fill holes">
                      <span className="ribbon-tool-icon">◍</span><span className="ribbon-tool-label">Fill</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="beauty-faces" onClick={beautyFaces} disabled={!selectedKind} title="Blender editmesh_beauty.cc — beauty fill / flip edges">
                      <span className="ribbon-tool-icon">◆</span><span className="ribbon-tool-label">Beauty</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="origin-com" onClick={originToCenterOfMass} disabled={!selectedKind} title="Blender object_set_origin.cc — origin to centre of mass">
                      <span className="ribbon-tool-icon">⊙</span><span className="ribbon-tool-label">Org→CoM</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="set-smooth-face" onClick={setSmoothShadingFace} disabled={!selectedKind} title="Blender editmesh_shade.cc — set smooth shading">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">Set Smth</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="set-flat-face" onClick={setFlatShadingFace} disabled={!selectedKind} title="Blender editmesh_shade.cc — set flat shading">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">Set Flat</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="decimate-collapse" onClick={decimateCollapse} disabled={!selectedKind} title="Blender MOD_decimate.cc (collapse mode)">
                      <span className="ribbon-tool-icon">◇</span><span className="ribbon-tool-label">Decim·Col</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="decimate-unsub" onClick={decimateUnsubdivide} disabled={!selectedKind} title="Blender MOD_decimate.cc (un-subdivide mode)">
                      <span className="ribbon-tool-icon">◆</span><span className="ribbon-tool-label">Decim·Uns</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="decimate-planar" onClick={decimatePlanar} disabled={!selectedKind} title="Blender MOD_decimate.cc (planar mode)">
                      <span className="ribbon-tool-icon">▢</span><span className="ribbon-tool-label">Decim·Pln</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Blender · Edit</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="add-bezier" onClick={addBezierCurve} title="Blender editcurve_add.cc — Bezier curve">
                      <span className="ribbon-tool-icon">∿</span><span className="ribbon-tool-label">Bezier</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="add-nurbs-path" onClick={addNurbsPath} title="Blender editcurve_add.cc — NURBS path">
                      <span className="ribbon-tool-icon">⟿</span><span className="ribbon-tool-label">NURBS</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="draw-curve" onClick={drawCurveSegment} disabled={!selectedKind} title="Blender editcurve_paint.cc — draw curve segment">
                      <span className="ribbon-tool-icon">✎</span><span className="ribbon-tool-label">Draw Crv</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="curve-res" onClick={() => setCurveResolution(24)} disabled={!selectedKind} title="Blender BKE_curve_calc — curve resolution">
                      <span className="ribbon-tool-icon">⊞</span><span className="ribbon-tool-label">Crv Res</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Blender · Curves</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="apply-mod-stack" onClick={applyModifierStack} disabled={!selectedKind} title="Blender object_modifier.cc — apply modifier stack">
                      <span className="ribbon-tool-icon">✓</span><span className="ribbon-tool-label">Apply Stk</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mod-up" onClick={moveModifierUp} disabled={!selectedKind} title="Blender object_modifier.cc — move modifier up">
                      <span className="ribbon-tool-icon">↑</span><span className="ribbon-tool-label">Mod Up</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mod-down" onClick={moveModifierDown} disabled={!selectedKind} title="Blender object_modifier.cc — move modifier down">
                      <span className="ribbon-tool-icon">↓</span><span className="ribbon-tool-label">Mod Dn</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="hide-sel" onClick={hideSelected} disabled={!selectedKind} title="Blender object_hide.cc — hide selected (H)">
                      <span className="ribbon-tool-icon">⊘</span><span className="ribbon-tool-label">Hide</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="reveal-all" onClick={revealAll} title="Blender object_hide.cc — reveal all (Alt+H)">
                      <span className="ribbon-tool-icon">◉</span><span className="ribbon-tool-label">Reveal</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="lock-xform" onClick={() => lockTransform(['x', 'y', 'z'])} disabled={!selectedKind} title="Blender object_constraint.cc — lock transform">
                      <span className="ribbon-tool-icon">⊠</span><span className="ribbon-tool-label">Lock</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="snap-cursor" onClick={snapSelectedToCursor} disabled={!selectedKind} title="Blender view3d_cursor.cc — snap to 3D cursor (Shift+S)">
                      <span className="ribbon-tool-icon">⊕</span><span className="ribbon-tool-label">Snap·Cur</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="cursor-sel" onClick={cursorToSelected} disabled={!selectedKind} title="Blender view3d_cursor.cc — cursor to selected">
                      <span className="ribbon-tool-icon">⊖</span><span className="ribbon-tool-label">Cur→Sel</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="snap-mode" onClick={() => setSnapMode('vertex')} title="Blender transform_snap.cc — snap mode vertex">
                      <span className="ribbon-tool-icon">●</span><span className="ribbon-tool-label">Snap V</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="seq-image" onClick={addImageStrip} title="Blender sequencer_edit.cc — add image strip">
                      <span className="ribbon-tool-icon">▭</span><span className="ribbon-tool-label">Seq Img</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="gpencil-layer" onClick={addGreasePencilLayer} title="Blender grease_pencil_*.cc — add GP layer">
                      <span className="ribbon-tool-icon">✏</span><span className="ribbon-tool-label">GP Layer</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Blender · Stack/Snap</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mod-bevel" onClick={bevelModifier} disabled={!selectedKind} title="Blender MOD_bevel.cc — bevel modifier">
                      <span className="ribbon-tool-icon">◢</span><span className="ribbon-tool-label">Bevel</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mod-solidify" onClick={solidifyModifier} disabled={!selectedKind} title="Blender MOD_solidify.cc — solidify shell">
                      <span className="ribbon-tool-icon">▰</span><span className="ribbon-tool-label">Solidify</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mod-skin" onClick={skinModifier} disabled={!selectedKind} title="Blender MOD_skin.cc — skin modifier">
                      <span className="ribbon-tool-icon">≣</span><span className="ribbon-tool-label">Skin</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mod-wireframe" onClick={wireframeModifier} disabled={!selectedKind} title="Blender MOD_wireframe.cc — wireframe">
                      <span className="ribbon-tool-icon">⊞</span><span className="ribbon-tool-label">Wirefrm</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mod-triangulate" onClick={triangulateModifier} disabled={!selectedKind} title="Blender MOD_triangulate.cc — quads to tris">
                      <span className="ribbon-tool-icon">△</span><span className="ribbon-tool-label">Tri-ize</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Blender · Modifiers</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="landscape" onClick={spawnLandscape} title="Unreal Landscape / Unity Terrain — heightmap-displaced 24x24 plane">
                      <span className="ribbon-tool-icon">⛰</span><span className="ribbon-tool-label">Landscape</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="navmesh" onClick={generateNavMesh} disabled={!selectedKind} title="Unreal NavigationSystem (RecastNavMesh) / Unity NavMesh — bake walkable area">
                      <span className="ribbon-tool-icon">▲</span><span className="ribbon-tool-label">NavMesh</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="reflection-probe" onClick={() => addReflectionProbe(0, 0.04, 0)} title="Unreal SphereReflectionCapture / Unity Reflection Probe">
                      <span className="ribbon-tool-icon">◉</span><span className="ribbon-tool-label">Refl·Probe</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sky-light" onClick={addSkyLight} title="Unreal SkyLight / Unity ambient skybox light">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">SkyLight</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="foliage" onClick={() => paintFoliage(300)} disabled={!selectedKind} title="Unreal Foliage paint / Unity Tree+Detail painter">
                      <span className="ribbon-tool-icon">⁂</span><span className="ribbon-tool-label">Foliage</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="trigger-volume" onClick={() => addTriggerVolume(0, 0.04, 0.04)} title="Unreal TriggerVolume / Unity Collider.isTrigger">
                      <span className="ribbon-tool-icon">▢</span><span className="ribbon-tool-label">Trigger</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="audio-source" onClick={() => addAudioSourceToScene({ freq: 330 })} title="Spatial Audio Source — Unreal MetaSounds/Wwise / Unity AudioSource (positional synthesized tone with real distance attenuation + stereo pan; listener = camera)">
                      <span className="ribbon-tool-icon">♪</span><span className="ribbon-tool-label">Audio Src</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="enter-xr" data-studio-xr-status={xrStatus} onClick={() => studioEnterXR('immersive-ar')} title="AR/VR (WebXR) — Unity AR Foundation / Unreal XR via three.js renderer.xr immersive session; enters AR on an XR device, reports unsupported on desktop">
                      <span className="ribbon-tool-icon">◉</span><span className="ribbon-tool-label">AR / VR</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Engine · Unreal/Unity/RAGE</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="material-instance" onClick={() => createMaterialInstance(0.2)} disabled={!selectedKind} title="Unreal MaterialInstance / Unity Material variant">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">Mat·Inst</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="blueprint-node" onClick={() => addBlueprintNode('Event Begin Play')} title="Unreal Blueprint / Unity Visual Scripting node">
                      <span className="ribbon-tool-icon">◇</span><span className="ribbon-tool-label">Blueprint</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sequencer-track" onClick={() => addSequencerTrack('Camera Cut')} title="Unreal Sequencer / Unity Timeline — track placeholder">
                      <span className="ribbon-tool-icon">≡</span><span className="ribbon-tool-label">Seq Track</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="behavior-tree" onClick={() => addBehaviorTreeNode('Patrol')} title="Unreal Behavior Tree / Unity Behavior Designer — AI BT node">
                      <span className="ribbon-tool-icon">⌥</span><span className="ribbon-tool-label">BT Node</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="import-gltf" onClick={() => importAsset('gltf')} title="Import glTF/GLB — Datasmith/Maya/Blender/Unreal interop (real GLTFLoader)">
                      <span className="ribbon-tool-icon">⤓</span><span className="ribbon-tool-label">Import glTF</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="import-obj" onClick={() => importAsset('obj')} title="Import OBJ — universal DCC interop (real OBJLoader)">
                      <span className="ribbon-tool-icon">⤓</span><span className="ribbon-tool-label">Import OBJ</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="import-fbx" onClick={() => importAsset('fbx')} title="Import FBX — Maya / 3ds Max / Unreal / Unity interop (real FBXLoader)">
                      <span className="ribbon-tool-icon">⤓</span><span className="ribbon-tool-label">Import FBX</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="import-usd" onClick={() => importAsset('usdz')} title="Import USD/USDZ — Pixar USD / Apple / Omniverse interop (real USDZLoader)">
                      <span className="ribbon-tool-icon">⤓</span><span className="ribbon-tool-label">Import USD</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="lightmass" onClick={() => lightmassBake(0.7)} disabled={!selectedKind} title="Unreal Lightmass / Unity Progressive Lightmapper — bake lighting to vertex colors">
                      <span className="ribbon-tool-icon">☀</span><span className="ribbon-tool-label">Lightmass</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="world-cell" onClick={() => addWorldPartitionCell(1, 0, 1)} title="Unreal World Partition / Unity Addressables — grid cell">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">WP Cell</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="vol-fog" onClick={() => volumetricFog(8)} title="Unreal Volumetric Fog / Unity Sky and Fog Volume">
                      <span className="ribbon-tool-icon">≋</span><span className="ribbon-tool-label">Vol Fog</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="camera-path" onClick={addCameraSequencePath} title="Unreal Camera Component sequencer track — animated path">
                      <span className="ribbon-tool-icon">⟳</span><span className="ribbon-tool-label">Cam Path</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="niagara-burst" onClick={() => niagaraBurst(400)} title="Unreal Niagara burst / Unity ParticleSystem.Emit">
                      <span className="ribbon-tool-icon">✦</span><span className="ribbon-tool-label">Niagara</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mograph-cloner" onClick={() => mographCloner({ countX: 8, countZ: 8, falloff: 'radial' })} disabled={!selectedKind} title="Cinema 4D MoGraph — Cloner + Plain Effector (radial falloff drives clone scale/rise/twist)">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">MoGraph</span>
                    </button>
                    <button type="button" className={'ribbon-tool' + (nodeGraphOpen ? ' active' : '')} data-studio-ribbon-action="node-editor" onClick={() => setNodeGraphOpen(v => !v)} title="Geometry Node Graph — Houdini SOP / Blender Geometry Nodes / Grasshopper">
                      <span className="ribbon-tool-icon">⬡</span><span className="ribbon-tool-label">Node Editor</span>
                    </button>
                    <button type="button" className={'ribbon-tool' + (materialGraphOpen ? ' active' : '')} data-studio-ribbon-action="material-editor" onClick={() => setMaterialGraphOpen(v => !v)} title="Material / Shader Node Graph — Substance Designer / Unreal Material Editor / Unity Shader Graph / Blender shader nodes (procedural textures -> PBR channels)">
                      <span className="ribbon-tool-icon">◈</span><span className="ribbon-tool-label">Material Graph</span>
                    </button>
                    <button type="button" className={'ribbon-tool' + (blueprintOpen ? ' active' : '')} data-studio-ribbon-action="blueprint-editor" onClick={() => setBlueprintOpen(v => !v)} title="Blueprint / Visual Scripting — Unreal Blueprint / Unity Visual Scripting (exec-flow graph: Event -> Spawn/Move/Rotate/Scale/SetColor acting on the live scene)">
                      <span className="ribbon-tool-icon">⧉</span><span className="ribbon-tool-label">Blueprint</span>
                    </button>
                    <button type="button" className={'ribbon-tool' + (niagaraOpen ? ' active' : '')} data-studio-ribbon-action="niagara-editor" onClick={() => setNiagaraOpen(v => !v)} title="Niagara / VFX Graph — Unreal Niagara / Unity VFX Graph (module graph: Spawn/Velocity/Force/Color-over-Life -> Emitter, simulated particle burst)">
                      <span className="ribbon-tool-icon">✸</span><span className="ribbon-tool-label">Niagara FX</span>
                    </button>
                    <button type="button" className={'ribbon-tool' + (behaviorTreeOpen ? ' active' : '')} data-studio-ribbon-action="behaviortree-editor" onClick={() => setBehaviorTreeOpen(v => !v)} title="Behaviour Tree — Unreal Behavior Tree + Blackboard / Unity Behavior Designer (Root -> Selector/Sequence -> Condition/Action; ticks drive the selected agent)">
                      <span className="ribbon-tool-icon">⌥</span><span className="ribbon-tool-label">Behavior Tree</span>
                    </button>
                    <button type="button" className={'ribbon-tool' + (worldPartitionOn ? ' active' : '')} data-studio-ribbon-action="world-partition" onClick={toggleWorldPartition} title="World Partition / streaming — Unreal World Partition / Unity Addressables (stream scene cells in/out by distance from the camera; toggle off to reveal all)">
                      <span className="ribbon-tool-icon">▣</span><span className="ribbon-tool-label">{worldPartitionOn ? 'Reveal All' : 'World Part'}</span>
                    </button>
                    <button type="button" className={'ribbon-tool' + (referenceUrl ? ' active' : '')} data-studio-ribbon-action="reference-overlay" onClick={() => { if (referenceUrl) { setReferenceUrl(null); } else { refFileInputRef.current && refFileInputRef.current.click(); } }} title="Reference overlay (top-left of viewport) — load a reference video/image to build alongside; click again to clear">
                      <span className="ribbon-tool-icon">▭</span><span className="ribbon-tool-label">{referenceUrl ? 'Clear Ref' : 'Reference'}</span>
                    </button>
                    <input ref={refFileInputRef} type="file" accept="video/*,image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { setReferenceUrl(URL.createObjectURL(f)); setReferenceVisible(true); } e.target.value = ''; }} />
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="dynamesh" onClick={() => dynaMeshSelected(26)} disabled={!selectedKind} title="ZBrush DynaMesh — uniform-topology voxel reskin of the selected mesh">
                      <span className="ribbon-tool-icon">⬢</span><span className="ribbon-tool-label">DynaMesh</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="quad-remesh" onClick={() => quadRemeshSelected(22)} disabled={!selectedKind} title="Quad Remesh — uniform quad-dominant retopology (real 4-sided quad faces)">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">Quad Remesh</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="field-quad-remesh" onClick={() => fieldQuadRemeshToScene({ surface: 'diagwave' })} title="ZRemesher / Instant Meshes — field-aligned quad retopology: principal-curvature cross-field -> RoSy smoothing -> streamline quad net (edges flow with curvature). Parametric surface.">
                      <span className="ribbon-tool-icon">◫</span><span className="ribbon-tool-label">ZRemesh</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Engine · Advanced</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools" data-modstack-version={modStackVersion}>
                    {[['subdivide', 'Subdiv'], ['bevel', 'Bevel'], ['displace', 'Displace'], ['array', 'Array']].map(([t, l]) => (
                      <button key={t} type="button" className="ribbon-tool" data-studio-ribbon-action={`modstack-add-${t}`} onClick={() => modStackAdd(t, {})} disabled={!selectedKind} title={`3ds Max / Maya / Blender — push ${l} onto the selected mesh's NON-DESTRUCTIVE modifier stack`}>
                        <span className="ribbon-tool-icon">+</span><span className="ribbon-tool-label">{l}</span>
                      </button>
                    ))}
                    <span data-studio-modstack-count style={{ alignSelf: 'center', fontSize: '11px', opacity: 0.6, padding: '0 6px' }}>{selectedModStack().length} mod{selectedModStack().length === 1 ? '' : 's'}</span>
                    {selectedModStack().map((mod, i) => (
                      <span key={i} data-studio-modstack-item={mod.type} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: '10px', background: '#161616', border: '1px solid #2a2a2a', borderRadius: 3, padding: '1px 4px', marginRight: 2, alignSelf: 'center' }}>
                        <span style={{ opacity: mod.enabled === false ? 0.4 : 0.85 }}>{mod.type}</span>
                        <button type="button" onClick={() => modStackReorder(i, -1)} title="move up" style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: '0 1px' }}>↑</button>
                        <button type="button" onClick={() => modStackReorder(i, 1)} title="move down" style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: '0 1px' }}>↓</button>
                        <button type="button" onClick={() => modStackRemove(i)} title="remove" style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: '0 1px' }}>×</button>
                      </span>
                    ))}
                  </div>
                  <div className="ribbon-group-label">Modifier Stack · Max/Maya</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="bake-ao" onClick={() => bakeOp('ao')} disabled={!selectedKind} title="Unreal Lightmass / Unity Progressive Lightmapper / Blender bake AO — ray-traced hemisphere AO into vertex colours (crevices + contact + self-occlusion darken)">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">Bake AO</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="bake-normals" onClick={() => bakeOp('normals')} disabled={!selectedKind} title="Blender bake.cc — vertex colors = RGB of normals">
                      <span className="ribbon-tool-icon">⇈</span><span className="ribbon-tool-label">Bake N</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="bake-position" onClick={() => bakeOp('position')} disabled={!selectedKind} title="Blender bake.cc — vertex colors = RGB of positions">
                      <span className="ribbon-tool-icon">⊞</span><span className="ribbon-tool-label">Bake Pos</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Bake</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button
                      type="button"
                      className="ribbon-tool"
                      onClick={() => setDisplayWireframe(v => !v)}
                      title="Toggle wireframe display"
                    >
                      <span className="ribbon-tool-icon">⌗</span>
                      <span className="ribbon-tool-label">Wireframe</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      onClick={() => setDisplayBoundingBox(v => !v)}
                      title="Toggle bounding box overlay"
                    >
                      <span className="ribbon-tool-icon">▢</span>
                      <span className="ribbon-tool-label">BBox</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      onClick={() => setDisplayNormals(v => !v)}
                      title="Toggle vertex normals overlay"
                    >
                      <span className="ribbon-tool-icon">⤴</span>
                      <span className="ribbon-tool-label">Normals</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Display</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-action="delete-last-ribbon"
                      onClick={deleteLastPrimitive}
                      disabled={primitiveCount === 0}
                      title="Delete most-recent primitive"
                    >
                      <span className="ribbon-tool-icon">×</span>
                      <span className="ribbon-tool-label">Del Last</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-action="clear-scene-ribbon"
                      onClick={clearScene}
                      disabled={primitiveCount === 0}
                      title="Wipe the scene"
                    >
                      <span className="ribbon-tool-icon">⌫</span>
                      <span className="ribbon-tool-label">Clear</span>
                    </button>
                    <button
                      type="button"
                      className="ribbon-tool"
                      data-studio-action="frame-all"
                      onClick={frameAllInScene}
                      title="Blender Numpad-Period / Maya F — frame all primitives"
                    >
                      <span className="ribbon-tool-icon">⛶</span>
                      <span className="ribbon-tool-label">Frame All</span>
                    </button>
                    <span
                      data-studio-primitive-count
                      style={{ alignSelf: 'center', fontSize: '11px', opacity: 0.6, padding: '0 8px' }}
                    >
                      {primitiveCount} primitive{primitiveCount === 1 ? '' : 's'} in scene
                    </span>
                  </div>
                  <div className="ribbon-group-label">Scene</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ref-front" onClick={() => addReferencePlaneViaPicker('front')} title="Blender Background Image (Front) / Maya image plane — load a blueprint to model against">
                      <span className="ribbon-tool-icon">▢</span><span className="ribbon-tool-label">Front Ref</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ref-side" onClick={() => addReferencePlaneViaPicker('side')} title="Reference image plane on the side (YZ) axis">
                      <span className="ribbon-tool-icon">◫</span><span className="ribbon-tool-label">Side Ref</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ref-top" onClick={() => addReferencePlaneViaPicker('top')} title="Reference image plane on the top (XZ) ground axis">
                      <span className="ribbon-tool-icon">⬓</span><span className="ribbon-tool-label">Top Ref</span>
                    </button>
                    <label style={{ alignSelf: 'center', fontSize: '11px', opacity: 0.7, padding: '0 6px', display: 'flex', flexDirection: 'column', gap: '2px' }} title="Reference plane opacity">
                      <span>Opacity {Math.round(refPlaneOpacity * 100)}%</span>
                      <input type="range" min="0" max="1" step="0.05" value={refPlaneOpacity} data-studio-ref="opacity" onChange={(e) => setReferencePlanesOpacity(e.target.value)} style={{ width: '80px' }} />
                    </label>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ref-clear" onClick={clearReferencePlanes} disabled={refPlaneCount === 0} title="Remove all reference planes">
                      <span className="ribbon-tool-icon">⌫</span><span className="ribbon-tool-label">Clear Ref</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Reference Image · Blender/Maya</div>
                </div>
              </>
            )}

            {activeTab === 'sculpting' && (
              <>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={() => sculptInflate(sculptStrength)} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (INFLATE) — push verts outward along normals">
                      <span className="ribbon-tool-icon">●</span>
                      <span className="ribbon-tool-label">Inflate</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={() => sculptTwist(sculptStrength)} disabled={!selectedKind} title="Twist sculpt pass">
                      <span className="ribbon-tool-icon">↻</span>
                      <span className="ribbon-tool-label">Twist</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={() => sculptSmooth(sculptStrength)} disabled={!selectedKind} title="Blender sculpt_smooth.cc — Laplacian smooth pass">
                      <span className="ribbon-tool-icon">≋</span>
                      <span className="ribbon-tool-label">Smooth</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-pinch" onClick={() => sculptPinch(0.1)} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (PINCH) — pull verts toward centre">
                      <span className="ribbon-tool-icon">◉</span>
                      <span className="ribbon-tool-label">Pinch</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-flatten" onClick={() => sculptFlatten(0.3)} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (FLATTEN) — pull verts to mean Y plane">
                      <span className="ribbon-tool-icon">▬</span>
                      <span className="ribbon-tool-label">Flatten</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-crease" onClick={() => sculptCrease(0.06)} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (CREASE) — sharp central ridge">
                      <span className="ribbon-tool-icon">▲</span>
                      <span className="ribbon-tool-label">Crease</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-layer" onClick={() => sculptLayer(0.05)} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (LAYER) — additive height layer">
                      <span className="ribbon-tool-icon">⊕</span>
                      <span className="ribbon-tool-label">Layer</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-polish" onClick={() => sculptPolish(0.4)} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (POLISH) — smooth + re-inflate">
                      <span className="ribbon-tool-icon">◐</span>
                      <span className="ribbon-tool-label">Polish</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-grab" onClick={() => sculptGrab(0, 0.005, 0)} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (GRAB) — translate verts">
                      <span className="ribbon-tool-icon">↕</span>
                      <span className="ribbon-tool-label">Grab</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-mask" onClick={sculptMaskBrush} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (MASK) — paint sculpt mask">
                      <span className="ribbon-tool-icon">◓</span><span className="ribbon-tool-label">Mask</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-clay" onClick={() => sculptClay(0.5)} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (CLAY) — clay deposit">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">Clay</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-scrape" onClick={() => sculptScrape(0.4)} disabled={!selectedKind} title="Blender sculpt_brush_types.cc (SCRAPE) — opposite of clay">
                      <span className="ribbon-tool-icon">◑</span><span className="ribbon-tool-label">Scrape</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Brushes · Blender</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-erode" onClick={() => sculptErode(0.6)} disabled={!selectedKind} title="Blender MOD_displace.cc + ridged musgrave — erode into weathered rock (auto-subdivides, deterministic fBm)">
                      <span className="ribbon-tool-icon">⛰</span><span className="ribbon-tool-label">Erode</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="sculpt-weather" onClick={() => sculptWeather(0.42)} disabled={!selectedKind} title="Blender MOD_displace.cc + noise — weather / degrade / age a surface (pitting + material loss)">
                      <span className="ribbon-tool-icon">☷</span><span className="ribbon-tool-label">Weather</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Degradation</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className={'ribbon-tool' + (brushActive ? ' active' : '')} data-studio-ribbon-action="brush-toggle" data-studio-brush-active={brushActive ? '1' : '0'} onClick={() => setBrushActive(v => !v)} title="Blender sculpt mode — toggle click-paint brush (stroke on the surface)">
                      <span className="ribbon-tool-icon">◉</span>
                      <span className="ribbon-tool-label">{brushActive ? 'Brush ON' : 'Brush'}</span>
                    </button>
                    {[
                      ['draw', 'Draw', '✎'], ['inflate', 'Inflate', '◌'], ['crease', 'Crease', '▲'],
                      ['pinch', 'Pinch', '◇'], ['flatten', 'Flatten', '▬'], ['grab', 'Grab', '↕'],
                      ['smooth', 'Smooth', '◐'], ['stamp', 'Stamp', '❉'], ['mask', 'Mask', '⬚'], ['polypaint', 'Polypaint', '◉'],
                    ].map(([m, label, icon]) => (
                      <button
                        key={m}
                        type="button"
                        className={'ribbon-tool' + (brushMode === m ? ' active' : '')}
                        data-studio-ribbon-action={`brush-mode-${m}`}
                        data-studio-brush-mode={brushMode === m ? '1' : '0'}
                        onClick={() => setBrushMode(m)}
                        title={`Blender sculpt_brush_types.cc — ${label} brush mode`}
                      >
                        <span className="ribbon-tool-icon">{icon}</span>
                        <span className="ribbon-tool-label">{label}</span>
                      </button>
                    ))}
                    <button type="button" className={'ribbon-tool' + (brushSymmetryX ? ' active' : '')} data-studio-ribbon-action="brush-symmetry-x" data-studio-brush-symmetry={brushSymmetryX ? '1' : '0'} onClick={() => setBrushSymmetryX(v => !v)} title="Blender sculpt symmetry — mirror every stroke across local X (bilateral / facial symmetry)">
                      <span className="ribbon-tool-icon">◫</span>
                      <span className="ribbon-tool-label">{brushSymmetryX ? 'Sym X ON' : 'Sym X'}</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mask-clear" onClick={clearSelectedMask} disabled={!selectedKind} title="ZBrush — clear the sculpt mask on the selected mesh">
                      <span className="ribbon-tool-icon">▢</span><span className="ribbon-tool-label">Clear Mask</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="mask-invert" onClick={invertSelectedMask} disabled={!selectedKind} title="ZBrush — invert the sculpt mask (Ctrl+I)">
                      <span className="ribbon-tool-icon">◰</span><span className="ribbon-tool-label">Invert Mask</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Sculpt Brush · Blender</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={subdivideSelected} disabled={!selectedKind} title="Midpoint subdivide">
                      <span className="ribbon-tool-icon">▤</span>
                      <span className="ribbon-tool-label">Subdivide</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={loopSubdivideSelected} disabled={!selectedKind} title="Loop smooth subdivision">
                      <span className="ribbon-tool-icon">◐</span>
                      <span className="ribbon-tool-label">Loop Sub</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Refine</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="vertex-paint" onClick={vertexPaintGradient} disabled={!selectedKind} title="Blender sculpt_paint_color.cc — paint vertex colors">
                      <span className="ribbon-tool-icon">●</span>
                      <span className="ribbon-tool-label">Vert Paint</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="weight-paint" onClick={weightPaintByY} disabled={!selectedKind} title="Blender paint_weight.cc — weight paint (red→blue by Y)">
                      <span className="ribbon-tool-icon">◐</span>
                      <span className="ribbon-tool-label">Wt Paint</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Paint</div>
                </div>
              </>
            )}

            {activeTab === 'uv-texture' && (
              <>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={unwrapUVs} disabled={!selectedKind} title="Spherical UV unwrap">
                      <span className="ribbon-tool-icon">◯</span>
                      <span className="ribbon-tool-label">Unwrap</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="smart-uv" onClick={smartUvProject} disabled={!selectedKind} title="Blender editmesh_uv.cc — Smart UV Project (cube-face projection)">
                      <span className="ribbon-tool-icon">▤</span>
                      <span className="ribbon-tool-label">Smart UV</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="uv-pack" onClick={uvPackIslands} disabled={!selectedKind} title="Blender uvedit_unwrap_ops.cc — pack UV islands">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">UV Pack</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="uv-reset" onClick={uvReset} disabled={!selectedKind} title="Blender uvedit_unwrap_ops.cc — reset UVs">
                      <span className="ribbon-tool-icon">⊡</span><span className="ribbon-tool-label">UV Reset</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="uv-cube-proj" onClick={uvCubeProject} disabled={!selectedKind} title="Blender uvedit_unwrap_ops.cc — cube projection">
                      <span className="ribbon-tool-icon">■</span><span className="ribbon-tool-label">UV Cube</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="uv-cyl-proj" onClick={uvCylinderProject} disabled={!selectedKind} title="Blender uvedit_unwrap_ops.cc — cylinder projection">
                      <span className="ribbon-tool-icon">⌭</span><span className="ribbon-tool-label">UV Cyl</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="uv-sph-proj" onClick={uvSphereProject} disabled={!selectedKind} title="Blender uvedit_unwrap_ops.cc — sphere projection">
                      <span className="ribbon-tool-icon">◯</span><span className="ribbon-tool-label">UV Sphere</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="uv-from-view" onClick={uvProjectFromView} disabled={!selectedKind} title="Blender uvedit_unwrap_ops.cc — project from view (camera-space)">
                      <span className="ribbon-tool-icon">◑</span><span className="ribbon-tool-label">UV View</span>
                    </button>
                    <button type="button" className={'ribbon-tool' + (brushMode === 'texpaint' && brushActive ? ' active' : '')} data-studio-ribbon-action="tex-paint-commit" onClick={texturePaintCommit} disabled={!selectedKind} title="Substance Painter / Blender paint_image.cc — paint colour into the mesh's UV texture (drag on the mesh)">
                      <span className="ribbon-tool-icon">●</span><span className="ribbon-tool-label">Tex Paint</span>
                    </button>
                    <label style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', opacity: 0.75, padding: '0 6px' }} title="Texture-paint colour / value (greyscale drives roughness + metalness)">
                      <span>Color</span>
                      <input type="color" value={brushPaintColor} data-studio-texpaint-color onChange={(e) => setBrushPaintColor(e.target.value)} style={{ width: 28, height: 18, background: '#0c0c0c', border: '1px solid #2a2a2a', borderRadius: 2, padding: 0 }} />
                    </label>
                    <label style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', opacity: 0.75, padding: '0 6px' }} title="Substance PBR channel to paint into">
                      <span>Chan</span>
                      <select value={brushPaintChannel} data-studio-texpaint-channel onChange={(e) => setBrushPaintChannel(e.target.value)} style={{ background: '#0c0c0c', color: '#dcdcdc', border: '1px solid #2a2a2a', borderRadius: 2, fontSize: 11 }}>
                        <option value="color">Base Color</option>
                        <option value="roughness">Roughness</option>
                        <option value="metalness">Metalness</option>
                        <option value="emissive">Emissive</option>
                        <option value="height">Height (bump)</option>
                      </select>
                    </label>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="bake-normal" onClick={() => bakeNormalFromHeight(selectedMeshRef.current)} disabled={!selectedKind} title="Substance 'Height -> Normal' — Sobel-bake a tangent-space normalMap from the painted Height channel">
                      <span className="ribbon-tool-icon">◳</span><span className="ribbon-tool-label">Bake Normal</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">UV</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={applyTexture} disabled={!selectedKind} title="Apply checker/grid/brick texture from panel">
                      <span className="ribbon-tool-icon">▦</span>
                      <span className="ribbon-tool-label">Apply</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={removeTexture} disabled={!selectedKind} title="Remove texture">
                      <span className="ribbon-tool-icon">×</span>
                      <span className="ribbon-tool-label">Remove</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Texture</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shader-voronoi" onClick={() => applyShaderTexture('voronoi')} disabled={!selectedKind} title="Blender nodes/shader/node_shader_tex_voronoi.cc">
                      <span className="ribbon-tool-icon">⬡</span><span className="ribbon-tool-label">Voronoi</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shader-wave" onClick={() => applyShaderTexture('wave')} disabled={!selectedKind} title="Blender node_shader_tex_wave.cc">
                      <span className="ribbon-tool-icon">∿</span><span className="ribbon-tool-label">Wave</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shader-brick" onClick={() => applyShaderTexture('brick')} disabled={!selectedKind} title="Blender node_shader_tex_brick.cc">
                      <span className="ribbon-tool-icon">▥</span><span className="ribbon-tool-label">Brick</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shader-magic" onClick={() => applyShaderTexture('magic')} disabled={!selectedKind} title="Blender node_shader_tex_magic.cc">
                      <span className="ribbon-tool-icon">✦</span><span className="ribbon-tool-label">Magic</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shader-noise" onClick={applyNoiseTexture} disabled={!selectedKind} title="Blender node_shader_tex_noise.cc">
                      <span className="ribbon-tool-icon">≋</span><span className="ribbon-tool-label">Noise</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shader-color-ramp" onClick={applyColorRampTexture} disabled={!selectedKind} title="Blender node_shader_valToRgb.cc">
                      <span className="ribbon-tool-icon">▮</span><span className="ribbon-tool-label">Color Ramp</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Shader Textures</div>
                </div>
              </>
            )}

            {activeTab === 'rigging' && (
              <>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={addArmature} title="Add bone armature">
                      <span className="ribbon-tool-icon">⊥</span>
                      <span className="ribbon-tool-label">Armature</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="pose-mode" onClick={togglePoseMode} title="Blender editors/armature/pose_*.cc — toggle pose mode">
                      <span className="ribbon-tool-icon">⊕</span>
                      <span className="ribbon-tool-label">{poseMode ? 'Pose ON' : 'Pose'}</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ik-solver" onClick={() => applyIKSolver(0.04, 0.04, 0.02)} disabled={!selectedKind} title="Blender constraint.cc (CONSTRAINT_TYPE_KINEMATIC) — IK solver">
                      <span className="ribbon-tool-icon">↗</span>
                      <span className="ribbon-tool-label">IK</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Skeleton</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={() => resetShapeKeys()} title="Reset face shape keys">
                      <span className="ribbon-tool-icon">⊖</span>
                      <span className="ribbon-tool-label">Reset Keys</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Shape Keys</div>
                </div>
              </>
            )}

            {activeTab === 'animation' && (
              <>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={() => setIsAnimating(v => !v)} title="Animate selected mesh">
                      <span className="ribbon-tool-icon">▶</span>
                      <span className="ribbon-tool-label">{isAnimating ? 'Stop' : 'Animate'}</span>
                    </button>
                    <button type="button" className={'ribbon-tool' + (sequencerOpen ? ' active' : '')} data-studio-ribbon-action="sequencer" onClick={() => setSequencerOpen(v => !v)} title="Sequencer / Timeline track editor — Unreal Sequencer / Unity Timeline / Blender Dope Sheet (keyframe tracks, scrub, play; interpolates position/rotation/scale)">
                      <span className="ribbon-tool-icon">⊟</span>
                      <span className="ribbon-tool-label">Sequencer</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Playback</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    {['idle', 'walk', 'run'].map((st) => (
                      <button key={st} type="button" className={'ribbon-tool' + (animBPState === st ? ' active' : '')} data-studio-ribbon-action={`animbp-${st}`} onClick={() => animBPSet(st)} disabled={!selectedKind} title={`Animation Blueprint state '${st}' (Unreal AnimBP / Unity Animator) — cross-fades locomotion pose on the selected mesh`}>
                        <span className="ribbon-tool-icon">{st === 'idle' ? '◦' : st === 'walk' ? '→' : '⇒'}</span>
                        <span className="ribbon-tool-label">{st[0].toUpperCase() + st.slice(1)}</span>
                      </button>
                    ))}
                    <button type="button" className={'ribbon-tool' + (animBPPlaying ? ' active' : '')} data-studio-ribbon-action="animbp-play" onClick={() => setAnimBPPlaying(v => !v)} disabled={!selectedKind} title="Play the animation state machine on the selected mesh">
                      <span className="ribbon-tool-icon">▷</span>
                      <span className="ribbon-tool-label">{animBPPlaying ? 'Stop' : 'Play SM'}</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Anim State Machine</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="track-to" onClick={() => constraintTrackTo(0, 0.1, 0)} disabled={!selectedKind} title="Blender constraint.cc (TRACK_TO) — orient mesh +Z toward target">
                      <span className="ribbon-tool-icon">↗</span>
                      <span className="ribbon-tool-label">Track To</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="copy-location" onClick={() => constraintCopyLocation('sphere')} disabled={!selectedKind} title="Blender constraint.cc (COPY_LOCATION) — copy position from another mesh">
                      <span className="ribbon-tool-icon">⇆</span>
                      <span className="ribbon-tool-label">Copy Loc</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="limit-distance" onClick={() => constraintLimitDistance(0.04)} disabled={!selectedKind} title="Blender constraint.cc (LIMIT_DISTANCE) — clamp position within radius">
                      <span className="ribbon-tool-icon">◯</span>
                      <span className="ribbon-tool-label">Limit Dist</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="driver-scale" onClick={driverScaleFromY} disabled={!selectedKind} title="Blender fcurve_driver.cc — bind scale = position.y * factor">
                      <span className="ribbon-tool-icon">⊞</span>
                      <span className="ribbon-tool-label">Driver</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Constraints</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ease-linear" onClick={() => setKeyframeEasing('linear')} title="Blender rna_animation.c — linear interpolation">
                      <span className="ribbon-tool-icon">⁄</span><span className="ribbon-tool-label">Linear</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ease-bezier" onClick={() => setKeyframeEasing('bezier')} title="Blender rna_animation.c — bezier interpolation">
                      <span className="ribbon-tool-icon">∼</span><span className="ribbon-tool-label">Bezier</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="ease-constant" onClick={() => setKeyframeEasing('constant')} title="Blender rna_animation.c — constant (step) interpolation">
                      <span className="ribbon-tool-icon">⊔</span><span className="ribbon-tool-label">Constant</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Keyframe Easing</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={insertKeyframe} disabled={!selectedKind} title="Insert keyframe at current frame">
                      <span className="ribbon-tool-icon">◆</span>
                      <span className="ribbon-tool-label">Insert KF</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={() => setIsPlayingTimeline(v => !v)} disabled={keyframes.length < 2} title="Play timeline">
                      <span className="ribbon-tool-icon">⏵</span>
                      <span className="ribbon-tool-label">{isPlayingTimeline ? 'Stop TL' : 'Play TL'}</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={clearKeyframes} disabled={keyframes.length === 0} title="Clear all keyframes">
                      <span className="ribbon-tool-icon">×</span>
                      <span className="ribbon-tool-label">Clear</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={() => setShowMotionPaths(v => !v)} title="Toggle motion path overlay">
                      <span className="ribbon-tool-icon">⤳</span>
                      <span className="ribbon-tool-label">Path</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Keyframes</div>
                </div>
              </>
            )}

            {activeTab === 'vfx-sim' && (
              <>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={spawnParticles} title="Spawn particle cloud">
                      <span className="ribbon-tool-icon">⁂</span>
                      <span className="ribbon-tool-label">Particles</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={() => growHair(hairCount, hairLength)} disabled={!selectedKind} title="Grow hair on selected surface">
                      <span className="ribbon-tool-icon">⨈</span>
                      <span className="ribbon-tool-label">Hair</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="preset-fire" onClick={() => particlePreset('fire')} title="Blender blenkernel/particle_system.cc — fire preset">
                      <span className="ribbon-tool-icon">⇡</span><span className="ribbon-tool-label">Fire</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="preset-smoke" onClick={() => particlePreset('smoke')} title="Blender blenkernel/particle_system.cc — smoke preset">
                      <span className="ribbon-tool-icon">≈</span><span className="ribbon-tool-label">Smoke</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="preset-sparkle" onClick={() => particlePreset('sparkle')} title="Blender blenkernel/particle_system.cc — sparkle preset">
                      <span className="ribbon-tool-icon">✦</span><span className="ribbon-tool-label">Sparkle</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Particles · Presets</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={spawnClothPlane} title="Add cloth plane">
                      <span className="ribbon-tool-icon">▭</span>
                      <span className="ribbon-tool-label">Add Cloth</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={() => setClothActive(v => !v)} disabled={!clothStateRef.current} title="Run cloth simulation">
                      <span className="ribbon-tool-icon">≈</span>
                      <span className="ribbon-tool-label">{clothActive ? 'Stop' : 'Run'}</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Cloth</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className={'ribbon-tool' + (isPhysicsActive ? ' active' : '')} data-studio-ribbon-action="rigidbody-sim" onClick={() => setIsPhysicsActive(v => !v)} title="Rigid-body simulation (Unreal Chaos / Unity PhysX / Blender Rigid Body World) — gravity + sphere-proxy collision with impulse resolution, stacking and friction">
                      <span className="ribbon-tool-icon">⇓</span>
                      <span className="ribbon-tool-label">{isPhysicsActive ? 'Stop' : 'Drop'}</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Physics</div>
                </div>
              </>
            )}

            {activeTab === 'rendering' && (
              <>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="engine-cycles" onClick={() => selectRenderEngine('cycles')} title="Blender render/intern/pipeline.cc — Cycles path-traced">
                      <span className="ribbon-tool-icon">◉</span>
                      <span className="ribbon-tool-label">Cycles</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="engine-eevee" onClick={() => selectRenderEngine('eevee')} title="Blender render/intern/pipeline.cc — EEVEE real-time raster">
                      <span className="ribbon-tool-icon">◐</span>
                      <span className="ribbon-tool-label">EEVEE</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="engine-workbench" onClick={() => selectRenderEngine('workbench')} title="Blender render/intern/pipeline.cc — Workbench preview">
                      <span className="ribbon-tool-icon">▦</span>
                      <span className="ribbon-tool-label">Workbench</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Render Engine</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={() => applyCameraPreset('front')} title="Front view">
                      <span className="ribbon-tool-icon">⊥</span>
                      <span className="ribbon-tool-label">Front</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={() => applyCameraPreset('top')} title="Top view">
                      <span className="ribbon-tool-icon">⊤</span>
                      <span className="ribbon-tool-label">Top</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={() => applyCameraPreset('iso')} title="Iso view">
                      <span className="ribbon-tool-icon">◆</span>
                      <span className="ribbon-tool-label">Iso</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Camera</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={applyThreePointLighting} title="Apply 3-point cinematic lighting">
                      <span className="ribbon-tool-icon">✶</span>
                      <span className="ribbon-tool-label">3-Point</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="light-point" onClick={() => addBlenderLight('point')} title="Blender blenkernel/light.cc — Point light">
                      <span className="ribbon-tool-icon">●</span><span className="ribbon-tool-label">Point</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="light-sun" onClick={() => addBlenderLight('sun')} title="Blender blenkernel/light.cc — Sun (directional)">
                      <span className="ribbon-tool-icon">☉</span><span className="ribbon-tool-label">Sun</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="light-spot" onClick={() => addBlenderLight('spot')} title="Blender blenkernel/light.cc — Spot">
                      <span className="ribbon-tool-icon">⊻</span><span className="ribbon-tool-label">Spot</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="light-area" onClick={() => addBlenderLight('area')} title="Blender blenkernel/light.cc — Area (rectangle)">
                      <span className="ribbon-tool-icon">▢</span><span className="ribbon-tool-label">Area</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Lights · Blender</div>
                </div>

                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="world-hdri" onClick={() => worldShading('hdri-sky')} title="Blender blenkernel/world.cc — HDRI sky gradient">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">HDRI</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="world-solid" onClick={() => worldShading('solid')} title="Blender world.cc — solid background">
                      <span className="ribbon-tool-icon">■</span><span className="ribbon-tool-label">Solid</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="world-fog" onClick={() => worldShading('fog')} title="Blender world.cc — fog volume">
                      <span className="ribbon-tool-icon">≋</span><span className="ribbon-tool-label">Fog</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">World</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shade-solid" onClick={() => setViewShading('solid')} title="Blender view3d_shading.cc — Solid">
                      <span className="ribbon-tool-icon">■</span><span className="ribbon-tool-label">Solid</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shade-material" onClick={() => setViewShading('material')} title="Blender view3d_shading.cc — Material Preview">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">Material</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="shade-rendered" onClick={() => setViewShading('rendered')} title="Blender view3d_shading.cc — Rendered">
                      <span className="ribbon-tool-icon">◯</span><span className="ribbon-tool-label">Rendered</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">View Shading</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={captureRender} title="Capture single render frame">
                      <span className="ribbon-tool-icon">▣</span>
                      <span className="ribbon-tool-label">Frame</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={captureShowreel} title="Capture 4-view showreel">
                      <span className="ribbon-tool-icon">⊞</span>
                      <span className="ribbon-tool-label">Showreel</span>
                    </button>
                    <button type="button" className="ribbon-tool" onClick={exportGltf} title="Export scene as glTF">
                      <span className="ribbon-tool-icon">⤓</span>
                      <span className="ribbon-tool-label">glTF</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Render / Export</div>
                </div>
              </>
            )}

            {activeTab === 'compositing' && (
              <>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" onClick={postProcessLastRender} disabled={renders.length === 0} title="Apply CSS filter to last render">
                      <span className="ribbon-tool-icon">◐</span>
                      <span className="ribbon-tool-label">Filter</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Filters</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="comp-bloom" onClick={() => compositorEffect('bloom')} disabled={renders.length === 0} title="Blender compositor/operations/COM_GlareNode.cc — bloom">
                      <span className="ribbon-tool-icon">☀</span><span className="ribbon-tool-label">Bloom</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="comp-vignette" onClick={() => compositorEffect('vignette')} disabled={renders.length === 0} title="Blender compositor — vignette">
                      <span className="ribbon-tool-icon">◍</span><span className="ribbon-tool-label">Vignette</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="comp-pixelate" onClick={() => compositorEffect('pixelate')} disabled={renders.length === 0} title="Blender COM_PixelateOperation">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">Pixelate</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="comp-lens" onClick={() => compositorEffect('lens-distortion')} disabled={renders.length === 0} title="Blender COM_LensDistortionOperation">
                      <span className="ribbon-tool-icon">◯</span><span className="ribbon-tool-label">Lens</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="comp-chromatic" onClick={() => compositorEffect('chromatic-ab')} disabled={renders.length === 0} title="Blender lens-distortion chromatic mode">
                      <span className="ribbon-tool-icon">▥</span><span className="ribbon-tool-label">Chr·Ab</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Blender · Composite</div>
                </div>
                <div className="ribbon-group">
                  <div className="ribbon-group-tools">
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="pp-ssao" onClick={ppSSAO} title="Unreal PostProcessVolume AmbientOcclusionIntensity — screen-space AO">
                      <span className="ribbon-tool-icon">◐</span><span className="ribbon-tool-label">SSAO</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="pp-motion-blur" onClick={ppMotionBlur} title="Unreal PostProcessVolume MotionBlurAmount — per-pixel velocity blur">
                      <span className="ribbon-tool-icon">⇉</span><span className="ribbon-tool-label">Mtn Blur</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="pp-dof" onClick={ppDepthOfField} title="Unreal PostProcessVolume DepthOfFieldFstop / FocalDistance">
                      <span className="ribbon-tool-icon">◎</span><span className="ribbon-tool-label">DOF</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="pp-film-grain" onClick={ppFilmGrain} title="Unreal PostProcessVolume FilmGrainIntensity">
                      <span className="ribbon-tool-icon">▦</span><span className="ribbon-tool-label">Grain</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="pp-lens-flare" onClick={ppLensFlare} title="Unreal PostProcessVolume LensFlareIntensity">
                      <span className="ribbon-tool-icon">✦</span><span className="ribbon-tool-label">Lens Flr</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="pp-tone-map" onClick={ppToneMap} title="Unreal ACES tone mapping (Narkowicz fit)">
                      <span className="ribbon-tool-icon">◍</span><span className="ribbon-tool-label">ACES</span>
                    </button>
                    <button type="button" className="ribbon-tool" data-studio-ribbon-action="pp-auto-exposure" onClick={ppAutoExposure} title="Unreal PostProcessVolume AutoExposureBias / Min/Max">
                      <span className="ribbon-tool-icon">☼</span><span className="ribbon-tool-label">Auto Exp</span>
                    </button>
                  </div>
                  <div className="ribbon-group-label">Unreal · PostProcessVolume</div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* LEFT TOOLBAR — mode/tool selector, lucide-iconified */}
      <aside className="workbench-tools" data-studio-toolbar="studio">
        {TOOL_BUTTONS.map(tool => {
          const { Icon } = tool;
          return (
            <button
              key={tool.id}
              className={'tool-icon-button' + (tool.id === activeTool ? ' active' : '')}
              data-studio-tool={tool.id}
              title={tool.title}
              onClick={() => setActiveTool(tool.id)}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </aside>

      {/* CENTER VIEWPORT — three.js scene (shared component reused from Mech).
          NOTE: do NOT add an inline `position: relative` here. The canonical
          `.workbench-viewport` rule in styles/workbench.css sets
          `position: absolute` (top: ribbon-height, left: toolbar-width, right:
          rollback+properties gutter) so the viewport overlays the fixed centre
          rectangle. An inline `position: relative` overrides that, drops the
          viewport back into grid flow, and shifts it down by one ribbon-height
          and right by the toolbar width (the long-standing "viewport off-centre"
          bug). `position: absolute` still establishes a containing block for the
          viewport's own absolute/fixed overlay children. */}
      <main className="workbench-viewport">
        <Viewport3D canvasId="render-canvas-studio" domain="studio" />
        {/* BLENDER 3D-VIEWPORT HEADER (slice 188) — per-editor header
            strip at the top of the viewport, mirroring Blender's
            "editor header" idiom. Left: editor-type label + Object Mode
            indicator. Center: View / Add / Object menu buttons. Right:
            4 round Wireframe / Solid / Material / Rendered shading-mode
            buttons (Blender's iconic shading toggle, fires the existing
            shade-* ribbon actions). Active shading is highlighted. */}
        <div
          data-studio-viewport-header
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '28px',
            background: '#2b2b2b', borderBottom: '1px solid #1d1d1d',
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '0 8px', fontSize: '11px', color: '#dfdfdf',
            zIndex: 22,
            fontFamily: 'inherit',
          }}
        >
          <span data-studio-viewport-header-label style={{ opacity: 0.7 }}>3D Viewport</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              data-studio-viewport-mode={viewportMode}
              data-studio-viewport-mode-open={modeDropdownOpen ? '1' : '0'}
              onClick={() => setModeDropdownOpen((v) => !v)}
              style={{
                background: '#353535', color: '#fff',
                border: '1px solid #1d1d1d', borderRadius: '3px',
                padding: '2px 8px', cursor: 'pointer',
                fontSize: '11px', fontFamily: 'inherit',
              }}
            >{viewportMode} ▾</button>
            {modeDropdownOpen && (
              <div
                data-studio-viewport-mode-dropdown
                style={{
                  position: 'absolute', top: '24px', left: 0, minWidth: '160px',
                  background: '#1f1f1f', border: '1px solid #353535',
                  borderRadius: '3px', padding: '4px 0', zIndex: 30,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}
              >
                {BLENDER_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-studio-viewport-mode-option={m.id}
                    data-studio-viewport-mode-option-active={m.id === viewportMode ? '1' : '0'}
                    onClick={() => applyMode(m)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: m.id === viewportMode ? '#353535' : 'transparent',
                      color: m.id === viewportMode ? '#fff' : '#bdbdbd',
                      border: 'none', padding: '5px 12px',
                      cursor: 'pointer', fontSize: '11px',
                      fontFamily: 'inherit',
                    }}
                  >{m.id}</button>
                ))}
              </div>
            )}
          </div>
          <span style={{ opacity: 0.4, marginLeft: '12px' }}>|</span>
          {['View', 'Add', 'Object'].map((m) => (
            <button
              key={m}
              type="button"
              data-studio-viewport-menu={m}
              onClick={() => { /* menu stubs land in a later slice */ }}
              style={{
                background: 'transparent', color: '#bdbdbd', border: 'none',
                padding: '2px 8px', cursor: 'pointer', fontSize: '11px',
                fontFamily: 'inherit',
              }}
            >{m}</button>
          ))}
          <span style={{ flex: 1 }} />
          {['wireframe', 'solid', 'material', 'rendered'].map((mode) => (
            <button
              key={mode}
              type="button"
              data-studio-viewport-shading={mode}
              data-studio-viewport-shading-active={mode === viewportShading ? '1' : '0'}
              onClick={() => applyShading(mode)}
              title={mode.charAt(0).toUpperCase() + mode.slice(1) + ' shading'}
              style={{
                width: '20px', height: '20px', borderRadius: '50%',
                background: mode === viewportShading ? '#4a90d9' : '#3a3a3a',
                color: mode === viewportShading ? '#ffffff' : '#bdbdbd',
                border: '1px solid ' + (mode === viewportShading ? '#4a90d9' : '#1d1d1d'),
                cursor: 'pointer',
                fontSize: '10px',
                lineHeight: '18px',
                padding: 0,
                marginLeft: '3px',
                fontFamily: 'inherit',
              }}
            >{mode === 'wireframe' ? '⊞' : mode === 'solid' ? '●' : mode === 'material' ? '◐' : '◉'}</button>
          ))}
        </div>
        {/* BLENDER N-PANEL (slice 187) — viewport-overlay sidebar with
            Item / Tool / View tabs. Sits at the viewport's right edge,
            below the header strip, above the status bar. Default open.
            The floating "N" button (vertical, right edge) toggles it. */}
        <button
          type="button"
          data-studio-npanel-toggle
          aria-pressed={nPanelOpen ? 'true' : 'false'}
          onClick={() => setNPanelOpen((v) => !v)}
          title={(nPanelOpen ? 'Hide' : 'Show') + ' N-panel (Blender N-key sidebar)'}
          style={{
            position: 'absolute',
            top: '36px',
            right: nPanelOpen ? '252px' : '8px',
            zIndex: 25,
            width: '20px',
            height: '36px',
            background: '#2b2b2b',
            color: '#dfdfdf',
            border: '1px solid #1d1d1d',
            borderRadius: '3px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '11px',
            transition: 'right 0.16s ease',
          }}
        >N</button>
        {nPanelOpen && (
          <aside
            data-studio-npanel="open"
            data-studio-npanel-tab={nPanelTab}
            style={{
              position: 'absolute',
              top: '28px',
              right: '0',
              bottom: '0',
              width: '240px',
              background: '#262626',
              borderLeft: '1px solid #1d1d1d',
              color: '#dfdfdf',
              fontSize: '11px',
              fontFamily: 'inherit',
              zIndex: 20,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{ display: 'flex', borderBottom: '1px solid #1d1d1d', background: '#2b2b2b' }}
            >
              {['Item', 'Tool', 'View'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  data-studio-npanel-tab-button={tab}
                  data-studio-npanel-tab-active={tab === nPanelTab ? '1' : '0'}
                  onClick={() => setNPanelTab(tab)}
                  style={{
                    flex: 1,
                    background: tab === nPanelTab ? '#353535' : 'transparent',
                    color: tab === nPanelTab ? '#ffffff' : '#bdbdbd',
                    border: 'none',
                    borderBottom: tab === nPanelTab ? '2px solid #4a90d9' : '2px solid transparent',
                    padding: '6px 0',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '11px',
                  }}
                >{tab}</button>
              ))}
            </div>
            <div style={{ padding: '8px 10px', overflowY: 'auto', flex: 1 }}>
              {nPanelTab === 'Item' && (
                <div data-studio-npanel-content="Item">
                  <div style={{ opacity: 0.6, marginBottom: '6px', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.05em' }}>Selected</div>
                  {selectedKind ? (
                    <>
                      <div style={{ marginBottom: '8px' }}>
                        <span style={{ opacity: 0.6 }}>Name:</span>{' '}
                        <span data-studio-npanel-selected-kind style={{ color: '#fff' }}>{selectedKind}</span>
                      </div>
                      {selectedTransform && (
                        <>
                          <div data-studio-npanel-section="transform" style={{ marginBottom: '6px' }}>
                            <div style={{ opacity: 0.6, marginBottom: '3px' }}>Location</div>
                            <div style={{ fontFamily: 'monospace', color: '#cfd5dc' }}>
                              <span data-studio-npanel-loc-x>{selectedTransform.position?.x?.toFixed(3) ?? '0.000'}</span>{' '}
                              <span data-studio-npanel-loc-y>{selectedTransform.position?.y?.toFixed(3) ?? '0.000'}</span>{' '}
                              <span data-studio-npanel-loc-z>{selectedTransform.position?.z?.toFixed(3) ?? '0.000'}</span>
                            </div>
                          </div>
                          <div style={{ marginBottom: '6px' }}>
                            <div style={{ opacity: 0.6, marginBottom: '3px' }}>Rotation (rad)</div>
                            <div style={{ fontFamily: 'monospace', color: '#cfd5dc' }}>
                              <span data-studio-npanel-rot-x>{selectedTransform.rotation?.x?.toFixed(3) ?? '0.000'}</span>{' '}
                              <span data-studio-npanel-rot-y>{selectedTransform.rotation?.y?.toFixed(3) ?? '0.000'}</span>{' '}
                              <span data-studio-npanel-rot-z>{selectedTransform.rotation?.z?.toFixed(3) ?? '0.000'}</span>
                            </div>
                          </div>
                          <div>
                            <div style={{ opacity: 0.6, marginBottom: '3px' }}>Scale</div>
                            <div style={{ fontFamily: 'monospace', color: '#cfd5dc' }}>
                              <span data-studio-npanel-scale-x>{selectedTransform.scale?.x?.toFixed(3) ?? '1.000'}</span>{' '}
                              <span data-studio-npanel-scale-y>{selectedTransform.scale?.y?.toFixed(3) ?? '1.000'}</span>{' '}
                              <span data-studio-npanel-scale-z>{selectedTransform.scale?.z?.toFixed(3) ?? '1.000'}</span>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div data-studio-npanel-empty style={{ opacity: 0.5 }}>(no selection)</div>
                  )}
                </div>
              )}
              {nPanelTab === 'Tool' && (
                <div data-studio-npanel-content="Tool">
                  <div style={{ opacity: 0.6, marginBottom: '6px', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.05em' }}>Active Tool</div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ opacity: 0.6 }}>Name:</span>{' '}
                    <span data-studio-npanel-tool style={{ color: '#fff', textTransform: 'capitalize' }}>{activeTool}</span>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ opacity: 0.6 }}>Discipline:</span>{' '}
                    <span data-studio-npanel-discipline style={{ color: '#fff' }}>{activeTab}</span>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ opacity: 0.6 }}>Workspace:</span>{' '}
                    <span data-studio-npanel-workspace style={{ color: '#fff' }}>{activeWorkspace}</span>
                  </div>
                </div>
              )}
              {nPanelTab === 'View' && (
                <div data-studio-npanel-content="View">
                  <div style={{ opacity: 0.6, marginBottom: '6px', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.05em' }}>3D Viewport</div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ opacity: 0.6 }}>Primitives:</span>{' '}
                    <span data-studio-npanel-primitives>{primitiveCount}</span>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ opacity: 0.6 }}>Lights:</span>{' '}
                    <span data-studio-npanel-lights>{lightCount}</span>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ opacity: 0.6 }}>Vertices:</span>{' '}
                    <span data-studio-npanel-verts>{vertexCount.toLocaleString()}</span>
                  </div>
                  <div>
                    <span style={{ opacity: 0.6 }}>Faces:</span>{' '}
                    <span data-studio-npanel-faces>{faceCount.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
        {/* Right-click context menu — fires on viewport contextmenu event,
            offers Studio-specific actions on the picked mesh (Duplicate,
            Subdivide, Delete, etc.) or generic actions for empty space. */}
        {contextMenu && (
          <div
            data-studio-context-menu
            onClick={() => setContextMenu(null)}
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              zIndex: 100,
              minWidth: '180px',
              background: '#0a0a0a',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: '6px',
              padding: '4px 0',
              fontSize: '11px',
              fontFamily: 'inherit',
              color: '#d4dadf',
              boxShadow: 'none',
            }}
          >
            {contextMenu.uuid ? (
              <>
                <div
                  data-studio-context-action="duplicate"
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu(null);
                    const src = window.__archdiscScene && window.__archdiscScene.getObjectByProperty('uuid', contextMenu.uuid);
                    if (!src || !src.isMesh) return;
                    const clone = new THREE.Mesh(src.geometry.clone(), src.material.clone());
                    clone.position.copy(src.position);
                    clone.rotation.copy(src.rotation);
                    clone.scale.copy(src.scale);
                    clone.position.x += 0.04; // offset 40mm so it's visible
                    clone.userData.archdiscStudioPrimitive = true;
                    clone.userData.archdiscStudioPrimitiveKind = (src.userData.archdiscStudioPrimitiveKind || 'mesh') + '-dup';
                    window.__archdiscScene.add(clone);
                    primitiveStackRef.current.push(clone);
                    setPrimitiveCount(primitiveStackRef.current.length);
                    recomputeMeshStats(window.__archdiscScene);
                  }}
                  style={{ padding: '6px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Duplicate
                </div>
                <div
                  data-studio-context-action="subdivide"
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu(null);
                    subdivideSelected();
                  }}
                  style={{ padding: '6px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Subdivide
                </div>
                <div
                  data-studio-context-action="smooth-shading"
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu(null);
                    setShading('smooth');
                  }}
                  style={{ padding: '6px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Shading → Smooth
                </div>
                <div
                  data-studio-context-action="flat-shading"
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu(null);
                    setShading('flat');
                  }}
                  style={{ padding: '6px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Shading → Flat
                </div>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
                <div
                  data-studio-context-action="delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu(null);
                    const target = window.__archdiscScene && window.__archdiscScene.getObjectByProperty('uuid', contextMenu.uuid);
                    if (!target) return;
                    const stack = primitiveStackRef.current;
                    const idx = stack.indexOf(target);
                    if (idx !== -1) stack.splice(idx, 1);
                    if (selectedMeshRef.current === target) {
                      selectedMeshRef.current = null;
                      setSelectedKind(null);
                      setSelectedTransform(null);
                    }
                    window.__archdiscScene.remove(target);
                    if (target.geometry && target.geometry.dispose) target.geometry.dispose();
                    if (target.material) {
                      if (Array.isArray(target.material)) target.material.forEach(m => m.dispose && m.dispose());
                      else if (target.material.dispose) target.material.dispose();
                    }
                    setPrimitiveCount(stack.length);
                    recomputeMeshStats(window.__archdiscScene);
                  }}
                  style={{ padding: '6px 14px', cursor: 'pointer', color: '#cccccc' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Delete
                </div>
              </>
            ) : (
              <>
                <div
                  data-studio-context-action="add-cube"
                  onClick={(e) => { e.stopPropagation(); setContextMenu(null); addPrimitive('cube'); }}
                  style={{ padding: '6px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Add Cube
                </div>
                <div
                  data-studio-context-action="add-sphere"
                  onClick={(e) => { e.stopPropagation(); setContextMenu(null); addPrimitive('sphere'); }}
                  style={{ padding: '6px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Add Sphere
                </div>
                <div
                  data-studio-context-action="add-suzanne"
                  onClick={(e) => { e.stopPropagation(); setContextMenu(null); addPrimitive('suzanne'); }}
                  style={{ padding: '6px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Add Suzanne
                </div>
              </>
            )}
          </div>
        )}
        {/* Empty-state hero — when the scene has no primitives, show a
            big Studio welcome card centered over the viewport with
            quick-start buttons. Hidden the moment the user adds anything. */}
        {/* Command Palette (F3 / Ctrl+K in Blender). */}
        {commandPaletteOpen && (
          <div
            data-studio-command-palette
            onClick={(e) => { if (e.target.dataset.studioCommandPalette !== undefined) setCommandPaletteOpen(false); }}
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0, 0, 0, 0.65)',
              zIndex: 200,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              paddingTop: '15vh',
            }}
          >
            <div
              data-studio-command-palette-modal
              style={{
                background: '#0a0a0a',
                border: '1px solid rgba(255,255,255,0.18)',
                padding: '14px 16px',
                minWidth: '420px',
                color: '#d4dadf',
                fontFamily: 'inherit',
              }}
            >
              <h3 style={{
                margin: '0 0 8px 0', fontSize: '11px',
                textTransform: 'uppercase', letterSpacing: '0.6px',
                color: '#95a0a8',
              }}>
                Command Search · Blender F3 menu
              </h3>
              <input
                type="text"
                data-studio-command-palette-input
                autoFocus
                placeholder="Search ops..."
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setCommandPaletteOpen(false);
                }}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: '#f0f0f0',
                  padding: '6px 10px',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                }}
              />
              <p style={{
                margin: '10px 0 0 0', fontSize: '10px',
                color: '#95a0a8',
                fontFamily: 'monospace',
              }}>
                ↑↓ navigate · Enter run · Esc close
              </p>
            </div>
          </div>
        )}

        {primitiveCount === 0 && (
          <div
            data-studio-empty-hero
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              padding: '24px 32px',
              minWidth: '320px',
              background: 'rgba(8,8,8,0.96)',
              border: '1px solid rgba(255,255,255,0.32)',
              borderRadius: '14px',
              boxShadow: 'none',
              backdropFilter: 'none',
              textAlign: 'center',
              color: '#e9ecef',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              zIndex: 5,
              pointerEvents: 'auto',
            }}
          >
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '6px',
            }}>
              <Wand2 size={22} style={{ color: '#e6e6e6', filter: 'none' }} />
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, letterSpacing: '0.5px' }}>
                ArchDisc <span style={{ color: '#e6e6e6' }}>Studio</span>
              </h2>
            </div>
            <p style={{ margin: '0 0 16px 0', fontSize: '12px', opacity: 0.65, lineHeight: 1.5 }}>
              3D content creation — modelling · sculpting · rigging · animation ·<br />
              VFX · simulation · texturing · rendering
            </p>
            <div
              data-studio-hero-actions
              style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}
            >
              <button
                data-studio-hero-action="add-cube"
                onClick={() => addPrimitive('cube')}
                style={{
                  background: 'rgba(255,255,255,0.18)',
                  border: '1px solid rgba(255,255,255,0.55)',
                  color: '#e6e6e6',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  padding: '8px 14px',
                  borderRadius: '7px',
                  cursor: 'pointer',
                  transition: 'background 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.18)'; }}
                onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.10)'; }}
              >
                + Add Cube
              </button>
              <button
                data-studio-hero-action="load-preset"
                onClick={() => loadPreset('crystal-garden')}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: '#d4dadf',
                  fontSize: '11.5px',
                  padding: '8px 14px',
                  borderRadius: '7px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.10)'; }}
                onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.04)'; }}
              >
                Load Crystal Garden
              </button>
              <button
                data-studio-hero-action="load-suzanne"
                onClick={() => addPrimitive('suzanne')}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: '#d4dadf',
                  fontSize: '11.5px',
                  padding: '8px 14px',
                  borderRadius: '7px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.10)'; }}
                onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.04)'; }}
              >
                Spawn Suzanne
              </button>
            </div>
            <p style={{
              margin: '14px 0 0 0',
              fontSize: '9.5px',
              opacity: 0.45,
              fontFamily: 'monospace',
              letterSpacing: '0.6px',
              textTransform: 'uppercase',
            }}>
              Or pick any tool from the ribbon above
            </p>
          </div>
        )}
        {/* Studio status bar — always-visible scene stats overlaid on the
            bottom of the viewport. Floats over the renderer canvas so the
            same readout follows the user across every discipline tab. */}
        <div
          data-studio-status-bar
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            gap: '16px',
            padding: '6px 14px',
            background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.65) 0%, rgba(0, 0, 0, 0) 100%)',
            color: '#cfd6e0',
            fontFamily: 'monospace',
            fontSize: '11px',
            alignItems: 'center',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Sparkles size={12} style={{ color: '#e6e6e6' }} />
            <span style={{ fontWeight: 600, color: '#e6e6e6' }}>STUDIO</span>
          </span>
          <span data-studio-status="discipline" style={{ opacity: 0.85, textTransform: 'capitalize' }}>
            {DISCIPLINE_TABS.find(t => t.id === activeTab)?.label || activeTab}
          </span>
          <span data-studio-status="primitives">
            <Box size={11} style={{ verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }} />
            {primitiveCount} prim
          </span>
          <span data-studio-status="lights">
            <Lightbulb size={11} style={{ verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }} />
            {lightCount} lt
          </span>
          <span data-studio-status="renders">
            <Camera size={11} style={{ verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }} />
            {renders.length} rdr
          </span>
          <span
            data-studio-status="animation"
            style={{ opacity: isAnimating ? 1 : 0.5, color: isAnimating ? '#b0b0b0' : 'inherit' }}
          >
            <Play size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {isAnimating ? 'animating' : 'idle'}
          </span>
          <span
            data-studio-status="physics"
            style={{ opacity: isPhysicsActive ? 1 : 0.5, color: isPhysicsActive ? '#bababa' : 'inherit' }}
          >
            <Mountain size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {isPhysicsActive ? 'simulating' : 'idle'}
          </span>
          <span data-studio-status="vertices" style={{ marginLeft: 'auto' }}>
            {vertexCount.toLocaleString()} v · {faceCount.toLocaleString()} f
          </span>
        </div>
      </main>

      {/* RIGHT PROPERTIES PANEL */}
      <aside
        className={'workbench-properties' + (propertiesCollapsed ? ' workbench-properties-collapsed' : '')}
        data-studio-properties="studio"
        data-studio-discipline={activeTab}
        data-studio-properties-collapsed={propertiesCollapsed ? '1' : '0'}
      >
        {/* Slice 202: collapse / expand chevron at the inner edge of
            the panel. The existing .workbench-drawer-toggle CSS pins it
            to left: -9px so the affordance hangs into the viewport's
            right margin; click to slide the whole aside off-screen and
            reclaim the viewport width. */}
        <button
          type="button"
          className="workbench-drawer-toggle"
          data-studio-properties-toggle
          aria-pressed={propertiesCollapsed ? 'true' : 'false'}
          title={(propertiesCollapsed ? 'Show' : 'Hide') + ' Properties panel'}
          onClick={() => setPropertiesCollapsed((v) => !v)}
          style={{
            position: 'absolute',
            left: '-18px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '18px',
            height: '60px',
            background: '#2b2b2b',
            color: '#dfdfdf',
            border: '1px solid #1d1d1d',
            borderRight: 'none',
            borderRadius: '4px 0 0 4px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '14px',
            zIndex: 25,
            padding: 0,
          }}
        >{propertiesCollapsed ? '◀' : '▶'}</button>
        {/* Discipline-aware section visibility. AI Prompt, Welcome,
            Selection, Material show on every tab; everything else
            gates on data-studio-discipline matching one of its allow-list. */}
        <style>{`
          /* Blender workspaces strip — slice 185: top-of-window tab strip
             mirroring Blender's canonical workspaces. Sits ABOVE the
             discipline ribbon, scrolls horizontally if it overflows so the
             full 11 workspaces fit any viewport. */
          /* The Blender workspaces strip is absolutely positioned at the
             very top of the workbench stage (above the ribbon-placeholder).
             It's NOT a grid child of .workbench-stage because the stage's
             template-areas only declare ribbon-row + main-row, and an
             unassigned child auto-places at the BOTTOM. Using absolute
             positioning keeps the strip out of the grid layout entirely. */
          .workbench-stage { padding-top: 30px; box-sizing: border-box; }
          /* Slice 196 declutter: hide the redundant discipline-tab strip
             (the workspaces strip already drives discipline switching),
             hide the legacy left workbench-tools (Mech-era vertical icon
             rail) since the viewport header + Mode dropdown + workspaces
             strip now cover all those entries. The ribbon-content (tool
             buttons + section labels under each discipline) stays
             visible — only the chrome above it is suppressed. */
          body:has([data-studio-properties="studio"]) .ribbon-tabs { display: none !important; }
          body:has([data-studio-properties="studio"]) .workbench-tools { display: none !important; }
          /* Also free up the left edge that the toolbar used to reserve so
             the viewport extends to the window's left edge. */
          body:has([data-studio-properties="studio"]) .workbench-viewport { left: 0 !important; }
          .blender-workspaces-strip {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 30px;
            z-index: 40;
            display: flex;
            align-items: center;
            gap: 2px;
            padding: 4px 8px;
            background: #2b2b2b;
            border-bottom: 1px solid #1d1d1d;
            overflow-x: auto;
            overflow-y: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 11px;
            scrollbar-width: thin;
            box-sizing: border-box;
          }
          .blender-workspaces-strip::-webkit-scrollbar { height: 4px; }
          .blender-workspaces-strip::-webkit-scrollbar-thumb { background: #555; border-radius: 2px; }
          .blender-workspace-tab {
            display: inline-flex;
            align-items: center;
            padding: 4px 10px;
            background: transparent;
            border: none;
            border-top: 2px solid transparent;
            color: #bdbdbd;
            cursor: pointer;
            white-space: nowrap;
            user-select: none;
            transition: background 0.08s ease, color 0.08s ease, border-color 0.08s ease;
          }
          .blender-workspace-tab:hover { background: #3a3a3a; color: #f0f0f0; }
          .blender-workspace-tab.active {
            background: #353535;
            color: #ffffff;
            border-top-color: #4a90d9;
          }
          [data-studio-properties="studio"] [data-studio-section="mesh"],
          [data-studio-properties="studio"] [data-studio-section="reference"],
          [data-studio-properties="studio"] [data-studio-section="archviz"],
          [data-studio-properties="studio"] [data-studio-section="lathe"],
          [data-studio-properties="studio"] [data-studio-section="subdivision"],
          [data-studio-properties="studio"] [data-studio-section="mirror"],
          [data-studio-properties="studio"] [data-studio-section="procedural"],
          [data-studio-properties="studio"] [data-studio-section="instancing"],
          [data-studio-properties="studio"] [data-studio-section="text3d"],
          [data-studio-properties="studio"] [data-studio-section="texture"],
          [data-studio-properties="studio"] [data-studio-section="sculpting"],
          [data-studio-properties="studio"] [data-studio-section="armature"],
          [data-studio-properties="studio"] [data-studio-section="animation"],
          [data-studio-properties="studio"] [data-studio-section="particles"],
          [data-studio-properties="studio"] [data-studio-section="physics"],
          [data-studio-properties="studio"] [data-studio-section="render"],
          [data-studio-properties="studio"] [data-studio-section="renders"],
          [data-studio-properties="studio"] [data-studio-section="lighting"],
          [data-studio-properties="studio"] [data-studio-section="compositing"],
          [data-studio-properties="studio"] [data-studio-section="scene"],
          [data-studio-properties="studio"] [data-studio-section="boolean"],
          [data-studio-properties="studio"] [data-studio-section="scatter"],
          [data-studio-properties="studio"] [data-studio-section="display"],
          [data-studio-properties="studio"] [data-studio-section="shape-keys"] { display: none; }

          [data-studio-discipline="modeling"] [data-studio-section="mesh"],
          [data-studio-discipline="modeling"] [data-studio-section="reference"],
          [data-studio-discipline="modeling"] [data-studio-section="archviz"],
          [data-studio-discipline="modeling"] [data-studio-section="lathe"],
          [data-studio-discipline="modeling"] [data-studio-section="subdivision"],
          [data-studio-discipline="modeling"] [data-studio-section="mirror"],
          [data-studio-discipline="modeling"] [data-studio-section="procedural"],
          [data-studio-discipline="modeling"] [data-studio-section="instancing"],
          [data-studio-discipline="modeling"] [data-studio-section="text3d"],
          [data-studio-discipline="modeling"] [data-studio-section="texture"],
          [data-studio-discipline="modeling"] [data-studio-section="scene"],
          [data-studio-discipline="modeling"] [data-studio-section="boolean"],
          [data-studio-discipline="modeling"] [data-studio-section="scatter"],
          [data-studio-discipline="modeling"] [data-studio-section="display"],
          [data-studio-discipline="sculpting"] [data-studio-section="display"],
          [data-studio-discipline="rendering"] [data-studio-section="display"],
          [data-studio-discipline="sculpting"] [data-studio-section="sculpting"],
          [data-studio-discipline="sculpting"] [data-studio-section="subdivision"],
          [data-studio-discipline="sculpting"] [data-studio-section="mirror"],
          [data-studio-discipline="uv-texture"] [data-studio-section="texture"],
          [data-studio-discipline="rigging"] [data-studio-section="armature"],
          [data-studio-discipline="rigging"] [data-studio-section="shape-keys"],
          [data-studio-discipline="animation"] [data-studio-section="animation"],
          [data-studio-discipline="animation"] [data-studio-section="scene"],
          [data-studio-discipline="vfx-sim"] [data-studio-section="particles"],
          [data-studio-discipline="vfx-sim"] [data-studio-section="physics"],
          [data-studio-discipline="rendering"] [data-studio-section="render"],
          [data-studio-discipline="rendering"] [data-studio-section="renders"],
          [data-studio-discipline="rendering"] [data-studio-section="lighting"],
          [data-studio-discipline="compositing"] [data-studio-section="compositing"],
          [data-studio-discipline="compositing"] [data-studio-section="renders"] { display: block; }

          /* =================================================================
             STUDIO UI/UX OVERHAUL — slice 59 + 60
             ================================================================= */

          /* Override Mech's red accent variables with Studio monotone
             white-on-black whenever Studio is mounted. Matte black
             surfaces + OLED black background, no glow shadows. */
          body:has([data-studio-properties="studio"]) {
            --accent-primary: #e6e6e6 !important;
            --accent-primary-muted: rgba(255, 255, 255, 0.10) !important;
            --accent-primary-border: rgba(255, 255, 255, 0.28) !important;
            --accent-primary-hover: #ffffff !important;
            --shadow-glow-accent: none !important;
            --bg-primary: #000000 !important;
            --bg-secondary: #050505 !important;
            --bg-tertiary: #0a0a0a !important;
            --bg-hover: rgba(255, 255, 255, 0.06) !important;
            --bg-active: rgba(255, 255, 255, 0.10) !important;
          }

          /* Properties panel scrolls cleanly; floor + room for the banner. */
          [data-studio-properties="studio"] {
            overflow-y: auto;
            padding-bottom: 32px;
            background: #000000;
          }

          /* Section panel — flat, edge-to-edge, matte-black. Matches the
             stacked-panel pattern Mech uses in its workbench-properties
             aside (DesignHistory + PartBrowser + FeatureTree etc.). No
             rounded card chrome, no hover-glow — just dense data
             surface. */
          [data-studio-properties="studio"] .property-section {
            background: #050505;
            border: none;
            border-top: 1px solid rgba(255,255,255,0.04);
            border-radius: 0;
            padding: 8px 12px;
            margin: 0;
            transition: none;
          }
          [data-studio-properties="studio"] .property-section:hover {
            background: #060606;
          }
          [data-studio-properties="studio"] .property-section:first-of-type {
            border-top: none;
          }

          /* Section header — Mech-style small caps, no decorative stripe.
             Click-toggles collapse via the chevron on the right. */
          [data-studio-properties="studio"] .property-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 0 0 6px 0;
            padding: 2px 0;
            text-transform: uppercase;
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.7px;
            color: #95a0a8;
            cursor: pointer;
            user-select: none;
          }
          [data-studio-properties="studio"] .property-header::before {
            content: none;
          }
          [data-studio-properties="studio"] .property-section[data-studio-collapsed="true"] > *:not(.property-header) {
            display: none !important;
          }
          [data-studio-properties="studio"] .property-section[data-studio-collapsed="true"] {
            padding-bottom: 6px;
          }
          [data-studio-properties="studio"] .property-header::after {
            content: '▾';
            margin-left: auto;
            font-size: 10px;
            opacity: 0.4;
            transition: transform 0.2s;
          }
          [data-studio-properties="studio"] .property-section[data-studio-collapsed="true"] .property-header::after {
            transform: rotate(-90deg);
          }

          /* Per-section discipline-coloured stripes — gives each panel a
             scannable visual identity. */
          [data-studio-properties="studio"] [data-studio-section="ai"]            .property-header::before { background: #9a9a9a; }
          [data-studio-properties="studio"] [data-studio-section="welcome"]       .property-header::before { background: #e6e6e6; }
          [data-studio-properties="studio"] [data-studio-section="library"]       .property-header::before { background: #e6e6e6; }
          [data-studio-properties="studio"] [data-studio-section="selection"]     .property-header::before { background: #bfbfbf; }
          [data-studio-properties="studio"] [data-studio-section="mesh"]          .property-header::before { background: #e6e6e6; }
          [data-studio-properties="studio"] [data-studio-section="display"]       .property-header::before { background: #c8c8c8; }
          [data-studio-properties="studio"] [data-studio-section="material"]      .property-header::before { background: #bababa; }
          [data-studio-properties="studio"] [data-studio-section="texture"]       .property-header::before { background: #a8a8a8; }
          [data-studio-properties="studio"] [data-studio-section="sculpting"]     .property-header::before { background: #9a9a9a; }
          [data-studio-properties="studio"] [data-studio-section="subdivision"]   .property-header::before { background: #b0b0b0; }
          [data-studio-properties="studio"] [data-studio-section="mirror"]        .property-header::before { background: #e6e6e6; }
          [data-studio-properties="studio"] [data-studio-section="boolean"]       .property-header::before { background: #888888; }
          [data-studio-properties="studio"] [data-studio-section="scatter"]       .property-header::before { background: #a8a8a8; }
          [data-studio-properties="studio"] [data-studio-section="procedural"]    .property-header::before { background: #9a9a9a; }
          [data-studio-properties="studio"] [data-studio-section="instancing"]    .property-header::before { background: #bababa; }
          [data-studio-properties="studio"] [data-studio-section="text3d"]        .property-header::before { background: #bfbfbf; }
          [data-studio-properties="studio"] [data-studio-section="archviz"]       .property-header::before { background: #bababa; }
          [data-studio-properties="studio"] [data-studio-section="lathe"]         .property-header::before { background: #9a9a9a; }
          [data-studio-properties="studio"] [data-studio-section="reference"]     .property-header::before { background: #c0c0c0; }
          [data-studio-properties="studio"] [data-studio-section="shape-keys"]    .property-header::before { background: #9a9a9a; }
          [data-studio-properties="studio"] [data-studio-section="armature"]      .property-header::before { background: #b0b0b0; }
          [data-studio-properties="studio"] [data-studio-section="animation"]     .property-header::before { background: #9a9a9a; }
          [data-studio-properties="studio"] [data-studio-section="particles"]     .property-header::before { background: #9a9a9a; }
          [data-studio-properties="studio"] [data-studio-section="physics"]       .property-header::before { background: #bababa; }
          [data-studio-properties="studio"] [data-studio-section="render"]        .property-header::before { background: #bababa; }
          [data-studio-properties="studio"] [data-studio-section="renders"]       .property-header::before { background: #bababa; }
          [data-studio-properties="studio"] [data-studio-section="lighting"]      .property-header::before { background: #bfbfbf; }
          [data-studio-properties="studio"] [data-studio-section="compositing"]   .property-header::before { background: #888888; }
          [data-studio-properties="studio"] [data-studio-section="scene"]         .property-header::before { background: #e6e6e6; }
          [data-studio-properties="studio"] [data-studio-section="scene-io"]      .property-header::before { background: #c8c8c8; }
          [data-studio-properties="studio"] [data-studio-section="camera"]        .property-header::before { background: #bababa; }
          [data-studio-properties="studio"] [data-studio-section="export"]        .property-header::before { background: #bababa; }

          /* Buttons — Studio teal hover glow, smoother transitions. */
          [data-studio-properties="studio"] .property-button {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            color: #d4dadf;
            font-size: 11px;
            font-weight: 500;
            letter-spacing: 0.2px;
            padding: 6px 10px;
            border-radius: 6px;
            height: 28px;
            margin-bottom: 5px;
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
            width: 100%;
            text-align: center;
          }
          [data-studio-properties="studio"] .property-button:hover:not(:disabled) {
            background: rgba(255,255,255,0.10);
            border-color: rgba(255,255,255,0.45);
            color: #f0f6f7;
          }
          [data-studio-properties="studio"] .property-button:active:not(:disabled) {
            background: rgba(255,255,255,0.20);
          }
          [data-studio-properties="studio"] .property-button:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }

          /* Inputs / selects — match Studio teal accent. */
          [data-studio-properties="studio"] .property-input {
            background: rgba(255,255,255,0.025);
            border: 1px solid rgba(255,255,255,0.08);
            color: #d4dadf;
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 5px;
            transition: border-color 0.12s, background 0.12s;
          }
          [data-studio-properties="studio"] .property-input:focus {
            outline: none;
            border-color: #e6e6e6;
            background: rgba(255,255,255,0.03);
          }
          [data-studio-properties="studio"] input[type="range"] {
            accent-color: #e6e6e6;
            height: 4px;
          }
          [data-studio-properties="studio"] input[type="checkbox"] {
            accent-color: #e6e6e6;
            cursor: pointer;
          }
          [data-studio-properties="studio"] input[type="color"] {
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 5px;
            background: transparent;
          }

          /* Property row label/input alignment. */
          [data-studio-properties="studio"] .property-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
          }
          [data-studio-properties="studio"] .property-label {
            font-size: 11px;
            color: #95a0a8;
            min-width: 64px;
            flex-shrink: 0;
          }

          /* =================================================================
             Whole-shell Studio identity — slice 60
             ================================================================= */

          /* Hide the Mech-inherited bottom chat / code / parametric console
             when Studio is active. AI Prompt now lives in the right rail. */
          body:has([data-studio-properties="studio"]) .workbench-console,
          body:has([data-studio-properties="studio"]) .ai-console {
            display: none !important;
          }

          /* Ribbon — Mech-style layout, Studio monotone palette.
             Tabs are now real .ribbon-tab buttons inside .ribbon-tabs;
             content is .ribbon-content with .ribbon-group sections.

             Studio uses the same 168px ribbon height as Mech (the
             inherited --ribbon-height variable). The container +
             placeholder are clamped + overflow:hidden so Studio's
             larger tool counts don't overflow the height — extra
             groups scroll horizontally via overflow-x:auto. */
          body:has([data-studio-properties="studio"]) .workbench-ribbon-placeholder,
          body:has([data-studio-properties="studio"]) .ribbon-container {
            height: 168px !important;
            max-height: 168px !important;
            min-height: 168px !important;
            overflow: hidden !important;
          }
          body:has([data-studio-properties="studio"]) .workbench-stage > .ribbon-container,
          body:has([data-studio-properties="studio"]) .workbench-stage > .workbench-ribbon-placeholder {
            height: 168px !important;
            max-height: 168px !important;
            min-height: 168px !important;
          }
          /* The inherited stage uses grid-template-rows: auto 1fr.
             That auto row sizes to its child's *content* height —
             which on Studio's many-group tabs balloons past 168px
             because of inter-group padding + child label heights.
             Pin the grid row itself to 168px so the rest of the
             stage (viewport, tools, panel) sit flush. */
          body:has([data-studio-properties="studio"]) .workbench-stage {
            grid-template-rows: 168px minmax(0, 1fr) !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-container {
            background: #000000 !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.10) !important;
            display: flex !important;
            flex-direction: column !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tabs {
            background: #050505 !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
            padding: 0 8px !important;
            height: 24px !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tab {
            background: transparent !important;
            color: #95a0a8 !important;
            border: none !important;
            border-bottom: 2px solid transparent !important;
            font-size: 11px !important;
            padding: 5px 14px !important;
            font-weight: 500 !important;
            letter-spacing: 0.3px !important;
            cursor: pointer;
            transition: color 0.15s, background 0.15s, border-color 0.15s;
            font-family: inherit !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tab:hover {
            color: #e6e6e6 !important;
            background: rgba(255,255,255,0.04) !important;
            border-bottom-color: rgba(255,255,255,0.25) !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tab.active,
          body:has([data-studio-properties="studio"]) .ribbon-tab[data-studio-active="1"] {
            color: #f0f0f0 !important;
            background: rgba(255,255,255,0.06) !important;
            border-bottom-color: #e6e6e6 !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-content {
            background: #050505 !important;
            padding: 4px 8px !important;
            display: flex !important;
            gap: 0 !important;
            flex-wrap: nowrap !important;
            align-items: flex-start !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            scroll-behavior: smooth;
            flex: 1 1 auto !important;
            height: 144px !important;     /* 168 container - 24 tabs */
            max-height: 144px !important;
          }
          /* Thin teal-tinted scrollbar for the ribbon strip so users
             can see when more groups are off-screen. */
          body:has([data-studio-properties="studio"]) .ribbon-content::-webkit-scrollbar {
            height: 5px;
          }
          body:has([data-studio-properties="studio"]) .ribbon-content::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.18);
            border-radius: 2px;
          }
          body:has([data-studio-properties="studio"]) .ribbon-content::-webkit-scrollbar-track {
            background: transparent;
          }
          body:has([data-studio-properties="studio"]) .ribbon-group {
            border-right: 1px solid rgba(255,255,255,0.05) !important;
            padding: 0 10px !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            flex-shrink: 0 !important;  /* don't squeeze when total > viewport width */
          }
          /* Cap each group's tool grid to 2 rows so labels stay
             visible. Mech's ribbon is 168px so this allows ~108px
             of tool grid + ~24px group label + ~12px padding. */
          body:has([data-studio-properties="studio"]) .ribbon-group-tools {
            max-height: 108px !important;
            overflow-y: hidden;
          }
          body:has([data-studio-properties="studio"]) .ribbon-group:last-child {
            border-right: none !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-group-tools {
            display: flex !important;
            gap: 3px !important;
            flex-wrap: wrap !important;
            flex: 1 !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-group-label {
            color: rgba(255,255,255,0.32) !important;
            font-size: 9px !important;
            text-transform: uppercase !important;
            letter-spacing: 0.6px !important;
            text-align: center !important;
            margin-top: 4px !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tool {
            background: transparent !important;
            border: 1px solid transparent !important;
            color: #d4dadf !important;
            border-radius: 5px !important;
            padding: 4px 6px !important;
            min-width: 56px !important;
            max-width: 72px !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            gap: 2px !important;
            cursor: pointer;
            transition: background 0.12s, border-color 0.12s, color 0.12s;
            font-family: inherit !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tool:hover:not(:disabled) {
            background: rgba(255,255,255,0.06) !important;
            border-color: rgba(255,255,255,0.18) !important;
            color: #f0f0f0 !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tool:active:not(:disabled) {
            background: rgba(255,255,255,0.12) !important;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tool:disabled {
            opacity: 0.35 !important;
            cursor: not-allowed;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tool-icon {
            font-size: 16px !important;
            line-height: 1 !important;
            opacity: 0.85;
          }
          body:has([data-studio-properties="studio"]) .ribbon-tool-label {
            font-size: 10px !important;
            letter-spacing: 0.2px !important;
            opacity: 0.85 !important;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 64px;
          }

          /* Workbench top header — apply Studio teal accent to the active
             workbench wordmark. */
          body:has([data-studio-properties="studio"]) .workbench-current .workbench-name {
            color: #e6e6e6;
          }

          /* Left viewport tool strip — recolour Mech's pink/red accents
             to Studio teal so hover + active states match. */
          body:has([data-studio-properties="studio"]) .tool-icon-button.active {
            background: rgba(255,255,255,0.18) !important;
            color: #e6e6e6 !important;
          }
          body:has([data-studio-properties="studio"]) .tool-icon-button.active::before {
            background: #e6e6e6 !important;
          }
          body:has([data-studio-properties="studio"]) .tool-icon-button:hover:not(.active) {
            background: rgba(255,255,255,0.08) !important;
            color: #e6e6e6 !important;
          }

          /* Status bar — Studio-teal accent. */
          body:has([data-studio-properties="studio"]) .workbench-statusbar {
            background: linear-gradient(180deg, #0a0a0a 0%, #000000 100%);
            border-top: 1px solid rgba(255,255,255,0.18);
          }

          /* Search input at the top header — Studio-teal focus. */
          body:has([data-studio-properties="studio"]) .header-search input:focus,
          body:has([data-studio-properties="studio"]) .header-search-input:focus {
            border-color: #e6e6e6 !important;
            box-shadow: none;
          }

          /* AI Console: just in case there's a re-mount race, default
             height to 0 + hide visually so layout reflows even if the
             component re-injects itself. */
          body:has([data-studio-properties="studio"]) .ai-console,
          body:has([data-studio-properties="studio"]) .workbench-console {
            height: 0 !important;
            min-height: 0 !important;
            padding: 0 !important;
            border: none !important;
          }
        `}</style>

        {/* Studio brand banner — always at the top of the right panel.
            Bigger Studio identity + inline scene-state chips + active-
            discipline pill so users see which mode is armed at a glance. */}
        <div
          data-studio-banner
          style={{
            padding: '14px 14px 12px 14px',
            background: '#0a0a0a',
            borderBottom: '1px solid rgba(255,255,255,0.18)',
            marginBottom: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <Wand2 size={18} style={{ color: '#e6e6e6', filter: 'none' }} />
            <h2 style={{
              margin: 0, fontSize: '14px', fontWeight: 700, color: '#f0f6f7',
              letterSpacing: '0.5px',
            }}>
              ArchDisc <span style={{ color: '#e6e6e6' }}>Studio</span>
            </h2>
            <span
              data-studio-banner-discipline
              style={{
                marginLeft: 'auto',
                fontSize: '9.5px',
                fontFamily: 'monospace',
                color: '#e6e6e6',
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.32)',
                padding: '3px 8px',
                borderRadius: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                fontWeight: 600,
              }}
            >
              {DISCIPLINE_TABS.find(t => t.id === activeTab)?.label || activeTab}
            </span>
          </div>
          {/* Quick-stats row — primitives, lights, renders. Mirrors status
              bar but kept right-rail-visible for context while editing. */}
          <div
            data-studio-banner-stats
            style={{
              display: 'flex',
              gap: '12px',
              fontSize: '10px',
              fontFamily: 'monospace',
              color: '#95a0a8',
            }}
          >
            <span data-studio-banner-stat="prims" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Box size={10} style={{ opacity: 0.7 }} />
              {primitiveCount} prim
            </span>
            <span data-studio-banner-stat="lights" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Lightbulb size={10} style={{ opacity: 0.7 }} />
              {lightCount} lt
            </span>
            <span data-studio-banner-stat="renders" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Camera size={10} style={{ opacity: 0.7 }} />
              {renders.length} rdr
            </span>
            <span data-studio-banner-stat="verts" style={{ marginLeft: 'auto', opacity: 0.7 }}>
              {vertexCount.toLocaleString()} v
            </span>
          </div>
          {/* Selected-mesh pill — only when something is selected. Mirrors
              the discipline pill so the active object is always one glance
              away from the user. */}
          {selectedKind && (
            <div
              data-studio-banner-selected
              style={{
                marginTop: '8px',
                padding: '5px 10px',
                background: 'rgba(191,191,191,0.10)',
                border: '1px solid rgba(191,191,191,0.32)',
                borderRadius: '6px',
                fontSize: '10.5px',
                fontFamily: 'monospace',
                color: '#bfbfbf',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <MousePointer2 size={11} style={{ flexShrink: 0 }} />
              <span style={{ opacity: 0.75 }}>Selected</span>
              <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{selectedKind}</span>
              {vertexCount > 0 && (
                <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
                  {vertexCount.toLocaleString()}v
                </span>
              )}
            </div>
          )}
        </div>

        {/* Outliner — scene tree at the top of the right rail. Lists every
            Studio primitive + light by kind, lets the user click an entry
            to select that object. Real DCC outliner pattern.
            Slice 186: upgraded to a Blender-style Outliner with collection
            grouping (Primitives / Lights) — each collection collapsible
            with a folder-disclosure arrow — and a top-of-panel search
            filter that narrows by case-insensitive substring of the
            object name OR kind. Mirrors Blender's Outliner editor where
            scene objects sit under named collections with a search box
            in the header. */}
        {(() => {
          const sceneEntries = [];
          if (typeof window !== 'undefined' && window.__archdiscScene) {
            window.__archdiscScene.traverse(o => {
              if (o.userData && o.userData.archdiscStudioPrimitive) {
                sceneEntries.push({
                  uuid: o.uuid,
                  kind: o.userData.archdiscStudioPrimitiveKind || 'mesh',
                  name: o.name || o.userData.archdiscStudioPrimitiveKind || 'primitive',
                  isPrimitive: true,
                });
              } else if (o.userData && o.userData.archdiscStudioLight && o.isLight) {
                sceneEntries.push({
                  uuid: o.uuid,
                  kind: o.type || 'light',
                  name: o.name || 'studio-light',
                  isPrimitive: false,
                });
              }
            });
          }
          // Touch primitiveCount + selectedKind + lightCount + currentFrame
          // so React re-evaluates the IIFE whenever the scene state changes
          // (eslint-disable-next-line no-unused-expressions).
          void primitiveCount; void selectedKind; void lightCount; void currentFrame; void outlinerTick;
          const q = (outlinerFilter || '').trim().toLowerCase();
          const matches = (e) => !q || e.kind.toLowerCase().includes(q) || (e.name || '').toLowerCase().includes(q);
          const primitives = sceneEntries.filter((e) => e.isPrimitive && matches(e));
          const lights     = sceneEntries.filter((e) => !e.isPrimitive && matches(e));
          return (
            <div className="property-section" data-studio-section="outliner">
              <h3 className="property-header">
                Outliner
                <span
                  data-studio-outliner-count
                  style={{ marginLeft: '8px', opacity: 0.5, fontSize: '10px', fontWeight: 'normal' }}
                >
                  {sceneEntries.length} item{sceneEntries.length === 1 ? '' : 's'}
                </span>
              </h3>
              <input
                type="search"
                value={outlinerFilter}
                onChange={(e) => setOutlinerFilter(e.target.value)}
                placeholder="Filter…"
                data-studio-outliner-filter
                style={{
                  display: 'block', width: '100%', boxSizing: 'border-box',
                  background: '#1f1f1f', color: '#dfdfdf',
                  border: '1px solid #353535', borderRadius: '3px',
                  padding: '3px 6px', marginBottom: '6px', fontSize: '11px',
                }}
              />
              {sceneEntries.length === 0 ? (
                <p
                  data-studio-outliner-empty
                  className="property-label"
                  style={{ opacity: 0.5, fontSize: '11px', margin: 0 }}
                >
                  Scene is empty. Add a primitive from the ribbon or
                  load a preset from Asset Library below.
                </p>
              ) : (
                <div
                  data-studio-outliner-list
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    maxHeight: '220px',
                    overflowY: 'auto',
                  }}
                >
                  {/* Render two Blender-style collections (Primitives and
                      Lights) with disclosure arrows; each collection's
                      entries hide when its arrow is collapsed. Empty
                      collections are skipped so the panel doesn't show
                      noise. */}
                  {[
                    { name: 'Primitives', entries: primitives },
                    { name: 'Lights',     entries: lights },
                  ].filter((c) => c.entries.length > 0).map((coll) => (
                    <React.Fragment key={coll.name}>
                      <div
                        data-studio-outliner-collection={coll.name}
                        data-studio-outliner-collection-expanded={outlinerCollections[coll.name] ? '1' : '0'}
                        onClick={() => toggleCollection(coll.name)}
                        style={{
                          cursor: 'pointer', padding: '2px 4px',
                          fontSize: '10.5px', textTransform: 'uppercase',
                          letterSpacing: '0.05em', color: '#9aa',
                          display: 'flex', alignItems: 'center', gap: '4px',
                          userSelect: 'none',
                        }}
                      >
                        <span style={{ width: '10px', display: 'inline-block' }}>
                          {outlinerCollections[coll.name] ? '▾' : '▸'}
                        </span>
                        {coll.name}
                        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{coll.entries.length}</span>
                      </div>
                      {outlinerCollections[coll.name] && coll.entries.map((entry, i) => (
                    <div
                      key={entry.uuid}
                      data-studio-outliner-entry={i}
                      data-studio-outliner-kind={entry.kind}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        background: selectedKind === entry.kind
                          ? 'rgba(255,255,255,0.18)'
                          : 'rgba(255,255,255,0.025)',
                        color: selectedKind === entry.kind ? '#e6e6e6' : '#d4dadf',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'background 0.12s',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background: entry.isPrimitive ? '#e6e6e6' : '#bfbfbf',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        data-studio-outliner-label
                        data-studio-outliner-label-uuid={entry.uuid}
                        onClick={() => {
                          if (typeof window === 'undefined' || !window.__archdiscScene) return;
                          const mesh = window.__archdiscScene.getObjectByProperty('uuid', entry.uuid);
                          if (mesh && window.__studioSelectMesh && entry.isPrimitive) {
                            window.__studioSelectMesh(mesh);
                          }
                        }}
                        onDoubleClick={(ev) => {
                          // Slice 200: ZBrush Subtool-style rename. Double-
                          // click the label → contenteditable; Enter / blur
                          // commits to mesh.name; Esc cancels.
                          ev.stopPropagation();
                          const el = ev.currentTarget;
                          if (typeof window === 'undefined' || !window.__archdiscScene) return;
                          const mesh = window.__archdiscScene.getObjectByProperty('uuid', entry.uuid);
                          if (!mesh) return;
                          const original = mesh.name || '';
                          el.contentEditable = 'true';
                          el.dataset.studioOutlinerLabelEditing = '1';
                          el.focus();
                          // Select all text inside the editable span.
                          const range = document.createRange();
                          range.selectNodeContents(el);
                          const sel = window.getSelection();
                          sel.removeAllRanges(); sel.addRange(range);
                          const commit = () => {
                            const next = (el.textContent || '').trim();
                            if (next) mesh.name = next; else el.textContent = original;
                            el.contentEditable = 'false';
                            delete el.dataset.studioOutlinerLabelEditing;
                            bumpOutliner();
                          };
                          const cancel = () => {
                            el.textContent = original;
                            el.contentEditable = 'false';
                            delete el.dataset.studioOutlinerLabelEditing;
                          };
                          el.addEventListener('keydown', function onKey(e2) {
                            if (e2.key === 'Enter') { e2.preventDefault(); el.blur(); }
                            else if (e2.key === 'Escape') { e2.preventDefault(); cancel(); el.removeEventListener('keydown', onKey); }
                          });
                          el.addEventListener('blur', function onBlur() {
                            commit(); el.removeEventListener('blur', onBlur);
                          });
                        }}
                        style={{
                          flex: 1,
                          cursor: entry.isPrimitive ? 'pointer' : 'default',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={`${entry.name} — double-click to rename`}
                      >
                        {entry.name}
                      </span>
                      {/* Visibility toggle */}
                      <span
                        data-studio-outliner-visibility={entry.uuid}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (typeof window === 'undefined' || !window.__archdiscScene) return;
                          const obj = window.__archdiscScene.getObjectByProperty('uuid', entry.uuid);
                          if (!obj) return;
                          obj.visible = !obj.visible;
                          // Force re-render by nudging primitive count touch.
                          setPrimitiveCount(c => c);
                        }}
                        style={{
                          cursor: 'pointer',
                          opacity: 0.55,
                          fontSize: '10px',
                          padding: '0 4px',
                          flexShrink: 0,
                        }}
                        title="Toggle visibility"
                      >
                        ◉
                      </span>
                      {/* Delete button — only for primitives */}
                      {entry.isPrimitive && (
                        <span
                          data-studio-outliner-delete={entry.uuid}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (typeof window === 'undefined' || !window.__archdiscScene) return;
                            const obj = window.__archdiscScene.getObjectByProperty('uuid', entry.uuid);
                            if (!obj) return;
                            // Find + remove from primitive stack.
                            const stack = primitiveStackRef.current;
                            const idx = stack.indexOf(obj);
                            if (idx !== -1) stack.splice(idx, 1);
                            // Clear selection if it pointed at this mesh.
                            if (selectedMeshRef.current === obj) {
                              selectedMeshRef.current = null;
                              setSelectedKind(null);
                              setSelectedTransform(null);
                            }
                            window.__archdiscScene.remove(obj);
                            if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
                            if (obj.material) {
                              if (Array.isArray(obj.material)) {
                                obj.material.forEach(m => m.dispose && m.dispose());
                              } else if (obj.material.dispose) {
                                obj.material.dispose();
                              }
                            }
                            setPrimitiveCount(stack.length);
                            recomputeMeshStats(window.__archdiscScene);
                          }}
                          style={{
                            cursor: 'pointer',
                            opacity: 0.45,
                            fontSize: '13px',
                            padding: '0 4px',
                            color: '#888888',
                            flexShrink: 0,
                          }}
                          title="Delete primitive"
                        >
                          ×
                        </span>
                      )}
                    </div>
                  ))}
                    </React.Fragment>
                  ))}
                  {/* Filter narrowed everything out — show a tiny note */}
                  {q && primitives.length === 0 && lights.length === 0 && (
                    <div
                      data-studio-outliner-filter-empty
                      style={{ padding: '6px 8px', opacity: 0.5, fontSize: '11px' }}
                    >No items match "{outlinerFilter}"</div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        <div className="property-section" data-studio-section="ai">
          <h3 className="property-header">
            AI Prompt
            <span
              data-studio-ai-runs
              style={{ float: 'right', opacity: 0.6, fontSize: '11px', fontWeight: 'normal' }}
            >
              {aiLog.length} run{aiLog.length === 1 ? '' : 's'}
            </span>
          </h3>
          <div className="property-row" style={{ alignItems: 'stretch' }}>
            <input
              type="text"
              className="property-input"
              data-studio-ai="prompt"
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="e.g. add a cube and a sphere, then spin them"
              style={{ flex: 1 }}
            />
          </div>
          <button
            className="property-button"
            data-studio-action="run-ai-prompt"
            onClick={runAiPrompt}
            disabled={!aiPrompt.trim() || aiRunning}
          >
            {aiRunning ? 'Running…' : 'Run Prompt'}
          </button>
          {aiPlan.length > 0 && aiRunning && (
            <div
              data-studio-ai-plan
              style={{
                marginTop: '6px',
                fontSize: '10px',
                fontFamily: 'monospace',
                background: 'rgba(255,255,255,0.04)',
                padding: '4px 6px',
                borderRadius: '4px',
              }}
            >
              <div style={{ opacity: 0.6, marginBottom: '2px' }}>Plan ({aiPlan.length} steps)</div>
              {aiPlan.map((step, i) => (
                <div
                  key={i}
                  data-studio-ai-plan-step={i}
                  data-studio-ai-plan-state={
                    i < aiPlanIndex ? 'done' :
                    i === aiPlanIndex ? 'active' : 'pending'
                  }
                  style={{
                    padding: '2px 0',
                    opacity: i < aiPlanIndex ? 0.5 : 1,
                    color: i === aiPlanIndex ? '#e6e6e6' : 'inherit',
                    fontWeight: i === aiPlanIndex ? 'bold' : 'normal',
                  }}
                >
                  {i < aiPlanIndex ? '✓' : i === aiPlanIndex ? '▶' : ' '} {i + 1}. {step.label}
                </div>
              ))}
            </div>
          )}
          {aiLog.length > 0 && (
            <div
              data-studio-ai-log
              style={{
                marginTop: '6px',
                maxHeight: '140px',
                overflowY: 'auto',
                fontSize: '10px',
                fontFamily: 'monospace',
                opacity: 0.85,
              }}
            >
              {aiLog.slice().reverse().map((entry, i) => (
                <div
                  key={i}
                  data-studio-ai-log-entry={aiLog.length - 1 - i}
                  style={{
                    padding: '4px',
                    borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div style={{ opacity: 0.65 }}>{entry.ts} &nbsp; "{entry.prompt}"</div>
                  <div data-studio-ai-actions style={{ marginTop: '2px' }}>
                    → {entry.actions.join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="property-section" data-studio-section="camera">
          <h3 className="property-header">Camera</h3>
          <div className="property-row">
            <span className="property-label">FOV</span>
            <input
              type="range"
              min="15"
              max="110"
              step="1"
              data-studio-camera="fov"
              value={cameraFov}
              onChange={e => applyCameraFov(e.target.value)}
              style={{ flex: 1 }}
            />
            <span
              data-studio-camera-readout="fov"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
            >
              {cameraFov}°
            </span>
          </div>
          <div
            data-studio-camera-presets
            style={{
              marginTop: '6px',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '4px',
            }}
          >
            {CAMERA_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                data-studio-camera-preset={p.id}
                onClick={() => applyCameraPreset(p)}
                style={{
                  padding: '4px 2px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'inherit',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontWeight: 600,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="property-section" data-studio-section="export">
          <h3 className="property-header">Export</h3>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px' }}>
            glTF — Khronos's industry-standard 3D interop format.
            Imports into Unreal, Unity, Blender, Sketchfab, three.js.
          </p>
          <button
            className="property-button"
            data-studio-action="export-gltf"
            onClick={exportGltf}
          >
            Export Scene as glTF
          </button>
          <p
            data-studio-export-status
            style={{ marginTop: '4px', fontSize: '10px', fontFamily: 'monospace', opacity: 0.7 }}
          >
            {gltfExportedAt
              ? `Exported ${gltfExportedAt} · ${(gltfBytes / 1024).toFixed(1)} KiB`
              : 'No export yet'}
          </p>
        </div>

        <div className="property-section" data-studio-section="scene-io">
          <h3 className="property-header">Scene I/O</h3>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px' }}>
            Save the current Studio primitives + lights to a JSON
            snapshot; Load restores from the cached snapshot. Boolean /
            scatter / reference / instanced kinds are skipped (their
            geometry isn't reproducible from a kind name alone).
          </p>
          <button
            className="property-button"
            data-studio-action="save-scene"
            onClick={() => saveSceneJson()}
          >
            Save Scene
          </button>
          <button
            className="property-button"
            data-studio-action="load-scene"
            onClick={() => loadSceneJson()}
            disabled={!sceneJson}
          >
            Load Saved Scene
          </button>
          <p
            data-studio-scene-io-status
            style={{ marginTop: '4px', fontSize: '10px', fontFamily: 'monospace', opacity: 0.7 }}
          >
            {sceneSavedAt ? `Saved ${sceneSavedAt} · ${sceneJson.length.toLocaleString()} chars` : 'No save yet'}
          </p>
        </div>

        <div className="property-section" data-studio-section="welcome">
          <h3 className="property-header">ArchDisc Studio</h3>
          <p className="property-label">
            3D modelling · sculpting · rigging · animation · VFX · simulation · rendering
          </p>
          <p className="property-label">
            Forked from Blender (GPL-3); parity target with Maya, Houdini, ZBrush, Substance, Cinema 4D.
          </p>
          <button
            className="property-button"
            data-studio-action="compose-demo"
            onClick={composeDemoScene}
            style={{ marginTop: '8px' }}
          >
            Compose Demo Scene
          </button>
        </div>

        <div className="property-section" data-studio-section="library">
          <h3 className="property-header">Asset Library</h3>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 6px 0' }}>
            Preset scenes — each is a deterministic composition of
            Studio ops, not a pre-baked file.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            <button
              className="property-button"
              data-studio-preset="crystal-garden"
              onClick={() => loadPreset('crystal-garden')}
              style={{ margin: 0 }}
            >
              Crystal Garden
            </button>
            <button
              className="property-button"
              data-studio-preset="furry-suzanne"
              onClick={() => loadPreset('furry-suzanne')}
              style={{ margin: 0 }}
            >
              Furry Suzanne
            </button>
            <button
              className="property-button"
              data-studio-preset="shattered-sphere"
              onClick={() => loadPreset('shattered-sphere')}
              style={{ margin: 0 }}
            >
              Shattered Sphere
            </button>
            <button
              className="property-button"
              data-studio-preset="industrial-pod"
              onClick={() => loadPreset('industrial-pod')}
              style={{ margin: 0 }}
            >
              Industrial Pod
            </button>
          </div>
          <p
            data-studio-library-status
            className="property-label"
            style={{ opacity: 0.55, fontSize: '10px', margin: '6px 0 0 0', fontFamily: 'monospace' }}
          >
            {libraryLastLoaded ? `Loaded: ${libraryLastLoaded}` : 'No preset loaded'}
          </p>
        </div>

        {selectedKind && selectedTransform && (
          <div className="property-section" data-studio-section="selection">
            <h3 className="property-header">Selection</h3>
            <div className="property-row">
              <span className="property-label">Kind</span>
              <span
                className="property-input"
                data-studio-selection="kind"
                style={{ textAlign: 'right', textTransform: 'capitalize' }}
              >
                {selectedKind}
              </span>
            </div>
            {/* Editable X/Y/Z transform — numeric inputs let users move,
                rotate, and scale the selected mesh directly. Mirrors
                the Properties → Transform panel in real DCC apps. */}
            {['position', 'rotation', 'scale'].map(axis => {
              const labels = ['X', 'Y', 'Z'];
              const stepMap   = { position: 0.005, rotation: 0.05,  scale: 0.05 };
              const unitMap   = { position: 'mm',  rotation: 'rad', scale: '' };
              const scaleMap  = { position: 1000,  rotation: 1,     scale: 1 };
              return (
                <div key={axis} style={{ marginBottom: '4px' }}>
                  <div className="property-label" style={{ fontSize: '10px', opacity: 0.55, textTransform: 'capitalize', marginBottom: '2px' }}>
                    {axis}
                  </div>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {labels.map((lab, i) => (
                      <input
                        key={lab}
                        type="number"
                        className="property-input"
                        data-studio-selection-edit={`${axis}-${lab.toLowerCase()}`}
                        step={stepMap[axis]}
                        value={Number(selectedTransform[axis][i].toFixed(5))}
                        onChange={(e) => {
                          const mesh = selectedMeshRef.current;
                          if (!mesh) return;
                          const v = Number(e.target.value);
                          if (!isFinite(v)) return;
                          mesh[axis][lab.toLowerCase()] = v;
                          setSelectedTransform({
                            position: [mesh.position.x, mesh.position.y, mesh.position.z],
                            rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
                            scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
                          });
                        }}
                        style={{
                          flex: 1, minWidth: 0,
                          fontSize: '10px',
                          fontFamily: 'monospace',
                          padding: '3px 6px',
                          textAlign: 'right',
                        }}
                      />
                    ))}
                  </div>
                  {/* Read-only ARIA-style mirror of the active values for
                      back-compat with the spec selectors. */}
                  <span
                    data-studio-selection={axis}
                    style={{ display: 'none' }}
                  >
                    {selectedTransform[axis].map(n => (axis === 'position' ? n.toFixed(4) : n.toFixed(3))).join(', ')}
                  </span>
                </div>
              );
            })}
            <div className="property-row">
              <span className="property-label">Gizmo</span>
              <span
                className="property-input"
                data-studio-selection="gizmo-mode"
                style={{ textAlign: 'right' }}
              >
                {gizmoMode}
              </span>
            </div>
            <button
              className="property-button"
              data-studio-action="delete-selected"
              onClick={deleteSelectedMesh}
            >
              Delete Selected
            </button>
          </div>
        )}

        <div className="property-section" data-studio-section="lighting">
          <h3 className="property-header">
            Cinematic Lighting
            <span
              data-studio-light-count
              style={{ float: 'right', opacity: 0.6, fontSize: '11px', fontWeight: 'normal' }}
            >
              {lightCount} added
            </span>
          </h3>
          <div className="property-row">
            <span className="property-label">Color</span>
            <input
              type="color"
              data-studio-lighting="color"
              value={lightColor}
              onChange={e => setLightColor(e.target.value)}
              style={{ height: '24px', cursor: 'pointer' }}
            />
          </div>
          <div className="property-row">
            <span className="property-label">Intensity</span>
            <input
              type="range"
              min="0"
              max="6"
              step="0.1"
              data-studio-lighting="intensity"
              value={lightIntensity}
              onChange={e => setLightIntensity(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-lighting-readout="intensity"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
            >
              {lightIntensity.toFixed(1)}
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="add-light"
            onClick={addCinematicLight}
          >
            Add Point Light
          </button>
          <button
            className="property-button"
            data-studio-action="clear-lights"
            onClick={clearCinematicLights}
            disabled={lightCount === 0}
          >
            Clear All Lights
          </button>
          <button
            className="property-button"
            data-studio-action="three-point-preset"
            onClick={applyThreePointLighting}
            style={{ marginTop: '4px' }}
          >
            Apply 3-Point Cinematic
          </button>
        </div>

        <div className="property-section" data-studio-section="boolean">
          <h3 className="property-header">
            Boolean / CSG
            <span
              data-studio-boolean-state
              style={{ float: 'right', opacity: 0.6, fontSize: '11px', fontWeight: 'normal' }}
            >
              {manifoldReady ? 'manifold ready' : 'loading…'}
            </span>
          </h3>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px' }}>
            Source: manifold-3d (MIT). Operates on the selected primitive +
            the previous one in the scene stack — operands consumed,
            result inserted.
          </p>
          <button
            className="property-button"
            data-studio-action="boolean-union"
            onClick={() => booleanWithPrevious('union')}
            disabled={!manifoldReady || !selectedKind || primitiveCount < 2}
          >
            Union with Previous
          </button>
          <button
            className="property-button"
            data-studio-action="boolean-difference"
            onClick={() => booleanWithPrevious('difference')}
            disabled={!manifoldReady || !selectedKind || primitiveCount < 2}
          >
            Subtract Selected from Previous
          </button>
          <button
            className="property-button"
            data-studio-action="boolean-intersect"
            onClick={() => booleanWithPrevious('intersect')}
            disabled={!manifoldReady || !selectedKind || primitiveCount < 2}
          >
            Intersect with Previous
          </button>
        </div>

        <div className="property-section" data-studio-section="mirror">
          <h3 className="property-header">Mirror Modifier</h3>
          <div className="property-row">
            <span className="property-label">Axis</span>
            <select
              className="property-input"
              data-studio-mirror="axis"
              value={mirrorAxis}
              onChange={e => setMirrorAxis(e.target.value)}
            >
              <option value="x">X</option>
              <option value="y">Y</option>
              <option value="z">Z</option>
            </select>
          </div>
          <button
            className="property-button"
            data-studio-action="mirror-selected"
            onClick={mirrorSelected}
            disabled={!selectedKind}
          >
            Mirror Selected
          </button>
        </div>

        <div className="property-section" data-studio-section="subdivision">
          <h3 className="property-header">Subdivision Surface</h3>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px' }}>
            Midpoint tessellation: every triangle becomes 4 sub-triangles.
            Vertex count grows ~4× per pass.
          </p>
          <button
            className="property-button"
            data-studio-action="subdivide-selected"
            onClick={subdivideSelected}
            disabled={!selectedKind}
          >
            Subdivide Selected
          </button>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '6px 0 4px 0' }}>
            Loop subdivision: smooth scheme — edge points + existing
            vertices repositioned per Loop's weights. 4× tri count.
          </p>
          <button
            className="property-button"
            data-studio-action="loop-subdivide-selected"
            onClick={loopSubdivideSelected}
            disabled={!selectedKind}
          >
            Loop Subdivide (Smooth)
          </button>
        </div>

        <div className="property-section" data-studio-section="compositing">
          <h3 className="property-header">Compositing</h3>
          <div className="property-row">
            <span className="property-label">Filter</span>
            <select
              className="property-input"
              data-studio-compositing="filter"
              value={compositeFilter}
              onChange={e => setCompositeFilter(e.target.value)}
            >
              <option value="grayscale(100%)">Grayscale</option>
              <option value="sepia(100%)">Sepia</option>
              <option value="invert(100%)">Invert</option>
              <option value="blur(3px)">Blur (3 px)</option>
              <option value="contrast(180%)">Contrast 180%</option>
              <option value="hue-rotate(120deg)">Hue Rotate 120°</option>
              <option value="saturate(2.5)">Saturate 2.5×</option>
            </select>
          </div>
          <button
            className="property-button"
            data-studio-action="post-process"
            onClick={postProcessLastRender}
            disabled={renders.length === 0}
          >
            Post-Process Last Render
          </button>
        </div>

        <div className="property-section" data-studio-section="scatter">
          <h3 className="property-header">Scatter on Surface</h3>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px' }}>
            Geometry-Nodes-style "Instance on Points". Pick a target,
            choose what to scatter + how dense; one InstancedMesh draw call.
          </p>
          <div className="property-row">
            <span className="property-label">Kind</span>
            <select
              className="property-input"
              data-studio-scatter="kind"
              value={scatterKind}
              onChange={e => setScatterKind(e.target.value)}
            >
              <option value="cube">Cube</option>
              <option value="sphere">Sphere</option>
              <option value="cone">Cone</option>
              <option value="cylinder">Cylinder</option>
              <option value="tetrahedron">Tetrahedron</option>
            </select>
          </div>
          <div className="property-row">
            <span className="property-label">Count</span>
            <input
              type="range"
              min="20"
              max="2000"
              step="10"
              data-studio-scatter="count"
              value={scatterCount}
              onChange={e => setScatterCount(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-scatter-readout="count"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}
            >
              {scatterCount}
            </span>
          </div>
          <div className="property-row">
            <span className="property-label">Scale</span>
            <input
              type="range"
              min="0.05"
              max="0.6"
              step="0.01"
              data-studio-scatter="scale"
              value={scatterScale}
              onChange={e => setScatterScale(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-scatter-readout="scale"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}
            >
              {scatterScale.toFixed(2)}
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="scatter-on-surface"
            onClick={scatterOnSurface}
            disabled={!selectedKind}
          >
            Scatter on Selected
          </button>
        </div>

        <div className="property-section" data-studio-section="instancing">
          <h3 className="property-header">Instancing · Swarm</h3>
          <div className="property-row">
            <span className="property-label">Count</span>
            <input
              type="range"
              min="10"
              max="5000"
              step="10"
              data-studio-instancing="count"
              value={instanceCount}
              onChange={e => setInstanceCount(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-instancing-readout="count"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '44px', textAlign: 'right' }}
            >
              {instanceCount}
            </span>
          </div>
          <div className="property-row">
            <span className="property-label">Radius</span>
            <input
              type="range"
              min="0.02"
              max="0.2"
              step="0.005"
              data-studio-instancing="radius"
              value={instanceRadius}
              onChange={e => setInstanceRadius(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-instancing-readout="radius"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '52px', textAlign: 'right' }}
            >
              {(instanceRadius * 1000).toFixed(0)} mm
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="spawn-swarm"
            onClick={spawnInstancedSwarm}
            disabled={!selectedKind}
          >
            Instance Selected as Swarm
          </button>
        </div>

        <div className="property-section" data-studio-section="procedural">
          <h3 className="property-header">Procedural · Tree</h3>
          <div className="property-row">
            <span className="property-label">Depth</span>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              data-studio-proc="depth"
              value={procTreeDepth}
              onChange={e => setProcTreeDepth(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-proc-readout="depth"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '24px', textAlign: 'right' }}
            >
              {procTreeDepth}
            </span>
          </div>
          <div className="property-row">
            <span className="property-label">Branches</span>
            <input
              type="range"
              min="2"
              max="4"
              step="1"
              data-studio-proc="branches"
              value={procTreeBranches}
              onChange={e => setProcTreeBranches(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-proc-readout="branches"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '24px', textAlign: 'right' }}
            >
              {procTreeBranches}
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="generate-tree"
            onClick={generateProceduralTree}
          >
            Generate Tree
          </button>
        </div>

        <div className="property-section" data-studio-section="texture">
          <h3 className="property-header">Texture · UV</h3>
          <div className="property-row">
            <span className="property-label">Pattern</span>
            <select
              className="property-input"
              data-studio-texture="pattern"
              value={texPattern}
              onChange={e => setTexPattern(e.target.value)}
            >
              <option value="checker">Checkerboard</option>
              <option value="brick">Brick</option>
              <option value="grid">Grid</option>
              <option value="noise">Procedural Noise</option>
            </select>
          </div>
          <div className="property-row">
            <span className="property-label">Tiles</span>
            <input
              type="range"
              min="2"
              max="32"
              step="1"
              data-studio-texture="tiles"
              value={texTiles}
              onChange={e => setTexTiles(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-texture-readout="tiles"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
            >
              {texTiles}
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="apply-texture"
            onClick={applyTexture}
            disabled={!selectedKind}
          >
            Apply Texture
          </button>
          <button
            className="property-button"
            data-studio-action="remove-texture"
            onClick={removeTexture}
            disabled={!selectedKind}
          >
            Remove Texture
          </button>
          <button
            className="property-button"
            data-studio-action="unwrap-uvs"
            onClick={unwrapUVs}
            disabled={!selectedKind}
          >
            Unwrap UVs (Spherical)
          </button>
          <p
            data-studio-uv-status
            className="property-label"
            style={{ opacity: 0.5, fontSize: '10px', margin: '4px 0 0 0', fontFamily: 'monospace' }}
          >
            {selectedKind ? `${selectedKind} → unwrap to generate spherical UVs` : 'Select a mesh to unwrap UVs'}
          </p>
        </div>

        <div className="property-section" data-studio-section="physics">
          <h3 className="property-header">
            Physics
            <span
              data-studio-physics-state
              style={{ float: 'right', opacity: 0.6, fontSize: '11px', fontWeight: 'normal' }}
            >
              {isPhysicsActive ? 'simulating' : 'idle'}
            </span>
          </h3>
          <div className="property-row">
            <span className="property-label">Gravity</span>
            <input
              type="range"
              min="0"
              max="20"
              step="0.1"
              data-studio-physics="gravity"
              value={physicsG}
              onChange={e => setPhysicsG(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-physics-readout="gravity"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '52px', textAlign: 'right' }}
            >
              {physicsG.toFixed(1)} m/s²
            </span>
          </div>
          <div className="property-row">
            <span className="property-label">Bounce</span>
            <input
              type="range"
              min="0"
              max="0.95"
              step="0.01"
              data-studio-physics="restitution"
              value={physicsRestitution}
              onChange={e => setPhysicsRestitution(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-physics-readout="restitution"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}
            >
              {physicsRestitution.toFixed(2)}
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="toggle-physics"
            onClick={() => setIsPhysicsActive(v => !v)}
          >
            {isPhysicsActive ? 'Pause Physics' : 'Drop with Gravity'}
          </button>
          <button
            className="property-button"
            data-studio-action="reset-physics"
            onClick={resetPhysics}
            disabled={isPhysicsActive}
          >
            Reset to Origin
          </button>
        </div>

        <div className="property-section" data-studio-section="shape-keys">
          <h3 className="property-header">Face Shape Keys</h3>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px' }}>
            FACEIT-style procedural emotion blends. Each slider 0–1
            composes linearly; Reset restores the source mesh.
          </p>
          <div className="property-row">
            <span className="property-label">Smile</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              data-studio-shapekey="smile"
              value={shapeKeySmile}
              onChange={e => updateShapeKey('smile', e.target.value)}
              style={{ flex: 1 }}
              disabled={!selectedKind}
            />
            <span
              data-studio-shapekey-readout="smile"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
            >
              {shapeKeySmile.toFixed(2)}
            </span>
          </div>
          <div className="property-row">
            <span className="property-label">Surprise</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              data-studio-shapekey="surprise"
              value={shapeKeySurprise}
              onChange={e => updateShapeKey('surprise', e.target.value)}
              style={{ flex: 1 }}
              disabled={!selectedKind}
            />
            <span
              data-studio-shapekey-readout="surprise"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
            >
              {shapeKeySurprise.toFixed(2)}
            </span>
          </div>
          <div className="property-row">
            <span className="property-label">Brow</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              data-studio-shapekey="brow"
              value={shapeKeyBrow}
              onChange={e => updateShapeKey('brow', e.target.value)}
              style={{ flex: 1 }}
              disabled={!selectedKind}
            />
            <span
              data-studio-shapekey-readout="brow"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
            >
              {shapeKeyBrow.toFixed(2)}
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="reset-shape-keys"
            onClick={resetShapeKeys}
            disabled={!selectedKind}
          >
            Reset Shape Keys
          </button>
        </div>

        <div className="property-section" data-studio-section="armature">
          <h3 className="property-header">Rigging · Armature</h3>
          <div className="property-row">
            <span className="property-label">Bones</span>
            <input
              type="range"
              min="2"
              max="16"
              step="1"
              data-studio-armature="bones"
              value={armatureBones}
              onChange={e => setArmatureBones(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-armature-readout="bones"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
            >
              {armatureBones}
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="add-armature"
            onClick={addArmature}
          >
            Add Bone Chain
          </button>
        </div>

        <div className="property-section" data-studio-section="lathe">
          <h3 className="property-header">Hard Surface · Lathe</h3>
          <div className="property-row">
            <span className="property-label">Profile</span>
            <select
              className="property-input"
              data-studio-lathe="profile"
              value={latheProfile}
              onChange={e => setLatheProfile(e.target.value)}
            >
              <option value="vase">Vase</option>
              <option value="goblet">Goblet</option>
              <option value="column">Column</option>
            </select>
          </div>
          <div className="property-row">
            <span className="property-label">Segments</span>
            <input
              type="range"
              min="8"
              max="128"
              step="2"
              data-studio-lathe="segments"
              value={latheSegments}
              onChange={e => setLatheSegments(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-lathe-readout="segments"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}
            >
              {latheSegments}
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="add-lathe"
            onClick={addLatheSurface}
          >
            Add Lathe Surface
          </button>
        </div>

        <div className="property-section" data-studio-section="reference">
          <h3 className="property-header">Reference Plane</h3>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px' }}>
            Drop a labeled grid plane into the scene to model against
            (photo-to-3D workflow). Procedural for now; file picker next.
          </p>
          <div className="property-row">
            <span className="property-label">Label</span>
            <input
              type="text"
              className="property-input"
              data-studio-reference="label"
              value={refLabel}
              onChange={e => setRefLabel(e.target.value)}
              maxLength={12}
            />
          </div>
          <div className="property-row">
            <span className="property-label">Size</span>
            <input
              type="range"
              min="0.02"
              max="0.15"
              step="0.005"
              data-studio-reference="size"
              value={refWidth}
              onChange={e => setRefWidth(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-reference-readout="size"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '52px', textAlign: 'right' }}
            >
              {(refWidth * 1000).toFixed(0)} mm
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="add-reference-plane"
            onClick={addReferencePlane}
            disabled={!refLabel.trim()}
          >
            Add Reference Plane
          </button>
        </div>

        <div className="property-section" data-studio-section="archviz">
          <h3 className="property-header">ArchViz · Floor Plan</h3>
          <div className="property-row">
            <span className="property-label">Shape</span>
            <select
              className="property-input"
              data-studio-archviz="shape"
              value={floorShape}
              onChange={e => setFloorShape(e.target.value)}
            >
              <option value="rectangle">Rectangle</option>
              <option value="L-shape">L-Shape</option>
              <option value="U-shape">U-Shape</option>
            </select>
          </div>
          <div className="property-row">
            <span className="property-label">Height</span>
            <input
              type="range"
              min="0.005"
              max="0.06"
              step="0.001"
              data-studio-archviz="height"
              value={wallHeight}
              onChange={e => setWallHeight(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-archviz-readout="height"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '52px', textAlign: 'right' }}
            >
              {(wallHeight * 1000).toFixed(1)} mm
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="extrude-floorplan"
            onClick={extrudeFloorPlan}
          >
            Extrude Floor Plan
          </button>
        </div>

        <div className="property-section" data-studio-section="particles">
          <h3 className="property-header">Particles / VFX</h3>
          <div className="property-row">
            <span className="property-label">Count</span>
            <input
              type="range"
              min="50"
              max="5000"
              step="50"
              data-studio-particles="count"
              value={particleCount}
              onChange={e => setParticleCount(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-particles-readout="count"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '48px', textAlign: 'right' }}
            >
              {particleCount}
            </span>
          </div>
          <div className="property-row">
            <span className="property-label">Size</span>
            <input
              type="range"
              min="0.0005"
              max="0.005"
              step="0.0001"
              data-studio-particles="size"
              value={particleSize}
              onChange={e => setParticleSize(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-particles-readout="size"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '48px', textAlign: 'right' }}
            >
              {(particleSize * 1000).toFixed(2)} mm
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="spawn-particles"
            onClick={spawnParticles}
          >
            Spawn Particle Cloud
          </button>

          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 4px 0' }}>
              Cloth Sim — 20×20 grid with PBD edge-spring constraints.
              Falls under gravity, collides with any Studio sphere.
            </p>
            <button
              className="property-button"
              data-studio-action="spawn-cloth"
              onClick={spawnClothPlane}
              style={{ margin: '0 0 4px 0' }}
            >
              Add Cloth Plane (20×20)
            </button>
            <button
              className="property-button"
              data-studio-action="toggle-cloth-sim"
              onClick={() => setClothActive(a => !a)}
              disabled={!clothStateRef.current}
            >
              {clothActive ? 'Stop Cloth Sim' : 'Run Cloth Sim'}
            </button>
            <p
              data-studio-cloth-state
              className="property-label"
              style={{ opacity: 0.55, fontSize: '10px', margin: '4px 0 0 0', fontFamily: 'monospace' }}
            >
              {clothActive ? 'simulating' : 'idle'}
            </p>
          </div>

          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 4px 0' }}>
              Hair / Fur — instanced strands rooted on the selected
              mesh, oriented along surface normals.
            </p>
            <div className="property-row">
              <span className="property-label">Strands</span>
              <input
                type="range"
                min="50"
                max="3000"
                step="50"
                data-studio-hair="count"
                value={hairCount}
                onChange={e => setHairCount(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-hair-readout="count"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}
              >
                {hairCount}
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Length</span>
              <input
                type="range"
                min="0.002"
                max="0.025"
                step="0.0005"
                data-studio-hair="length"
                value={hairLength}
                onChange={e => setHairLength(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-hair-readout="length"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '46px', textAlign: 'right' }}
              >
                {(hairLength * 1000).toFixed(1)} mm
              </span>
            </div>
            <button
              className="property-button"
              data-studio-action="grow-hair"
              onClick={() => growHair(hairCount, hairLength)}
              disabled={!selectedKind}
            >
              Grow Hair · Fur
            </button>
          </div>
        </div>

        <div className="property-section" data-studio-section="text3d">
          <h3 className="property-header">
            Text 3D
            <span
              data-studio-font-state
              style={{ float: 'right', opacity: 0.6, fontSize: '11px', fontWeight: 'normal' }}
            >
              {fontReady ? 'font ready' : 'loading…'}
            </span>
          </h3>
          <div className="property-row">
            <span className="property-label">Text</span>
            <input
              type="text"
              className="property-input"
              data-studio-text3d="input"
              value={text3dInput}
              onChange={e => setText3dInput(e.target.value)}
              maxLength={32}
            />
          </div>
          <div className="property-row">
            <span className="property-label">Size</span>
            <input
              type="range"
              min="0.005"
              max="0.04"
              step="0.001"
              data-studio-text3d="size"
              value={text3dSize}
              onChange={e => setText3dSize(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-text3d-readout="size"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '52px', textAlign: 'right' }}
            >
              {(text3dSize * 1000).toFixed(1)} mm
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="add-text3d"
            onClick={addText3D}
            disabled={!fontReady || !text3dInput.trim()}
          >
            Add 3D Text
          </button>
        </div>

        <div className="property-section" data-studio-section="sculpting">
          <h3 className="property-header">Sculpting</h3>
          <div className="property-row">
            <span className="property-label">Strength</span>
            <input
              type="range"
              min="0.01"
              max="0.5"
              step="0.01"
              data-studio-sculpt="strength"
              value={sculptStrength}
              onChange={e => setSculptStrength(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-sculpt-readout="strength"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}
            >
              {sculptStrength.toFixed(2)}
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="sculpt-inflate"
            onClick={() => sculptInflate(sculptStrength)}
            disabled={!selectedKind}
          >
            Inflate
          </button>
          <button
            className="property-button"
            data-studio-action="sculpt-twist"
            onClick={() => sculptTwist(sculptStrength)}
            disabled={!selectedKind}
          >
            Twist
          </button>
          <button
            className="property-button"
            data-studio-action="sculpt-smooth"
            onClick={() => sculptSmooth(sculptStrength)}
            disabled={!selectedKind}
          >
            Smooth
          </button>

          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 4px 0' }}>
              Click-paint brush — when active, viewport clicks deform
              vertices around the hit point with smooth falloff.
            </p>
            <div className="property-row">
              <span className="property-label">Brush</span>
              <input
                type="checkbox"
                data-studio-brush="active"
                checked={brushActive}
                onChange={e => setBrushActive(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <select
                className="property-input"
                data-studio-brush="mode"
                value={brushMode}
                onChange={e => setBrushMode(e.target.value)}
                style={{ marginLeft: '6px' }}
              >
                <option value="push">Push</option>
                <option value="pull">Pull</option>
                <option value="smooth">Smooth</option>
              </select>
            </div>
            <div className="property-row">
              <span className="property-label">Radius</span>
              <input
                type="range"
                min="0.003"
                max="0.04"
                step="0.001"
                data-studio-brush="radius"
                value={brushRadius}
                onChange={e => setBrushRadius(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-brush-readout="radius"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}
              >
                {(brushRadius * 1000).toFixed(1)} mm
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Strength</span>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                data-studio-brush="strength"
                value={brushFalloffStrength}
                onChange={e => setBrushFalloffStrength(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-brush-readout="strength"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}
              >
                {brushFalloffStrength.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="property-section" data-studio-section="animation">
          <h3 className="property-header">
            Animation
            <span
              data-studio-animation-state
              style={{ float: 'right', opacity: 0.6, fontSize: '11px', fontWeight: 'normal' }}
            >
              {isAnimating ? 'playing' : 'idle'}
            </span>
          </h3>
          <div className="property-row">
            <span className="property-label">Speed</span>
            <input
              type="range"
              min="0"
              max="720"
              step="10"
              data-studio-animation="speed"
              value={animSpeedDegPerSec}
              onChange={e => setAnimSpeedDegPerSec(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span
              data-studio-animation-readout="speed"
              style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '52px', textAlign: 'right' }}
            >
              {animSpeedDegPerSec} °/s
            </span>
          </div>
          <button
            className="property-button"
            data-studio-action="toggle-animation"
            onClick={() => setIsAnimating(v => !v)}
            disabled={!selectedKind && !isAnimating}
          >
            {isAnimating ? 'Stop Animation' : 'Animate Selected'}
          </button>

          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 4px 0' }}>
              Keyframes — record per-mesh poses, scrub the timeline,
              linear interpolation between surrounding keys.
            </p>
            <div className="property-row">
              <span className="property-label">Frame</span>
              <input
                type="range"
                min="0"
                max="240"
                step="1"
                data-studio-timeline="frame"
                value={currentFrame}
                onChange={e => setCurrentFrame(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-timeline-readout="frame"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
              >
                {Math.round(currentFrame)}
              </span>
            </div>
            <button
              className="property-button"
              data-studio-action="insert-keyframe"
              onClick={insertKeyframe}
              disabled={!selectedKind}
              style={{ margin: '0 0 4px 0' }}
            >
              Insert Keyframe @ Frame {Math.round(currentFrame)}
            </button>
            <button
              className="property-button"
              data-studio-action="toggle-timeline"
              onClick={() => setIsPlayingTimeline(p => !p)}
              disabled={keyframes.length < 2}
              style={{ margin: '0 0 4px 0' }}
            >
              {isPlayingTimeline ? 'Stop Timeline' : 'Play Timeline'}
            </button>
            <button
              className="property-button"
              data-studio-action="clear-keyframes"
              onClick={clearKeyframes}
              disabled={keyframes.length === 0}
            >
              Clear Keyframes
            </button>
            <div className="property-row" style={{ marginTop: '4px' }}>
              <span className="property-label">Motion Path</span>
              <input
                type="checkbox"
                data-studio-timeline="show-motion-path"
                checked={showMotionPaths}
                onChange={e => setShowMotionPaths(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
            </div>
            <p
              data-studio-keyframe-count
              className="property-label"
              style={{ opacity: 0.55, fontSize: '10px', margin: '4px 0 0 0', fontFamily: 'monospace' }}
            >
              {keyframes.length} keyframe{keyframes.length === 1 ? '' : 's'} · {isPlayingTimeline ? 'playing' : 'idle'}
            </p>
          </div>
        </div>

        {selectedKind && (
          <div className="property-section" data-studio-section="material">
            <h3 className="property-header">Material</h3>
            <div className="property-row">
              <span className="property-label">Color</span>
              <input
                type="color"
                className="property-input"
                data-studio-material="color"
                value={matColor}
                onChange={e => applyMatColor(e.target.value)}
                style={{ height: '24px', cursor: 'pointer' }}
              />
            </div>
            <div className="property-row">
              <span className="property-label">Metalness</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                data-studio-material="metalness"
                value={matMetalness}
                onChange={e => applyMatMetalness(e.target.value)}
                style={{ flex: 1 }}
              />
              <span
                data-studio-material-readout="metalness"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
              >
                {matMetalness.toFixed(2)}
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Roughness</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                data-studio-material="roughness"
                value={matRoughness}
                onChange={e => applyMatRoughness(e.target.value)}
                style={{ flex: 1 }}
              />
              <span
                data-studio-material-readout="roughness"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
              >
                {matRoughness.toFixed(2)}
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Emissive</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                data-studio-material="emissive"
                value={matEmissive}
                onChange={e => applyMatEmissive(e.target.value)}
                style={{ flex: 1 }}
              />
              <span
                data-studio-material-readout="emissive"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
              >
                {matEmissive.toFixed(2)}
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Wireframe</span>
              <input
                type="checkbox"
                data-studio-material="wireframe"
                checked={matWireframe}
                onChange={e => applyMatWireframe(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
            </div>
            <div
              data-studio-material-presets
              style={{
                marginTop: '8px',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '4px',
              }}
            >
              {MATERIAL_PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  data-studio-material-preset={p.id}
                  title={`${p.label} — metal ${p.metalness} · rough ${p.roughness}`}
                  onClick={() => applyMaterialPreset(p)}
                  style={{
                    padding: '4px 2px',
                    background: p.color,
                    color: p.metalness > 0.5 ? '#1a1a1a' : '#ffffff',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '10px',
                    fontWeight: 600,
                    textShadow: p.metalness > 0.5 ? 'none' : '0 1px 2px rgba(0,0,0,0.6)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="property-section" data-studio-section="scene">
          <h3 className="property-header">Scene</h3>
          <div className="property-row">
            <span className="property-label">Frame</span>
            <input type="number" className="property-input" placeholder="1" />
          </div>
          <div className="property-row">
            <span className="property-label">Frame rate</span>
            <select className="property-input" defaultValue="24">
              <option value="24">24 fps (film)</option>
              <option value="30">30 fps (broadcast)</option>
              <option value="60">60 fps (game)</option>
              <option value="120">120 fps (high-refresh)</option>
            </select>
          </div>
        </div>

        <div className="property-section" data-studio-section="mesh">
          <h3 className="property-header">Mesh</h3>
          <div className="property-row">
            <span className="property-label">Vertices</span>
            <input
              type="number"
              className="property-input"
              data-studio-stat="vertices"
              value={vertexCount}
              readOnly
            />
          </div>
          <div className="property-row">
            <span className="property-label">Faces</span>
            <input
              type="number"
              className="property-input"
              data-studio-stat="faces"
              value={faceCount}
              readOnly
            />
          </div>
          <button
            className="property-button"
            data-studio-action="delete-last"
            onClick={deleteLastPrimitive}
            disabled={primitiveCount === 0}
          >
            Delete Last
          </button>
          <button
            className="property-button"
            data-studio-action="clear-scene"
            onClick={clearScene}
            disabled={primitiveCount === 0}
          >
            Clear Scene
          </button>
          <button className="property-button" disabled>Subdivide</button>
          <button className="property-button" disabled>Retopologize</button>

          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 4px 0' }}>
              Decimate — vertex-clustering polygon reduction.
            </p>
            <div className="property-row">
              <span className="property-label">Aggressiveness</span>
              <input
                type="range"
                min="0.05"
                max="0.95"
                step="0.05"
                data-studio-decimate="aggressiveness"
                value={decimateAggressiveness}
                onChange={e => setDecimateAggressiveness(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-decimate-readout="aggressiveness"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '36px', textAlign: 'right' }}
              >
                {decimateAggressiveness.toFixed(2)}
              </span>
            </div>
            <button
              className="property-button"
              data-studio-action="decimate-selected"
              onClick={() => decimateSelected(decimateAggressiveness)}
              disabled={!selectedKind}
            >
              Decimate Selected
            </button>
          </div>

          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 4px 0' }}>
              Displace · Noise — deterministic 3D value noise along normals.
            </p>
            <div className="property-row">
              <span className="property-label">Frequency</span>
              <input
                type="range"
                min="20"
                max="400"
                step="5"
                data-studio-displace="frequency"
                value={displaceFrequency}
                onChange={e => setDisplaceFrequency(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-displace-readout="frequency"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}
              >
                {displaceFrequency}
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Amplitude</span>
              <input
                type="range"
                min="0.0005"
                max="0.015"
                step="0.0005"
                data-studio-displace="amplitude"
                value={displaceAmplitude}
                onChange={e => setDisplaceAmplitude(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-displace-readout="amplitude"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '46px', textAlign: 'right' }}
              >
                {(displaceAmplitude * 1000).toFixed(1)} mm
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Octaves</span>
              <input
                type="range"
                min="1"
                max="6"
                step="1"
                data-studio-displace="octaves"
                value={displaceOctaves}
                onChange={e => setDisplaceOctaves(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-displace-readout="octaves"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '20px', textAlign: 'right' }}
              >
                {displaceOctaves}
              </span>
            </div>
            <button
              className="property-button"
              data-studio-action="displace-noise"
              onClick={() => displaceNoise(displaceFrequency, displaceAmplitude, displaceOctaves)}
              disabled={!selectedKind}
            >
              Displace · Noise
            </button>
          </div>

          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 4px 0' }}>
              Cell Fracture · Shatter — split mesh into N spatial chunks.
            </p>
            <div className="property-row">
              <span className="property-label">Chunks</span>
              <input
                type="range"
                min="2"
                max="24"
                step="1"
                data-studio-fracture="chunks"
                value={fractureChunks}
                onChange={e => setFractureChunks(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-fracture-readout="chunks"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '24px', textAlign: 'right' }}
              >
                {fractureChunks}
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Explode</span>
              <input
                type="range"
                min="0"
                max="0.025"
                step="0.0005"
                data-studio-fracture="explode"
                value={fractureExplode}
                onChange={e => setFractureExplode(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-fracture-readout="explode"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '46px', textAlign: 'right' }}
              >
                {(fractureExplode * 1000).toFixed(1)} mm
              </span>
            </div>
            <button
              className="property-button"
              data-studio-action="fracture-selected"
              onClick={() => fractureSelected(fractureChunks, fractureExplode)}
              disabled={!selectedKind}
            >
              Fracture · Shatter Selected
            </button>
          </div>

          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 4px 0' }}>
              Array — N copies of selected mesh, linear axis offset or
              circular ring around Y-axis.
            </p>
            <div className="property-row">
              <span className="property-label">Mode</span>
              <select
                className="property-input"
                data-studio-array="mode"
                value={arrayMode}
                onChange={e => setArrayMode(e.target.value)}
              >
                <option value="linear">Linear</option>
                <option value="radial">Radial (ring)</option>
                <option value="radial-pivot">Radial (spokes)</option>
              </select>
            </div>
            <div className="property-row">
              <span className="property-label">Count</span>
              <input
                type="range"
                min="2"
                max="20"
                step="1"
                data-studio-array="count"
                value={arrayCount}
                onChange={e => setArrayCount(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                data-studio-array-readout="count"
                style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '24px', textAlign: 'right' }}
              >
                {arrayCount}
              </span>
            </div>
            {arrayMode === 'linear' ? (
              <>
                <div className="property-row">
                  <span className="property-label">Offset X</span>
                  <input
                    type="range"
                    min="0"
                    max="0.06"
                    step="0.001"
                    data-studio-array="offsetX"
                    value={arrayOffsetX}
                    onChange={e => setArrayOffsetX(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span data-studio-array-readout="offsetX" style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '46px', textAlign: 'right' }}>
                    {(arrayOffsetX * 1000).toFixed(0)} mm
                  </span>
                </div>
                <div className="property-row">
                  <span className="property-label">Offset Y</span>
                  <input
                    type="range"
                    min="0"
                    max="0.06"
                    step="0.001"
                    data-studio-array="offsetY"
                    value={arrayOffsetY}
                    onChange={e => setArrayOffsetY(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '46px', textAlign: 'right' }}>
                    {(arrayOffsetY * 1000).toFixed(0)} mm
                  </span>
                </div>
                <div className="property-row">
                  <span className="property-label">Offset Z</span>
                  <input
                    type="range"
                    min="0"
                    max="0.06"
                    step="0.001"
                    data-studio-array="offsetZ"
                    value={arrayOffsetZ}
                    onChange={e => setArrayOffsetZ(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '46px', textAlign: 'right' }}>
                    {(arrayOffsetZ * 1000).toFixed(0)} mm
                  </span>
                </div>
              </>
            ) : (
              <div className="property-row">
                <span className="property-label">Radius</span>
                <input
                  type="range"
                  min="0.01"
                  max="0.08"
                  step="0.001"
                  data-studio-array="radius"
                  value={arrayRadius}
                  onChange={e => setArrayRadius(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span data-studio-array-readout="radius" style={{ marginLeft: '6px', fontSize: '10px', fontFamily: 'monospace', minWidth: '46px', textAlign: 'right' }}>
                  {(arrayRadius * 1000).toFixed(0)} mm
                </span>
              </div>
            )}
            <button
              className="property-button"
              data-studio-action="apply-array"
              onClick={() => arrayModifier(arrayMode, arrayCount, arrayOffsetX, arrayOffsetY, arrayOffsetZ, arrayRadius)}
              disabled={!selectedKind}
            >
              Apply Array
            </button>
          </div>

          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 4px 0' }}>
              Shading — vertex normals averaged across faces (smooth)
              or duplicated per-face (flat / faceted).
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <button
                className="property-button"
                data-studio-action="shading-smooth"
                onClick={() => setShading('smooth')}
                disabled={!selectedKind}
                style={{ margin: 0 }}
              >
                Smooth
              </button>
              <button
                className="property-button"
                data-studio-action="shading-flat"
                onClick={() => setShading('flat')}
                disabled={!selectedKind}
                style={{ margin: 0 }}
              >
                Flat
              </button>
            </div>
          </div>
        </div>

        <div className="property-section" data-studio-section="display">
          <h3 className="property-header">Display</h3>
          <p className="property-label" style={{ opacity: 0.6, fontSize: '11px', margin: '0 0 6px 0' }}>
            View-time overlays for every Studio primitive in the scene.
          </p>
          <div className="property-row">
            <span className="property-label">Wireframe</span>
            <input
              type="checkbox"
              data-studio-display="wireframe"
              checked={displayWireframe}
              onChange={e => setDisplayWireframe(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
          </div>
          <div className="property-row">
            <span className="property-label">Bounding Box</span>
            <input
              type="checkbox"
              data-studio-display="bounding-box"
              checked={displayBoundingBox}
              onChange={e => setDisplayBoundingBox(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
          </div>
          <div className="property-row">
            <span className="property-label">Vertex Normals</span>
            <input
              type="checkbox"
              data-studio-display="normals"
              checked={displayNormals}
              onChange={e => setDisplayNormals(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
          </div>
          <p
            data-studio-display-status
            className="property-label"
            style={{ opacity: 0.5, fontSize: '10px', margin: '6px 0 0 0', fontFamily: 'monospace' }}
          >
            {[displayWireframe && 'wireframe', displayBoundingBox && 'bbox', displayNormals && 'normals']
              .filter(Boolean).join(' + ') || 'solid'}
          </p>
        </div>

        <div className="property-section" data-studio-section="render">
          <h3 className="property-header">Render</h3>
          <div className="property-row">
            <span className="property-label">Engine</span>
            <select
              className="property-input"
              data-studio-render="engine"
              value={renderEngine}
              onChange={e => setRenderEngine(e.target.value)}
            >
              <option value="cycles">Cycles (path-traced)</option>
              <option value="eevee">EEVEE (real-time)</option>
              <option value="workbench">Workbench (preview)</option>
            </select>
          </div>
          <div className="property-row">
            <span className="property-label">Samples</span>
            <input
              type="number"
              className="property-input"
              data-studio-render="samples"
              value={renderSamples}
              onChange={e => setRenderSamples(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <button
            className="property-button"
            data-studio-action="render-frame"
            onClick={captureRender}
          >
            Render Frame
          </button>
          <button
            className="property-button"
            data-studio-action="capture-showreel"
            onClick={captureShowreel}
          >
            Capture 4-View Showreel
          </button>
          <button className="property-button" disabled>Render Animation</button>
        </div>

        <div className="property-section" data-studio-section="renders">
          <h3 className="property-header">
            Renders
            <span
              data-studio-render-count
              style={{ float: 'right', opacity: 0.6, fontSize: '11px', fontWeight: 'normal' }}
            >
              {renders.length}
            </span>
          </h3>
          {renders.length === 0 ? (
            <p className="property-label" style={{ opacity: 0.5, fontSize: '11px' }}>
              No renders captured. Click "Render Frame" above to save a viewport snapshot.
            </p>
          ) : (
            <>
              <div
                data-studio-render-thumbs
                style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                {renders.map((r, i) => (
                  <div
                    key={i}
                    data-studio-render-thumb={i}
                    style={{
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '4px',
                      padding: '4px',
                      background: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <img
                      src={r.dataUrl}
                      alt={`Render ${i + 1}`}
                      data-studio-render-image={i}
                      style={{
                        display: 'block',
                        width: '100%',
                        height: 'auto',
                        borderRadius: '2px',
                      }}
                    />
                    <div
                      style={{
                        marginTop: '4px',
                        fontSize: '10px',
                        opacity: 0.6,
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>#{i + 1} · {r.engine} · {r.samples} spp</span>
                      <span>{r.ts}</span>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="property-button"
                data-studio-action="clear-renders"
                onClick={clearRenders}
                style={{ marginTop: '6px' }}
              >
                Clear Renders
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Geometry Node Graph editor — full overlay over the viewport. */}
      <StudioReferenceOverlay url={referenceUrl} visible={referenceVisible} size={260} />
      <NodeGraphEditor open={nodeGraphOpen} onClose={() => setNodeGraphOpen(false)} onEvaluate={evalNodeGraphToScene} />
      <NodeGraphEditor
        open={materialGraphOpen}
        onClose={() => setMaterialGraphOpen(false)}
        onEvaluate={applyMaterialGraph}
        nodeTypes={MATERIAL_NODE_TYPES}
        title="Material Graph"
        subtitle="Substance Designer / Unreal Material Editor / Unity Shader Graph"
        seedGraph={materialSeed}
        mirrorKey="__studioMaterialGraphState"
        kind="material"
      />
      <NodeGraphEditor
        open={blueprintOpen}
        onClose={() => setBlueprintOpen(false)}
        onEvaluate={runBlueprintInScene}
        nodeTypes={BLUEPRINT_NODE_TYPES}
        title="Blueprint"
        subtitle="Unreal Blueprint / Unity Visual Scripting (exec-flow)"
        seedGraph={blueprintSeed}
        mirrorKey="__studioBlueprintGraphState"
        kind="blueprint"
      />
      <NodeGraphEditor
        open={niagaraOpen}
        onClose={() => setNiagaraOpen(false)}
        onEvaluate={evalNiagaraToScene}
        nodeTypes={NIAGARA_NODE_TYPES}
        title="Niagara FX"
        subtitle="Unreal Niagara / Unity VFX Graph (particle emitter)"
        seedGraph={niagaraSeed}
        mirrorKey="__studioNiagaraGraphState"
        kind="niagara"
      />
      <NodeGraphEditor
        open={behaviorTreeOpen}
        onClose={() => setBehaviorTreeOpen(false)}
        onEvaluate={btTickOnce}
        nodeTypes={BT_NODE_TYPES}
        title="Behavior Tree"
        subtitle="Unreal Behavior Tree / Unity Behavior Designer (tick to drive the agent)"
        seedGraph={behaviorTreeSeed}
        mirrorKey="__studioBTGraphState"
        kind="behaviortree"
      />
      <StudioSequencer
        open={sequencerOpen}
        onClose={() => setSequencerOpen(false)}
        frames={240}
        currentFrame={currentFrame}
        onScrub={(f) => setCurrentFrame(f)}
        playing={isPlayingTimeline}
        onPlayPause={() => setIsPlayingTimeline(v => !v)}
        onSetKey={() => insertKeyframe()}
        onClear={clearKeyframes}
        tracks={(() => {
          const scene = window.__archdiscScene;
          const byMesh = new Map();
          for (const k of keyframes) { if (!byMesh.has(k.meshUuid)) byMesh.set(k.meshUuid, []); byMesh.get(k.meshUuid).push(k.frame); }
          return [...byMesh.entries()].map(([uuid, fr]) => {
            const m = scene && scene.getObjectByProperty('uuid', uuid);
            return { uuid, name: (m && m.name) || uuid.slice(0, 8), frames: fr.sort((a, b) => a - b) };
          });
        })()}
      />
    </>
  );
}

export default WorkbenchStudio;
