import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-menubar');

test('Studio V3 — top menu bar surfaces every op by category (slice 685)', async () => {
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
  // Generous wait so every autoload registers + the 800ms install delay elapses.
  await win.waitForTimeout(2500);

  // 1: menubar host present + has menus
  await expect(win.locator('[data-studio-v3-menubar]')).toBeVisible({ timeout: 5000 });
  const menus = await win.locator('[data-studio-v3-menubar] [data-menu]').count();
  expect(menus).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-bar.png') });

  // 2: click "Edit" → popover with edit ops
  const editMenu = win.locator('[data-studio-v3-menubar] [data-menu="Edit"]');
  if (await editMenu.count() > 0) {
    await editMenu.click();
    await win.waitForTimeout(150);
    const editRows = await win.locator('[data-studio-v3-menubar] [data-pop] [data-op]').count();
    expect(editRows).toBeGreaterThan(0);
    await win.screenshot({ path: path.join(OUT, '02-edit-open.png') });
  } else {
    await win.screenshot({ path: path.join(OUT, '02-edit-missing.png') });
  }

  // 3: click outside closes the popover
  await win.locator('[data-studio-v3-shell]').click({ position: { x: 50, y: 200 }, force: true });
  await win.waitForTimeout(100);
  const popVisible = await win.locator('[data-studio-v3-menubar] [data-pop]').count();
  expect(popVisible).toBe(0);
  await win.screenshot({ path: path.join(OUT, '03-closed.png') });

  // 4: registry size shows menus track the autoload-installed modules
  const regSize = await win.evaluate(() => window.__studioCommandRegistry?.size || 0);
  expect(regSize).toBeGreaterThan(50);
  await win.screenshot({ path: path.join(OUT, '04-regsize.png') });

  // 5: hide via API
  const hide = await win.evaluate(() => window.__studioMenuBarHide && window.__studioMenuBarHide());
  expect(hide.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-hidden.png') });

  // 6: show again
  const show = await win.evaluate(() => window.__studioMenuBarShow && window.__studioMenuBarShow());
  expect(show.ok).toBe(true);
  await expect(win.locator('[data-studio-v3-menubar] [data-menu]').first()).toBeVisible({ timeout: 2000 });
  await win.screenshot({ path: path.join(OUT, '06-shown.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 685: menubar has', menus, 'menus, registry size', regSize);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
