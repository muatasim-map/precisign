import React from 'react';
import { RouteEmptyMotif } from '../decor/RouteMotifs';

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Ends the motif's route in a check node, for "nothing left to do" states. */
  done?: boolean;
  /** Illustration ending: locked (no access) or search (no matches). */
  variant?: 'default' | 'locked' | 'search';
};

/** Shared empty state: a route motif, a plain-language title, and one optional next step. */
export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, action, className = '', done, variant = 'default' }) => (
  <div className={`empty-state ${className}`} data-variant={variant}>
    <RouteEmptyMotif className="empty-state-motif" done={done} end={variant === 'locked' ? 'lock' : variant === 'search' ? 'search' : undefined} />
    <p className="empty-state-title">{title}</p>
    {description && <p className="empty-state-body">{description}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);
