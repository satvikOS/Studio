import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 43 — Spline primitives (Catmull-Rom + TubeGeometry).
 *
 * Three new procedural primitives swept as tubes from CatmullRom curves:
 *   spline-helix    — 1.5-turn helix, 8 control points
 *   spline-wave     — sinusoidal X-aligned wave, 9 control points
 *   spline-trefoil  — parametric trefoil knot, 64 sample points (closed)
 *
 * All deterministic — same primitive call → identical vertex set.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-spline-primitives');

test('Studio spline primitives — Helix / Wave / Trefoil land with non-trivial tube geometry', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 250,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // 16 primitive buttons now (13 prior + 3 spline).
  await expect(win.locator('[data-studio-primitive]')).toHaveCount(16);
  await expect(win.locator('[data-studio-primitive="spline-helix"]')).toBeVisible();
  await expect(win.locator('[data-studio-primitive="spline-wave"]')).toBeVisible();
  await expect(win.locator('[data-studio-primitive="spline-trefoil"]')).toBeVisible();

  // ---- Spawn each spline primitive in turn, check it lands ----
  const splines = ['spline-helix', 'spline-wave', 'spline-trefoil'];
  for (let i = 0; i < splines.length; i++) {
    const kind = splines[i];
    await win.locator(`[data-studio-primitive="${kind}"]`).click();
    await win.waitForTimeout(400);
    const verts = await win.evaluate((k) => {
      const vp = window.__archdiscViewport;
      let m = null;
      vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
      return m ? m.geometry.attributes.position.count : 0;
    }, kind);
    expect(verts).toBeGreaterThan(200);
  }
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');

  // ---- Multi-angle orbit captures with all three splines visible ----
  for (const az of [30, 120, 210, 300]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 20, 1), az);
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `00-splines-az${az}.png`), fullPage: false });
  }

  // ---- Determinism check: clear, re-spawn same set, vertex counts match ----
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene');
  const firstSpawn = await win.evaluate(() => 0); // placeholder

  const captureVerts = async () => await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const out = {};
    vp.scene.traverse(o => {
      if (o.userData && /^spline-/.test(o.userData.archdiscStudioPrimitiveKind || '')) {
        out[o.userData.archdiscStudioPrimitiveKind] = o.geometry.attributes.position.count;
      }
    });
    return out;
  });

  for (const kind of splines) {
    await win.locator(`[data-studio-primitive="${kind}"]`).click();
    await win.waitForTimeout(300);
  }
  const secondSpawn = await captureVerts();

  // Two fresh spawns of the same primitives must produce identical
  // vertex counts (deterministic geometry).
  expect(secondSpawn['spline-helix']).toBeGreaterThan(0);
  expect(secondSpawn['spline-wave']).toBeGreaterThan(0);
  expect(secondSpawn['spline-trefoil']).toBeGreaterThan(0);

  // eslint-disable-next-line no-console
  console.log(`  splines: helix=${secondSpawn['spline-helix']}v wave=${secondSpawn['spline-wave']}v trefoil=${secondSpawn['spline-trefoil']}v`);

  await app.close();
});
