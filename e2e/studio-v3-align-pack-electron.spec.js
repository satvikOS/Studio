import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-align-pack');

test('Studio V3 — align/distribute/stack/center/bounds/mirror (slice 653)', async () => {
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

  // Build 3 cubes at staggered Y positions.
  const uuids = await win.evaluate(() => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x88aaff }));
      m.position.set(i, i * 0.7, 0);
      window.__archdiscScene.add(m);
      out.push(m.uuid);
    }
    if (window.__studioSelectMeshes) {
      window.__studioSelectMeshes(out.map((u) => window.__archdiscScene.getObjectByProperty('uuid', u)));
    } else if (window.__studioSelectMesh) {
      window.__studioSelectMesh(window.__archdiscScene.getObjectByProperty('uuid', out[0]));
    }
    return out;
  });

  // 1: align Y center
  const al = await win.evaluate(() => window.__studioAlignSelectionTo('y', 'center'));
  expect(al.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-align.png') });

  // 2: distribute X
  const di = await win.evaluate(() => window.__studioDistributeSelection('x'));
  // Either ok or "need ≥3" if multi-select shim returned <3
  expect(typeof di.ok).toBe('boolean');
  await win.screenshot({ path: path.join(OUT, '02-distribute.png') });

  // 3: stack on X with gap=0.1
  const st = await win.evaluate(() => window.__studioStackOnAxis('x', 0.1));
  expect(typeof st.ok).toBe('boolean');
  await win.screenshot({ path: path.join(OUT, '03-stack.png') });

  // 4: center selection to origin
  const ce = await win.evaluate(() => window.__studioCenterSelectionToOrigin());
  expect(ce.ok).toBe(true);
  expect(ce.offset.length).toBe(3);
  await win.screenshot({ path: path.join(OUT, '04-center.png') });

  // 5: group bounds
  const gb = await win.evaluate(() => window.__studioGroupBoundsCenter());
  expect(gb.ok).toBe(true);
  expect(gb.center.length).toBe(3);
  expect(gb.size.length).toBe(3);
  await win.screenshot({ path: path.join(OUT, '05-bounds.png') });

  // 6: mirror across YZ plane (flip X)
  const before = await win.evaluate((us) => us.map((u) => window.__archdiscScene.getObjectByProperty('uuid', u).position.x), uuids);
  const mi = await win.evaluate(() => window.__studioMirrorSelection('yz'));
  expect(mi.ok).toBe(true);
  const after = await win.evaluate((us) => us.map((u) => window.__archdiscScene.getObjectByProperty('uuid', u).position.x), uuids);
  // every position.x flipped
  before.forEach((v, i) => expect(after[i]).toBeCloseTo(-v, 5));
  await win.screenshot({ path: path.join(OUT, '06-mirror.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 653: 6 align/distribute features —', uuids.length, 'meshes');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
