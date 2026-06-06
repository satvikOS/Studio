// Slice 769 — auto-installer for the Substance Painter smart-material
// library. Idle-installs the four __studioSMat* ops on a single
// microtask so the rest of the autoload chain runs first.
import { installSMatLib } from './index.js';
Promise.resolve().then(installSMatLib);
