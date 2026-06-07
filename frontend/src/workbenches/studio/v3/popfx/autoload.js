// Slice 777 — auto-installer for Houdini POPs (Particle Operators).
//
// Wires the window.__studioPop* surface inside the V3 shell.
import { installPopFX } from './index.js';
Promise.resolve().then(installPopFX);
