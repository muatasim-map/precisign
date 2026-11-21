# PreciSign codebase map

Find one feature row with `rg -n -i '^[|] .*attachment' docs/navigation/feature-index.md`. Substitute your feature for `attachment`. Locate the named symbol with `rg -n` in its source file. Read that range and the closest test, then follow imports or call sites as needed.

- **UI.** `frontend/src/App.tsx` owns the mode/auth shell and the Wouter route tree.
- **Actions.** AppContext calls the connected or browser-local repository through `RequestActions` in `shared/types/apiTypes.ts`. Follow connected actions through `backend/src/requestRoutes.ts` to shared rules in `shared/utils/`.
- **Reads.** `backend/src/reads.ts` and `shared/utils/routeAccess.ts` own connected record access.

| Feature | Entry point | Closest tests |
| --- | --- | --- |
| URL routes / navigation | `frontend/src/App.tsx`: `MainLayout`; `frontend/src/navigation/usePageNavigation.ts`: `usePageNavigation`; `frontend/src/navigation/pageRoutes.ts`: `parsePageRoute` | frontend/src/navigation/pageRoutes.test.ts; scripts/verify-navigation.mjs; scripts/verify-navigation-connected.mjs |
| Context action/refresh | `frontend/src/context/AppContext.tsx`: `AppProvider`, `runAction`, `refreshRequests` | frontend/src/context/AppContext.runAction.test.ts; frontend/src/services/apiRepository.test.ts |
| Sign-in/signup/session/recovery | `frontend/src/App.tsx`: `ApiApp`; `frontend/src/services/apiSession.ts`: `ApiSession` | frontend/src/services/apiSession.test.ts; backend/src/server.test.ts; backend/src/authRegression.test.ts; scripts/verify-navigation-connected.mjs |
| Account directory/grants | `frontend/src/components/settings/AccountDirectoryView.tsx`: `AccountDirectoryView`; `frontend/src/components/settings/AccessRightsMatrix.tsx`: `AccessRightsMatrix` | backend/src/accountAdmin.test.ts; backend/src/pilotAccess.test.ts; backend/src/authRegression.test.ts |
| Processor handoff and read receipts | `shared/utils/processorHandoff.ts`: `resolveProcessorChoices`; `backend/src/processorHandoffRoutes.ts`: `processorHandoffRoutes`; `frontend/src/components/review/DocuSignProgressBanner.tsx`: `DocuSignProgressBanner`; `frontend/src/components/create/ProcessorChoices.tsx`: `ProcessorChoicesFields` | scripts/verify-processor-handoff.ts; scripts/verify-processor-handoff-ux.ts (UX walkthrough and captures) |
| Email notifications & outbox | `backend/src/email/outboxProcessor.ts`: `OutboxProcessor`; `backend/src/email/emailTransport.ts`: `ResendEmailTransport` | scripts/verify-email-mvp-e2e.ts; backend/src/accountAdmin.test.ts |
| Signature/profile | `frontend/src/components/profile/UserProfileView.tsx`: `UserProfileView` | backend/src/profile.test.ts; frontend/src/services/repository.test.ts |
| Company/form access | `shared/utils/companyAccess.ts`: `canUserAccessCompany`, `canUserStartForm`, `filterRequestsByScopeAndUser` | shared/utils/companyAccess.test.ts; backend/src/pilotAccess.test.ts |
| Record access | `shared/utils/routeAccess.ts`: `canReadPreciRoute` | shared/utils/routeAccess.test.ts; backend/src/reads.test.ts |
| Dashboard/list filters | `frontend/src/components/dashboard/DashboardView.tsx`: `filteredRequests`; `shared/utils/dashboardFilters.ts`: `filterDashboardRequests` | shared/utils/dashboardFilters.test.ts; shared/utils/actionQueue.test.ts |
| Form selection/company | `frontend/src/components/library/FormsLibraryView.tsx`: `companyForms`, `FormsLibraryView`, `launch` | scripts/verify-navigation.mjs; backend/src/multiCompanySubmission.test.ts |
| Create/Admin form | `frontend/src/components/create/CreateRequestView.tsx`: `CreateRequestView`, `handleTriggerSubmit`, `handleConfirmedSubmit` | backend/src/requests.test.ts; backend/src/requests.boundaries.test.ts |
| IT / financial creation | `frontend/src/components/create/ITRequestPreviewView.tsx`: `ITRequestPreviewView`; `frontend/src/components/create/FinancialRequestView.tsx`: `FinancialRequestView` | backend/src/requests.test.ts; backend/src/multiCompanySubmission.test.ts |
| Signer choices/configuration | `frontend/src/components/create/SignerChoices.tsx`: `SignerChoices`; `shared/utils/signingSelection.ts`: `signerOptions`, `applySignerChoices` | shared/utils/directoryRoutes.test.ts; backend/src/workflows.test.ts |
| Drafts / unsaved work | `frontend/src/context/AppContext.tsx`: `saveDraft`, `useUnsavedWork` | frontend/src/services/draftCoordinator.test.ts; backend/src/drafts.test.ts; scripts/verify-navigation.mjs |
| Ordinary/early final signing | `frontend/src/components/review/ReviewSignView.tsx`: `handleSignatureConfirmation`, `handleConfirmedApproval` | frontend/src/components/review/ReviewSignView.confirmation.test.ts; shared/utils/workflowEngine.test.ts; scripts/verify-review-ui.mjs |
| Return/reject/correct/cancel | `shared/utils/workflowEngine.ts`: `returnRequestForCorrection`, `rejectRequest`, `resubmitCorrectedRequest`, `cancelPreciRoute` | shared/utils/workflowEngine.test.ts; backend/src/requests.test.ts |
| Remarks/history/progress | `frontend/src/components/journey/ApprovalJourneyPanel.tsx`: `ApprovalJourneyPanel`, `commentLabels` | frontend/src/components/review/ReviewProgress.test.ts; shared/utils/approvalJourney.test.ts |
| Processing / finance hold | `shared/utils/routeProcessing.ts`: `canRecordProcessing`, `canRecordFinanceHold`, `recordProcessing`, `pendingProcessing` | backend/src/requests.test.ts |
| Connected PDF | `backend/src/documentPdf.ts`: `renderDocumentPdf` | backend/src/reads.test.ts; scripts/verify-navigation-connected.mjs (denial only) |
| Demo PDF | `frontend/src/components/document/downloadDemoPdf.tsx`: `createDemoDocumentPdf` | scripts/verify-showcase.mjs |
| Company branding | `frontend/src/components/settings/CompanyBrandingView.tsx`: `CompanyBrandingView` | backend/src/multiCompanySubmission.test.ts; backend/src/rnd.test.ts |
| R&D form/evaluation | `frontend/src/components/rnd/RndRequestView.tsx`: `RndRequestView`; `shared/utils/rndWorkflow.ts`: `validateRnd`, `saveRndEvaluation`, `rndEvaluationComplete` | backend/src/rnd.test.ts; frontend/src/data/showcaseData.test.ts |
| Backend/validation/storage | `backend/src/app.ts`: `createApp`; `backend/src/requestRoutes.ts`: `requestRoutes` | backend/src/server.test.ts; backend/src/requests.test.ts; backend/src/requests.boundaries.test.ts |
| SQLite / backup | `backend/src/db.ts`: `openDatabase`, `transaction`; `backend/src/backup.ts`: `copyDatabase` | backend/src/backup.test.ts; backend/src/startup.test.ts |
| Final completion / bypass / override | `shared/utils/workflowEngine.ts`: `completePreciRoute`; `frontend/src/components/review/ReviewSignView.tsx`: `handleFinalRouteCompletionSubmit` | shared/utils/workflowEngine.test.ts; backend/src/requests.test.ts |
| Signer replacement / backups | `shared/utils/routeReplacement.ts`: `proposeSignerReplacement`, `acceptSignerReplacement` | shared/utils/directoryRoutes.test.ts; shared/utils/routeAccess.test.ts; backend/src/requests.boundaries.test.ts |
| Document versions / historical signatures | `shared/utils/historicalEvidence.ts`: `captureApproval`, `freezeVersion`; `frontend/src/components/document/RequestDocument.tsx`: `getRequestDocumentVersion` | shared/utils/historicalEvidence.test.ts; backend/src/historicalRendering.test.ts; frontend/src/components/document/AdminWorkRequestDocument.test.ts |
| Attachments / historical downloads | `backend/src/reads.ts`: versioned attachment endpoint; `shared/utils/historicalEvidence.ts`: `attachmentsForVersion`; `backend/src/attachmentStorage.ts`: optional R2 adapter | backend/src/requests.boundaries.test.ts; frontend/src/components/review/ReviewSupportingFiles.test.ts |
| Turso / connected transactions | `backend/src/index.ts`: database selection; `backend/src/asyncDatabase.ts`: async database adapter | backend/src/asyncDatabase.test.ts |

## Verification

Use the [verification guide](../testing/verification.md) and current package scripts. See [AGENTS.md](../../AGENTS.md) for isolation, baseline tests and build requirements.
