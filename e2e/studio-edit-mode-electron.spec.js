import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-edit-mode');

test('Studio — edit-mode state accessor (slice 376)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => typeof window.__studioSetEditMode === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // Default: object.
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('object');

  // Set each valid mode in turn.
  for (const m of ['vertex', 'edge', 'face', 'sculpt', 'object']) {
    const r = await win.evaluate((mode) => window.__studioSetEditMode(mode), m);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe(m);
    expect(await win.evaluate(() => window.__studioGetEditMode())).toBe(m);
  }

  // Invalid mode is rejected.
  const bad = await win.evaluate(() => window.__studioSetEditMode('paint'));
  expect(bad.ok).toBe(false);
  expect(bad.valid).toContain('vertex');

  // Listener fires on mode change.
  const heard = await win.evaluate(async () => {
    return new Promise((resolve) => {
      const handler = (ev) => { window.removeEventListener('studio-edit-mode-changed', handler); resolve(ev.detail); };
      window.addEventListener('studio-edit-mode-changed', handler);
      window.__studioSetEditMode('vertex');
    });
  });
  expect(heard.mode).toBe('vertex');
  expect(heard.prev).toBe('object');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 376: edit-mode flips through all 5 modes + event fires');

  await app.close();
});
