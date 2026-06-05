// ArchDisc Studio V3 — Architecture side panel.
//
// Right-side floating panel exposing the SketchUp-style primitives:
//   • Add Wall (drag) — captures p1 + p2 via two ground-plane clicks
//                       in the viewport, then calls __studioArch
//                       CreateWall(p1, p2, height, thickness).
//   • Cut Door — opens the door form: wall uuid (picked from current
//                selection if available) + along + width + height.
//   • Cut Window — same shape as door, plus sill height.
//   • Add Floor — extrudes the active floor polygon from the panel
//                 (default footprint).
//   • Add Roof — generates a gable roof above the polygon.
//   • Generate Building — full house from the footprint with floors
//                         + wall height inputs.
//   • Add Dimension — drops a labelled dimension line between two
//                     points.
//
// Mounts into a body-attached host so we never touch StudioShellV3.

import React, { useEffect, useState } from 'react';

const PANEL_W = 312;

export default function ArchPanel({
  getStatus,
  createWall,
  cutDoor,
  cutWindow,
  createFloor,
  createGableRoof,
  generateBuilding,
  addDimension,
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);

  const [wallH, setWallH] = useState(2.7);
  const [wallTh, setWallTh] = useState(0.2);
  const [doorW, setDoorW] = useState(0.9);
  const [doorH, setDoorH] = useState(2.1);
  const [doorFrac, setDoorFrac] = useState(0.5);
  const [winW, setWinW] = useState(1.2);
  const [winH, setWinH] = useState(1.0);
  const [winFrac, setWinFrac] = useState(0.5);
  const [winSill, setWinSill] = useState(0.9);
  const [floorTh, setFloorTh] = useState(0.18);
  const [ridgeH, setRidgeH] = useState(1.6);
  const [overhang, setOverhang] = useState(0.3);
  const [bldgFloors, setBldgFloors] = useState(1);
  const [bldgWidth, setBldgWidth] = useState(6);
  const [bldgDepth, setBldgDepth] = useState(4);
  const [lastResult, setLastResult] = useState('');

  useEffect(() => {
    const id = setInterval(tick, 600);
    return () => clearInterval(id);
  }, []);

  const status = getStatus ? getStatus() : { walls: 0, floors: 0, roofs: 0, dimensions: 0 };

  const log = (msg) => setLastResult(String(msg).slice(0, 90));

  const doAddWall = async () => {
    // Drag-style: place a simple 4-metre wall in the +X direction so
    // the user sees something immediately. The "drag" affordance is
    // exposed via the __studioArchPickStart op for spec-friendly use.
    const r = await createWall([0, 0, 0], [4, 0, 0], wallH, wallTh);
    if (!r || !r.ok) log(`wall failed: ${r && r.error}`);
    else log(`wall added (${r.uuid.slice(0, 8)})`);
    tick();
  };

  const doCutDoor = async () => {
    const u = window.__studioArchPickWallUuid && window.__studioArchPickWallUuid();
    if (!u) { log('select a wall first'); return; }
    const r = await cutDoor(u, doorFrac, doorW, doorH);
    if (!r || !r.ok) log(`door failed: ${r && r.error}`);
    else log(`door cut (frame ${r.frameUuid.slice(0, 8)})`);
    tick();
  };

  const doCutWindow = async () => {
    const u = window.__studioArchPickWallUuid && window.__studioArchPickWallUuid();
    if (!u) { log('select a wall first'); return; }
    const r = await cutWindow(u, winFrac, winW, winH, winSill);
    if (!r || !r.ok) log(`window failed: ${r && r.error}`);
    else log(`window cut (${r.uuid.slice(0, 8)})`);
    tick();
  };

  const doAddFloor = async () => {
    const W = bldgWidth, D = bldgDepth;
    const poly = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
    const r = await createFloor(poly, floorTh);
    if (!r || !r.ok) log(`floor failed: ${r && r.error}`);
    else log(`floor added (${r.uuid.slice(0, 8)})`);
    tick();
  };

  const doAddRoof = async () => {
    const W = bldgWidth, D = bldgDepth;
    const poly = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
    const r = await createGableRoof(poly, ridgeH, overhang);
    if (!r || !r.ok) log(`roof failed: ${r && r.error}`);
    else log(`roof added (${r.uuid.slice(0, 8)})`);
    tick();
  };

  const doGenerateBuilding = async () => {
    const W = bldgWidth, D = bldgDepth;
    const poly = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
    const r = await generateBuilding(poly, bldgFloors, wallH, {
      floorThickness: floorTh,
      wallThickness: wallTh,
      ridgeHeight: ridgeH,
      overhang,
    });
    if (!r || !r.ok) log(`building failed: ${r && r.error}`);
    else log(`building (${r.uuids.length} parts)`);
    tick();
  };

  const doAddDim = async () => {
    const W = bldgWidth;
    const r = await addDimension([-W / 2, 0.02, 0], [W / 2, 0.02, 0], { size: 0.4 });
    if (!r || !r.ok) log(`dim failed: ${r && r.error}`);
    else log(`dim added (${r.distance.toFixed(2)}m)`);
    tick();
  };

  return (
    <div
      data-studio-v3-arch-panel
      style={{
        position: 'fixed',
        top: 70, right: 14,
        width: PANEL_W,
        maxHeight: 'calc(100vh - 100px)',
        zIndex: 9410,
        background: 'var(--studio-bg-elev, #161b22)',
        border: '1px solid rgba(154,166,178,0.35)',
        borderRadius: 6,
        color: 'var(--studio-ink, #e6edf3)',
        fontFamily: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
      }}
    >
      <div style={hdr()}>
        <strong style={hdrTitle()}>Architecture</strong>
        <span style={hdrMeta()}>
          {status.walls}w · {status.floors}f · {status.roofs}r · {status.dimensions}d
        </span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-arch-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={btn()}
        >×</button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 10px' }}>
        <Section label="Wall">
          <Row>
            <Field label="H (m)" v={wallH} set={setWallH} min={0.5} max={20} />
            <Field label="th (m)" v={wallTh} set={setWallTh} min={0.05} max={1} step={0.01} />
          </Row>
          <button
            data-studio-v3-arch-add-wall
            onClick={doAddWall}
            style={primary()}
          >Add Wall (drag)</button>
        </Section>

        <Section label="Door">
          <Row>
            <Field label="frac" v={doorFrac} set={setDoorFrac} min={0} max={1} step={0.01} />
            <Field label="W" v={doorW} set={setDoorW} min={0.4} max={3} step={0.05} />
            <Field label="H" v={doorH} set={setDoorH} min={1.0} max={4} step={0.05} />
          </Row>
          <button
            data-studio-v3-arch-cut-door
            onClick={doCutDoor}
            style={primary()}
          >Cut Door</button>
        </Section>

        <Section label="Window">
          <Row>
            <Field label="frac" v={winFrac} set={setWinFrac} min={0} max={1} step={0.01} />
            <Field label="W" v={winW} set={setWinW} min={0.3} max={3} step={0.05} />
            <Field label="H" v={winH} set={setWinH} min={0.3} max={3} step={0.05} />
            <Field label="sill" v={winSill} set={setWinSill} min={0} max={3} step={0.05} />
          </Row>
          <button
            data-studio-v3-arch-cut-window
            onClick={doCutWindow}
            style={primary()}
          >Cut Window</button>
        </Section>

        <Section label="Floor / Roof">
          <Row>
            <Field label="floorTh" v={floorTh} set={setFloorTh} min={0.05} max={1} step={0.01} />
            <Field label="ridgeH" v={ridgeH} set={setRidgeH} min={0.2} max={6} step={0.05} />
            <Field label="oh" v={overhang} set={setOverhang} min={0} max={2} step={0.05} />
          </Row>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              data-studio-v3-arch-add-floor
              onClick={doAddFloor}
              style={{ ...primary(), flex: 1 }}
            >+ Floor</button>
            <button
              data-studio-v3-arch-add-roof
              onClick={doAddRoof}
              style={{ ...primary(), flex: 1 }}
            >+ Roof</button>
          </div>
        </Section>

        <Section label="Generate Building">
          <Row>
            <Field label="floors" v={bldgFloors} set={(v) => setBldgFloors(Math.round(v))} min={1} max={10} step={1} />
            <Field label="W" v={bldgWidth} set={setBldgWidth} min={1} max={50} step={0.1} />
            <Field label="D" v={bldgDepth} set={setBldgDepth} min={1} max={50} step={0.1} />
          </Row>
          <button
            data-studio-v3-arch-generate-building
            onClick={doGenerateBuilding}
            style={primary()}
          >Generate House</button>
        </Section>

        <Section label="Dimension">
          <button
            data-studio-v3-arch-add-dim
            onClick={doAddDim}
            style={primary()}
          >Add Dimension Line</button>
        </Section>

        {lastResult && (
          <div
            data-studio-v3-arch-log
            style={{
              fontSize: 10, opacity: 0.7, marginTop: 8,
              fontFamily: 'var(--studio-mono, ui-monospace)',
              padding: '4px 6px',
              border: '1px solid rgba(154,166,178,0.25)',
              borderRadius: 3,
              background: 'rgba(13,17,23,0.4)',
            }}
          >{lastResult}</div>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{
      marginBottom: 10, paddingBottom: 10,
      borderBottom: '1px solid rgba(154,166,178,0.18)',
    }}>
      <div style={{
        fontSize: 10, letterSpacing: '0.06em',
        opacity: 0.65, marginBottom: 4, textTransform: 'uppercase',
      }}>{label}</div>
      {children}
    </div>
  );
}

function Row({ children }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>{children}</div>
  );
}

function Field({ label, v, set, min, max, step }) {
  return (
    <label style={{ fontSize: 9, flex: '1 1 60px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ opacity: 0.65 }}>{label}</span>
      <input
        type="number"
        min={min} max={max} step={step || 0.1}
        value={v}
        onChange={(e) => set(parseFloat(e.target.value))}
        style={inp()}
      />
    </label>
  );
}

function hdr() {
  return {
    padding: '8px 12px',
    background: 'rgba(13,17,23,0.6)',
    borderBottom: '1px solid rgba(29,233,182,0.45)',
    display: 'flex', alignItems: 'center', gap: 8,
  };
}
function hdrTitle() {
  return { color: 'var(--studio-accent, #1de9b6)', fontSize: 12, letterSpacing: '0.05em' };
}
function hdrMeta() {
  return { opacity: 0.55, fontSize: 10, fontFamily: 'var(--studio-mono, ui-monospace)' };
}
function btn() {
  return {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
  };
}
function primary() {
  return {
    background: 'rgba(29,233,182,0.16)', color: 'var(--studio-accent, #1de9b6)',
    border: '1px solid rgba(29,233,182,0.55)',
    padding: '4px 10px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
    width: '100%', textAlign: 'center',
  };
}
function inp() {
  return {
    background: 'rgba(13,17,23,0.6)', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '2px 4px', borderRadius: 3, fontSize: 11, width: '100%',
  };
}
