import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-vex-expression');

test('Studio — VEX-like per-vertex expression evaluator (slice 282)', async () => {
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
  await win.waitForTimeout(1500);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'vex demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'sphere', pos: [0, 0, 0], scale: [4, 4, 4], color: '#9ad' }],
      expect: { bodies: 1, kinds: ['sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(400);

  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return { y0: p.getY(0), count: p.count };
  });

  const res = await win.evaluate(() => window.__studioRunVexExpr('[P.x, P.y + 0.05 * Math.sin(P.x * 8), P.z]'));
  expect(res.ok).toBe(true);
  expect(res.changed).toBe(before.count);

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    let dySum = 0;
    for (let i = 0; i < p.count; i++) { dySum += Math.abs(p.getY(i)); }
    return { dySum, y0: p.getY(0), counter: m.userData.archdiscStudioVexExpr };
  });
  expect(after.counter).toBe(1);
  expect(after.dySum).toBeGreaterThan(0);

  // Negative test: expression touching window must fail at compile (strict-mode body)
  // or at eval (window not in scope) — either way, ok:false.
  const bad = await win.evaluate(() => window.__studioRunVexExpr('window.alert(1)'));
  expect(bad.ok).toBe(false);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 282: VEX expression rewrote', res.changed, 'verts; bad-expr safely rejected');

  await app.close();
});
