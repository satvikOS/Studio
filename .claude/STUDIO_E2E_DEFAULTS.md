# Studio E2E defaults (watchable headed runs)

The user is on a Mac Studio M4 Max and watches the headed Electron
window over remote screen-share from a Windows laptop. The tests MUST
be visibly watchable — fast runs flash past too quickly over a remote
viewer.

Defaults every new Studio e2e spec should adopt:

- `slowMo: Number(process.env.STUDIO_SLOWMO) || 600` (600 ms minimum).
- Explicit `await win.waitForTimeout(700)` between user-visible state
  changes (clicks, mode flips, panel toggles).
- Sequential single-worker runs (the default playwright.config).
- Screenshots at every meaningful state under
  `e2e/screenshots/<spec-name>/NN-state.png`.
- A leading `await win.waitForTimeout(1000)` after the canvas mounts
  so the user has a beat to register that the Electron window opened.
