import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CornerDownLeft, FileText, LayoutGrid, Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { companyForms } from '../library/FormsLibraryView';
import { canUserStartForm } from '../../utils/companyAccess';
import { canConfigureSigningRoutes } from '../../utils/workflowAdministration';
import { formatRequestId } from '../../utils/requestId';
import type { PageView } from '../../navigation/pageRoutes';
import { FormGlyph } from '../decor/FormGlyphs';

type Item = { id: string; group: 'Pages' | 'Start a form' | 'Requests'; label: string; hint?: string; run: () => void; form?: string };

/**
 * Ctrl/⌘+K jump list for pages, forms and requests the user can already see.
 * Opened many times a day, so it appears instantly with no animation (Emil's frequency rule).
 * It only navigates; access is still enforced by each page and by the server.
 */
export function CommandPalette({ canOpenDirectory }: { canOpenDirectory: boolean }) {
  const { setActiveView, setSelectedRequestFormType, openReviewRequest, companyRequests, currentUser, companies, selectedScope, readOnly } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(value => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('precisign:command-palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('precisign:command-palette', onOpen); };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) { setQuery(''); setActive(0); element.showModal(); input.current?.focus(); }
    if (!open && element.open) element.close();
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (view: PageView) => () => setActiveView(view);
    const pages: Item[] = [
      { id: 'p-dash', group: 'Pages', label: 'Overview', run: go('dashboard') },
      { id: 'p-forms', group: 'Pages', label: 'Forms Library', run: go('forms-library') },
      { id: 'p-archive', group: 'Pages', label: 'Archive & Register', run: go('archive') },
      { id: 'p-profile', group: 'Pages', label: 'Signature & profile', run: go('user-profile') },
      ...(canConfigureSigningRoutes(currentUser) ? [{ id: 'p-routes', group: 'Pages' as const, label: 'Signing routes', run: go('workflow-settings') }] : []),
      ...(canOpenDirectory ? [
        { id: 'p-users', group: 'Pages' as const, label: 'User directory', run: go('user-directory') },
        { id: 'p-brand', group: 'Pages' as const, label: 'Company branding', run: go('company-branding') },
      ] : []),
    ];
    const scoped = companies.filter(company => selectedScope === 'PEG' || company.id === selectedScope);
    const forms: Item[] = companyForms
      .filter(form => !readOnly || scoped.some(company => canUserStartForm(currentUser, company.id, form.name)))
      .map(form => ({ id: 'f-' + form.name, group: 'Start a form' as const, label: form.name, hint: form.department, form: form.name,
        run: () => { setSelectedRequestFormType(form.name); setActiveView('create-request'); } }));
    const requests: Item[] = companyRequests.slice(0, 200).map(request => ({
      id: 'r-' + request.id, group: 'Requests' as const,
      label: request.title || request.formData?.workDescription || request.formType,
      hint: formatRequestId(request.id, request.displayId) + ' · ' + (request.status === 'Approved' ? 'Signing completed' : request.status),
      run: () => openReviewRequest(request.id),
    }));
    return [...pages, ...forms, ...requests];
  }, [setActiveView, setSelectedRequestFormType, openReviewRequest, companyRequests, currentUser, companies, selectedScope, readOnly, canOpenDirectory]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle ? items.filter(item => (item.label + ' ' + (item.hint ?? '') + ' ' + item.id).toLowerCase().includes(needle)) : items.filter(item => item.group !== 'Requests').concat(items.filter(item => item.group === 'Requests').slice(0, 5));
    return matching.slice(0, 30);
  }, [items, query]);

  function choose(item?: Item) {
    if (!item) return;
    setOpen(false);
    item.run();
  }

  return (
    <dialog ref={dialog} className="command-palette no-print" aria-label="Go to" onClose={() => setOpen(false)}
      onClick={event => { if (event.target === dialog.current) setOpen(false); }}>
      <div className="command-palette-search">
        <Search aria-hidden="true" className="size-4 shrink-0 text-workspace-muted" />
        <input ref={input} value={query} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={results[active] ? 'cmd-' + active : undefined}
          placeholder="Search pages, forms or requests…" className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          onChange={event => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => Math.min(results.length - 1, value + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, value - 1)); }
            if (event.key === 'Enter') { event.preventDefault(); choose(results[active]); }
          }} />
        <kbd className="command-kbd">Esc</kbd>
      </div>
      <ul id="command-results" role="listbox" aria-label="Results" className="command-palette-list">
        {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-workspace-muted">No matches. Try a request ID or form name.</li>}
        {results.map((item, index) => (
          <li key={item.id}>
            {(index === 0 || results[index - 1].group !== item.group) && <p className="command-group">{item.group}</p>}
            <div id={'cmd-' + index} role="option" aria-selected={index === active} className="command-item"
              onMouseMove={() => setActive(index)} onClick={() => choose(item)}>
              <span className="command-item-icon">{item.form ? <FormGlyph form={item.form} className="size-4" /> : item.group === 'Pages' ? <LayoutGrid aria-hidden="true" className="size-4" /> : <FileText aria-hidden="true" className="size-4" />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span>{item.hint && <span className="block truncate text-xs text-workspace-muted">{item.hint}</span>}</span>
              {index === active ? <CornerDownLeft aria-hidden="true" className="size-3.5 text-workspace-muted" /> : <ArrowRight aria-hidden="true" className="size-3.5 text-transparent" />}
            </div>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
