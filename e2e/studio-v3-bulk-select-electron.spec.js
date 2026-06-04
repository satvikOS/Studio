import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-bulk-select');

test('Studio V3 — bulk select/hide: distance/name/color/invert/hideUnsel/showAll (slice 641)', async () => {
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

  // Build a small scene: 4 meshes at different positions/names/colors.
  await win.evaluate(() => {
    const make = (name, color, pos) => {
      const g = new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color }));
      m.name = name;
      m.position.set(pos[0], pos[1], pos[2]);
      window.__archdiscScene.add(m);
      return m.uuid;
    };
    window.__bulkUuids = [
      make('near_red',   0xff0000, [0, 0, 0]),
      make('near_blue',  0x0000ff, [0.5, 0, 0]),
      make('far_green',  0x00ff00, [5, 0, 0]),
      make('far_red',    0xff0000, [-5, 0, 0]),
    ];
  });

  // 1: distance — pick near origin r=1, expect 2
  const d = await win.evaluate(() => window.__studioSelectByDistance([0, 0, 0], 1));
  expect(d.count).toBe(2);
  await win.screenshot({ path: path.join(OUT, '01-distance.png') });

  // 2: name regex /near/
  const n = await win.evaluate(() => window.__studioSelectByName('near'));
  expect(n.count).toBe(2);
  await win.screenshot({ path: path.join(OUT, '02-name.png') });

  // 3: color = red picks 2
  const c = await win.evaluate(() => window.__studioSelectByMaterialColor(0xff0000));
  expect(c.count).toBe(2);
  await win.screenshot({ path: path.join(OUT, '03-color.png') });

  // 4: invert visibility — toggles each
  const before = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh && o.visible) n++; });
    return n;
  });
  const inv = await win.evaluate(() => window.__studioInvertVisibility());
  expect(inv.ok).toBe(true);
  const after = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh && o.visible) n++; });
    return n;
  });
  expect(after).not.toBe(before);
  // restore for next step
  await win.evaluate(() => window.__studioInvertVisibility());
  await win.screenshot({ path: path.join(OUT, '04-invert.png') });

  // 5: hide unselected — make near_red the sole selection, hide the rest
  await win.evaluate(() => {
    const m = window.__archdiscScene.getObjectByName('near_red');
    if (window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  const hide = await win.evaluate(() => window.__studioHideUnselected());
  expect(hide.ok).toBe(true);
  expect(hide.hidden).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '05-hideUnsel.png') });

  // 6: show all
  const show = await win.evaluate(() => window.__studioShowAll());
  expect(show.ok).toBe(true);
  expect(show.revealed).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '06-showAll.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 641: 6 bulk-select features verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
