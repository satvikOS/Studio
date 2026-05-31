import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-add-mountain');

test('Studio — Houdini Mountain SOP (slice 370)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioAddMountain === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  const r = await win.evaluate(() => window.__studioAddMountain({ radius: 0.05, segments: 48, strength: 0.4, seed: 7 }));
  expect(r.ok).toBe(true);
  expect(r.uuid).toBeTruthy();
  expect(r.verts).toBeGreaterThan(0);

  // Scene now has a mountain mesh with the kind tag.
  const probe = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return m ? {
      kind: m.userData.archdiscStudioPrimitiveKind,
      stamp: m.userData.archdiscStudioMountain,
      vertCount: m.geometry.attributes.position.count,
    } : null;
  }, { u: r.uuid });
  expect(probe).toBeTruthy();
  expect(probe.kind).toBe('mountain');
  expect(probe.stamp.seed).toBe(7);
  expect(probe.vertCount).toBe(r.verts);

  // Deterministic — same seed reproduces same vertex 0.
  const v0a = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    const p = m.geometry.attributes.position;
    return [p.getX(0), p.getY(0), p.getZ(0)];
  }, { u: r.uuid });
  const r2 = await win.evaluate(() => window.__studioAddMountain({ radius: 0.05, segments: 48, strength: 0.4, seed: 7 }));
  const v0b = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    const p = m.geometry.attributes.position;
    return [p.getX(0), p.getY(0), p.getZ(0)];
  }, { u: r2.uuid });
  expect(v0a[0]).toBeCloseTo(v0b[0], 6);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 370: mountain with', r.verts, 'verts, deterministic seed reproduces v0');

  await app.close();
});
