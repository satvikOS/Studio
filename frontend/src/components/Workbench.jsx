import React, { useState, useEffect } from 'react';
import { Undo2, Redo2, Search, Save, Download } from 'lucide-react';
import Topbar from './Topbar';
import StatusBarPro from './StatusBarPro';
import './StatusBarPro.css';
import WorkbenchStudio from '../workbenches/studio/WorkbenchStudio';
import AIConsole from './AIConsole';
import ProjectLibrary from './ProjectLibrary';
import ComponentInfoPanel from './ComponentInfoPanel';
import CommandPalette from './CommandPalette';
import ToastContainer from './ToastContainer';
import { RollbackBar } from './SwUxOverlays';
import './SwUxOverlays.css';
import { ViewportProvider } from '../contexts/ViewportContext';
import apiService from '../services/api';
import '../styles/workbench.css';

// Slice 946 — V3 shell is the only path. The legacy global chrome
// (header / StatusBarPro / AIConsole) is permanently suppressed; the
// Forge-style V3 shell owns the entire chrome surface. WorkbenchStudio
// hard-codes the V3 mount, so this helper is now a constant — kept as a
// function purely so the JSX call sites read identically while we wait
// for Slice D's monolith deletion pass.
function isStudioV3Active() {
  return true;
}

/**
 * Main Workbench Container
 * Layout: Header (menus + actions) | Toolbar + Viewport + Properties | Footer (AI Console)
 *
 * Tool access is consolidated in the left sidebar per workbench.
 * The Topbar provides application-level menus (File, Edit, View, Tools, Help).
 */
function WorkbenchContainer() {
    // Studio is the only workbench — this repo/app is exclusively ArchDisc
    // Studio (3D content creation: gaming / VFX / animation / design). The
    // other (Mech-inherited) workstations have been removed.
    const [isOnline, setIsOnline] = useState(true);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [toasts, setToasts] = useState([]);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [activeProjectId, setActiveProjectId] = useState(null);
    // Slice 742: when the Forge-style V3 shell is active, suppress the
    // legacy global chrome that the shell already provides itself.
    const v3Active = isStudioV3Active();
    // Rollback column visibility — driven by the live kernel HistoryLog.
    // The RollbackBar component returns null when the log is empty so we
    // collapse the grid column to 0 width to avoid an empty gap between
    // the viewport and the right Properties panel. This is the only piece
    // of state the workbench shell needs from the bar; the bar itself owns
    // expand/collapse + scrubbing.
    const [rollbackHasItems, setRollbackHasItems] = useState(false);
    const [rollbackCollapsed, setRollbackCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        try {
            return window.localStorage.getItem('archdisc.rollbackBar.collapsed') === '1';
        } catch { return false; }
    });

    // Subscribe to the kernel history-changed event so the column hides
    // when the log goes empty (and reappears when ops record). The bar
    // mirrors `__archdiscRollbackBarHasItems` on every snapshot.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const refresh = () => {
            setRollbackHasItems(!!window.__archdiscRollbackBarHasItems);
            try {
                setRollbackCollapsed(
                    window.localStorage.getItem('archdisc.rollbackBar.collapsed') === '1'
                );
            } catch { /* localStorage unavailable */ }
        };
        refresh();
        window.addEventListener('archdisc:history-changed', refresh);
        const id = setInterval(refresh, 600);  // belt-and-braces poll
        return () => {
            window.removeEventListener('archdisc:history-changed', refresh);
            clearInterval(id);
        };
    }, []);

    // Toast helper
    const addToast = (message, type = 'info', duration = 3000) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type, duration }]);
    };

    const removeToast = (id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    // Monitor online/offline status
    useEffect(() => {
        const updateOnlineStatus = () => setIsOnline(navigator.onLine);

        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);

        const checkHealth = async () => {
            try {
                await apiService.healthCheck();
                setIsOnline(true);
            } catch (error) {
                setIsOnline(false);
            }
        };

        checkHealth();
        const interval = setInterval(checkHealth, 30000);

        return () => {
            window.removeEventListener('online', updateOnlineStatus);
            window.removeEventListener('offline', updateOnlineStatus);
            clearInterval(interval);
        };
    }, []);

    // Global keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Slice 947 — Cmd+K is now owned by the V3 cmdbar (focuses
            // the Archie console + opens the floating overlay). The
            // legacy CommandPalette is dead under the V3-only shell;
            // remove the global Cmd+K handler so it doesn't poach the
            // event from StudioShellV3's CommandBar useEffect.
            // Undo: Ctrl+Z
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                handleUndo();
            }
            // Redo: Ctrl+Shift+Z or Ctrl+Y
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                handleRedo();
            }
            // Save: Ctrl+S
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undoStack, redoStack]);

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        addToast('Undo', 'info', 1500);
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        addToast('Redo', 'info', 1500);
    };

    const handleSave = () => {
        setHasUnsavedChanges(false);
        addToast('Project saved', 'success', 2000);
    };

    const renderWorkbench = () => <WorkbenchStudio />;

    // Command palette actions
    const getCommandActions = () => [
        { id: 'save', label: 'Save Project', category: 'File', shortcut: 'Ctrl+S', action: handleSave },
        { id: 'undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z', action: handleUndo },
        { id: 'redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Shift+Z', action: handleRedo },
        { id: 'export-step', label: 'Export as STEP', category: 'Export', action: () => addToast('Exporting STEP...', 'info') },
        { id: 'export-stl', label: 'Export as STL', category: 'Export', action: () => addToast('Exporting STL...', 'info') },
        { id: 'export-gltf', label: 'Export as glTF', category: 'Export', action: () => addToast('Exporting glTF...', 'info') },
        { id: 'export-obj', label: 'Export as OBJ', category: 'Export', action: () => addToast('Exporting OBJ...', 'info') },
    ];

    return (
        <ViewportProvider>
            <div className="workbench-container">
                {/* TOP HEADER - Application menus + utility actions.
                    Suppressed under V3: the Forge-style shell renders its
                    own top bar (brand + File/Edit/View menus + search +
                    undo/redo/save/export), so showing this too would stack
                    two header rows. */}
                {!v3Active && (
                <header className="workbench-header">
                    <div className="header-brand">
                        <h1 className="workbench-title">ArchDisc Studio</h1>
                        <span
                            className={`status-indicator ${isOnline ? 'online' : 'offline'}`}
                            title={isOnline ? 'Connected' : 'Offline'}
                        ></span>
                        {hasUnsavedChanges && (
                            <span className="unsaved-dot" title="Unsaved changes"></span>
                        )}
                    </div>

                    {/* Application menu bar - File, Edit, View, Tools, Help */}
                    <Topbar />

                    {/* Single-workbench identity label (no switcher — Studio is
                        the only workbench). Keeps the .workbench-current /
                        .workbench-name hooks the rest of the app + e2e rely on. */}
                    <div className="header-center">
                        <div className="workbench-current" data-archdisc-workbench="studio">
                            <span className="workbench-name">ArchDisc Studio</span>
                        </div>
                    </div>

                    <div className="header-actions">
                        <button
                            className="header-button command-palette-trigger"
                            onClick={() => setCommandPaletteOpen(true)}
                            title="Command Palette (Ctrl+K)"
                        >
                            <Search size={12} />
                            <span className="search-text">Search...</span>
                            <kbd className="search-kbd">Ctrl+K</kbd>
                        </button>
                        <div className="header-divider"></div>
                        <button
                            className="header-button icon-btn"
                            title="Undo (Ctrl+Z)"
                            onClick={handleUndo}
                            disabled={undoStack.length === 0}
                        >
                            <Undo2 size={14} />
                        </button>
                        <button
                            className="header-button icon-btn"
                            title="Redo (Ctrl+Shift+Z)"
                            onClick={handleRedo}
                            disabled={redoStack.length === 0}
                        >
                            <Redo2 size={14} />
                        </button>
                        <div className="header-divider"></div>
                        <button className="header-button icon-btn" onClick={handleSave} title="Save (Ctrl+S)">
                            <Save size={14} />
                        </button>
                        <button className="header-button icon-btn" title="Export">
                            <Download size={14} />
                        </button>
                    </div>
                </header>
                )}

                {/*
                 * STAGE — the fixed-viewport area. The 3D viewport occupies
                 * a stable rectangle inside this wrapper; the toolbar /
                 * properties / rollback drawers are absolute-positioned
                 * overlays that never push the viewport (they animate over
                 * their own reserved gutters). See
                 * `frontend/src/styles/workbench.css::.workbench-stage`.
                 *
                 * Workbench wrappers still mount the same three children
                 * (`.workbench-tools`, `.workbench-viewport`,
                 * `.workbench-properties`) — they used to be grid items at
                 * the container level; they're now absolute children of
                 * this stage element.
                 */}
                <div className="workbench-stage" data-archdisc-stage="active">
                    {renderWorkbench()}

                    {/* ROLLBACK STRIP — vertical kernel-history timeline
                        scrubber, pinned to the right gutter (between the
                        viewport and the Properties drawer) as an absolute
                        overlay. The reserved gutter width is fixed, so the
                        viewport canvas does NOT change size when the strip
                        toggles empty / collapsed / expanded. */}
                    <aside
                        className={
                            'workbench-rollback'
                            + (rollbackHasItems ? '' : ' workbench-rollback-empty')
                            + (rollbackCollapsed ? ' workbench-rollback-collapsed' : '')
                        }
                        data-archdisc-rollback-column={rollbackHasItems ? 'active' : 'empty'}
                        data-archdisc-rollback-column-collapsed={rollbackCollapsed ? 'true' : 'false'}
                    >
                        <RollbackBar />
                    </aside>
                </div>

                {/* STATUS BAR — suppressed under V3 (the shell has its own). */}
                {!v3Active && <StatusBarPro />}

                {/* BOTTOM FOOTER - AI CONSOLE (legacy Archie Chat/Code/
                    Parametric). Suppressed under V3: the Forge-style shell
                    renders its own single Archie command bar, so mounting
                    this too produced the duplicated "old + new" Archie bars. */}
                {!v3Active && <AIConsole />}

                {/* Command Palette Overlay */}
                {commandPaletteOpen && (
                    <CommandPalette
                        actions={getCommandActions()}
                        onClose={() => setCommandPaletteOpen(false)}
                    />
                )}

                {/* Toast Notifications */}
                <ToastContainer toasts={toasts} onRemove={removeToast} />
            </div>
        </ViewportProvider>
    );
}

export default WorkbenchContainer;
