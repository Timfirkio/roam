import type { PointerEvent, ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Button } from './button';

type Drag = { pointerId: number; startY: number; lastY: number; lastTime: number; velocity: number };

export function ContextualPanel({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    panelRef.current.style.setProperty('--panel-drag-y', '0px');
    delete panelRef.current.dataset.dragging;
    dragRef.current = null;
  }, [open]);

  const resetDrag = () => {
    dragRef.current = null;
    if (!panelRef.current) return;
    delete panelRef.current.dataset.dragging;
    panelRef.current.style.setProperty('--panel-drag-y', '0px');
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia('(max-width: 640px)').matches || dragRef.current) return;
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    panelRef.current?.setAttribute('data-dragging', 'true');
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = Math.max(0, event.clientY - drag.startY);
    const elapsed = event.timeStamp - drag.lastTime;
    if (elapsed > 0) drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    panelRef.current?.style.setProperty('--panel-drag-y', `${delta}px`);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.startY);
    if (distance > 64 || (distance > 18 && drag.velocity > 0.45)) {
      dragRef.current = null;
      panelRef.current?.removeAttribute('data-dragging');
      onOpenChange(false);
    } else resetDrag();
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent ref={panelRef} className="contextual-panel" backdropClassName="contextual-panel__backdrop">
    <div className="contextual-panel__drag-region" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={resetDrag}>
      <div className="contextual-panel__handle" aria-hidden="true" />
      <div className="contextual-panel__heading"><div><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{description}</DialogDescription></div><Button variant="ghost" size="icon-medium" className="contextual-panel__close" aria-label={`Close ${title}`} onClick={() => onOpenChange(false)}><X aria-hidden="true" /></Button></div>
    </div>
    {children}
  </DialogContent></Dialog>;
}
