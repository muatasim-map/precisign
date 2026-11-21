import type { SVGProps } from 'react';

/**
 * One line illustration per company form, drawn on a 24×24 grid with the decor kit's
 * 1.5 stroke. The `glyph-accent` stroke is the detail that "draws in" on hover
 * (pathLength=1 lets CSS animate it with stroke-dashoffset). Decorative only.
 */
export function FormGlyph({ form, className = '', ...props }: { form: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`form-glyph ${className}`}
      {...props}
    >
      {glyph(form)}
    </svg>
  );
}

function glyph(form: string) {
  switch (form) {
    case 'Administrative & Payment Request':
      // A request sheet with a payment coin tucked into its corner.
      return <>
        <path d="M6 3.5h7.5L18 8v8.5" />
        <path d="M13.5 3.5V8H18" />
        <path d="M6 3.5v17h6.5" />
        <path d="M8.5 11h6M8.5 14h4" opacity="0.7" />
        <circle cx="17" cy="18" r="3.25" />
        <path className="glyph-accent" pathLength={1} d="M17 16.4v3.2M15.9 17.2c.3-.5 2-.6 2.2.1.2.8-2.2.6-2.1 1.5.1.7 1.8.7 2.2.1" />
      </>;
    case 'IT Request':
      // A monitor whose screen shows a small route.
      return <>
        <rect x="3" y="4.5" width="18" height="12" rx="2" />
        <path d="M9 20.5h6M12 16.5v4" />
        <path className="glyph-accent" pathLength={1} d="M6.5 13c1.6-.2 2.2-2.6 4-2.6s2 1.6 3.6 1.6 2-2.7 3.4-3.5" />
        <circle cx="10.5" cy="10.4" r="0.9" fill="currentColor" stroke="none" />
      </>;
    case 'Cash Voucher':
      // A banknote with a dashed tear line, like a voucher stub.
      return <>
        <rect x="2.75" y="6" width="18.5" height="12" rx="2" />
        <path d="M7 6v12" strokeDasharray="1.5 2" opacity="0.7" />
        <circle cx="14" cy="12" r="2.6" />
        <path className="glyph-accent" pathLength={1} d="M18.5 9v.01M9.5 15v.01M14 10.6v2.8" />
      </>;
    case 'Expense Claim':
      // A receipt with a torn bottom edge.
      return <>
        <path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
        <path d="M9 8h6M9 11h6" opacity="0.7" />
        <path className="glyph-accent" pathLength={1} d="M9 14.5h2.5M14 14.5h1" />
      </>;
    case 'R&D Initiative':
      // A lab flask with a rising bubble.
      return <>
        <path d="M9.5 3.5h5M10.5 3.5v5.2L5.4 17.6A2 2 0 0 0 7.1 20.5h9.8a2 2 0 0 0 1.7-2.9L13.5 8.7V3.5" />
        <path d="M7.4 14.5h9.2" opacity="0.7" />
        <path className="glyph-accent" pathLength={1} d="M11 17.4a.9.9 0 1 0 0 .01M14.2 16.2a.6.6 0 1 0 0 .01" />
      </>;
    default:
      return <>
        <path d="M6 3.5h7.5L18 8v12.5H6z" />
        <path d="M13.5 3.5V8H18" />
        <path className="glyph-accent" pathLength={1} d="M8.5 12h7M8.5 15.5h5" />
      </>;
  }
}
