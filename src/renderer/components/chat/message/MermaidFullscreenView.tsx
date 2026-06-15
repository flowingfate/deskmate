import React, { useCallback, useState, useRef, useLayoutEffect } from 'react';
import { X, ZoomIn, ZoomOut, Hand, RotateCcw } from 'lucide-react';
import { Button } from '@/shadcn/button';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogPortal } from '@/shadcn/dialog';

interface MermaidFullscreenViewProps {
  svgHtml: string;
  onClose: () => void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.1;

const MermaidFullscreenView: React.FC<MermaidFullscreenViewProps> = ({ svgHtml, onClose }) => {
  const [zoom, setZoom] = useState(1); // 1 = 100% = fit-to-container
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanMode, setIsPanMode] = useState(false);
  const [baseScale, setBaseScale] = useState(1);
  const isPanningRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const diagramRef = useRef<HTMLDivElement>(null);
  const svgWrapperRef = useRef<HTMLDivElement>(null);

  // Compute baseScale on mount: fit SVG to container with 20px margin
  useLayoutEffect(() => {
    const container = diagramRef.current;
    const wrapper = svgWrapperRef.current;
    if (!container || !wrapper) return;

    const svg = wrapper.querySelector('svg');
    if (!svg) return;

    // Get SVG intrinsic size
    let svgWidth = svg.width.baseVal.value;
    let svgHeight = svg.height.baseVal.value;
    // Fallback to viewBox if width/height are 0
    if ((!svgWidth || !svgHeight) && svg.viewBox.baseVal) {
      svgWidth = svg.viewBox.baseVal.width || svgWidth;
      svgHeight = svg.viewBox.baseVal.height || svgHeight;
    }
    // Fallback to getBoundingClientRect
    if (!svgWidth || !svgHeight) {
      const rect = svg.getBoundingClientRect();
      svgWidth = rect.width || 800;
      svgHeight = rect.height || 600;
    }

    const containerWidth = container.clientWidth - 20;
    const containerHeight = container.clientHeight - 20;

    const scaleX = containerWidth / svgWidth;
    const scaleY = containerHeight / svgHeight;
    const fitScale = Math.min(scaleX, scaleY);

    setBaseScale(fitScale);
  }, [svgHtml]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handleTogglePan = useCallback(() => {
    setIsPanMode((v) => !v);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanMode) return;
      isPanningRef.current = true;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    },
    [isPanMode],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanningRef.current) return;
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    },
    [],
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((z) => Math.min(Math.max(z + delta, MIN_ZOOM), MAX_ZOOM));
    }
  }, []);

  const actualScale = baseScale * zoom;
  const zoomPercent = Math.round(zoom * 100);

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogPrimitive.Content
          className="mermaid-fullscreen-overlay"
          onClick={handleOverlayClick}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onClose();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Mermaid Diagram</DialogPrimitive.Title>
          <div className="mermaid-fullscreen-content">
            <div className="mermaid-fullscreen-toolbar">
              <Button variant="ghost" size="icon" onClick={handleZoomIn} title="Zoom In">
                <ZoomIn size={16} />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleZoomOut} title="Zoom Out">
                <ZoomOut size={16} />
              </Button>
              <span className="mermaid-toolbar-zoom-label">{zoomPercent}%</span>
              <Button
                variant="ghost"
                size="icon"
                className={isPanMode ? 'mermaid-toolbar-btn-active' : ''}
                onClick={handleTogglePan}
                title="Pan"
              >
                <Hand size={16} />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleReset} title="Reset">
                <RotateCcw size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="mermaid-fullscreen-close-btn"
                onClick={onClose}
                title="Close"
              >
                <X size={18} />
              </Button>
            </div>
            <div
              ref={diagramRef}
              className="mermaid-fullscreen-diagram"
              style={{ cursor: isPanMode ? (isPanningRef.current ? 'grabbing' : 'grab') : 'default' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            >
              <div
                ref={svgWrapperRef}
                style={{
                  transform: `translate(${translate.x}px, ${translate.y}px) scale(${actualScale})`,
                  transformOrigin: 'center center',
                  transition: isPanningRef.current ? 'none' : 'transform 0.15s ease',
                }}
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

export default MermaidFullscreenView;
