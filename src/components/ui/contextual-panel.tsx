import type { ReactNode, TouchEvent } from 'react';
import { useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Button } from './button';

export function ContextualPanel({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode }) {
  const startY = useRef<number | null>(null);
  const onTouchStart = (event: TouchEvent) => { startY.current = event.touches[0]?.clientY ?? null; };
  const onTouchEnd = (event: TouchEvent) => {
    if (startY.current !== null && (event.changedTouches[0]?.clientY ?? 0) - startY.current > 80) onOpenChange(false);
    startY.current = null;
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="contextual-panel" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
    <div className="contextual-panel__handle" aria-hidden="true" />
    <div className="contextual-panel__heading"><div><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{description}</DialogDescription></div><Button variant="ghost" size="icon-medium" aria-label={`Close ${title}`} onClick={() => onOpenChange(false)}><X aria-hidden="true" /></Button></div>
    {children}
  </DialogContent></Dialog>;
}
