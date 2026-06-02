import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-minimap-click');

test('Studio V3 — minimap click recenters orbit target (slice 543)', async () => {
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
    window.localStorage.removeItem('studio.v3.display-toggles');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  const targetBefore = await win.evaluate(() => {
    const t = window.__archdiscViewport.orbitControls.target;
    return [t.x, t.y, t.z];
  });

  // Synthesise a React-aware click by dispatching the MouseEvent directly
  // on the canvas — bypasses any other overlays catching mouse events.
  await win.evaluate(() => {
    const canvas = document.querySelector('[data-studio-v3-minimap]');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.left + rect.width / 2 + 30,
      clientY: rect.top + rect.height / 2 + 20,
    }));
  });
  await win.waitForTimeout(200);

  const targetAfter = await win.evaluate(() => {
    const t = window.__archdiscViewport.orbitControls.target;
    return [t.x, t.y, t.z];
  });
  // Δx should be ~ 30/18 ≈ 1.67; Δz should be ~ 20/18 ≈ 1.11.
  expect(targetAfter[0]).toBeCloseTo(targetBefore[0] + 30 / 18, 1);
  expect(targetAfter[2]).toBeCloseTo(targetBefore[2] + 20 / 18, 1);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 543: minimap recenter target', targetBefore, '→', targetAfter);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
