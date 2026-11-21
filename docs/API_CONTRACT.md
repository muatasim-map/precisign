# PreciSign API Contract

## 1. Overview & Transport Rules

- **Connected Mode:** `VITE_DATA_MODE=api` interacts with Express endpoints backed by SQLite or Turso. No code falls back to browser localStorage.
- **Session Identification:** Authenticated sessions use an HTTP-only same-origin cookie carrying a cryptographically random session token (hashed via SHA-256 in storage).
- **Client Binding:** `X-PreciSign-User` pins the connected editor to its authenticated user ID. The server verifies this matches the session actor and rejects mismatches with 401.
- **Error Format:** All API errors return JSON: `{ "error": "<descriptive message>" }`.
- **Client Error Mapping (`ApiError`):** The frontend maps HTTP statuses to stable codes:
  - `400`: `INVALID_DATA`
  - `401`: `UNAUTHENTICATED`
  - `403`: `FORBIDDEN`
  - `404`: `NOT_FOUND`
  - `409`: `STALE_REVISION`
  - `413`: `PAYLOAD_TOO_LARGE`
  - `429`: `RATE_LIMITED`
  - `500`/`502`: `PERSISTENCE_FAILURE` / `INVALID_RESPONSE`
  - Network disconnection: `NETWORK_ERROR`

---

## 2. Authentication & Session Endpoints

### `POST /api/auth/login`
- **Body:** `{ "email": string, "password": string }`
- **Behavior:** Verifies the email and candidate password against stored scrypt hash in `users.password_hash`. Rejects disabled accounts (`is_disabled = 1`).
- **Rate Limiting:** Enforces sliding-window rate limit (default 10 attempts / 15 min; configurable via `LOGIN_LIMIT` in dev). Exceeding limit returns `429 {"error": "Too many attempts. Try again later."}`.
- **Success:** Sets session cookie. Returns `{ "user": UserProfile }`. If `must_change_password` is set, `user.mustChangePassword: true` gates workspace access.

### `POST /api/auth/logout`
- **Behavior:** Revokes current session token and clears the session cookie.
- **Status:** `200 OK` or `204 No Content`.

### `POST /api/auth/change-password`
- **Headers:** Authenticated session cookie.
- **Body:** `{ "currentPassword": string, "newPassword": string }`
- **Behavior:** Validates current password, updates `password_hash`, clears `must_change_password`, and revokes all active sessions for this account.
- **Status:** `204 No Content`.

### `POST /api/auth/reset-password`
- **Body:** `{ "token": string, "password": string }`
- **Behavior:** Verifies unexpired single-use reset token from `password_resets`. Hashes new password, clears `must_change_password`, removes the token, and revokes prior sessions.
- **Status:** `204 No Content`.

### `POST /api/auth/signup`
- **Body:** `{ "name": string, "email": string, "department": string, "password": string, "signatureDataUrl"?: string }`
- **Behavior:** Public self-registration (when enabled). Creates account with default `role_override = 'Employee'`, `company_grants = '[]'`, and `form_grants = '{}'`.
- **Status:** `204 No Content`.

---

## 3. Account Administration Endpoints (Super Admin Only)

All endpoints under `/api/admin/accounts` require an active session with `isSuperAdmin: true`. Non-superadmins receive `403 Forbidden`.

### `POST /api/admin/accounts`
- **Description:** Provision a new synthetic or employee account directly from the User Directory.
- **Body:**
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.test",
    "department": "Engineering",
    "password": "<secure-password>",
    "role": "Employee" | "Admin" | "IT" | "Finance",
    "mustChangePassword": boolean
  }
  ```
- **Policy & Defaults:**
  - `role`: Defaults to `'Employee'`.
  - `mustChangePassword`: Optional boolean. Defaults to `false` for direct test provisioning, but `true` is recommended for production onboarding.
  - Initial grants: `company_grants = '[]'`, `form_grants = '{}'`. The user cannot access companies or start forms until explicitly granted.
- **Response:** `201 Created` with `{ "id": string, "email": string, "name": string, "department": string, "role": string }`.

### `POST /api/admin/accounts/:id/reset-link`
- **Description:** Generate a secure one-time password reset link for an employee.
- **Behavior:** Creates a 32-byte cryptographic token valid for 30 minutes in `password_resets`.
- **Response:** `{ "link": "<APP_ORIGIN>/#reset=<token>" }`.

### `PUT /api/admin/accounts/:id/grants`
- **Description:** Update authorized legal entities and form initiation permissions.
- **Body:**
  ```json
  {
    "companyIds": ["PEW", "ICCL"],
    "formsByCompany": {
      "PEW": ["Administrative & Payment Request", "IT Request"],
      "ICCL": ["IT Request"]
    }
  }
  ```
- **Status:** `204 No Content`.

### `PUT /api/admin/accounts/:id/disable`
- **Description:** Toggle disabled status of an employee account.
- **Body:** `{ "disabled": boolean }`
- **Behavior:** When disabled (`is_disabled = 1`), revokes all active sessions and invalidates existing password reset links.
- **Status:** `204 No Content`.

---

## 4. Request & Workflow Endpoints

- **`GET /api/bootstrap`:** Returns authenticated user profile, accessible companies, public user directory (redacted of credentials and saved marks), and relevant workflow definitions.
- **`GET /api/requests?scope=PEG|PEW|ICCL|FSG`:** Returns list of requests filtered by legal company or group scope according to user's company grants.
- **`GET /api/requests/:id`:** Returns full request record including current revision, document version snapshots, attachments, and approval history.
- **`POST /api/requests`:** Creates and submits a new request. Requires company access and form initiation grant for the requested subsidiary. Snapshots workflow stages.
- **`POST /api/requests/:id/approve`:** Approves current assigned stage. Verifies assignment, company authorization, and optimistic concurrency `expectedRevision`. Stores signature bytes and appends history.
- **`POST /api/requests/:id/return`:** Returns request to requester for correction.
- **`POST /api/requests/:id/resubmit`:** Requester-only resubmission creating document version $N+1$ and resetting approval steps.
- **`POST /api/requests/:id/override`:** Final completion / bypass action executed by authorized final approver.
- **`POST /api/requests/:id/replace-signer`:** Proposes or activates replacement signers adhering to configured-backup, directory, or intermediate replacement policies.

---

## 5. Private Drafts & File Uploads

- **`GET /api/drafts/:companyId/:formType`:** Reads private draft for current user and company. Returns `{ "revision": number, "data": object | null }`.
- **`PUT /api/drafts/:companyId/:formType`:** Saves private draft with `{ "expectedRevision": number, "data": object }`. Mismatch returns 409 Conflict.
- **`DELETE /api/drafts/:companyId/:formType`:** Clears draft upon submission or cancellation.
- **File Validation:**
  - PNG/JPEG: Validated and decoded via `sharp` with a 16-million-pixel limit.
  - PDF: Parsed via `pdf-lib` with EOF requirement and page count limits (1–1000 pages). Encrypted PDFs rejected.

---

## 6. Company Branding & Signature Profiles

- **`GET /api/admin/company-branding`:** Super Admin read of company metadata, custom logos, and branding assets.
- **`PUT /api/admin/company-branding/:id`:** Super Admin update of company logo data URL (`logoDataUrl`).
- **`PATCH /api/me/signature`:** Update authenticated user's private saved signature mark (`signatureDataUrl`). Stored in `user_signatures`.

---

## 7. Email Outbox & Delivery Subsystem

- **`email_outbox` Table:** Stores outgoing notification records (`id`, `recipient_email`, `subject`, `html_body`, `status`, `attempts`, `created_at`, `sent_at`).
- **`GET /api/admin/email/outbox`:** Super Admin view of pending, sent, and failed email dispatches.
- **`POST /api/admin/email/process`:** Manually trigger immediate outbox processing.
