import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-procedural-texture');

test('Studio — Substance Designer procedural noise → texture (slice 294)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioProceduralTexture === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'procedural texture demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#fff' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(400);

  // Perlin fBm to .map channel.
  const r1 = await win.evaluate(() => window.__studioProceduralTexture({
    type: 'perlin', size: 128, channel: 'map',
    params: { freq: 6, octaves: 4, color1: '#3a2e1c', color2: '#d8c79a', seed: 7 },
  }));
  expect(r1.ok).toBe(true);
  expect(r1.type).toBe('perlin');
  expect(r1.size).toBe(128);
  expect(r1.mean).toBeGreaterThan(0.1);
  expect(r1.mean).toBeLessThan(0.9);

  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const t = m.material.map;
    if (!t || !t.image) return null;
    const c = t.image; const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonZero = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 0) nonZero++;
    return { w: c.width, nonZero };
  });
  expect(probe.w).toBe(128);
  expect(probe.nonZero).toBeGreaterThan(0);

  // Determinism: same seed → identical mean.
  const r2 = await win.evaluate(() => window.__studioProceduralTexture({
    type: 'perlin', size: 128, channel: 'map',
    params: { freq: 6, octaves: 4, color1: '#3a2e1c', color2: '#d8c79a', seed: 7 },
  }));
  expect(Math.abs(r2.mean - r1.mean)).toBeLessThan(1e-9);

  // Voronoi onto roughnessMap.
  const r3 = await win.evaluate(() => window.__studioProceduralTexture({
    type: 'voronoi', size: 64, channel: 'roughnessMap',
    params: { freq: 3, cells: 12, color1: '#202020', color2: '#f0f0f0', seed: 11 },
  }));
  expect(r3.ok).toBe(true);
  expect(r3.channel).toBe('roughnessMap');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 294: procedural perlin mean=', r1.mean.toFixed(3), '; deterministic=', Math.abs(r2.mean - r1.mean) < 1e-9);

  await app.close();
});
