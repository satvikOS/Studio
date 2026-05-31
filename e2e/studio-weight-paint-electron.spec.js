import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-weight-paint');

test('Studio — Blender weight-paint per-vertex skinning (slice 303)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioWeightPaintAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'weight paint demo',
      scene: { discipline: 'rigging' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#cba' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);

  // Paint bone 0 around the world origin with radius 1.0 strength 0.7.
  const paint = await win.evaluate(() => window.__studioWeightPaintAt([0, 0, 0], 0, 1.0, 0.7));
  expect(paint).toBeTruthy();
  expect(paint.painted).toBeGreaterThan(0);

  // Find the cube vert closest to origin (highest weight on bone 0) and read it.
  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const pos = m.geometry.attributes.position;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (d < bestD) { bestD = d; best = i; }
    }
    return { best, w0: window.__studioReadWeight(best, 0) };
  });
  // Closest vert at scale=4 still some distance from origin; weight > 0.
  expect(probe.w0).toBeGreaterThan(0);

  // Far vert outside radius -> weight 0.
  const farW = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const pos = m.geometry.attributes.position;
    let far = 0, farD = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (d > farD) { farD = d; far = i; }
    }
    return window.__studioReadWeight(far, 0);
  });
  // Outside radius=1 (cube extent ~2 at scale 4) → 0.
  expect(farW).toBe(0);

  // Add bone 1 weight on the same closest vert; both should coexist.
  await win.evaluate(({ v }) => window.__studioWeightPaintAt([0, 0, 0], 1, 1.0, 0.3), { v: probe.best });
  const both = await win.evaluate(({ v }) => ({
    b0: window.__studioReadWeight(v, 0),
    b1: window.__studioReadWeight(v, 1),
  }), { v: probe.best });
  // Bone 0 weight unchanged (existing-slot-update path doesn't reset).
  expect(both.b0).toBeGreaterThan(0);
  expect(both.b1).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 303: weight-paint painted', paint.painted, 'verts; closest w0=', probe.w0.toFixed(3));

  await app.close();
});
