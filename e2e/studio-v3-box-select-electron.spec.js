import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-box-select');

test('Studio V3 — __studioBoxSelect picks primitives inside pixel rect (slice 501)', async () => {
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
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Spawn 2.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(120);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);

  // Op surface present.
  expect(await win.evaluate(() => typeof window.__studioBoxSelect === 'function')).toBe(true);

  // Whole-canvas rect should match both primitives.
  const r1 = await win.evaluate(() => {
    const dom = window.__archdiscViewport.renderer.domElement;
    return window.__studioBoxSelect(0, 0, dom.clientWidth, dom.clientHeight);
  });
  expect(r1.ok).toBe(true);
  expect(r1.count).toBeGreaterThanOrEqual(2);

  // 1x1 px rect at (0,0) — outside the cluster — should match nothing.
  const r2 = await win.evaluate(() => window.__studioBoxSelect(0, 0, 1, 1));
  expect(r2.count).toBe(0);

  // Center 200x200 rect — should hit the cluster.
  const r3 = await win.evaluate(() => {
    const dom = window.__archdiscViewport.renderer.domElement;
    const cx = dom.clientWidth / 2, cy = dom.clientHeight / 2;
    return window.__studioBoxSelect(cx - 100, cy - 100, cx + 100, cy + 100);
  });
  expect(r3.count).toBeGreaterThanOrEqual(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 501: box select whole', r1.count, '· center', r3.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
