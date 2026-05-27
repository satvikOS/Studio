import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
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
  // Stash of the original material so we can restore on deselect (we
  // swap to a brighter "selected" material to make the selection visible).
  const originalMaterialRef = useRef(null);
  // Wireframe outline overlay (a LineSegments object attached to the
  // selected mesh as a sibling under the scene) so selection reads as
  // a clear visual indicator without dragging in the heavy
  // TransformControls gizmo at this scene's mm-scale.
  const outlineRef = useRef(null);

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
      // Don't restore swapped material — the mesh is about to be disposed
      // entirely. Just clear selection state + remove the outline.
      if (originalMaterialRef.current && mesh.material !== originalMaterialRef.current) {
        mesh.material.dispose();
        mesh.material = originalMaterialRef.current;
      }
      originalMaterialRef.current = null;
      selectedMeshRef.current = null;
      const vp = window.__archdiscViewport;
      if (vp && outlineRef.current) {
        vp.scene.remove(outlineRef.current);
        outlineRef.current.geometry.dispose();
        outlineRef.current.material.dispose();
        outlineRef.current = null;
      }
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

    function attachOutline(mesh, vp) {
      // Remove any previous outline first.
      if (outlineRef.current) {
        vp.scene.remove(outlineRef.current);
        outlineRef.current.geometry.dispose();
        outlineRef.current.material.dispose();
        outlineRef.current = null;
      }
      const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0xffe066,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      const outline = new THREE.LineSegments(edges, lineMat);
      outline.renderOrder = 999;
      // Keep outline glued to the mesh's transform.
      outline.position.copy(mesh.position);
      outline.rotation.copy(mesh.rotation);
      outline.scale.copy(mesh.scale);
      outline.userData.isStudioOutline = true;
      vp.scene.add(outline);
      outlineRef.current = outline;
    }

    function clearOutline(vp) {
      if (outlineRef.current) {
        vp.scene.remove(outlineRef.current);
        outlineRef.current.geometry.dispose();
        outlineRef.current.material.dispose();
        outlineRef.current = null;
      }
    }

    function setup() {
      if (cancelled) return;
      const vp = window.__archdiscViewport;
      if (!vp || !vp.renderer || !vp.scene || !vp.camera) {
        setTimeout(setup, 200);
        return;
      }

      const selectMesh = (mesh) => {
        if (selectedMeshRef.current && selectedMeshRef.current !== mesh) {
          const prev = selectedMeshRef.current;
          if (originalMaterialRef.current && prev.material !== originalMaterialRef.current) {
            prev.material.dispose();
            prev.material = originalMaterialRef.current;
          }
        }
        selectedMeshRef.current = mesh;
        originalMaterialRef.current = mesh.material;
        mesh.material = new THREE.MeshStandardMaterial({
          color: 0xff4d6d,
          metalness: 0.2,
          roughness: 0.35,
          emissive: 0x331122,
          emissiveIntensity: 0.3,
        });
        attachOutline(mesh, vp);

        setSelectedKind(mesh.userData?.archdiscStudioPrimitiveKind || 'unknown');
        setSelectedTransform({
          position: [mesh.position.x, mesh.position.y, mesh.position.z],
          rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
          scale:    [mesh.scale.x,    mesh.scale.y,    mesh.scale.z],
        });
      };

      const deselect = () => {
        const prev = selectedMeshRef.current;
        if (prev) {
          if (originalMaterialRef.current && prev.material !== originalMaterialRef.current) {
            prev.material.dispose();
            prev.material = originalMaterialRef.current;
          }
        }
        originalMaterialRef.current = null;
        selectedMeshRef.current = null;
        clearOutline(vp);
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
        clearOutline(vp);
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
    const vp = window.__archdiscViewport;
    const mesh = selectedMeshRef.current;
    if (!scene || !mesh) return;

    // Remove the outline overlay first.
    if (vp && outlineRef.current) {
      vp.scene.remove(outlineRef.current);
      outlineRef.current.geometry.dispose();
      outlineRef.current.material.dispose();
      outlineRef.current = null;
    }

    // Restore original material BEFORE disposing so we don't free
    // the user's chosen material along with the selected-style swap.
    if (originalMaterialRef.current && mesh.material !== originalMaterialRef.current) {
      mesh.material.dispose();
      mesh.material = originalMaterialRef.current;
    }
    originalMaterialRef.current = null;

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
