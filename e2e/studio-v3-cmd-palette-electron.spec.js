import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cmd-palette');

test('Studio V3 — command palette: register/list/search/invoke/unreg/reset (slice 668)', async () => {
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
  await win.waitForTimeout(400);

  // 1: list (auto-seeded with many __studio*)
  const list = await win.evaluate(() => window.__studioCommandList());
  expect(list.ok).toBe(true);
  expect(list.count).toBeGreaterThan(20);
  await win.screenshot({ path: path.join(OUT, '01-list.png') });

  // 2: register a custom command
  await win.evaluate(() => {
    window.__myCustomTouch = 0;
    return window.__studioCommandRegister(
      'myAction',
      () => { window.__myCustomTouch++; return { ok: true, ts: Date.now() }; },
      { category: 'user', description: 'increment a counter' },
    );
  });
  await win.screenshot({ path: path.join(OUT, '02-register.png') });

  // 3: search
  const s = await win.evaluate(() => window.__studioCommandSearch('myact'));
  expect(s.count).toBeGreaterThanOrEqual(1);
  expect(s.hits[0].name).toBe('myAction');
  await win.screenshot({ path: path.join(OUT, '03-search.png') });

  // 4: invoke
  const inv = await win.evaluate(() => window.__studioCommandInvoke('myAction'));
  expect(inv.ok).toBe(true);
  const touched = await win.evaluate(() => window.__myCustomTouch);
  expect(touched).toBe(1);
  await win.screenshot({ path: path.join(OUT, '04-invoke.png') });

  // 5: unregister
  const ur = await win.evaluate(() => window.__studioCommandUnregister('myAction'));
  expect(ur.removed).toBe(true);
  const after = await win.evaluate(() => window.__studioCommandSearch('myAction'));
  expect(after.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '05-unreg.png') });

  // 6: reset registry
  const r = await win.evaluate(() => window.__studioCommandResetRegistry());
  expect(r.ok).toBe(true);
  const empty = await win.evaluate(() => window.__studioCommandList());
  expect(empty.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-reset.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 668: 6 cmd-palette features verified — seeded', list.count, 'commands');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
