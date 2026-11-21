/** Placeholders shaped like the content they stand in for, so arrival doesn't shift the layout. */
export function DirectorySkeleton() {
  return (
    <div role="status" className="divide-y divide-workspace-line" aria-label="Loading accounts">
      {[0, 1, 2, 3].map(row => (
        <div key={row} className="flex items-center gap-4 p-5">
          <div className="skeleton size-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-40 max-w-full" /><div className="skeleton h-3 w-56 max-w-full" /></div>
          <div className="skeleton hidden h-9 w-32 sm:block" />
        </div>
      ))}
      <span className="sr-only">Loading accounts…</span>
    </div>
  );
}

export function RequestSkeleton() {
  return (
    <div role="status" aria-label="Loading request" className="mx-auto max-w-[1600px] space-y-5 p-3.5 sm:p-6">
      <div className="workspace-panel space-y-3 p-5">
        <div className="skeleton h-8 w-24" />
        <div className="skeleton h-7 w-2/3 max-w-xl" />
        <div className="skeleton h-3.5 w-1/2 max-w-md" />
      </div>
      <div className="workspace-panel p-5">
        <div className="skeleton mb-5 h-4 w-40" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map(step => <div key={step} className="flex items-center gap-3 sm:block"><div className="skeleton size-7 shrink-0 rounded-full sm:mb-2" /><div className="flex-1 space-y-1.5"><div className="skeleton h-3.5 w-24" /><div className="skeleton h-3 w-16" /></div></div>)}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="workspace-panel skeleton-panel h-96 lg:col-span-7 xl:col-span-8"><div className="skeleton h-full w-full rounded-none" /></div>
        <div className="workspace-panel space-y-3 p-5 lg:col-span-5 xl:col-span-4"><div className="skeleton h-4 w-32" /><div className="skeleton h-3 w-full" /><div className="skeleton h-3 w-4/5" /><div className="skeleton mt-4 h-10 w-full" /></div>
      </div>
      <span className="sr-only">Loading request…</span>
    </div>
  );
}
