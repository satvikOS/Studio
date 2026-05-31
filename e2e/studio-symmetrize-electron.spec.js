import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-symmetrize');

test('Studio — Blender Symmetrize mesh op (slice 358)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSymmetrize === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  // Asymmetrize the cube by displacing every -X vert further out.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) < 0) p.setX(i, p.getX(i) - 0.005);
    }
    p.needsUpdate = true;
  });

  // Symmetrize: keep +X, mirror to -X. Now -X side becomes mirror of +X.
  const r = await win.evaluate(() => window.__studioSymmetrize('+x'));
  expect(r.ok).toBe(true);
  expect(r.flipped).toBeGreaterThan(0);

  // Verify: for every vert with x<0, its absolute position matches some vert with x>0.
  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    const positives = [];
    const negatives = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      if (x > 0) positives.push([x, p.getY(i), p.getZ(i)]);
      else if (x < 0) negatives.push([-x, p.getY(i), p.getZ(i)]); // flip sign for comparison
    }
    let asymmetric = 0;
    for (const n of negatives) {
      const match = positives.find((p2) => Math.abs(p2[0] - n[0]) < 1e-4 && Math.abs(p2[1] - n[1]) < 1e-4 && Math.abs(p2[2] - n[2]) < 1e-4);
      if (!match) asymmetric++;
    }
    return { positives: positives.length, negatives: negatives.length, asymmetric };
  });
  expect(probe.asymmetric).toBe(0);

  // Bad direction.
  const bad = await win.evaluate(() => window.__studioSymmetrize('q'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 358: symmetrize +x flipped', r.flipped, 'verts; mesh is now symmetric');

  await app.close();
});
