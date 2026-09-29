import { useRef, type ReactNode } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Button } from './button';

type PageNavigationProps = {
  title: string;
  visible?: boolean;
  onBack?: () => void;
  actions?: ReactNode;
};

export function PageNavigation({ title, visible = true, onBack, actions }: PageNavigationProps) {
  // Keep the outgoing sub-page controls in place while the bar fades away.
  const lastVisibleContent = useRef({ title, onBack, actions });
  if (visible) lastVisibleContent.current = { title, onBack, actions };
  const content = visible ? { title, onBack, actions } : lastVisibleContent.current;
  return <nav className={`page-navigation${visible ? ' page-navigation--visible' : ''}`} aria-label={`${content.title} page navigation`} aria-hidden={!visible} inert={!visible}>
    <div className="page-navigation__inner">
      {content.onBack && <Button variant="ghost" size="icon-medium" className="page-navigation__back" aria-label="Back" onClick={content.onBack} tabIndex={visible ? undefined : -1}><ArrowLeft weight="bold" className="size-[18px]" aria-hidden="true" /></Button>}
      <span className="page-navigation__title"><span key={content.title} className="page-navigation__title-text">{content.title}</span></span>
      {content.actions && <div key={content.title} className="page-navigation__actions">{content.actions}</div>}
    </div>
  </nav>;
}
