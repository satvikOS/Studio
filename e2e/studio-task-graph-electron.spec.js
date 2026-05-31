import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-task-graph');

test('Studio — Houdini PDG/TOPs task graph runner (slice 290)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioRunTaskGraph === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  const before = await win.evaluate(() => window.__archdiscScene.children.length);

  // Graph: spawn cube → wait 60ms (gated on spawn).
  const res = await win.evaluate(() => window.__studioRunTaskGraph({
    tasks: [
      { id: 't1', op: 'spawn', params: { kind: 'cube' } },
      { id: 't2', op: 'wait',  params: { ms: 60 }, dependsOn: ['t1'] },
    ],
  }));
  expect(res.tasks.length).toBe(2);
  const t1 = res.tasks.find(t => t.id === 't1');
  const t2 = res.tasks.find(t => t.id === 't2');
  expect(t1.status).toBe('ok');
  expect(t2.status).toBe('ok');
  expect(t1.result && t1.result.uuid).toBeTruthy();
  expect(t2.ms).toBeGreaterThanOrEqual(55);

  const after = await win.evaluate(() => window.__archdiscScene.children.length);
  expect(after).toBeGreaterThan(before);

  // Failure propagation: unknown op → dependent is skipped.
  const fail = await win.evaluate(() => window.__studioRunTaskGraph({
    tasks: [
      { id: 'a', op: 'unknownOp' },
      { id: 'b', op: 'wait', params: { ms: 30 }, dependsOn: ['a'] },
    ],
  }));
  expect(fail.tasks.find(t => t.id === 'a').status).toBe('error');
  expect(fail.tasks.find(t => t.id === 'b').status).toBe('skipped');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2000);

  // eslint-disable-next-line no-console
  console.log('  slice 290: task graph ran 2 tasks ok; skipped dependent on error');

  await app.close();
});
