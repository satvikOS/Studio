// ArchDisc Studio — preload script.
//
// Slice 951h — bridges auto-update IPC events from the Electron main
// process to the React renderer via contextBridge (renderer runs with
// contextIsolation:true + nodeIntegration:false, so ipcRenderer is not
// directly available). main.js sends `update:available` / `update:
// progress` / `update:downloaded` to webContents; the renderer listens
// via window.studioUpdater.

const { contextBridge, ipcRenderer } = require('electron');

const _listeners = new Set();
const _forward = (channel, payload) => {
  for (const l of _listeners) {
    try { l(channel, payload); } catch (_) { /* swallow listener errors */ }
  }
};

ipcRenderer.on('update:available',  (_e, payload) => _forward('update:available',  payload));
ipcRenderer.on('update:progress',   (_e, payload) => _forward('update:progress',   payload));
ipcRenderer.on('update:downloaded', (_e, payload) => _forward('update:downloaded', payload));
ipcRenderer.on('update:error',      (_e, payload) => _forward('update:error',      payload));

contextBridge.exposeInMainWorld('studioUpdater', {
  // Subscribe to update lifecycle events. Returns an unsubscribe fn.
  // The callback signature is (channel, payload) where channel is one
  // of 'update:available' | 'update:progress' | 'update:downloaded' |
  // 'update:error'.
  onUpdate(cb) {
    if (typeof cb !== 'function') return () => {};
    _listeners.add(cb);
    return () => _listeners.delete(cb);
  },
  // Trigger an immediate install of a downloaded update (restarts the
  // app). Safe to call when no update is queued (no-ops in main).
  quitAndInstall() {
    ipcRenderer.send('update:quit-and-install');
  },
});
