import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 227: scene autosave to localStorage + manual restore.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-autosave');

test('Studio — saveScene -> localStorage; __studioRestoreAutosave rebuilds', async () => {
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
  await win.waitForFunction(() => typeof window.__studioRestoreAutosave === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Build a teapot, then write the autosave proactively (the 30s
  // interval is too long for a spec; we trigger save directly via
  // saveScene + localStorage to verify the round-trip pipeline).
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'autosave demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [1, 1, 1], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(500);
  await win.evaluate(() => {
    const json = window.__studioSaveScene();
    window.localStorage.setItem('archdisc.studio.autosave', json);
    window.localStorage.setItem('archdisc.studio.autosave.ts', String(Date.now()));
  });

  // Wipe scene.
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    const toRemove = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) toRemove.push(o); });
    for (const m of toRemove) s.remove(m);
  });
  await win.waitForTimeout(300);
  const cleared = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(cleared).toBe(0);
  await win.screenshot({ path: path.join(OUT, '00-cleared.png') });

  // Restore from autosave -> teapot back.
  const restored = await win.evaluate(() => window.__studioRestoreAutosave());
  expect(restored.ok).toBe(true);
  expect(restored.primitives).toBe(1);
  const kinds = await win.evaluate(() => {
    const out = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) out.push(o.userData.archdiscStudioPrimitiveKind);
    });
    return out;
  });
  expect(kinds).toEqual(['teapot']);
  await win.screenshot({ path: path.join(OUT, '01-restored.png') });

  // Timestamp readable.
  const ts = await win.evaluate(() => window.__studioAutosaveAt());
  expect(ts, 'autosave timestamp').toBeGreaterThan(0);
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 227: autosave -> localStorage + restore working');

  await app.close();
});
