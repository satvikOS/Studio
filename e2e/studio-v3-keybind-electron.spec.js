import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-keybind');

test('Studio V3 — key bindings: set/remove/list/reset/invoke/capture (slice 654)', async () => {
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

  // 1: set binding ctrl+alt+t → __studioGetTheme
  const s = await win.evaluate(() => window.__studioSetKeyBinding('ctrl+alt+t', '__studioGetTheme'));
  expect(s.ok).toBe(true);
  expect(s.total).toBe(1);
  await win.screenshot({ path: path.join(OUT, '01-set.png') });

  // 2: list
  const l = await win.evaluate(() => window.__studioListKeyBindings());
  expect(l.count).toBe(1);
  expect(l.bindings[0].combo).toBe('ctrl+alt+t');
  await win.screenshot({ path: path.join(OUT, '02-list.png') });

  // 3: invoke programmatically
  const inv = await win.evaluate(() => window.__studioInvokeShortcut('ctrl+alt+t'));
  expect(inv.ok).toBe(true);
  expect(inv.fired).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-invoke.png') });

  // 4: remove
  const r = await win.evaluate(() => window.__studioRemoveKeyBinding('ctrl+alt+t'));
  expect(r.removed).toBe(true);
  expect(r.total).toBe(0);
  await win.screenshot({ path: path.join(OUT, '04-remove.png') });

  // 5: reset (after adding a few more)
  await win.evaluate(() => {
    window.__studioSetKeyBinding('ctrl+1', '__studioGetTheme');
    window.__studioSetKeyBinding('ctrl+2', '__studioGetTheme');
  });
  const rs = await win.evaluate(() => window.__studioResetKeyBindings());
  expect(rs.removed).toBe(2);
  await win.screenshot({ path: path.join(OUT, '05-reset.png') });

  // 6: capture next key — kick off the promise then synthesise a press
  const captured = await win.evaluate(() => {
    return new Promise((resolve) => {
      window.__studioCaptureNextKey().then(resolve);
      setTimeout(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true, metaKey: false, altKey: true }));
      }, 50);
    });
  });
  expect(captured.ok).toBe(true);
  expect(captured.combo).toBe('ctrl+alt+q');
  await win.screenshot({ path: path.join(OUT, '06-capture.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 654: 6 keybind features verified (captured', captured.combo, ')');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
