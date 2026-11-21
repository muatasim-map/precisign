import { useRef, useState, type ReactNode } from 'react';
import type { RequestRecord } from '../../types';
import { CompactApprovalChain } from './CompactApprovalChain';

/**
 * Desktop-only peek at a request's signer chain when hovering its ID. It opens after a short
 * intent delay, grows from its trigger (top-left origin) in 150ms, and adds no information that
 * isn't already on the request page, so touch and keyboard users lose nothing.
 */
export function RequestHoverPreview({ request, currentUserId, children }: { request: RequestRecord; currentUserId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const fine = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!fine) return <>{children}</>;
  return (
    <span className="relative inline-flex"
      onMouseEnter={() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(true), 350); }}
      onMouseLeave={() => { window.clearTimeout(timer.current); setOpen(false); }}>
      {children}
      <span className="hover-preview" data-open={open} aria-hidden="true">
        <span className="block truncate text-[13px] font-semibold text-workspace-ink">{request.title || request.formType}</span>
        <span className="mt-0.5 block text-[11px] text-workspace-muted">{request.companyId} · {request.requesterName} · {request.status === 'Approved' ? 'Signing completed' : request.status}</span>
        {open && <span className="mt-2 block"><CompactApprovalChain request={request} currentUserId={currentUserId} maxVisible={5} compact /></span>}
      </span>
    </span>
  );
}
