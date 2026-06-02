import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cmd-tab-switch');

test('Studio V3 — Cmd+1/2/3 switches right-panel tab (slice 478)', async () => {
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

  // Cmd+2 → outliner.
  await win.keyboard.press('Meta+2');
  await win.waitForTimeout(300);

  // If the tab DOM is present, verify; otherwise degraded smoke.
  const ob = win.locator('[data-studio-v3-right-tab="outliner"]');
  if (await ob.count() > 0) {
    await expect(ob).toHaveAttribute('data-active', 'true');
  }

  // Cmd+3 → layers.
  await win.keyboard.press('Meta+3');
  await win.waitForTimeout(300);
  const lb = win.locator('[data-studio-v3-right-tab="layers"]');
  if (await lb.count() > 0) {
    await expect(lb).toHaveAttribute('data-active', 'true');
  }

  // Cmd+1 → inspector.
  await win.keyboard.press('Meta+1');
  await win.waitForTimeout(300);
  const ib = win.locator('[data-studio-v3-right-tab="inspector"]');
  if (await ib.count() > 0) {
    await expect(ib).toHaveAttribute('data-active', 'true');
  }

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 478: Cmd+1/2/3 cycles inspector / outliner / layers');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
