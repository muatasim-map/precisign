import React from 'react';
import { Check, Download, Loader2, Paperclip } from 'lucide-react';
import type { AttachmentItem } from '../../types';

export function ReviewSupportingFiles({ version, attachments, onDownload, status = {} }: {
  version: number;
  attachments: AttachmentItem[] | undefined;
  onDownload: (attachment: AttachmentItem) => unknown;
  /** Per-file feedback owned by the caller: spinner while fetching, check after a real download. */
  status?: Record<string, 'busy' | 'done' | undefined>;
}) {
  return (
    <section aria-label="Supporting files" className="workspace-panel overflow-hidden">
      <header className="flex items-center gap-2 border-b border-workspace-line px-4 py-3">
        <Paperclip aria-hidden="true" className="size-4 shrink-0 text-workspace-teal" />
        <h3 className="text-sm font-bold">
          Supporting files{attachments && <span className="ms-1 font-normal text-workspace-muted">({attachments.length})</span>}
        </h3>
        <span className="ms-auto shrink-0 text-xs text-workspace-muted">Version {version}</span>
      </header>
      {!attachments?.length ? (
        <p className="px-4 py-3 text-xs text-workspace-muted">
          {attachments ? 'No attachments uploaded for this version.' : 'Attachments for this version are unavailable.'}
        </p>
      ) : (
        <ul aria-label="Attachments" className="max-h-56 divide-y divide-workspace-line overflow-y-auto overscroll-contain px-4">
          {attachments.map(file => (
            <li key={file.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-semibold [overflow-wrap:anywhere]">{file.name}</p>
                <p className="mt-0.5 text-[11px] text-workspace-muted">{file.sizeFormatted}</p>
              </div>
              <button
                type="button"
                aria-label={status[file.id] === 'done' ? `Downloaded ${file.name}` : `Download ${file.name}`}
                aria-busy={status[file.id] === 'busy' || undefined}
                title={status[file.id] === 'done' ? 'Downloaded' : 'Download attachment'}
                onClick={() => onDownload(file)}
                data-state={status[file.id]}
                className="download-button workspace-control preci-press grid size-10 shrink-0 place-items-center"
              >
                <span className="icon-morph" aria-hidden="true">
                  <Download data-active={!status[file.id]} className="size-4" />
                  <Loader2 data-active={status[file.id] === 'busy'} className="size-4 dash-spin" />
                  <Check data-active={status[file.id] === 'done'} className="download-check size-4 text-workspace-teal" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
