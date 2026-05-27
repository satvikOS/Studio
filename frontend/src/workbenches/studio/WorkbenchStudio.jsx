import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js';
import { SUZANNE_POSITIONS, SUZANNE_INDICES } from './SuzanneGeometry.js';
import { getManifold } from '../../foundation/manifoldKernel.js';
import { geometryToManifold, manifoldToGeometry } from '../../foundation/ManifoldThreeBridge.js';
import {
  MousePointer2, Move, RotateCw, Maximize2,
  Box, Mountain, PaintBucket, Bone, Play, Sparkles, Camera,
  Palette, Layers, Lightbulb, Image as ImageIcon, Wand2,
  Brush, Grid3x3, SlidersHorizontal,
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
  { id: 'torus-knot',   label: 'Torus Knot' },
  { id: 'icosahedron',  label: 'Icosa' },
  { id: 'dodecahedron', label: 'Dodeca' },
  { id: 'tetrahedron',  label: 'Tetra' },
  { id: 'voxel-cube',     label: 'Voxel Cube' },
  { id: 'voxel-sphere',   label: 'Voxel Sphere' },
  { id: 'suzanne',        label: 'Suzanne' },
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
  const [activeTool, setActiveTool] = useState('select');
  const [primitiveCount, setPrimitiveCount] = useState(0);
  const [vertexCount, setVertexCount] = useState(0);
  const [faceCount, setFaceCount] = useState(0);
  // Insertion-order stack of Studio-added meshes — kept in a ref because
  // mutation doesn't drive any rendering (state primitiveCount mirrors
  // its length for UI bindings). Used by Delete Last + Clear Scene.
  const primitiveStackRef = useRef([]);
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
  const [brushRadius, setBrushRadius]     = useState(0.012);
  const [brushFalloffStrength, setBrushFalloffStrength] = useState(0.4);
  const brushStateRef = useRef({ active: false, mode: 'push', radius: 0.012, strength: 0.4 });
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
    if (!scene) return;

    const geometry = buildPrimitiveGeometry(kind);
    if (!geometry) return;

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

    // Grid layout — spread additions so multiple primitives are individually
    // visible. 4 columns wide; new rows along +Z.
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

      const selectMesh = (mesh) => {
        selectedMeshRef.current = mesh;
        attachOutline(mesh);

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
        selectedMeshRef.current = null;
        setSelectedKind(null);
        setSelectedTransform(null);
      };

      // Expose for the React-side delete + other slices.
      window.__studioSelectMesh = selectMesh;
      window.__studioDeselect = deselect;

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
          paintBrushAt(hit.object, hit.point, brush);
          return;
        }
        if (hits.length > 0) {
          selectMesh(hits[0].object);
        } else {
          deselect();
        }
      };
      vp.renderer.domElement.addEventListener('pointerdown', onPointerDown);

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

  // Mirror activeTool → transform mode label (gizmo arrives in a later slice).
  useEffect(() => {
    const map = { move: 'translate', rotate: 'rotate', scale: 'scale' };
    if (map[activeTool]) setGizmoMode(map[activeTool]);
  }, [activeTool]);

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
    ctx.strokeStyle = '#ff4d6d';
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
  function insertKeyframe() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return null;
    const k = {
      meshUuid: mesh.uuid,
      frame: Math.round(currentFrame),
      px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z,
      rx: mesh.rotation.x, ry: mesh.rotation.y, rz: mesh.rotation.z,
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
      const t = span === 0 ? 0 : (f - before.frame) / span;
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
    });
  }
  useEffect(() => {
    applyFrameToScene(currentFrame);
  }, [currentFrame, keyframes]);

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
      const mat = new THREE.LineBasicMaterial({ color: 0x28d4d4, transparent: true, opacity: 0.85 });
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
   * Physics — vertical gravity drop with a single ground plane and
   * energy-losing bounces. Stores per-mesh velocity on userData so
   * primitives spawned mid-sim seamlessly join the loop. Stops on
   * toggle off / unmount.
   */
  const GROUND_Y = -0.045; // -45 mm — clearance below the workbench axes triad
  function physicsTick(dt) {
    const scene = window.__archdiscScene;
    if (!scene) return;
    const g = physicsG;
    const r = physicsRestitution;
    scene.traverse(o => {
      if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
      const v = o.userData.studioVelocity || (o.userData.studioVelocity = [0, 0, 0]);
      v[1] -= g * dt;
      o.position.y += v[1] * dt;
      if (o.position.y < GROUND_Y) {
        o.position.y = GROUND_Y;
        v[1] = -v[1] * r;
        // Settle threshold so primitives stop micro-bouncing forever.
        if (Math.abs(v[1]) < 0.04) v[1] = 0;
      }
    });
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
  function paintBrushAt(mesh, hitPoint, brush) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
    const pos = mesh.geometry.attributes.position;
    // Convert hit point to mesh-local coords so we can compare to local
    // vertex positions directly.
    const localHit = mesh.worldToLocal(hitPoint.clone());
    // Pre-compute the surface normal at the hit point — use the local
    // bounding-sphere-centroid direction as a coarse fallback. For most
    // closed convex-ish primitives this matches the actual outward normal.
    const normal = localHit.clone();
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const center = mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.center : new THREE.Vector3();
    normal.sub(center).normalize();
    const r = brush.radius;
    const k = brush.strength * brush.radius * 0.5;
    if (brush.mode === 'smooth' && mesh.geometry.index) {
      // Laplacian-towards-neighbours within radius.
      const idx = mesh.geometry.index;
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
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - localHit.x;
        const dy = pos.getY(i) - localHit.y;
        const dz = pos.getZ(i) - localHit.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > r || counts[i] === 0) continue;
        const tn = dist / r;
        const falloff = (1 - tn * tn) * (1 - tn * tn);
        const w = brush.strength * falloff;
        const ax = sums[i * 3]     / counts[i];
        const ay = sums[i * 3 + 1] / counts[i];
        const az = sums[i * 3 + 2] / counts[i];
        pos.setXYZ(
          i,
          pos.getX(i) * (1 - w) + ax * w,
          pos.getY(i) * (1 - w) + ay * w,
          pos.getZ(i) * (1 - w) + az * w,
        );
      }
    } else {
      const sign = brush.mode === 'pull' ? -1 : 1;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - localHit.x;
        const dy = pos.getY(i) - localHit.y;
        const dz = pos.getZ(i) - localHit.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > r) continue;
        const tn = dist / r;
        const falloff = (1 - tn * tn) * (1 - tn * tn);
        const w = sign * k * falloff;
        pos.setXYZ(
          i,
          pos.getX(i) + normal.x * w,
          pos.getY(i) + normal.y * w,
          pos.getZ(i) + normal.z * w,
        );
      }
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    recomputeMeshStats(window.__archdiscScene);
  }

  // Sync brush state into the ref so the setup-scoped pointerdown sees
  // the latest values without depending on closure refresh.
  useEffect(() => {
    brushStateRef.current = {
      active:   brushActive,
      mode:     brushMode,
      radius:   brushRadius,
      strength: brushFalloffStrength,
    };
  }, [brushActive, brushMode, brushRadius, brushFalloffStrength]);

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
        const box = new THREE.BoxHelper(o, 0x28d4d4);
        box.userData.archdiscStudioDisplayHelper = true;
        vp.scene.add(box);
      }
      if (displayNormals) {
        // Sample 8% of faces for normals (keeps performance + render
        // sane on dense meshes like 5×subdivided spheres).
        const helper = new VertexNormalsHelper(o, 0.005, 0x28d4d4);
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

  return (
    <>
      {/* RIBBON: Studio discipline tabs (placeholder; real ribbons land per discipline) */}
      <div
        className="workbench-ribbon-placeholder"
        data-archdisc-ribbon-placeholder="studio"
      >
        <div className="workbench-ribbon-placeholder-tabs">
          {DISCIPLINE_TABS.map(tab => {
            const TabIcon = tab.Icon;
            return (
              <span
                key={tab.id}
                className={
                  'workbench-ribbon-placeholder-tab'
                  + (tab.id === activeTab ? ' active' : '')
                }
                data-studio-discipline={tab.id}
                data-studio-active={tab.id === activeTab ? '1' : '0'}
                onClick={() => setActiveTab(tab.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                {TabIcon && <TabIcon size={12} style={{ opacity: 0.75 }} />}
                {tab.label}
              </span>
            );
          })}
        </div>
        <div className="workbench-ribbon-placeholder-body">
          {activeTab === 'modeling' ? (
            <div
              data-studio-modeling-primitives
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                alignItems: 'center',
                width: '100%',
              }}
            >
              <span style={{ opacity: 0.6, marginRight: '8px' }}>Primitives:</span>
              {PRIMITIVE_KINDS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  data-studio-primitive={p.id}
                  onClick={() => addPrimitive(p.id)}
                  style={{
                    padding: '4px 10px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'inherit',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  + {p.label}
                </button>
              ))}
              <span
                data-studio-primitive-count
                style={{ marginLeft: '12px', opacity: 0.6 }}
              >
                {primitiveCount} primitive{primitiveCount === 1 ? '' : 's'} in scene
              </span>
            </div>
          ) : (
            <>
              ArchDisc Studio · forked from Blender · {DISCIPLINE_TABS.find(t => t.id === activeTab)?.label} (placeholder)
            </>
          )}
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

      {/* CENTER VIEWPORT — three.js scene (shared component reused from Mech) */}
      <main className="workbench-viewport" style={{ position: 'relative' }}>
        <Viewport3D canvasId="render-canvas-studio" domain="studio" />
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
            <Sparkles size={12} style={{ color: '#28d4d4' }} />
            <span style={{ fontWeight: 600, color: '#28d4d4' }}>STUDIO</span>
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
            style={{ opacity: isAnimating ? 1 : 0.5, color: isAnimating ? '#7fd49e' : 'inherit' }}
          >
            <Play size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {isAnimating ? 'animating' : 'idle'}
          </span>
          <span
            data-studio-status="physics"
            style={{ opacity: isPhysicsActive ? 1 : 0.5, color: isPhysicsActive ? '#d4a07f' : 'inherit' }}
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
        className="workbench-properties"
        data-studio-properties="studio"
        data-studio-discipline={activeTab}
      >
        {/* Discipline-aware section visibility. AI Prompt, Welcome,
            Selection, Material show on every tab; everything else
            gates on data-studio-discipline matching one of its allow-list. */}
        <style>{`
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
             STUDIO UI/UX OVERHAUL — slice 59
             ================================================================= */

          /* Properties panel scrolls cleanly; floor + room for the banner. */
          [data-studio-properties="studio"] {
            overflow-y: auto;
            padding-bottom: 32px;
            background: #0d0d14;
          }

          /* Section card — soft background panel, rounded edges, breathing room. */
          [data-studio-properties="studio"] .property-section {
            background: linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.01) 100%);
            border: 1px solid rgba(255,255,255,0.045);
            border-radius: 8px;
            padding: 10px 12px;
            margin: 6px 10px 8px 10px;
            transition: border-color 0.15s, background 0.15s;
          }
          [data-studio-properties="studio"] .property-section:hover {
            border-color: rgba(40,212,212,0.18);
            background: linear-gradient(180deg, rgba(40,212,212,0.04) 0%, rgba(40,212,212,0.01) 100%);
          }

          /* Section header — flex layout with stripe + uppercase title.
             ::before stripe is recoloured per-section by the rules below. */
          [data-studio-properties="studio"] .property-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0 0 8px 0;
            padding: 2px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            text-transform: uppercase;
            font-size: 10.5px;
            letter-spacing: 0.7px;
            color: #d4dadf;
            cursor: pointer;
            user-select: none;
          }
          [data-studio-properties="studio"] .property-header::before {
            content: '';
            display: inline-block;
            width: 3px;
            height: 12px;
            background: #28d4d4;
            border-radius: 2px;
            flex-shrink: 0;
          }
          /* Collapsed state: section body hidden, header stays. */
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
            opacity: 0.55;
            transition: transform 0.2s;
          }
          [data-studio-properties="studio"] .property-section[data-studio-collapsed="true"] .property-header::after {
            transform: rotate(-90deg);
          }

          /* Per-section discipline-coloured stripes — gives each panel a
             scannable visual identity. */
          [data-studio-properties="studio"] [data-studio-section="ai"]            .property-header::before { background: #ff7eb6; }
          [data-studio-properties="studio"] [data-studio-section="welcome"]       .property-header::before { background: #28d4d4; }
          [data-studio-properties="studio"] [data-studio-section="library"]       .property-header::before { background: #28d4d4; }
          [data-studio-properties="studio"] [data-studio-section="selection"]     .property-header::before { background: #fff176; }
          [data-studio-properties="studio"] [data-studio-section="mesh"]          .property-header::before { background: #28d4d4; }
          [data-studio-properties="studio"] [data-studio-section="display"]       .property-header::before { background: #7fd4a8; }
          [data-studio-properties="studio"] [data-studio-section="material"]      .property-header::before { background: #d4a07f; }
          [data-studio-properties="studio"] [data-studio-section="texture"]       .property-header::before { background: #d4c628; }
          [data-studio-properties="studio"] [data-studio-section="sculpting"]     .property-header::before { background: #d47fa0; }
          [data-studio-properties="studio"] [data-studio-section="subdivision"]   .property-header::before { background: #7fd49e; }
          [data-studio-properties="studio"] [data-studio-section="mirror"]        .property-header::before { background: #28d4d4; }
          [data-studio-properties="studio"] [data-studio-section="boolean"]       .property-header::before { background: #d47f7f; }
          [data-studio-properties="studio"] [data-studio-section="scatter"]       .property-header::before { background: #a0d47f; }
          [data-studio-properties="studio"] [data-studio-section="procedural"]    .property-header::before { background: #d47fd4; }
          [data-studio-properties="studio"] [data-studio-section="instancing"]    .property-header::before { background: #d4a07f; }
          [data-studio-properties="studio"] [data-studio-section="text3d"]        .property-header::before { background: #fff176; }
          [data-studio-properties="studio"] [data-studio-section="archviz"]       .property-header::before { background: #7fa0d4; }
          [data-studio-properties="studio"] [data-studio-section="lathe"]         .property-header::before { background: #d47fa0; }
          [data-studio-properties="studio"] [data-studio-section="reference"]     .property-header::before { background: #c0c0c0; }
          [data-studio-properties="studio"] [data-studio-section="shape-keys"]    .property-header::before { background: #d47fa0; }
          [data-studio-properties="studio"] [data-studio-section="armature"]      .property-header::before { background: #7fd49e; }
          [data-studio-properties="studio"] [data-studio-section="animation"]     .property-header::before { background: #d47fa0; }
          [data-studio-properties="studio"] [data-studio-section="particles"]     .property-header::before { background: #a07fd4; }
          [data-studio-properties="studio"] [data-studio-section="physics"]       .property-header::before { background: #d4a07f; }
          [data-studio-properties="studio"] [data-studio-section="render"]        .property-header::before { background: #7fa0d4; }
          [data-studio-properties="studio"] [data-studio-section="renders"]       .property-header::before { background: #7fa0d4; }
          [data-studio-properties="studio"] [data-studio-section="lighting"]      .property-header::before { background: #fff176; }
          [data-studio-properties="studio"] [data-studio-section="compositing"]   .property-header::before { background: #d47f7f; }
          [data-studio-properties="studio"] [data-studio-section="scene"]         .property-header::before { background: #28d4d4; }
          [data-studio-properties="studio"] [data-studio-section="scene-io"]      .property-header::before { background: #7fd4a8; }
          [data-studio-properties="studio"] [data-studio-section="camera"]        .property-header::before { background: #7fa0d4; }
          [data-studio-properties="studio"] [data-studio-section="export"]        .property-header::before { background: #d4a07f; }

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
            background: rgba(40,212,212,0.10);
            border-color: rgba(40,212,212,0.45);
            color: #f0f6f7;
            box-shadow: 0 0 12px rgba(40,212,212,0.15);
          }
          [data-studio-properties="studio"] .property-button:active:not(:disabled) {
            background: rgba(40,212,212,0.20);
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
            border-color: #28d4d4;
            background: rgba(40,212,212,0.03);
          }
          [data-studio-properties="studio"] input[type="range"] {
            accent-color: #28d4d4;
            height: 4px;
          }
          [data-studio-properties="studio"] input[type="checkbox"] {
            accent-color: #28d4d4;
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

          /* Discipline tabs — replace the inherited static blue underline
             with a teal Studio underline on the ACTIVE tab + a soft hover
             affordance. The component sets data-studio-discipline on every
             tab; the JSX adds an additional data-active flag to the active
             one (next slice). For now hover suffices. */
          body:has([data-studio-properties="studio"]) .workbench-ribbon-placeholder-tabs {
            background: linear-gradient(180deg, #0e0e16 0%, #0d0d14 100%) !important;
            border-bottom: 1px solid rgba(40,212,212,0.18) !important;
          }
          body:has([data-studio-properties="studio"]) .workbench-ribbon-placeholder-tab {
            position: relative;
            border-bottom: 2px solid transparent !important;
            transition: color 0.15s, background 0.15s, border-color 0.15s;
            cursor: pointer;
          }
          body:has([data-studio-properties="studio"]) .workbench-ribbon-placeholder-tab:hover {
            color: #28d4d4 !important;
            background: rgba(40,212,212,0.06);
            border-bottom-color: rgba(40,212,212,0.35) !important;
          }
          /* Active tab — gets data-studio-active="1" on every render. */
          body:has([data-studio-properties="studio"]) .workbench-ribbon-placeholder-tab[data-studio-active="1"] {
            color: #28d4d4 !important;
            border-bottom-color: #28d4d4 !important;
            background: rgba(40,212,212,0.08);
            text-shadow: 0 0 8px rgba(40,212,212,0.4);
          }

          /* Ribbon body — primitive-button row + section header strip. */
          body:has([data-studio-properties="studio"]) .workbench-ribbon-placeholder-body {
            background: #0d0d14 !important;
            font-style: normal !important;
          }

          /* Studio primitive buttons (top ribbon "+ Cube", "+ Sphere", ...) —
             render as Studio-themed chips with teal hover. */
          [data-studio-primitive] {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.10);
            color: #d4dadf;
            border-radius: 6px;
            padding: 4px 10px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
            white-space: nowrap;
          }
          [data-studio-primitive]:hover {
            background: rgba(40,212,212,0.10);
            border-color: rgba(40,212,212,0.45);
            color: #f0f6f7;
            box-shadow: 0 0 10px rgba(40,212,212,0.18);
          }
          [data-studio-primitive]:active {
            background: rgba(40,212,212,0.22);
          }

          /* Workbench top header — apply Studio teal accent to the active
             workbench wordmark. */
          body:has([data-studio-properties="studio"]) .workbench-current .workbench-name {
            color: #28d4d4;
          }
        `}</style>

        {/* Studio brand banner — always at the top of the right panel.
            Bigger Studio identity + inline scene-state chips + active-
            discipline pill so users see which mode is armed at a glance. */}
        <div
          data-studio-banner
          style={{
            padding: '14px 14px 12px 14px',
            background: 'linear-gradient(180deg, rgba(40,212,212,0.16) 0%, rgba(40,212,212,0.02) 70%, rgba(0,0,0,0) 100%)',
            borderBottom: '1px solid rgba(40,212,212,0.18)',
            marginBottom: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <Wand2 size={18} style={{ color: '#28d4d4', filter: 'drop-shadow(0 0 6px rgba(40,212,212,0.4))' }} />
            <h2 style={{
              margin: 0, fontSize: '14px', fontWeight: 700, color: '#f0f6f7',
              letterSpacing: '0.5px',
            }}>
              ArchDisc <span style={{ color: '#28d4d4' }}>Studio</span>
            </h2>
            <span
              data-studio-banner-discipline
              style={{
                marginLeft: 'auto',
                fontSize: '9.5px',
                fontFamily: 'monospace',
                color: '#28d4d4',
                background: 'rgba(40,212,212,0.12)',
                border: '1px solid rgba(40,212,212,0.32)',
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
        </div>
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
                    color: i === aiPlanIndex ? '#ff4d6d' : 'inherit',
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
            <div className="property-row">
              <span className="property-label">Position</span>
              <span
                className="property-input"
                data-studio-selection="position"
                style={{ textAlign: 'right', fontSize: '10px', fontFamily: 'monospace' }}
              >
                {selectedTransform.position.map(n => n.toFixed(4)).join(', ')}
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Rotation</span>
              <span
                className="property-input"
                data-studio-selection="rotation"
                style={{ textAlign: 'right', fontSize: '10px', fontFamily: 'monospace' }}
              >
                {selectedTransform.rotation.map(n => n.toFixed(3)).join(', ')}
              </span>
            </div>
            <div className="property-row">
              <span className="property-label">Scale</span>
              <span
                className="property-input"
                data-studio-selection="scale"
                style={{ textAlign: 'right', fontSize: '10px', fontFamily: 'monospace' }}
              >
                {selectedTransform.scale.map(n => n.toFixed(3)).join(', ')}
              </span>
            </div>
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
                <option value="radial">Radial</option>
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
    </>
  );
}

export default WorkbenchStudio;
