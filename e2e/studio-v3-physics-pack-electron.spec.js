import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-physics-pack');

test('Studio V3 — physics: init/add/step/gravity/toggle/reset (slice 633)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
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
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  // lift the sphere up
  await win.evaluate(() => { window.__studioSelectedMesh().position.set(0, 4, 0); });

  // 1: init
  const init = await win.evaluate(() => window.__studioPhysicsInit());
  expect(init.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-init.png') });

  // 2: add body
  const add = await win.evaluate(() => window.__studioPhysicsAddBody(window.__studioSelectedMesh().uuid, 1, 0.5));
  expect(add.ok).toBe(true);
  expect(add.bodyCount).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-add.png') });

  // 3: gravity
  const grav = await win.evaluate(() => window.__studioPhysicsSetGravity(-15));
  expect(grav.ok).toBe(true);
  expect(grav.gravity).toBe(-15);
  await win.screenshot({ path: path.join(OUT, '03-gravity.png') });

  // 4: step makes it fall
  const beforeY = await win.evaluate(() => window.__studioSelectedMesh().position.y);
  for (let i = 0; i < 5; i++) {
    await win.evaluate(() => window.__studioPhysicsStep(0.05));
  }
  const afterY = await win.evaluate(() => window.__studioSelectedMesh().position.y);
  expect(afterY).toBeLessThan(beforeY);
  await win.screenshot({ path: path.join(OUT, '04-step.png') });

  // 5: reset
  const reset = await win.evaluate(() => window.__studioPhysicsReset());
  expect(reset.ok).toBe(true);
  const restored = await win.evaluate(() => window.__studioSelectedMesh().position.y);
  expect(restored).toBeCloseTo(4, 2);
  await win.screenshot({ path: path.join(OUT, '05-reset.png') });

  // 6: toggle play (don't assert position progression, just state)
  const on = await win.evaluate(() => window.__studioPhysicsTogglePlay());
  expect(on.playing).toBe(true);
  await win.waitForTimeout(200);
  const off = await win.evaluate(() => window.__studioPhysicsTogglePlay());
  expect(off.playing).toBe(false);
  await win.screenshot({ path: path.join(OUT, '06-toggle.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 633: 6 features — physics rigid body fall', beforeY.toFixed(2), '→', afterY.toFixed(2));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
