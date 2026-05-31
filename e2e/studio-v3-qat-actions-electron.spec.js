import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-qat-actions');

test('Studio V3 — QAT undo / redo / save / play call V2 APIs (slice 400)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 400,
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
  await win.waitForFunction(() => typeof window.__studioUndo === 'function', null, { timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSaveScene === 'function', null, { timeout: 15000 });

  // Spawn a cube via the toolbar so undo has something to undo.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);

  // Click QAT Undo — fires __studioUndo, dock opens with tool message.
  await win.locator('[data-studio-v3-qat-btn="undo"]').click();
  await expect(win.locator('[data-studio-v3-archie]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator('.studio-archie-msg[data-role="tool"]').last()).toContainText('__studioUndo');

  // Redo.
  await win.locator('[data-studio-v3-qat-btn="redo"]').click();
  await expect(win.locator('.studio-archie-msg[data-role="tool"]').last()).toContainText('__studioRedo');

  // Save — invokes __studioSaveScene and triggers a download attempt.
  await win.locator('[data-studio-v3-qat-btn="save"]').click();
  await expect(win.locator('.studio-archie-msg[data-role="tool"]').last()).toContainText('__studioSaveScene');

  // Play — toggles __studioToggleAnimating.
  await win.locator('[data-studio-v3-qat-btn="play"]').click();
  await expect(win.locator('.studio-archie-msg[data-role="tool"]').last()).toContainText('__studioToggleAnimating');

  // New — calls __studioRevealAll (clears any local-view hidden state).
  await win.locator('[data-studio-v3-qat-btn="new"]').click();
  await expect(win.locator('.studio-archie-msg[data-role="tool"]').last()).toContainText('__studioRevealAll');

  await win.screenshot({ path: path.join(OUT, '00-qat.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 400: QAT undo/redo/save/play/new all route into V2 APIs + push tool msgs');

  await app.close();
});
