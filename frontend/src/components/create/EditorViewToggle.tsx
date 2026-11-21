import { useSlidingPill } from '../common/useSlidingPill';

export function EditorViewToggle({ value, onChange }: { value: 'editor' | 'preview'; onChange: (value: 'editor' | 'preview') => void }) {
  const { group, pill } = useSlidingPill();
  return <div ref={group} className="editor-view-toggle seg-group no-print" role="group" aria-label="Request view">
    <span aria-hidden="true" ref={pill} className="seg-pill seg-pill-navy" />
    {(['editor', 'preview'] as const).map(view => <button type="button" key={view} aria-pressed={value === view}
      onClick={() => onChange(view)}>{view === 'editor' ? 'Form editor' : 'Live A4 preview'}</button>)}
  </div>;
}
