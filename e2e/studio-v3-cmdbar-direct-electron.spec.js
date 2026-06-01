import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cmdbar-direct');

test('Studio V3 — cmdbar drives V2 APIs by name (slice 398)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 400,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Bootstrap V3.
  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });

  // Wait for V2 headless API surface to populate.
  await win.waitForFunction(() => typeof window.__studioListSceneStats === 'function', null, { timeout: 15000 });

  const cmdInput = win.locator('[data-studio-v3-cmdbar-input]');
  await cmdInput.focus();

  // Type a direct API call that's safe to invoke on an empty scene.
  await cmdInput.fill('studioListSceneStats');
  await cmdInput.press('Enter');

  // Dock opens; a tool message renders with the API call + result.
  await expect(win.locator('[data-studio-v3-archie-thread]')).toBeVisible({ timeout: 5000 });
  const lastMsg = win.locator('.studio-archie-msg[data-role="tool"]').last();
  await expect(lastMsg).toContainText('__studioListSceneStats');
  await expect(lastMsg).toContainText('count');

  // Try another with no-arg op — selectAll (will fail with no mesh but
  // dock should still record the attempted call + error message).
  await cmdInput.fill('studioGetEditMode');
  await cmdInput.press('Enter');
  await expect(win.locator('.studio-archie-msg[data-role="tool"]').last()).toContainText('__studioGetEditMode');

  // Now try a non-API NL string — falls through to the (placeholder)
  // Archie route.
  await cmdInput.fill('extrude this face 5mm');
  await cmdInput.press('Enter');
  await expect(win.locator('.studio-archie-msg[data-role="archie"]').last())
    .toContainText('heard: "extrude this face 5mm"');

  await win.screenshot({ path: path.join(OUT, '00-direct-call.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 398: cmdbar drives V2 APIs (studioListSceneStats / studioGetEditMode) + NL fallback');

  await app.close();
});
