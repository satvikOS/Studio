import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-dirty-dot');

test('Studio V3 — status bar dirty-state dot (slice 470)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
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

  const dot = win.locator('[data-studio-v3-status="dirty"]');
  await expect(dot).toBeVisible();

  // Initially 'saved' (lastSaved = 0, but no primitives so n=0).
  await expect(dot).toHaveAttribute('data-studio-v3-dirty', 'false');

  // Add a primitive, then short-circuit the 30s wait: directly call
  // setDirty via fake event with old timestamp.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // Force the dirty check: spawn cube + simulate the 30s aging.
  // The dirty interval fires every 2s; tweak by overriding internal state.
  // Easiest: just wait 2s and see if it picks up. lastSaved is 0
  // so Date.now() - 0 is > 30000 → dirty=true.
  await win.waitForTimeout(2400);
  await expect(dot).toHaveAttribute('data-studio-v3-dirty', 'true');

  // Dispatch studio-autosaved → flips to saved.
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 100, primitives: 1 } }));
  });
  await win.waitForTimeout(200);
  await expect(dot).toHaveAttribute('data-studio-v3-dirty', 'false');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 470: dirty dot flips false → true → false');

  await app.close();
});
