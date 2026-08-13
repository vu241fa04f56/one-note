import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  NotebookData,
  SectionData,
  PageData,
  ToolSettings,
  ViewMode,
  Annotation,
  PaperTemplate,
  TableAnnotation,
  ImageAnnotation,
} from './types';
import {
  seedInitialDataIfNeeded,
  saveNotebook,
  deleteNotebookFromDB,
  saveSection,
  deleteSectionFromDB,
  saveSettings,
  loadSettings,
  savePdfBuffer,
} from './lib/db';
import { Sidebar } from './components/Sidebar';
import { HeaderBar } from './components/HeaderBar';
import { StylusToolbar } from './components/StylusToolbar';
import { CanvasWorkspace } from './components/CanvasWorkspace';
import { ContinuousDocumentView } from './components/ContinuousDocumentView';
import { GridOverview } from './components/GridOverview';
import { PageManagerModal } from './components/PageManagerModal';
import { ImportPdfModal } from './components/ImportPdfModal';
import { ExportModal } from './components/ExportModal';
import { ShareModal } from './components/ShareModal';
import { DriveOpenModal } from './components/DriveOpenModal';
import { decodeSharePayload } from './lib/shareUtils';
import { saveNotebookToGoogleDrive, SavedNotebookPayload, loadNotebookFromDrive } from './lib/googleDrive';
import { generateAnnotatedPdf, loadPdfDocumentFromStore } from './lib/pdfUtils';
import { Tv, ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Loader2, Eye, CloudCheck, Download, PanelLeftOpen, PanelLeftClose, PanelTopOpen, PanelTopClose, Maximize2 } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { LoginPage } from './components/LoginPage';
import { TransferMeter } from './components/TransferMeter';

export default function App() {
  const { isAuthenticated, isLoading, user, logout, driveToken, setDriveToken, promptGoogleLoginAndDrive } = useAuth();

  // Navigation & Data State
  const [notebooks, setNotebooks] = useState<NotebookData[]>([]);
  const [sections, setSections] = useState<SectionData[]>([]);
  const sectionsRef = useRef<SectionData[]>([]);
  const activeSectionIdRef = useRef('');
  const [activeNotebookId, setActiveNotebookId] = useState<string>('');
  const [activeSectionId, setActiveSectionId] = useState<string>('');
  const [activePageId, setActivePageId] = useState<string>('');
  sectionsRef.current = sections;
  activeSectionIdRef.current = activeSectionId;
  const [isReadMode, setIsReadMode] = useState<boolean>(false);

  // Shared Link & Drive Sync State
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [showDriveOpenModal, setShowDriveOpenModal] = useState<boolean>(false);
  const [isSharedViewOnly, setIsSharedViewOnly] = useState<boolean>(false);
  const [driveSyncStatus, setDriveSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [driveTransfer, setDriveTransfer] = useState<{ label: string; done: number; total: number; speed: number; eta: number | null } | null>(null);
  const driveTransferRef = useRef({ label: '', done: 0, at: 0, speed: 0 });

  // UI Views & Modals
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isUpperPanelHidden, setIsUpperPanelHidden] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>('continuous');
  const [zoomScale, setZoomScale] = useState(1.0);

  const [showPageManager, setShowPageManager] = useState(false);
  const [showImportPdfModal, setShowImportPdfModal] = useState(false);
  const [importTargetInsertIndex, setImportTargetInsertIndex] = useState<number | undefined>(undefined);
  const [showExportModal, setShowExportModal] = useState(false);

  // Undo / Redo History Stack per page
  const [history, setHistory] = useState<{ [pageId: string]: Annotation[][] }>({});
  const [historyIndex, setHistoryIndex] = useState<{ [pageId: string]: number }>({});
  // Refs make undo/redo synchronous and immune to React's batched state updates.
  // This is important when users tap Undo/Redo repeatedly while drawing.
  const historyRef = useRef<{ [pageId: string]: Annotation[][] }>({});
  const historyIndexRef = useRef<{ [pageId: string]: number }>({});
  const MAX_HISTORY_STEPS = 100;

  // Tool Settings
  const [settings, setSettings] = useState<ToolSettings>({
    activeTool: 'pen',
    penColor: '#000000',
    penWidth: 2,
    highlighterColor: '#FDE047',
    highlighterWidth: 20,
    eraserType: 'stroke',
    eraserWidth: 15,
    shapeType: 'rectangle',
    shapeStrokeColor: '#000000',
    shapeFillColor: 'transparent',
    shapeWidth: 2,
    shapeIsDashed: false,
    textColor: '#000000',
    textSize: 18,
    paperTemplate: 'grid',
    lineDarkness: 40,
    paperDarkness: 0,
    palmRejection:false,
    snapToStraightLine: false,
  });

  // 1. Initial Load from IndexedDB & Share URL check
  useEffect(() => {
    async function initDB() {
      // Check for share payload in URL hash
      const hash = window.location.hash;
      if (hash && hash.includes('share=')) {
        const match = hash.match(/share=([^&]+)/);
        if (match && match[1]) {
          const decoded = decodeSharePayload(match[1]);
          if (decoded && decoded.notebook) {
            setIsSharedViewOnly(true);
            setNotebooks([decoded.notebook]);
            setSections(decoded.sections);
            setActiveNotebookId(decoded.notebook.id);
            if (decoded.sections.length > 0) {
              setActiveSectionId(decoded.sections[0].id);
              if (decoded.sections[0].pages && decoded.sections[0].pages.length > 0) {
                setActivePageId(decoded.sections[0].pages[0].id);
              }
            }
            const savedSet = await loadSettings();
            if (savedSet) setSettings(savedSet);
            return;
          }
        }
      }

      const data = await seedInitialDataIfNeeded();
      setNotebooks(data.notebooks);
      setSections(data.sections);

      if (data.notebooks.length > 0) {
        setActiveNotebookId(data.notebooks[0].id);
        const matchingSecs = data.sections.filter((s) => s.notebookId === data.notebooks[0].id);
        if (matchingSecs.length > 0) {
          setActiveSectionId(matchingSecs[0].id);
          if (matchingSecs[0].pages && matchingSecs[0].pages.length > 0) {
            setActivePageId(matchingSecs[0].pages[0].id);
          }
        }
      }

      const savedSet = await loadSettings();
      if (savedSet) {
        setSettings(savedSet);
      }
    }

    initDB();
  }, []);

  // Request Google OAuth Drive Token helper
  const promptForDriveToken = useCallback(
    (onSuccess?: (token: string) => void) => {
      promptGoogleLoginAndDrive(
        onSuccess,
        (err) => {
          alert(err || 'Failed to connect to Google Drive. Please try again.');
        }
      );
    },
    [promptGoogleLoginAndDrive]
  );

  // Hide and show both panels simultaneously
  const handleHideBothPanels = useCallback(() => {
    setIsSidebarOpen(false);
    setIsUpperPanelHidden(true);
  }, []);

  const handleShowBothPanels = useCallback(() => {
    setIsSidebarOpen(true);
    setIsUpperPanelHidden(false);
  }, []);

  // Keyboard shortcut Ctrl+Shift+H to toggle both panels simultaneously
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        if (!isSidebarOpen && isUpperPanelHidden) {
          handleShowBothPanels();
        } else {
          handleHideBothPanels();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen, isUpperPanelHidden, handleHideBothPanels, handleShowBothPanels]);

  // Load notebook payload from Drive or local file
  const handleLoadNotebookPayload = useCallback(
    async (payload: SavedNotebookPayload) => {
      if (!payload || !payload.notebook) return;

      // Save notebook to IndexedDB
      await saveNotebook(payload.notebook);

      // Save sections to IndexedDB
      if (payload.sections && payload.sections.length > 0) {
        for (const sec of payload.sections) {
          await saveSection(sec);
        }
      }

      // Restore PDF background buffers into IndexedDB if bundled in Google Drive payload
      if (payload.pdfBuffersMap) {
        for (const [pdfId, info] of Object.entries(payload.pdfBuffersMap)) {
          if (info && info.base64) {
            try {
              const binaryString = atob(info.base64);
              const len = binaryString.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              await savePdfBuffer(pdfId, info.filename, bytes.buffer, info.pageCount || 1);
            } catch (err) {
              console.warn('[App] Failed to restore PDF buffer from Drive payload:', pdfId, err);
            }
          }
        }
      }

      // Update state
      setNotebooks((prev) => {
        const filtered = prev.filter((n) => n.id !== payload.notebook.id);
        return [payload.notebook, ...filtered];
      });

      setSections((prev) => {
        const incomingIds = new Set(payload.sections.map((s) => s.id));
        const remaining = prev.filter((s) => !incomingIds.has(s.id));
        return [...payload.sections, ...remaining];
      });

      setActiveNotebookId(payload.notebook.id);
      if (payload.sections.length > 0) {
        setActiveSectionId(payload.sections[0].id);
        if (payload.sections[0].pages && payload.sections[0].pages.length > 0) {
          setActivePageId(payload.sections[0].pages[0].id);
        }
      }
    },
    []
  );

  // Save active notebook into user's Google Drive (Colab-style visible PDF + notebook backup)
  const handleSaveToDrive = useCallback(async () => {
    const currentNotebook = notebooks.find((n) => n.id === activeNotebookId);
    if (!currentNotebook) return;
    const matchingSections = sections.filter((s) => s.notebookId === currentNotebook.id);
    const allPages = matchingSections.flatMap((s) => s.pages || []);

    const performUpload = async (token: string) => {
      setDriveSyncStatus('saving');
      setDriveTransfer(null);
      driveTransferRef.current = { label: '', done: 0, at: performance.now(), speed: 0 };
      try {
        // If the notebook is still a single untouched PDF, upload the source
        // bytes directly. This bypasses a 3000-page raster export entirely.
        const sourcePdfId = allPages[0]?.pdfId;
        const canDirectSyncSource = Boolean(
          sourcePdfId &&
          allPages.length > 0 &&
          allPages.every((p, index) =>
            p.pdfId === sourcePdfId &&
            p.pdfPageNumber === index + 1 &&
            (!p.annotations || p.annotations.length === 0)
          )
        );

        let pdfBlob: Blob | undefined;
        if (!canDirectSyncSource) {
          pdfBlob = await generateAnnotatedPdf(
            allPages,
            currentNotebook.title,
            undefined,
            undefined,
            async (pdfId) => loadPdfDocumentFromStore(pdfId)
          );
        }

        const result = await saveNotebookToGoogleDrive(
          token,
          currentNotebook,
          matchingSections,
          pdfBlob,
          undefined,
          (done, total, label) => {
            const now = performance.now();
            const prev = driveTransferRef.current;
            const sameTransfer = prev.label === label;
            const dt = (now - prev.at) / 1000;
            const delta = done - (sameTransfer ? prev.done : 0);
            const instant = dt > 0.2 && delta > 0 ? delta / dt : 0;
            const speed = instant > 0 ? (prev.speed > 0 && sameTransfer ? prev.speed * 0.65 + instant * 0.35 : instant) : prev.speed;
            driveTransferRef.current = { label, done, at: now, speed };
            setDriveTransfer({ label, done, total, speed, eta: speed > 0 ? Math.max(0, (total - done) / speed) : null });
          },
          canDirectSyncSource ? sourcePdfId : undefined
        );
        if (result.success) {
          setDriveSyncStatus('saved');
          setDriveTransfer((prev) => prev ? { ...prev, done: prev.total, speed: prev.speed, eta: 0 } : prev);
          if (result.webViewLink) {
            window.open(result.webViewLink, '_blank');
          }
          setTimeout(() => setDriveSyncStatus('idle'), 4000);
        } else {
          setDriveSyncStatus('error');
          setDriveTransfer(null);
          alert(`Google Drive save failed: ${result.error || 'Unknown error'}`);
        }
      } catch (err) {
        console.error('[App] Error saving PDF to Drive:', err);
        setDriveSyncStatus('error');
        setDriveTransfer(null);
      }
    };

    if (!driveToken) {
      promptForDriveToken((token) => performUpload(token));
      return;
    }

    if (driveToken) {
      await performUpload(driveToken);
    }
  }, [notebooks, activeNotebookId, sections, driveToken, promptForDriveToken]);

  // Import shared read-only notebook clone into user's local workspace
  const handleImportSharedCopy = async () => {
    const activeNotebook = notebooks.find((n) => n.id === activeNotebookId);
    if (!activeNotebook) return;
    const matchingSections = sections.filter((s) => s.notebookId === activeNotebook.id);

    const newNbId = 'nb_' + Date.now();
    const clonedNb: NotebookData = {
      ...activeNotebook,
      id: newNbId,
      title: `${activeNotebook.title} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const clonedSections: SectionData[] = matchingSections.map((sec) => ({
      ...sec,
      id: 'sec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      notebookId: newNbId,
    }));

    await saveNotebook(clonedNb);
    for (const sec of clonedSections) {
      await saveSection(sec);
    }

    window.history.replaceState(null, '', window.location.pathname);
    setIsSharedViewOnly(false);
    const data = await seedInitialDataIfNeeded();
    setNotebooks(data.notebooks);
    setSections(data.sections);
    setActiveNotebookId(newNbId);
  };

  // Active section and page objects
  const activeSection = sections.find((s) => s.id === activeSectionId);
  const activeNotebook = notebooks.find((n) => n.id === activeNotebookId);
  const activePage = activeSection?.pages?.find((p) => p.id === activePageId);
  const activePageIndex = activeSection?.pages ? Math.max(0, activeSection.pages.findIndex((p) => p.id === activePageId)) : 0;

  // Synchronize section updates to IndexedDB and State
  const updateSectionInStateAndDB = (updatedSection: SectionData) => {
    setSections((prev) =>
      prev.map((s) => (s.id === updatedSection.id ? updatedSection : s))
    );
    saveSection(updatedSection);
  };

  // Auto save settings change
  const handleUpdateSettings = (newPartial: Partial<ToolSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newPartial };
      saveSettings(updated);
      return updated;
    });

    if (activeSection && activePageId) {
      if (
        'paperTemplate' in newPartial ||
        'lineDarkness' in newPartial ||
        'paperDarkness' in newPartial
      ) {
        const updatedPages = activeSection.pages.map((p) => {
          if (p.id === activePageId) {
            return {
              ...p,
              ...(newPartial.paperTemplate ? { paperTemplate: newPartial.paperTemplate } : {}),
              ...(newPartial.lineDarkness !== undefined ? { lineDarkness: newPartial.lineDarkness } : {}),
              ...(newPartial.paperDarkness !== undefined ? { paperDarkness: newPartial.paperDarkness } : {}),
            };
          }
          return p;
        });
        updateSectionInStateAndDB({ ...activeSection, pages: updatedPages });
      }
    }
  };

  // Initialize an undo baseline for every page as soon as it becomes active.
  // Without this baseline the toolbar can remain disabled until a second edit.
  useEffect(() => {
    if (!activePageId || !activeSection) return;
    if (historyRef.current[activePageId]) return;

    const baseline = activeSection.pages.find((p) => p.id === activePageId)?.annotations || [];
    historyRef.current[activePageId] = [baseline];
    historyIndexRef.current[activePageId] = 0;
    setHistory((prev) => ({ ...prev, [activePageId]: [baseline] }));
    setHistoryIndex((prev) => ({ ...prev, [activePageId]: 0 }));
  }, [activePageId, activeSection?.id]);

  const applyAnnotationsToPage = useCallback((pageId: string, newAnnotations: Annotation[]) => {
    setSections((prev) => {
      const section = prev.find((s) => s.id === activeSectionIdRef.current);
      if (!section || !section.pages.some((p) => p.id === pageId)) return prev;
      const updatedPages = section.pages.map((p) =>
        p.id === pageId ? { ...p, annotations: newAnnotations, updatedAt: Date.now() } : p
      );
      const updatedSection = { ...section, pages: updatedPages };
      void saveSection(updatedSection);
      return prev.map((s) => (s.id === updatedSection.id ? updatedSection : s));
    });
  }, []);

  // Update annotations and push a single snapshot per completed user action.
  // The history is capped so thousands of pages/actions cannot create an
  // unbounded RAM object.
  const handleUpdatePageAnnotations = useCallback(
    (pageId: string, newAnnotations: Annotation[]) => {
      const pageObj = sectionsRef.current
        .find((s) => s.id === activeSectionIdRef.current)
        ?.pages.find((p) => p.id === pageId);
      if (!pageObj) return;

      let pageHistory = historyRef.current[pageId];
      if (!pageHistory || pageHistory.length === 0) {
        pageHistory = [pageObj.annotations || []];
      }

      const currentIdx = historyIndexRef.current[pageId] ?? (pageHistory.length - 1);
      const currentState = pageHistory[currentIdx];
      // Ignore accidental duplicate snapshots.
      if (currentState === newAnnotations) return;

      const truncated = pageHistory.slice(0, currentIdx + 1);
      let nextStack = [...truncated, newAnnotations];
      if (nextStack.length > MAX_HISTORY_STEPS) {
        nextStack = nextStack.slice(nextStack.length - MAX_HISTORY_STEPS);
      }
      const nextIndex = nextStack.length - 1;

      historyRef.current[pageId] = nextStack;
      historyIndexRef.current[pageId] = nextIndex;
      setHistory((prev) => ({ ...prev, [pageId]: nextStack }));
      setHistoryIndex((prev) => ({ ...prev, [pageId]: nextIndex }));

      applyAnnotationsToPage(pageId, newAnnotations);
    },
    [applyAnnotationsToPage]
  );

  // Calculate Undo / Redo availability from synchronous refs.
  const activePageHistory = history[activePageId] || historyRef.current[activePageId] || [];
  const activePageHistoryIdx =
    historyIndex[activePageId] ?? historyIndexRef.current[activePageId] ?? (activePageHistory.length - 1);

  const canUndo = activePageHistory.length > 1 && activePageHistoryIdx > 0;
  const canRedo = activePageHistory.length > 1 && activePageHistoryIdx < activePageHistory.length - 1;

  const handleUndo = useCallback(() => {
    if (!activePageId) return;
    const pageHistory = historyRef.current[activePageId];
    if (!pageHistory || pageHistory.length < 2) return;

    const currentIdx = historyIndexRef.current[activePageId] ?? (pageHistory.length - 1);
    if (currentIdx <= 0) return;

    const prevIdx = currentIdx - 1;
    const prevAnnotations = pageHistory[prevIdx] || [];
    historyIndexRef.current[activePageId] = prevIdx;
    setHistoryIndex((prev) => ({ ...prev, [activePageId]: prevIdx }));
    applyAnnotationsToPage(activePageId, prevAnnotations);
  }, [activePageId, applyAnnotationsToPage]);

  const handleRedo = useCallback(() => {
    if (!activePageId) return;
    const pageHistory = historyRef.current[activePageId];
    if (!pageHistory || pageHistory.length < 2) return;

    const currentIdx = historyIndexRef.current[activePageId] ?? (pageHistory.length - 1);
    if (currentIdx >= pageHistory.length - 1) return;

    const nextIdx = currentIdx + 1;
    const nextAnnotations = pageHistory[nextIdx] || [];
    historyIndexRef.current[activePageId] = nextIdx;
    setHistoryIndex((prev) => ({ ...prev, [activePageId]: nextIdx }));
    applyAnnotationsToPage(activePageId, nextAnnotations);
  }, [activePageId, applyAnnotationsToPage]);

  // Keyboard Shortcuts (Must run unconditionally before early returns)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isReadMode) {
        setIsReadMode(false);
        return;
      }

      // Ignore if user is typing in input or textarea or contentEditable element
      const targetEl = e.target as HTMLElement;
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetEl?.tagName) ||
        targetEl?.isContentEditable
      ) {
        return;
      }

      if (isReadMode) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          const pages = activeSection?.pages || [];
          const idx = pages.findIndex((p) => p.id === activePageId);
          if (idx < pages.length - 1) setActivePageId(pages[idx + 1].id);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          const pages = activeSection?.pages || [];
          const idx = pages.findIndex((p) => p.id === activePageId);
          if (idx > 0) setActivePageId(pages[idx - 1].id);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key.toLowerCase() === 'p') {
        handleUpdateSettings({ activeTool: 'pen' });
      } else if (e.key.toLowerCase() === 'h') {
        handleUpdateSettings({ activeTool: 'highlighter' });
      } else if (e.key.toLowerCase() === 'e') {
        handleUpdateSettings({ activeTool: 'eraser' });
      } else if (e.key.toLowerCase() === 's') {
        handleUpdateSettings({ activeTool: 'shape' });
      } else if (e.key.toLowerCase() === 't') {
        handleUpdateSettings({ activeTool: 'text' });
      } else if (e.key.toLowerCase() === 'z') {
        handleUpdateSettings({ activeTool: 'pan' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, isReadMode, activeSection, activePageId]);

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-slate-300 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
        <p className="text-sm text-slate-400">Loading your workspace...</p>
      </div>
    );
  }

  if (!isAuthenticated && !isSharedViewOnly) {
    return <LoginPage />;
  }

  // Clear all annotations on active page
  const handleClearPageAnnotations = () => {
    if (!activePageId) return;
    if (confirm('Clear all drawings and annotations on this page?')) {
      handleUpdatePageAnnotations(activePageId, []);
    }
  };

  // Notebook operations
  const handleCreateNotebook = async (title: string, color: string) => {
    const newNb: NotebookData = {
      id: `nb_${Date.now()}`,
      title,
      color,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const defaultSec: SectionData = {
      id: `sec_${Date.now()}`,
      notebookId: newNb.id,
      title: 'General Notes',
      color: color,
      order: 0,
      pages: [
        {
          id: `pg_${Date.now()}`,
          title: 'Page 1',
          order: 0,
          paperTemplate: 'grid',
          annotations: [],
          width: 850,
          height: 1100,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };

    await saveNotebook(newNb);
    await saveSection(defaultSec);

    setNotebooks((prev) => [...prev, newNb]);
    setSections((prev) => [...prev, defaultSec]);
    setActiveNotebookId(newNb.id);
    setActiveSectionId(defaultSec.id);
    setActivePageId(defaultSec.pages[0].id);
  };

  const handleRenameNotebook = async (id: string, newTitle: string) => {
    const target = notebooks.find((n) => n.id === id);
    if (!target || !newTitle.trim()) return;

    const updated = { ...target, title: newTitle.trim(), updatedAt: Date.now() };
    await saveNotebook(updated);
    setNotebooks((prev) => prev.map((n) => (n.id === id ? updated : n)));
  };

  const handleDeleteNotebook = async (id: string) => {
    await deleteNotebookFromDB(id);
    const remaining = notebooks.filter((n) => n.id !== id);
    setNotebooks(remaining);

    if (remaining.length === 0) {
      await handleCreateNotebook('My Notebook', '#7C3AED');
    } else if (activeNotebookId === id) {
      const nextNb = remaining[0];
      setActiveNotebookId(nextNb.id);
      const firstSec = sections.find((s) => s.notebookId === nextNb.id);
      if (firstSec) {
        setActiveSectionId(firstSec.id);
        if (firstSec.pages.length > 0) {
          setActivePageId(firstSec.pages[0].id);
        }
      }
    }
  };

  // Section operations
  const handleCreateSection = async (notebookId: string, title: string, color: string) => {
    const newSec: SectionData = {
      id: `sec_${Date.now()}`,
      notebookId,
      title,
      color,
      order: sections.filter((s) => s.notebookId === notebookId).length,
      pages: [
        {
          id: `pg_${Date.now()}`,
          title: 'Page 1',
          order: 0,
          paperTemplate: settings.paperTemplate || 'grid',
          annotations: [],
          width: 850,
          height: 1100,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };

    await saveSection(newSec);
    setSections((prev) => [...prev, newSec]);
    setActiveSectionId(newSec.id);
    setActivePageId(newSec.pages[0].id);
  };

  // Page Operations & Page Inserter Logic
  const handleCreatePage = (sectionId: string, title: string) => {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return;

    const newPg: PageData = {
      id: `pg_${Date.now()}`,
      title,
      order: sec.pages.length,
      paperTemplate: settings.paperTemplate || 'grid',
      annotations: [],
      width: 850,
      height: 1100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updatedPages = [...sec.pages, newPg];
    updateSectionInStateAndDB({ ...sec, pages: updatedPages });
    setActivePageId(newPg.id);
  };

  // Insert page at specific index (between existing pages!)
  const handleInsertPageAt = (index: number, title: string, template: PaperTemplate) => {
    if (!activeSection) return;

    const newPg: PageData = {
      id: `pg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title,
      order: index,
      paperTemplate: template,
      annotations: [],
      width: 850,
      height: 1100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const existing = [...activeSection.pages];
    existing.splice(index, 0, newPg);

    // Re-index orders
    const reindexed = existing.map((p, idx) => ({ ...p, order: idx }));
    updateSectionInStateAndDB({ ...activeSection, pages: reindexed });
    setActivePageId(newPg.id);
  };

  // Duplicate Page
  const handleDuplicatePage = (index: number) => {
    if (!activeSection) return;
    const target = activeSection.pages[index];
    if (!target) return;

    const dupPg: PageData = {
      ...target,
      id: `pg_dup_${Date.now()}`,
      title: `${target.title} (Copy)`,
      order: index + 1,
      annotations: JSON.parse(JSON.stringify(target.annotations)),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const existing = [...activeSection.pages];
    existing.splice(index + 1, 0, dupPg);
    const reindexed = existing.map((p, idx) => ({ ...p, order: idx }));

    updateSectionInStateAndDB({ ...activeSection, pages: reindexed });
    setActivePageId(dupPg.id);
  };

  // Move / Reorder Page
  const handleMovePage = (fromIndex: number, toIndex: number) => {
    if (!activeSection) return;
    const existing = [...activeSection.pages];
    const [moved] = existing.splice(fromIndex, 1);
    existing.splice(toIndex, 0, moved);

    const reindexed = existing.map((p, idx) => ({ ...p, order: idx }));
    updateSectionInStateAndDB({ ...activeSection, pages: reindexed });
  };

  // Delete Page
  const handleDeletePage = (sectionId: string, pageId: string) => {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec || sec.pages.length <= 1) return;

    const filtered = sec.pages.filter((p) => p.id !== pageId);
    updateSectionInStateAndDB({ ...sec, pages: filtered });

    if (activePageId === pageId) {
      setActivePageId(filtered[0].id);
    }
  };

  const handleInsertTable = (rows: number, cols: number) => {
    if (!activePage) return;

    const defaultWidth = 360;
    const defaultHeight = 180;
    const colWidths = Array(cols).fill(Math.round(defaultWidth / cols));
    const rowHeights = Array(rows).fill(Math.round(defaultHeight / rows));

    const newTable: TableAnnotation = {
      id: `table_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'table',
      x: 100,
      y: 120,
      width: defaultWidth,
      height: defaultHeight,
      rows,
      cols,
      colWidths,
      rowHeights,
      color: '#334155',
      fillColor: 'rgba(255, 255, 255, 0.95)',
      strokeWidth: 1.5,
      cellsData: {},
    };

    handleUpdatePageAnnotations(activePage.id, [...activePage.annotations, newTable]);
  };

  const handleInsertImage = (dataUrl: string) => {
    if (!activePage) return;

    const img = new Image();
    img.onload = () => {
      const naturalWidth = img.naturalWidth || 300;
      const naturalHeight = img.naturalHeight || 300;
      const maxDim = 320;
      let w = naturalWidth;
      let h = naturalHeight;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = (maxDim / w) * h;
          w = maxDim;
        } else {
          w = (maxDim / h) * w;
          h = maxDim;
        }
      }

      const newImage: ImageAnnotation = {
        id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'image',
        dataUrl,
        x: 80,
        y: 100,
        width: Math.round(w),
        height: Math.round(h),
      };

      handleUpdatePageAnnotations(activePage.id, [...activePage.annotations, newImage]);
    };
    img.src = dataUrl;
  };

  // PDF Import Success Handler
  const handlePdfImportSuccess = (
    pdfId: string,
    filename: string,
    pageCount: number,
    insertAtIndex?: number
  ) => {
    if (!activeSection) return;

    const pdfPages: PageData[] = [];
    const baseTitle = filename.replace(/\.pdf$/i, '');

    for (let i = 1; i <= pageCount; i++) {
      pdfPages.push({
        id: `pg_pdf_${pdfId}_${i}`,
        title: `${baseTitle} - Page ${i}`,
        order: i - 1,
        paperTemplate: 'blank',
        pdfId,
        pdfPageNumber: i,
        annotations: [],
        width: 850,
        height: 1100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const existing = [...activeSection.pages];
    const targetIdx = insertAtIndex !== undefined ? insertAtIndex : existing.length;

    existing.splice(targetIdx, 0, ...pdfPages);
    const reindexed = existing.map((p, idx) => ({ ...p, order: idx }));

    updateSectionInStateAndDB({ ...activeSection, pages: reindexed });
    setActivePageId(pdfPages[0].id);
    setViewMode('continuous');
  };

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white select-none">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-3" />
        <p className="text-xs text-slate-400 font-medium">Loading OneNote PDF Studio...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans relative app-shell-3d">
      {/* Read / Projector Mode Floating Presenter Bar */}
      {isReadMode && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-white backdrop-blur-md px-4 py-2 rounded-full shadow-2xl border border-slate-700/80 flex items-center space-x-4 select-none animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs">
            <Tv className="w-4 h-4 animate-pulse" />
            <span>Projector Read Mode</span>
          </div>
          <div className="h-4 w-px bg-slate-700" />
          <div className="flex items-center space-x-1.5 text-xs font-semibold">
            <button
              onClick={() => {
                const pages = activeSection?.pages || [];
                const idx = pages.findIndex((p) => p.id === activePageId);
                if (idx > 0) setActivePageId(pages[idx - 1].id);
              }}
              className="p-1 hover:bg-slate-800 rounded-md transition-colors text-purple-300"
              title="Previous Page (Left Arrow)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-slate-300 px-1">
              Page {activeSection?.pages ? activePageIndex + 1 : 1} of {activeSection?.pages?.length || 1}
            </span>
            <button
              onClick={() => {
                const pages = activeSection?.pages || [];
                const idx = pages.findIndex((p) => p.id === activePageId);
                if (idx < pages.length - 1) setActivePageId(pages[idx + 1].id);
              }}
              className="p-1 hover:bg-slate-800 rounded-md transition-colors text-purple-300"
              title="Next Page (Right Arrow)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="h-4 w-px bg-slate-700" />
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setZoomScale((z) => Math.max(0.4, z - 0.15))}
              className="p-1 hover:bg-slate-800 rounded-md text-slate-300"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono w-10 text-center">{Math.round(zoomScale * 100)}%</span>
            <button
              onClick={() => setZoomScale((z) => Math.min(3.0, z + 0.15))}
              className="p-1 hover:bg-slate-800 rounded-md text-slate-300"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
          <div className="h-4 w-px bg-slate-700" />
          <button
            onClick={() => setIsReadMode(false)}
            className="flex items-center space-x-1.5 px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-full shadow-xs transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>Exit (Esc)</span>
          </button>
        </div>
      )}

      {/* Top Header Navigation */}
      {!isReadMode && !isUpperPanelHidden && (
        <HeaderBar
          notebook={activeNotebook}
          section={activeSection}
          page={activePage}
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          zoomScale={zoomScale}
          onZoomIn={() => setZoomScale((z) => Math.min(3.0, z + 0.15))}
          onZoomOut={() => setZoomScale((z) => Math.max(0.3, z - 0.15))}
          onZoomReset={() => setZoomScale(1.0)}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isUpperPanelHidden={isUpperPanelHidden}
          onToggleUpperPanel={() => setIsUpperPanelHidden((prev) => !prev)}
          onHideBothPanels={handleHideBothPanels}
          onShowBothPanels={handleShowBothPanels}
          onOpenImportPdfModal={() => {
            setImportTargetInsertIndex(undefined);
            setShowImportPdfModal(true);
          }}
          onOpenPageManager={() => setShowPageManager(true)}
          onOpenExportModal={() => setShowExportModal(true)}
          onToggleReadMode={() => setIsReadMode(true)}
          totalPages={activeSection?.pages?.length || 0}
          currentPageIndex={
            activeSection?.pages
              ? activePageIndex + 1
              : 1
          }
          user={user}
          onLogout={logout}
          onOpenShareModal={() => setShowShareModal(true)}
          onSaveToDrive={user?.isGuest || user?.id === 'usr_guest' || user?.credential === 'guest_token' ? undefined : handleSaveToDrive}
          onOpenDriveModal={() => setShowDriveOpenModal(true)}
          driveSyncStatus={driveSyncStatus}
          isReadOnly={isSharedViewOnly}
        />
      )}

      {/* Shared Notebook View-Only Banner */}
      {isSharedViewOnly && (
        <div className="bg-emerald-950 text-emerald-100 border-b border-emerald-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs shadow-md z-30 select-none">
          <div className="flex items-center space-x-2">
            <Eye className="w-4 h-4 text-emerald-300" />
            <span className="font-bold text-white">Shared Notebook (View Only)</span>
            <span className="text-emerald-200 hidden sm:inline">
              • Viewing notebook progress & annotations
            </span>
          </div>
          <button
            onClick={handleImportSharedCopy}
            className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg shadow-xs transition-colors"
          >
            Import Copy to My Workspace
          </button>
        </div>
      )}

      {/* Stylus Annotation Controls Toolbar */}
      {!isReadMode && (
        <StylusToolbar
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onClearPageAnnotations={handleClearPageAnnotations}
          undo={handleUndo}
          redo={handleRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onInsertTable={handleInsertTable}
          onInsertImage={handleInsertImage}
          onToggleReadMode={() => setIsReadMode(true)}
          isUpperPanelHidden={isUpperPanelHidden}
          onToggleUpperPanel={() => setIsUpperPanelHidden((prev) => !prev)}
          onHideBothPanels={handleHideBothPanels}
          onShowBothPanels={handleShowBothPanels}
        />
      )}

      {/* Real-time Google Drive transfer meter */}
      {driveTransfer && driveSyncStatus === 'saving' && (
        <div className="fixed top-14 right-4 z-[80] w-[min(430px,calc(100vw-2rem))] transfer-floating-card">
          <TransferMeter
            mode="upload"
            label={driveTransfer.label}
            done={driveTransfer.done}
            total={driveTransfer.total}
            speed={driveTransfer.speed}
            etaSeconds={driveTransfer.eta}
          />
          <div className="mt-2 text-[10px] text-slate-400 font-medium">Direct-to-Google Drive resumable sync • source PDFs already synced are skipped</div>
        </div>
      )}

      {/* Main Container Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Navigation Sidebar */}
        {!isReadMode && (
          <Sidebar
            notebooks={notebooks}
            sections={sections}
            activeNotebookId={activeNotebookId}
            activeSectionId={activeSectionId}
            activePageId={activePageId}
            onSelectNotebook={(id) => {
              setActiveNotebookId(id);
              const matchingSecs = sections.filter((s) => s.notebookId === id);
              if (matchingSecs.length > 0) {
                setActiveSectionId(matchingSecs[0].id);
                if (matchingSecs[0].pages?.length > 0) {
                  setActivePageId(matchingSecs[0].pages[0].id);
                }
              }
            }}
            onSelectSection={(id) => {
              setActiveSectionId(id);
              const sec = sections.find((s) => s.id === id);
              if (sec && sec.pages?.length > 0) {
                setActivePageId(sec.pages[0].id);
              }
            }}
            onSelectPage={setActivePageId}
            onCreateNotebook={handleCreateNotebook}
            onRenameNotebook={handleRenameNotebook}
            onCreateSection={handleCreateSection}
            onCreatePage={handleCreatePage}
            onDeleteNotebook={handleDeleteNotebook}
            onDeleteSection={async (id) => {
              await deleteSectionFromDB(id);
              setSections((prev) => prev.filter((s) => s.id !== id));
            }}
            onDeletePage={handleDeletePage}
            onOpenImportPdfModal={() => {
              setImportTargetInsertIndex(undefined);
              setShowImportPdfModal(true);
            }}
            onOpenPageManager={() => setShowPageManager(true)}
            onOpenDriveModal={() => setShowDriveOpenModal(true)}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Central Workspace Canvas View */}
        <main className="flex-1 bg-slate-200 dark:bg-slate-900 overflow-auto relative scrollbar-thin">
          {/* Floating Panel Restore Bar (Visible when side or upper panel is hidden) */}
          {!isReadMode && (!isSidebarOpen || isUpperPanelHidden) && (
            <div className="sticky top-3 left-4 z-40 inline-flex items-center space-x-1.5 bg-slate-900/90 dark:bg-slate-950/95 backdrop-blur-md border border-slate-700/80 text-white rounded-2xl p-1.5 shadow-2xl animate-in fade-in zoom-in-95 select-none pointer-events-auto ml-4 mt-3">
              {/* If Both Are Hidden */}
              {!isSidebarOpen && isUpperPanelHidden && (
                <button
                  onClick={handleShowBothPanels}
                  className="flex items-center space-x-1.5 px-3 py-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs rounded-xl shadow-md border border-amber-300 transition-all active:scale-95"
                  title="Restore both side panel and upper header panel simultaneously"
                >
                  <Eye className="w-3.5 h-3.5 text-slate-950" />
                  <span>Show Both Panels</span>
                </button>
              )}

              {/* Toggle Side Panel */}
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all border active:scale-95 ${
                  !isSidebarOpen
                    ? 'bg-purple-800 hover:bg-purple-700 text-purple-100 border-purple-500'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
                title={isSidebarOpen ? 'Hide Side Panel' : 'Show Side Panel'}
              >
                {!isSidebarOpen ? (
                  <>
                    <PanelLeftOpen className="w-3.5 h-3.5" />
                    <span>Show Side</span>
                  </>
                ) : (
                  <>
                    <PanelLeftClose className="w-3.5 h-3.5" />
                    <span>Hide Side</span>
                  </>
                )}
              </button>

              {/* Toggle Upper Panel */}
              <button
                onClick={() => setIsUpperPanelHidden(!isUpperPanelHidden)}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all border active:scale-95 ${
                  isUpperPanelHidden
                    ? 'bg-purple-800 hover:bg-purple-700 text-purple-100 border-purple-500'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
                title={isUpperPanelHidden ? 'Show Upper Panel' : 'Hide Upper Panel'}
              >
                {isUpperPanelHidden ? (
                  <>
                    <PanelTopOpen className="w-3.5 h-3.5" />
                    <span>Show Top</span>
                  </>
                ) : (
                  <>
                    <PanelTopClose className="w-3.5 h-3.5" />
                    <span>Hide Top</span>
                  </>
                )}
              </button>

              {/* Quick Hide Both if at least one is open */}
              {(isSidebarOpen || !isUpperPanelHidden) && (
                <button
                  onClick={handleHideBothPanels}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 rounded-xl text-xs font-bold transition-colors border border-slate-700 flex items-center space-x-1 active:scale-95"
                  title="Hide both side and top panels simultaneously (Ctrl+Shift+H)"
                >
                  <Maximize2 className="w-3 h-3 text-amber-400" />
                  <span>Hide Both</span>
                </button>
              )}
            </div>
          )}
          {activeSection && (
            <ContinuousDocumentView
              pages={activeSection.pages}
              settings={settings}
              zoomScale={zoomScale}
              activePageId={activePageId}
              isReadMode={isReadMode}
              onSelectPage={setActivePageId}
              onUpdatePageAnnotations={handleUpdatePageAnnotations}
              onInsertPageAt={handleInsertPageAt}
              onOpenImportPdfForInsert={(idx) => {
                setImportTargetInsertIndex(idx);
                setShowImportPdfModal(true);
              }}
            />
          )}
        </main>
      </div>

      {/* Page Manager & Page Inserter Modal */}
      {activeSection && (
        <PageManagerModal
          pages={activeSection.pages}
          activePageId={activePageId}
          onSelectPage={setActivePageId}
          onInsertPageAt={handleInsertPageAt}
          onDuplicatePage={handleDuplicatePage}
          onMovePage={handleMovePage}
          onDeletePage={(pgId) => handleDeletePage(activeSection.id, pgId)}
          onOpenImportPdfModalForInsert={(idx) => {
            setImportTargetInsertIndex(idx);
            setShowImportPdfModal(true);
          }}
          isOpen={showPageManager}
          onClose={() => setShowPageManager(false)}
        />
      )}

      {/* PDF Import Modal */}
      <ImportPdfModal
        isOpen={showImportPdfModal}
        onClose={() => {
          setShowImportPdfModal(false);
          setImportTargetInsertIndex(undefined);
        }}
        onImportSuccess={handlePdfImportSuccess}
        targetInsertIndex={importTargetInsertIndex}
        driveToken={driveToken}
        onRequestDriveToken={() => promptForDriveToken()}
      />

      {/* Export / Download Modal */}
      {activeSection && activePage && activeNotebook && (
        <ExportModal
          pages={activeSection.pages}
          activePage={activePage}
          notebook={activeNotebook}
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Share Notebook Modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        notebook={activeNotebook}
        sections={sections}
      />

      {/* Google Drive Open Notebook Modal (Colab-Style) */}
      <DriveOpenModal
        isOpen={showDriveOpenModal}
        onClose={() => setShowDriveOpenModal(false)}
        driveToken={driveToken}
        onRequestDriveToken={() => promptForDriveToken()}
        onLoadNotebookPayload={handleLoadNotebookPayload}
      />
    </div>
  );
}
