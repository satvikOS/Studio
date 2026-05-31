import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mospline');

test('Studio — Cinema 4D MoSpline parametric helix (slice 302)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioMoSpline === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  const res = await win.evaluate(() => window.__studioMoSpline({
    type: 'helix', segments: 60, radius: 0.4, height: 1.0, turns: 3,
  }));
  expect(res.ok).toBe(true);
  expect(res.type).toBe('helix');
  expect(res.segments).toBe(60);
  expect(res.points.length).toBe(60);
  // First and last Y of helix differ by ~height.
  expect(Math.abs(res.points[59][1] - res.points[0][1])).toBeGreaterThan(0.5);

  // Verify scene has the Line.
  const sceneProbe = await win.evaluate(({ u }) => {
    let line = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) line = o; });
    return line ? {
      isLine: line.isLine === true,
      count: line.geometry.attributes.position.count,
      kind: line.userData.archdiscStudioPrimitiveKind,
    } : null;
  }, { u: res.uuid });
  expect(sceneProbe).toBeTruthy();
  expect(sceneProbe.isLine).toBe(true);
  expect(sceneProbe.count).toBe(60);
  expect(sceneProbe.kind).toBe('mospline');

  // Lissajous test.
  const r2 = await win.evaluate(() => window.__studioMoSpline({
    type: 'lissajous', segments: 80, radius: 0.5,
  }));
  expect(r2.ok).toBe(true);
  expect(r2.points.length).toBe(80);

  // Bad type.
  const bad = await win.evaluate(() => window.__studioMoSpline({ type: 'nonsense' }));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 302: MoSpline helix + lissajous built; bad type rejected');

  await app.close();
});
