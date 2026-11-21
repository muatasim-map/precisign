import { EditorSelect, EditorInput } from './RequestEditorControls';
import { useId, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { routeForms, type RouteForm } from '../../utils/routeForms';
import { canConfigureSigningRoutes } from '../../utils/workflowAdministration';
import { canUserAccessCompany } from '../../utils/companyAccess';
import { canJoinProcessingTeam } from '../../utils/routeProcessing';
import type { UserProfile, WorkflowConfig, WorkflowStageConfig } from '../../types';
import { suggestedSignerChoices, applySignerChoices, noEligibleSigners, isOptionalSigner, secondarySignerOptions, signerOptions, type SignerChoices as Choices } from '../../utils/signingSelection';

const signatureLabels = {
  'R&D Initiative': {
    requester: 'Submitter',
    intermediate: undefined,
    final: 'Head of Department / Approver',
  },
  'Administrative & Payment Request': {
    requester: 'Requester Signature (Requester)',
    intermediate: 'Department Head Signature (Department Head)',
    final: 'Approver Signature (Final Approver)',
  },
  'IT Request': {
    requester: 'Requester Signature (Requester)',
    intermediate: undefined,
    final: 'Approval Authority Signature (Final Approver)',
  },
  'Cash Voucher': {
    requester: 'Requester (you)',
    intermediate: undefined,
    final: 'Approved by (Final Approver)',
  },
  'Expense Claim': {
    requester: 'Claimed by (Requester)',
    intermediate: 'Department Head',
    final: 'Approval Authority (Final Approver)',
  },
};

function orderUsers(a: UserProfile, b: UserProfile) {
  const admin = (person: UserProfile) => person.role === 'Admin' || person.isGroupAdmin || person.isSuperAdmin;
  return Number(!!admin(b)) - Number(!!admin(a)) || a.name.localeCompare(b.name);
}

function getFormSpecificRole(form: string, stage: WorkflowStageConfig) {
  if (stage.isFinalApproval) {
    if (form === 'Cash Voucher') return 'Approved by';
    if (form === 'Expense Claim') return 'Approval Authority';
    if (form === 'R&D Initiative') return 'Head of Department / Approver';
    if (form === 'Administrative & Payment Request') return 'Approver';
    if (form === 'IT Request') return 'Approval Authority';
    return stage.name || 'Final approver';
  }
  if (form === 'Expense Claim' || form === 'Administrative & Payment Request') {
    return 'Department Head';
  }
  return stage.name;
}

function getRequesterRole(form: string) {
  if (form === 'Expense Claim') return 'Claimed by';
  if (form === 'R&D Initiative') return 'Submitter';
  return 'Requester';
}

function NumberedSigningOrder({
  form,
  requester,
  stages,
  users,
  allowFinalBypass,
}: {
  form: string;
  requester: UserProfile;
  stages: WorkflowStageConfig[];
  users: UserProfile[];
  allowFinalBypass?: boolean;
}) {
  const steps = [
    {
      id: requester.id,
      name: requester.name,
      role: getRequesterRole(form),
    },
    ...stages.map((stage) => {
      const user = users.find((u) => u.id === stage.assignedUserId);
      const name = user?.name ?? 'Choose a signer';
      const role = getFormSpecificRole(form, stage);
      return {
        id: stage.id,
        name,
        role,
      };
    }),
  ];

  return (
    <div className="border-t border-workspace-line pt-3">
      <p className="text-xs font-bold text-workspace-muted">Signing order</p>
      {stages.length > 1 && (
        <p className="mt-1 text-xs text-workspace-muted">
          Other signers go in order. The final approver can sign early.
          {allowFinalBypass ? ' They can also complete early with a reason.' : ''}
        </p>
      )}
      <ol role="list" className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {steps.map((step, index) => (
          <li key={step.id} className="flex min-w-0 items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-workspace-tint text-xs font-bold text-workspace-teal">
              {index + 1}
            </span>
            <span className="min-w-0 break-words">
              <strong>{step.name}</strong>
              <span className="block text-xs text-workspace-muted">{step.role}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AfterApprovalSection({
  form,
  workflow,
  users,
  recipientUserId,
  cashSource,
}: {
  form: string;
  workflow?: WorkflowConfig;
  users: UserProfile[];
  recipientUserId?: string;
  cashSource?: string;
}) {
  if (form !== 'Cash Voucher' && form !== 'Expense Claim') return null;

  const companyId = workflow?.companyId;
  const processingIds = workflow?.processingUserIds ?? [];

  // Cashier for Cash Voucher
  let cashierName: string | undefined = undefined;
  if (form === 'Cash Voucher') {
    const isPetty = cashSource === 'Admin petty cash';
    const roleNeeded = cashSource ? (isPetty ? 'Admin' : 'Finance') : undefined;
    const eligibleCashiers = users.filter(
      (u) =>
        processingIds.includes(u.id) &&
        (!companyId || canUserAccessCompany(u, companyId)) &&
        (roleNeeded ? u.role === roleNeeded : canJoinProcessingTeam('Cash Voucher', u.role))
    );
    if (eligibleCashiers.length) {
      cashierName = eligibleCashiers.map((u) => u.name).join(', ');
    }
  }

  // Receiver for Cash Voucher
  let receiverName: string | undefined = undefined;
  if (form === 'Cash Voucher') {
    if (recipientUserId) {
      const recipient = users.find((u) => u.id === recipientUserId);
      receiverName = recipient?.name;
    }
  }

  // Finance for Expense Claim
  let financeName: string | undefined = undefined;
  if (form === 'Expense Claim') {
    const eligibleFinance = users.filter(
      (u) =>
        processingIds.includes(u.id) &&
        (!companyId || canUserAccessCompany(u, companyId)) &&
        u.role === 'Finance'
    );
    if (eligibleFinance.length) {
      financeName = eligibleFinance.map((u) => u.name).join(', ');
    }
  }

  return (
    <div className="space-y-2 border-t border-workspace-line pt-3">
      <div>
        <p className="text-xs font-bold text-workspace-muted">Actions after approval</p>
        <p className="mt-0.5 text-xs text-workspace-muted">
          These steps occur after the signing route completes and are handled by eligible processing-team members rather than sequential signers.
        </p>
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
        {form === 'Cash Voucher' && (
          <>
            <div className="rounded-lg border border-workspace-line bg-workspace/50 px-3 py-2.5">
              <p className="text-xs font-semibold text-workspace-muted">Cashier (Eligible team)</p>
              <p className="mt-1 font-semibold">{cashierName || 'No eligible cashier configured'}</p>
              <p className="text-xs text-workspace-muted">Recorded during payout by any authorized cashier</p>
            </div>
            <div className="rounded-lg border border-workspace-line bg-workspace/50 px-3 py-2.5">
              <p className="text-xs font-semibold text-workspace-muted">Receiver acknowledgment</p>
              <p className="mt-1 font-semibold">{receiverName || 'Unassigned recipient'}</p>
              <p className="text-xs text-workspace-muted">Recorded on cash delivery</p>
            </div>
          </>
        )}
        {form === 'Expense Claim' && (
          <div className="rounded-lg border border-workspace-line bg-workspace/50 px-3 py-2.5">
            <p className="text-xs font-semibold text-workspace-muted">Finance (Eligible team)</p>
            <p className="mt-1 font-semibold">{financeName || 'No eligible finance member configured'}</p>
            <p className="text-xs text-workspace-muted">Recorded during settlement by any authorized finance member</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LegacySignerChoices({
  form,
  workflow,
  companySelected,
  users,
  requester,
  value,
  onChange,
  recipientUserId,
  cashSource,
}: Props) {
  const { setActiveView } = useApp();
  const hint = useId();
  const [backupSearch, setBackupSearch] = useState('');
  const selection = workflow && applySignerChoices(workflow, users, requester.id, value);
  const labels = signatureLabels[form];
  const final = workflow?.stages.find((stage) => stage.isFinalApproval);
  const finalChoice = final && value[final.id];
  const selectedSecondaryIds = finalChoice && typeof finalChoice === 'object' ? finalChoice.secondaryIds : undefined;
  const explicitPrimaries = Object.values(value).flatMap((choice) =>
    typeof choice === 'string' ? [choice] : choice?.primaryId ? [choice.primaryId] : []
  );
  const excluded = new Set([requester.id, ...explicitPrimaries]);
  const secondaryOptions = workflow && final ? secondarySignerOptions(workflow, final, users, excluded).sort(orderUsers) : [];
  const secondaryIds =
    selectedSecondaryIds ??
    secondaryOptions
      .filter((option) => workflow?.signerSelection !== 'company-directory' || final?.backupSignerIds?.includes(option.id))
      .map((option) => option.id);
  const filteredBackups = secondaryOptions.filter((person) =>
    person.name.toLowerCase().includes(backupSearch.trim().toLowerCase())
  );
  const stages =
    workflow?.stages.map((stage) => ({
      stage,
      optional: isOptionalSigner(workflow, stage),
      options: signerOptions(workflow, stage, users, requester.id).sort(orderUsers),
    })) ?? [];
  const missingSigner = stages.some(({ optional, options }) => !optional && !options.length);
  const routeIssue = !companySelected
    ? 'Choose a company to see who can sign.'
    : !workflow
    ? form === 'R&D Initiative'
      ? 'This company has no signing route for this form. Head of Department / Approver needs configuration.'
      : 'This company has no signing route for this form.'
    : missingSigner
    ? noEligibleSigners
    : selection?.error;

  const activeStages =
    selection?.workflow?.stages ??
    (workflow
      ? workflow.stages
          .filter((stage) => {
            const choice = value[stage.id];
            if (choice === null) return false;
            if (isOptionalSigner(workflow, stage) && (choice === undefined || choice === '')) return false;
            return true;
          })
          .map((stage) => {
            const choice = value[stage.id];
            const chosenId = typeof choice === 'object' ? choice?.primaryId : choice;
            const assignedUserId = chosenId || stage.assignedUserId;
            return { ...stage, assignedUserId };
          })
      : []);

  return (
    <section
      id="signer-review"
      tabIndex={-1}
      className="editor-signer-panel no-print space-y-4 p-4 text-sm"
      aria-label="Review signers"
      aria-describedby={routeIssue ? hint : undefined}
    >
      <div>
        <h2 className="text-base font-bold">Review signers</h2>
        <p className="mt-1 text-workspace-muted">You sign when you send the request. Choose who should sign after you.</p>
      </div>

      {routeIssue && (
        <p id={hint} role="status" className={companySelected ? 'text-rose-700' : 'text-workspace-muted'}>
          {routeIssue}
          {companySelected &&
            !workflow &&
            (canConfigureSigningRoutes(requester) ? (
              <>
                {' '}
                <button type="button" className="preci-link" onClick={() => setActiveView('workflow-settings')}>
                  Open signing routes
                </button>
              </>
            ) : (
              ' Ask a workflow administrator to set one up.'
            ))}
        </p>
      )}

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
        <div className="rounded-lg border border-workspace-line bg-workspace/50 px-3 py-2.5">
          <p className="text-xs font-semibold text-workspace-muted">{labels.requester}</p>
          <p className="mt-1 font-semibold">
            {requester.name} <span className="font-normal text-workspace-muted">(you) · You sign when sending</span>
          </p>
        </div>
        {stages.map(({ stage, optional, options }) => {
          const choice = value[stage.id];
          const chosenId = choice && typeof choice === 'object' ? choice.primaryId : choice;
          const selected = chosenId;
          const label = stage.isFinalApproval
            ? labels.final
            : workflow?.stages.filter((item) => !item.isFinalApproval).indexOf(stage) === 0 && labels.intermediate
            ? labels.intermediate
            : stage.name;
          const placeholder = optional
            ? 'Not requested'
            : stage.isFinalApproval
            ? form === 'R&D Initiative'
              ? 'Choose Head of Department / Approver'
              : form === 'Cash Voucher'
              ? 'Choose approver'
              : form === 'Expense Claim'
              ? 'Choose approval authority'
              : 'Choose the primary approver'
            : 'Choose a signer';
          return (
            <label key={stage.id} className="block min-w-0 rounded-lg border border-workspace-line bg-workspace/50 px-3 py-2.5">
              <span className="text-xs font-semibold text-workspace-muted">{label}{optional ? ' · Optional' : ''}</span>
              <EditorSelect
                className="workspace-control mt-1 block min-h-10 w-full px-2"
                disabled={options.length === 0}
                value={options.some((person) => person.id === selected) ? selected ?? '' : ''}
                onChange={(event) => {
                  const id = event.target.value || null;
                  const next = { ...value, [stage.id]: id };
                  if (final && selectedSecondaryIds) {
                    const previousPrimary = finalChoice && typeof finalChoice === 'object' ? finalChoice.primaryId : null;
                    next[final.id] = {
                      primaryId: stage.id === final.id ? id : previousPrimary,
                      secondaryIds: selectedSecondaryIds.filter((secondary) => secondary !== id),
                    };
                  }
                  onChange(next);
                }}
              >
                <option value="" disabled={!optional}>
                  {placeholder}
                </option>
                {options.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </EditorSelect>
            </label>
          );
        })}
      </div>

      {workflow && final && (
        <fieldset className="min-w-0 space-y-2 border-t border-workspace-line pt-2">
          <legend className="pr-2 font-semibold">
            Backup Approvers <span className="font-normal text-workspace-muted">· Optional</span>
          </legend>
          <p className="text-xs text-workspace-muted">
            Choose any eligible backups. They only act if an authorized route administrator assigns one as a replacement.
          </p>
          {secondaryOptions.length === 0 && !selectedSecondaryIds?.length && (
            <p className="text-xs text-workspace-muted">No backups are available for this selection.</p>
          )}
          {selectedSecondaryIds?.some((id) => !secondaryOptions.some((person) => person.id === id)) && (
            <button
              type="button"
              className="preci-link min-h-10"
              onClick={() => {
                if (finalChoice && typeof finalChoice === 'object') {
                  onChange({
                    ...value,
                    [final.id]: {
                      ...finalChoice,
                      secondaryIds: selectedSecondaryIds.filter((id) => secondaryOptions.some((person) => person.id === id)),
                    },
                  });
                }
              }}
            >
              Remove unavailable backups
            </button>
          )}
          {secondaryOptions.length > 5 && (
            <label className="block text-xs font-semibold text-workspace-ink">
              Find a backup
              <EditorInput
                type="search"
                className="mt-1"
                placeholder="Search backup names..."
                value={backupSearch}
                onChange={(event) => setBackupSearch(event.target.value)}
              />
            </label>
          )}
          {secondaryOptions.length > 0 && (
            <p className="text-xs font-medium text-workspace-muted" aria-live="polite">
              {secondaryIds.length} selected
            </p>
          )}
          {secondaryOptions.length > 0 && !filteredBackups.length && (
            <p className="text-xs text-workspace-muted">No names match your search.</p>
          )}
          <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr))]">
            {filteredBackups.map((person) => (
              <label key={person.id} className="preci-form-option border border-workspace-line bg-white [overflow-wrap:anywhere]">
                <input
                  className="preci-check"
                  type="checkbox"
                  checked={secondaryIds.includes(person.id)}
                  onChange={(event) => {
                    const primaryId = typeof finalChoice === 'string' ? finalChoice : finalChoice?.primaryId ?? null;
                    onChange({
                      ...value,
                      [final.id]: {
                        primaryId,
                        secondaryIds: event.target.checked
                          ? [...secondaryIds, person.id]
                          : secondaryIds.filter((id) => id !== person.id),
                      },
                    });
                  }}
                />
                {person.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {workflow && (
        <NumberedSigningOrder
          form={form}
          requester={requester}
          stages={activeStages}
          users={users}
          allowFinalBypass={workflow.allowFinalBypass}
        />
      )}

      {!!selection?.omittedSigningSteps?.length && (
        <p className="text-slate-600">Signatures not requested: {selection.omittedSigningSteps.join(', ')}</p>
      )}

      <AfterApprovalSection
        form={form}
        workflow={workflow}
        users={users}
        recipientUserId={recipientUserId}
        cashSource={cashSource}
      />
    </section>
  );
}

export type Props = {
  form: keyof typeof signatureLabels;
  workflow?: WorkflowConfig;
  companySelected: boolean;
  users: UserProfile[];
  requester: UserProfile;
  value: Choices;
  onChange: (value: Choices) => void;
  recipientUserId?: string;
  cashSource?: string;
};

export function SignerChoices(props: Props) {
  if (props.workflow?.signerSelection === 'company-directory') {
    return <DirectorySignerChoices {...props} workflow={props.workflow} />;
  }
  return <LegacySignerChoices {...props} />;
}

function DirectorySignerChoices({
  form,
  workflow,
  users,
  requester,
  value,
  onChange,
  recipientUserId,
  cashSource,
}: Props & { workflow: WorkflowConfig }) {
  const labels = routeForms[form as RouteForm];
  const effective = suggestedSignerChoices(workflow, users, requester.id, value);
  const selection = applySignerChoices(workflow, users, requester.id, value);
  const primaries = Object.values(effective).flatMap((choice) =>
    typeof choice === 'string' ? [choice] : choice?.primaryId ? [choice.primaryId] : []
  );
  const options = signerOptions(workflow, workflow.stages.at(-1)!, users, requester.id).sort(orderUsers);

  function updatePrimary(stageId: string, id: string | null) {
    const next: Choices = { ...effective, [stageId]: id ? { primaryId: id, secondaryIds: [] } : null };
    for (const [key, choice] of Object.entries(next)) {
      if (choice && typeof choice === 'object') {
        next[key] = { ...choice, secondaryIds: choice.secondaryIds.filter((backup) => backup !== id) };
      }
    }
    onChange(next);
  }

  const activeStages =
    selection?.workflow?.stages ??
    workflow.stages
      .filter((stage) => {
        const raw = effective[stage.id];
        const id = typeof raw === 'string' ? raw : raw?.primaryId ?? '';
        return stage.isFinalApproval || !!id || (raw !== null && typeof raw === 'object');
      })
      .map((stage) => {
        const raw = effective[stage.id];
        const assignedUserId = typeof raw === 'string' ? raw : raw?.primaryId ?? stage.assignedUserId;
        return { ...stage, assignedUserId };
      });

  return (
    <section
      id="signer-review"
      tabIndex={-1}
      className="editor-signer-panel no-print space-y-3 p-4 text-sm"
      aria-label="Review signers"
      aria-describedby={selection.error ? 'directory-signer-error' : undefined}
    >
      <h2 className="text-base font-bold">Review signers</h2>
      <p className="mt-1 text-workspace-muted">You sign when you send the request. Choose who should sign after you.</p>

      <div className="rounded-lg border border-workspace-line p-3">
        <p className="text-xs font-semibold text-workspace-muted">{labels.requester}</p>
        <p className="mt-1 font-semibold">{requester.name} <span className="font-normal text-workspace-muted">(you) · You sign when sending</span></p>
      </div>

      {workflow.stages.map((stage) => {
        const raw = effective[stage.id];
        const id = typeof raw === 'string' ? raw : raw?.primaryId ?? '';
        const backups = typeof raw === 'object' && raw ? raw.secondaryIds : [];
        const final = stage.isFinalApproval;
        const included = final || !!id || (raw !== null && typeof raw === 'object');
        const title = final
          ? form === 'R&D Initiative'
            ? 'Head of Department / Approver'
            : form === 'Cash Voucher'
            ? 'Approved by'
            : form === 'Expense Claim'
            ? 'Approval Authority'
            : labels.final
          : form === 'Expense Claim'
          ? 'Department Head'
          : stage.documentSlot
          ? labels.department
          : stage.name;
        const selectLabel = final
          ? form === 'R&D Initiative'
            ? 'Head of Department / Approver'
            : form === 'Cash Voucher'
            ? 'Approved by'
            : form === 'Expense Claim'
            ? 'Approval Authority'
            : 'Final approver'
          : form === 'Expense Claim'
          ? 'Department Head (optional)'
          : 'Signer (optional)';
        const selectPlaceholder = final
          ? form === 'R&D Initiative'
            ? 'Choose Head of Department / Approver'
            : form === 'Cash Voucher'
            ? 'Choose approver'
            : form === 'Expense Claim'
            ? 'Choose approval authority'
            : 'Choose final approver'
          : 'Not needed for this request';
        const suggestion = options.find((person) => person.id === stage.assignedUserId);
        const availableBackups = options.filter((person) => !primaries.includes(person.id));

        return (
          <div key={stage.id} className="space-y-2 rounded-lg border border-workspace-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                {title} {final && <span className="text-xs text-workspace-teal">· Final approver required</span>}
              </p>
              {!final && <span className="text-xs font-semibold text-workspace-muted">{included ? 'Included' : 'Optional'}</span>}
            </div>
            {!final && !included && (
              <div className="text-xs text-workspace-muted">
                {suggestion
                  ? `Choose a signer to add this step. Suggested: ${suggestion.name}.`
                  : 'Choose a signer to add this step.'}
              </div>
            )}
            <label className="block text-xs font-semibold">
              {selectLabel}
              <EditorSelect
                className="mt-1 font-normal"
                value={id}
                onChange={(event) => updatePrimary(stage.id, event.target.value || null)}
              >
                <option value="">{selectPlaceholder}</option>
                {options.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.id === stage.assignedUserId ? ' · Suggested' : ''}
                  </option>
                ))}
              </EditorSelect>
            </label>
            {included && (
              <details className="pt-1">
                <summary className="preci-link cursor-pointer py-1 text-xs font-semibold">
                  {final ? 'Backup Approvers' : 'Backup signer'} · {backups.length} selected
                </summary>
                <p className="my-2 text-xs text-workspace-muted">
                  A backup acts only after assignment. A replacement final approver must accept first.
                </p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {availableBackups.map((person) => (
                    <label key={person.id} className="preci-form-option">
                      <input
                        type="checkbox"
                        className="preci-check"
                        checked={backups.includes(person.id)}
                        onChange={(event) =>
                          onChange({
                            ...effective,
                            [stage.id]: {
                              primaryId: id || null,
                              secondaryIds: event.target.checked
                                ? [...backups, person.id]
                                : backups.filter((backup) => backup !== person.id),
                            },
                          })
                        }
                      />
                      {person.name}
                      {stage.backupSignerIds?.includes(person.id) && (
                        <span className="text-xs text-workspace-muted">Suggested</span>
                      )}
                    </label>
                  ))}
                  {!availableBackups.length && <p className="text-xs text-workspace-muted">No other eligible employees.</p>}
                </div>
              </details>
            )}
          </div>
        );
      })}

      {selection.error && (
        <p id="directory-signer-error" role="status" className="text-xs text-rose-700">
          {selection.error}
        </p>
      )}

      {workflow && (
        <NumberedSigningOrder
          form={form}
          requester={requester}
          stages={activeStages}
          users={users}
          allowFinalBypass={workflow.allowFinalBypass}
        />
      )}

      <AfterApprovalSection
        form={form}
        workflow={workflow}
        users={users}
        recipientUserId={recipientUserId}
        cashSource={cashSource}
      />
    </section>
  );
}
