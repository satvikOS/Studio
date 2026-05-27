import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import {
  MousePointer2, Move, RotateCw, Maximize2,
  Box, Mountain, PaintBucket, Bone, Play, Sparkles, Camera,
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
  { id: 'voxel-cube',   label: 'Voxel Cube' },
  { id: 'voxel-sphere', label: 'Voxel Sphere' },
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
  { id: 'modeling',    label: 'Modeling' },
  { id: 'sculpting',   label: 'Sculpting' },
  { id: 'uv-texture',  label: 'UV / Texture' },
  { id: 'rigging',     label: 'Rigging' },
  { id: 'animation',   label: 'Animation' },
  { id: 'vfx-sim',     label: 'VFX / Sim' },
  { id: 'rendering',   label: 'Rendering' },
  { id: 'compositing', label: 'Compositing' },
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
  // Animation — auto-rotates the selected mesh in real time.
  const [isAnimating, setIsAnimating] = useState(false);
  const [animSpeedDegPerSec, setAnimSpeedDegPerSec] = useState(90);
  const animRafRef = useRef(null);
  // Sculpting — strength of one click of an Inflate/Twist/Smooth pass.
  const [sculptStrength, setSculptStrength] = useState(0.1);
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
  // Compositing — post-process the last captured render thumbnail
  // through a canvas filter and append the result as a new thumbnail.
  const [compositeFilter, setCompositeFilter] = useState('grayscale(100%)');
  // Subdivision — vertex count for the currently selected mesh, mirrored
  // into a panel readout so the user sees the (≈4×) growth per pass.
  // Mirror modifier — duplicate-and-flip the selected mesh across an axis.
  const [mirrorAxis, setMirrorAxis] = useState('x');

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
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random();
      const theta = u * 2 * Math.PI;
      const phi   = Math.acos(2 * v - 1);
      const r     = R * Math.cbrt(0.4 + Math.random() * 0.6);
      dummy.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
      const s = 0.4 + Math.random() * 0.8;
      dummy.scale.set(s, s, s);
      dummy.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
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
    for (let i = 0; i < n; i++) {
      // Uniform-in-volume sample inside a sphere via inverse CDF.
      const u = Math.random(), v = Math.random();
      const theta = u * 2 * Math.PI;
      const phi = Math.acos(2 * v - 1);
      const r = R * Math.cbrt(Math.random());
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      // Warm palette (red/orange/gold).
      const hue = 0.03 + Math.random() * 0.13;
      tempColor.setHSL(hue, 0.9, 0.45 + Math.random() * 0.35);
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
          {DISCIPLINE_TABS.map(tab => (
            <span
              key={tab.id}
              className={
                'workbench-ribbon-placeholder-tab'
                + (tab.id === activeTab ? ' active' : '')
              }
              data-studio-discipline={tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </span>
          ))}
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
      <main className="workbench-viewport">
        <Viewport3D canvasId="render-canvas-studio" domain="studio" />
      </main>

      {/* RIGHT PROPERTIES PANEL */}
      <aside className="workbench-properties" data-studio-properties="studio">
        <div className="property-section" data-studio-section="welcome">
          <h3 className="property-header">ArchDisc Studio</h3>
          <p className="property-label">
            3D modelling · sculpting · rigging · animation · VFX · simulation · rendering
          </p>
          <p className="property-label">
            Forked from Blender (GPL-3); parity target with Maya, Houdini, ZBrush, Substance, Cinema 4D.
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
