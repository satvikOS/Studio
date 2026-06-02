import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-lock');

test('Studio V3 — Cmd+L locks transform on selection (slice 529)', async () => {
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

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  // Set initial position then lock.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(1, 1, 1); m.updateMatrixWorld(true);
  });

  await win.keyboard.press('Meta+l');
  await win.waitForTimeout(250);

  const lockedFlag = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return !!(m && m.userData && m.userData.archdiscStudioLocked);
  });
  expect(lockedFlag).toBe(true);

  // Try to move it programmatically. The per-frame guard should snap back.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(5, 5, 5);
  });
  await win.waitForTimeout(120); // a couple rAF ticks

  const settled = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.position.x, m.position.y, m.position.z];
  });
  // Should have snapped back to (1, 1, 1).
  expect(settled[0]).toBeCloseTo(1);
  expect(settled[1]).toBeCloseTo(1);
  expect(settled[2]).toBeCloseTo(1);

  // Unlock + verify move sticks.
  await win.keyboard.press('Meta+l');
  await win.waitForTimeout(150);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(3, 3, 3);
  });
  await win.waitForTimeout(120);
  const free = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.position.x, m.position.y, m.position.z];
  });
  expect(free[0]).toBeCloseTo(3);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 529: lock holds (1,1,1) · unlock allows (3,3,3)');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
