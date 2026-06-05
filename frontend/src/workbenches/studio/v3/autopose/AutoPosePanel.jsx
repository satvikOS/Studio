// ArchDisc Studio V3 — AutoPose side panel.
//
// Floating right-side panel matching the EeveePanel / SnapPanel style:
//   • Header chip showing the active armature uuid (truncated).
//   • COM section — live readouts of (x, y, z) and total mass.
//   • Balance section — iteration count, step slider, "Run AutoBalance"
//     button + post-run distance-to-centroid chip.
//   • Contact section — list of tagged bones with on/off toggle, ground-Y
//     slider, "Run AutoContact" button.
//   • Trajectory section — t0/t1/peakHeight numerics, "Bake ballistic"
//     button.
//
// All side effects go through the props injected by autopose/index.js so
// the panel stays pure and rerenders predictably. Polls every 500ms so
// the COM readout stays fresh when bones move via other ops.

import React, { useEffect, useState } from 'react';

const PANEL_W = 296;

export default function AutoPosePanel({
  activeArmatureUuid,
  setActiveArmatureUuid,
  listArmatures,
  getCOM,
  runBalance,
  runContact,
  listContacts,
  bakeTrajectory,
  onCloseRequest,
}) {
  const [, force] = useState(0);
  const tick = () => force((v) => v + 1);
  const [iterations, setIterations] = useState(12);
  const [step, setStep] = useState(0.18);
  const [groundY, setGroundY] = useState(0);
  const [t0, setT0] = useState(0);
  const [t1, setT1] = useState(1);
  const [peak, setPeak] = useState(1.2);
  const [lastBalance, setLastBalance] = useState(null);
  const [lastContact, setLastContact] = useState(null);
  const [lastTrajectory, setLastTrajectory] = useState(null);

  useEffect(() => {
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  const armatures = (listArmatures && listArmatures()) || [];
  const com = (activeArmatureUuid && getCOM && getCOM(activeArmatureUuid)) || null;
  const contactList = (activeArmatureUuid && listContacts && listContacts(activeArmatureUuid)) || null;

  const armChip = activeArmatureUuid
    ? `${activeArmatureUuid.slice(0, 6)}…${activeArmatureUuid.slice(-3)}`
    : '(none)';

  return (
    <div
      data-studio-v3-autopose-panel
      style={{
        position: 'fixed',
        top: 70, right: 14,
        width: PANEL_W,
        maxHeight: 'calc(100vh - 90px)',
        zIndex: 9400,
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
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        background: 'rgba(13,17,23,0.6)',
        borderBottom: '1px solid rgba(29,233,182,0.45)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <strong style={{ color: 'var(--studio-accent, #1de9b6)', fontSize: 12, letterSpacing: '0.05em' }}>
          AutoPose
        </strong>
        <span data-studio-v3-autopose-armchip style={{
          fontSize: 9, opacity: 0.6,
          fontFamily: 'var(--studio-mono, ui-monospace)',
        }}>{armChip}</span>
        <div style={{ flex: 1 }} />
        <button
          data-studio-v3-autopose-close
          onClick={() => onCloseRequest && onCloseRequest()}
          style={btn()}
        >×</button>
      </div>

      <div style={{ overflowY: 'auto', overflowX: 'hidden' }}>

      {/* Armature picker */}
      <Section title="Active armature">
        <select
          data-studio-v3-autopose-arm-select
          value={activeArmatureUuid || ''}
          onChange={(e) => { setActiveArmatureUuid(e.target.value || null); tick(); }}
          style={{
            margin: '4px 10px 6px',
            background: 'rgba(0,0,0,0.3)',
            color: 'inherit',
            border: '1px solid rgba(154,166,178,0.35)',
            borderRadius: 3, fontSize: 11,
            padding: '3px 6px',
            width: 'calc(100% - 20px)',
          }}
        >
          <option value="">(pick armature)</option>
          {armatures.map((a) => (
            <option key={a.uuid} value={a.uuid}>{a.name || a.uuid.slice(0, 8)}</option>
          ))}
        </select>
      </Section>

      {/* Center of mass */}
      <Section title="Center of mass">
        <Row label="x">
          <Num value={com && com.ok ? com.com[0] : null} tag="autopose-com-x" />
        </Row>
        <Row label="y">
          <Num value={com && com.ok ? com.com[1] : null} tag="autopose-com-y" />
        </Row>
        <Row label="z">
          <Num value={com && com.ok ? com.com[2] : null} tag="autopose-com-z" />
        </Row>
        <Row label="mass">
          <Num value={com && com.ok ? com.mass : null} tag="autopose-com-mass" digits={4} />
        </Row>
      </Section>

      {/* AutoBalance */}
      <Section title="AutoBalance">
        <Row label="iters">
          <input
            data-studio-v3-autopose-iters
            type="range" min={1} max={32} step={1}
            value={iterations}
            onChange={(e) => setIterations(+e.target.value)}
            style={range()}
          />
          <span style={num()}>{iterations}</span>
        </Row>
        <Row label="step">
          <input
            data-studio-v3-autopose-step
            type="range" min={0.02} max={0.4} step={0.01}
            value={step}
            onChange={(e) => setStep(+e.target.value)}
            style={range()}
          />
          <span style={num()}>{step.toFixed(2)}</span>
        </Row>
        <div style={{ padding: '4px 10px', display: 'flex', gap: 6 }}>
          <button
            data-studio-v3-autopose-balance-run
            onClick={() => {
              const r = runBalance && runBalance(activeArmatureUuid, { iterations, step });
              setLastBalance(r);
              tick();
            }}
            style={btnAccent()}
            disabled={!activeArmatureUuid}
          >Run AutoBalance</button>
        </div>
        {lastBalance && (
          <div data-studio-v3-autopose-balance-result style={{ padding: '2px 10px 6px', fontSize: 9, fontFamily: 'var(--studio-mono, ui-monospace)', opacity: 0.7 }}>
            {lastBalance.ok
              ? `iters ${lastBalance.iterations} · dist ${(lastBalance.finalDistance || 0).toFixed(3)} m · ${lastBalance.balanced ? 'balanced' : 'partial'}`
              : `err: ${lastBalance.error}`}
          </div>
        )}
      </Section>

      {/* AutoContact */}
      <Section title="AutoContact">
        <Row label="ground Y">
          <input
            data-studio-v3-autopose-groundy
            type="range" min={-2} max={2} step={0.01}
            value={groundY}
            onChange={(e) => setGroundY(+e.target.value)}
            style={range()}
          />
          <span style={num()}>{groundY.toFixed(2)}</span>
        </Row>
        <div style={{ padding: '2px 10px', fontSize: 9, opacity: 0.7 }}>
          tagged: {contactList && contactList.ok ? contactList.count : 0}
        </div>
        <div style={{ padding: '4px 10px', display: 'flex', gap: 6 }}>
          <button
            data-studio-v3-autopose-contact-run
            onClick={() => {
              const r = runContact && runContact(activeArmatureUuid, groundY);
              setLastContact(r);
              tick();
            }}
            style={btnAccent()}
            disabled={!activeArmatureUuid}
          >Run AutoContact</button>
        </div>
        {lastContact && (
          <div data-studio-v3-autopose-contact-result style={{ padding: '2px 10px 6px', fontSize: 9, fontFamily: 'var(--studio-mono, ui-monospace)', opacity: 0.7 }}>
            {lastContact.ok
              ? `snapped ${lastContact.count} bones`
              : `err: ${lastContact.error}`}
          </div>
        )}
      </Section>

      {/* Ballistic trajectory */}
      <Section title="Ballistic jump">
        <Row label="t0">
          <input
            data-studio-v3-autopose-t0
            type="number" step={0.05} min={0}
            value={t0}
            onChange={(e) => setT0(+e.target.value)}
            style={numIn()}
          />
        </Row>
        <Row label="t1">
          <input
            data-studio-v3-autopose-t1
            type="number" step={0.05} min={0}
            value={t1}
            onChange={(e) => setT1(+e.target.value)}
            style={numIn()}
          />
        </Row>
        <Row label="peak">
          <input
            data-studio-v3-autopose-peak
            type="number" step={0.05} min={0}
            value={peak}
            onChange={(e) => setPeak(+e.target.value)}
            style={numIn()}
          />
        </Row>
        <div style={{ padding: '4px 10px' }}>
          <button
            data-studio-v3-autopose-trajectory-run
            onClick={() => {
              const r = bakeTrajectory && bakeTrajectory(activeArmatureUuid, t0, t1, peak);
              setLastTrajectory(r);
              tick();
            }}
            style={btnAccent()}
            disabled={!activeArmatureUuid}
          >Bake ballistic</button>
        </div>
        {lastTrajectory && (
          <div data-studio-v3-autopose-trajectory-result style={{ padding: '2px 10px 6px', fontSize: 9, fontFamily: 'var(--studio-mono, ui-monospace)', opacity: 0.7 }}>
            {lastTrajectory.ok
              ? `${lastTrajectory.samples ? lastTrajectory.samples.length : 0} keys baked`
              : `err: ${lastTrajectory.error}`}
          </div>
        )}
      </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ borderBottom: '1px solid rgba(154,166,178,0.18)' }}>
      <div style={{
        padding: '6px 12px 2px',
        fontSize: 9, letterSpacing: '0.08em',
        textTransform: 'uppercase', opacity: 0.6,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px' }}>
      <span style={{ fontSize: 10, opacity: 0.55, minWidth: 54 }}>{label}</span>
      {children}
    </div>
  );
}

function Num({ value, tag, digits = 3 }) {
  return (
    <span
      data-studio-v3={tag}
      style={{
        fontSize: 10,
        fontFamily: 'var(--studio-mono, ui-monospace)',
        opacity: value == null ? 0.4 : 0.85,
        marginLeft: 4,
      }}
    >{value == null ? '—' : (+value).toFixed(digits)}</span>
  );
}

function range() {
  return { flex: 1, accentColor: 'var(--studio-accent, #1de9b6)' };
}

function num() {
  return {
    fontSize: 10, opacity: 0.85,
    fontFamily: 'var(--studio-mono, ui-monospace)',
    minWidth: 36, textAlign: 'right',
  };
}

function numIn() {
  return {
    width: 64,
    background: 'rgba(0,0,0,0.3)',
    color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    borderRadius: 3, fontSize: 11,
    padding: '2px 6px',
    fontFamily: 'var(--studio-mono, ui-monospace)',
  };
}

function btn() {
  return {
    background: 'transparent', color: 'inherit',
    border: '1px solid rgba(154,166,178,0.35)',
    padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
  };
}

function btnAccent() {
  return {
    background: 'rgba(29,233,182,0.18)',
    color: 'var(--studio-accent, #1de9b6)',
    border: '1px solid rgba(29,233,182,0.55)',
    padding: '4px 10px', borderRadius: 3,
    fontSize: 11, cursor: 'pointer',
  };
}
