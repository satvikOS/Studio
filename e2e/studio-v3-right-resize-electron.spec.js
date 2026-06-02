import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-right-resize');

test('Studio V3 — right-panel resize splitter drag persists (slice 493)', async () => {
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
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    window.localStorage.removeItem('studio.v3.rightWidth');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  const right = win.locator('[data-studio-v3-right]');
  const w0 = await right.evaluate((el) => el.getBoundingClientRect().width);
  expect(w0).toBeGreaterThan(220);

  // Programmatically drive the resize handle: mousedown + several mousemove
  // events towards the viewport (LEFT decreases X, panel widens).
  const handle = win.locator('[data-studio-v3-right-resize]');
  const box = await handle.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await win.mouse.move(startX, startY);
  await win.mouse.down();
  await win.mouse.move(startX - 80, startY, { steps: 5 });
  await win.mouse.up();
  await win.waitForTimeout(200);

  const w1 = await right.evaluate((el) => el.getBoundingClientRect().width);
  // Expect at least ~60 px wider (under 80 px drag with min/max guards).
  expect(w1).toBeGreaterThan(w0 + 50);

  const storedW = Number(await win.evaluate(() => window.localStorage.getItem('studio.v3.rightWidth')));
  // eslint-disable-next-line no-console
  console.log('  diag: stored width', storedW, 'measured w1', w1);
  expect(storedW).toBeGreaterThan(w0 + 50);

  // Persists across reload.
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(300);
  const w2 = await win.locator('[data-studio-v3-right]').evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(w2 - w1)).toBeLessThan(8);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 493: width', w0, '→', w1, '(reload:', w2, ')');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
