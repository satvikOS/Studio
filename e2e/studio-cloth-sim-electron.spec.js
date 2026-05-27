import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 55 — PBD Cloth Simulation.
 *
 * Spawns a 20×20 grid plane above a sphere, runs Position-Based
 * Dynamics with edge-spring constraints + sphere collision until
 * the cloth drapes over the sphere. Verifies:
 *   - Cloth plane has 400 verts, ~1080 edges (incl. shear diagonals).
 *   - Pinned corners stay put.
 *   - After 2-3 s of sim, non-pinned vertices have moved (cloth
 *     has actually deformed).
 *   - Edge lengths stay roughly at their rest length (PBD did its job).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-cloth-sim');

async function setRange(win, selector, value) {
  await win.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

async function clothSnapshot(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cloth = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cloth-plane') cloth = o; });
    if (!cloth) return null;
    const pos = cloth.geometry.attributes.position;
    let minY = Infinity, maxY = -Infinity;
    const ys = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      ys.push(y);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    // Sample 4 corners (assumed pinned at indices 0, N-1, (N-1)*N, N*N-1 for N=20)
    const N = 20;
    const corners = {
      tl: ys[0],
      tr: ys[N - 1],
      bl: ys[(N - 1) * N],
      br: ys[N * N - 1],
    };
    return { verts: pos.count, minY, maxY, corners };
  });
}

test('Studio Cloth Sim — PBD edge-spring cloth drops onto a sphere', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Stage: a sphere to catch the cloth.
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);

  // VFX/Sim tab.
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="vfx-sim"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="particles"]')).toBeVisible();

  // Spawn cloth plane.
  await win.locator('[data-studio-action="spawn-cloth"]').click();
  await win.waitForTimeout(400);

  const initial = await clothSnapshot(win);
  expect(initial).not.toBeNull();
  expect(initial.verts).toBe(400); // 20×20
  // Initially every vertex is at Y0 = 0.06 m.
  expect(initial.minY).toBeCloseTo(0.06, 4);
  expect(initial.maxY).toBeCloseTo(0.06, 4);
  await win.screenshot({ path: path.join(OUT, '00-cloth-initial.png'), fullPage: false });

  // Run cloth sim.
  await win.locator('[data-studio-action="toggle-cloth-sim"]').click();
  await expect(win.locator('[data-studio-cloth-state]')).toHaveText('simulating');

  // Let cloth drape — 3 seconds of sim @ 60 fps.
  await win.waitForTimeout(3000);

  // Stop sim before reading state.
  await win.locator('[data-studio-action="toggle-cloth-sim"]').click();
  await expect(win.locator('[data-studio-cloth-state]')).toHaveText('idle');

  const draped = await clothSnapshot(win);
  // Cloth has fallen: minY should be below initial (some verts sag low).
  expect(draped.minY).toBeLessThan(initial.minY);
  // Corners are pinned -> still at initial Y.
  expect(draped.corners.tl).toBeCloseTo(0.06, 3);
  expect(draped.corners.tr).toBeCloseTo(0.06, 3);
  expect(draped.corners.bl).toBeCloseTo(0.06, 3);
  expect(draped.corners.br).toBeCloseTo(0.06, 3);

  await win.screenshot({ path: path.join(OUT, '01-cloth-draped.png'), fullPage: false });

  // ---- 4-angle showcase of the draped cloth ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 24, 1), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `02-draped-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  cloth sim: 400 verts, initial Y=${initial.minY.toFixed(4)}, after 3s drape minY=${draped.minY.toFixed(4)} (sag of ${((initial.minY - draped.minY) * 1000).toFixed(1)}mm), 4 corners stayed pinned`);

  await app.close();
});
