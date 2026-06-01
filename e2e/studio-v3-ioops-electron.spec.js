import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-ioops');

test('Studio V3 — file I/O family (slice 416)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioImportAsset === 'function', null, { timeout: 15000 });

  // Spawn cube so the GLTF export has content.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // ExportGltfString returns valid JSON with primitives.
  const gltf = await win.evaluate(async () => window.__studioExportGltfString());
  expect(typeof gltf).toBe('string');
  expect(gltf.length).toBeGreaterThan(50);
  const parsed = JSON.parse(gltf);
  expect(parsed.asset).toBeTruthy();

  // ImportAsset OBJ — minimal OBJ with one triangle adds 1 primitive.
  const before = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  const objText = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
  const r = await win.evaluate((t) => window.__studioImportAsset('obj', t), objText);
  expect(r.ok).toBe(true);
  expect(r.added).toBe(1);
  const after = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(after).toBe(before + 1);

  // Bad format rejected.
  const bad = await win.evaluate(() => window.__studioImportAsset('xyz', 'whatever'));
  expect(bad.ok).toBe(false);

  // Autosave timestamp accessor.
  const ts = await win.evaluate(() => window.__studioAutosaveAt());
  expect(typeof ts).toBe('number');

  // RestoreAutosave on empty slot → ok:false.
  await win.evaluate(() => window.localStorage.removeItem('archdisc.studio.autosave'));
  const restore = await win.evaluate(() => window.__studioRestoreAutosave());
  expect(restore.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 416: export GLTF + import OBJ + autosave probes all ok');

  await app.close();
});
