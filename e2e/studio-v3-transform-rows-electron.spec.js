import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-transform-rows');

test('Studio V3 — inspector Transform editor commits XYZ values (slice 459)', async () => {
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
  await win.waitForTimeout(400);

  // Spawn + select cube.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(600);

  const tx = win.locator('[data-studio-v3-transform="position-x"]');
  await expect(tx).toBeVisible();

  // Type a new position-x and press Enter.
  await tx.fill('0.12');
  await tx.press('Enter');
  await win.waitForTimeout(200);
  const px = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m.position.x;
  });
  expect(px).toBeCloseTo(0.12, 4);

  // Set rotation Y = 90 (degrees → π/2 rad).
  const ry = win.locator('[data-studio-v3-transform="rotation-y"]');
  await ry.fill('90');
  await ry.press('Enter');
  await win.waitForTimeout(200);
  const rotY = await win.evaluate(() => window.__studioSelectedMesh().rotation.y);
  expect(rotY).toBeCloseTo(Math.PI / 2, 3);

  // Scale X = 2.
  const sx = win.locator('[data-studio-v3-transform="scale-x"]');
  await sx.fill('2');
  await sx.press('Enter');
  await win.waitForTimeout(200);
  const scaleX = await win.evaluate(() => window.__studioSelectedMesh().scale.x);
  expect(scaleX).toBeCloseTo(2, 4);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 459: Transform editor commits px=0.12, ry=90°, sx=2');

  await app.close();
});
