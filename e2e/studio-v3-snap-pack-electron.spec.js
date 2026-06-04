import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-snap-pack');

test('Studio V3 — snap: mode/grid/angle/lock/enable/apply (slice 655)', async () => {
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

  // 1: mode set
  const m = await win.evaluate(() => window.__studioSnapModeSet('grid'));
  expect(m.mode).toBe('grid');
  await win.screenshot({ path: path.join(OUT, '01-mode.png') });

  // 2: grid size
  const gs = await win.evaluate(() => window.__studioSnapGridSize(0.25));
  expect(gs.gridSize).toBe(0.25);
  await win.screenshot({ path: path.join(OUT, '02-grid.png') });

  // 3: angle step
  const ang = await win.evaluate(() => window.__studioSnapAngleStep(45));
  expect(ang.angleStepDeg).toBe(45);
  await win.screenshot({ path: path.join(OUT, '03-angle.png') });

  // 4: lock axis
  const lk = await win.evaluate(() => window.__studioSnapLockAxis('y'));
  expect(lk.lockedAxis).toBe('y');
  await win.screenshot({ path: path.join(OUT, '04-lock.png') });

  // 5: enable + apply
  await win.evaluate(() => window.__studioSnapLockAxis(null));
  await win.evaluate(() => window.__studioSnapEnabled(true));
  const ap = await win.evaluate(() => window.__studioSnapApply([0.37, -0.13, 0.81]));
  expect(ap.ok).toBe(true);
  expect(ap.position[0]).toBeCloseTo(0.25, 6);
  expect(ap.position[1]).toBeCloseTo(-0.25, 6);
  expect(ap.position[2]).toBeCloseTo(0.75, 6);
  await win.screenshot({ path: path.join(OUT, '05-apply.png') });

  // 6: mode get reflects state
  const g = await win.evaluate(() => window.__studioSnapModeGet());
  expect(g.gridSize).toBe(0.25);
  expect(g.angleStepDeg).toBe(45);
  expect(g.enabled).toBe(true);
  await win.screenshot({ path: path.join(OUT, '06-state.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 655: 6 snap features — applied (0.37, -0.13, 0.81) →', ap.position);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
