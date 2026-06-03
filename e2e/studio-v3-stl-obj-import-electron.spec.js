import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-stl-obj-import');

test('Studio V3 — STL + OBJ roundtrip via importer (slice 589)', async () => {
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

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  // Stub <a>.click so the exporter doesn't pop OS dialogs.
  await win.evaluate(() => {
    window.__lastExport = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__lastExport = this.href; };
    window.__restoreClick = () => { HTMLAnchorElement.prototype.click = orig; };
  });

  // Minimal ASCII STL + OBJ blobs (single triangle each).
  const stlTxt = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t
`;
  const objTxt = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';

  const stlR = await win.evaluate(async (txt) => {
    const ab = new TextEncoder().encode(txt).buffer;
    return await window.__studioImportSTL(ab, 'roundtrip.stl');
  }, stlTxt);
  expect(stlR.ok).toBe(true);

  const objR = await win.evaluate(async (txt) => window.__studioImportOBJ(txt, 'roundtrip.obj'), objTxt);
  expect(objR.ok).toBe(true);

  const stl = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'stl') n++; });
    return n;
  });
  const obj = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'obj') n++; });
    return n;
  });
  expect(stl).toBe(1);
  expect(obj).toBe(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 589: STL ×', stl, '· OBJ ×', obj);

  await win.evaluate(() => {
    window.__restoreClick && window.__restoreClick();
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
