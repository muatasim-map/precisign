import type { ReactNode } from 'react';
import { AuthLayout } from './AuthLayout';

/** The same split-screen shell as sign-in, wrapping a single form card (reset and change-password screens). */
export function AuthCard({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return <AuthLayout>
    <div className="preci-auth-form auth-card">
      <div>
        <p className="preci-eyebrow">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-workspace-ink sm:text-4xl">{title}</h1>
        {intro && <p className="mt-2 text-sm leading-relaxed text-workspace-muted">{intro}</p>}
      </div>
      {children}
    </div>
  </AuthLayout>;
}
