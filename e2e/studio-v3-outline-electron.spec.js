import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-outline');

test('Studio V3 — selected mesh gets an outline child (slice 541)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
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

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);

  const hasOutline = await win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!m || !m.children) return false;
    return m.children.some((c) => c.userData && c.userData.__studioOutline);
  });
  expect(hasOutline).toBe(true);

  // Spawn a sphere — selection moves; cube should lose outline, sphere gains it.
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);

  const swap = await win.evaluate(() => {
    const s = window.__archdiscScene;
    let cube = null, sphere = null;
    s.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o;
      else if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') sphere = o;
    });
    return {
      cubeHas: cube && cube.children.some((c) => c.userData && c.userData.__studioOutline),
      sphereHas: sphere && sphere.children.some((c) => c.userData && c.userData.__studioOutline),
    };
  });
  expect(swap.cubeHas).toBe(false);
  expect(swap.sphereHas).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 541: outline followed selection cube → sphere');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
