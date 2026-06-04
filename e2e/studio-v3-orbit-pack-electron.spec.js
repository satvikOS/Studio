import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-orbit-pack');

test('Studio V3 — orbit controls: rot/zoom/pan/damping/lockY/state (slice 648)', async () => {
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

  // 1: rotate speed
  const rs = await win.evaluate(() => window.__studioSetOrbitSpeed(2.5));
  expect(rs.ok).toBe(true);
  expect(rs.rotateSpeed).toBe(2.5);
  await win.screenshot({ path: path.join(OUT, '01-rotate.png') });

  // 2: zoom speed
  const zs = await win.evaluate(() => window.__studioSetZoomSpeed(0.5));
  expect(zs.ok).toBe(true);
  expect(zs.zoomSpeed).toBe(0.5);
  await win.screenshot({ path: path.join(OUT, '02-zoom.png') });

  // 3: pan speed
  const ps = await win.evaluate(() => window.__studioSetPanSpeed(1.5));
  expect(ps.ok).toBe(true);
  expect(ps.panSpeed).toBe(1.5);
  await win.screenshot({ path: path.join(OUT, '03-pan.png') });

  // 4: damping
  const d = await win.evaluate(() => window.__studioSetDamping(0.25));
  expect(d.ok).toBe(true);
  expect(d.damping).toBe(0.25);
  await win.screenshot({ path: path.join(OUT, '04-damping.png') });

  // 5: lock Y
  const ly = await win.evaluate(() => window.__studioLockCameraY(true));
  expect(ly.ok).toBe(true);
  expect(ly.locked).toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-lockY.png') });

  // 6: state
  const st = await win.evaluate(() => window.__studioGetOrbitState());
  expect(st.ok).toBe(true);
  expect(st.rotateSpeed).toBe(2.5);
  expect(st.zoomSpeed).toBe(0.5);
  expect(st.panSpeed).toBe(1.5);
  expect(st.damping).toBeCloseTo(0.25, 3);
  expect(st.lockedY).toBe(true);
  await win.screenshot({ path: path.join(OUT, '06-state.png') });

  // restore lockY off
  await win.evaluate(() => window.__studioLockCameraY(false));

  // eslint-disable-next-line no-console
  console.log('  slice 648: 6 orbit features —', JSON.stringify({ rs: st.rotateSpeed, zs: st.zoomSpeed, d: st.damping, locked: st.lockedY }));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
