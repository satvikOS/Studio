import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-curve-editor');

test('Studio V3 — Cmd+Shift+C curve editor plots keyframes (slice 572)', async () => {
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
  await win.waitForTimeout(200);

  // Seed 3 keyframes at frames 0, 15, 30 with distinct positions.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0);    window.__studioInsertKeyframeAt(0);
    m.position.set(0.1, 0, 0);  window.__studioInsertKeyframeAt(15);
    m.position.set(-0.1, 0, 0); window.__studioInsertKeyframeAt(30);
  });
  await win.waitForTimeout(150);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await win.keyboard.press('Meta+Shift+c');
  await win.waitForTimeout(500);

  await expect(win.locator('[data-studio-v3-curve-editor]')).toBeVisible();
  const keys = win.locator('[data-studio-v3-curve-key]');
  await expect(keys).toHaveCount(3);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // Click empty SVG region to insert a 4th key.
  await win.evaluate(() => {
    const svg = document.querySelector('[data-studio-v3-curve-svg]');
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.left + rect.width * 0.75,
      clientY: rect.top + rect.height * 0.4,
    }));
  });
  await win.waitForTimeout(500);

  await expect(keys).toHaveCount(4);

  // eslint-disable-next-line no-console
  console.log('  slice 572: curve editor 3 → 4 keys');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
