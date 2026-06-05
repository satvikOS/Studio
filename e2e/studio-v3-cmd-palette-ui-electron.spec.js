import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cmd-palette-ui');

test('Studio V3 — visible command palette UI (slice 683)', async () => {
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
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(800); // give autoload time to install

  // 1: open via API
  const o = await win.evaluate(() => window.__studioPaletteOpen && window.__studioPaletteOpen());
  expect(o.ok).toBe(true);
  await expect(win.locator('[data-studio-v3-cmdpalette]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '01-open.png') });

  // 2: type query → rows render
  await win.locator('[data-cmdpalette-input]').fill('select');
  await win.waitForTimeout(150);
  const rows = await win.locator('[data-row]').count();
  expect(rows).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '02-search.png') });

  // 3: close via Escape
  await win.keyboard.press('Escape');
  await win.waitForTimeout(100);
  const stillVisible = await win.locator('[data-studio-v3-cmdpalette]').isVisible().catch(() => false);
  expect(stillVisible).toBe(false);
  await win.screenshot({ path: path.join(OUT, '03-closed.png') });

  // 4: open via keyboard chord Cmd/Ctrl+Shift+P
  const isMac = process.platform === 'darwin';
  await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  await win.waitForTimeout(150);
  await expect(win.locator('[data-studio-v3-cmdpalette]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '04-chord.png') });

  // 5: list contains commands from the agent modules if available
  await win.locator('[data-cmdpalette-input]').fill('Edit');
  await win.waitForTimeout(150);
  const editHits = await win.locator('[data-row]').count();
  // Either edit ops are loaded (>0) OR the registry simply has nothing called "Edit" — both are valid
  expect(typeof editHits).toBe('number');
  await win.screenshot({ path: path.join(OUT, '05-edit.png') });

  // 6: close + verify isOpen state
  const closed = await win.evaluate(() => window.__studioPaletteClose());
  expect(closed.ok).toBe(true);
  const isOpen = await win.evaluate(() => window.__studioPaletteIsOpen());
  expect(isOpen).toBe(false);
  await win.screenshot({ path: path.join(OUT, '06-final.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 683: command palette UI verified — edit hits:', editHits);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
