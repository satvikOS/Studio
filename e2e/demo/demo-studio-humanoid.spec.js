import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path'; import fs from 'fs';
const OUT = path.resolve(__dirname, 'shots', 'studio', 'humanoid');
const POSE = process.env.POSE || 'walk-stride';
test(`rigged humanoid — ${POSE}`, async () => {
  test.setTimeout(10 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 20 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen','1'); } catch(_){} }).catch(()=>{});
  await win.reload().catch(()=>{});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 25000 });
  await win.waitForFunction(() => typeof window.__studioBuildHumanoid === 'function' && typeof window.__studioRunPathTracedRender === 'function', { timeout: 25000 });
  const r = await win.evaluate(async (pose) => {
    const b = window.__studioBuildHumanoid({ sex: 'female', height: 1.72, pose });
    let posed = null; try { posed = window.__studioPoseHumanoid(pose); } catch(_){}
    let mats = null; try { mats = window.__studioLookdevMaterials(); } catch(_){}
    let out; try { out = await window.__studioRunPathTracedRender({ resolutionId: '1080p', samples: 64, envPresetId: 'studio', angle: 'hero' }); }
    catch(e){ try { out = await window.__studioRunPathTracedRender({ resolutionId:'720p', samples:32, envPresetId:'studio', angle:'hero' }); } catch(e2){ return { error:String(e2&&e2.message||e2), build:b, posed }; } }
    return { build: b, posed, applied: mats && mats.applied, w: out.width, h: out.height, dataUrl: out.dataUrl };
  }, POSE);
  if (r.dataUrl) { fs.writeFileSync(path.join(OUT, `humanoid-${POSE}.png`), Buffer.from(r.dataUrl.split(',')[1],'base64')); delete r.dataUrl; }
  console.log(`\n=== HUMANOID ${POSE}: ${JSON.stringify(r)} ===`);
  await win.evaluate(()=>{ window.__studioV3Dirty=false; window.onbeforeunload=null; }).catch(()=>{});
  await app.close();
  expect(r.error, r.error||'').toBeFalsy();
});
