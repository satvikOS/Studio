import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951l — natural chat output verification.
//
// User said: "make sure the output in the chat window is natural"
// — the overlay was showing raw <plan>{...}</plan> and per-call
// `click-primitive({"id":"cube"}) → spawn cube` dispatch lines. Now
// the Archie message is humanized (tags stripped, markdown collapsed)
// and each tool message reads as a friendly sentence ("Added a cube.").
//
// This spec injects a complex prompt, waits for dispatch, and asserts:
//   1. The Archie message contains NO <plan> / <tool_call> / <think>
//      protocol tags
//   2. Tool messages don't start with `click-primitive(...)` or
//      `dispatch source:` boilerplate
//   3. At least one tool message reads as natural prose

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951l-natural-chat');

test('Studio slice 951l — chat overlay reads naturally, no protocol tags', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 200,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.setItem('studioV3Theme', 'dark');
    window.localStorage.removeItem('studio.v3.display-toggles');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(700);

  // Mock AFTER reload so the property survives.
  await win.evaluate(() => {
    window.__studioArchieMock = () => [
      '<plan>{goal=studio,scene=coffee_table,bodies=5,expect=boolean_union}</plan>',
      '',
      '### Step-by-Step Explanation:',
      '',
      '1. **Switch to Modeling Discipline**:',
      '   - Click on the "modeling" tab to start creating the coffee table.',
      '',
      '2. **Spawn a Cube** for the tabletop.',
      '3. **Spawn Cylinders** for the four legs.',
    ].join('\n');
  });

  // Fire the prompt.
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('model a beautiful coffee table');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
  await win.waitForTimeout(1200);
  await win.screenshot({ path: path.join(OUT, '01-after-prompt.png') });

  // Pull every overlay message text — JUST the message text span, not
  // the role label that prefixes it in the rendered DOM.
  const msgs = await win.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-studio-v3-archie-msg]'))
      .map((el) => {
        const textSpan = el.querySelector('.studio-archie-overlay-msg-text');
        return {
          role: el.getAttribute('data-role'),
          text: ((textSpan ? textSpan.textContent : el.textContent) || '').trim(),
        };
      });
  });
  console.log('--- overlay messages ---');
  for (const m of msgs) console.log(`[${m.role}]`, m.text.slice(0, 240));

  // 1. Archie message has zero protocol tags.
  const archieMsg = msgs.find((m) => m.role === 'archie');
  expect(archieMsg).toBeTruthy();
  if (archieMsg) {
    expect(archieMsg.text).not.toMatch(/<plan>|<\/plan>/i);
    expect(archieMsg.text).not.toMatch(/<tool_call>|<\/tool_call>/i);
    expect(archieMsg.text).not.toMatch(/<think>|<\/think>/i);
  }

  // 2. Tool messages don't show raw `click-primitive(...)` form or
  //    `dispatch source:` boilerplate.
  const toolMsgs = msgs.filter((m) => m.role === 'tool');
  for (const t of toolMsgs) {
    expect(t.text).not.toMatch(/^click-(primitive|action|discipline)\(/);
    expect(t.text).not.toMatch(/dispatch source:/i);
  }

  // 3. At least one tool message reads as a sentence (starts uppercase,
  //    ends with a full stop).
  const sentenceLike = toolMsgs.filter((t) => /^[A-Z].*\.\s*$/.test(t.text));
  expect(sentenceLike.length).toBeGreaterThanOrEqual(1);

  await win.evaluate(() => {
    delete window.__studioArchieMock;
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
