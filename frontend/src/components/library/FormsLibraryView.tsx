import { isShowcaseBuild } from '../../config/demo';
import { ArrowRight, CreditCard, FileText, Monitor, Receipt, Sliders } from 'lucide-react';
import { PageHeader } from '../common/PageHeader';
import { EmptyState } from '../common/EmptyState';
import { FormGlyph } from '../decor/FormGlyphs';
import { RouteCornerMotif } from '../decor/RouteMotifs';
import { useApp } from '../../context/AppContext';
import { canConfigureSigningRoutes } from '../../utils/workflowAdministration';
import { signerOptions, isOptionalSigner } from '../../utils/signingSelection';
import { canUserStartForm } from '../../utils/companyAccess';
import { RndRequestView } from '../rnd/RndRequestView';
import { FinancialRequestView } from '../create/FinancialRequestView';
import { ITRequestPreviewView } from '../create/ITRequestPreviewView';

export const companyForms = [
  { name: 'R&D Initiative', department: 'Research & Development', description: 'Identify a challenge, explore solutions and request an R&D evaluation.', icon: FileText },
  {
    name: 'Administrative & Payment Request',
    department: 'Administration / Accounts',
    description: 'Request administrative work and include company payment details when needed.',
    icon: FileText,
  },
  {
    name: 'IT Request',
    department: 'Information Technology',
    description: 'Describe the equipment, software, access or other IT support you need and why.',
    icon: Monitor,
  },
  {
    name: 'Cash Voucher',
    department: 'Administration / Accounts',
    description: 'Document a cash payout from Admin petty cash or Accounts.',
    icon: CreditCard,
  },
  {
    name: 'Expense Claim',
    department: 'Finance & Accounts',
    description: 'Submit itemized expenses and link receipts or no-bill reasons.',
    icon: Receipt,
  },
] as const;

type FormName = typeof companyForms[number]['name'];
export type LibraryEditorForm = Exclude<FormName, 'Administrative & Payment Request'>;

export function FormsLibraryView({ initialForm }: { initialForm?: LibraryEditorForm } = {}) {
  const { setSelectedRequestFormType, setActiveView, selectedCompany, selectedScope, currentUser, users, workflows, companies, readOnly: connected } = useApp();
  const openForm = initialForm;
  const scopedCompanies = companies.filter(company => selectedScope === 'PEG' || company.id === selectedScope);
  const visibleForms = companyForms.filter(form => (!connected && !isShowcaseBuild) || scopedCompanies.some(company => canUserStartForm(currentUser, company.id, form.name)));
  const editorKey = [currentUser.id, openForm].join(':');
  const closeForm = () => setActiveView('forms-library');

  function launch(form: FormName) {
    setSelectedRequestFormType(form);
    setActiveView('create-request');
  }

  if (openForm === 'R&D Initiative') return <RndRequestView key={editorKey} onBack={closeForm} />;
  if (openForm === 'IT Request') return <ITRequestPreviewView key={editorKey} onBack={closeForm} />;
  if (openForm === 'Cash Voucher' || openForm === 'Expense Claim') {
    return <FinancialRequestView key={editorKey} form={openForm} onBack={closeForm} />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-8">
      <PageHeader tour="forms-library" motif="forms" eyebrow="Start a request" title="Forms Library"
        subtitle={selectedScope === 'PEG' ? 'Group View · Choose a form, then select the legal company it belongs to.' : selectedCompany.fullName}
        actions={((!connected && !isShowcaseBuild) || canConfigureSigningRoutes(currentUser)) && <button type="button" onClick={() => setActiveView('workflow-settings')} className="workspace-control preci-press inline-flex min-h-10 items-center gap-2 px-4 text-sm font-semibold">
          <Sliders className="size-4" aria-hidden="true" /> Signing routes
        </button>} />
      {visibleForms.length === 0 && <div className="workspace-panel"><EmptyState variant="locked" title="No forms available in this view" description="Switch company or ask your account administrator for form access." /></div>}
      <div className="forms-grid grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {visibleForms.map(({ name, department, description }) => {
          const readyCompanies = scopedCompanies.filter(company => canUserStartForm(currentUser, company.id, name)
            && workflows.some(route => route.companyId === company.id && route.formType === name && route.stages.length > 0
              && route.stages.every(step => isOptionalSigner(route, step) || signerOptions(route, step, users, currentUser.id).length > 0)));
          const configured = readyCompanies.length > 0;
          return (
            <article key={name} className="forms-card workspace-panel flex min-w-0 flex-col gap-3 p-5 focus-within:border-workspace-steel">
              <RouteCornerMotif className="forms-card-motif" />
              <div className="dash-icon-tile inline-flex size-11 items-center justify-center rounded-xl text-workspace-teal"><FormGlyph form={name} className="size-6" /></div>
              <h2 className="text-base font-semibold leading-tight text-[#192B3C]">{name}</h2>
              <p className="flex-1 text-sm text-slate-600">{description}</p>
              <div className="border-t border-workspace-line pt-3 text-xs text-workspace-muted">
                <p className="font-medium">{department}</p>
                <p className={`mt-1 ${configured ? 'font-medium text-teal-800' : 'text-slate-600'}`}>
                  {configured ? (selectedScope === 'PEG' ? `Ready in ${readyCompanies.map(company => company.id).join(', ')}` : 'Ready to start') : 'Check signer availability before sending'}
                </p>
              </div>
              <button type="button" aria-label={`Open form: ${name}`} onClick={() => launch(name)} className="workspace-control preci-press inline-flex min-h-10 items-center justify-between gap-2 px-3 text-sm font-semibold">
                Start request <ArrowRight className="forms-card-arrow size-4" aria-hidden="true" />
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
