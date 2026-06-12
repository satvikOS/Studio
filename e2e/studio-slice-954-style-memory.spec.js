import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Slice 954 — §6 per-project style memory. Seeded style renders in the
// Inspector; "suggest" prepends the style note VISIBLY into the cmdbar
// (no hidden injection). Recording is exercised by the 952 gate spec's
// coherent path; here we verify surface + suggest + persistence shape.

test('Studio slice 954 — project style memory section', async () => {
  test.setTimeout(120000);
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: 100,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
    window.localStorage.setItem('studio.v3.style-memory.default', JSON.stringify({
      mats: { wood: 9, chrome: 3, velvet: 1 }, builds: 4, avgBodies: 6.5, ts: Date.now(),
    }));
  });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });

  await expect(win.locator('[data-studio-v3-style-memory]')).toBeVisible({ timeout: 6000 });
  const text = await win.locator('[data-studio-v3-style-memory]').textContent();
  expect(text).toContain('4 builds');
  expect(text).toContain('wood');

  await win.locator('[data-studio-v3-style-suggest]').click();
  const val = await win.locator('[data-studio-v3-cmdbar-input]').inputValue();
  expect(val).toContain('Project style: mostly wood + chrome');
  expect(val).toContain('~6.5 bodies');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
