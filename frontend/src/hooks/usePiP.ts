import { useState, useRef, useCallback } from 'react';

export function usePiP() {
  const [isAppPiP, setIsAppPiP] = useState(false);
  const [pos, setPos] = useState({ x: 20, y: window.innerHeight - 200 }); // bottom-left default
  const [size, setSize] = useState({ width: 320, height: 180 });
  
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  
  const dragStart = useRef({ cx: 0, cy: 0, px: 0, py: 0 });
  const resizeStart = useRef({ cx: 0, cy: 0, w: 0, h: 0 });

  const startDrag = useCallback((e: React.PointerEvent) => {
    if (!isAppPiP) return;
    if ((e.target as HTMLElement).closest('.pip-resize-handle')) return;
    if ((e.target as HTMLElement).closest('.pip-close-btn')) return;
    setIsDragging(true);
    dragStart.current = { cx: e.clientX, cy: e.clientY, px: pos.x, py: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [isAppPiP, pos]);

  const onDrag = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !isAppPiP) return;
    const dx = e.clientX - dragStart.current.cx;
    const dy = e.clientY - dragStart.current.cy;
    
    let newX = dragStart.current.px + dx;
    let newY = dragStart.current.py + dy;
    
    newX = Math.max(0, Math.min(newX, window.innerWidth - size.width));
    newY = Math.max(0, Math.min(newY, window.innerHeight - size.height));
    
    setPos({ x: newX, y: newY });
  }, [isDragging, isAppPiP, size]);

  const stopDrag = useCallback((e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const startResize = useCallback((e: React.PointerEvent) => {
    if (!isAppPiP) return;
    e.stopPropagation();
    setIsResizing(true);
    resizeStart.current = { cx: e.clientX, cy: e.clientY, w: size.width, h: size.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [isAppPiP, size]);

  const onResize = useCallback((e: React.PointerEvent) => {
    if (!isResizing || !isAppPiP) return;
    e.stopPropagation();
    const dx = e.clientX - resizeStart.current.cx;
    const dy = e.clientY - resizeStart.current.cy;
    
    // allow free aspect ratio or constrained, but bounded by viewport
    const newW = Math.max(200, Math.min(resizeStart.current.w + dx, window.innerWidth - pos.x));
    const newH = Math.max(112, Math.min(resizeStart.current.h + dy, window.innerHeight - pos.y));
    
    setSize({ width: newW, height: newH });
  }, [isResizing, isAppPiP, pos]);

  const stopResize = useCallback((e: React.PointerEvent) => {
    setIsResizing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  return {
    isAppPiP, setIsAppPiP,
    pos, size,
    startDrag, onDrag, stopDrag,
    startResize, onResize, stopResize,
    isDragging, isResizing
  };
}
