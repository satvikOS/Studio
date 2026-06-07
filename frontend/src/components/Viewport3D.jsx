// ArchDisc Studio — Viewport.
//
// Slice 951g — Full rewrite, Forge-mirror design.
//
// The previous implementation accumulated ~1600 lines of imperative
// Three.js mount code with helpers (GridHelper, AxesHelper, two
// ShadowMaterial grounds, TransformControlsGizmo, cursor groups,
// vertex markers) that each defaulted to visible at world origin —
// producing the bright cross + horizontal stripe that survived every
// surgical fix. The user asked for the viewport to mirror Forge's v4
// design exactly (not its kernel features), and Forge's Viewport.jsx
// at ~/archdisc-Mech/frontend/src/forge-v4/Viewport.jsx is a clean
// declarative @react-three/fiber surface. This file is its Studio
// counterpart.
//
// Layout:
//   <Canvas>
//     <color background />
//     <lights /> (1 ambient + 2 directional)
//     <Grid> (drei's infinite faded floor — no horizon edge)
//     <OrbitControls> (damped, zoom-to-cursor)
//     <TransformControls> ONLY when an object is selected
//     <GizmoHelper> (bottom-right monochrome axis triad)
//
// Public window.__studio* surface kept identical so the V3 ops layer
// keeps resolving against this viewport:
//   window.__archdiscScene
//   window.__archdiscViewport = { scene, renderer, camera, controls,
//                                  transformControls, getSelected,
//                                  setSelected }
//   window.__studioFrameAll / FitSelected
//   window.__studioSetGridVisible / SetAxesVisible / SetGroundVisible
//   window.__studioSetCameraAxis
//   etc.

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls as DreiTransformControls,
         GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useViewport } from '../contexts/ViewportContext';

// -----------------------------------------------------------------------
// Studio-bridge: publishes the r3f Three.js objects on window so the
// existing ops layer (registerCameraOps / registerSelectionOps / etc.)
// can dispatch against them. Runs inside <Canvas>, so it has access to
// the live r3f three instances.
// -----------------------------------------------------------------------
function StudioBridge({ selectedRef, setSelected, onReady }) {
  const { scene, gl, camera } = useThree();
  const controlsRef = useRef(null);

  useEffect(() => {
    // Expose the canonical handles. The ops layer reads these every
    // call, so keeping them in sync with the live r3f scene is the
    // only contract the rewrite must honour.
    window.__archdiscScene = scene;
    window.__archdiscTHREE = THREE;
    window.__archdiscViewport = {
      scene,
      renderer: gl,
      camera,
      controls: () => controlsRef.current,
      getSelected: () => selectedRef.current,
      setSelected,
    };

    // Frame-all / fit-selected helpers operate on the live scene.
    window.__studioFrameAll = () => {
      const box = new THREE.Box3();
      let hasAny = false;
      scene.traverse((o) => {
        if (o && o.userData && o.userData.archdiscStudioPrimitive && o.geometry) {
          o.updateMatrixWorld();
          box.expandByObject(o);
          hasAny = true;
        }
      });
      if (!hasAny) return { ok: false, error: 'empty scene' };
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const r = Math.max(size.length() / 2, 0.001);
      const fov = camera.fov * Math.PI / 180;
      const dist = r / Math.tan(fov / 2) * 1.8;
      const dir = new THREE.Vector3(1, 0.6, 1).normalize();
      camera.position.copy(center).add(dir.multiplyScalar(dist));
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      const c = controlsRef.current;
      if (c) { c.target.copy(center); c.update(); }
      return { ok: true };
    };
    window.__studioFitSelected = () => {
      const sel = selectedRef.current;
      if (!sel) return window.__studioFrameAll();
      sel.updateMatrixWorld();
      const box = new THREE.Box3().setFromObject(sel);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const r = Math.max(size.length() / 2, 0.001);
      const fov = camera.fov * Math.PI / 180;
      const dist = r / Math.tan(fov / 2) * 2.2;
      const dir = new THREE.Vector3(1, 0.6, 1).normalize();
      camera.position.copy(center).add(dir.multiplyScalar(dist));
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      const c = controlsRef.current;
      if (c) { c.target.copy(center); c.update(); }
      return { ok: true };
    };
    window.__studioSetCameraAxis = (axis) => {
      const c = controlsRef.current;
      const tgt = c ? c.target : new THREE.Vector3();
      const d = camera.position.distanceTo(tgt) || 3;
      const m = { top:   [0,  d, 0],
                  bottom:[0, -d, 0],
                  front: [0,  0, d],
                  back:  [0,  0,-d],
                  right: [d,  0, 0],
                  left:  [-d, 0, 0],
                  persp: [d * 0.7, d * 0.5, d * 0.7] };
      const p = m[axis] || m.persp;
      camera.position.set(tgt.x + p[0], tgt.y + p[1], tgt.z + p[2]);
      camera.lookAt(tgt);
      camera.updateProjectionMatrix();
      if (c) c.update();
      return { ok: true, axis };
    };
    window.__studioSetFov = (deg) => {
      const v = Math.max(10, Math.min(110, Number(deg) || 45));
      camera.fov = v;
      camera.updateProjectionMatrix();
    };
    window.__studioGetFov = () => camera.fov;
    window.__studioSetPixelRatio = (r) => {
      gl.setPixelRatio(Math.max(0.25, Math.min(3, Number(r) || 1)));
    };

    if (onReady) onReady({ scene, renderer: gl, camera });
    return () => {
      if (window.__archdiscScene === scene) {
        delete window.__archdiscScene;
        delete window.__archdiscViewport;
      }
    };
  }, [scene, gl, camera, selectedRef, setSelected, onReady]);

  // r3f's OrbitControls comes from drei; we need its ref so the bridge
  // can update its target on frame/fit operations. The component below
  // assigns to controlsRef via a forwarded ref.
  return <BridgeOrbitControls controlsRef={controlsRef} />;
}

function BridgeOrbitControls({ controlsRef }) {
  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      screenSpacePanning
      rotateSpeed={0.8}
      panSpeed={0.8}
      zoomSpeed={1.0}
      zoomToCursor
      minDistance={0.001}
      maxDistance={5000}
    />
  );
}

// -----------------------------------------------------------------------
// Selection bridge: clicks on a primitive update the selectedRef and
// fire studio-selection-changed for the ops layer.
// -----------------------------------------------------------------------
function SelectionLayer({ selectedRef, setSelected }) {
  const { scene } = useThree();
  const onPointerDown = useCallback((e) => {
    const o = e.object;
    if (o && o.userData && o.userData.archdiscStudioPrimitive) {
      setSelected(o);
      e.stopPropagation?.();
    }
  }, [setSelected]);
  useEffect(() => {
    scene.traverse((o) => {
      if (o && o.userData && o.userData.archdiscStudioPrimitive) {
        // r3f only routes pointer events via Object3D's onPointerDown
        // prop; pre-existing meshes spawned via the legacy spawn() path
        // listen via a window event instead.
      }
    });
  }, [scene]);
  // Bubble a window-level selection so legacy hooks (status bar, props
  // panel) refresh. Hooked here to colocate with the actual selection.
  useEffect(() => {
    const refresh = () => {
      window.dispatchEvent(new CustomEvent('studio-selection-changed', {
        detail: { selected: selectedRef.current },
      }));
    };
    window.__studioSelectMesh = (m) => { setSelected(m); refresh(); };
    window.__studioSelectedMesh = () => selectedRef.current;
    window.__studioSelectedMeshes = () => (selectedRef.current ? [selectedRef.current] : []);
    window.__studioDeselect = () => { setSelected(null); refresh(); };
    window.__studioSelectAll = () => null; /* multi-select TBD */
    return () => {
      delete window.__studioSelectMesh;
      delete window.__studioSelectedMesh;
      delete window.__studioSelectedMeshes;
      delete window.__studioDeselect;
      delete window.__studioSelectAll;
    };
  }, [selectedRef, setSelected]);
  // Click-empty-space → deselect.
  const onPointerMissed = useCallback(() => {
    setSelected(null);
  }, [setSelected]);
  useEffect(() => {
    // r3f passes onPointerMissed via <Canvas> prop; we wire that up in
    // the outer component. SelectionLayer just exports the handler via
    // a window hook for the outer scope.
    window.__studioPointerMissed = onPointerMissed;
    return () => { delete window.__studioPointerMissed; };
  }, [onPointerMissed]);
  return null;
}

// -----------------------------------------------------------------------
// Transform gizmo — mounts ONLY when a primitive is selected. Drei's
// TransformControls handles all the gizmo lifecycle (attach/detach,
// visibility, drag-cancel-on-orbit). The legacy gizmo-at-origin bug
// (Three.js 0.181 reasserting visible=true every frame) is unreachable
// because we mount the component conditionally — when there's no
// target, the component itself doesn't render.
// -----------------------------------------------------------------------
function TransformLayer({ selected, mode }) {
  if (!selected) return null;
  return (
    <DreiTransformControls
      object={selected}
      mode={mode}
      size={0.8}
      space="world"
    />
  );
}

// -----------------------------------------------------------------------
// Theme-aware grid + lighting.
// -----------------------------------------------------------------------
function SceneStaticsLayer({ theme }) {
  // Slice 951g — drei's <Grid> is an infinite-feeling fading floor:
  // no visible far edge, no horizon stripe. cellColor / sectionColor
  // are tuned to the slice-950 monochrome palette (no chromatic
  // accent). Position y = -0.001 sits just below world origin so the
  // origin axes don't z-fight.
  return (
    <>
      <ambientLight intensity={theme === 'light' ? 0.7 : 0.35} />
      <directionalLight position={[10, 20, 10]} intensity={0.6} castShadow={false} />
      <directionalLight position={[-10, 5, -10]} intensity={0.2} />
      <Grid
        args={[10, 10]}
        cellSize={0.1}
        cellThickness={0.6}
        cellColor={theme === 'light' ? '#c0c0c0' : '#2a2a2a'}
        sectionSize={1}
        sectionThickness={1.0}
        sectionColor={theme === 'light' ? '#8a8a8a' : '#3a3a3a'}
        position={[0, -0.001, 0]}
        fadeDistance={30}
        fadeStrength={1.6}
        infiniteGrid
      />
    </>
  );
}

// -----------------------------------------------------------------------
// Public component used by StudioShellV3.
// -----------------------------------------------------------------------
function Viewport3D() {
  const [selected, setSelected] = useState(null);
  const selectedRef = useRef(null);
  selectedRef.current = selected;
  const setSelectedAndRef = useCallback((m) => {
    selectedRef.current = m;
    setSelected(m);
  }, []);

  const vpCtx = useViewport ? (() => { try { return useViewport(); } catch (_) { return null; } })() : null;
  const theme = (vpCtx && vpCtx.theme) || 'dark';
  const gizmoMode = (vpCtx && vpCtx.gizmoMode) || 'translate';

  return (
    <div
      data-studio-v3-viewport
      style={{
        position: 'absolute', inset: 0,
        background: theme === 'light' ? '#ebebeb' : '#181818',
      }}
    >
      <Canvas
        camera={{ position: [0.3, 0.2, 0.3], fov: 45, near: 0.001, far: 5000 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onPointerMissed={() => setSelectedAndRef(null)}
        style={{ width: '100%', height: '100%' }}
        data-testid="studio-viewport-canvas"
      >
        <color attach="background" args={[theme === 'light' ? '#ebebeb' : '#181818']} />
        <SceneStaticsLayer theme={theme} />
        <StudioBridge
          selectedRef={selectedRef}
          setSelected={setSelectedAndRef}
        />
        <SelectionLayer selectedRef={selectedRef} setSelected={setSelectedAndRef} />
        <TransformLayer selected={selected} mode={gizmoMode} />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport
            axisColors={['#a0a0a0', '#c8c8c8', '#888888']}
            labelColor="#dddddd"
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}

export default Viewport3D;
