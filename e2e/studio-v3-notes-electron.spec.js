import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-notes');

test('Studio V3 — Notes section persists per workbench (slice 516)', async () => {
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
    window.localStorage.removeItem('studio.v3.notes.model');
    window.localStorage.removeItem('studio.v3.notes.general');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await expect(win.locator('[data-studio-v3-notes-section]')).toBeVisible();

  const ta = win.locator('[data-studio-v3-notes-input]');
  await ta.fill('intent: prototype an aerospace bracket');
  await win.waitForTimeout(450); // > 300 ms debounce

  const saved = await win.evaluate(() => {
    return ['model', 'general'].map((wb) => ({
      wb, value: window.localStorage.getItem(`studio.v3.notes.${wb}`),
    })).filter((it) => it.value);
  });
  expect(saved.some((it) => /aerospace bracket/.test(it.value || ''))).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // Reload survives.
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(300);
  const restored = await win.locator('[data-studio-v3-notes-input]').inputValue();
  expect(restored).toMatch(/aerospace bracket/);

  // eslint-disable-next-line no-console
  console.log('  slice 516: notes persisted for', saved.map((it) => it.wb).join(','));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
