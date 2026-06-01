import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-duplicate');

test('Studio V3 — Shift+D duplicate selected (slice 434)', async () => {
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

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn + select cube.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  // Before: 1 primitive in scene.
  let n = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n).toBe(1);

  // Press Shift+D — duplicate.
  await win.keyboard.press('Shift+d');
  await win.waitForTimeout(150);

  n = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n).toBe(2);

  // Active selection is the new clone (name ends with -copy).
  const selName = await win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    return m && m.name;
  });
  expect(selName).toMatch(/-copy$/);

  // Shift+D again → 3.
  await win.keyboard.press('Shift+d');
  await win.waitForTimeout(150);
  n = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n).toBe(3);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 434: Shift+D duplicates selected — 1 → 2 → 3 primitives');

  await app.close();
});
