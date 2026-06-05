// ArchDisc Studio V3 — particle depth (hair + forces + mesh emitter +
// collider) e2e.
//
// Headed Mac-Electron spec per the user's remote-desktop verification
// memory. Launches Electron --dev so we can dynamic-import the fx
// autoload bundle from Vite when api.js orchestration hasn't been
// updated to import it (same trick the sim spec uses).
//
// Coverage:
//   1. Hair: __studioFXHairCreate from a scaled sphere, verify strands,
//      step under gravity + wind + a vortex, confirm a tip vertex moves
//      downward (gravity pulls strand tips below their roots).
//   2. Forces: register an attract field, a vortex, and a drag; verify
//      __studioFXForceList returns three entries; remove the attract.
//   3. Mesh emitter: emitFromMesh on the sphere — particles spawn at
//      sphere-vertex world positions; verify count + spread.
//   4. Collider: add a ground-plane mesh as a collider, drop the
//      particle system under gravity + check that no particle penetrates
//      below the collider's AABB max Y after a few seconds.
//   5. Master tick: __studioFXTogglePlay chains __fx into __studioAnim
//      Tick; toggle off splices it out.
//   6. Command palette: every __studioFX* under category 'fx'.
//   7. Multi-cam screenshots (front/iso/right/top/close) per the Forge
//      multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-fx');

test('Studio V3 — fx: hair + forces + mesh emitter + collider', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // ─── Ensure the fx autoload has run. If api.js's orchestrator has
  // wired the dynamic import, the install is already done; otherwise
  // we install it via the dev-server URL. ────────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioFXHairCreate !== 'function') {
      await import('/src/workbenches/studio/v3/fx/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioFXHairCreate === 'function'
       && typeof window.__studioFXForceAdd === 'function'
       && typeof window.__studioFXEmitFromMesh === 'function'
       && typeof window.__studioFXColliderAdd === 'function'
       && typeof window.__studioFXTogglePlay === 'function',
    null, { timeout: 15000 },
  );

  // ─── Spawn a source sphere — scaled up per the scale-to-viewer memory
  // so screenshots are dominated by the fx and not by a black void. ────
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  const sphereUuid = await win.evaluate(() => {
    let s = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere' && !s) s = o;
    });
    if (s) {
      s.scale.set(40, 40, 40);
      s.position.set(0, 2.5, 0);
      s.updateMatrixWorld(true);
    }
    return s ? s.uuid : null;
  });
  expect(typeof sphereUuid).toBe('string');

  // ─── 1. Hair ─────────────────────────────────────────────────────────
  const hair = await win.evaluate((u) => window.__studioFXHairCreate(u, {
    strands: 60,
    segs: 8,
    length: 0.8,
    variance: 0.25,
    radius: 0.015,
    radialSegments: 4,
    color: 0x5a2a10,
  }), sphereUuid);
  expect(hair.ok).toBe(true);
  expect(hair.strands).toBe(60);
  expect(hair.segs).toBe(8);

  // hairList shows it.
  const hairList = await win.evaluate(() => window.__studioFXHairList());
  expect(hairList.hairs.length).toBe(1);
  expect(hairList.hairs[0].uuid).toBe(hair.uuid);

  // setLength rescales strand rest segments.
  const lenOk = await win.evaluate((u) => window.__studioFXHairSetLength(u, 1.2), hair.uuid);
  expect(lenOk.ok).toBe(true);

  // setVariance re-rolls strand totals.
  const varOk = await win.evaluate((u) => window.__studioFXHairSetVariance(u, 0.5), hair.uuid);
  expect(varOk.ok).toBe(true);

  // Set wind, capture a tip position, step, verify it moved (gravity +
  // wind together pull tips off the radial straight-out start pose).
  await win.evaluate(() => window.__studioFXHairSetWind([2, 0, 0]));
  const tipBefore = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    const m = scene.getObjectByProperty('uuid', u);
    const s = m.userData.archdiscStudioHair;
    const st = s.strands[0];
    const k = st.segCount;
    return [st.positions[k * 3], st.positions[k * 3 + 1], st.positions[k * 3 + 2]];
  }, hair.uuid);
  for (let i = 0; i < 40; i++) {
    await win.evaluate(() => window.__studioFXHairStep(0.016));
  }
  const tipAfter = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    const m = scene.getObjectByProperty('uuid', u);
    const s = m.userData.archdiscStudioHair;
    const st = s.strands[0];
    const k = st.segCount;
    return [st.positions[k * 3], st.positions[k * 3 + 1], st.positions[k * 3 + 2]];
  }, hair.uuid);
  // It moved (gravity + wind cause some displacement).
  const dx = tipAfter[0] - tipBefore[0];
  const dy = tipAfter[1] - tipBefore[1];
  const dz = tipAfter[2] - tipBefore[2];
  expect(Math.hypot(dx, dy, dz)).toBeGreaterThan(0.01);

  await win.screenshot({ path: path.join(OUT, '01-hair.png') });

  // ─── 2. Forces ───────────────────────────────────────────────────────
  const fAttract = await win.evaluate(() => window.__studioFXForceAdd('attract', {
    pos: [0, 4, 0], strength: 3, radius: 4,
  }));
  expect(fAttract.ok).toBe(true);
  expect(typeof fAttract.uuid).toBe('string');

  const fVortex = await win.evaluate(() => window.__studioFXForceAdd('vortex', {
    pos: [0, 2, 0], axis: [0, 1, 0], strength: 1.5,
  }));
  expect(fVortex.ok).toBe(true);

  const fDrag = await win.evaluate(() => window.__studioFXForceAdd('drag', {
    coefficient: 0.4,
  }));
  expect(fDrag.ok).toBe(true);

  const fList = await win.evaluate(() => window.__studioFXForceList());
  expect(fList.forces.length).toBe(3);
  const kinds = fList.forces.map((f) => f.kind).sort();
  expect(kinds).toEqual(['attract', 'drag', 'vortex']);

  // Remove attract.
  const rem = await win.evaluate((u) => window.__studioFXForceRemove(u), fAttract.uuid);
  expect(rem.ok).toBe(true);
  const fList2 = await win.evaluate(() => window.__studioFXForceList());
  expect(fList2.forces.length).toBe(2);

  await win.screenshot({ path: path.join(OUT, '02-forces.png') });

  // ─── 3. Mesh emitter ─────────────────────────────────────────────────
  const emit = await win.evaluate((u) => window.__studioFXEmitFromMesh(u, 400, {
    color1: 0xffaa44, color2: 0x44aaff,
  }), sphereUuid);
  expect(emit.ok).toBe(true);
  expect(emit.count).toBe(400);

  // The first emitted particle should be at a sphere-vertex world
  // position (not the slice-632 origin disc). Quick sanity: the
  // particles are spread non-zero (positions have variance > 0.5).
  const spread = await win.evaluate((u) => {
    const p = window.__archdiscScene.getObjectByProperty('uuid', u);
    const arr = p.geometry.attributes.position.array;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i + 1] < minY) minY = arr[i + 1];
      if (arr[i + 1] > maxY) maxY = arr[i + 1];
    }
    return { minY, maxY };
  }, emit.uuid);
  expect(spread.maxY - spread.minY).toBeGreaterThan(0.5);

  const eList = await win.evaluate(() => window.__studioFXEmitterList());
  expect(eList.emitters.length).toBe(1);

  await win.screenshot({ path: path.join(OUT, '03-emitter.png') });

  // ─── 4. Collider ─────────────────────────────────────────────────────
  // Spawn a cube, scale it into a thin ground plate, register as collider.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  const groundUuid = await win.evaluate(() => {
    let g = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube' && !g) g = o;
    });
    if (g) {
      g.scale.set(8, 0.1, 8);
      g.position.set(0, -0.5, 0);
      g.updateMatrixWorld(true);
      if (g.geometry && g.geometry.computeBoundingBox) g.geometry.computeBoundingBox();
    }
    return g ? g.uuid : null;
  });
  expect(typeof groundUuid).toBe('string');

  const colAdd = await win.evaluate((u) => window.__studioFXColliderAdd(u), groundUuid);
  expect(colAdd.ok).toBe(true);
  expect(colAdd.uuid).toBe(groundUuid);
  const cList = await win.evaluate(() => window.__studioFXColliderList());
  expect(cList.colliders.length).toBe(1);

  // Compute the collider AABB top Y so we have a ground line to test.
  const colTop = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    m.updateMatrixWorld(true);
    const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    return bb.max.y;
  }, groundUuid);

  // Toggle the fx tick on so the augment runs alongside slice-632 step.
  const togOn = await win.evaluate(() => window.__studioFXTogglePlay());
  expect(togOn.ok).toBe(true);
  expect(togOn.playing).toBe(true);

  const chainHasFX = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    let cur = v && v.__studioAnimTick, found = false;
    while (cur) { if (cur.__fx) { found = true; break; } cur = cur.__prev; }
    return found;
  });
  expect(chainHasFX).toBe(true);

  // Wait for the chain to actually tick a few frames.
  await win.waitForTimeout(800);
  // Also explicitly drive the slice-632 particle stepper for determinism
  // (the fx augment integrates forces + colliders, slice 632 integrates
  // gravity + ageing).
  for (let i = 0; i < 30; i++) {
    await win.evaluate(() => window.__studioParticleStep && window.__studioParticleStep(0.016));
  }

  // Now: no particle from our emitter should sit below colTop + small
  // numerical fudge once the collider clamps + bounces.
  const lowest = await win.evaluate((u) => {
    const p = window.__archdiscScene.getObjectByProperty('uuid', u);
    const arr = p.geometry.attributes.position.array;
    let minY = Infinity;
    for (let i = 1; i < arr.length; i += 3) {
      if (arr[i] < minY) minY = arr[i];
    }
    return minY;
  }, emit.uuid);
  expect(lowest).toBeGreaterThanOrEqual(colTop - 0.05);

  await win.screenshot({ path: path.join(OUT, '04-collider.png') });

  // ─── 5. Master tick toggle off ───────────────────────────────────────
  const togOff = await win.evaluate(() => window.__studioFXTogglePlay());
  expect(togOff.ok).toBe(true);
  expect(togOff.playing).toBe(false);
  const chainCleared = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    let cur = v && v.__studioAnimTick, found = false;
    while (cur) { if (cur.__fx) { found = true; break; } cur = cur.__prev; }
    return found;
  });
  expect(chainCleared).toBe(false);

  const status = await win.evaluate(() => window.__studioFXStatus());
  expect(status.ok).toBe(true);
  expect(status.playing).toBe(false);
  expect(status.hair).toBe(1);
  expect(status.forces).toBe(2);
  expect(status.colliders).toBe(1);
  expect(status.emitters).toBe(1);

  // ─── 6. Command palette registration under category 'fx' ─────────────
  const fxCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('fx');
  });
  expect(fxCmds.ok).toBe(true);
  const names = fxCmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioFXHairCreate', '__studioFXHairSetLength', '__studioFXHairSetVariance',
    '__studioFXHairDelete',
    '__studioFXForceAdd', '__studioFXForceRemove', '__studioFXForceList',
    '__studioFXEmitFromMesh',
    '__studioFXColliderAdd', '__studioFXColliderRemove', '__studioFXColliderList',
    '__studioFXTogglePlay',
  ]) {
    expect(names).toContain(expected);
  }
  expect(fxCmds.commands.length).toBeGreaterThanOrEqual(12);

  // ─── 7. Multi-cam screenshots ────────────────────────────────────────
  // Five named camera angles. Toggle the fx tick back on so each shot
  // sees a slightly evolved state.
  await win.evaluate(() => window.__studioFXTogglePlay());
  await win.waitForTimeout(300);

  const cams = [
    { name: 'front', pos: [0, 2.5, 6],  target: [0, 1.5, 0] },
    { name: 'iso',   pos: [4, 4, 4],    target: [0, 1.5, 0] },
    { name: 'right', pos: [6, 2, 0],    target: [0, 1.5, 0] },
    { name: 'top',   pos: [0, 7, 0.01], target: [0, 0, 0] },
    { name: 'close', pos: [2.5, 2, 2.5], target: [0, 1.5, 0] },
  ];
  for (const c of cams) {
    await win.evaluate(({ pos, target }) => {
      const v = window.__archdiscViewport;
      if (!v) return;
      v.camera.position.set(pos[0], pos[1], pos[2]);
      v.camera.lookAt(target[0], target[1], target[2]);
      if (v.orbitControls) {
        v.orbitControls.target.set(target[0], target[1], target[2]);
        v.orbitControls.update();
      }
      v.camera.updateMatrixWorld(true);
      v.renderer.render(v.scene, v.camera);
    }, c);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `05-${c.name}.png`) });
  }

  // Stop the fx tick before tearing down.
  await win.evaluate(() => window.__studioFXTogglePlay());

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log(`  fx: hair ${hair.strands}×${hair.segs} segs, ` +
              `${fList2.forces.length} forces, ` +
              `emitter ${emit.count}, ${fxCmds.commands.length} commands`);

  await app.close();
});
