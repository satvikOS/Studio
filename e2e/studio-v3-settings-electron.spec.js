import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-settings');

test('Studio V3 — settings: get/set/delete/list/export/import (slice 675)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('studio.v3.settings.')) localStorage.removeItem(k);
    }
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // 1: set
  const s = await win.evaluate(() => window.__studioSettingsSet('cursor.size', 24));
  expect(s.ok).toBe(true);
  expect(s.value).toBe(24);
  await win.screenshot({ path: path.join(OUT, '01-set.png') });

  // 2: get
  const g = await win.evaluate(() => window.__studioSettingsGet('cursor.size'));
  expect(g.ok).toBe(true);
  expect(g.value).toBe(24);
  await win.screenshot({ path: path.join(OUT, '02-get.png') });

  // 3: list
  await win.evaluate(() => window.__studioSettingsSet('view.fov', 50));
  const l = await win.evaluate(() => window.__studioSettingsList());
  expect(l.count).toBe(2);
  expect(l.settings['cursor.size']).toBe(24);
  expect(l.settings['view.fov']).toBe(50);
  await win.screenshot({ path: path.join(OUT, '03-list.png') });

  // 4: export
  const e = await win.evaluate(() => window.__studioSettingsExport());
  expect(e.ok).toBe(true);
  expect(e.count).toBe(2);
  const parsed = JSON.parse(e.json);
  expect(parsed['cursor.size']).toBe(24);
  await win.screenshot({ path: path.join(OUT, '04-export.png') });

  // 5: delete one
  const d = await win.evaluate(() => window.__studioSettingsDelete('cursor.size'));
  expect(d.removed).toBe(true);
  const l2 = await win.evaluate(() => window.__studioSettingsList());
  expect(l2.count).toBe(1);
  await win.screenshot({ path: path.join(OUT, '05-delete.png') });

  // 6: import — round-trip a bigger object
  const imp = await win.evaluate(() => window.__studioSettingsImport({ 'sound.volume': 0.8, 'sound.mute': false, 'theme.accent': '#ff8866' }));
  expect(imp.ok).toBe(true);
  expect(imp.imported).toBe(3);
  const l3 = await win.evaluate(() => window.__studioSettingsList());
  expect(l3.count).toBe(4);
  await win.screenshot({ path: path.join(OUT, '06-import.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 675: 6 settings features verified — final count', l3.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
