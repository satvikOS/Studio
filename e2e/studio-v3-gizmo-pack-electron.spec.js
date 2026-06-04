import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-gizmo-pack');

test('Studio V3 — gizmo: mode/space/size/visible/snap/state (slice 658)', async () => {
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

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: mode
  const m = await win.evaluate(() => window.__studioGizmoSetMode('rotate'));
  expect(m.ok).toBe(true);
  expect(m.mode).toBe('rotate');
  await win.screenshot({ path: path.join(OUT, '01-mode.png') });

  // 2: space
  const sp = await win.evaluate(() => window.__studioGizmoSetSpace('local'));
  expect(sp.space).toBe('local');
  await win.screenshot({ path: path.join(OUT, '02-space.png') });

  // 3: size
  const sz = await win.evaluate(() => window.__studioGizmoSetSize(1.5));
  expect(sz.size).toBe(1.5);
  await win.screenshot({ path: path.join(OUT, '03-size.png') });

  // 4: visible toggle
  const off = await win.evaluate(() => window.__studioGizmoSetVisible(false));
  expect(off.visible).toBe(false);
  const on = await win.evaluate(() => window.__studioGizmoSetVisible(true));
  expect(on.visible).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-vis.png') });

  // 5: snap
  const sn = await win.evaluate(() => window.__studioGizmoSetSnap(0.1, 15, 0.25));
  expect(sn.translateSnap).toBe(0.1);
  expect(sn.rotateSnap).toBeCloseTo(15 * Math.PI / 180, 5);
  expect(sn.scaleSnap).toBe(0.25);
  await win.screenshot({ path: path.join(OUT, '05-snap.png') });

  // 6: state
  const st = await win.evaluate(() => window.__studioGizmoGetState());
  expect(st.ok).toBe(true);
  expect(st.mode).toBe('rotate');
  expect(st.space).toBe('local');
  expect(st.size).toBe(1.5);
  await win.screenshot({ path: path.join(OUT, '06-state.png') });

  // restore mode to translate so subsequent specs aren't affected
  await win.evaluate(() => window.__studioGizmoSetMode('translate'));
  await win.evaluate(() => window.__studioGizmoSetSnap(null, null, null));

  // eslint-disable-next-line no-console
  console.log('  slice 658: 6 gizmo features verified —', JSON.stringify({ mode: st.mode, space: st.space, size: st.size }));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
