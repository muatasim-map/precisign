import React from 'react';
import { Route, useLocation } from 'wouter';
import { ShieldAlert } from 'lucide-react';

interface ProtectedRouteProps {
  path: string;
  isAllowed: boolean;
  component: React.ComponentType<any>;
  title?: string;
  message?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  path,
  isAllowed,
  component: Component,
  title = 'Access restricted',
  message = 'This page is restricted to authorized administrators. Contact your administrator if you need access.',
}) => {
  const [, setLocation] = useLocation();

  return (
    <Route path={path}>
      {(params) => {
        if (isAllowed) {
          return <Component {...params} />;
        }
        return (
          <section className="workspace-panel m-6 max-w-xl space-y-4 p-6" role="alert">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-amber-50 text-amber-700">
                <ShieldAlert className="size-5" />
              </span>
              <h1 className="text-xl font-bold text-workspace-ink">{title}</h1>
            </div>
            <p className="text-sm text-workspace-muted">{message}</p>
            <div className="pt-2">
              <button
                type="button"
                className="workspace-primary min-h-10 px-4 text-sm font-semibold"
                onClick={() => setLocation('/dashboard')}
              >
                Return to Dashboard
              </button>
            </div>
          </section>
        );
      }}
    </Route>
  );
};
