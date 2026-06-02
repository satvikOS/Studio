import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-history');

test('Studio V3 — N-panel history shows labelled undo entries (slice 518)', async () => {
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

  // Fire 3 labeled pushUndo calls directly.
  await win.evaluate(() => {
    window.__studioPushUndo('add-cube');
    window.__studioPushUndo('add-sphere');
    window.__studioPushUndo('group-2');
  });
  await win.waitForTimeout(800);

  const list = await win.evaluate(() => window.__studioListUndoHistory());
  expect(list.length).toBeGreaterThanOrEqual(3);
  expect(list.map((e) => e.label)).toEqual(expect.arrayContaining(['add-cube', 'add-sphere', 'group-2']));

  await expect(win.locator('[data-studio-v3-history-section]')).toBeVisible();
  const entries = win.locator('[data-studio-v3-history-entry]');
  const count = await entries.count();
  expect(count).toBeGreaterThanOrEqual(3);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 518: history entries', count, '· labels', list.map((e) => e.label).join(','));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
