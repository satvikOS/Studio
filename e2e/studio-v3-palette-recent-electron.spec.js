import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-palette-recent');

test('Studio V3 — command palette lists recent files (slice 504)', async () => {
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
    // Seed two recent files directly.
    window.localStorage.setItem('archdisc.studio.recentFiles', JSON.stringify([
      { name: 'memory-alpha.studio.json', ts: 1, json: '{"version":3,"primitives":[]}' },
      { name: 'memory-bravo.studio.json', ts: 0, json: '{"version":3,"primitives":[]}' },
    ]));
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Open palette.
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('studio-command-palette-toggle')));
  await win.waitForTimeout(200);

  // Filter to recent.
  await win.evaluate(() => {
    const input = document.querySelector('[data-studio-v3-command-palette-input]');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'memory-');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(200);

  const rows = win.locator('[data-studio-v3-command-palette-item]');
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(2);

  const labels = await rows.allInnerTexts();
  expect(labels.some((l) => /memory-alpha/.test(l))).toBe(true);
  expect(labels.some((l) => /memory-bravo/.test(l))).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 504: palette recent rows', labels.filter((l) => /memory-/.test(l)).length);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
