import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-autosave-ts');

test('Studio — autosave timestamp surfaces in N-panel View (slice 262)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSaveScene === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);
  // Initial state: never.
  await expect(win.locator('[data-studio-npanel-autosave-ts]')).toHaveText('never');

  // Build a teapot so saveScene has content + write an autosave.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'autosave ts demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [4, 4, 4], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(500);

  // Trigger an autosave by hand (the 30 s interval is too slow for a spec).
  await win.evaluate(() => {
    const json = window.__studioSaveScene();
    window.localStorage.setItem('archdisc.studio.autosave', json);
    window.localStorage.setItem('archdisc.studio.autosave.ts', String(Date.now()));
  });
  // Force a re-render of the N-panel so the IIFE reads the new ts.
  await win.evaluate(() => {
    // bump primitiveCount via __studioSelectMesh (no-op selection).
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'teapot') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);

  const txt = await win.locator('[data-studio-npanel-autosave-ts]').textContent();
  expect(txt, 'autosave timestamp is a time string').not.toBe('never');
  expect(txt, 'looks like HH:MM:SS something').toMatch(/\d/);
  await win.screenshot({ path: path.join(OUT, '00-ts.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 262: autosave ts read as', txt);

  await app.close();
});
