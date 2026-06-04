import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-orbit-center');

test('Studio V3 — Cmd+. moves orbit target to selection (slice 614)', async () => {
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
  await win.waitForTimeout(250);

  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0.3, 0.05, -0.2);
    m.updateMatrixWorld(true);
    window.__archdiscViewport.orbitControls.target.set(0, 0, 0);
    window.__archdiscViewport.orbitControls.update();
  });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await win.keyboard.press('Meta+.');
  await win.waitForTimeout(250);

  const t = await win.evaluate(() => {
    const tt = window.__archdiscViewport.orbitControls.target;
    return [tt.x, tt.y, tt.z];
  });
  expect(t[0]).toBeCloseTo(0.3, 2);
  expect(t[1]).toBeCloseTo(0.05, 2);
  expect(t[2]).toBeCloseTo(-0.2, 2);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 614: orbit target', t.map((n) => n.toFixed(3)).join(','));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
