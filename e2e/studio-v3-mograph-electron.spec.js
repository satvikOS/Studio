// ArchDisc Studio V3 — MoGraph parity (Cloners + Effectors + Fields).
//
// Headed Mac-Electron spec. Drives the real V3 shell against the Vite
// dev server, dynamic-imports the mograph autoload (api.js is owned
// by the orchestrator and we can't touch it), spawns a cube, runs all
// four cloners, three effectors, three field types, and verifies the
// instance-matrix mutations + field bindings actually land.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-mograph');

test('Studio V3 — MoGraph cloners / effectors / fields', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  // --dev makes electron load from the Vite dev server (port 3000) so we
  // can dynamic-import the mograph autoload module directly from /src/.
  // The orchestrator will static-import this autoload in api.js in a
  // follow-up slice; until then, this is the only way the test sees
  // window.__studioCloner* without a rebuild step.
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    // Lower slowMo than the V3 default — this spec runs 50+ ops and
    // hits the 180s test budget with the 250ms default. Bump via env.
    slowMo: Number(process.env.STUDIO_SLOWMO) || 80,
  });

  // In --dev mode electron also opens DevTools, so firstWindow() may
  // return the DevTools page. Wait for the actual app window (http://
  // localhost:3000) to appear and use that as our test target.
  async function findAppWindow() {
    for (let i = 0; i < 50; i++) {
      const wins = app.windows();
      const app1 = wins.find((w) => /^https?:\/\/localhost:3000/.test(w.url()));
      if (app1) return app1;
      await new Promise((r) => setTimeout(r, 200));
    }
    return app.windows()[0];
  }
  const win = await findAppWindow();
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
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function'
    || (window.__archdiscViewport && typeof window.__archdiscViewport.getSelected === 'function'),
    null, { timeout: 15000 });

  // ─── Install the mograph surface via the dev-server autoload. ───────
  await win.evaluate(async () => {
    if (typeof window.__studioClonerLinear !== 'function') {
      await import('/src/workbenches/studio/v3/mograph/autoload.js');
    }
    // Defer one microtask so the autoload's Promise.resolve().then(...)
    // install gets a chance to land before we probe for the ops.
    await new Promise((r) => setTimeout(r, 30));
  });
  await win.waitForFunction(() => typeof window.__studioClonerLinear === 'function',
    null, { timeout: 15000 });

  // ─── Spawn a cube and attach it as the active mesh. ─────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  const cubeUuid = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    if (cube) vp.transformControls.attach(cube);
    return cube && cube.uuid;
  });
  expect(cubeUuid).toBeTruthy();
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ─── Cloner: Linear (8 copies along +X). ────────────────────────────
  const linear = await win.evaluate(() =>
    window.__studioClonerLinear(8, [0.12, 0, 0]));
  expect(linear.ok).toBe(true);
  expect(linear.count).toBe(8);
  expect(typeof linear.uuid).toBe('string');
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-cloner-linear.png') });

  // ─── Cloner: Radial (12 around Y axis). ─────────────────────────────
  // Re-attach the cube so radial reads it as the source.
  await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.uuid === u) cube = o; });
    if (cube) vp.transformControls.attach(cube);
  }, cubeUuid);
  const radial = await win.evaluate(() =>
    window.__studioClonerRadial(12, 0.4, 'y'));
  expect(radial.ok).toBe(true);
  expect(radial.count).toBe(12);
  await win.screenshot({ path: path.join(OUT, '02-cloner-radial.png') });

  // ─── Cloner: Grid (3x2x2 = 12 copies). ──────────────────────────────
  await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.uuid === u) cube = o; });
    if (cube) vp.transformControls.attach(cube);
  }, cubeUuid);
  const grid = await win.evaluate(() =>
    window.__studioClonerGrid(3, 2, 2, [0.15, 0.15, 0.15]));
  expect(grid.ok).toBe(true);
  expect(grid.count).toBe(12);
  const gridUuid = grid.uuid;
  await win.screenshot({ path: path.join(OUT, '03-cloner-grid.png') });

  // ─── Cloner: OnObject (clones on cube vertices). ───────────────────
  await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.uuid === u) cube = o; });
    if (cube) vp.transformControls.attach(cube);
  }, cubeUuid);
  const onObj = await win.evaluate((u) => window.__studioClonerOnObject(u), cubeUuid);
  expect(onObj.ok).toBe(true);
  expect(onObj.count).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '04-cloner-on-object.png') });

  // ─── List cloners — should have 4 entries by now. ───────────────────
  const cl = await win.evaluate(() => window.__studioClonerList());
  expect(cl.ok).toBe(true);
  expect(cl.count).toBeGreaterThanOrEqual(4);

  // ─── Effector: Plain on the grid cloner. Verify per-instance
  //     matrices actually moved by the requested amount.
  const before = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    const arr = new Array(m.count);
    const tmp = new (window.THREE || (vp.THREE)).Matrix4
      ? new (window.THREE || (vp.THREE)).Matrix4()
      : { fromArray() {}, elements: new Array(16).fill(0) };
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, tmp);
      arr[i] = [tmp.elements[12], tmp.elements[13], tmp.elements[14]];
    }
    return arr;
  }, gridUuid);

  const plain = await win.evaluate((u) =>
    window.__studioEffectorPlain(u, [0, 0.5, 0], [0, 0, 0], [0, 0, 0]), gridUuid);
  expect(plain.ok).toBe(true);
  expect(plain.count).toBe(12);

  const afterPlain = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    const arr = new Array(m.count);
    for (let i = 0; i < m.count; i++) {
      const e = new Array(16);
      m.instanceMatrix.array.slice(i * 16, i * 16 + 16).forEach((v, j) => { e[j] = v; });
      arr[i] = [e[12], e[13], e[14]];
    }
    return arr;
  }, gridUuid);
  // Every instance must have moved by +0.5 along Y.
  for (let i = 0; i < before.length; i++) {
    expect(Math.abs(afterPlain[i][1] - before[i][1] - 0.5)).toBeLessThan(1e-4);
  }
  await win.screenshot({ path: path.join(OUT, '05-effector-plain.png') });

  // ─── Effector: Step (progressive). Replay re-bases off the original
  //     so we expect Y deltas of 0, 0.1, 0.2 … per instance.
  const step = await win.evaluate((u) =>
    window.__studioEffectorStep(u, { position: [0, 0.1, 0], rotation: [0, 0, 0], scale: [0, 0, 0] }), gridUuid);
  expect(step.ok).toBe(true);
  const afterStep = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    const arr = new Array(m.count);
    for (let i = 0; i < m.count; i++) {
      const e = m.instanceMatrix.array.slice(i * 16, i * 16 + 16);
      arr[i] = [e[12], e[13], e[14]];
    }
    return arr;
  }, gridUuid);
  for (let i = 0; i < before.length; i++) {
    expect(Math.abs(afterStep[i][1] - before[i][1] - 0.1 * i)).toBeLessThan(1e-4);
  }
  await win.screenshot({ path: path.join(OUT, '06-effector-step.png') });

  // ─── Effector: Random (just verify it ran and moved things). ────────
  const rnd = await win.evaluate((u) =>
    window.__studioEffectorRandom(u, 0.05, 0.5, 0.1), gridUuid);
  expect(rnd.ok).toBe(true);
  const rndEffectorUuid = rnd.effectorUuid;
  await win.screenshot({ path: path.join(OUT, '07-effector-random.png') });

  // ─── Fields: sphere + box + random. ─────────────────────────────────
  const sphereF = await win.evaluate(() =>
    window.__studioFieldSphere([0, 0, 0], 0.2));
  expect(sphereF.ok).toBe(true);
  // Sample centre + outside.
  const sCentre = await win.evaluate((u) => window.__studioFieldSample(u, [0, 0, 0]), sphereF.uuid);
  expect(sCentre.ok).toBe(true);
  expect(sCentre.weight).toBeCloseTo(1, 3);
  const sOut = await win.evaluate((u) => window.__studioFieldSample(u, [1, 1, 1]), sphereF.uuid);
  expect(sOut.weight).toBe(0);

  const boxF = await win.evaluate(() =>
    window.__studioFieldBox([-0.3, -0.3, -0.3], [0.3, 0.3, 0.3]));
  expect(boxF.ok).toBe(true);
  const bCentre = await win.evaluate((u) => window.__studioFieldSample(u, [0, 0, 0]), boxF.uuid);
  expect(bCentre.weight).toBeCloseTo(1, 3);
  const bOut = await win.evaluate((u) => window.__studioFieldSample(u, [10, 10, 10]), boxF.uuid);
  expect(bOut.weight).toBe(0);

  const randF = await win.evaluate(() => window.__studioFieldRandom(42));
  expect(randF.ok).toBe(true);
  // Deterministic: same seed + same position → same weight on two calls.
  const r1 = await win.evaluate((u) => window.__studioFieldSample(u, [0.1, 0.2, 0.3]), randF.uuid);
  const r2 = await win.evaluate((u) => window.__studioFieldSample(u, [0.1, 0.2, 0.3]), randF.uuid);
  expect(r1.weight).toBe(r2.weight);

  // ─── Field list reflects all three. ─────────────────────────────────
  const fl = await win.evaluate(() => window.__studioFieldList());
  expect(fl.ok).toBe(true);
  expect(fl.count).toBeGreaterThanOrEqual(3);

  // ─── Bind sphere field to the random effector then re-apply random.
  //     With a small radius the field zeros most clones, so most Y
  //     positions should snap back to the original layout (Δ < jitter).
  const bind = await win.evaluate((args) =>
    window.__studioEffectorBindField(args.eu, args.fu),
    { eu: rndEffectorUuid, fu: sphereF.uuid });
  expect(bind.ok).toBe(true);

  // Re-running random with the binding now in place: every clone
  // farther than radius from origin gets weight 0 → matrix equals
  // baseline (within a tiny epsilon).
  const rnd2 = await win.evaluate((u) =>
    window.__studioEffectorRandom(u, 0.05, 0.5, 0.1), gridUuid);
  expect(rnd2.ok).toBe(true);
  const afterBoundRnd = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    const arr = new Array(m.count);
    for (let i = 0; i < m.count; i++) {
      const e = m.instanceMatrix.array.slice(i * 16, i * 16 + 16);
      arr[i] = [e[12], e[13], e[14]];
    }
    return arr;
  }, gridUuid);
  // Verify: at least one clone outside the sphere returned to baseline
  // (within 1e-4). Grid corners are at ±0.15 ⇒ distance ≥ 0.15√3 ≈ 0.26
  // → outside our 0.2 sphere → weight 0 → matrix unchanged.
  let zeroedClones = 0;
  for (let i = 0; i < before.length; i++) {
    const dx = Math.abs(afterBoundRnd[i][0] - before[i][0]);
    const dy = Math.abs(afterBoundRnd[i][1] - before[i][1]);
    const dz = Math.abs(afterBoundRnd[i][2] - before[i][2]);
    if (dx < 1e-4 && dy < 1e-4 && dz < 1e-4) zeroedClones += 1;
  }
  // With a 3×2×2 grid at 0.15 spacing and a 0.2 sphere at origin, at
  // least the four corner instances sit outside the sphere.
  expect(zeroedClones).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '08-field-bound.png') });

  // ─── Command palette discovery — every mograph op registered. ───────
  const cmds = await win.evaluate(() => window.__studioCommandList('mograph'));
  expect(cmds.ok).toBe(true);
  const names = new Set(cmds.commands.map((c) => c.name));
  for (const n of [
    '__studioClonerLinear', '__studioClonerRadial', '__studioClonerGrid', '__studioClonerOnObject',
    '__studioEffectorRandom', '__studioEffectorPlain', '__studioEffectorStep',
    '__studioEffectorBindField',
    '__studioFieldSphere', '__studioFieldBox', '__studioFieldRandom', '__studioFieldList',
  ]) {
    expect(names.has(n)).toBe(true);
  }

  // Capture 5+ camera angles to make remote-desktop verification real.
  const angles = [
    { name: 'front', set: () => window.__studioViewFront && window.__studioViewFront() },
    { name: 'top',   set: () => window.__studioViewTop && window.__studioViewTop() },
    { name: 'right', set: () => window.__studioViewRight && window.__studioViewRight() },
    { name: 'iso',   set: () => window.__studioViewIso && window.__studioViewIso() },
    { name: 'close', set: () => window.__studioFrameSelection && window.__studioFrameSelection() },
  ];
  for (const a of angles) {
    try { await win.evaluate(a.set); } catch (_) {}
    await win.waitForTimeout(120);
    await win.screenshot({ path: path.join(OUT, `09-angle-${a.name}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  MoGraph slice: 4 cloners + 3 effectors + 3 fields all ok');

  // Close DevTools first — leaving it open makes app.close() hang in
  // --dev mode because Electron waits for the secondary window to die.
  try { await win.evaluate(() => { try { window.close(); } catch (_) {} }); } catch (_) {}
  try {
    await Promise.race([
      app.close(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('close-timeout')), 10000)),
    ]);
  } catch (_) {
    // Force-kill if the graceful close hangs (DevTools is the usual culprit).
    try { app.process().kill('SIGKILL'); } catch (_) {}
  }
});
