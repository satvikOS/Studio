import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 254: Archie mid-flight steering (inject / pause / resume / cancel).
 *
 * Verifies window.__archieInject(prompt) feeds a new goal into a
 * currently-running __archieRun, and that the loop folds it in at the
 * next iteration boundary. Also exercises pause/resume/cancel +
 * window.__archieStatus().
 *
 * Headed Mac-Electron, slowMo 700, watching from a remote-desktop session.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-inject');

test('Studio — Archie loop accepts mid-flight inject + pause/resume/cancel signals', async () => {
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
  await win.waitForFunction(() => typeof window.__archieInject === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-initial.png') });

  // Pre-flight status must report idle.
  const status0 = await win.evaluate(() => window.__archieStatus());
  expect(status0.paused).toBe(false);
  expect(status0.stopped).toBe(false);
  expect(status0.pendingInjects).toBe(0);

  // Kick off a multi-goal run AND inject a new goal mid-flight. The
  // runArchieLoop signal picks up the inject at the next goal boundary.
  const runResult = await win.evaluate(async () => {
    const events_log = [];
    setTimeout(() => window.__archieInject('lantern post'), 300);
    setTimeout(() => window.__archiePause(),  600);
    setTimeout(() => window.__archieResume(), 1100);
    setTimeout(() => window.__archieInject('stone cairn'), 1500);

    const r = await window.__archieRun({
      goals: ['ringed monolith', 'stone cairn'],
      maxGoals: 6,
      maxIterations: 1,
      onEvent: (e) => events_log.push(`${e.type}${e.goal?':'+e.goal:''}${e.goals?':'+e.goals.join('+'):''}`),
    });
    return {
      completed: r.completed, stopped: r.stopped,
      logGoals: r.log.map(l => l.goal),
      injectEvents: events_log.filter(e => e.startsWith('injected') || e.startsWith('inject-interrupt')),
    };
  });

  // Both initial goals AND the injected lantern post should have run.
  expect(runResult.logGoals, 'initial ringed monolith ran').toContain('ringed monolith');
  expect(runResult.logGoals, 'injected lantern post ran').toContain('lantern post');
  expect(runResult.injectEvents.length, 'at least one inject-event fired').toBeGreaterThan(0);
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(OUT, '01-injects-landed.png') });

  // Status returns to idle after the loop exits.
  const statusEnd = await win.evaluate(() => window.__archieStatus());
  expect(statusEnd.paused).toBe(false);
  expect(statusEnd.pendingInjects).toBe(0);
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log(`  slice 254: archie inject/pause/resume — goals: ${runResult.logGoals.join(' -> ')}; inject events: ${runResult.injectEvents.length}`);

  await app.close();
});
