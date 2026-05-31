import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-merge-meshes');

test('Studio — Maya Combine / Blender Join (slice 363)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioMergeMeshes === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn cube + sphere at known positions.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  const uuidA = await win.evaluate(() => window.__studioSelectedMesh().uuid);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  const uuidB = await win.evaluate(() => window.__studioSelectedMesh().uuid);

  const r = await win.evaluate(({ a, b }) => window.__studioMergeMeshes([a, b]), { a: uuidA, b: uuidB });
  expect(r.ok).toBe(true);
  expect(r.sourceCount).toBe(2);
  expect(r.vertCount).toBeGreaterThan(0);

  // Merged mesh should be in scene with the merged kind.
  const probe = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return m ? { kind: m.userData.archdiscStudioPrimitiveKind, fromCount: (m.userData.archdiscStudioMergedFrom || []).length } : null;
  }, { u: r.uuid });
  expect(probe.kind).toBe('merged');
  expect(probe.fromCount).toBe(2);

  // Need at least 2 sources.
  const bad = await win.evaluate(({ a }) => window.__studioMergeMeshes([a]), { a: uuidA });
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 363: merged 2 meshes into 1 with', r.vertCount, 'verts');

  await app.close();
});
