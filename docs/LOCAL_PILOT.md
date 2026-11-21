# Local pilot

## Synthetic account bootstrap

Use a new, separate local database and a credentials file outside the repository. Create both parent directories first. The command accepts absolute paths:

```powershell
npm run provision:pilot -- "C:\absolute\pilot\precisign.sqlite" "C:\absolute\private\credentials.json"
```

The command creates six synthetic accounts, assigns the three company grants, leaves form grants empty, and requires a password change at first sign-in. Muatasim is the initial super admin. The credential file is created once with restricted permissions. Keep it private and never commit it. The tool refuses an unmarked existing database. Rerunning an initialized pilot does not reset passwords, email addresses, or access. These identities and assignments are test fixtures.

Run the connected app with `VITE_DATA_MODE=api`, `DATABASE_PATH` set to that pilot database, and `APP_ORIGIN=http://127.0.0.1:3000`. Run `npm run dev:server` and `npm run dev` in separate terminals. Public signup must remain inaccessible until the synthetic bootstrap is complete. Real pilot hosting needs an approved HTTPS origin and persistent storage.

## Authentication & Rate Limiting

- **Strict Cryptographic Authentication:** Every account authenticates strictly against its stored cryptographic scrypt hash across all environments (`production`, `development`, `test`). There are no universal, bypass, or fallback passwords in any mode.
- **Login Rate Limiting:** `/api/auth/login` enforces rate limiting per client IP over a 15-minute sliding window (`backend/src/app.ts`). 
  - Production limits failed attempts to 10 before locking out for 15 minutes with HTTP 429 (`"Too many attempts. Try again later."`).
  - Development mode defaults `LOGIN_LIMIT` to 100 on loopback (`127.0.0.1`) to prevent automated tests from locking out local developers.
  - The client UI surfaces HTTP 429 transparently rather than masking it behind a generic login failure.
- **First Sign-In Password Change:** When `must_change_password` is set, the session is gated and restricted. The user must call `/api/auth/change-password` with their current and new passwords; upon successful update, all existing sessions are revoked and workspace access is unlocked.

## Account Administration & Access Grants

- **Super Admin Account Provisioning:** The User Directory provides an **Add new employee** dialog backed by `POST /admin/accounts`. This endpoint requires an authenticated Super Admin session (`isSuperAdmin: true`). Non-admin attempts return 403 Forbidden.
- **Least Privilege Zero-Grant Default:** Newly created employees start with:
  - `company_grants = '[]'`
  - `form_grants = '{}'`
  - `role_override = 'Employee'`
  The employee sees a neutral onboarding message ("Welcome, [Name] — You haven’t been assigned a company yet") until explicit grants are assigned.
- **Password Policy for Admin-Created Users:** The `POST /admin/accounts` endpoint accepts an optional `mustChangePassword` boolean. It defaults to `false` for direct test provisioning, but is recommended `true` for formal production onboarding so new employees must establish a private password on first sign-in.
- **Managing Access:** The Super Admin uses User directory → **Manage access** to grant company scopes and specific startable forms per company.
- **Authority Invariants:**
  - **Company Access:** Authorizes record visibility for that legal subsidiary (PEW, ICCL, FSG). Selecting 2+ companies enables Group View.
  - **Form Grants:** Controls which forms the employee can *start* or *submit*.
  - **Route Administration:** Permitted for Directors, Group Admins, or explicitly designated Route Admins (`route_administrators` table). Allows configuring signing routes and managing intermediate signer replacements.
  - **Authority to Sign:** Established *strictly* by step assignment on an active request's signing route. Administrative roles, Super Admin status, and staff titles do NOT confer signing power.

## Form Workflows & Signing Routes

For synthetic testing, run:
```powershell
npm run seed:pilot-workflows -- "C:\absolute\pilot\precisign.sqlite"
```
against a database created by the pilot bootstrap. It adds missing configurations for all current forms per company (Administrative & Payment Request, IT Request, Cash Voucher, Expense Claim, R&D Initiative) and preserves existing configurations.

Test accounts keep their existing grants. Use Manage access to grant only the forms needed for the exercise.

## Password Recovery

For password recovery, choose **Create reset link** in the directory (`POST /admin/accounts/:id/reset-link`) and share the displayed link privately. It expires after 30 minutes, is valid once, and is replaced by any newer link. The employee chooses a new password (`POST /api/auth/reset-password`); all prior sessions are revoked. Links are invalidated when an account is disabled or its sign-in email or password changes, and are cleared from restored databases. Keep links out of logs and tickets.

## Email Notification Subsystem

PreciSign includes a persistent transactional outbox pattern:
- **Outbox Storage:** Notification records are written to `email_outbox` atomically in the same database transaction as the workflow stage transition.
- **Modes (`PRECISIGN_EMAIL_MODE`):**
  - `disabled`: Email worker is not started; notifications are not processed.
  - `mock`: Dispatches are recorded and logged without making external API calls (standard for development and automated testing).
  - `sandbox`: Routes through Resend in test/sandbox mode.
  - `live`: Production delivery via Resend SDK (`RESEND_API_KEY`).
- **Notification Events:** Sent to primary and active replacement signers upon stage assignment, and to the requester upon final approval or return for correction. Listed backup signers do NOT receive notifications until actively assigned.
- **Inspection Endpoints (Super Admin):**
  - `GET /api/admin/email/outbox`: View recent dispatch status, delivery errors, and retry attempts.
  - `POST /api/admin/email/process`: Manually trigger immediate outbox processing.

## Running Modes & Verification

- **Development:**
  ```powershell
  $env:VITE_DATA_MODE="api"
  $env:APP_ORIGIN="http://127.0.0.1:3000"
  $env:DATABASE_PATH="data/precisign.sqlite"
  $env:PRECISIGN_EMAIL_MODE="mock"
  npm run dev:server
  npm run dev
  ```
- **Production Combined:**
  Set `VITE_DATA_MODE=api` before `npm run build`. Set `NODE_ENV=production`, `APP_ORIGIN` to approved HTTPS origin, `DATABASE_PATH` (or Turso env vars), `API_PORT` (or `PORT`), `PRECISIGN_EMAIL_MODE=live` | `sandbox` | `disabled` | `mock`, and `npm start`. Combined app listens on loopback behind an office HTTPS reverse proxy.
- **Backup & Restore:**
  - Backup: `npm run backup` (SQLite online backup with integrity check to `backups/`).
  - Restore: `npm run restore -- backup.sqlite NEW-destination.sqlite` (clears active sessions and password resets).
- **Automated Verification:**
  - Domain baseline: `node --import tsx --test shared/utils/approvalJourney.test.ts shared/utils/workflowEngine.test.ts frontend/src/services/repository.test.ts shared/utils/companyAccess.test.ts`
  - Auth & Admin regression: `node --import tsx --test backend/src/authRegression.test.ts`
  - Server & Pilot suite: `npm run test:server`
  - API & Session suite: `npm run test:api`
  - Type check: `npm run lint`
  - Production build: `npm run build`
