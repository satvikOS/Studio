import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-shading-mode-chips');

test('Studio — Blender 4-way shading mode chips (slice 321)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetShadingMode === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await expect(win.locator('[data-studio-viewport-shading-chips]')).toBeVisible();
  for (const m of ['wireframe', 'solid', 'material', 'rendered']) {
    await expect(win.locator(`[data-studio-shading-chip="${m}"]`)).toBeVisible();
  }

  // Spawn cube so we have a mesh whose material we can probe.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  // Wireframe.
  await win.locator('[data-studio-shading-chip="wireframe"]').click();
  await win.waitForTimeout(200);
  const wf = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { wireframe: m.material.wireframe, mode: window.__studioShadingMode };
  });
  expect(wf.wireframe).toBe(true);
  expect(wf.mode).toBe('wireframe');

  // Material.
  await win.locator('[data-studio-shading-chip="material"]').click();
  await win.waitForTimeout(200);
  const mt = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { wireframe: m.material.wireframe, flat: m.material.flatShading };
  });
  expect(mt.wireframe).toBe(false);
  expect(mt.flat).toBe(false);

  // Solid (faceted).
  await win.locator('[data-studio-shading-chip="solid"]').click();
  await win.waitForTimeout(200);
  const sd = await win.evaluate(() => window.__studioSelectedMesh().material.flatShading);
  expect(sd).toBe(true);

  // Rendered → renderer.shadowMap.enabled = true.
  await win.locator('[data-studio-shading-chip="rendered"]').click();
  await win.waitForTimeout(200);
  const rd = await win.evaluate(() => window.__archdiscViewport.renderer.shadowMap.enabled);
  expect(rd).toBe(true);

  // Bad mode.
  const bad = await win.evaluate(() => window.__studioSetShadingMode('nope'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 321: shading chips cycled wireframe→material→solid→rendered');

  await app.close();
});
