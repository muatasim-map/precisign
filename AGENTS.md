# PreciSign: instructions for coding agents

## Start and discover

1. Confirm repository root, branch, HEAD, worktrees and dirty/untracked paths. Preserve existing edits.
2. Start at the [codebase map](docs/navigation/feature-index.md). Find one feature row with the map search. Read the named symbol and closest test in bounded ranges. Follow imports or call sites as needed.
3. Consult [PRECIROUTES_SPEC](docs/PRECIROUTES_SPEC.md) when changing business behavior; [PRE_PRODUCTION](docs/PRE_PRODUCTION.md) for pilot intent. These contain historical targets and implementation claims that can be stale. Code inspection establishes implemented behavior, not permission to redefine company policy. Resolve conflicts explicitly.

## Architecture and boundaries

React/TypeScript/Vite frontend; `frontend/src/App.tsx` owns mode/auth shell and page rendering. AppContext coordinates scoped state, drafts and actions. `frontend/src/navigation/pageRoutes.ts` and `usePageNavigation.ts` own URL navigation; use existing context navigation methods instead of adding another page state/history effect. Preserve `/rnd`, password-reset hashes and `/document-export` contracts.

Keep component data access behind AppContext/repository contracts: `IPreciSignRepository` in `frontend/src/services/repository.ts`, `RequestActions` in `frontend/src/services/apiTypes.ts` (and `shared/types/apiTypes.ts`), API/local adapters in `frontend/src/services/`. Connected mode uses authenticated Express handlers (`backend/src/`) and revisioned SQLite or Turso transactions; browser-local demo/showcase are simulations, not server security. Extend the existing stack without new dependencies or module restructuring unless the task warrants them. Details in `docs/navigation/feature-index.md`.

## Rules to preserve

- A request belongs to a legal company; PEG is a viewing scope. Company access, permission to start a form, record visibility and authority to sign are separate. Explicit company/form grants take precedence; legacy profiles without explicit grants retain title/company fallbacks. Do not silently remove compatibility or broaden permissions.
- Signing requires assignment and applicable company/state checks. The final assignee may sign early, leaving other stages open. Completion requires its signature, reason and applicable bypass authority; outstanding `mustSign` stages block it. Bypassed is never signed. `Approved` means signing complete, not payment/work fulfillment.
- Account administration and staff titles do not confer signing authority. `directorOverrideAction`/`override` remain public legacy names for current final completion; `directorOverrideApprove` is a separate legacy helper referenced by tests. Preserve public contracts.
- Backups are inactive until replacement. Replacement has three distinct branches in `shared/utils/routeReplacement.ts`: configured-backup activation (immediate via `canReplaceFinalApprover` to configured backups), final signer replacement outside backups (requires target acceptance, proposed by `canReplaceFinalApprover` or directory previous signer/requester), and intermediate signer replacement outside backups (immediate via `canAdministerWorkflows`: Director or group admin). Signed stages cannot be replaced. Requester-only correction creates a new document version and resets approvals.
- Preserve signature bytes, history, versions and immutable submitted company branding. Verify historical evidence and legacy fallbacks in source. Never fill missing historical images from current profiles.
- Protect official paper-form text, typography, A4/print dimensions and signature positions, especially `frontend/src/components/document/AdminWorkRequestDocument.tsx`. Preserve the approval banner and existing form behavior. UI changes require task scope, not an unsolicited rebuild.

## Development and verification

Use synthetic accounts, mock storage, in-memory SQLite or fresh temporary DBs. `openDatabase` can migrate on open; never point tests, provisioning or restore at real runtime storage. Keep the separate historical-integrity worktree isolated. Do not reset/stash/clean/switch branches, discard dirty work, commit, merge, push or deploy without authorization.

Run `npm run lint` (TypeScript only, NOT ESLint), feature tests and `npm run build` for implementation changes. Preserve any existing dist output using a unique temporary `--outDir`. Required domain/repository baseline:

```sh
node --import tsx --test shared/utils/approvalJourney.test.ts shared/utils/workflowEngine.test.ts frontend/src/services/repository.test.ts shared/utils/companyAccess.test.ts
```

Choose additional commands from the [verification guide](docs/testing/verification.md); confirm current package scripts/setup first. Tests must establish isolation before execution. Characterization tests sometimes extract source text; diagnose harness failures without weakening assertions. Investigate protected-document hash failures by comparing Git/worktree bytes and line endings, not editing the renderer. Report actual commands/results, skips and unverified behavior; prior recorded passes are not current verification.
