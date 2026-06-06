// Slice 751 — auto-installer for the sparse VDB-style tile store.
// Runs in parallel with `volume/autoload.js` (slice 698 dense path).
import { installVDB } from './vdbIndex.js';
Promise.resolve().then(installVDB);
