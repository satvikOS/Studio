import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-version-pack');

test('Studio V3 — version: fingerprint/mark/list/restore/diff/delete (slice 670)', async () => {
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
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('studio.v3.versions.')) localStorage.removeItem(k);
    }
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Build a scene
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);

  // 1: fingerprint
  const f1 = await win.evaluate(() => window.__studioSceneFingerprint());
  expect(f1.ok).toBe(true);
  expect(f1.fingerprint).toHaveLength(8);
  await win.screenshot({ path: path.join(OUT, '01-fp.png') });

  // 2: mark v1
  const v1 = await win.evaluate(() => window.__studioVersionMark('v1'));
  expect(v1.ok).toBe(true);
  expect(v1.fingerprint).toBe(f1.fingerprint);
  await win.screenshot({ path: path.join(OUT, '02-mark.png') });

  // mutate scene
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);

  // 3: list
  const l = await win.evaluate(() => window.__studioVersionList());
  expect(l.count).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-list.png') });

  // 4: diff — current vs v1 should NOT match (sphere added)
  const dfRaw = await win.evaluate(() => window.__studioSceneDiff('v1'));
  expect(dfRaw.matched).toBe(false);
  expect(typeof dfRaw.bytesDelta).toBe('number');
  await win.screenshot({ path: path.join(OUT, '04-diff.png') });

  // 5: restore v1 → drops the sphere
  const before = await win.evaluate(() => {
    let n = 0; window.__archdiscScene.traverse((o) => { if (o.isMesh) n++; }); return n;
  });
  const r = await win.evaluate(() => window.__studioVersionRestore('v1'));
  expect(r.ok).toBe(true);
  const after = await win.evaluate(() => {
    let n = 0; window.__archdiscScene.traverse((o) => { if (o.isMesh) n++; }); return n;
  });
  expect(after).toBeLessThan(before);
  await win.screenshot({ path: path.join(OUT, '05-restore.png') });

  // 6: delete
  const d = await win.evaluate(() => window.__studioVersionDelete('v1'));
  expect(d.removed).toBe(true);
  const empty = await win.evaluate(() => window.__studioVersionList());
  expect(empty.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-delete.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 670: 6 version features verified — fp', f1.fingerprint, 'Δbytes', dfRaw.bytesDelta);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
