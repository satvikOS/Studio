import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-scheduler');

test('Studio V3 — scheduler: every/once/clear/list/clearAll/waitFor (slice 673)', async () => {
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

  // Counter on window for the scheduled work.
  await win.evaluate(() => { window.__schedHits = 0; });

  // 1: every — ticks ≥3× in 350 ms
  const e = await win.evaluate(() => window.__studioScheduleEvery(50, () => { window.__schedHits++; }));
  expect(e.ok).toBe(true);
  await win.waitForTimeout(300);
  const hits = await win.evaluate(() => window.__schedHits);
  expect(hits).toBeGreaterThanOrEqual(3);
  await win.screenshot({ path: path.join(OUT, '01-every.png') });

  // 2: once — fires once after 100 ms
  await win.evaluate(() => { window.__onceHit = 0; });
  await win.evaluate(() => window.__studioScheduleOnce(100, () => { window.__onceHit = 1; }));
  await win.waitForTimeout(220);
  const o = await win.evaluate(() => window.__onceHit);
  expect(o).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-once.png') });

  // 3: clear the interval
  const c = await win.evaluate((id) => window.__studioScheduleClear(id), e.id);
  expect(c.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-clear.png') });

  // 4: list (should be empty for intervals now, may have pending once)
  const l = await win.evaluate(() => window.__studioScheduleList());
  expect(l.ok).toBe(true);
  expect(l.items.find((r) => r.kind === 'interval')).toBeFalsy();
  await win.screenshot({ path: path.join(OUT, '04-list.png') });

  // 5: clearAll
  // First schedule a few
  await win.evaluate(() => {
    window.__studioScheduleEvery(60, () => {});
    window.__studioScheduleOnce(5000, () => {});
  });
  const cl = await win.evaluate(() => window.__studioScheduleClearAll());
  expect(cl.cleared).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '05-clearAll.png') });

  // 6: waitForCondition — resolves once window.__condReady is true
  await win.evaluate(() => {
    window.__condReady = false;
    setTimeout(() => { window.__condReady = true; }, 150);
  });
  const wf = await win.evaluate(() => window.__studioWaitForCondition(() => window.__condReady, 1000, 20));
  expect(wf.ok).toBe(true);
  expect(wf.elapsedMs).toBeGreaterThanOrEqual(100);
  await win.screenshot({ path: path.join(OUT, '06-waitFor.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 673: 6 scheduler features verified — every-hits', hits, 'waitFor', wf.elapsedMs, 'ms');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
