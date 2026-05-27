import React, { useState } from 'react';
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
    case 'cube':     return new THREE.BoxGeometry(S, S, S);
    case 'sphere':   return new THREE.SphereGeometry(S * 0.6, 32, 24);
    case 'plane':    return new THREE.PlaneGeometry(S * 1.6, S * 1.6);
    case 'cylinder': return new THREE.CylinderGeometry(S * 0.5, S * 0.5, S, 32);
    case 'cone':     return new THREE.ConeGeometry(S * 0.55, S, 32);
    case 'torus':    return new THREE.TorusGeometry(S * 0.5, S * 0.18, 16, 32);
    default: return null;
  }
}

const PRIMITIVE_KINDS = [
  { id: 'cube',     label: 'Cube' },
  { id: 'sphere',   label: 'Sphere' },
  { id: 'plane',    label: 'Plane' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'cone',     label: 'Cone' },
  { id: 'torus',    label: 'Torus' },
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
    setPrimitiveCount(c => c + 1);
    recomputeMeshStats(scene);
  }

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
          <button className="property-button" disabled>Subdivide</button>
          <button className="property-button" disabled>Retopologize</button>
        </div>

        <div className="property-section" data-studio-section="render">
          <h3 className="property-header">Render</h3>
          <div className="property-row">
            <span className="property-label">Engine</span>
            <select className="property-input" defaultValue="cycles">
              <option value="cycles">Cycles (path-traced)</option>
              <option value="eevee">EEVEE (real-time)</option>
              <option value="workbench">Workbench (preview)</option>
            </select>
          </div>
          <div className="property-row">
            <span className="property-label">Samples</span>
            <input type="number" className="property-input" placeholder="128" />
          </div>
          <button className="property-button" disabled>Render Frame</button>
          <button className="property-button" disabled>Render Animation</button>
        </div>
      </aside>
    </>
  );
}

export default WorkbenchStudio;
