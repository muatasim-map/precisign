import { RouteRailMotif } from "../decor/RouteMotifs";
import type { ReactNode } from 'react';
import { GitBranch } from 'lucide-react';
import { BrandLockup } from './BrandLockup';
import { AuthRoutePreview } from './AuthRoutePreview';

export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="preci-auth">
    <aside className="preci-auth-story">
      <RouteRailMotif className="auth-motif" />
      <BrandLockup />
      <div className="preci-auth-story-content">
        <p className="preci-auth-eyebrow mb-4 items-center gap-2 text-xs font-bold tracking-widest text-teal-200 uppercase">
          <GitBranch aria-hidden="true" className="size-4" /> Your E-Approval Platform
        </p>
        <p className="preci-auth-headline max-w-lg text-4xl leading-[1.08] font-bold tracking-tight text-white lg:text-5xl">A step away from paper trails.<br />A step toward tangible approvals.</p>
        <AuthRoutePreview />
      </div>
    </aside>
    <main className="preci-auth-main">{children}</main>
  </div>;
}
