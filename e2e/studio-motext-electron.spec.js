import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-motext');

test('Studio — Cinema 4D MoText (extruded 3D text) (slice 310)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioMoText === 'function', null, { timeout: 30000 });
  // Font loads async — give it up to 10s to be ready.
  await win.waitForFunction(() => {
    const r = window.__studioMoText({ text: 'ping' });
    return r && r.ok;
  }, null, { timeout: 10000 });

  // Add the canonical MoText.
  const r = await win.evaluate(() => window.__studioMoText({
    text: 'PARITY', size: 0.06, color: '#9adfff',
  }));
  expect(r.ok).toBe(true);
  expect(r.text).toBe('PARITY');
  expect(r.uuid).toBeTruthy();

  const probe = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return m ? {
      isMesh: m.isMesh,
      kind: m.userData.archdiscStudioPrimitiveKind,
      stampText: m.userData.archdiscMoText.text,
      vertCount: m.geometry.attributes.position.count,
    } : null;
  }, { u: r.uuid });
  expect(probe).toBeTruthy();
  expect(probe.isMesh).toBe(true);
  expect(probe.kind).toBe('motext');
  expect(probe.stampText).toBe('PARITY');
  expect(probe.vertCount).toBeGreaterThan(50);

  // Empty text rejected.
  const bad = await win.evaluate(() => window.__studioMoText({ text: '' }));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 310: MoText "PARITY" — verts=', probe.vertCount);

  await app.close();
});
