import type { ReactNode } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Button } from './button';

type PageNavigationProps = {
  title: string;
  visible?: boolean;
  onBack?: () => void;
  actions?: ReactNode;
};

export function PageNavigation({ title, visible = true, onBack, actions }: PageNavigationProps) {
  return <nav className={`page-navigation${visible ? ' page-navigation--visible' : ''}`} aria-label={`${title} page navigation`} aria-hidden={!visible}>
    <div className="page-navigation__inner">
      {onBack && <Button variant="ghost" size="icon-medium" className="page-navigation__back" aria-label="Back" onClick={onBack} tabIndex={visible ? undefined : -1}><ArrowLeft weight="bold" className="size-[18px]" aria-hidden="true" /></Button>}
      <span className="page-navigation__title"><span key={title} className="page-navigation__title-text">{title}</span></span>
      {actions && <div key={title} className="page-navigation__actions">{actions}</div>}
    </div>
  </nav>;
}
