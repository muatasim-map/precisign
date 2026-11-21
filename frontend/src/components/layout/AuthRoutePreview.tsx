import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Check, FileText, Pause, Play } from 'lucide-react';

type Stage = { label: string; description: string; tone: 'submitted' | 'review' | 'complete'; hold: number };

// One loop is ~6.2 s. Each hold includes the 450 ms connector fill at the start of the stage.
const stages: readonly Stage[] = [
  { label: 'Submitted', description: 'An employee submits a request.', tone: 'submitted', hold: 1900 },
  { label: 'In review', description: 'Assigned approvers review and sign.', tone: 'review', hold: 2300 },
  { label: 'Complete', description: 'Signing is complete. The signed request stays on record.', tone: 'complete', hold: 2000 },
];
const loopLength = stages.reduce((sum, stage) => sum + stage.hold, 0);

function stageAt(elapsed: number) {
  let t = elapsed % loopLength;
  for (let i = 0; i < stages.length; i++) {
    if (t < stages[i].hold) return i;
    t -= stages[i].hold;
  }
  return stages.length - 1;
}

/** Pen with a distinct nib and a short signing stroke; the stroke draws once during review. */
function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="auth-pen">
        {/* Barrel (outline), ferrule band, then a solid triangular nib with a slit and breather hole. */}
        <path d="M15.6 2.8 21.2 8.4 13.6 16 8 10.4Z" />
        <path d="M11.9 6.5 17.5 12.1" />
        <path d="M8 10.4 13.6 16 3.8 18.6Z" fill="currentColor" strokeWidth="1.2" />
        <path d="M5.6 16.8 9.6 12.8" stroke="var(--auth-pen-slit)" strokeWidth="1.3" />
      </g>
      <path className="auth-pen-stroke" pathLength="1" d="M3 21.4c1.3-1.4 2.4-1.4 3.4-.3s2.2 1 3.3-.2 2.1-1 3.1.1" strokeWidth="1.7" />
    </svg>
  );
}

function StepIcon({ index, state }: { index: number; state: 'done' | 'active' | 'upcoming' }) {
  if (state === 'done' || (index === 2 && state === 'active')) return <Check aria-hidden="true" strokeWidth={2.6} />;
  if (index === 0) return <FileText aria-hidden="true" />;
  if (index === 1) return <PenIcon />;
  return <Check aria-hidden="true" strokeWidth={2.6} />;
}

function StaticPreview() {
  return (
    <ol className="auth-flow-static">
      {stages.map((stage, index) => (
        <li key={stage.label} data-tone={stage.tone}>
          <span className="auth-flow-marker" data-state="active"><StepIcon index={index} state={index === 2 ? 'active' : 'upcoming'} /></span>
          <span>
            <strong>{stage.label}</strong>
            <span>{stage.description}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function AuthRoutePreview() {
  const reduceMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [stage, setStage] = useState(0);
  const [cycle, setCycle] = useState(0);
  const elapsed = useRef(0);

  useEffect(() => {
    if (paused || reduceMotion) return;
    let frame = 0, last: number | undefined;
    const tick = (now: number) => {
      // Cap the step so a hidden tab (rAF stops) resumes where it left off instead of jumping.
      const delta = last === undefined ? 0 : Math.min(100, now - last);
      last = now;
      const before = elapsed.current;
      elapsed.current += delta;
      if (Math.floor(elapsed.current / loopLength) !== Math.floor(before / loopLength)) setCycle(c => c + 1);
      setStage(current => { const next = stageAt(elapsed.current); return next === current ? current : next; });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, reduceMotion]);

  return (
    <section className="preci-auth-route" aria-label="PreciRoute workflow preview" data-paused={paused || undefined}>
      <div className="flex items-center justify-between gap-3 border-b border-white/15 pb-3">
        <span className="flex items-center gap-2 font-semibold text-white"><FileText aria-hidden="true" className="size-4 text-teal-200" /> A PreciRoute</span>
        {reduceMotion
          ? <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] text-slate-300">Workflow preview</span>
          : (
            <button type="button" className="auth-flow-toggle" aria-pressed={paused} onClick={() => setPaused(value => !value)}>
              {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              {paused ? 'Play animation' : 'Pause animation'}
            </button>
          )}
      </div>
      {reduceMotion ? <StaticPreview /> : (
        <>
          <ol className="auth-flow" key={cycle}>
            {stages.map((item, index) => {
              const state = index < stage ? 'done' : index === stage ? 'active' : 'upcoming';
              return (
                <li key={item.label} data-tone={item.tone} data-state={state} aria-current={state === 'active' ? 'step' : undefined}>
                  {index > 0 && <span className="auth-flow-connector" aria-hidden="true"><span data-filled={index <= stage || undefined} /></span>}
                  <span className="auth-flow-marker" data-state={state}><StepIcon index={index} state={state} /></span>
                  <span className="auth-flow-label">{item.label}<span className="sr-only">{state === 'done' ? ', completed' : state === 'active' ? ', current step' : ', upcoming'}</span></span>
                </li>
              );
            })}
          </ol>
          <div className="auth-flow-description">
            {stages.map((item, index) => (
              <p key={item.label} aria-hidden={index !== stage} data-active={index === stage || undefined}>{item.description}</p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
