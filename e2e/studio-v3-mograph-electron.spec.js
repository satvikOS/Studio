import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-mograph');

test('Studio V3 — mograph / IK family (slice 415)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSolveIK2 === 'function', null, { timeout: 15000 });

  // ─── IK2 — reachable target. ────────────────────────────────────────
  let r = await win.evaluate(() => window.__studioSolveIK2({
    rootPos: [0, 0, 0], midPos: [0, 1, 0], endPos: [0, 2, 0],
    targetPos: [1.0, 1.2, 0.0], poleHint: [0, 0, 1],
  }));
  expect(r.ok).toBe(true);
  expect(r.clamped).toBe(false);
  // Numerical bend angle should be sane (> 0, < π).
  expect(r.bendAngle).toBeGreaterThan(0);
  expect(r.bendAngle).toBeLessThan(Math.PI);
  // L1, L2 reported back correctly.
  expect(r.L1).toBeCloseTo(1, 5);
  expect(r.L2).toBeCloseTo(1, 5);

  // ─── MoSpline helix. ─────────────────────────────────────────────────
  r = await win.evaluate(() => window.__studioMoSpline({ type: 'helix', segments: 32, radius: 0.1, height: 0.1, turns: 2 }));
  expect(r.ok).toBe(true);
  expect(r.points.length).toBe(32);

  r = await win.evaluate(() => window.__studioMoSpline({ type: 'mystery' }));
  expect(r.ok).toBe(false);

  // ─── MoText (font may load over network — accept either path). ────────
  r = await win.evaluate(() => window.__studioMoText({ text: 'HI', size: 0.04 }));
  expect(r.ok).toBe(true);
  expect(r.uuid).toBeTruthy();

  // ─── MashDistribute — clone a cube into a grid. ──────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const cubeUuid = await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    return m && m.uuid;
  });
  r = await win.evaluate((u) => window.__studioMashDistribute({ sourceUuid: u, count: 4, mode: 'grid' }), cubeUuid);
  expect(r.ok).toBe(true);
  expect(r.count).toBe(16);

  // ─── ParticleEmitter — spawns + animates a Points instance. ─────────
  const p = await win.evaluate(() => {
    const e = window.__studioParticleEmitter({ position: [0, 0, 0], rate: 100, lifetime: 0.5 });
    window.__lastEmitter = e;
    return { ok: e.ok, uuid: e.uuid };
  });
  expect(p.ok).toBe(true);
  // Tick a few frames then check state.
  await win.waitForTimeout(150);
  const st = await win.evaluate(() => window.__lastEmitter.state());
  expect(st.stopped).toBe(false);
  await win.evaluate(() => window.__lastEmitter.stop());

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 415: IK2 + MoSpline + MoText + Mash + Particle all ok');

  await app.close();
});
