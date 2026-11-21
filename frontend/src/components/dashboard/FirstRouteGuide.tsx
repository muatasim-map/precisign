import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';

const storageKey = (userId: string) => 'precisign.firstRouteGuide.dismissed.' + userId;

function readDismissed(userId: string) {
  try { return localStorage.getItem(storageKey(userId)) === '1'; } catch { return false; }
}

/** Small line illustrations for each step, in the decor kit's style (currentColor, 1.5 stroke). */
function StepArt({ step }: { step: 1 | 2 | 3 }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 64 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="route-guide-art">
      {step === 1 && <>
        <path d="M18 6h18l8 8v20H18z" />
        <path d="M36 6v8h8" />
        <path d="M23 20h14M23 25h9" opacity="0.6" />
        <path className="route-guide-ink" pathLength={1} d="M24 31c3-3 4 1 6-1s3-2 5 0" />
      </>}
      {step === 2 && <>
        <path d="M8 26 C18 26 20 14 32 14 S46 26 56 26" strokeDasharray="3 4" opacity="0.7" />
        <circle cx="8" cy="26" r="4" fill="currentColor" stroke="none" />
        <circle cx="32" cy="14" r="5" fill="currentColor" stroke="none" opacity="0.18" />
        <circle cx="32" cy="14" r="3" fill="#fff" />
        <circle cx="56" cy="26" r="3" fill="#fff" />
        <path className="route-guide-ink" pathLength={1} d="M5.8 26l1.6 1.6 3-3.2" stroke="#fff" strokeWidth="1.4" />
      </>}
      {step === 3 && <>
        <circle cx="22" cy="20" r="11" fill="currentColor" stroke="none" opacity="0.14" />
        <circle cx="22" cy="20" r="7" fill="currentColor" stroke="none" />
        <path className="route-guide-ink" pathLength={1} d="M18.6 20l2.4 2.4 4.4-4.6" stroke="#fff" strokeWidth="1.6" />
        <path d="M33 20h16" strokeDasharray="3 4" opacity="0.7" />
        <path d="M45 16l5 4-5 4" />
        <rect x="52" y="13" width="9" height="14" rx="1.5" opacity="0.7" />
      </>}
    </svg>
  );
}

/**
 * First-time guide for people who haven't sent a request yet: how a PreciRoute travels, in three
 * steps that match the real rules (you sign when sending, signers sign in order and the final
 * approver may sign early, and only a completed route is sent on to the people who act on it).
 * Dismissal is remembered per person on this device; it also stops showing once they've submitted.
 */
export function FirstRouteGuide({ userId, hasSubmitted, onStart }: { userId: string; hasSubmitted: boolean; onStart: () => void }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(userId));
  if (dismissed || hasSubmitted) return null;
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(storageKey(userId), '1'); } catch { /* storage unavailable: hides for this visit */ }
  };
  const steps = [
    { title: 'Start a form', body: 'Choose a company form, fill in the details, and sign it when you send.' },
    { title: 'Signers review it', body: 'Each signer signs in turn. The final approver can sign early; the request stays open until every required signer has signed.' },
    { title: 'Approved and sent on', body: 'When signing is complete, the approved request goes to the people who act on it, such as Accounts. You can track it here.' },
  ] as const;
  return (
    <section aria-labelledby="route-guide-title" className="route-guide workspace-panel no-print relative overflow-hidden p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="preci-eyebrow page-hero-eyebrow">New here?</p>
          <h2 id="route-guide-title" className="mt-0.5 text-base font-bold text-workspace-ink">How a PreciRoute travels</h2>
        </div>
        <button type="button" aria-label="Dismiss the guide" className="preci-press grid size-9 shrink-0 place-items-center rounded-md text-workspace-muted hover:bg-slate-100" onClick={dismiss}>
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <ol className="route-guide-steps mt-3 grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="route-guide-step flex gap-3 rounded-xl border border-workspace-line bg-white p-3 md:flex-col">
            <span className="route-guide-art-wrap shrink-0 text-workspace-teal"><StepArt step={(index + 1) as 1 | 2 | 3} /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-workspace-ink"><span className="me-1.5 tabular-nums text-workspace-teal">{index + 1}.</span>{step.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-workspace-muted">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="workspace-primary preci-press inline-flex min-h-10 items-center gap-2 px-4 text-sm font-semibold" onClick={onStart}>
          Start your first request <ArrowRight aria-hidden="true" className="size-4" />
        </button>
        <button type="button" className="preci-link min-h-10 text-sm" onClick={dismiss}>Got it</button>
      </div>
    </section>
  );
}
