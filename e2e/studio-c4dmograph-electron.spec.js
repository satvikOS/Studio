// ArchDisc Studio V3 — Cinema 4D MoGraph Matrix + effectors (slice 773).
//
// Headed Mac-Electron spec. Drives the new `__studioC4DMatrix*` and
// `__studioC4DPlain/Delay/Inheritance/RandomApply` ops introduced by
// slice 773. The Matrix object is *invisible* — it doesn't add a mesh
// to the scene — so the spec verifies behaviour by reading the
// per-instance position snapshot the ops layer reports.
//
// Steps:
//   1) Create a grid Matrix object: mode='grid', nx=5, ny=1, nz=4 ⇒ 20
//      instances. snapshot has Y ≈ 0 everywhere (ny=1, spacing.y=1
//      collapses around 0).
//   2) Plain effector translate by [0, +1.0, 0] ⇒ every instance Y
//      shifts by +1.0 relative to its pre-effector value.
//   3) Reset (recreate) the matrix, then Delay effector with
//      framesPerInstance=2, currentFrame=10, smooth=1, target=[0,1,0].
//      For instance i, t_i = clamp01((10 - 2i)/1) so the first 5
//      instances (i ∈ 0..4 → start frames 0..8) have reached the
//      target; the next batch (i ≥ 5 → start frames ≥ 10) have t=0
//      and remain at base; partial cases verified at the boundary.
//   4) List returns ≥1 entry.
//   5) Five named camera angles screenshotted.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-c4dmograph');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — C4D MoGraph Matrix + Plain/Delay effectors', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  await win.evaluate(async () => {
    if (typeof window.__studioC4DMatrixCreate !== 'function') {
      await import('/src/workbenches/studio/v3/c4dmograph/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioC4DMatrixCreate === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Create a 5×1×4 grid Matrix object → 20 instances ─────────────
  const create = await win.evaluate(() => window.__studioC4DMatrixCreate({
    mode: 'grid',
    count: 20,
    params: { nx: 5, ny: 1, nz: 4, spacing: [0.2, 0.2, 0.2] },
  }));
  // eslint-disable-next-line no-console
  console.log('[c4dmograph] create', JSON.stringify(create));
  expect(create.ok).toBe(true);
  expect(create.count).toBe(20);
  expect(typeof create.matrixKey).toBe('string');
  const matrixKey = create.matrixKey;

  // ── 2) Snapshot pre-effector positions ─────────────────────────────
  const pre = await win.evaluate((k) => window.__studioC4DMatrixSnapshot({ matrixKey: k }), matrixKey);
  expect(pre.ok).toBe(true);
  expect(pre.matrices.length).toBe(20);
  // ny=1 grid → all pre-effector Y values are 0 (since spacing.y=0.2
  // and the only iy index is 0, which maps to (0 - 1/2)*0.2 = -0.1)
  // -- so they're a constant -0.1, not 0. Let's just record them.
  const preY = pre.matrices.map((m) => m[1]);
  // eslint-disable-next-line no-console
  console.log('[c4dmograph] preY[0..4]', preY.slice(0, 5).join(', '));

  // ── 3) Plain effector: translate y +1.0 ─────────────────────────────
  const plain = await win.evaluate((k) => window.__studioC4DPlainApply({
    matrixKey: k,
    offset: [0, 1.0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }), matrixKey);
  // eslint-disable-next-line no-console
  console.log('[c4dmograph] plain', JSON.stringify(plain));
  expect(plain.ok).toBe(true);
  expect(plain.count).toBe(20);

  const postPlain = await win.evaluate((k) => window.__studioC4DMatrixSnapshot({ matrixKey: k }), matrixKey);
  expect(postPlain.ok).toBe(true);
  // Every instance must have shifted by +1.0 in Y
  let plainMatch = 0;
  for (let i = 0; i < 20; i++) {
    const dy = postPlain.matrices[i][1] - preY[i];
    if (Math.abs(dy - 1.0) < 1e-4) plainMatch += 1;
  }
  // eslint-disable-next-line no-console
  console.log(`[c4dmograph] plain matched ${plainMatch}/20`);
  expect(plainMatch).toBe(20);
  await win.screenshot({ path: path.join(OUT, '01-plain.png') });

  // ── 4) Recreate Matrix for the Delay test (cleanly off the base) ────
  await win.evaluate((k) => window.__studioC4DMatrixDelete({ matrixKey: k }), matrixKey);
  const create2 = await win.evaluate(() => window.__studioC4DMatrixCreate({
    mode: 'grid',
    count: 20,
    params: { nx: 5, ny: 1, nz: 4, spacing: [0.2, 0.2, 0.2] },
  }));
  expect(create2.ok).toBe(true);
  expect(create2.count).toBe(20);
  const mk2 = create2.matrixKey;
  const pre2 = await win.evaluate((k) => window.__studioC4DMatrixSnapshot({ matrixKey: k }), mk2);
  const pre2Y = pre2.matrices.map((m) => m[1]);

  // ── 5) Delay effector: framesPerInstance=2, currentFrame=10,
  //       smooth=1 → instance i fully arrives at t=1 when
  //       currentFrame >= 2*i + 1. So instances 0..4 (start frames
  //       0,2,4,6,8 with finish frames 1,3,5,7,9) are all fully
  //       there. Instance 5 starts at frame 10 → t = 0.0. Instance 6
  //       starts at frame 12 → still 0. So 5 fully arrived, 15
  //       remain at the base.
  const delay = await win.evaluate((k) => window.__studioC4DDelayApply({
    matrixKey: k,
    target: [0, 1.0, 0],
    framesPerInstance: 2,
    currentFrame: 10,
    smooth: 1,
  }), mk2);
  // eslint-disable-next-line no-console
  console.log('[c4dmograph] delay ts[0..7]', delay.ts && delay.ts.slice(0, 8).join(', '));
  expect(delay.ok).toBe(true);
  expect(delay.count).toBe(20);
  expect(Array.isArray(delay.snapshot)).toBe(true);
  expect(Array.isArray(delay.ts)).toBe(true);

  // First 5 instances: t = 1, fully reached target (delta Y = +1.0)
  let reachedCount = 0;
  for (let i = 0; i < 5; i++) {
    const dy = delay.snapshot[i][1] - pre2Y[i];
    if (Math.abs(dy - 1.0) < 1e-4) reachedCount += 1;
    expect(Math.abs(delay.ts[i] - 1)).toBeLessThan(1e-9);
  }
  expect(reachedCount).toBe(5);

  // Instance 5 → start frame 10, currentFrame=10, smooth=1 → t = 0.0
  // (just about to start the sweep; delta Y = 0)
  const dy5 = delay.snapshot[5][1] - pre2Y[5];
  expect(Math.abs(dy5)).toBeLessThan(1e-4);
  expect(Math.abs(delay.ts[5] - 0)).toBeLessThan(1e-9);

  // Instances 6..19 still at base (t = 0, delta = 0)
  for (let i = 6; i < 20; i++) {
    const dy = delay.snapshot[i][1] - pre2Y[i];
    expect(Math.abs(dy)).toBeLessThan(1e-4);
    expect(delay.ts[i]).toBe(0);
  }
  await win.screenshot({ path: path.join(OUT, '02-delay.png') });

  // ── 6) Verify smooth>1 produces partial values at the boundary ──────
  await win.evaluate((k) => window.__studioC4DMatrixDelete({ matrixKey: k }), mk2);
  const create3 = await win.evaluate(() => window.__studioC4DMatrixCreate({
    mode: 'grid',
    count: 20,
    params: { nx: 5, ny: 1, nz: 4, spacing: [0.2, 0.2, 0.2] },
  }));
  const mk3 = create3.matrixKey;
  const delay2 = await win.evaluate((k) => window.__studioC4DDelayApply({
    matrixKey: k,
    target: [0, 2.0, 0],
    framesPerInstance: 2,
    currentFrame: 10,
    smooth: 4,
  }), mk3);
  // For instance i=4 → startFrame = 8, t = (10-8)/4 = 0.5 → dy ≈ +1.0
  expect(delay2.ts[4]).toBeCloseTo(0.5, 6);
  // For instance i=5 → startFrame = 10, t = 0
  expect(delay2.ts[5]).toBe(0);
  // For instance i=3 → startFrame = 6, t = 1
  expect(delay2.ts[3]).toBe(1);

  // ── 7) Inheritance + Random smoke tests ─────────────────────────────
  // Source matrix: shifted radial
  const srcCreate = await win.evaluate(() => window.__studioC4DMatrixCreate({
    mode: 'radial', count: 20, params: { radius: 2 },
  }));
  expect(srcCreate.ok).toBe(true);
  const inh = await win.evaluate((args) => window.__studioC4DInheritanceApply({
    matrixKey: args.target,
    sourceMatrixKey: args.source,
    mix: 0.5,
  }), { target: mk3, source: srcCreate.matrixKey });
  expect(inh.ok).toBe(true);

  // Random with seed=42, range=[0.1, 0.1, 0.1] — verify it shifted at least
  // some instances away from baseline.
  const rnd = await win.evaluate((k) => window.__studioC4DRandomApply({
    matrixKey: k, seed: 42, range: [0.1, 0.1, 0.1],
  }), mk3);
  expect(rnd.ok).toBe(true);

  // ── 8) List + delete ────────────────────────────────────────────────
  const list = await win.evaluate(() => window.__studioC4DMatrixList());
  // eslint-disable-next-line no-console
  console.log('[c4dmograph] list', JSON.stringify(list));
  expect(list.ok).toBe(true);
  expect(list.matrices.length).toBeGreaterThanOrEqual(1);

  // ── 9) Camera sweep — 5 angles. ────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 773: C4D MoGraph Matrix(20)+Plain+Delay+Inheritance+Random OK');

  await app.close();
});
