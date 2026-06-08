// ArchDisc Studio V3 — autosave restore banner Forge placement (slice 952).
//
// Headed Electron spec. Verifies the "Autosave found" restore prompt is usable
// again, but anchored below Forge's topbar/QAT/toolbar stack so it never covers
// menus or ribbon tools.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-autosave-restore');

async function pickAppWindow(app) {
  for (let i = 0; i < 30; i++) {
    const win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    });
    if (win) return win;
    await new Promise((r) => setTimeout(r, 500));
  }
  return app.firstWindow();
}

test('Studio V3 — Autosave found banner sits below toolbar, not over chrome', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 120,
  });
  const win = await pickAppWindow(app);
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    try { window.localStorage.removeItem('studioV3'); } catch (_) {}
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
    window.localStorage.removeItem('archdisc.studio.autosave');
    window.localStorage.removeItem('archdisc.studio.autosave.ts');
  });

  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1600);
    try {
      await expect(win.locator('[data-studio-v3-shell],[data-studio-v3-topbar]').first())
        .toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);

  // Seed a real autosave payload via the Studio save path so Restore remains
  // covered while this slice asserts the new Forge-safe placement.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const json = window.__studioSaveScene ? window.__studioSaveScene() : '';
    if (!json) throw new Error('missing saveScene payload');
    window.localStorage.setItem('archdisc.studio.autosave', json);
    window.localStorage.setItem('archdisc.studio.autosave.ts', String(Date.now() - 2000));
  });

  shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1600);
    try {
      await expect(win.locator('[data-studio-v3-shell],[data-studio-v3-topbar]').first())
        .toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);

  const banner = win.locator('[data-studio-v3-autosave-restore]');
  await expect(banner).toBeVisible({ timeout: 20000 });
  await expect(banner).toContainText('Autosave found');

  const diag = await win.evaluate(() => {
    const b = document.querySelector('[data-studio-v3-autosave-restore]')?.getBoundingClientRect();
    const toolbar = document.querySelector('.studio-toolbar,[data-studio-v3-toolbar]')?.getBoundingClientRect();
    const topbar = document.querySelector('.studio-topbar,[data-studio-v3-topbar]')?.getBoundingClientRect();
    const qat = document.querySelector('.studio-qat,[data-studio-v3-qat]')?.getBoundingClientRect();
    const viewport = document.querySelector('.studio-viewport,[data-studio-v3-viewport]')?.getBoundingClientRect();
    const overlap = (a, c) => !!(a && c && a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top);
    return {
      banner: b && { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height },
      toolbar: toolbar && { left: toolbar.left, top: toolbar.top, right: toolbar.right, bottom: toolbar.bottom },
      topbar: topbar && { left: topbar.left, top: topbar.top, right: topbar.right, bottom: topbar.bottom },
      qat: qat && { left: qat.left, top: qat.top, right: qat.right, bottom: qat.bottom },
      viewport: viewport && { left: viewport.left, top: viewport.top, right: viewport.right, bottom: viewport.bottom },
      overlapsToolbar: overlap(b, toolbar),
      overlapsTopbar: overlap(b, topbar),
      overlapsQat: overlap(b, qat),
      topChromeBottom: Math.max(topbar?.bottom || 0, qat?.bottom || 0, toolbar?.bottom || 0),
    };
  });
  console.log('[autosave-restore] diag', JSON.stringify(diag));

  expect(diag.banner).toBeTruthy();
  expect(diag.overlapsTopbar).toBe(false);
  expect(diag.overlapsQat).toBe(false);
  expect(diag.overlapsToolbar).toBe(false);
  expect(diag.banner.top).toBeGreaterThanOrEqual(diag.topChromeBottom + 8);
  if (diag.viewport) {
    expect(diag.banner.left).toBeGreaterThanOrEqual(diag.viewport.left - 1);
  }

  await win.screenshot({ path: path.join(OUT, '00-autosave-below-toolbar.png') });

  await win.locator('[data-studio-v3-autosave-restore-btn]').click();
  await expect(banner).toHaveCount(0);
  const restoredCount = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || window.__archdiscViewport?.scene;
    s?.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(restoredCount).toBeGreaterThanOrEqual(1);

  console.log('  slice 952: Autosave found banner below toolbar; Restore recovered', restoredCount, 'primitive(s)');

  await app.close();
});
