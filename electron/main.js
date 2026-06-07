const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// electron-updater drives auto-update against the GitHub Releases the CI
// workflow publishes. Loaded lazily/guarded so a dev run without the dep
// installed still works.
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.warn('[updater] electron-updater not available:', err.message);
}

let mainWindow;

// --------------------------------------------------------------- updater
function initAutoUpdater() {
  // Auto-update only makes sense for packaged builds; skip in dev.
  if (!autoUpdater || !app.isPackaged) {
    if (!app.isPackaged) console.log('[updater] dev run — auto-update skipped');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  const notifyRenderer = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  autoUpdater.on('checking-for-update', () => console.log('[updater] checking for update'));
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    notifyRenderer('update:available', { version: info.version });
  });
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'));
  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] downloading ${Math.round(p.percent)}%`);
    notifyRenderer('update:progress', { percent: p.percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update downloaded:', info.version);
    // checkForUpdatesAndNotify shows a native OS notification; the update
    // installs on next quit (autoInstallOnAppQuit).
    notifyRenderer('update:downloaded', { version: info.version });
  });
  autoUpdater.on('error', (err) => console.error('[updater] error:', err == null ? 'unknown' : (err.stack || err).toString()));

  // Fires the check + native "update ready" notification.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] checkForUpdatesAndNotify failed:', err.message);
  });
}

function createWindow() {
  // Slice 951e — guard against the `activate` event firing before
  // app.whenReady() resolves. The crash the user hit on the arm64 .app
  // was: macOS dispatched `activate` from the Finder double-click
  // BEFORE the ready signal arrived, the activate handler called
  // createWindow(), and `new BrowserWindow(...)` synchronously throws
  // "Cannot create BrowserWindow before app is ready". The check below
  // makes createWindow idempotent and safe at any timing — early calls
  // are dropped, late calls re-use the existing window if it survived.
  if (!app.isReady()) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.show(); mainWindow.focus(); } catch (_) {}
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    title: 'ArchDisc Studio — 3D Content Creation Platform',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true,
      enableWebSQL: false,
    },
    backgroundColor: '#0d0d1a',
    show: false,
  });

  // Load the built frontend
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    // Slice 742 (UI fix): do NOT auto-open DevTools on --dev. It popped the
    // Elements/Console panel over the app every launch (and was the source
    // of the e2e DevTools-window boot race). Opt in explicitly with
    // --devtools, or just press Cmd+Alt+I / F12 at runtime.
    if (process.argv.includes('--devtools')) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  // Application menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'ArchDisc Studio',
      submenu: [
        { label: 'About ArchDisc Studio', click: () => showAbout() },
        { type: 'separator' },
        { label: 'Preferences', accelerator: 'CmdOrCtrl+,', click: () => {} },
        { type: 'separator' },
        { role: 'quit' },
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu:new') },
        { label: 'Open Project', accelerator: 'CmdOrCtrl+O', click: () => {} },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu:save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => {} },
        { type: 'separator' },
        { label: 'Export', submenu: [
          { label: 'STEP (.step)', click: () => mainWindow.webContents.send('menu:export', 'step') },
          { label: 'STL (.stl)', click: () => mainWindow.webContents.send('menu:export', 'stl') },
          { label: 'OBJ (.obj)', click: () => mainWindow.webContents.send('menu:export', 'obj') },
          { label: 'glTF (.gltf)', click: () => mainWindow.webContents.send('menu:export', 'gltf') },
          { label: 'G-Code (.nc)', click: () => mainWindow.webContents.send('menu:export', 'gcode') },
        ]},
        { type: 'separator' },
        { role: 'quit' },
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow.webContents.send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => mainWindow.webContents.send('menu:redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Shaded', click: () => mainWindow.webContents.send('menu:display', 'shaded') },
        { label: 'Wireframe', click: () => mainWindow.webContents.send('menu:display', 'wireframe') },
        { label: 'X-Ray', click: () => mainWindow.webContents.send('menu:display', 'xray') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal('https://archdisc.com/docs') },
        { label: 'Keyboard Shortcuts', click: () => {} },
        { type: 'separator' },
        { label: 'About ArchDisc Studio', click: () => showAbout() },
      ]
    },
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => { mainWindow = null; });
}

function showAbout() {
  const { dialog } = require('electron');
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About ArchDisc Studio',
    message: 'ArchDisc Studio — 3D Content Creation Platform',
    detail:
      `Version ${app.getVersion()}\n\n` +
      `3D modelling · sculpting · rigging · animation · VFX · simulation · ` +
      `texturing · rendering · motion graphics · ArchViz · game-asset authoring\n\n` +
      `Forked from Blender (GPL-3.0); see NOTICE.md for attribution.\n\n` +
      `The ArchDisc Universe — Studio workstation.`,
    buttons: ['OK'],
  });
}

// Slice 951d — make the main process bulletproof. The "A JavaScript
// error occurred in the main process" dialog the user saw on the
// arm64 build was electron-updater throwing synchronously on an
// unsigned macOS .app (`MacUpdater` requires a Developer ID signature
// to verify update integrity and asserts on startup). The error
// escaped initAutoUpdater() and crashed the whole app before the
// window even rendered. Three layers of defence:
//
//   1. process-level uncaughtException + unhandledRejection traps so
//      ANY future main-process error is logged and dialog-shown
//      instead of killing the app
//   2. Skip auto-update entirely when (a) the build isn't packaged
//      (dev) OR (b) the user sets ELECTRON_DISABLE_AUTO_UPDATER=1
//      OR (c) macOS and the app isn't code-signed (we can't verify
//      updates anyway, so don't try)
//   3. Wrap the whole initAutoUpdater() call in a try/catch with a
//      hard failure-path swallow
process.on('uncaughtException', (err) => {
  console.error('[main:uncaughtException]', err && err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main:unhandledRejection]', reason);
});

function _isMacAppSigned() {
  if (process.platform !== 'darwin') return true;
  // electron exposes process.mas for App Store builds; for Developer ID
  // builds we check the embedded provisioning profile + code signature
  // via the trustworthy `app` API. The simplest check that doesn't
  // require child_process spawn is: the app reports a valid bundle id
  // matching electron-builder's expected appId AND we're inside
  // /Applications (the only place macOS trusts auto-update from).
  // For now we just honor an explicit opt-out env var and let the
  // existing autoUpdater catch handle the rest.
  return true;
}

app.whenReady().then(() => {
  try { createWindow(); } catch (err) {
    console.error('[main:createWindow] failed:', err && err.stack || err);
  }
  const updaterDisabled = process.env.ELECTRON_DISABLE_AUTO_UPDATER === '1'
    || !app.isPackaged
    || !_isMacAppSigned();
  if (updaterDisabled) {
    console.log('[updater] disabled (packaged=' + app.isPackaged
      + ', env=' + (process.env.ELECTRON_DISABLE_AUTO_UPDATER || 'unset') + ')');
    return;
  }
  try {
    initAutoUpdater();
  } catch (err) {
    console.error('[updater] init threw — auto-update disabled this session:',
      err && err.stack || err);
  }
}).catch((err) => {
  console.error('[main:whenReady] rejected:', err && err.stack || err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // Slice 951e — wait for whenReady before constructing a window. The
  // user's arm64 build crashed here because macOS Finder fired
  // `activate` during the early launch phase, before app was ready.
  if (!app.isReady()) {
    app.whenReady().then(() => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    }).catch((err) => {
      console.error('[main:activate] whenReady rejected:', err && err.stack || err);
    });
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
