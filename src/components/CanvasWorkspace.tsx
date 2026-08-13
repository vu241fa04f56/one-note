import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Trash2,
  RotateCw,
  RotateCcw,
  Palette,
  Grid,
  Sliders,
  Type,
  Check,
  Tv,
} from 'lucide-react';
import {
  PageData,
  ToolSettings,
  Point,
  Annotation,
  StrokeAnnotation,
  ShapeAnnotation,
  TextAnnotation,
  ImageAnnotation,
  TableAnnotation,
  ShapeType,
  ToolType,
} from '../types';
import {
  drawPaperBackground,
  drawStroke,
  drawShape,
  drawText,
  drawImageAnno,
  drawTableAnno,
  isPointNearStroke,
  isPointNearShape,
  isPointInsideShape,
  getTableCellAtPoint,
  performCanvasFloodFill,
  distanceBetween,
} from '../lib/drawingUtils';
import { loadPdfDocumentFromStore, renderPdfPageToCanvas, warmPdfPages } from '../lib/pdfUtils';

interface CanvasWorkspaceProps {
  page: PageData;
  settings: ToolSettings;
  zoomScale: number;
  isReadMode?: boolean;
  onUpdateAnnotations: (newAnnotations: Annotation[]) => void;
}

/**
 * Image Overlay Component for Free Positioning & Sizing
 */
interface ImageOverlayProps {
  anno: ImageAnnotation;
  zoomScale: number;
  onUpdate: (updated: ImageAnnotation) => void;
  onDelete: (id: string) => void;
}

const ImageOverlay: React.FC<ImageOverlayProps> = ({ anno, zoomScale, onUpdate, onDelete }) => {
  const [isSelected, setIsSelected] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<'nw' | 'ne' | 'sw' | 'se' | null>(null);

  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const handlePointerDownMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsSelected(true);
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: anno.x,
      y: anno.y,
      w: anno.width,
      h: anno.height,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerDownResize = (e: React.PointerEvent, handle: 'nw' | 'ne' | 'sw' | 'se') => {
    e.stopPropagation();
    e.preventDefault();
    setIsSelected(true);
    setResizeHandle(handle);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: anno.x,
      y: anno.y,
      w: anno.width,
      h: anno.height,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = (e.clientX - dragStartRef.current.mouseX) / zoomScale;
    const dy = (e.clientY - dragStartRef.current.mouseY) / zoomScale;

    if (isDragging) {
      onUpdate({
        ...anno,
        x: Math.round(dragStartRef.current.x + dx),
        y: Math.round(dragStartRef.current.y + dy),
      });
    } else if (resizeHandle) {
      let { x, y, w, h } = dragStartRef.current;
      if (resizeHandle === 'se') {
        w = Math.max(30, w + dx);
        h = Math.max(30, h + dy);
      } else if (resizeHandle === 'sw') {
        const newW = Math.max(30, w - dx);
        x = x + (w - newW);
        w = newW;
        h = Math.max(30, h + dy);
      } else if (resizeHandle === 'ne') {
        w = Math.max(30, w + dx);
        const newH = Math.max(30, h - dy);
        y = y + (h - newH);
        h = newH;
      } else if (resizeHandle === 'nw') {
        const newW = Math.max(30, w - dx);
        x = x + (w - newW);
        w = newW;
        const newH = Math.max(30, h - dy);
        y = y + (h - newH);
        h = newH;
      }
      onUpdate({
        ...anno,
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging || resizeHandle) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
    setIsDragging(false);
    setResizeHandle(null);
    dragStartRef.current = null;
  };

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        setIsSelected(true);
      }}
      className={`absolute z-20 group ${
        isSelected ? 'ring-2 ring-purple-500 ring-offset-1' : 'hover:ring-1 hover:ring-purple-300'
      }`}
      style={{
        left: `${anno.x}px`,
        top: `${anno.y}px`,
        width: `${anno.width}px`,
        height: `${anno.height}px`,
      }}
    >
      <img
        src={anno.dataUrl}
        alt="Pasted"
        className="w-full h-full object-contain pointer-events-none select-none rounded-xs"
      />

      {/* Drag overlay */}
      <div
        onPointerDown={handlePointerDownMove}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="absolute inset-0 cursor-move bg-purple-500/0 hover:bg-purple-500/10 transition-colors flex items-center justify-center"
      >
        {isSelected && (
          <span className="text-[10px] font-bold text-white bg-purple-900/80 px-2 py-0.5 rounded-full shadow-md pointer-events-none opacity-80">
            Drag to Move
          </span>
        )}
      </div>

      {/* Delete button */}
      {isSelected && (
        <div className="absolute -top-8 right-0 flex items-center space-x-1 bg-slate-900 text-white p-1 rounded-lg shadow-xl border border-slate-700 z-30">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(anno.id);
            }}
            className="p-1 text-red-400 hover:text-red-300 hover:bg-slate-800 rounded-md"
            title="Delete Image"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4 Corner Resize Handles */}
      {isSelected && (
        <>
          <div
            onPointerDown={(e) => handlePointerDownResize(e, 'nw')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute -top-2 -left-2 w-4 h-4 bg-purple-600 border-2 border-white rounded-full cursor-nwse-resize z-30 shadow-md"
          />
          <div
            onPointerDown={(e) => handlePointerDownResize(e, 'ne')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute -top-2 -right-2 w-4 h-4 bg-purple-600 border-2 border-white rounded-full cursor-nesw-resize z-30 shadow-md"
          />
          <div
            onPointerDown={(e) => handlePointerDownResize(e, 'sw')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute -bottom-2 -left-2 w-4 h-4 bg-purple-600 border-2 border-white rounded-full cursor-nesw-resize z-30 shadow-md"
          />
          <div
            onPointerDown={(e) => handlePointerDownResize(e, 'se')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute -bottom-2 -right-2 w-4 h-4 bg-purple-600 border-2 border-white rounded-full cursor-nwse-resize z-30 shadow-md"
          />
        </>
      )}
    </div>
  );
};

/**
 * Table Overlay Component with Moveable Borders
 */
interface TableOverlayProps {
  table: TableAnnotation;
  zoomScale: number;
  activeTool: ToolType;
  isReadMode?: boolean;
  onUpdate: (updated: TableAnnotation) => void;
  onDelete: (id: string) => void;
}

const TableOverlay: React.FC<TableOverlayProps> = ({
  table,
  zoomScale,
  activeTool,
  isReadMode = false,
  onUpdate,
  onDelete,
}) => {
  const [isSelected, setIsSelected] = useState(false);
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null);

  const dragStartRef = useRef<{
    type: 'move' | 'col' | 'row' | 'se';
    index?: number;
    mouseX: number;
    mouseY: number;
    x: number;
    y: number;
    w: number;
    h: number;
    colWidths: number[];
    rowHeights: number[];
  } | null>(null);

  // Column X cumulative offsets
  const colPositions: number[] = [];
  let cumX = 0;
  for (let c = 0; c < table.cols; c++) {
    colPositions.push(cumX);
    cumX += table.colWidths[c] || table.width / table.cols;
  }

  // Row Y cumulative offsets
  const rowPositions: number[] = [];
  let cumY = 0;
  for (let r = 0; r < table.rows; r++) {
    rowPositions.push(cumY);
    cumY += table.rowHeights[r] || table.height / table.rows;
  }

  const handleStartMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsSelected(true);
    dragStartRef.current = {
      type: 'move',
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: table.x,
      y: table.y,
      w: table.width,
      h: table.height,
      colWidths: [...table.colWidths],
      rowHeights: [...table.rowHeights],
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleStartColResize = (e: React.PointerEvent, colIndex: number) => {
    e.stopPropagation();
    e.preventDefault();
    setIsSelected(true);
    dragStartRef.current = {
      type: 'col',
      index: colIndex,
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: table.x,
      y: table.y,
      w: table.width,
      h: table.height,
      colWidths: [...table.colWidths],
      rowHeights: [...table.rowHeights],
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleStartRowResize = (e: React.PointerEvent, rowIndex: number) => {
    e.stopPropagation();
    e.preventDefault();
    setIsSelected(true);
    dragStartRef.current = {
      type: 'row',
      index: rowIndex,
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: table.x,
      y: table.y,
      w: table.width,
      h: table.height,
      colWidths: [...table.colWidths],
      rowHeights: [...table.rowHeights],
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleStartCornerResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsSelected(true);
    dragStartRef.current = {
      type: 'se',
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: table.x,
      y: table.y,
      w: table.width,
      h: table.height,
      colWidths: [...table.colWidths],
      rowHeights: [...table.rowHeights],
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = (e.clientX - dragStartRef.current.mouseX) / zoomScale;
    const dy = (e.clientY - dragStartRef.current.mouseY) / zoomScale;

    if (dragStartRef.current.type === 'move') {
      onUpdate({
        ...table,
        x: Math.round(dragStartRef.current.x + dx),
        y: Math.round(dragStartRef.current.y + dy),
      });
    } else if (dragStartRef.current.type === 'col' && dragStartRef.current.index !== undefined) {
      const idx = dragStartRef.current.index;
      const newWidths = [...dragStartRef.current.colWidths];
      const minW = 20;

      if (idx < table.cols - 1) {
        if (newWidths[idx] + dx >= minW && newWidths[idx + 1] - dx >= minW) {
          newWidths[idx] = Math.round(newWidths[idx] + dx);
          newWidths[idx + 1] = Math.round(newWidths[idx + 1] - dx);
          onUpdate({ ...table, colWidths: newWidths });
        }
      } else {
        const adjusted = Math.max(minW, newWidths[idx] + dx);
        newWidths[idx] = Math.round(adjusted);
        const newTotalW = newWidths.reduce((a, b) => a + b, 0);
        onUpdate({ ...table, colWidths: newWidths, width: Math.round(newTotalW) });
      }
    } else if (dragStartRef.current.type === 'row' && dragStartRef.current.index !== undefined) {
      const idx = dragStartRef.current.index;
      const newHeights = [...dragStartRef.current.rowHeights];
      const minH = 18;

      if (idx < table.rows - 1) {
        if (newHeights[idx] + dy >= minH && newHeights[idx + 1] - dy >= minH) {
          newHeights[idx] = Math.round(newHeights[idx] + dy);
          newHeights[idx + 1] = Math.round(newHeights[idx + 1] - dy);
          onUpdate({ ...table, rowHeights: newHeights });
        }
      } else {
        const adjusted = Math.max(minH, newHeights[idx] + dy);
        newHeights[idx] = Math.round(adjusted);
        const newTotalH = newHeights.reduce((a, b) => a + b, 0);
        onUpdate({ ...table, rowHeights: newHeights, height: Math.round(newTotalH) });
      }
    } else if (dragStartRef.current.type === 'se') {
      const newW = Math.max(100, dragStartRef.current.w + dx);
      const newH = Math.max(60, dragStartRef.current.h + dy);
      const scaleW = newW / dragStartRef.current.w;
      const scaleH = newH / dragStartRef.current.h;

      const newColWidths = dragStartRef.current.colWidths.map((cw) =>
        Math.max(20, Math.round(cw * scaleW))
      );
      const newRowHeights = dragStartRef.current.rowHeights.map((rh) =>
        Math.max(18, Math.round(rh * scaleH))
      );

      onUpdate({
        ...table,
        width: Math.round(newColWidths.reduce((a, b) => a + b, 0)),
        height: Math.round(newRowHeights.reduce((a, b) => a + b, 0)),
        colWidths: newColWidths,
        rowHeights: newRowHeights,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragStartRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
    dragStartRef.current = null;
  };

  const handleCellTextChange = (r: number, c: number, text: string) => {
    const cellsData = { ...(table.cellsData || {}), [`${r}_${c}`]: text };
    onUpdate({ ...table, cellsData });
  };

  const isDrawingToolActive =
    isReadMode ||
    ['pen', 'highlighter', 'eraser', 'fill', 'shape'].includes(activeTool);

  return (
    <div
      onClick={(e) => {
        if (!isDrawingToolActive) {
          e.stopPropagation();
          setIsSelected(true);
        }
      }}
      className={`absolute z-20 group rounded-xs border-2 bg-transparent ${
        isDrawingToolActive ? 'pointer-events-none' : ''
      } ${
        isSelected && !isReadMode
          ? 'border-purple-600 ring-2 ring-purple-400/50'
          : 'border-slate-700/80 hover:border-purple-400'
      }`}
      style={{
        left: `${table.x}px`,
        top: `${table.y}px`,
        width: `${table.width}px`,
        height: `${table.height}px`,
      }}
    >
      {/* Top Move Header Bar */}
      {!isReadMode && !isDrawingToolActive && (
        <div
          onPointerDown={handleStartMove}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute -top-6 left-0 right-0 h-6 bg-purple-900/90 hover:bg-purple-800 text-purple-200 text-[10px] font-bold flex items-center justify-between px-2 cursor-move rounded-t-md shadow-xs select-none"
        >
          <span>Table ({table.rows}x{table.cols}) - Moveable Borders</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(table.id);
            }}
            className="p-0.5 text-red-300 hover:text-red-100 hover:bg-red-800/50 rounded-xs"
            title="Delete Table"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Grid Cells */}
      <div className="relative w-full h-full flex flex-col">
        {Array.from({ length: table.rows }).map((_, r) => {
          const rH = table.rowHeights[r] || table.height / table.rows;
          return (
            <div key={r} className="flex relative" style={{ height: `${rH}px` }}>
              {Array.from({ length: table.cols }).map((_, c) => {
                const cW = table.colWidths[c] || table.width / table.cols;
                const cellKey = `${r}_${c}`;
                const val = table.cellsData?.[cellKey] || '';
                const isEditing = activeCellKey === cellKey;

                return (
                  <div
                    key={c}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveCellKey(cellKey);
                    }}
                    className="relative border-r border-b border-slate-300 dark:border-slate-700 flex items-center px-1 overflow-hidden font-sans text-xs text-slate-900 dark:text-slate-100"
                    style={{ width: `${cW}px`, height: `${rH}px` }}
                  >
                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        value={val}
                        onChange={(e) => handleCellTextChange(r, c, e.target.value)}
                        onBlur={() => setActiveCellKey(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setActiveCellKey(null);
                        }}
                        className="w-full h-full bg-transparent border-none outline-hidden text-xs text-purple-900 dark:text-purple-200 font-medium"
                      />
                    ) : (
                      <span className="truncate w-full">{val || <span className="opacity-25 select-none text-[10px]">cell</span>}</span>
                    )}
                  </div>
                );
              })}

              {/* Row Moveable Horizontal Border Handle */}
              <div
                onPointerDown={(e) => handleStartRowResize(e, r)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="absolute left-0 right-0 -bottom-1 h-2 cursor-row-resize z-30 hover:bg-purple-500/50 transition-colors"
                title="Drag to resize row height"
              />
            </div>
          );
        })}

        {/* Column Moveable Vertical Border Handles */}
        {Array.from({ length: table.cols }).map((_, c) => {
          const posX = colPositions[c] + (table.colWidths[c] || table.width / table.cols);
          return (
            <div
              key={c}
              onPointerDown={(e) => handleStartColResize(e, c)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="absolute top-0 bottom-0 -ml-1 w-2 cursor-col-resize z-30 hover:bg-purple-500/50 transition-colors"
              style={{ left: `${posX}px` }}
              title="Drag to resize column width"
            />
          );
        })}
      </div>

      {/* Bottom-Right Corner Resizer */}
      <div
        onPointerDown={handleStartCornerResize}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="absolute -bottom-2 -right-2 w-4 h-4 bg-purple-600 border-2 border-white rounded-full cursor-nwse-resize z-30 shadow-md"
        title="Resize overall table"
      />
    </div>
  );
};

const CanvasWorkspaceInner: React.FC<CanvasWorkspaceProps> = ({
  page,
  settings,
  zoomScale,
  isReadMode = false,
  onUpdateAnnotations,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

  // High-performance Drawing State (ref-based for 0ms input latency)
  const isDrawingRef = useRef<boolean>(false);
  const pointsRef = useRef<Point[]>([]);
  const shapeStartRef = useRef<Point | null>(null);

  // Active Text Box Insertion State
  const [activeTextInput, setActiveTextInput] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  // Active Shape Text Editor State
  const [activeShapeTextInput, setActiveShapeTextInput] = useState<{
    shapeId: string;
    x: number;
    y: number;
    text: string;
  } | null>(null);

  // PDF Page Background render state
  const [pdfRendered, setPdfRendered] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const width = page.width || 850;
  const height = page.height || 1100;

  // Keep overlay canvas dimensions strictly in sync
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      overlay.width = Math.max(1, Math.round(width));
      overlay.height = Math.max(1, Math.round(height));
    }
  }, [width, height]);

  // Global Clipboard Image Paste Handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
              const dataUrl = evt.target?.result as string;
              if (dataUrl) {
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

                  const newImageAnno: ImageAnnotation = {
                    id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    type: 'image',
                    dataUrl,
                    x: 80,
                    y: 100,
                    width: Math.round(w),
                    height: Math.round(h),
                  };

                  onUpdateAnnotations([...page.annotations, newImageAnno]);
                };
                img.src = dataUrl;
              }
            };
            reader.readAsDataURL(file);
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [page.annotations, onUpdateAnnotations]);

  // 1. Render Background (PDF Page or Paper Template)
  useEffect(() => {
    let isMounted = true;

    async function loadBackground() {
      if (page.pdfId && page.pdfPageNumber) {
        try {
          const pdfDoc = await loadPdfDocumentFromStore(page.pdfId);
          if (pdfDoc && isMounted) {
            const rendered = await renderPdfPageToCanvas(pdfDoc, page.pdfPageNumber, 1.35);
            // Warm only the immediate neighbors while the browser is idle.
            // We never render all 3000+ pages just to make scrolling work.
            warmPdfPages(pdfDoc, [page.pdfPageNumber - 1, page.pdfPageNumber + 1], 1.35);

            if (pdfCanvasRef.current && isMounted) {
              const bgCtx = pdfCanvasRef.current.getContext('2d');
              if (bgCtx) {
                pdfCanvasRef.current.width = Math.max(1, Math.round(width * 1.35));
                pdfCanvasRef.current.height = Math.max(1, Math.round(height * 1.35));
                bgCtx.drawImage(rendered.canvas, 0, 0, width * 1.35, height * 1.35);
                setPdfRendered(true);
              }
            }
          }
        } catch (err) {
          console.error('Error rendering PDF page in workspace:', err);
          if (isMounted) setPdfError('Failed to load PDF background page');
        }
      } else {
        setPdfRendered(false);
      }
    }

    loadBackground();

    return () => {
      isMounted = false;
    };
  }, [page.pdfId, page.pdfPageNumber, width, height]);

  // 2. Draw Saved Annotations onto main base canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas size (Rendered at 2x crispness)
    const scale = 1.5;
    canvas.width = width * scale;
    canvas.height = height * scale;

    ctx.save();
    ctx.scale(scale, scale);

    // Render Paper background if no PDF
    if (!page.pdfId || !pdfRendered) {
      drawPaperBackground(
        ctx,
        width,
        height,
        page.paperTemplate || 'blank',
        page.paperDarkness ?? settings.paperDarkness ?? 0,
        page.lineDarkness ?? settings.lineDarkness ?? 40
      );
    }

    // Render saved annotations in clean layers
    const images = page.annotations.filter((a): a is ImageAnnotation => a.type === 'image');
    const shapes = page.annotations.filter((a): a is ShapeAnnotation => a.type === 'shape');
    const tables = page.annotations.filter((a): a is TableAnnotation => a.type === 'table');
    const strokes = page.annotations.filter((a): a is StrokeAnnotation => a.type === 'stroke');
    const texts = page.annotations.filter((a): a is TextAnnotation => a.type === 'text');

    images.forEach((a) => drawImageAnno(ctx, a));
    shapes.forEach((a) => drawShape(ctx, a));
    tables.forEach((a) => drawTableAnno(ctx, a));
    strokes.forEach((a) => drawStroke(ctx, a));
    texts.forEach((a) => drawText(ctx, a));

    ctx.restore();
  }, [
    page,
    pdfRendered,
    width,
    height,
    settings,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Transform browser coordinates to Canvas Page space
  const getCanvasPoint = (e: { clientX: number; clientY: number; pressure?: number }): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
    };
  };

  // Get high-rate hardware digitizer points (up to 240Hz coalesced events)
  const getCoalescedPoints = (e: React.PointerEvent<HTMLCanvasElement>): Point[] => {
    const nativeEvent = e.nativeEvent as PointerEvent;
    if (nativeEvent && typeof nativeEvent.getCoalescedEvents === 'function') {
      const events = nativeEvent.getCoalescedEvents();
      if (events && events.length > 0) {
        return events.map((ev) => getCanvasPoint(ev));
      }
    }
    return [getCanvasPoint(e)];
  };

  // Immediate 0ms Overlay Canvas drawing helpers
  const clearOverlay = () => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
  };

  const drawOverlayStroke = (pts: Point[]) => {
    const overlay = overlayCanvasRef.current;
    if (!overlay || pts.length === 0) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.save();

    const liveStroke: StrokeAnnotation = {
      id: 'live_stroke',
      type: 'stroke',
      tool: (settings.activeTool === 'highlighter' ? 'highlighter' : 'pen'),
      color: settings.activeTool === 'highlighter' ? settings.highlighterColor : settings.penColor,
      width: settings.activeTool === 'highlighter' ? settings.highlighterWidth : settings.penWidth,
      opacity: settings.activeTool === 'highlighter' ? 0.45 : 1.0,
      points: pts,
      isStraightLine: settings.snapToStraightLine,
    };
    drawStroke(ctx, liveStroke);
    ctx.restore();
  };

  const drawOverlayShape = (startPt: Point, endPt: Point) => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.save();

    drawShape(ctx, {
      shapeType: settings.shapeType,
      color: settings.penColor,
      fillColor: settings.shapeFillColor,
      width: settings.penWidth,
      opacity: 1.0,
      startPoint: startPt,
      endPoint: endPt,
      isDashed: settings.shapeIsDashed,
    });
    ctx.restore();
  };

  // Save Shape Text
  const handleSaveShapeText = () => {
    if (!activeShapeTextInput) return;
    const newAnnos = page.annotations.map((a) => {
      if (a.id === activeShapeTextInput.shapeId && a.type === 'shape') {
        return {
          ...a,
          text: activeShapeTextInput.text,
          textColor: settings.penColor || '#000000',
          fontSize: settings.textSize || 16,
        };
      }
      return a;
    });
    onUpdateAnnotations(newAnnos);
    setActiveShapeTextInput(null);
  };

  // Canvas Double Click to edit Shape Text
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pt = {
      x: (e.clientX - rect.left) * (width / rect.width),
      y: (e.clientY - rect.top) * (height / rect.height),
    };

    const targetShape = [...page.annotations]
      .reverse()
      .find((a): a is ShapeAnnotation => a.type === 'shape' && isPointInsideShape(pt, a));

    if (targetShape) {
      const cx = (targetShape.startPoint.x + targetShape.endPoint.x) / 2;
      const cy = (targetShape.startPoint.y + targetShape.endPoint.y) / 2;
      setActiveShapeTextInput({
        shapeId: targetShape.id,
        text: targetShape.text || '',
        x: cx,
        y: cy,
      });
    }
  };

  // Pointer Down (Mouse / Pen / Touch Start)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isReadMode) return;

    if (settings.palmRejection && e.pointerType === 'touch' && settings.activeTool !== 'pan') {
      return;
    }

    if (settings.activeTool === 'pan') return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const pt = getCanvasPoint(e);

    // Fill Color Bucket Tool (Works on Table Cells, Shapes, and Hand-Drawn Closed Figures)
    if (settings.activeTool === 'fill') {
      const fillColor = settings.shapeFillColor || settings.penColor || '#FEF08A';

      // 1. Check Table Cells
      const targetTableIndex = page.annotations.findLastIndex(
        (a): a is TableAnnotation => a.type === 'table'
      );
      if (targetTableIndex !== -1) {
        const tableAnno = page.annotations[targetTableIndex] as TableAnnotation;
        const cell = getTableCellAtPoint(pt, tableAnno);
        if (cell) {
          const updatedTable: TableAnnotation = {
            ...tableAnno,
            cellFills: {
              ...(tableAnno.cellFills || {}),
              [`${cell.row}_${cell.col}`]: fillColor,
            },
          };
          const newAnnos = [...page.annotations];
          newAnnos[targetTableIndex] = updatedTable;
          onUpdateAnnotations(newAnnos);
          return;
        }
      }

      // 2. Check Closed Shape Geometry
      const targetShapeIndex = page.annotations.findLastIndex(
        (a): a is ShapeAnnotation => a.type === 'shape' && isPointInsideShape(pt, a)
      );

      if (targetShapeIndex !== -1) {
        const shape = page.annotations[targetShapeIndex] as ShapeAnnotation;
        const updatedShape: ShapeAnnotation = {
          ...shape,
          fillColor: fillColor,
        };
        const newAnnos = [...page.annotations];
        newAnnos[targetShapeIndex] = updatedShape;
        onUpdateAnnotations(newAnnos);
        return;
      }

      // 3. Perform MS Paint Style Pixel Flood Fill for Closed Figures
      const canvas = canvasRef.current;
      if (canvas) {
        const filledDataUrl = performCanvasFloodFill(
          canvas,
          pt.x * 2.0,
          pt.y * 2.0,
          fillColor
        );
        if (filledDataUrl) {
          const newFillAnno: ImageAnnotation = {
            id: `fill_${Date.now()}`,
            type: 'image',
            dataUrl: filledDataUrl,
            x: 0,
            y: 0,
            width: width,
            height: height,
          };
          onUpdateAnnotations([...page.annotations, newFillAnno]);
        }
      }
      return;
    }

    // Text Tool - Click inside shape or on canvas
    if (settings.activeTool === 'text') {
      const targetShape = [...page.annotations]
        .reverse()
        .find((a): a is ShapeAnnotation => a.type === 'shape' && isPointInsideShape(pt, a));

      if (targetShape) {
        const cx = (targetShape.startPoint.x + targetShape.endPoint.x) / 2;
        const cy = (targetShape.startPoint.y + targetShape.endPoint.y) / 2;
        setActiveShapeTextInput({
          shapeId: targetShape.id,
          text: targetShape.text || '',
          x: cx,
          y: cy,
        });
        return;
      }

      setActiveTextInput({ x: pt.x, y: pt.y, text: '' });
      return;
    }

    if (settings.activeTool === 'pen' || settings.activeTool === 'highlighter') {
      isDrawingRef.current = true;
      pointsRef.current = [pt];
      drawOverlayStroke(pointsRef.current);
    } else if (settings.activeTool === 'shape') {
      isDrawingRef.current = true;
      shapeStartRef.current = pt;
      drawOverlayShape(pt, pt);
    } else if (settings.activeTool === 'eraser') {
      isDrawingRef.current = true;
      eraseAtPoint(pt);
    }
  };

  // Pointer Move (Runs in <0.1ms with 0 React re-renders)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();

    if (settings.activeTool === 'pen' || settings.activeTool === 'highlighter') {
      const coalesced = getCoalescedPoints(e);
      pointsRef.current.push(...coalesced);
      drawOverlayStroke(pointsRef.current);
    } else if (settings.activeTool === 'shape' && shapeStartRef.current) {
      const pt = getCanvasPoint(e);
      drawOverlayShape(shapeStartRef.current, pt);
    } else if (settings.activeTool === 'eraser') {
      const pt = getCanvasPoint(e);
      eraseAtPoint(pt);
    }
  };

  // Pointer Up (Commits completed drawing to state)
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    isDrawingRef.current = false;
    clearOverlay();

    if (settings.activeTool === 'pen' || settings.activeTool === 'highlighter') {
      if (pointsRef.current.length > 0) {
        const newStroke: StrokeAnnotation = {
          id: `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'stroke',
          tool: settings.activeTool,
          color: settings.activeTool === 'highlighter' ? settings.highlighterColor : settings.penColor,
          width: settings.activeTool === 'highlighter' ? settings.highlighterWidth : settings.penWidth,
          opacity: settings.activeTool === 'highlighter' ? 0.45 : 1.0,
          points: [...pointsRef.current],
          isStraightLine: settings.snapToStraightLine,
        };
        onUpdateAnnotations([...page.annotations, newStroke]);
      }
    } else if (settings.activeTool === 'shape' && shapeStartRef.current) {
      const pt = getCanvasPoint(e);
      const newShape: ShapeAnnotation = {
        id: `shape_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'shape',
        shapeType: settings.shapeType,
        color: settings.penColor,
        fillColor: settings.shapeFillColor,
        width: settings.penWidth,
        opacity: 1.0,
        startPoint: shapeStartRef.current,
        endPoint: pt,
        isDashed: settings.shapeIsDashed,
      };
      onUpdateAnnotations([...page.annotations, newShape]);
    }

    pointsRef.current = [];
    shapeStartRef.current = null;
  };

  // Eraser Collision Logic
  const eraseAtPoint = (pt: Point) => {
    const threshold = settings.eraserType === 'stroke' ? 20 : 12;
    const filtered = page.annotations.filter((anno) => {
      if (anno.type === 'stroke') {
        return !isPointNearStroke(pt, anno, threshold);
      } else if (anno.type === 'shape') {
        return !isPointNearShape(pt, anno, threshold);
      } else if (anno.type === 'text') {
        const dist = Math.sqrt((pt.x - anno.x) ** 2 + (pt.y - anno.y) ** 2);
        return dist > 30;
      } else if (anno.type === 'image') {
        return !(
          pt.x >= anno.x &&
          pt.x <= anno.x + anno.width &&
          pt.y >= anno.y &&
          pt.y <= anno.y + anno.height
        );
      } else if (anno.type === 'table') {
        return !(
          pt.x >= anno.x &&
          pt.x <= anno.x + anno.width &&
          pt.y >= anno.y &&
          pt.y <= anno.y + anno.height
        );
      }
      return true;
    });

    if (filtered.length !== page.annotations.length) {
      onUpdateAnnotations(filtered);
    }
  };

  // Submit Text Input
  const handleSaveTextInput = () => {
    if (!activeTextInput || !activeTextInput.text.trim()) {
      setActiveTextInput(null);
      return;
    }

    const newTextAnno: TextAnnotation = {
      id: `text_${Date.now()}`,
      type: 'text',
      x: activeTextInput.x,
      y: activeTextInput.y,
      text: activeTextInput.text,
      color: settings.penColor || '#000000',
      fontSize: 18,
      fontFamily: 'sans-serif',
    };

    onUpdateAnnotations([...page.annotations, newTextAnno]);
    setActiveTextInput(null);
  };

  // Custom Pen Dot Cursor Style
  const getCursorStyle = (): string => {
    if (isReadMode) return 'default';
    if (settings.activeTool === 'pan') return 'grab';
    if (settings.activeTool === 'text') return 'text';

    if (settings.activeTool === 'fill') {
      return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="%23eab308" stroke="%230f172a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/></svg>') 2 22, pointer`;
    }

    if (settings.activeTool === 'eraser') {
      const size = Math.max(14, Math.min(settings.eraserWidth || 20, 48));
      const half = Math.round(size / 2);
      return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${half}" cy="${half}" r="${half - 1.5}" fill="rgba(239, 68, 68, 0.2)" stroke="%23ef4444" stroke-width="1.5" stroke-dasharray="3 2"/></svg>') ${half} ${half}, crosshair`;
    }

    // Pen, Highlighter, Shape, Lasso: Simple dot in pen color (or highlighter color)
    const isHighlighter = settings.activeTool === 'highlighter';
    const colorHex = isHighlighter ? settings.highlighterColor : settings.penColor;
    const rawWidth = isHighlighter ? settings.highlighterWidth : settings.penWidth;

    const encodedColor = encodeURIComponent(colorHex || '#000000');

    // Dot radius matching pen thickness or crisp default
    const r = Math.max(3, Math.min((rawWidth || 3) / 2, 14));
    const canvasSize = Math.max(24, Math.ceil(r * 2 + 8));
    const c = canvasSize / 2;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}"><circle cx="${c}" cy="${c}" r="${r + 1}" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="1"/><circle cx="${c}" cy="${c}" r="${r}" fill="${encodedColor}" stroke="%23ffffff" stroke-width="1.2"/></svg>`;

    return `url('data:image/svg+xml;utf8,${svg}') ${c} ${c}, default`;
  };

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center p-6 select-none transition-transform duration-100 ease-out"
      style={{
        transform: `scale(${zoomScale})`,
        transformOrigin: 'top center',
        // Transforms do not affect layout height. Add only the missing visual
        // height as margin so the virtual scroller stays accurate at any zoom.
        marginBottom: `${Math.max(0, Math.ceil((height + 48) * (zoomScale - 1)))}px`,
      }}
    >
      {/* Paper Container Canvas Frame */}
      <div
        className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {/* Background PDF Canvas Layer */}
        {page.pdfId && (
          <canvas
            ref={pdfCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-0"
          />
        )}

        {/* Foreground Saved Annotations Base Canvas */}
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleCanvasDoubleClick}
          className={`absolute inset-0 w-full h-full z-10 ${
            isReadMode
              ? 'pointer-events-none'
              : settings.activeTool === 'pan'
              ? 'cursor-grab active:cursor-grabbing'
              : 'touch-none'
          }`}
          style={{
            cursor: getCursorStyle(),
            touchAction: settings.activeTool === 'pan' ? 'auto' : 'none',
          }}
        />

        {/* Real-time Zero-Lag Live Drawing Overlay Canvas */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full z-15 pointer-events-none touch-none"
        />

        {/* Interactive Image Overlays */}
        {!isReadMode &&
          page.annotations
            .filter((a): a is ImageAnnotation => a.type === 'image')
            .map((imgAnno) => (
              <ImageOverlay
                key={imgAnno.id}
                anno={imgAnno}
                zoomScale={zoomScale}
                onUpdate={(updated) => {
                  onUpdateAnnotations(
                    page.annotations.map((a) => (a.id === updated.id ? updated : a))
                  );
                }}
                onDelete={(id) => {
                  onUpdateAnnotations(page.annotations.filter((a) => a.id !== id));
                }}
              />
            ))}

        {/* Interactive Table Overlays */}
        {page.annotations
          .filter((a): a is TableAnnotation => a.type === 'table')
          .map((tableAnno) => (
            <TableOverlay
              key={tableAnno.id}
              table={tableAnno}
              zoomScale={zoomScale}
              activeTool={settings.activeTool}
              isReadMode={isReadMode}
              onUpdate={(updated) => {
                onUpdateAnnotations(
                  page.annotations.map((a) => (a.id === updated.id ? updated : a))
                );
              }}
              onDelete={(id) => {
                onUpdateAnnotations(page.annotations.filter((a) => a.id !== id));
              }}
            />
          ))}

        {/* Shape Text Input Floating Popup */}
        {activeShapeTextInput && (
          <div
            className="absolute z-30 p-2.5 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border-2 border-blue-500 flex flex-col space-y-2 min-w-64 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${activeShapeTextInput.x}px`,
              top: `${activeShapeTextInput.y}px`,
            }}
          >
            <div className="text-[11px] font-bold text-blue-600 dark:text-blue-400 flex items-center justify-between">
              <span>Write Text Inside Shape</span>
            </div>
            <textarea
              autoFocus
              value={activeShapeTextInput.text}
              onChange={(e) =>
                setActiveShapeTextInput((prev) => (prev ? { ...prev, text: e.target.value } : null))
              }
              placeholder="Type text inside shape..."
              rows={3}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500"
            />
            <div className="flex justify-end space-x-1.5">
              <button
                onClick={() => setActiveShapeTextInput(null)}
                className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveShapeText}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-bold shadow-xs"
              >
                Save Text inside Shape
              </button>
            </div>
          </div>
        )}

        {/* Text Input Floating Popup */}
        {activeTextInput && (
          <div
            className="absolute z-30 p-2 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-purple-500 flex flex-col space-y-2 min-w-64"
            style={{
              left: `${activeTextInput.x}px`,
              top: `${activeTextInput.y}px`,
            }}
          >
            <textarea
              autoFocus
              value={activeTextInput.text}
              onChange={(e) =>
                setActiveTextInput((prev) => (prev ? { ...prev, text: e.target.value } : null))
              }
              placeholder="Type note text here..."
              rows={3}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-purple-500"
            />
            <div className="flex justify-end space-x-1.5">
              <button
                onClick={() => setActiveTextInput(null)}
                className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTextInput}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-md text-xs font-bold"
              >
                Add Text
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Memoization is critical for 3000+ page documents: scrolling changes the virtual
// window, but unchanged page canvases should not rerender.
export const CanvasWorkspace = React.memo(CanvasWorkspaceInner, (prev, next) => {
  if (prev.page === next.page && prev.settings === next.settings && prev.zoomScale === next.zoomScale && prev.isReadMode === next.isReadMode) return true;
  return (
    prev.page.id === next.page.id &&
    prev.page.annotations === next.page.annotations &&
    prev.page.pdfId === next.page.pdfId &&
    prev.page.pdfPageNumber === next.page.pdfPageNumber &&
    prev.zoomScale === next.zoomScale &&
    prev.isReadMode === next.isReadMode &&
    prev.settings === next.settings &&
    prev.onUpdateAnnotations === next.onUpdateAnnotations
  );
});
