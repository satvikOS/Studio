import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-material-pack');

test('Studio V3 — PBR material pack: emissive/rough/metal/clearcoat/transmission/ior (slice 628)', async () => {
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

  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: emissive
  const e = await win.evaluate(() => window.__studioSetEmissive(0xff3322, 1.5));
  expect(e.ok).toBe(true);
  expect(e.intensity).toBe(1.5);
  await win.screenshot({ path: path.join(OUT, '01-emissive.png') });

  // 2: roughness
  const r = await win.evaluate(() => window.__studioSetRoughness(0.2));
  expect(r.ok).toBe(true);
  expect(r.roughness).toBe(0.2);
  await win.screenshot({ path: path.join(OUT, '02-rough.png') });

  // 3: metalness
  const m = await win.evaluate(() => window.__studioSetMetalness(0.9));
  expect(m.ok).toBe(true);
  expect(m.metalness).toBe(0.9);
  await win.screenshot({ path: path.join(OUT, '03-metal.png') });

  // 4: clearcoat
  const c = await win.evaluate(() => window.__studioSetClearcoat(1, 0.05));
  expect(c.ok).toBe(true);
  expect(c.clearcoat).toBe(1);
  await win.screenshot({ path: path.join(OUT, '04-clearcoat.png') });

  // 5: transmission
  const t = await win.evaluate(() => window.__studioSetTransmission(0.85, 0.5));
  expect(t.ok).toBe(true);
  expect(t.transmission).toBe(0.85);
  await win.screenshot({ path: path.join(OUT, '05-transmission.png') });

  // 6: ior
  const ior = await win.evaluate(() => window.__studioSetIor(1.45));
  expect(ior.ok).toBe(true);
  expect(ior.ior).toBe(1.45);
  await win.screenshot({ path: path.join(OUT, '06-ior.png') });

  // material is now MeshPhysicalMaterial
  const isPhys = await win.evaluate(() => {
    const sel = window.__studioSelectedMesh();
    const mat = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    return mat.isMeshPhysicalMaterial;
  });
  expect(isPhys).toBe(true);

  // eslint-disable-next-line no-console
  console.log('  slice 628: 6 features — PBR material pack verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
