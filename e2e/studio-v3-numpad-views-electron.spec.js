import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-numpad-views');

test('Studio V3 — Numpad 1/3/7 hit front/right/top views (slice 555)', async () => {
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
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  const probe = async (code) => {
    await win.evaluate((c) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c.replace('Numpad', '') }));
    }, code);
    await win.waitForTimeout(200);
    return win.evaluate(() => {
      const c = window.__archdiscViewport.camera;
      return [c.position.x, c.position.y, c.position.z];
    });
  };

  const front = await probe('Numpad1');
  expect(Math.abs(front[2])).toBeGreaterThan(Math.abs(front[1])); // +Z dominates

  const right = await probe('Numpad3');
  expect(Math.abs(right[0])).toBeGreaterThan(Math.abs(right[1])); // X dominates

  const top = await probe('Numpad7');
  expect(Math.abs(top[1])).toBeGreaterThan(Math.abs(top[0])); // Y dominates

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 555: numpad views front', front.map((n)=>n.toFixed(2)).join(','), '· right', right.map((n)=>n.toFixed(2)).join(','), '· top', top.map((n)=>n.toFixed(2)).join(','));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
