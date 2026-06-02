import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-snap-toggle');

test('Studio V3 — Shift+; toggles transform snap (slice 491)', async () => {
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
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Op surface present.
  expect(await win.evaluate(() => typeof window.__studioToggleSnap === 'function')).toBe(true);

  // Status badge mounted; starts off.
  const badge = win.locator('[data-studio-v3-status="snap"]');
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveAttribute('data-studio-v3-snap-on', 'false');

  // Spawn a cube so transformControls has something to attach (snap setters
  // require an actual TransformControls instance).
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);

  // Shift+; turns snap on.
  await win.keyboard.press('Shift+;');
  await win.waitForTimeout(200);
  await expect(badge).toHaveAttribute('data-studio-v3-snap-on', 'true');

  const snap = await win.evaluate(() => window.__studioGetSnap());
  expect(snap.on).toBe(true);
  expect(snap.t).toBeCloseTo(0.01);
  expect(snap.s).toBeCloseTo(0.1);

  // Again turns it off.
  await win.keyboard.press('Shift+;');
  await win.waitForTimeout(200);
  await expect(badge).toHaveAttribute('data-studio-v3-snap-on', 'false');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 491: snap toggled off → on → off');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
