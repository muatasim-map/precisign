import React from 'react';
import { useLocation } from 'wouter';

/** A route that runs out: the dashed path stops at a gap before its last node. Decorative. */
function BrokenRoute() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 176 64" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" className="notfound-motif no-print">
      <path d="M8 46 C30 44 40 30 60 28 S92 36 108 30" strokeDasharray="3 4" opacity="0.8" />
      <circle cx="60" cy="28" r="6.5" fill="currentColor" stroke="none" opacity="0.1" />
      <circle cx="60" cy="28" r="3" fill="currentColor" stroke="none" />
      <circle cx="8" cy="46" r="3" fill="#fff" />
      <g className="notfound-gap">
        <path d="M116 26 l6 6 M122 26 l-6 6" strokeWidth="1.5" opacity="0.9" />
      </g>
      <path d="M130 22 C142 18 152 14 166 14" strokeDasharray="3 4" opacity="0.35" />
      <circle cx="166" cy="14" r="3" fill="#fff" opacity="0.6" />
    </svg>
  );
}

export const NotFoundPage: React.FC = () => {
  const [, setLocation] = useLocation();

  return (
    <section className="notfound-card workspace-panel m-6 max-w-xl space-y-4 p-6" role="alert">
      <BrokenRoute />
      <div>
        <p className="preci-eyebrow page-hero-eyebrow mb-1">Route not found</p>
        <h1 className="text-xl font-bold text-workspace-ink">Page not found</h1>
      </div>
      <p className="text-sm text-workspace-muted">
        The link you followed may be broken or the page may have been moved.
      </p>
      <div className="pt-2">
        <button
          type="button"
          className="workspace-primary preci-press min-h-10 px-4 text-sm font-semibold"
          onClick={() => setLocation('/dashboard')}
        >
          Return to Dashboard
        </button>
      </div>
    </section>
  );
};
