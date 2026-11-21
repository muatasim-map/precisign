import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2, Paperclip } from 'lucide-react';
import type { AttachmentItem } from '../../types';

export function ReviewSupportingFiles({ version, attachments, onDownload }: {
  version: number;
  attachments: AttachmentItem[] | undefined;
  /** Resolves true once the browser has the file; anything else leaves the button as it was. */
  onDownload: (attachment: AttachmentItem) => Promise<boolean> | void;
}) {
  // Per-file feedback: a spinner while the file is fetched, then the arrow morphs into a check
  // for a moment. The check only appears after a real download, never on failure.
  const [state, setState] = useState<Record<string, 'busy' | 'done'>>({});
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  const download = async (file: AttachmentItem) => {
    if (state[file.id] === 'busy') return;
    setState(current => ({ ...current, [file.id]: 'busy' }));
    let ok = false;
    try { ok = (await onDownload(file)) === true; } finally {
      setState(current => {
        const next = { ...current };
        if (ok) next[file.id] = 'done'; else delete next[file.id];
        return next;
      });
    }
    if (ok) timers.current.push(window.setTimeout(() => setState(current => {
      const next = { ...current };
      if (next[file.id] === 'done') delete next[file.id];
      return next;
    }), 1400));
  };
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
                aria-label={state[file.id] === 'done' ? `Downloaded ${file.name}` : `Download ${file.name}`}
                aria-busy={state[file.id] === 'busy' || undefined}
                title={state[file.id] === 'done' ? 'Downloaded' : 'Download attachment'}
                onClick={() => void download(file)}
                data-state={state[file.id]}
                className="download-button workspace-control preci-press grid size-10 shrink-0 place-items-center"
              >
                <span className="icon-morph" aria-hidden="true">
                  <Download data-active={!state[file.id]} className="size-4" />
                  <Loader2 data-active={state[file.id] === 'busy'} className="size-4 dash-spin" />
                  <Check data-active={state[file.id] === 'done'} className="size-4 text-workspace-teal" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
