import type { ReactNode, Ref } from 'react';
import { RouteHeaderMotif } from '../decor/RouteMotifs';

/**
 * Shared page hero: eyebrow, title, one-line subtitle, actions, and the route motif on the right.
 * Gives every top-level page the same art direction as the dashboard. Decoration is screen-only.
 */
export function PageHeader({ eyebrow, title, subtitle, actions, headingId, headingRef, tour, motif = 'routes', className = '' }: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  headingId?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Anchor kept for the product tour. */
  tour?: string;
  /** Tints the motif per page family. */
  motif?: 'routes' | 'forms' | 'archive' | 'people' | 'brand' | 'signature';
  className?: string;
}) {
  return (
    <header data-tour={tour} data-motif={motif} className={`page-hero flex flex-wrap items-center justify-between gap-4 ${className}`}>
      <RouteHeaderMotif className="page-hero-motif" />
      <div className="relative min-w-0">
        <p className="preci-eyebrow page-hero-eyebrow mb-1">{eyebrow}</p>
        <h1 id={headingId} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-2xl font-bold tracking-tight text-workspace-ink sm:text-[1.75rem] sm:leading-9">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-workspace-muted">{subtitle}</p>}
      </div>
      {actions && <div className="relative flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
