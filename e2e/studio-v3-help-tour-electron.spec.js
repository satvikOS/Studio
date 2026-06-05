import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-help-tour');

test('Studio V3 — tour/help/version (slice 669)', async () => {
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

  // 1: start tour
  const s = await win.evaluate(() => window.__studioTourStart());
  expect(s.ok).toBe(true);
  expect(s.step.id).toBe('welcome');
  await win.screenshot({ path: path.join(OUT, '01-start.png') });

  // 2: next 3 times
  for (let i = 0; i < 3; i++) {
    const n = await win.evaluate(() => window.__studioTourNext());
    expect(n.ok).toBe(true);
  }
  await win.screenshot({ path: path.join(OUT, '02-next.png') });

  // 3: skip
  const k = await win.evaluate(() => window.__studioTourSkip());
  expect(k.skipped).toBe(true);
  const seen = await win.evaluate(() => localStorage.getItem('studio.v3.tour-seen'));
  expect(seen).toBe('1');
  await win.screenshot({ path: path.join(OUT, '03-skip.png') });

  // 4: reset
  const r = await win.evaluate(() => window.__studioTourReset());
  expect(r.ok).toBe(true);
  const seen2 = await win.evaluate(() => localStorage.getItem('studio.v3.tour-seen'));
  expect(seen2).toBe(null);
  await win.screenshot({ path: path.join(OUT, '04-reset.png') });

  // 5: helpFor existing op
  const h = await win.evaluate(() => window.__studioHelpFor('__studioGetFps'));
  expect(h.ok).toBe(true);
  expect(h.name).toBe('__studioGetFps');
  await win.screenshot({ path: path.join(OUT, '05-help.png') });

  // 6: version
  const v = await win.evaluate(() => window.__studioGetVersion());
  expect(v.ok).toBe(true);
  expect(v.app).toBe('ArchDisc Studio');
  expect(v.v3).toBe(true);
  expect(v.commands).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '06-version.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 669: 6 help/tour features verified — version', JSON.stringify(v));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
