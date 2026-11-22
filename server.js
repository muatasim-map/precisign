// backend/src/index.ts
import dotenv from "dotenv";

// backend/src/sentry.ts
import * as Sentry from "@sentry/node";
var DATA_URL_REGEX = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g;
var TOKEN_REGEX = /([?&#](?:token|key|password|sig|reset)=)[^&#\s]+/gi;
var RESET_HASH_REGEX = /#reset=[^&#\s]+/gi;
function sanitizeUrl(url) {
  if (!url) return url;
  return url.replace(RESET_HASH_REGEX, "#reset=[REDACTED]").replace(TOKEN_REGEX, "$1[REDACTED]");
}
function sanitizeString(text2) {
  if (!text2) return text2;
  return text2.replace(DATA_URL_REGEX, "[IMAGE_DATA_REDACTED]").replace(TOKEN_REGEX, "$1[REDACTED]");
}
function filterSentryEvent(event2, hint) {
  const error = hint?.originalException;
  const status = error?.status ?? error?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return null;
  }
  delete event2.user;
  if (event2.request) {
    delete event2.request.cookies;
    delete event2.request.headers;
    delete event2.request.data;
    if (event2.request.url) {
      event2.request.url = sanitizeUrl(event2.request.url);
    }
  }
  if (event2.exception?.values) {
    for (const exception of event2.exception.values) {
      if (exception.value) {
        exception.value = sanitizeString(exception.value);
      }
    }
  }
  if (event2.breadcrumbs) {
    event2.breadcrumbs = event2.breadcrumbs.map((breadcrumb) => {
      if (breadcrumb.data?.url) {
        breadcrumb.data.url = sanitizeUrl(String(breadcrumb.data.url));
      }
      if (breadcrumb.data?.body) {
        delete breadcrumb.data.body;
      }
      if (breadcrumb.message) {
        breadcrumb.message = sanitizeString(breadcrumb.message);
      }
      return breadcrumb;
    });
  }
  return event2;
}
function initBackendSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || typeof dsn !== "string" || !dsn.trim()) {
    return;
  }
  Sentry.init({
    dsn: dsn.trim(),
    enabled: true,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    release: process.env.SENTRY_RELEASE || void 0,
    // Conservative Free-Tier Configuration:
    // Performance tracing disabled to minimize data volume and memory footprint
    tracesSampleRate: 0,
    beforeSend(event2, hint) {
      return filterSentryEvent(event2, hint);
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data?.url) {
        breadcrumb.data.url = sanitizeUrl(String(breadcrumb.data.url));
      }
      if (breadcrumb.data?.body) {
        delete breadcrumb.data.body;
      }
      if (breadcrumb.message) {
        breadcrumb.message = sanitizeString(breadcrumb.message);
      }
      return breadcrumb;
    }
  });
}
function captureBackendError(error, context) {
  if (!process.env.SENTRY_DSN) return;
  const status = typeof error?.status === "number" ? error.status : typeof error?.statusCode === "number" ? error.statusCode : context?.status;
  if (status && status >= 400 && status < 500) {
    return;
  }
  Sentry.withScope((scope) => {
    if (context?.route) scope.setTag("route", context.route);
    if (context?.code) scope.setTag("error_code", context.code);
    if (status) scope.setTag("http_status", String(status));
    Sentry.captureException(error);
  });
}

// backend/src/index.ts
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

// backend/src/db.ts
import { DatabaseSync } from "node:sqlite";
var schemaVersion = 14;
function readSchemaVersion(db2) {
  const version = db2.prepare("PRAGMA user_version").get().user_version;
  if (version > schemaVersion) throw new Error("Database schema is newer than this application.");
  return version;
}
function openDatabase(path) {
  const db2 = new DatabaseSync(path, { timeout: 5e3 });
  try {
    db2.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    if (readSchemaVersion(db2) < schemaVersion) {
      transaction(db2, () => migrate(db2, readSchemaVersion(db2)));
    }
    return db2;
  } catch (error) {
    db2.close();
    throw error;
  }
}
function migrate(db2, version) {
  if (version === 0) {
    db2.exec(`CREATE TABLE companies (id TEXT PRIMARY KEY CHECK(id IN ('PEW','ICCL','FSG')), name TEXT NOT NULL);
        INSERT INTO companies VALUES ('PEW','Precision Engineering Works'),('ICCL','Industrial Chemical & Contracting Ltd'),('FSG','Flexi Seal Gasket Co.');
        CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('Admin','General Manager','Director','IT','Finance','HR','Purchase')),
          department TEXT NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id),
          allowed_companies TEXT NOT NULL DEFAULT '[]', group_admin INTEGER NOT NULL DEFAULT 0 CHECK(group_admin IN (0,1)), password_hash TEXT NOT NULL);
        CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
        CREATE INDEX sessions_expiry ON sessions(expires_at);
        CREATE TABLE workflows (company_id TEXT NOT NULL REFERENCES companies(id), form_type TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), config TEXT NOT NULL, PRIMARY KEY(company_id,form_type));
        CREATE TABLE requests (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), requester_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), record TEXT NOT NULL);
        CREATE INDEX requests_company ON requests(company_id);
        CREATE TABLE drafts (user_id TEXT NOT NULL REFERENCES users(id), company_id TEXT NOT NULL REFERENCES companies(id), form_type TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), data TEXT NOT NULL, PRIMARY KEY(user_id,company_id,form_type));`);
  }
  if (version < 2) {
    db2.exec(`CREATE TABLE user_signatures (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, signature_data_url TEXT NOT NULL, signature_style_text TEXT NOT NULL);`);
  }
  if (version < 3) {
    db2.exec(`CREATE TABLE IF NOT EXISTS route_administrators (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);`);
  }
  if (version < 4) {
    db2.exec("UPDATE companies SET name='Insturmental Control Co Ltd' WHERE id='ICCL';");
  }
  if (version < 5) {
    db2.exec(`CREATE TABLE IF NOT EXISTS account_access (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      company_grants TEXT NOT NULL DEFAULT '[]'
    );
    CREATE VIEW IF NOT EXISTS account_profiles AS
      SELECT users.*, account_access.company_grants
      FROM users LEFT JOIN account_access ON account_access.user_id = users.id;`);
  }
  if (version < 6) {
    db2.exec(`ALTER TABLE account_access ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_super_admin IN (0,1));
      ALTER TABLE account_access ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0 CHECK(is_disabled IN (0,1));
      ALTER TABLE account_access ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
      ALTER TABLE account_access ADD COLUMN form_grants TEXT NOT NULL DEFAULT '{}';
      DROP VIEW account_profiles;
      CREATE VIEW account_profiles AS SELECT users.*, account_access.company_grants, account_access.form_grants,
        account_access.is_super_admin, account_access.is_disabled, account_access.must_change_password
        FROM users LEFT JOIN account_access ON account_access.user_id=users.id;`);
  }
  if (version < 7) {
    db2.exec(`CREATE TABLE password_resets (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL);`);
  }
  if (version < 8) {
    db2.exec(`CREATE TABLE IF NOT EXISTS company_logos (
      company_id TEXT PRIMARY KEY REFERENCES companies(id),
      logo_data_url TEXT NOT NULL
    );`);
  }
  if (version < 9) {
    db2.exec(`ALTER TABLE account_access ADD COLUMN role_override TEXT CHECK(role_override = 'Employee');
      DROP VIEW account_profiles;
      CREATE VIEW account_profiles AS SELECT users.*, account_access.company_grants, account_access.form_grants,
        account_access.is_super_admin, account_access.is_disabled, account_access.must_change_password, account_access.role_override
        FROM users LEFT JOIN account_access ON account_access.user_id=users.id;`);
  }
  if (version < 10) {
    db2.exec(`CREATE TABLE IF NOT EXISTS email_outbox (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'accepted', 'delivered', 'failed', 'failed_unconfirmed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      lease_token TEXT,
      lease_expires_at INTEGER,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      first_attempt_at INTEGER,
      last_attempt_at INTEGER,
      accepted_at INTEGER,
      delivered_at INTEGER,
      resend_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_email_outbox_poll ON email_outbox(status, next_attempt_at, lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_email_outbox_request ON email_outbox(request_id);
    ALTER TABLE account_access ADD COLUMN notification_email TEXT;
    DROP VIEW account_profiles;
    CREATE VIEW account_profiles AS SELECT users.*, account_access.company_grants, account_access.form_grants,
      account_access.is_super_admin, account_access.is_disabled, account_access.must_change_password, account_access.role_override,
      COALESCE(account_access.notification_email, users.email) AS notification_email
      FROM users LEFT JOIN account_access ON account_access.user_id=users.id;`);
  }
  if (version < 11) {
    db2.exec(`CREATE TABLE IF NOT EXISTS request_counters (
      company_id TEXT NOT NULL,
      form_code TEXT NOT NULL,
      year INTEGER NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (company_id, form_code, year)
    );`);
  }
  if (version < 12) {
    db2.exec(`CREATE TABLE IF NOT EXISTS access_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      permissions TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company_access_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id),
      role_ids TEXT NOT NULL,
      PRIMARY KEY (user_id, company_id)
    );
    INSERT OR IGNORE INTO access_roles VALUES
      ('requester', 'Requester', '["requester"]'),
      ('approver', 'Approver', '["approver"]'),
      ('cashier', 'Cashier', '["cashier"]'),
      ('finance', 'Finance processor', '["finance"]'),
      ('route-admin', 'Signing route manager', '["manage-routes"]');
    DROP VIEW account_profiles;
    CREATE VIEW account_profiles AS SELECT users.*, account_access.company_grants, account_access.form_grants,
      account_access.is_super_admin, account_access.is_disabled, account_access.must_change_password, account_access.role_override,
      COALESCE(account_access.notification_email, users.email) AS notification_email,
      (SELECT json_group_object(a.company_id, json((
        SELECT json_group_array(DISTINCT permission.value)
        FROM json_each(a.role_ids) assigned
        JOIN access_roles r ON r.id = assigned.value
        JOIN json_each(r.permissions) permission
      ))) FROM company_access_roles a WHERE a.user_id = users.id) AS company_permissions
      FROM users LEFT JOIN account_access ON account_access.user_id=users.id;`);
  }
  if (version < 13) {
    db2.exec(`CREATE TABLE IF NOT EXISTS submission_idempotency (
      key TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id),
      form_type TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_submission_idempotency_request ON submission_idempotency(request_id);`);
  }
  if (version < 14) db2.exec(`ALTER TABLE users ADD COLUMN job_title TEXT;
    ALTER TABLE users ADD COLUMN route_rights TEXT;`);
  if (version < schemaVersion) db2.exec(`PRAGMA user_version = ${schemaVersion};`);
}
function migrationStatements(version) {
  if (!Number.isInteger(version) || version < 0 || version > schemaVersion) {
    throw new Error("Invalid database schema version.");
  }
  const statements = [];
  migrate({ exec(sql) {
    statements.push(...sql.split(";").map((part) => part.trim()).filter(Boolean));
  } }, version);
  return statements;
}
function transaction(db2, work) {
  db2.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db2.exec("COMMIT");
    return result;
  } catch (error) {
    if (db2.isTransaction) db2.exec("ROLLBACK");
    throw error;
  }
}
function isDatabaseBusy(error) {
  if (!(error instanceof Error) || !("code" in error)) return false;
  if (typeof error.code === "string" && /^SQLITE_BUSY(?:_|$)/.test(error.code)) return true;
  return error.code === "ERR_SQLITE_ERROR" && "errcode" in error && typeof error.errcode === "number" && (error.errcode & 255) === 5;
}

// backend/src/asyncDatabase.ts
import { createClient } from "@libsql/client";
var READ_ONLY_INTROSPECTION_PRAGMAS = /* @__PURE__ */ new Set([
  "table_info",
  "table_xinfo",
  "index_list",
  "index_info",
  "index_xinfo",
  "foreign_key_list",
  "foreign_key_check",
  "quick_check",
  "integrity_check"
]);
var READ_ONLY_NO_ARG_PRAGMAS = /* @__PURE__ */ new Set([
  "user_version",
  "schema_version",
  "data_version",
  "application_id",
  "database_list",
  "collation_list",
  "compile_options",
  "table_list"
]);
function isReadOnlyPragma(strippedSql) {
  const withoutComments = strippedSql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim();
  const match = withoutComments.match(/^PRAGMA\s+(?:[a-z0-9_]+\.)?([a-z0-9_]+)(.*)$/i);
  if (!match) return false;
  const pragmaName = match[1].toLowerCase();
  const rest = match[2].trim().replace(/;$/, "").trim();
  if (rest.includes("=")) return false;
  if (READ_ONLY_INTROSPECTION_PRAGMAS.has(pragmaName)) {
    return rest === "" || /^\(\s*(?:'[^']*'|"[^"]*"|[a-z0-9_]+)\s*\)$/i.test(rest);
  }
  if (READ_ONLY_NO_ARG_PRAGMAS.has(pragmaName)) {
    return rest === "";
  }
  return false;
}
function isSafeToRetry(sql) {
  if (typeof sql !== "string") return false;
  const stripped = sql.replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s+)*/g, "");
  if (/^PRAGMA\b/i.test(stripped)) {
    return isReadOnlyPragma(stripped);
  }
  if (!/^(SELECT|EXPLAIN)\b/i.test(stripped)) {
    return false;
  }
  return !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|VACUUM)\b/i.test(stripped);
}
function openAsyncDatabase(url, authToken, clientOverride) {
  const client = clientOverride ?? createClient({ url, authToken });
  const execWithRetry = async (sql, args = []) => {
    if (!isSafeToRetry(sql)) {
      return await client.execute({ sql, args });
    }
    try {
      return await client.execute({ sql, args });
    } catch (err) {
      if (err?.code === "UND_ERR_SOCKET" || err?.cause && (err.cause.code === "UND_ERR_SOCKET" || err.cause.message?.includes("other side closed")) || err?.message && err.message.includes("fetch failed")) {
        await new Promise((r) => setTimeout(r, 200));
        return await client.execute({ sql, args });
      }
      throw err;
    }
  };
  return {
    execute: execWithRetry,
    async transaction(work) {
      let transaction2;
      try {
        transaction2 = await client.transaction("write");
      } catch (err) {
        if (err?.code === "UND_ERR_SOCKET" || err?.cause && (err.cause.code === "UND_ERR_SOCKET" || err.cause.message?.includes("other side closed")) || err?.message && err.message.includes("fetch failed")) {
          await new Promise((r) => setTimeout(r, 200));
          transaction2 = await client.transaction("write");
        } else {
          throw err;
        }
      }
      try {
        const result = await work({ execute: (sql, args = []) => transaction2.execute({ sql, args }) });
        await transaction2.commit();
        return result;
      } catch (error) {
        if (!transaction2.closed) {
          try {
            await transaction2.rollback();
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Database transaction rollback failed.");
          }
        }
        throw error;
      } finally {
        transaction2.close();
      }
    },
    close: () => client.close()
  };
}
async function migrateAsyncDatabase(db2) {
  await db2.transaction(async (connection) => {
    await connection.execute("CREATE TABLE IF NOT EXISTS precisign_schema_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)");
    await connection.execute(`CREATE TABLE IF NOT EXISTS request_counters (
      company_id TEXT NOT NULL,
      form_code TEXT NOT NULL,
      year INTEGER NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (company_id, form_code, year)
    )`);
    const stored = await connection.execute("SELECT version FROM precisign_schema_version WHERE id=1");
    const legacy = stored.rows.length ? null : await connection.execute("PRAGMA user_version");
    const version = Number(stored.rows[0]?.version ?? legacy?.rows[0]?.user_version);
    const statements = migrationStatements(version);
    for (const statement of statements) {
      if (!/^PRAGMA user_version\s*=/i.test(statement)) await connection.execute(statement);
    }
    if (statements.length) await connection.execute("INSERT INTO precisign_schema_version (id,version) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version", [schemaVersion]);
  });
}

// backend/src/attachmentStorage.ts
import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// shared/types/index.ts
var accessPermissions = ["requester", "approver", "cashier", "finance", "manage-routes"];

// shared/utils/companyAccess.ts
function canUserAccessCompany(user, companyId) {
  if (!user) return false;
  if (user.companyGrants !== void 0) return user.companyGrants.includes(companyId);
  if (user.isGroupAdmin || user.role === "Director" || user.role === "General Manager") {
    return true;
  }
  if (user.companyId === companyId) {
    return true;
  }
  if (user.allowedCompanyIds && user.allowedCompanyIds.includes(companyId)) {
    return true;
  }
  return false;
}
function hasCompanyPermission(user, companyId, permission, legacy) {
  return canUserAccessCompany(user, companyId) && (user.companyPermissions?.[companyId]?.includes(permission) ?? legacy);
}
function canBeAssignedApproval(user, companyId) {
  return hasCompanyPermission(user, companyId, "approver", true);
}
function canAppearAsSigner(user, company, form2, stageId) {
  return canBeAssignedApproval(user, company) && (user.routeRights?.[company]?.signerSteps?.[form2]?.includes(stageId) ?? true);
}
function canUserStartForm(user, companyId, formType) {
  return hasCompanyPermission(user, companyId, "requester", true) && (user.companyGrants === void 0 || user.formGrants?.[companyId]?.includes(formType) === true);
}

// shared/utils/rndFields.ts
var RND_FORM = "R&D Initiative";
var rndGroups = [
  {
    "id": "q3Freq",
    "sideContainer": "sideQ3Freq",
    "docContainer": "docQ3Freq",
    "singleSelect": true,
    "options": [
      "Daily",
      "Several times a week",
      "Weekly",
      "Monthly",
      "Occasionally",
      "One-time",
      "Other:"
    ]
  },
  {
    "id": "q3Rec",
    "sideContainer": "sideQ3Rec",
    "docContainer": "docQ3Rec",
    "singleSelect": true,
    "options": [
      "Yes",
      "No",
      "Not sure"
    ]
  },
  {
    "id": "q4Dur",
    "sideContainer": "sideQ4Dur",
    "docContainer": "docQ4Dur",
    "singleSelect": true,
    "options": [
      "Less than a month",
      "1\u20136 months",
      "6\u201312 months",
      "More than a year",
      "Not sure"
    ]
  },
  {
    "id": "q5Areas",
    "sideContainer": "sideQ5Areas",
    "docContainer": "docQ5Areas",
    "singleSelect": false,
    "options": [
      "Operational costs",
      "Production delays",
      "Productivity",
      "Quality / Rework",
      "Material wastage",
      "Equipment downtime",
      "Manpower dependency",
      "Manual / Repetitive work",
      "Customer complaints",
      "Safety",
      "Documentation / Reporting",
      "Business opportunities",
      "Other:"
    ]
  },
  {
    "id": "q8Mkt",
    "sideContainer": "sideQ8Mkt",
    "docContainer": "docQ8Mkt",
    "singleSelect": true,
    "options": [
      "Yes",
      "No",
      "Not sure"
    ]
  },
  {
    "id": "q9Barriers",
    "sideContainer": "sideQ9Barriers",
    "docContainer": "docQ9Barriers",
    "singleSelect": false,
    "options": [
      "Too expensive",
      "Does not meet requirements",
      "Difficult to integrate",
      "Requires process changes",
      "Requires specialised manpower / training",
      "Unsuitable operating environment",
      "Maintenance / Support limitations",
      "Data security concerns",
      "Not yet evaluated",
      "Other:"
    ]
  },
  {
    "id": "q10Prev",
    "sideContainer": "sideQ10Prev",
    "docContainer": "docQ10Prev",
    "singleSelect": true,
    "options": [
      "Yes",
      "No",
      "Not sure"
    ]
  },
  {
    "id": "q11Prop",
    "sideContainer": "sideQ11Prop",
    "docContainer": "docQ11Prop",
    "singleSelect": true,
    "options": [
      "Yes",
      "No",
      "Need technical assistance"
    ]
  },
  {
    "id": "q12Goals",
    "sideContainer": "sideQ12Goals",
    "docContainer": "docQ12Goals",
    "singleSelect": false,
    "options": [
      "Reduce cost",
      "Save time",
      "Improve quality",
      "Increase productivity",
      "Reduce manpower dependency",
      "Automate processes",
      "Improve safety / accuracy",
      "Develop a new product or service",
      "Other:"
    ]
  },
  {
    "id": "q13Domains",
    "sideContainer": "sideQ13Domains",
    "docContainer": "docQ13Domains",
    "singleSelect": false,
    "options": [
      "AI",
      "Automation / Robotics",
      "Software Development",
      "Mechanical / Engineering Development",
      "New Equipment / Technology",
      "Process Improvement",
      "Data Analytics",
      "Academic Research",
      "Not sure"
    ]
  },
  {
    "id": "fAttach",
    "sideContainer": "sideFAttach",
    "docContainer": "docFAttach",
    "singleSelect": false,
    "options": [
      "Photographs / Videos",
      "Drawings / Technical Documents",
      "Process Flowcharts",
      "Reports / Historical Records",
      "Cost Estimates",
      "Other:"
    ]
  },
  {
    "id": "hVerified",
    "sideContainer": "sideHVerified",
    "docContainer": "docHVerified",
    "singleSelect": true,
    "options": [
      "Yes",
      "No",
      "Further Information Required"
    ]
  },
  {
    "id": "hRecurring",
    "sideContainer": "sideHRecurring",
    "docContainer": "docHRecurring",
    "singleSelect": true,
    "options": [
      "Yes",
      "No",
      "To Be Confirmed"
    ]
  },
  {
    "id": "hImpact",
    "sideContainer": "sideHImpact",
    "docContainer": "docHImpact",
    "singleSelect": true,
    "options": [
      "High",
      "Medium",
      "Low"
    ]
  },
  {
    "id": "hFeas",
    "sideContainer": "sideHFeas",
    "docContainer": "docHFeas",
    "singleSelect": true,
    "options": [
      "High",
      "Medium",
      "Low",
      "Pending"
    ]
  },
  {
    "id": "hMkt",
    "sideContainer": "sideHMkt",
    "docContainer": "docHMkt",
    "singleSelect": true,
    "options": [
      "Available",
      "Not Identified",
      "Further Research"
    ]
  },
  {
    "id": "hApproach",
    "sideContainer": "sideHApproach",
    "docContainer": "docHApproach",
    "singleSelect": false,
    "options": [
      "Internal Solution",
      "University Collaboration",
      "External Vendor",
      "Further Study"
    ]
  },
  {
    "id": "hPriority",
    "sideContainer": "sideHPriority",
    "docContainer": "docHPriority",
    "singleSelect": true,
    "options": [
      "High",
      "Medium",
      "Low"
    ]
  },
  {
    "id": "hDecision",
    "sideContainer": "sideHDecision",
    "docContainer": "docHDecision",
    "singleSelect": true,
    "options": [
      "Validate",
      "Hold",
      "Reject",
      "More Information Required"
    ]
  }
];
var rndSections = [
  {
    "id": "A",
    "title": "A. Submission Details",
    "items": [
      {
        "kind": "text",
        "id": "inpSubRef",
        "label": "Submission Reference No.",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpSubDate",
        "label": "Date of Submission",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpCompany",
        "label": "Company / Division",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpDept",
        "label": "Department",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpEmpName",
        "label": "Employee Name & Designation",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpContact",
        "label": "Contact Details",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpProbTitle",
        "label": "Problem Title",
        "multiline": false
      }
    ]
  },
  {
    "id": "B",
    "title": "B. Problem Description (Q1 \u2013 Q4)",
    "items": [
      {
        "kind": "text",
        "id": "inpQ1",
        "label": "1. Describe the problem or challenge",
        "multiline": true
      },
      {
        "kind": "text",
        "id": "inpQ2",
        "label": "2. Describe an actual scenario or recent example",
        "multiline": true
      },
      {
        "kind": "choice",
        "id": "q3Freq",
        "label": "3. Frequency"
      },
      {
        "kind": "text",
        "id": "inpQ3FreqOther",
        "label": "Other frequency (if applicable)",
        "multiline": false
      },
      {
        "kind": "choice",
        "id": "q3Rec",
        "label": "Recurring?"
      },
      {
        "kind": "text",
        "id": "inpQ3Occur",
        "label": "Approx. no. of occurrences",
        "multiline": false
      },
      {
        "kind": "choice",
        "id": "q4Dur",
        "label": "4. How long has the problem existed?"
      }
    ]
  },
  {
    "id": "C",
    "title": "C. Business Impact (Q5 \u2013 Q6)",
    "items": [
      {
        "kind": "choice",
        "id": "q5Areas",
        "label": "5. What areas are affected? (Select all applicable)"
      },
      {
        "kind": "text",
        "id": "inpQ5Other",
        "label": "Other affected area...",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpImpTime",
        "label": "Time lost / frequency",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpImpManpower",
        "label": "Manpower involved",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpImpFinance",
        "label": "Financial impact",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpImpProd",
        "label": "Production / delivery impact",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpImpOther",
        "label": "Other measurable impact",
        "multiline": false
      }
    ]
  },
  {
    "id": "D",
    "title": "D. Existing Solutions & Market Research (Q7 \u2013 Q10)",
    "items": [
      {
        "kind": "text",
        "id": "inpQ7",
        "label": "7. How is the problem currently managed or addressed?",
        "multiline": true
      },
      {
        "kind": "choice",
        "id": "q8Mkt",
        "label": "8. Are ready-made solutions available in the market?"
      },
      {
        "kind": "market",
        "id": "marketRows",
        "label": "Market solutions"
      },
      {
        "kind": "choice",
        "id": "q9Barriers",
        "label": "9. If solutions exist, why are they not being adopted?"
      },
      {
        "kind": "text",
        "id": "inpQ9Other",
        "label": "Other reason...",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpQ9Exp",
        "label": "Explanation...",
        "multiline": true
      },
      {
        "kind": "choice",
        "id": "q10Prev",
        "label": "10. Have previous solutions been attempted?"
      },
      {
        "kind": "text",
        "id": "inpQ10Exp",
        "label": "If yes, explain what was tried and the outcome...",
        "multiline": true
      }
    ]
  },
  {
    "id": "E",
    "title": "E. Proposed Solution & Improvement (Q11 \u2013 Q13)",
    "items": [
      {
        "kind": "choice",
        "id": "q11Prop",
        "label": "11. Do you have a proposed solution or improvement idea?"
      },
      {
        "kind": "text",
        "id": "inpQ11Desc",
        "label": "If yes, describe it...",
        "multiline": true
      },
      {
        "kind": "choice",
        "id": "q12Goals",
        "label": "12. What should an ideal solution achieve?"
      },
      {
        "kind": "text",
        "id": "inpQ12Other",
        "label": "Other goal...",
        "multiline": false
      },
      {
        "kind": "choice",
        "id": "q13Domains",
        "label": "13. Which areas could help solve this problem?"
      }
    ]
  },
  {
    "id": "F",
    "title": "F & G. Supporting Info & Confirmation",
    "items": [
      {
        "kind": "choice",
        "id": "fAttach",
        "label": "F. Available attachments:"
      },
      {
        "kind": "text",
        "id": "inpFOther",
        "label": "Other attachment...",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpGSubBy",
        "label": "G. Submitted By",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpGDate",
        "label": "Date",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpGSigText",
        "label": "Submitter Signature (Typed or Image/Draw)",
        "multiline": false
      }
    ]
  },
  {
    "id": "H",
    "title": "H. R&D Team Evaluation \u2013 Internal Use Only",
    "items": [
      {
        "kind": "text",
        "id": "inpHRefDate",
        "label": "Problem Reference No. / Review Date",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpHEvalBy",
        "label": "Evaluated By",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpHDeptHead",
        "label": "Relevant Department Head",
        "multiline": false
      },
      {
        "kind": "choice",
        "id": "hVerified",
        "label": "Problem Verified?"
      },
      {
        "kind": "choice",
        "id": "hRecurring",
        "label": "Recurring Problem?"
      },
      {
        "kind": "choice",
        "id": "hImpact",
        "label": "Business Impact"
      },
      {
        "kind": "choice",
        "id": "hFeas",
        "label": "Technical Feasibility"
      },
      {
        "kind": "choice",
        "id": "hMkt",
        "label": "Market Solutions"
      },
      {
        "kind": "choice",
        "id": "hApproach",
        "label": "Recommended Approach"
      },
      {
        "kind": "choice",
        "id": "hPriority",
        "label": "Priority"
      },
      {
        "kind": "choice",
        "id": "hDecision",
        "label": "Evaluation Decision"
      },
      {
        "kind": "text",
        "id": "inpHComments",
        "label": "Evaluation Comments:",
        "multiline": true
      },
      {
        "kind": "text",
        "id": "inpHNextAction",
        "label": "Recommended Next Action:",
        "multiline": true
      },
      {
        "kind": "text",
        "id": "inpHRevBy",
        "label": "Reviewed By",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpHApproval",
        "label": "Approval / Recommendation",
        "multiline": false
      },
      {
        "kind": "text",
        "id": "inpHDate",
        "label": "Date",
        "multiline": false
      }
    ]
  }
];

// shared/utils/rndWorkflow.ts
var textFields = rndSections.flatMap((section) => section.items.filter((item) => item.kind === "text").map((item) => item.id));
var isEvaluationField = (id) => id.startsWith("inpH") || id.startsWith("h");
function validateRnd(value, evaluation) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Complete the R&D form.";
  const data = value;
  if (Object.keys(data).some((key) => !["fields", "choices", "marketRows"].includes(key)) || !data.fields || typeof data.fields !== "object" || Array.isArray(data.fields) || !data.choices || typeof data.choices !== "object" || Array.isArray(data.choices) || !Array.isArray(data.marketRows) || data.marketRows.length > 5) return "Invalid R&D fields.";
  for (const [id, text2] of Object.entries(data.fields)) {
    if (!textFields.includes(id) || typeof text2 !== "string" || text2.length > 2e3 || !evaluation && isEvaluationField(id) && text2.trim() || evaluation && !isEvaluationField(id)) return "Invalid R&D text field or evaluation permission.";
  }
  for (const [id, selected] of Object.entries(data.choices)) {
    const group = rndGroups.find((group2) => group2.id === id);
    if (!group || !Array.isArray(selected) || new Set(selected).size !== selected.length || group.singleSelect && selected.length > 1 || selected.some((option) => !group.options.includes(option)) || !evaluation && isEvaluationField(id) && selected.length || evaluation && !isEvaluationField(id)) return "Invalid R&D selection or evaluation permission.";
  }
  for (const row of data.marketRows) {
    if (!row || typeof row !== "object" || Object.keys(row).length !== 3 || ["sol", "sup", "web"].some((key) => typeof row[key] !== "string" || row[key].length > 300)) return "Invalid market solution row.";
  }
  if (evaluation && data.marketRows.length) return "Evaluation cannot change market research.";
  if (!evaluation && (!data.fields.inpProbTitle?.trim() || !data.fields.inpQ1?.trim())) return "Enter the problem title and description.";
}
function rndEvaluationComplete(data) {
  return !!data?.choices.hDecision?.length && !!data.fields.inpHNextAction?.trim();
}
function saveRndEvaluation(request, actor, evaluation) {
  if (!canUserAccessCompany(actor, request.companyId) || request.formType !== RND_FORM || request.status !== "Pending Approval" || request.approvalSteps.at(-1)?.assignedUserId !== actor.id || !request.formData.rnd) {
    return { success: false, error: "Only the assigned final approver can edit an open R&D evaluation." };
  }
  const error = validateRnd(evaluation, true);
  if (error) return { success: false, error };
  const at = (/* @__PURE__ */ new Date()).toISOString();
  const base = request.formData.rnd;
  const rnd = {
    fields: { ...Object.fromEntries(Object.entries(base.fields).filter(([key]) => !isEvaluationField(key))), ...evaluation.fields },
    choices: { ...Object.fromEntries(Object.entries(base.choices).filter(([key]) => !isEvaluationField(key))), ...evaluation.choices },
    marketRows: base.marketRows
  };
  return { success: true, updatedRequest: {
    ...request,
    updatedAt: at,
    formData: { ...request.formData, rnd, rndEvaluationUpdatedAfterSigning: request.approvalSteps.at(-1)?.status === "Approved" },
    rndEvaluationHistory: [...request.rndEvaluationHistory ?? [], { version: request.documentVersion, at, actorId: actor.id, actorName: actor.name, evaluation: structuredClone(evaluation) }],
    approvalHistory: [...request.approvalHistory, { id: crypto.randomUUID(), stepNumber: request.approvalSteps.length, actionByUserId: actor.id, actionByName: actor.name, actionByRole: actor.role, action: "Evaluation Updated", dateTime: at, version: request.documentVersion, comments: "Section H evaluation recorded separately from signatures." }]
  } };
}

// backend/src/requestValidation.ts
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
var RequestError = class extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
var fail = (message) => {
  throw new RequestError(400, message);
};
function fields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail("Invalid or protected fields.");
}
function text(value, max, required = true) {
  if (typeof value !== "string" || value.length > max || required && !value.trim()) fail("Invalid text field.");
  return value;
}
async function bytes(value, signature = false) {
  if (typeof value !== "string") fail("File data is required.");
  const match = value.match(/^data:(image\/png|image\/jpeg|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || signature && match[1] === "application/pdf") fail("Unsupported file type.");
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > (signature ? 2 : 5) * 1024 * 1024 || data.toString("base64") !== match[2]) fail("Invalid file data or size.");
  const valid = match[1] === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : match[1] === "image/jpeg" ? data[0] === 255 && data[1] === 216 && data[2] === 255 : data.subarray(0, 5).toString() === "%PDF-";
  if (!valid) fail("File content does not match its type.");
  try {
    if (match[1] === "application/pdf") {
      if (!/%%EOF\s*$/.test(data.subarray(-1024).toString("latin1"))) fail("Incomplete PDF.");
      const document = await PDFDocument.load(data, { throwOnInvalidObject: true, updateMetadata: false });
      const pages = document.getPages();
      if (!pages.length || pages.length > 1e3) fail("Invalid PDF page count.");
      for (const page of pages) {
        const { width, height } = page.getSize();
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) fail("Invalid PDF page.");
      }
    } else {
      const image = sharp(data, { failOn: "warning", limitInputPixels: 16e6 });
      const metadata = await image.metadata();
      if (metadata.format !== (match[1] === "image/png" ? "png" : "jpeg") || (metadata.pages ?? 1) !== 1) fail("Invalid image.");
      await image.raw().toBuffer();
    }
  } catch {
    fail("Unreadable or unsupported file content.");
  }
  return data;
}
async function attachments(value, actor, retained = []) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 20) fail("Invalid attachments.");
  let total = 0;
  const result = [];
  const used = /* @__PURE__ */ new Set();
  for (const file of value) {
    fields(file, ["id", "name", "sizeBytes", "sizeFormatted", "uploadedAt", "uploadedBy", "mimeType", "dataUrl", "downloadUrl"]);
    if (file.dataUrl === void 0) {
      const existing = retained.find((item) => item.id === file.id);
      if (!existing || used.has(existing.id)) return fail("Invalid retained attachment.");
      used.add(existing.id);
      total += existing.sizeBytes;
      if (total > 10 * 1024 * 1024) fail("Attachments exceed 10 MiB.");
      result.push(existing);
      continue;
    }
    const data = await bytes(file.dataUrl);
    total += data.length;
    if (total > 10 * 1024 * 1024) fail("Attachments exceed 10 MiB.");
    result.push({ id: randomUUID(), name: text(file.name, 200), sizeBytes: data.length, sizeFormatted: `${Math.ceil(data.length / 1024)} KB`, uploadedAt: (/* @__PURE__ */ new Date()).toISOString(), uploadedBy: actor, mimeType: file.dataUrl.slice(5, file.dataUrl.indexOf(";")), dataUrl: file.dataUrl });
  }
  return result;
}
function form(value, partial = false, combined = false, it = false, financial, rnd = false) {
  fields(value, ["dateOfRequest", "department", "priority", "workDescription", "documents", ...combined ? ["administrativePayment"] : [], ...it ? ["itRequest"] : [], ...financial ? [financial] : [], ...rnd ? ["rnd"] : []]);
  if (rnd) {
    const error = validateRnd(value.rnd, false);
    if (error) fail(error);
  }
  function amount(value2) {
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(text(value2, 12)) || Number(value2) <= 0) fail("Enter a positive amount in SAR.");
  }
  if (financial === "cashVoucher") {
    const voucher = value.cashVoucher;
    fields(voucher, ["payee", "recipientUserId", "amount", "amountInWords", "source"]);
    text(voucher.payee, 200);
    text(voucher.recipientUserId, 150);
    text(voucher.amountInWords, 250);
    amount(voucher.amount);
    if (!["Admin petty cash", "Accounts cash"].includes(voucher.source)) fail("Select a cash source.");
  }
  if (financial === "expenseClaim") {
    const claim = value.expenseClaim;
    fields(claim, ["designation", "project", "lines"]);
    text(claim.designation, 150);
    text(claim.project, 200);
    if (!Array.isArray(claim.lines) || claim.lines.length < 1 || claim.lines.length > 20) fail("Enter between 1 and 20 expense lines.");
    for (const line of claim.lines) {
      fields(line, ["date", "particulars", "amount", "noBillReason", "receiptIndex"]);
      const date = text(line.date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail("Enter a valid expense date.");
      text(line.particulars, 1e3);
      amount(line.amount);
      if (line.noBillReason !== void 0) text(line.noBillReason, 500);
      if (line.receiptIndex !== void 0 && (!Number.isSafeInteger(line.receiptIndex) || line.receiptIndex < 0)) fail("Invalid receipt selection.");
    }
  }
  if (it && (!partial || value.itRequest !== void 0)) {
    fields(value.itRequest, ["requestType", "justification"]);
    text(value.itRequest.requestType, 150);
    text(value.itRequest.justification, 1e4);
  }
  if (combined && (!partial || value.administrativePayment !== void 0)) {
    const details = value.administrativePayment;
    fields(details, ["documentDescription", "payment"]);
    text(details.documentDescription, 1e3, false);
    if (details.payment !== void 0) {
      const payment = details.payment;
      fields(payment, ["amount", "transferMode", "transferDetails", "purpose", "otherPurpose"]);
      amount(payment.amount);
      if (!["Bank", "Cash", "Cheque"].includes(payment.transferMode)) fail("Invalid transfer method.");
      if (payment.transferDetails !== void 0) text(payment.transferDetails, 200, false);
      if (!["Government Payment", "Advance Cash", "Other"].includes(payment.purpose)) fail("Invalid payment purpose.");
      if (payment.purpose === "Other" || payment.otherPurpose !== void 0) text(payment.otherPurpose, 500, payment.purpose === "Other");
    }
  }
  for (const [key, max] of [["dateOfRequest", 50], ["department", 150], ["workDescription", 2e4]]) {
    if (!partial || value[key] !== void 0) text(value[key], max, !partial);
  }
  if ((!partial || value.priority !== void 0) && !["Urgent", "Medium", "Low"].includes(value.priority)) fail("Invalid priority.");
  const keys = ["onlineDocumentChamber", "physicalDocumentChamber", "companyDocumentAjeer", "employeeSalaryCertificate", "permanentEmploymentVisa", "workVisitVisa", "businessVisitVisa", "agencyWakala", "others"];
  if (partial && value.documents === void 0) return value;
  fields(value.documents, [...keys, "othersDescription"]);
  if (keys.some((key) => typeof value.documents[key] !== "boolean")) fail("Invalid document checklist.");
  text(value.documents.othersDescription, 1e3, false);
  return value;
}

// backend/src/attachmentStorage.ts
var prefix = "r2:precisign-attachments/v1/";
var digest = (value) => createHash("sha256").update(value).digest("hex");
function attachmentIdentity(value) {
  if (!value || value.startsWith(prefix)) return value;
  return prefix + digest(value);
}
function createAttachmentStorage(env = process.env) {
  const {
    PRECISIGN_R2_ENDPOINT: endpoint,
    PRECISIGN_R2_BUCKET: bucket,
    PRECISIGN_R2_ACCESS_KEY_ID: accessKeyId,
    PRECISIGN_R2_SECRET_ACCESS_KEY: secretAccessKey
  } = env;
  if (!endpoint && !bucket && !accessKeyId && !secretAccessKey) return void 0;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Incomplete R2 attachment configuration.");
  const client = new S3Client({
    endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });
  async function upload(file) {
    if (!file.dataUrl) throw new Error("Missing validated attachment data.");
    const reference = attachmentIdentity(file.dataUrl);
    const binary = Buffer.from(file.dataUrl.slice(file.dataUrl.indexOf(",") + 1), "base64");
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: reference.slice(3),
        Body: binary,
        ContentType: file.mimeType
      }), { abortSignal: AbortSignal.timeout(15e3) });
      file.dataUrl = reference;
    } catch {
      throw new RequestError(503, "Attachment storage is unavailable. Try again.");
    }
  }
  async function download(file) {
    if (!file.dataUrl?.startsWith(prefix)) return;
    const reference = file.dataUrl;
    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: reference.slice(3)
      }), { abortSignal: AbortSignal.timeout(15e3) });
      if (!response.Body || response.ContentLength !== file.sizeBytes) throw new Error("Unexpected attachment size.");
      const binary = Buffer.from(await response.Body.transformToByteArray());
      const dataUrl = "data:" + file.mimeType + ";base64," + binary.toString("base64");
      if (attachmentIdentity(dataUrl) !== reference) throw new Error("Attachment integrity check failed.");
      file.dataUrl = dataUrl;
    } catch {
      throw new RequestError(503, "Attachment storage is unavailable. Try again.");
    }
  }
  async function deleteObject(reference) {
    if (!reference?.startsWith(prefix)) return;
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: reference.slice(3)
      }), { abortSignal: AbortSignal.timeout(15e3) });
    } catch {
    }
  }
  return { upload, download, deleteObject };
}
function attachmentMetadata(record) {
  function metadata(file, version) {
    const { dataUrl, ...info } = file;
    return {
      ...info,
      downloadUrl: dataUrl ? `/api/requests/${encodeURIComponent(record.id)}/attachments/${version}/${encodeURIComponent(file.id)}` : void 0
    };
  }
  return {
    ...record,
    attachments: (record.attachments || []).map((file) => metadata(file, record.documentVersion)),
    attachmentVersions: record.attachmentVersions?.map((version) => ({
      ...version,
      attachments: (version.attachments || []).map((file) => metadata(file, version.version))
    })),
    versionAttachmentSets: record.versionAttachmentSets?.map((set) => ({
      ...set,
      attachments: (set.attachments || []).map((file) => metadata(file, set.documentVersion))
    })),
    financeHoldHistory: record.financeHoldHistory?.map((entry) => ({
      ...entry,
      attachment: entry.attachment && metadata(entry.attachment, entry.documentVersion)
    }))
  };
}

// backend/src/app.ts
import express3 from "express";
import { randomBytes as randomBytes3 } from "node:crypto";

// shared/utils/historicalEvidence.ts
function revision(request) {
  return request.revision ?? 1;
}
function attachmentSet(request) {
  const existing = request.versionAttachmentSets?.find((set2) => set2.documentVersion === request.documentVersion && JSON.stringify(set2.attachments) === JSON.stringify(request.attachments));
  const set = existing ?? { id: crypto.randomUUID(), documentVersion: request.documentVersion, attachments: structuredClone(request.attachments) };
  return { set, sets: existing ? request.versionAttachmentSets : [...request.versionAttachmentSets ?? [], set] };
}
function captureApproval(before, after, actor, step, signatureDataUrl, recordedAt) {
  const { set, sets } = attachmentSet(before);
  const state = {
    id: crypto.randomUUID(),
    documentVersion: before.documentVersion,
    requestRevision: revision(before),
    formData: structuredClone(before.formData),
    attachmentSetId: set.id,
    approvalSteps: structuredClone(before.approvalSteps)
  };
  return {
    ...after,
    versionAttachmentSets: sets,
    signedDocumentStates: [...before.signedDocumentStates ?? [], state],
    approvalEvidence: [...before.approvalEvidence ?? [], {
      id: crypto.randomUUID(),
      requestId: before.id,
      documentVersion: before.documentVersion,
      requestRevision: revision(before),
      stepId: step.stageId,
      stepNumber: step.stageNumber,
      decision: "approved",
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      recordedAt,
      signatureDataUrl,
      documentStateId: state.id
    }]
  };
}
function attachmentsForVersion(request, version) {
  if (version === request.documentVersion) return request.attachments;
  const frozen = [...request.frozenVersionPresentations ?? []].reverse().find((item) => item.documentVersion === version);
  return (frozen && request.versionAttachmentSets?.find((set) => set.id === frozen.attachmentSetId && set.documentVersion === version)?.attachments) ?? request.attachmentVersions?.find((snapshot) => snapshot.version === version)?.attachments;
}
function freezeVersion(request, disposition) {
  const { set, sets } = attachmentSet(request);
  const presentation = {
    documentVersion: request.documentVersion,
    frozenAtRevision: revision(request),
    frozenAt: request.updatedAt,
    disposition,
    formData: structuredClone(request.formData),
    attachmentSetId: set.id,
    approvalSteps: structuredClone(request.approvalSteps),
    processing: structuredClone(request.processing)
  };
  return {
    ...request,
    versionAttachmentSets: sets,
    frozenVersionPresentations: [...request.frozenVersionPresentations ?? [], presentation],
    versionSnapshots: request.versionSnapshots.map((snapshot) => snapshot.version === request.documentVersion ? { ...snapshot, formData: structuredClone(request.formData) } : snapshot)
  };
}

// backend/src/reads.ts
import { Router as Router2 } from "express";

// shared/utils/processorHandoff.ts
function processorTaskLabels(form2) {
  switch (form2) {
    case "Administrative & Payment Request":
      return { finance: "Accounts", admin: "Admin fulfillment" };
    case "IT Request":
      return { it: "IT fulfillment" };
    case "Cash Voucher":
      return { cashier: "Cash payout" };
    case "Expense Claim":
      return { finance: "Expense settlement" };
    case "R&D Initiative":
      return { rnd: "R&D follow-up" };
    default:
      return { admin: "Admin fulfillment" };
  }
}
function canAppearAsProcessor(user, company, form2, taskId) {
  return canUserAccessCompany(user, company) && user.routeRights?.[company]?.processorTasks?.[form2]?.includes(taskId) === true;
}
function assignedProcessorIds(record) {
  return [...new Set(record.processorHandoff?.flatMap((task) => task.userIds) ?? [])];
}
function hasProcessorHandoff(record, userId) {
  return record.status === "Approved" && assignedProcessorIds(record).includes(userId);
}
function hasReadHandoff(record, userId) {
  return record.processorReads?.some((read) => read.userId === userId && read.version === record.documentVersion) === true;
}
function resolveProcessorChoices(workflow, users, choices) {
  if (!workflow.processorTasks?.length) {
    if (choices !== void 0) throw new Error("Processors have not been configured for this form.");
    return void 0;
  }
  if (choices !== void 0 && (!choices || typeof choices !== "object" || Array.isArray(choices) || Object.keys(choices).some((id) => !workflow.processorTasks.some((task) => task.id === id)))) {
    throw new Error("Review the selected processors.");
  }
  return workflow.processorTasks.map((task) => {
    const selected = choices === void 0 ? task.suggestedUserIds : choices[task.id];
    const eligible = users.filter((user) => canAppearAsProcessor(user, workflow.companyId, workflow.formType, task.id));
    const label = processorTaskLabels(workflow.formType)[task.id];
    if (!eligible.length) throw new Error(`Ask a route administrator to configure ${label} for ${workflow.companyId} \xB7 ${workflow.formType}.`);
    if (!Array.isArray(selected) || !selected.length || selected.length > 20 || new Set(selected).size !== selected.length || selected.some((id) => !eligible.some((user) => user.id === id))) throw new Error(`Choose at least one eligible processor for ${label}.`);
    return { taskId: task.id, userIds: selected };
  });
}

// shared/utils/routeAccess.ts
function canReadPreciRoute(user, request) {
  return canUserAccessCompany(user, request.companyId) && Boolean(
    user.isGroupAdmin || user.role === "Director" || user.role === "General Manager" || user.canReplaceFinalApprover || hasProcessorHandoff(request, user.id) || request.requesterId === user.id || request.formType === "Cash Voucher" && request.status === "Approved" && !!request.processing?.cashPayout && request.formData.cashVoucher?.recipientUserId === user.id || request.approvalSteps?.some((step) => step.assignedUserId === user.id) || request.formerSignerIds?.includes(user.id) || request.pendingReplacement?.newUserId === user.id || request.workflowConfig?.processingUserIds?.includes(user.id)
  );
}

// shared/utils/companyDisplay.ts
var ICCL_DISPLAY_NAME = "Insturmental Control Co Ltd";
function currentCompanyDisplay(company) {
  return company.id === "ICCL" ? { ...company, name: ICCL_DISPLAY_NAME, fullName: `ICCL - ${ICCL_DISPLAY_NAME}` } : company;
}

// shared/utils/passwordPolicy.ts
var PASSWORD_MIN = 5;
var PASSWORD_MAX = 1024;
var sameAsEmail = (password, email) => {
  if (!email) return false;
  const value = password.trim().toLowerCase();
  const address = email.trim().toLowerCase();
  return value === address || address.includes("@") && value === address.split("@")[0];
};
function passwordProblem(password, email) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (sameAsEmail(password, email)) return "Don\u2019t use your email address as your password.";
  return null;
}

// backend/src/auth.ts
import { randomBytes, randomUUID as randomUUID2, scrypt as derive, timingSafeEqual, createHash as createHash2 } from "node:crypto";
import { promisify } from "node:util";
var scrypt = promisify(derive);
var sessionLifetime = 12 * 60 * 60 * 1e3;
var tokenHash = (token) => createHash2("sha256").update(token).digest("hex");
var normalizeEmail = (email) => email.trim().toLowerCase();
async function hashPassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) throw new Error(`Password must contain ${PASSWORD_MIN}\u2013${PASSWORD_MAX} characters.`);
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || password.length > 1024) return false;
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const actual = await scrypt(password, parts[1], 64);
  return timingSafeEqual(actual, Buffer.from(parts[2], "hex"));
}
function safeProfile(row) {
  const name = String(row.name);
  return {
    id: String(row.id),
    name,
    email: String(row.email),
    notificationEmail: row.notification_email ? String(row.notification_email) : String(row.email),
    role: row.role_override ?? row.role,
    department: String(row.department),
    companyId: row.company_id,
    allowedCompanyIds: JSON.parse(String(row.allowed_companies)),
    jobTitle: typeof row.job_title === "string" ? row.job_title : void 0,
    routeRights: typeof row.route_rights === "string" ? JSON.parse(row.route_rights) : void 0,
    companyGrants: typeof row.company_grants === "string" ? JSON.parse(row.company_grants) : void 0,
    companyPermissions: typeof row.company_permissions === "string" ? JSON.parse(row.company_permissions) : void 0,
    formGrants: typeof row.form_grants === "string" ? JSON.parse(row.form_grants) : void 0,
    isSuperAdmin: row.is_super_admin === 1,
    mustChangePassword: row.must_change_password === 1,
    isGroupAdmin: row.group_admin === 1,
    canReplaceFinalApprover: row.route_admin === 1,
    initials: name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
    avatarColor: "#365C78"
  };
}
async function registerAccount(db2, input, options) {
  fields(input, ["name", "email", "department", "password", "signatureDataUrl"]);
  const body = input;
  const name = text(body.name, 150).trim();
  const department = text(body.department, 150).trim();
  const email = normalizeEmail(text(body.email, 254));
  const password = text(body.password, 1024, false);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError(400, "Invalid account details.");
  const weak = passwordProblem(password, email);
  if (weak) throw new RequestError(400, weak, "PASSWORD_POLICY");
  const signature = body.signatureDataUrl;
  if (signature !== void 0) await bytes(signature, true);
  const hash = await hashPassword(password);
  const id = randomUUID2();
  const role = options?.role ?? "Employee";
  const storedRole = role === "Employee" ? "Admin" : role;
  const roleOverride = role === "Employee" ? "Employee" : null;
  const mustChange = options?.mustChangePassword ? 1 : 0;
  if ("prepare" in db2) transaction(db2, () => {
    if (options?.requireSuperAdmin) {
      options.requireSuperAdmin();
    }
    const result = db2.prepare(`INSERT INTO users (id,email,name,role,department,company_id,password_hash)
      VALUES (?, ?, ?, ?, ?, 'PEW', ?) ON CONFLICT(email) DO NOTHING`).run(id, email, name, storedRole, department, hash);
    if (result.changes === 0) throw new RequestError(409, "Account could not be created.");
    db2.prepare("INSERT INTO account_access (user_id,role_override,must_change_password) VALUES (?,?,?)").run(id, roleOverride, mustChange);
    db2.prepare("INSERT INTO company_access_roles SELECT ?, id, '[]' FROM companies").run(id);
    if (typeof signature === "string") {
      db2.prepare("INSERT INTO user_signatures VALUES (?, ?, ?)").run(id, signature, name);
    }
  });
  else await db2.transaction(async (tx) => {
    if (options?.requireSuperAdmin) {
      await options.requireSuperAdmin(tx);
    }
    const result = await tx.execute(`INSERT INTO users (id,email,name,role,department,company_id,password_hash)
      VALUES (?, ?, ?, ?, ?, 'PEW', ?) ON CONFLICT(email) DO NOTHING`, [id, email, name, storedRole, department, hash]);
    if (result.rowsAffected === 0) throw new RequestError(409, "Account could not be created.");
    await tx.execute("INSERT INTO account_access (user_id,role_override,must_change_password) VALUES (?,?,?)", [id, roleOverride, mustChange]);
    await tx.execute("INSERT INTO company_access_roles SELECT ?, id, '[]' FROM companies", [id]);
    if (typeof signature === "string") await tx.execute("INSERT INTO user_signatures VALUES (?, ?, ?)", [id, signature, name]);
  });
  return { id, email, name, department, role };
}
function createSession(db2, userId, now = Date.now()) {
  const token = randomBytes(32).toString("hex");
  db2.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db2.prepare("INSERT INTO sessions VALUES (?,?,?)").run(tokenHash(token), userId, now + sessionLifetime);
  return token;
}
async function signIn(db2, email, password, dummyHash, previousToken, now) {
  const credentials = db2.prepare("SELECT id, password_hash FROM users WHERE email=?").get(normalizeEmail(email));
  const valid = await verifyPassword(password, credentials ? String(credentials.password_hash) : dummyHash);
  if (!credentials || !valid) return null;
  return transaction(db2, () => {
    const current = db2.prepare("SELECT id FROM account_profiles WHERE id=? AND email=? AND password_hash=? AND COALESCE(is_disabled,0)=0").get(credentials.id, normalizeEmail(email), credentials.password_hash);
    if (!current) return null;
    const issuedAt = now();
    if (previousToken) revokeSession(db2, previousToken);
    const token = createSession(db2, String(current.id), issuedAt);
    const user = sessionUser(db2, token, issuedAt);
    if (!user) throw new Error("New session could not be loaded.");
    return { token, user };
  });
}
function revokeSession(db2, token) {
  db2.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
}
var sessionUserSql = "SELECT profile.*, EXISTS(SELECT 1 FROM route_administrators WHERE user_id=profile.id) AS route_admin FROM sessions JOIN account_profiles profile ON profile.id=sessions.user_id WHERE token_hash=? AND expires_at>? AND COALESCE(profile.is_disabled,0)=0";
function sessionUser(db2, token, now = Date.now()) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db2.prepare(sessionUserSql).get(tokenHash(token), now);
  return row ? safeProfile(row) : null;
}
async function sessionUserAsync(db2, token, now = Date.now()) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await db2.execute(sessionUserSql, [tokenHash(token), now]);
  return result.rows[0] ? safeProfile(result.rows[0]) : null;
}
async function signInAsync(db2, email, password, dummyHash, previousToken, now) {
  const credentials = (await db2.execute("SELECT id, password_hash FROM users WHERE email=?", [normalizeEmail(email)])).rows[0];
  const valid = await verifyPassword(password, credentials ? String(credentials.password_hash) : dummyHash);
  if (!credentials || !valid) return null;
  return db2.transaction(async (tx) => {
    const current = (await tx.execute(
      "SELECT id FROM account_profiles WHERE id=? AND email=? AND password_hash=? AND COALESCE(is_disabled,0)=0",
      [String(credentials.id), normalizeEmail(email), String(credentials.password_hash)]
    )).rows[0];
    if (!current) return null;
    const issuedAt = now();
    if (previousToken) await tx.execute("DELETE FROM sessions WHERE token_hash=?", [tokenHash(previousToken)]);
    await tx.execute("DELETE FROM sessions WHERE expires_at <= ?", [issuedAt]);
    const token = randomBytes(32).toString("hex");
    await tx.execute("INSERT INTO sessions VALUES (?,?,?)", [tokenHash(token), String(current.id), issuedAt + sessionLifetime]);
    const user = await sessionUserAsync(tx, token, issuedAt);
    if (!user) throw new Error("New session could not be loaded.");
    return { token, user };
  });
}
async function changePassword(db2, userId, currentPassword, newPassword, requireCurrentUser) {
  const row = db2.prepare("SELECT password_hash, email FROM users WHERE id=?").get(userId);
  if (!row || !await verifyPassword(currentPassword, String(row.password_hash))) throw new RequestError(403, "Invalid credentials.");
  const weak = passwordProblem(newPassword, String(row.email));
  if (weak) throw new RequestError(400, weak, "PASSWORD_POLICY");
  const hash = await hashPassword(newPassword);
  transaction(db2, () => {
    requireCurrentUser();
    const result = db2.prepare("UPDATE users SET password_hash=? WHERE id=? AND password_hash=?").run(hash, userId, row.password_hash);
    if (result.changes !== 1) throw new RequestError(409, "Credentials changed.");
    db2.prepare("UPDATE account_access SET must_change_password=0 WHERE user_id=?").run(userId);
    db2.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
    db2.prepare("DELETE FROM password_resets WHERE user_id=?").run(userId);
  });
}
async function changePasswordAsync(db2, userId, currentPassword, newPassword, requireCurrentUser) {
  const row = (await db2.execute("SELECT password_hash, email FROM users WHERE id=?", [userId])).rows[0];
  if (!row || !await verifyPassword(currentPassword, String(row.password_hash))) throw new RequestError(403, "Invalid credentials.");
  const weak = passwordProblem(newPassword, String(row.email));
  if (weak) throw new RequestError(400, weak, "PASSWORD_POLICY");
  const hash = await hashPassword(newPassword);
  await db2.transaction(async (tx) => {
    const user = await requireCurrentUser(tx);
    if (user.id !== userId) throw new RequestError(403, "Invalid credentials.");
    const result = await tx.execute("UPDATE users SET password_hash=? WHERE id=? AND password_hash=?", [hash, userId, String(row.password_hash)]);
    if (result.rowsAffected !== 1) throw new RequestError(409, "Credentials changed.");
    await tx.execute("UPDATE account_access SET must_change_password=0 WHERE user_id=?", [userId]);
    await tx.execute("DELETE FROM sessions WHERE user_id=?", [userId]);
    await tx.execute("DELETE FROM password_resets WHERE user_id=?", [userId]);
  });
}
async function resetPassword(db2, token, password, now) {
  const invalid = () => new RequestError(400, "Reset link is invalid or expired.");
  if (!/^[a-f0-9]{64}$/.test(token)) throw invalid();
  if (passwordProblem(password)) throw new RequestError(400, passwordProblem(password), "PASSWORD_POLICY");
  const hash = tokenHash(token);
  const eligible = () => db2.prepare(`SELECT r.user_id, p.email FROM password_resets r JOIN account_profiles p ON p.id=r.user_id
    WHERE r.token_hash=? AND r.expires_at>? AND COALESCE(p.is_disabled,0)=0`).get(hash, now());
  const target = eligible();
  if (!target) throw invalid();
  const weak = passwordProblem(password, String(target.email));
  if (weak) throw new RequestError(400, weak, "PASSWORD_POLICY");
  const passwordHash = await hashPassword(password);
  transaction(db2, () => {
    const row = eligible();
    if (!row) throw invalid();
    db2.prepare("DELETE FROM password_resets WHERE token_hash=?").run(hash);
    db2.prepare("UPDATE users SET password_hash=? WHERE id=?").run(passwordHash, row.user_id);
    db2.prepare("UPDATE account_access SET must_change_password=0 WHERE user_id=?").run(row.user_id);
    db2.prepare("DELETE FROM sessions WHERE user_id=?").run(row.user_id);
  });
}
async function resetPasswordAsync(db2, token, password, now) {
  const invalid = () => new RequestError(400, "Reset link is invalid or expired.");
  if (!/^[a-f0-9]{64}$/.test(token)) throw invalid();
  if (passwordProblem(password)) throw new RequestError(400, passwordProblem(password), "PASSWORD_POLICY");
  const hash = tokenHash(token);
  const sql = `SELECT r.user_id, p.email FROM password_resets r JOIN account_profiles p ON p.id=r.user_id
    WHERE r.token_hash=? AND r.expires_at>? AND COALESCE(p.is_disabled,0)=0`;
  const target = (await db2.execute(sql, [hash, now()])).rows[0];
  if (!target) throw invalid();
  const weak = passwordProblem(password, String(target.email));
  if (weak) throw new RequestError(400, weak, "PASSWORD_POLICY");
  const passwordHash = await hashPassword(password);
  await db2.transaction(async (tx) => {
    const row = (await tx.execute(sql, [hash, now()])).rows[0];
    if (!row) throw invalid();
    const userId = String(row.user_id);
    await tx.execute("DELETE FROM password_resets WHERE token_hash=?", [hash]);
    await tx.execute("UPDATE users SET password_hash=? WHERE id=?", [passwordHash, userId]);
    await tx.execute("UPDATE account_access SET must_change_password=0 WHERE user_id=?", [userId]);
    await tx.execute("DELETE FROM sessions WHERE user_id=?", [userId]);
  });
}
async function sessionExpiry(db2, token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const sql = "SELECT expires_at FROM sessions WHERE token_hash=?";
  const row = "prepare" in db2 ? db2.prepare(sql).get(tokenHash(token)) : (await db2.execute(sql, [tokenHash(token)])).rows[0];
  return row ? Number(row.expires_at) : null;
}

// backend/src/documentPdf.ts
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
async function renderDocumentPdf(origin2, requestId, version, updatedAt, token) {
  const url = new URL("/document-export", origin2);
  url.searchParams.set("request", requestId);
  url.searchParams.set("version", String(version));
  const executablePath = process.env.PRECISIGN_PDF_CHROMIUM;
  const browser = await chromium.launch({
    executablePath,
    channel: !executablePath && !existsSync(chromium.executablePath()) && process.platform === "win32" ? "msedge" : void 0,
    timeout: 25e3
  });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.addCookies([{ name: "precisign_session", value: token, url: origin2, httpOnly: true }]);
    await context.route("**/*", (route) => {
      const destination = new URL(route.request().url());
      return destination.origin === origin2 ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(25e3);
    await page.goto(url.href);
    const ready = page.locator("[data-pdf-ready]");
    await ready.or(page.locator("[data-pdf-error]")).waitFor();
    if (!await ready.count()) throw new RequestError(404, "Document version unavailable.");
    if (await ready.getAttribute("data-request-updated-at") !== updatedAt) {
      throw new RequestError(409, "Request changed during export.", "REQUEST_CONFLICT");
    }
    return await page.pdf({ displayHeaderFooter: false, preferCSSPageSize: true, printBackground: true, tagged: true });
  } finally {
    await browser.close();
  }
}

// backend/src/profile.ts
import { Router } from "express";
async function ownSignatureAsync(db2, userId) {
  const result = await db2.execute("SELECT signature_data_url,signature_style_text FROM user_signatures WHERE user_id=?", [userId]);
  const row = result.rows[0];
  return row ? { signatureDataUrl: String(row.signature_data_url), signatureStyleText: String(row.signature_style_text) } : {};
}
async function saveOwnSignatureAsync(db2, requireCurrentUser, signature, style) {
  return db2.transaction(async (tx) => {
    const actor = await requireCurrentUser(tx);
    if (style !== actor.name) return null;
    await tx.execute("INSERT INTO user_signatures VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET signature_data_url=excluded.signature_data_url, signature_style_text=excluded.signature_style_text", [actor.id, signature, style]);
    return { ...actor, ...await ownSignatureAsync(tx, actor.id) };
  });
}
function ownSignature(db2, userId) {
  const row = db2.prepare("SELECT signature_data_url,signature_style_text FROM user_signatures WHERE user_id=?").get(userId);
  return row ? { signatureDataUrl: String(row.signature_data_url), signatureStyleText: String(row.signature_style_text) } : {};
}
function profileRoutes(db2) {
  const router = Router();
  router.patch("/me/signature", async (req, res, next) => {
    try {
      fields(req.body, ["signatureDataUrl", "signatureStyleText"]);
      if (req.body.signatureDataUrl === null && req.body.signatureStyleText === void 0) {
        const actor = "prepare" in db2 ? transaction(db2, () => {
          const current = res.locals.requireCurrentUser();
          db2.prepare("DELETE FROM user_signatures WHERE user_id=?").run(current.id);
          return current;
        }) : await db2.transaction(async (tx) => {
          const current = await res.locals.requireCurrentUserAsync(tx);
          await tx.execute("DELETE FROM user_signatures WHERE user_id=?", [current.id]);
          return current;
        });
        const { signatureDataUrl: _image, signatureStyleText: _style, ...profile2 } = actor;
        res.json(profile2);
        return;
      }
      await bytes(req.body.signatureDataUrl, true);
      const style = text(req.body.signatureStyleText, 150);
      const profile = "prepare" in db2 ? transaction(db2, () => {
        const actor = res.locals.requireCurrentUser();
        if (style !== actor.name) return null;
        db2.prepare("INSERT INTO user_signatures VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET signature_data_url=excluded.signature_data_url, signature_style_text=excluded.signature_style_text").run(actor.id, req.body.signatureDataUrl, style);
        return { ...actor, ...ownSignature(db2, actor.id) };
      }) : await saveOwnSignatureAsync(db2, async (tx) => {
        if (typeof res.locals.requireCurrentUserAsync !== "function") throw new Error("Async session validation unavailable.");
        return res.locals.requireCurrentUserAsync(tx);
      }, req.body.signatureDataUrl, style);
      if (!profile) {
        res.status(400).json({ error: "Signature name must match your account." });
        return;
      }
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });
  return router;
}

// backend/src/reads.ts
var companies = ["PEW", "ICCL", "FSG"];
function readRoutes(db2, origin2, sessionToken, storage) {
  const router = Router2();
  const query = async (sql, args = []) => "prepare" in db2 ? db2.prepare(sql).all(...args) : (await db2.execute(sql, args)).rows;
  router.get("/bootstrap", async (_req, res, next) => {
    try {
      const user = res.locals.user;
      const allowed = companies.filter((id) => canUserAccessCompany(user, id));
      const placeholders = allowed.map(() => "?").join(",");
      const companyRows = allowed.length ? await query(`SELECT id,name,logo_data_url FROM companies LEFT JOIN company_logos ON company_id=id WHERE id IN (${placeholders})`, allowed) : [];
      const companyList = companyRows.map((row) => currentCompanyDisplay({
        id: row.id,
        code: String(row.id),
        name: String(row.name),
        logoDataUrl: row.logo_data_url ?? void 0,
        fullName: `${row.id} - ${row.name}`,
        groupName: "PRECISION ENGINEERING GROUP"
      }));
      const users = allowed.length ? (await query("SELECT id,email,name,role,department,company_id,allowed_companies,group_admin,company_grants,role_override,is_super_admin,company_permissions,route_rights,job_title FROM account_profiles WHERE COALESCE(is_disabled,0)=0")).map(safeProfile).filter((candidate) => allowed.some((id) => canUserAccessCompany(candidate, id))).map((candidate) => ({
        ...candidate,
        routeRights: candidate.routeRights && Object.fromEntries(Object.entries(candidate.routeRights).filter(([id]) => allowed.includes(id)))
      })) : [];
      const workflows = allowed.length ? (await query(`SELECT config FROM workflows WHERE company_id IN (${placeholders})`, allowed)).map((row) => JSON.parse(String(row.config))) : [];
      res.json({ user: { ...user, ..."prepare" in db2 ? ownSignature(db2, user.id) : await ownSignatureAsync(db2, user.id) }, companies: companyList, users, workflows });
    } catch (error) {
      next(error);
    }
  });
  router.get("/requests", async (req, res, next) => {
    try {
      const scope = req.query.scope;
      if (scope !== void 0 && (typeof scope !== "string" || !["PEG", ...companies].includes(scope))) {
        res.status(400).json({ error: "Invalid viewing scope." });
        return;
      }
      const user = res.locals.user;
      const allowed = companies.filter((id) => canUserAccessCompany(user, id) && (!scope || scope === "PEG" || scope === id));
      if (!allowed.length) {
        res.json([]);
        return;
      }
      const rows = await query(`SELECT record,revision FROM requests WHERE company_id IN (${allowed.map(() => "?").join(",")}) ORDER BY id`, allowed);
      const records = rows.map((row) => ({ ...JSON.parse(String(row.record)), revision: Number(row.revision) })).filter((record) => canReadPreciRoute(user, record));
      res.json(records.map(attachmentMetadata));
    } catch (error) {
      next(error);
    }
  });
  async function readableRequest(id, user) {
    const row = (await query("SELECT record,revision FROM requests WHERE id=?", [id]))[0];
    if (!row) return void 0;
    const record = JSON.parse(String(row.record));
    if (!canUserAccessCompany(user, record.companyId) || !canReadPreciRoute(user, record)) return void 0;
    return { ...record, revision: Number(row.revision) };
  }
  router.get("/requests/:id", async (req, res, next) => {
    try {
      const record = await readableRequest(req.params.id, res.locals.user);
      if (!record) {
        res.status(404).json({ error: "Request not found." });
        return;
      }
      res.json(attachmentMetadata(record));
    } catch (error) {
      next(error);
    }
  });
  router.get("/requests/:id/attachments/:version/:fileId", async (req, res, next) => {
    try {
      const record = await readableRequest(req.params.id, res.locals.user);
      const version = Number(req.params.version);
      if (!/^[1-9]\d*$/.test(req.params.version) || !Number.isSafeInteger(version)) {
        res.status(404).json({ error: "Attachment unavailable." });
        return;
      }
      const files = record && attachmentsForVersion(record, version);
      const file = files?.find((item) => item.id === req.params.fileId) ?? record?.financeHoldHistory?.find((entry) => entry.documentVersion === version && entry.attachment?.id === req.params.fileId)?.attachment;
      if (!file?.dataUrl) {
        res.status(404).json({ error: "Attachment unavailable." });
        return;
      }
      if (file.dataUrl.startsWith("r2:")) {
        if (!storage) {
          res.status(503).json({ error: "Attachment storage is unavailable." });
          return;
        }
        await storage.download(file);
      }
      const match = file.dataUrl.match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) {
        res.status(404).json({ error: "Attachment unavailable." });
        return;
      }
      res.set("Cache-Control", "private, no-store");
      res.set("X-Content-Type-Options", "nosniff");
      res.attachment(file.name).type(match[1]).send(Buffer.from(match[2], "base64"));
    } catch (error) {
      next(error);
    }
  });
  attachDocumentPdfRoute(router, origin2, sessionToken, readableRequest, (token) => "prepare" in db2 ? sessionUser(db2, token) : sessionUserAsync(db2, token));
  return router;
}
function attachDocumentPdfRoute(router, origin2, sessionToken, readableRequest, lookupSession) {
  let renderingPdf = false;
  router.post("/requests/:id/document-pdf", async (req, res, next) => {
    let record;
    try {
      record = await readableRequest(req.params.id, res.locals.user);
    } catch (error) {
      next(error);
      return;
    }
    const token = sessionToken(req);
    if (!record || !token) {
      res.status(404).json({ error: "Request not found." });
      return;
    }
    const { version, updatedAt } = req.body ?? {};
    if (!["Admin Work Request", "Administrative & Payment Request", "IT Request", "Cash Voucher", "Expense Claim", "R&D Initiative"].includes(record.formType) || !Number.isSafeInteger(version) || version !== record.documentVersion && !(record.versionSnapshots ?? []).some((item) => item.version === version)) {
      res.status(404).json({ error: "Document version unavailable." });
      return;
    }
    if (record.updatedAt !== updatedAt) {
      res.status(409).json({ error: "Request changed. Refresh before downloading.", code: "REQUEST_CONFLICT" });
      return;
    }
    if (renderingPdf) {
      res.status(503).json({ error: "Another PDF is being generated. Try again shortly." });
      return;
    }
    renderingPdf = true;
    try {
      const pdf = await renderDocumentPdf(origin2, record.id, version, updatedAt, token);
      const currentUser = await lookupSession(token);
      const current = currentUser && await readableRequest(record.id, currentUser);
      if (!current || currentUser.id !== res.locals.user.id) {
        res.status(404).json({ error: "Request not found." });
        return;
      }
      if (current.revision !== record.revision) {
        res.status(409).json({ error: "Request changed. Refresh before downloading.", code: "REQUEST_CONFLICT" });
        return;
      }
      res.type("application/pdf").send(pdf);
    } catch (error) {
      next(error);
    } finally {
      renderingPdf = false;
    }
  });
}

// backend/src/companyBranding.ts
import { Router as Router3 } from "express";
import sharp2 from "sharp";
function companyBrandingRoutes(db2) {
  const router = Router3();
  const path = "/admin/company-branding";
  router.use(path, (_req, res, next) => {
    if (!res.locals.user.isSuperAdmin) {
      next(new RequestError(403, "Administrator required."));
      return;
    }
    next();
  });
  router.get(path, async (_req, res, next) => {
    try {
      const sql = `SELECT id,name,logo_data_url FROM companies LEFT JOIN company_logos ON company_id=id ORDER BY id`;
      const companies3 = "prepare" in db2 ? db2.prepare(sql).all() : (await db2.execute(sql)).rows;
      res.json(companies3.map((row) => currentCompanyDisplay({
        id: row.id,
        code: String(row.id),
        name: String(row.name),
        fullName: `${row.id} - ${row.name}`,
        groupName: "PRECISION ENGINEERING GROUP",
        logoDataUrl: row.logo_data_url ?? void 0
      })));
    } catch (error) {
      next(error);
    }
  });
  router.put(`${path}/:companyId`, async (req, res, next) => {
    try {
      const id = req.params.companyId;
      if (!["PEW", "ICCL", "FSG"].includes(id)) fail("Choose a legal company.");
      fields(req.body, ["logoDataUrl"]);
      let logo = null;
      if (req.body.logoDataUrl !== null) {
        const input = await bytes(req.body.logoDataUrl, true);
        const image = await sharp2(input).rotate().resize(384, 384, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
        logo = `data:image/png;base64,${image.toString("base64")}`;
      }
      const remove = "DELETE FROM company_logos WHERE company_id=?";
      const upsert = `INSERT INTO company_logos (company_id,logo_data_url) VALUES (?,?)
          ON CONFLICT(company_id) DO UPDATE SET logo_data_url=excluded.logo_data_url`;
      if ("prepare" in db2) transaction(db2, () => {
        if (!res.locals.requireCurrentUser().isSuperAdmin) throw new RequestError(403, "Administrator required.");
        if (logo === null) db2.prepare(remove).run(id);
        else db2.prepare(upsert).run(id, logo);
      });
      else await db2.transaction(async (tx) => {
        const actor = await res.locals.requireCurrentUserAsync(tx);
        if (!actor.isSuperAdmin) throw new RequestError(403, "Administrator required.");
        if (logo === null) await tx.execute(remove, [id]);
        else await tx.execute(upsert, [id, logo]);
      });
      res.json({ logoDataUrl: logo });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

// backend/src/accessRoles.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import express, { Router as Router4 } from "express";
function accessRoleRoutes(db2) {
  const router = Router4();
  const path = "/admin/access-roles";
  const select = async (sql) => "prepare" in db2 ? db2.prepare(sql).all() : (await db2.execute(sql)).rows;
  function requireSuperAdmin(user) {
    if (!user.isSuperAdmin) throw new RequestError(403, "Super admin access required.");
  }
  router.use(path, (_req, res, next) => {
    requireSuperAdmin(res.locals.user);
    next();
  });
  router.get(path, async (_req, res, next) => {
    try {
      const [roles, assignments, requests] = await Promise.all([
        select("SELECT * FROM access_roles ORDER BY name COLLATE NOCASE"),
        select("SELECT * FROM company_access_roles ORDER BY user_id, company_id"),
        select("SELECT record FROM requests WHERE status='Pending Approval'")
      ]);
      const activeApprovals = requests.flatMap((row) => {
        const request = JSON.parse(String(row.record));
        return request.approvalSteps.filter((step) => step.assignedUserId && !["Approved", "Bypassed", "Rejected"].includes(step.status)).map((step) => ({ userId: step.assignedUserId, companyId: request.companyId, requestId: request.id }));
      });
      res.json({
        activeApprovals,
        roles: roles.map((r) => ({ id: r.id, name: r.name, permissions: JSON.parse(String(r.permissions)) })),
        assignments: assignments.map((a) => ({ userId: a.user_id, companyId: a.company_id, roleIds: JSON.parse(String(a.role_ids)) }))
      });
    } catch (error) {
      next(error);
    }
  });
  router.put(path, express.json({ limit: "16kb" }), async (req, res, next) => {
    try {
      fields(req.body, ["id", "name", "permissions"]);
      const id = req.body.id === void 0 ? randomUUID3() : text(req.body.id, 80);
      const name = text(req.body.name, 80).trim();
      const permissions = req.body.permissions;
      if (!Array.isArray(permissions) || permissions.length > accessPermissions.length || permissions.some((p) => !accessPermissions.includes(p)) || new Set(permissions).size !== permissions.length) {
        throw new RequestError(400, "Choose valid role permissions.");
      }
      const duplicate = "SELECT id FROM access_roles WHERE name=? COLLATE NOCASE AND id<>?";
      const exists = "SELECT id FROM access_roles WHERE id=?";
      const save = "INSERT INTO access_roles VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, permissions=excluded.permissions";
      const args = [id, name, JSON.stringify(permissions)];
      const validate = (existing, conflicting) => {
        if (req.body.id !== void 0 && !existing) throw new RequestError(404, "Role not found.");
        if (conflicting) throw new RequestError(409, "A role already has that name.");
      };
      if ("prepare" in db2) transaction(db2, () => {
        requireSuperAdmin(res.locals.requireCurrentUser());
        validate(db2.prepare(exists).get(id), db2.prepare(duplicate).get(name, id));
        db2.prepare(save).run(...args);
      });
      else await db2.transaction(async (tx) => {
        requireSuperAdmin(await res.locals.requireCurrentUserAsync(tx));
        validate((await tx.execute(exists, [id])).rows[0], (await tx.execute(duplicate, [name, id])).rows[0]);
        await tx.execute(save, args);
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  router.put(path + "/assignments", express.json({ limit: "16kb" }), async (req, res, next) => {
    try {
      fields(req.body, ["userId", "companyId", "roleIds"]);
      const userId = text(req.body.userId, 128);
      const { companyId, roleIds } = req.body;
      if (!["PEW", "ICCL", "FSG"].includes(companyId) || !Array.isArray(roleIds) || roleIds.length > 50 || roleIds.some((id) => typeof id !== "string" || id.length > 80) || new Set(roleIds).size !== roleIds.length) {
        throw new RequestError(400, "Choose a company and valid roles.");
      }
      const profile = "SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0";
      const roles = "SELECT id FROM access_roles";
      const save = "INSERT INTO company_access_roles VALUES (?,?,?) ON CONFLICT(user_id, company_id) DO UPDATE SET role_ids=excluded.role_ids";
      const args = [userId, companyId, JSON.stringify(roleIds)];
      const validate = (row, available) => {
        if (!row || !canUserAccessCompany(safeProfile(row), companyId)) throw new RequestError(400, "The employee needs access to this company first.");
        if (roleIds.some((id) => !available.some((role) => role.id === id))) throw new RequestError(400, "A selected role no longer exists.");
      };
      if ("prepare" in db2) transaction(db2, () => {
        requireSuperAdmin(res.locals.requireCurrentUser());
        validate(db2.prepare(profile).get(userId), db2.prepare(roles).all());
        db2.prepare(save).run(...args);
      });
      else await db2.transaction(async (tx) => {
        requireSuperAdmin(await res.locals.requireCurrentUserAsync(tx));
        validate((await tx.execute(profile, [userId])).rows[0], (await tx.execute(roles)).rows);
        await tx.execute(save, args);
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}

// backend/src/accountAdmin.ts
import express2, { Router as Router5 } from "express";
import { randomBytes as randomBytes2 } from "node:crypto";
var companies2 = ["PEW", "ICCL", "FSG"];
var forms = ["Administrative & Payment Request", "IT Request", "Cash Voucher", "Expense Claim", "R&D Initiative", "Admin Work Request"];
function accountAdminRoutes(db2, origin2, now) {
  const router = Router5();
  router.use("/admin/accounts", (_req, res, next) => {
    if (!res.locals.user.isSuperAdmin) {
      next(new RequestError(403, "Administrator required."));
      return;
    }
    next();
  });
  router.get("/admin/accounts", async (_req, res, next) => {
    try {
      const sql = `SELECT id,name,email,notification_email,department,COALESCE(role_override,role) AS effective_role,company_grants,form_grants,is_super_admin,is_disabled,group_admin,company_permissions,job_title,route_rights,company_id,allowed_companies,
      EXISTS(SELECT 1 FROM route_administrators WHERE user_id=account_profiles.id) AS is_route_admin
      FROM account_profiles ORDER BY name COLLATE NOCASE, id`;
      const accounts = "prepare" in db2 ? db2.prepare(sql).all() : (await db2.execute(sql)).rows;
      res.json(accounts.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        notificationEmail: row.notification_email ? String(row.notification_email) : void 0,
        department: row.department,
        role: row.effective_role,
        jobTitle: row.job_title ?? void 0,
        routeRights: typeof row.route_rights === "string" ? JSON.parse(row.route_rights) : void 0,
        companyId: row.company_id,
        allowedCompanyIds: JSON.parse(String(row.allowed_companies)),
        companyGrants: typeof row.company_grants === "string" ? JSON.parse(row.company_grants) : null,
        formGrants: typeof row.form_grants === "string" ? JSON.parse(row.form_grants) : null,
        companyPermissions: typeof row.company_permissions === "string" ? JSON.parse(row.company_permissions) : void 0,
        isSuperAdmin: row.is_super_admin === 1,
        isDisabled: row.is_disabled === 1,
        isGroupAdmin: row.group_admin === 1,
        isRouteAdmin: row.is_route_admin === 1
      })));
    } catch (error) {
      next(error);
    }
  });
  router.post("/admin/accounts", express2.json({ limit: "3mb" }), async (req, res, next) => {
    try {
      fields(req.body, ["name", "email", "department", "password", "role", "mustChangePassword", "signatureDataUrl"]);
      const { name, email, department, password, role, signatureDataUrl } = req.body ?? {};
      const staffRole = role === "Admin" || role === "IT" || role === "Finance" ? role : "Employee";
      const requireSuperAdmin = "prepare" in db2 ? () => {
        const actor = res.locals.requireCurrentUser();
        if (!actor.isSuperAdmin) throw new RequestError(403, "Administrator required.");
      } : async (tx) => {
        const actor = await res.locals.requireCurrentUserAsync(tx);
        if (!actor.isSuperAdmin) throw new RequestError(403, "Administrator required.");
      };
      const result = await registerAccount(db2, { name, email, department, password, signatureDataUrl }, {
        role: staffRole,
        mustChangePassword: true,
        requireSuperAdmin
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });
  router.patch("/admin/accounts/:id", async (req, res, next) => {
    try {
      fields(req.body, ["email", "isDisabled", "role", "notificationEmail"]);
      const { email, isDisabled, role, notificationEmail } = req.body;
      if (role !== void 0 && !["Employee", "Admin", "IT", "Finance"].includes(role)) throw new RequestError(400, "Invalid staff role.");
      if (email === void 0 && isDisabled === void 0 && role === void 0 && notificationEmail === void 0) throw new RequestError(400, "No change requested.");
      if (isDisabled !== void 0 && typeof isDisabled !== "boolean") throw new RequestError(400, "Invalid account status.");
      const normalizedEmail = email === void 0 ? void 0 : normalizeEmail(text(email, 254));
      if (normalizedEmail !== void 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new RequestError(400, "Invalid email.");
      const normalizedNotificationEmail = notificationEmail === void 0 ? void 0 : notificationEmail === null ? null : normalizeEmail(text(notificationEmail, 254));
      if (normalizedNotificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNotificationEmail)) throw new RequestError(400, "Invalid notification email.");
      if ("prepare" in db2) transaction(db2, () => {
        const actor = res.locals.requireCurrentUser();
        if (!actor.isSuperAdmin) throw new RequestError(403, "Administrator required.");
        const target = db2.prepare("SELECT id,email,is_super_admin,is_disabled,COALESCE(role_override,role) AS effective_role FROM account_profiles WHERE id=?").get(req.params.id);
        if (!target) throw new RequestError(404, "Account not found.");
        if (target.is_disabled === null) throw new RequestError(409, "Legacy account access requires migration.");
        if (role !== void 0 && role !== target.effective_role) {
          if (["Director", "General Manager"].includes(String(target.effective_role))) throw new RequestError(403, "Leadership roles cannot be changed here.");
          db2.prepare("UPDATE users SET role=? WHERE id=?").run(role === "Employee" ? "Admin" : role, target.id);
          db2.prepare("UPDATE account_access SET role_override=? WHERE user_id=?").run(role === "Employee" ? "Employee" : null, target.id);
        }
        if (isDisabled === true && target.is_super_admin === 1 && target.is_disabled !== 1) {
          const active = db2.prepare("SELECT count(*) AS count FROM account_access WHERE is_super_admin=1 AND is_disabled=0").get();
          if (Number(active.count) <= 1) throw new RequestError(409, "At least one active administrator is required.");
        }
        if (normalizedEmail !== void 0 && normalizedEmail !== target.email) {
          const duplicate = db2.prepare("SELECT id FROM users WHERE email=? AND id<>?").get(normalizedEmail, target.id);
          if (duplicate) throw new RequestError(409, "Email is already in use.");
          db2.prepare("UPDATE users SET email=? WHERE id=?").run(normalizedEmail, target.id);
          db2.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
          db2.prepare("DELETE FROM password_resets WHERE user_id=?").run(target.id);
        }
        if (isDisabled !== void 0 && Number(isDisabled) !== target.is_disabled) {
          if (isDisabled) {
            db2.prepare("UPDATE users SET route_rights=NULL WHERE id=?").run(target.id);
            db2.prepare("UPDATE account_access SET is_disabled=1,company_grants='[]',form_grants='{}' WHERE user_id=?").run(target.id);
            db2.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
            db2.prepare("DELETE FROM password_resets WHERE user_id=?").run(target.id);
          } else {
            db2.prepare("UPDATE account_access SET is_disabled=0,company_grants='[]',form_grants='{}' WHERE user_id=?").run(target.id);
          }
        }
        if (normalizedNotificationEmail !== void 0) {
          db2.prepare("UPDATE account_access SET notification_email=? WHERE user_id=?").run(normalizedNotificationEmail, target.id);
        }
      });
      else await db2.transaction(async (tx) => {
        if (!(await res.locals.requireCurrentUserAsync(tx)).isSuperAdmin) throw new RequestError(403, "Administrator required.");
        const target = (await tx.execute("SELECT id,email,is_super_admin,is_disabled,COALESCE(role_override,role) AS effective_role FROM account_profiles WHERE id=?", [req.params.id])).rows[0];
        if (!target) throw new RequestError(404, "Account not found.");
        if (target.is_disabled === null) throw new RequestError(409, "Legacy account access requires migration.");
        const id = String(target.id);
        if (role !== void 0 && role !== target.effective_role) {
          if (["Director", "General Manager"].includes(String(target.effective_role))) throw new RequestError(403, "Leadership roles cannot be changed here.");
          await tx.execute("UPDATE users SET role=? WHERE id=?", [role === "Employee" ? "Admin" : role, id]);
          await tx.execute("UPDATE account_access SET role_override=? WHERE user_id=?", [role === "Employee" ? "Employee" : null, id]);
        }
        if (isDisabled === true && target.is_super_admin === 1 && target.is_disabled !== 1) {
          const active = (await tx.execute("SELECT count(*) AS count FROM account_access WHERE is_super_admin=1 AND is_disabled=0")).rows[0];
          if (Number(active.count) <= 1) throw new RequestError(409, "At least one active administrator is required.");
        }
        if (normalizedEmail !== void 0 && normalizedEmail !== target.email) {
          if ((await tx.execute("SELECT id FROM users WHERE email=? AND id<>?", [normalizedEmail, id])).rows.length) throw new RequestError(409, "Email is already in use.");
          await tx.execute("UPDATE users SET email=? WHERE id=?", [normalizedEmail, id]);
          await tx.execute("DELETE FROM sessions WHERE user_id=?", [id]);
          await tx.execute("DELETE FROM password_resets WHERE user_id=?", [id]);
        }
        if (isDisabled !== void 0 && Number(isDisabled) !== target.is_disabled) {
          await tx.execute("UPDATE account_access SET is_disabled=?,company_grants='[]',form_grants='{}' WHERE user_id=?", [Number(isDisabled), id]);
          if (isDisabled) {
            await tx.execute("UPDATE users SET route_rights=NULL WHERE id=?", [id]);
            await tx.execute("DELETE FROM sessions WHERE user_id=?", [id]);
            await tx.execute("DELETE FROM password_resets WHERE user_id=?", [id]);
          }
        }
        if (normalizedNotificationEmail !== void 0) {
          await tx.execute("UPDATE account_access SET notification_email=? WHERE user_id=?", [normalizedNotificationEmail, id]);
        }
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  router.post("/admin/accounts/:id/reset-link", async (req, res, next) => {
    try {
      const token = randomBytes2(32).toString("hex");
      if ("prepare" in db2) transaction(db2, () => {
        if (!res.locals.requireCurrentUser().isSuperAdmin) throw new RequestError(403, "Administrator required.");
        const target = db2.prepare("SELECT id,is_disabled FROM account_profiles WHERE id=?").get(req.params.id);
        if (!target) throw new RequestError(404, "Account not found.");
        if (target.is_disabled === 1) throw new RequestError(409, "Account is disabled.");
        db2.prepare(`INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at`).run(target.id, tokenHash(token), now() + 30 * 60 * 1e3);
      });
      else await db2.transaction(async (tx) => {
        if (!(await res.locals.requireCurrentUserAsync(tx)).isSuperAdmin) throw new RequestError(403, "Administrator required.");
        const target = (await tx.execute("SELECT id,is_disabled FROM account_profiles WHERE id=?", [req.params.id])).rows[0];
        if (!target) throw new RequestError(404, "Account not found.");
        if (target.is_disabled === 1) throw new RequestError(409, "Account is disabled.");
        await tx.execute(`INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at`, [String(target.id), tokenHash(token), now() + 30 * 60 * 1e3]);
      });
      res.json({ link: `${origin2}/#reset=${token}` });
    } catch (error) {
      next(error);
    }
  });
  router.put("/admin/accounts/:id/grants", async (req, res, next) => {
    try {
      fields(req.body, ["companyIds", "formsByCompany", "routeRights", "jobTitle"]);
      const { companyIds, formsByCompany, routeRights } = req.body;
      const title = req.body.jobTitle === void 0 ? void 0 : text(req.body.jobTitle, 150, false).trim();
      if (!Array.isArray(companyIds) || companyIds.some((id) => !companies2.includes(id)) || new Set(companyIds).size !== companyIds.length || !formsByCompany || typeof formsByCompany !== "object" || Array.isArray(formsByCompany)) throw new RequestError(400, "Invalid grants.");
      for (const [company, allowed] of Object.entries(formsByCompany)) {
        if (!companyIds.includes(company) || !Array.isArray(allowed) || allowed.some((form2) => !forms.includes(form2)) || new Set(allowed).size !== allowed.length) throw new RequestError(400, "Invalid grants.");
      }
      if (routeRights !== void 0) {
        fields(routeRights, companyIds);
        for (const rights of Object.values(routeRights)) {
          fields(rights, ["companyAdmin", "signerSteps", "processorTasks"]);
          if (rights.companyAdmin !== void 0 && typeof rights.companyAdmin !== "boolean") throw new RequestError(400, "Invalid company admin grant.");
          for (const [kind, scoped] of Object.entries(rights)) {
            if (kind === "companyAdmin") continue;
            fields(scoped, forms);
            for (const [form2, ids] of Object.entries(scoped)) {
              if (!Array.isArray(ids) || ids.length > 20 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 150 || kind === "processorTasks" && !Object.hasOwn(processorTaskLabels(form2), id))) {
                throw new RequestError(400, "Invalid signer or processor grant.");
              }
            }
          }
        }
      }
      const rightsSql = "UPDATE users SET job_title=CASE WHEN ? THEN ? ELSE job_title END,route_rights=CASE WHEN ? THEN ? ELSE route_rights END WHERE id=?";
      const setGrants = "INSERT INTO account_access (user_id,company_grants,form_grants) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET company_grants=excluded.company_grants,form_grants=excluded.form_grants";
      const lookup = "SELECT id,is_disabled,route_rights FROM account_profiles WHERE id=?";
      const args = (target) => {
        if (target.is_disabled === 1 || target.is_disabled === null && routeRights === void 0) throw new RequestError(409, "Account cannot receive grants.");
        const id = String(target.id);
        const current = typeof target.route_rights === "string" ? JSON.parse(target.route_rights) : void 0;
        const rights = routeRights ?? (current && Object.fromEntries(Object.entries(current).filter(([company]) => companyIds.includes(company))));
        return {
          grants: [id, JSON.stringify(companyIds), JSON.stringify(formsByCompany)],
          rights: [Number(title !== void 0), title || null, Number(rights !== void 0), rights === void 0 ? null : JSON.stringify(rights), id]
        };
      };
      if ("prepare" in db2) transaction(db2, () => {
        if (!res.locals.requireCurrentUser().isSuperAdmin) throw new RequestError(403, "Administrator required.");
        const target = db2.prepare(lookup).get(req.params.id);
        if (!target) throw new RequestError(404, "Account not found.");
        const values = args(target);
        db2.prepare(setGrants).run(...values.grants);
        db2.prepare(rightsSql).run(...values.rights);
      });
      else await db2.transaction(async (tx) => {
        if (!(await res.locals.requireCurrentUserAsync(tx)).isSuperAdmin) throw new RequestError(403, "Administrator required.");
        const target = (await tx.execute(lookup, [req.params.id])).rows[0];
        if (!target) throw new RequestError(404, "Account not found.");
        const values = args(target);
        await tx.execute(setGrants, values.grants);
        await tx.execute(rightsSql, values.rights);
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}

// shared/utils/workflowAdministration.ts
var canAdministerWorkflows = (user) => user.role === "Director" || user.isGroupAdmin === true;
function canConfigureSigningRoutes(user, companyId) {
  if (user.isSuperAdmin) return true;
  const check = (id) => hasCompanyPermission(user, id, "manage-routes", canAdministerWorkflows(user)) || user.routeRights?.[id]?.companyAdmin === true && canUserAccessCompany(user, id);
  return companyId ? check(companyId) : ["PEW", "ICCL", "FSG"].some(check);
}
function resolveConfiguredSigner(stage, users, companyId) {
  const eligible = users.filter((user) => canBeAssignedApproval(user, companyId));
  if (stage.assignedUserId) return eligible.find((user) => user.id === stage.assignedUserId);
  const matches = eligible.filter((user) => user.role === stage.assignedRole);
  return matches.length === 1 ? matches[0] : void 0;
}

// shared/utils/routeReplacement.ts
function event(request, actor, action, comments) {
  return { id: crypto.randomUUID(), stepNumber: 0, actionByUserId: actor.id, actionByName: actor.name, actionByRole: actor.role, action, comments, dateTime: (/* @__PURE__ */ new Date()).toISOString(), version: request.documentVersion };
}
function usesConfiguredBackups(request) {
  return ["Administrative & Payment Request", "IT Request", "Cash Voucher", "Expense Claim", "R&D Initiative"].includes(request.formType);
}
function configuredReplacementIds(request, stageId) {
  const step = request.approvalSteps.find((item) => item.stageId === stageId);
  const stage = request.workflowConfig.stages.find((item) => item.id === stageId);
  return [step?.primarySignerId ?? stage?.assignedUserId, ...stage?.backupSignerIds ?? []].filter((id) => !!id && id !== step?.assignedUserId);
}
function canProposeFinalReplacement(request, actor) {
  if (!canUserAccessCompany(actor, request.companyId)) return false;
  if (actor.canReplaceFinalApprover) return true;
  if (request.workflowConfig.signerSelection !== "company-directory") return false;
  const finalId = request.approvalSteps.at(-1)?.assignedUserId;
  const previous = [...request.approvalHistory].reverse().find((item) => item.version === request.documentVersion && item.action === "Approved" && item.actionByUserId !== finalId);
  return actor.id === (previous?.actionByUserId ?? request.requesterId);
}
function canCompleteWithOutstandingSteps(request, actorId) {
  const final = request.approvalSteps.at(-1);
  if (!final || final.assignedUserId !== actorId) return false;
  if (request.workflowConfig.signerSelection === "company-directory") return request.workflowConfig.allowFinalBypass === true;
  if (!usesConfiguredBackups(request) || !final.primarySignerId || final.primarySignerId === actorId) return true;
  return request.workflowConfig.stages.find((stage) => stage.id === final.stageId)?.backupCompletionUserIds?.includes(actorId) === true;
}
function proposeSignerReplacement(request, actor, target, stageId, reason) {
  const index = request.approvalSteps.findIndex((step2) => step2.stageId === stageId);
  const step = request.approvalSteps[index];
  if (request.status !== "Pending Approval" || !step || request.pendingReplacement || !reason?.trim() || !canUserAccessCompany(actor, request.companyId) || !canBeAssignedApproval(target, request.companyId) || target.id === request.requesterId || target.id === step.assignedUserId || request.approvalSteps.some((s) => s.assignedUserId === target.id) || ["Approved", "Bypassed", "Rejected"].includes(step.status)) return { success: false, error: "Invalid replacement or route state." };
  const final = index === request.approvalSteps.length - 1;
  if (usesConfiguredBackups(request) && request.workflowConfig.signerSelection !== "company-directory") {
    if (!actor.canReplaceFinalApprover) return { success: false, error: "Backup activation permission required." };
    if (!configuredReplacementIds(request, stageId).includes(target.id)) return { success: false, error: "Choose a configured backup or return the step to its primary signer." };
    const updatedRequest = {
      ...request,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      formerSignerIds: [.../* @__PURE__ */ new Set([...request.formerSignerIds ?? [], step.assignedUserId])],
      approvalSteps: request.approvalSteps.map((item, i) => i === index ? {
        ...item,
        primarySignerId: item.primarySignerId ?? step.assignedUserId,
        assignedUserId: target.id,
        assignedUserName: target.name,
        assignedRole: target.role
      } : item),
      approvalHistory: [...request.approvalHistory, event(request, actor, "Signer Replaced", `${step.assignedUserName} \u2192 ${target.name}: ${reason.trim()}`)]
    };
    if (index === request.currentStageIndex) {
      updatedRequest.currentApproverId = target.id;
      updatedRequest.currentApproverName = target.name;
    }
    if (final) updatedRequest.finalApproverName = target.name;
    return { success: true, updatedRequest };
  }
  if (final ? !canProposeFinalReplacement(request, actor) : !canAdministerWorkflows(actor)) return { success: false, error: "Replacement permission required." };
  const proposed = { ...request, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), pendingReplacement: { stageId, oldUserId: step.assignedUserId, newUserId: target.id, reason: reason.trim(), proposedBy: actor.id }, approvalHistory: [...request.approvalHistory, event(request, actor, "Signer Replacement Proposed", `${step.assignedUserName} \u2192 ${target.name}: ${reason.trim()}`)] };
  return final ? { success: true, updatedRequest: proposed } : acceptSignerReplacement(proposed, target, true);
}
function acceptSignerReplacement(request, actor, accept) {
  const pending = request.pendingReplacement;
  const index = request.approvalSteps.findIndex((step2) => step2.stageId === pending?.stageId);
  const step = request.approvalSteps[index];
  if (request.status !== "Pending Approval" || !pending || !step || pending.newUserId !== actor.id || step.assignedUserId !== pending.oldUserId || ["Approved", "Bypassed", "Rejected"].includes(step.status) || !canUserAccessCompany(actor, request.companyId)) return { success: false, error: "Replacement is no longer available." };
  const updatedRequest = {
    ...request,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    pendingReplacement: void 0,
    formerSignerIds: accept ? [.../* @__PURE__ */ new Set([...request.formerSignerIds || [], pending.oldUserId])] : request.formerSignerIds,
    approvalSteps: request.approvalSteps.map((s, i) => accept && i === index ? { ...s, assignedUserId: actor.id, assignedUserName: actor.name, assignedRole: actor.role } : s),
    approvalHistory: [...request.approvalHistory, event(request, actor, accept ? "Signer Replaced" : "Replacement Declined", `${pending.oldUserId} \u2192 ${actor.name}: ${pending.reason}`)]
  };
  if (accept) {
    updatedRequest.workflowConfig = structuredClone(request.workflowConfig);
    updatedRequest.workflowConfig.stages[index] = { ...updatedRequest.workflowConfig.stages[index], assignedUserId: actor.id, assignedRole: actor.role };
    if (index === request.currentStageIndex) {
      updatedRequest.currentApproverId = actor.id;
      updatedRequest.currentApproverName = actor.name;
    }
    if (index === request.approvalSteps.length - 1) updatedRequest.finalApproverName = actor.name;
  }
  return { success: true, updatedRequest };
}

// backend/src/requestRoutes.ts
import { Router as Router8 } from "express";
import { createHash as createHash3, randomUUID as randomUUID6 } from "node:crypto";

// backend/src/drafts.ts
import { Router as Router6 } from "express";
function draftRevision(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RequestError(400, "Invalid draft revision.");
  return Number(value);
}
function readDraft(db2, userId, companyId, formType = "Admin Work Request") {
  const row = db2.prepare("SELECT revision,data FROM drafts WHERE user_id=? AND company_id=? AND form_type=?").get(userId, companyId, formType);
  return row ? { revision: Number(row.revision), data: JSON.parse(String(row.data)) } : { revision: 0, data: null };
}
function writeDraft(db2, userId, companyId, expectedRevision, data, formType = "Admin Work Request") {
  const current = readDraft(db2, userId, companyId, formType);
  if (current.revision !== expectedRevision) throw new RequestError(409, "Draft changed in another session.", "DRAFT_CONFLICT");
  const revision2 = current.revision + 1;
  db2.prepare("INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT(user_id,company_id,form_type) DO UPDATE SET revision=excluded.revision,data=excluded.data").run(userId, companyId, formType, revision2, JSON.stringify(data));
  return { revision: revision2, data };
}
async function readDraftAsync(db2, userId, companyId, formType = "Admin Work Request") {
  const row = (await db2.execute("SELECT revision,data FROM drafts WHERE user_id=? AND company_id=? AND form_type=?", [userId, companyId, formType])).rows[0];
  return row ? { revision: Number(row.revision), data: JSON.parse(String(row.data)) } : { revision: 0, data: null };
}
async function writeDraftAsync(tx, userId, companyId, expectedRevision, data, formType = "Admin Work Request") {
  const current = await readDraftAsync(tx, userId, companyId, formType);
  if (current.revision !== expectedRevision) throw new RequestError(409, "Draft changed in another session.", "DRAFT_CONFLICT");
  const revision2 = current.revision + 1;
  await tx.execute(
    "INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT(user_id,company_id,form_type) DO UPDATE SET revision=excluded.revision,data=excluded.data",
    [userId, companyId, formType, revision2, JSON.stringify(data)]
  );
  return { revision: revision2, data };
}
function draftRoutes(db2) {
  const router = Router6();
  router.use("/drafts/:companyId/:formType", (req, res, next) => {
    const { companyId, formType } = req.params;
    if (!["PEW", "ICCL", "FSG"].includes(companyId) || formType !== "Admin Work Request" && formType !== "IT Request") {
      next(new RequestError(400, "Invalid draft key."));
      return;
    }
    if (!canUserAccessCompany(res.locals.user, companyId)) {
      next(new RequestError(403, "Company access denied."));
      return;
    }
    if (!canUserStartForm(res.locals.user, companyId, formType)) {
      next(new RequestError(403, "Form access denied."));
      return;
    }
    next();
  });
  router.get("/drafts/:companyId/:formType", async (req, res, next) => {
    try {
      res.json("prepare" in db2 ? readDraft(db2, res.locals.user.id, req.params.companyId, req.params.formType) : await readDraftAsync(db2, res.locals.user.id, req.params.companyId, req.params.formType));
    } catch (error) {
      next(error);
    }
  });
  router.put("/drafts/:companyId/:formType", async (req, res, next) => {
    try {
      fields(req.body, ["expectedRevision", "data"]);
      const expected = draftRevision(req.body.expectedRevision);
      const data = req.body.data;
      if (req.params.formType === "IT Request") {
        if (!data || typeof data !== "object") throw new RequestError(400, "Invalid draft data.");
        if (data.companyId !== void 0 && data.companyId !== req.params.companyId) throw new RequestError(400, "Company mismatch.");
        const rawFields = data.fields && typeof data.fields === "object" ? data.fields : {};
        const validatedFields = {
          department: typeof rawFields.department === "string" ? rawFields.department.slice(0, 200) : "",
          requester: typeof rawFields.requester === "string" ? rawFields.requester.slice(0, 200) : "",
          date: typeof rawFields.date === "string" ? rawFields.date.slice(0, 50) : "",
          requestType: typeof rawFields.requestType === "string" ? rawFields.requestType.slice(0, 200) : "",
          priority: typeof rawFields.priority === "string" ? rawFields.priority.slice(0, 50) : "",
          details: typeof rawFields.details === "string" ? rawFields.details.slice(0, 1e4) : "",
          justification: typeof rawFields.justification === "string" ? rawFields.justification.slice(0, 1e4) : ""
        };
        const validatedChoices = {};
        if (data.choices && typeof data.choices === "object" && !Array.isArray(data.choices)) {
          for (const [k, v] of Object.entries(data.choices)) {
            if (typeof k === "string" && typeof v === "string") {
              validatedChoices[k.slice(0, 100)] = v.slice(0, 100);
            }
          }
        }
        const validated2 = {
          fields: validatedFields,
          choices: validatedChoices,
          companyId: req.params.companyId
        };
        res.json("prepare" in db2 ? transaction(db2, () => {
          const actor = res.locals.requireCurrentUser();
          if (!canUserAccessCompany(actor, req.params.companyId)) throw new RequestError(403, "Company access denied.");
          if (!canUserStartForm(actor, req.params.companyId, req.params.formType)) throw new RequestError(403, "Form access denied.");
          return writeDraft(db2, actor.id, req.params.companyId, expected, validated2, "IT Request");
        }) : await db2.transaction(async (tx) => {
          const actor = await res.locals.requireCurrentUserAsync(tx);
          if (!canUserStartForm(actor, req.params.companyId, req.params.formType)) throw new RequestError(403, "Form access denied.");
          return writeDraftAsync(tx, actor.id, req.params.companyId, expected, validated2, "IT Request");
        }));
        return;
      }
      fields(data, ["dateOfRequest", "department", "priority", "workDescription", "documents", "companyId", "attachments"]);
      if (data.companyId !== void 0 && data.companyId !== req.params.companyId) throw new RequestError(400, "Company mismatch.");
      const { attachments: files, companyId: _companyId, ...editable } = data;
      form(editable, true);
      const validated = { ...editable, companyId: req.params.companyId, attachments: await attachments(files, res.locals.user.name) };
      res.json("prepare" in db2 ? transaction(db2, () => {
        const actor = res.locals.requireCurrentUser();
        if (!canUserAccessCompany(actor, req.params.companyId)) throw new RequestError(403, "Company access denied.");
        if (!canUserStartForm(actor, req.params.companyId, req.params.formType)) throw new RequestError(403, "Form access denied.");
        return writeDraft(db2, actor.id, req.params.companyId, expected, validated, "Admin Work Request");
      }) : await db2.transaction(async (tx) => {
        const actor = await res.locals.requireCurrentUserAsync(tx);
        if (!canUserStartForm(actor, req.params.companyId, req.params.formType)) throw new RequestError(403, "Form access denied.");
        return writeDraftAsync(tx, actor.id, req.params.companyId, expected, validated, "Admin Work Request");
      }));
    } catch (error) {
      next(error);
    }
  });
  router.delete("/drafts/:companyId/:formType", async (req, res, next) => {
    try {
      fields(req.body, ["expectedRevision"]);
      const expected = draftRevision(req.body.expectedRevision);
      res.json("prepare" in db2 ? transaction(db2, () => writeDraft(db2, res.locals.user.id, req.params.companyId, expected, null, req.params.formType)) : await db2.transaction(async (tx) => {
        const actor = await res.locals.requireCurrentUserAsync(tx);
        if (!canUserStartForm(actor, req.params.companyId, req.params.formType)) throw new RequestError(403, "Form access denied.");
        return writeDraftAsync(tx, actor.id, req.params.companyId, expected, null, req.params.formType);
      }));
    } catch (error) {
      next(error);
    }
  });
  return router;
}

// backend/src/processorHandoffRoutes.ts
import { Router as Router7 } from "express";

// backend/src/email/emailTemplates.ts
function escapeHtml(str) {
  if (str === void 0 || str === null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function renderEmailSubject(eventType, payload) {
  const code = payload.displayId || payload.requestId;
  const form2 = payload.formType;
  switch (eventType) {
    case "REQUEST_SUBMITTED":
      return `Request submitted \xB7 ${form2} \xB7 ${code}`;
    case "ACTION_REQUIRED":
      return `Signature needed \xB7 ${form2} \xB7 ${code}`;
    case "UPCOMING_FINAL_APPROVER_NOTICE":
      return `Upcoming approval \xB7 ${form2} \xB7 ${code}`;
    case "UPCOMING_SIGNER_NOTICE":
      return `Upcoming review \xB7 ${form2} \xB7 ${code}`;
    case "PROCESSOR_HANDOFF":
      return "Approved request to review - " + form2 + " - " + code;
    case "ROUTE_COMPLETED":
      return `Request completed \xB7 ${form2} \xB7 ${code}`;
  }
}
function renderPriorityPill(priority) {
  const p = (priority || "").toLowerCase();
  let bg = "#FEF3C7";
  let color = "#92400E";
  if (p.includes("urgent")) {
    bg = "#FEE2E2";
    color = "#991B1B";
  } else if (p.includes("low")) {
    bg = "#F1F5F9";
    color = "#475569";
  }
  return `<span style="display: inline-block; padding: 2px 9px; background: ${bg}; color: ${color}; border-radius: 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.3px;">${escapeHtml(priority)}</span>`;
}
function renderBilingualFormHtml(preview) {
  return `
    <table cellpadding="0" cellspacing="0" border="0" width="100%" class="form-table" style="max-width: 100%; border: 1px solid #CBD5E1; border-radius: 8px; overflow: hidden; background-color: #FFFFFF; margin: 18px 0; border-collapse: separate; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <tr>
        <td colspan="2" style="background-color: #EAF0F6; border-bottom: 1px solid #CBD5E1; padding: 12px 14px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td class="header-grid-col" style="vertical-align: top; text-align: left; width: 50%;">
                <div style="font-size: 13px; font-weight: 700; color: #0F172A; line-height: 1.3;">${escapeHtml(preview.companyName)}</div>
                <div style="font-size: 12px; font-weight: 600; color: #334155; margin-top: 2px;">${escapeHtml(preview.formTitleEnglish)}</div>
              </td>
              <td class="header-grid-col header-grid-col-right" dir="rtl" style="vertical-align: top; text-align: right; width: 50%;">
                ${preview.companyNameArabic ? `<div style="font-size: 13px; font-weight: 700; color: #0F172A; line-height: 1.3;">${escapeHtml(preview.companyNameArabic)}</div>` : ""}
                <div style="font-size: 12px; font-weight: 600; color: #334155; margin-top: 2px;">${escapeHtml(preview.formTitleArabic)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td class="responsive-half" style="width: 50%; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid #CBD5E1; border-right: 1px solid #CBD5E1;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-size: 11px; font-weight: 700; color: #334155;">Date of Request</td>
              <td dir="rtl" style="font-size: 11px; font-weight: 700; color: #334155; text-align: right;">\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0637\u0644\u0628</td>
            </tr>
          </table>
          <div style="font-size: 13px; font-weight: 500; color: #0F172A; margin-top: 3px;">${escapeHtml(preview.dateOfRequest || "\u2014")}</div>
        </td>
        <td class="responsive-half" style="width: 50%; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid #CBD5E1;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-size: 11px; font-weight: 700; color: #334155;">Department</td>
              <td dir="rtl" style="font-size: 11px; font-weight: 700; color: #334155; text-align: right;">\u0627\u0644\u0642\u0633\u0645</td>
            </tr>
          </table>
          <div style="font-size: 13px; font-weight: 500; color: #0F172A; margin-top: 3px;">${escapeHtml(preview.department || "\u2014")}</div>
        </td>
      </tr>

      <tr>
        <td class="responsive-half" style="width: 50%; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid #CBD5E1; border-right: 1px solid #CBD5E1;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-size: 11px; font-weight: 700; color: #334155;">Name of the Requester</td>
              <td dir="rtl" style="font-size: 11px; font-weight: 700; color: #334155; text-align: right;">\u0627\u0633\u0645 \u0635\u0627\u062D\u0628 \u0627\u0644\u0637\u0644\u0628</td>
            </tr>
          </table>
          <div style="font-size: 13px; font-weight: 500; color: #0F172A; margin-top: 3px;">${escapeHtml(preview.requesterName || "\u2014")}</div>
        </td>
        <td class="responsive-half" style="width: 50%; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid #CBD5E1;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-size: 11px; font-weight: 700; color: #334155;">Documents</td>
              <td dir="rtl" style="font-size: 11px; font-weight: 700; color: #334155; text-align: right;">\u0627\u0644\u0645\u0633\u062A\u0646\u062F\u0627\u062A</td>
            </tr>
          </table>
          <div style="font-size: 13px; font-weight: 500; color: #0F172A; margin-top: 3px;">${escapeHtml(preview.documentsDescription || "\u2014")}</div>
        </td>
      </tr>

      <tr>
        <td colspan="2" style="vertical-align: top; padding: 8px 12px; border-bottom: 1px solid #CBD5E1;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-size: 11px; font-weight: 700; color: #334155;">Priority</td>
              <td dir="rtl" style="font-size: 11px; font-weight: 700; color: #334155; text-align: right;">\u0627\u0644\u0623\u0647\u0645\u064A\u0629</td>
            </tr>
          </table>
          <div style="font-size: 13px; font-weight: 500; color: #0F172A; margin-top: 3px;">${escapeHtml(preview.priority || "\u2014")}</div>
        </td>
      </tr>

      <tr>
        <td colspan="2" style="vertical-align: top; padding: 8px 12px; border-bottom: 1px solid #CBD5E1;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-size: 11px; font-weight: 700; color: #334155;">Work Description</td>
              <td dir="rtl" style="font-size: 11px; font-weight: 700; color: #334155; text-align: right;">\u0648\u0635\u0641 \u0627\u0644\u0637\u0644\u0628</td>
            </tr>
          </table>
          <div style="font-size: 13px; color: #0F172A; margin-top: 4px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(preview.workDescription || "\u2014")}</div>
        </td>
      </tr>

      <tr>
        <td colspan="2" style="padding: 0; border-bottom: 1px solid #CBD5E1;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td colspan="2" style="background-color: #F1F5F9; padding: 6px 12px; font-size: 11px; font-weight: 700; color: #1E293B; border-bottom: 1px solid #CBD5E1;">
                Administrative Team Use Only
              </td>
            </tr>
            <tr>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; color: #64748B; border-right: 1px solid #CBD5E1; border-bottom: 1px solid #E2E8F0;">Work Completion Status</td>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; color: #0F172A; border-bottom: 1px solid #E2E8F0;">${escapeHtml(preview.adminUseOnly.status || "")}</td>
            </tr>
            <tr>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; color: #64748B; border-right: 1px solid #CBD5E1; border-bottom: 1px solid #E2E8F0;">Work Completion Date</td>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; color: #0F172A; border-bottom: 1px solid #E2E8F0;">${escapeHtml(preview.adminUseOnly.completionDate || "")}</td>
            </tr>
            <tr>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; color: #64748B; border-right: 1px solid #CBD5E1;">Work Completed by Name</td>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; color: #0F172A;">${escapeHtml(preview.adminUseOnly.completedByName || "")}</td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td colspan="2" style="padding: 0; border-bottom: 1px solid #CBD5E1;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td colspan="2" style="background-color: #F1F5F9; padding: 6px 12px; font-size: 11px; font-weight: 700; color: #1E293B; border-bottom: 1px solid #CBD5E1;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td>Payment Section</td>
                    <td dir="rtl" style="text-align: right;">\u0642\u0633\u0645 \u0627\u0644\u062F\u0641\u0639</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; font-weight: 600; color: #334155; border-right: 1px solid #CBD5E1; border-bottom: 1px solid #E2E8F0;">Amount</td>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; font-weight: 700; color: #0F172A; border-bottom: 1px solid #E2E8F0;">${escapeHtml(preview.payment.amount || "")}</td>
            </tr>
            <tr>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; font-weight: 600; color: #334155; border-right: 1px solid #CBD5E1; border-bottom: 1px solid #E2E8F0;">Mode of Transfer</td>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; color: #0F172A; border-bottom: 1px solid #E2E8F0;">${escapeHtml(preview.payment.transferMode || "")}</td>
            </tr>
            <tr>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; font-weight: 600; color: #334155; border-right: 1px solid #CBD5E1;">Purpose</td>
              <td style="width: 50%; padding: 6px 12px; font-size: 12px; color: #0F172A;">${escapeHtml(preview.payment.purpose || "")}</td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td colspan="2" style="padding: 0; border-bottom: 1px solid #CBD5E1;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td class="signature-col" style="width: 33.33%; padding: 8px 10px; border-right: 1px solid #CBD5E1; vertical-align: top; background-color: #F8FAFC;">
                <div style="font-size: 11px; font-weight: 700; color: #334155; text-align: center;">Requester Signature</div>
                <div dir="rtl" style="font-size: 10px; font-weight: 600; color: #475569; text-align: center; margin-top: 1px;">\u062A\u0648\u0642\u064A\u0639 \u0635\u0627\u062D\u0628 \u0627\u0644\u0637\u0644\u0628</div>
                <div style="height: 44px; display: table; width: 100%;">
                  <div style="display: table-cell; vertical-align: middle; text-align: center; font-size: 12px; font-weight: 600; color: #0F766E;">
                    ${escapeHtml(preview.signatures.requester.name || "")}${preview.signatures.requester.status ? ` <span style="font-size: 10px; color: #166534;">(${escapeHtml(preview.signatures.requester.status)})</span>` : ""}
                  </div>
                </div>
              </td>
              <td class="signature-col" style="width: 33.33%; padding: 8px 10px; border-right: 1px solid #CBD5E1; vertical-align: top; background-color: #F8FAFC;">
                <div style="font-size: 11px; font-weight: 700; color: #334155; text-align: center;">Department Head Signature</div>
                <div dir="rtl" style="font-size: 10px; font-weight: 600; color: #475569; text-align: center; margin-top: 1px;">\u062A\u0648\u0642\u064A\u0639 \u0631\u0626\u064A\u0633 \u0627\u0644\u0642\u0633\u0645</div>
                <div style="height: 44px; display: table; width: 100%;">
                  <div style="display: table-cell; vertical-align: middle; text-align: center; font-size: 12px; font-weight: 600; color: #1E293B;">
                    ${preview.signatures.departmentHead.name ? `
                      ${escapeHtml(preview.signatures.departmentHead.name)}${preview.signatures.departmentHead.status ? ` <span style="font-size: 10px; color: ${preview.signatures.departmentHead.status === "Signed" ? "#166534" : "#64748B"};">(${escapeHtml(preview.signatures.departmentHead.status)})</span>` : ""}
                    ` : '<span style="color: #94A3B8; font-style: italic; font-weight: 400; font-size: 11px;">\u2014</span>'}
                  </div>
                </div>
              </td>
              <td class="signature-col" style="width: 33.33%; padding: 8px 10px; vertical-align: top; background-color: #F8FAFC;">
                <div style="font-size: 11px; font-weight: 700; color: #334155; text-align: center;">Approver Signature</div>
                <div dir="rtl" style="font-size: 10px; font-weight: 600; color: #475569; text-align: center; margin-top: 1px;">\u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0645\u062E\u0648\u0644 \u0628\u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F</div>
                <div style="height: 44px; display: table; width: 100%;">
                  <div style="display: table-cell; vertical-align: middle; text-align: center; font-size: 12px; font-weight: 600; color: #1E293B;">
                    ${preview.signatures.approver.name ? `
                      ${escapeHtml(preview.signatures.approver.name)}${preview.signatures.approver.status ? ` <span style="font-size: 10px; color: ${preview.signatures.approver.status === "Signed" ? "#166534" : "#64748B"};">(${escapeHtml(preview.signatures.approver.status)})</span>` : ""}
                    ` : '<span style="color: #94A3B8; font-style: italic; font-weight: 400; font-size: 11px;">\u2014</span>'}
                  </div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td colspan="2" style="padding: 10px 14px; background-color: #FFFFFF; font-size: 11px;">
          <div style="font-weight: 700; color: #334155; margin-bottom: 6px;">Notes:</div>
          <ul style="margin: 0; padding-left: 16px; color: #475569; line-height: 1.5;">
            ${(Array.isArray(preview.notes) ? preview.notes : preview.notes.english).map((n) => `<li style="margin-bottom: 4px;">${escapeHtml(n)}</li>`).join("")}
          </ul>
        </td>
      </tr>
    </table>
  `;
}
function renderEmailContent(eventType, payload) {
  const name = escapeHtml(payload.recipientName);
  const company = escapeHtml(payload.companyName || payload.companyId);
  const formType = escapeHtml(payload.formType);
  const displayCode = escapeHtml(payload.displayId || payload.requestId);
  const requester = escapeHtml(payload.requesterName);
  const link = escapeHtml(payload.portalUrl);
  const isLocal = link.includes("localhost") || link.includes("127.0.0.1");
  let badgeText = "ACTION REQUIRED";
  let badgeBg = "#F1F5F9";
  let badgeColor = "#334155";
  let headline = "Your signature is needed";
  let subhead = `Hi ${name}, ${requester} submitted this request for your review.`;
  let buttonText = !payload.dynamicSummary && payload.formPreview ? "Review & sign" : "Open in PreciSign";
  switch (eventType) {
    case "REQUEST_SUBMITTED":
      badgeText = "REQUEST SUBMITTED";
      badgeBg = "#EFF6FF";
      badgeColor = "#1D4ED8";
      headline = "Request submission confirmed";
      subhead = `Hi ${name}, your request has been submitted for review.`;
      buttonText = "View submitted form";
      break;
    case "ACTION_REQUIRED":
      badgeText = "ACTION REQUIRED";
      badgeBg = "#F1F5F9";
      badgeColor = "#334155";
      headline = "Your signature is needed";
      subhead = `Hi ${name}, ${requester} submitted this request for your review.`;
      buttonText = !payload.dynamicSummary && payload.formPreview ? "Review & sign" : "Open in PreciSign";
      break;
    case "UPCOMING_FINAL_APPROVER_NOTICE":
      badgeText = "UPCOMING APPROVAL";
      badgeBg = "#F8FAFC";
      badgeColor = "#475569";
      headline = "Upcoming final approver notice";
      subhead = `Hi ${name}, you are the designated final approver for this request.`;
      buttonText = "View in PreciSign";
      break;
    case "UPCOMING_SIGNER_NOTICE":
      badgeText = "UPCOMING SIGNER";
      badgeBg = "#F8FAFC";
      badgeColor = "#475569";
      headline = "Upcoming signature in route";
      subhead = `Hi ${name}, you are an assigned signer for an upcoming stage in this request route.`;
      buttonText = "View in PreciSign";
      break;
    case "PROCESSOR_HANDOFF":
      badgeText = "READY FOR REVIEW";
      badgeBg = "#ECFDF5";
      badgeColor = "#047857";
      headline = "An approved request was assigned to you";
      subhead = "Open the signed request in PreciSign to review it.";
      buttonText = "View approved request";
      break;
    case "ROUTE_COMPLETED":
      badgeText = "ROUTE COMPLETED";
      badgeBg = "#ECFDF5";
      badgeColor = "#047857";
      headline = "Signing route completed";
      subhead = `Hi ${name}, all required approvals have been completed for your request.`;
      if (payload.processorHandoff) subhead += " It was handed off to the assigned processors.";
      buttonText = "View completed form";
      break;
  }
  const stageHeaderBadge = payload.stageBadge || (payload.stageNumber && payload.totalStages ? `STAGE ${payload.stageNumber} OF ${payload.totalStages}` : eventType === "ROUTE_COMPLETED" ? "COMPLETED" : "");
  let amountBoxHtml = "";
  let topButtonHtml = "";
  const btnBg = !payload.dynamicSummary && payload.formPreview ? "#0D9488" : "#0A1E35";
  if (payload.amountHighlight) {
    amountBoxHtml = `
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 20px; margin-bottom: 22px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="vertical-align: middle;">
              <div style="font-size: 11px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(payload.amountHighlight.label)}</div>
              <div style="font-size: 26px; font-weight: 700; color: #0F172A; margin-top: 2px; letter-spacing: -0.5px;">
                ${escapeHtml(payload.amountHighlight.amount)} <span style="font-size: 14px; font-weight: 600; color: #475569;">${escapeHtml(payload.amountHighlight.currency)}</span>
              </div>
            </td>
            <td style="vertical-align: middle; text-align: right;">
              <a href="${link}" style="background-color: ${btnBg}; color: #FFFFFF; text-decoration: none; font-size: 13px; font-weight: 600; padding: 11px 22px; border-radius: 6px; display: inline-block;">
                ${escapeHtml(buttonText)}
              </a>
            </td>
          </tr>
        </table>
        ${isLocal ? '<div style="font-size: 11px; color: #94A3B8; margin-top: 8px;">(Local-only link: opens only on the computer running PreciSign)</div>' : ""}
      </div>
    `;
  } else {
    topButtonHtml = `
      <div style="margin: 0 0 22px;">
        <a href="${link}" style="background-color: ${btnBg}; color: #FFFFFF; text-decoration: none; font-size: 14px; font-weight: 600; padding: 11px 26px; border-radius: 6px; display: inline-block;">
          ${escapeHtml(buttonText)}
        </a>
        ${isLocal ? '<div style="font-size: 11px; color: #94A3B8; margin-top: 6px;">(Local-only link: opens only on the computer running PreciSign)</div>' : ""}
      </div>
    `;
  }
  let summaryCardHtml = "";
  if (payload.dynamicSummary && payload.dynamicSummary.length > 0) {
    const rowsHtml = payload.dynamicSummary.map((r, idx) => {
      const isLast = idx === payload.dynamicSummary.length - 1;
      const borderStyle = isLast ? "" : "border-bottom: 1px solid #EDF2F7;";
      let valHtml = escapeHtml(r.value);
      if (r.isPriorityPill) {
        valHtml = renderPriorityPill(r.value);
      } else if (r.isMonospace) {
        valHtml = `<span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 600; color: #1E293B;">${escapeHtml(r.value)}</span>`;
      } else if (r.isAmount) {
        valHtml = `<strong style="font-size: 15px; color: #0F172A;">${escapeHtml(r.value)}</strong>`;
      }
      return `
        <tr style="${borderStyle}">
          <td style="padding: 7px 0; color: #64748B; width: 130px; font-weight: 500;">${escapeHtml(r.label)}</td>
          <td style="padding: 7px 0; color: #0F172A;">${valHtml}</td>
        </tr>
      `;
    }).join("");
    summaryCardHtml = `
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 18px; margin-bottom: 22px;">
        <div style="font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 12px;">Request summary</div>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size: 13px;">
          ${rowsHtml}
        </table>
      </div>
    `;
  } else if (payload.formPreview) {
    summaryCardHtml = renderBilingualFormHtml(payload.formPreview);
  } else {
    summaryCardHtml = `
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 18px; margin-bottom: 22px;">
        <div style="font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 12px;">Request summary</div>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size: 13px;">
          <tr style="border-bottom: 1px solid #EDF2F7;"><td style="padding: 7px 0; color: #64748B; width: 130px;">Company</td><td style="padding: 7px 0; color: #0F172A;">${company}</td></tr>
          <tr style="border-bottom: 1px solid #EDF2F7;"><td style="padding: 7px 0; color: #64748B;">Form</td><td style="padding: 7px 0; color: #0F172A;">${formType}</td></tr>
          <tr style="border-bottom: 1px solid #EDF2F7;"><td style="padding: 7px 0; color: #64748B;">Reference</td><td style="padding: 7px 0; font-family: monospace; font-weight: 600; color: #1E293B;">${displayCode}</td></tr>
          <tr><td style="padding: 7px 0; color: #64748B;">Requester</td><td style="padding: 7px 0; color: #0F172A;">${requester}</td></tr>
        </table>
      </div>
    `;
  }
  let precirouteTrailHtml = "";
  if (payload.precirouteTrail && payload.precirouteTrail.length > 0) {
    const itemsHtml = payload.precirouteTrail.map((item, idx) => {
      const isLast = idx === payload.precirouteTrail.length - 1;
      const initial = escapeHtml(item.initial || item.name[0] || "U");
      const actionColor = item.action === "Signed" || item.action === "Approved" ? "#15803d" : "#64748B";
      const speechBorderColor = item.roleTag.toLowerCase().includes("requester") ? "#0D9488" : "#6366F1";
      return `
        <div style="margin-bottom: ${isLast ? "0" : "14px"};">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="width: 36px; vertical-align: top;">
                <div style="width: 32px; height: 32px; border-radius: 50%; background-color: ${escapeHtml(item.avatarBg || "#CCFBF1")}; color: ${escapeHtml(item.avatarColor || "#0F766E")}; text-align: center; line-height: 32px; font-weight: 700; font-size: 13px;">
                  ${initial}
                </div>
              </td>
              <td style="padding-left: 10px; vertical-align: top;">
                <div style="font-size: 13px; margin-bottom: 4px;">
                  <strong style="color: #0F172A;">${escapeHtml(item.name)} (${escapeHtml(item.roleTag)})</strong>
                  <span style="color: ${actionColor}; font-size: 12px; font-weight: 600;">&nbsp;&middot;&nbsp;${escapeHtml(item.action)}</span>
                  ${item.timestamp ? `<span style="color: #94A3B8; font-size: 11px; margin-left: 6px;">${escapeHtml(item.timestamp)}</span>` : ""}
                </div>
                ${item.comment ? `
                  <div style="background: #F8FAFC; border-left: 3px solid ${speechBorderColor}; padding: 8px 12px; border-radius: 0 6px 6px 0; font-size: 13px; color: #334155; line-height: 1.45;">
                    ${escapeHtml(item.comment)}
                  </div>
                ` : ""}
              </td>
            </tr>
          </table>
          ${isLast ? "" : '<div style="height: 1px; background: #F1F5F9; margin: 12px 0 12px 42px;"></div>'}
        </div>
      `;
    }).join("");
    precirouteTrailHtml = `
      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 18px; margin-bottom: 22px;">
        <div style="font-size: 13px; font-weight: 700; color: #0F172A; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
          PreciRoute Trail
        </div>
        <div>
          ${itemsHtml}
        </div>
      </div>
    `;
  } else if (payload.emailNote && payload.emailNote.trim()) {
    precirouteTrailHtml = `
      <div style="margin: 18px 0; padding: 12px 16px; border-left: 3px solid #0D9488; background-color: #F8FAFC; border-radius: 0 6px 6px 0;">
        <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 4px;">Note from ${requester}</div>
        <div style="font-size: 13px; color: #475569; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(payload.emailNote)}</div>
      </div>
    `;
  }
  let completionSummaryHtml = "";
  let completionSummaryText = "";
  if (payload.completionSummary?.steps?.length) {
    let rowsHtml = "";
    for (const step of payload.completionSummary.steps) {
      const statusColor = step.status === "Signed" ? "#15803d" : "#b45309";
      rowsHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 6px 10px; border: 1px solid #e2e8f0;">${escapeHtml(step.stageName)}</td>
          <td style="padding: 6px 10px; border: 1px solid #e2e8f0;">${escapeHtml(step.assignedUserName)}</td>
          <td style="padding: 6px 10px; border: 1px solid #e2e8f0; color: ${statusColor}; font-weight: bold;">${escapeHtml(step.status)}</td>
        </tr>
      `;
      completionSummaryText += `- ${step.stageName} (${step.assignedUserName}): ${step.status}
`;
    }
    completionSummaryHtml = `
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 18px; margin-bottom: 22px;">
        <h4 style="margin: 0 0 10px; color: #1e293b; font-size: 14px; font-weight: 700;">Signer Action Summary</h4>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="background: #f1f5f9; text-align: left;">
              <th style="padding: 6px 10px; border: 1px solid #e2e8f0;">Stage</th>
              <th style="padding: 6px 10px; border: 1px solid #e2e8f0;">Signer</th>
              <th style="padding: 6px 10px; border: 1px solid #e2e8f0;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <p style="margin-top: 10px; margin-bottom: 0; font-size: 12px; color: #64748b; font-style: italic;">
          Note: Detailed bypass rationale, audit trails, and document signatures are kept securely inside PreciSign.
        </p>
      </div>
    `;
  }
  const publicLogoUrl = process.env.PRECISIGN_PUBLIC_LOGO_URL || (process.env.PRECISIGN_PUBLIC_ASSET_URL ? `${process.env.PRECISIGN_PUBLIC_ASSET_URL.replace(/\/+$/, "")}/assets/precisign-p-logo.png` : "https://files.catbox.moe/3jnkzm.png");
  const html = `
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${renderEmailSubject(eventType, payload)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    td { padding: 0; }
    img { border: 0; outline: none; text-decoration: none; display: block; }
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; border-radius: 0 !important; }
      .email-content { padding: 16px !important; }
      .form-table td, .form-table th { padding: 6px 8px !important; font-size: 11px !important; }
      .signature-col { display: block !important; width: 100% !important; border-right: none !important; border-bottom: 1px solid #CBD5E1 !important; }
      .header-grid-col { display: block !important; width: 100% !important; text-align: left !important; }
      .header-grid-col-right { text-align: right !important; margin-top: 4px !important; }
      .responsive-half { display: block !important; width: 100% !important; border-right: none !important; }
    }
  </style>
</head>
<body style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 10px; color: #334155; -webkit-font-smoothing: antialiased;">
  <div class="email-container" style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 10px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
    
    <!-- Corporate Navy Header Banner with P Logo & Stage Indicator -->
    <div style="background-color: #0A1E35; padding: 16px 24px; border-bottom: 2px solid #0D9488;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="vertical-align: middle;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align: middle;">
                  <table cellpadding="0" cellspacing="0" border="0" style="width: 32px; height: 32px; background-color: #FFFFFF; border-radius: 7px; border-collapse: collapse;">
                    <tr>
                      <td align="center" valign="middle" style="text-align: center; vertical-align: middle; padding: 0;">
                        <img src="${publicLogoUrl}" alt="P" width="20" height="22" style="display: block; margin: 0 auto; border: 0; outline: none; text-decoration: none;" />
                      </td>
                    </tr>
                  </table>
                </td>
                <td style="vertical-align: middle; padding-left: 10px;">
                  <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.5px; text-decoration: none;">PreciSign</span>
                </td>
              </tr>
            </table>
          </td>
          ${stageHeaderBadge ? `
            <td style="vertical-align: middle; text-align: right;">
              <span style="background: rgba(13, 148, 136, 0.2); border: 1px solid #0D9488; color: #5EEAD4; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; letter-spacing: 0.5px; text-transform: uppercase;">
                ${escapeHtml(stageHeaderBadge)}
              </span>
            </td>
          ` : ""}
        </tr>
      </table>
    </div>

    <!-- Body Content -->
    <div class="email-content" style="padding: 24px;">
      
      <!-- Action/Status Pill Badge -->
      <div style="display: inline-block; padding: 4px 10px; background-color: ${badgeBg}; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 11px; font-weight: 700; color: ${badgeColor}; letter-spacing: 0.5px; text-transform: uppercase;">
        ${escapeHtml(badgeText)}
      </div>

      <!-- Heading & Subtitle -->
      <h1 style="margin: 12px 0 6px; color: #0F172A; font-size: 22px; font-weight: 700; line-height: 1.25; letter-spacing: -0.3px;">${escapeHtml(headline)}</h1>
      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: #475569;">${subhead}</p>

      <!-- Amount Callout Box (if present) OR Top CTA button -->
      ${amountBoxHtml || topButtonHtml}

      <!-- Main Body: Dynamic Request Summary Card or Form Preview -->
      ${summaryCardHtml}

      <!-- Completion Summary if Route Completed -->
      ${completionSummaryHtml}

      <!-- PreciRoute Trail (Audit & Remarks) -->
      ${precirouteTrailHtml}

      <!-- Footer & Confidentiality -->
      <div style="border-top: 1px solid #E2E8F0; padding-top: 16px; margin-top: 20px; text-align: center;">
        <div style="font-size: 12px; color: #475569;">
          View the full form and attachments in <a href="${link}" style="color: #0D9488; text-decoration: none; font-weight: 600;">PreciSign</a>.
        </div>
        <div style="font-size: 11px; color: #94A3B8; margin-top: 6px; line-height: 1.5;">
          This is an automated notification from PreciSign. Confidential form contents and attachments are protected.
        </div>
      </div>

    </div>
  </div>
</body>
</html>
  `.trim();
  let text2 = `${renderEmailSubject(eventType, payload)}

`;
  text2 += `${headline}
${subhead}

`;
  if (payload.amountHighlight) {
    text2 += `[${payload.amountHighlight.label}: ${payload.amountHighlight.amount} ${payload.amountHighlight.currency}]

`;
  }
  if (!payload.dynamicSummary && payload.formPreview) {
    const fp = payload.formPreview;
    text2 += `${fp.companyName}
${fp.formTitleEnglish}
${fp.payment.amount}
`;
    text2 += `Action: ${buttonText}
`;
    text2 += `Note from ${payload.requesterName}:
${payload.emailNote || ""}

`;
  }
  text2 += `Action link: ${payload.portalUrl}

`;
  if (payload.dynamicSummary && payload.dynamicSummary.length > 0) {
    text2 += `Request Summary:
`;
    for (const r of payload.dynamicSummary) {
      text2 += `- ${r.label}: ${r.value}
`;
    }
    text2 += `
`;
  }
  if (completionSummaryText) {
    text2 += `Signer Action Summary:
${completionSummaryText}
`;
  }
  if (payload.precirouteTrail && payload.precirouteTrail.length > 0) {
    text2 += `PreciRoute Trail:
`;
    for (const item of payload.precirouteTrail) {
      text2 += `- ${item.name} (${item.roleTag}) - ${item.action}`;
      if (item.timestamp) text2 += ` [${item.timestamp}]`;
      text2 += `
`;
      if (item.comment) {
        text2 += `  Remark: "${item.comment}"
`;
      }
    }
    text2 += `
`;
  } else if (payload.emailNote) {
    text2 += `Note from ${payload.requesterName}:
${payload.emailNote}

`;
  }
  text2 += `View full form: ${payload.portalUrl}
`;
  text2 += `This is an automated notification from PreciSign. Confidential form contents and attachments are protected.
`;
  return { html, text: text2 };
}

// backend/src/email/emailTransport.ts
import { Resend } from "resend";
var APPROVED_RESEND_TEST_RECIPIENTS = /* @__PURE__ */ new Set([
  "delivered@resend.dev",
  "bounced@resend.dev",
  "complained@resend.dev"
]);
var MockEmailTransport = class {
  constructor() {
    this.sent = [];
    this.delayMs = 0;
  }
  async send(options) {
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    if (this.failNextWith) {
      const failure = this.failNextWith;
      this.failNextWith = void 0;
      return {
        accepted: false,
        delivered: false,
        error: failure.message,
        retryable: failure.retryable,
        uncertain: failure.uncertain
      };
    }
    this.sent.push({ ...options });
    return {
      accepted: true,
      delivered: true,
      resendId: `mock_resend_${Date.now()}_${Math.random().toString(36).substring(7)}`
    };
  }
  clear() {
    this.sent = [];
    this.failNextWith = void 0;
  }
};
var ResendEmailTransport = class {
  constructor(config = {}) {
    const rawMode = config.mode || process.env.PRECISIGN_EMAIL_MODE || "sandbox";
    if (!["disabled", "sandbox", "live"].includes(rawMode)) {
      throw new Error(`Invalid PRECISIGN_EMAIL_MODE '${rawMode}'. Must be 'disabled', 'sandbox', or 'live'.`);
    }
    this.mode = rawMode;
    this.apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
    this.sender = config.sender || process.env.PRECISIGN_EMAIL_SENDER || "PreciSign <onboarding@resend.dev>";
    this.testRecipient = config.testRecipient || process.env.PRECISIGN_TEST_RECIPIENT || "delivered@resend.dev";
    if (this.apiKey) {
      this.resend = new Resend(this.apiKey);
    }
  }
  getMode() {
    return this.mode;
  }
  async send(options) {
    if (this.mode === "disabled") {
      return {
        accepted: false,
        delivered: false,
        error: "Email delivery is disabled (mode=disabled).",
        retryable: false,
        uncertain: false
      };
    }
    if (!this.apiKey || !this.resend) {
      return {
        accepted: false,
        delivered: false,
        error: "Missing RESEND_API_KEY configuration for email delivery.",
        retryable: false,
        uncertain: false
      };
    }
    let targetEmail = options.to;
    let targetSubject = options.subject;
    if (this.mode === "sandbox") {
      if (APPROVED_RESEND_TEST_RECIPIENTS.has(targetEmail)) {
      } else {
        targetSubject = `[Sandbox -> ${options.to}] ${options.subject}`;
        targetEmail = APPROVED_RESEND_TEST_RECIPIENTS.has(this.testRecipient) ? this.testRecipient : "delivered@resend.dev";
      }
    } else if (this.mode === "live") {
      if (this.sender.includes("resend.dev")) {
        return {
          accepted: false,
          delivered: false,
          error: "Live delivery mode requires a verified custom sender domain (cannot send from resend.dev).",
          retryable: false,
          uncertain: false
        };
      }
    }
    try {
      const { data, error } = await this.resend.emails.send(
        {
          from: this.sender,
          to: [targetEmail],
          subject: targetSubject,
          html: options.html,
          text: options.text
        },
        {
          idempotencyKey: options.idempotencyKey
        }
      );
      if (error) {
        const errorName = error.name;
        const isRetryable = errorName === "rate_limit_exceeded" || errorName === "internal_server_error" || errorName === "application_error" || error.statusCode === 429 || error.statusCode >= 500;
        const isUncertain = errorName === "internal_server_error" || errorName === "application_error" || error.statusCode >= 500;
        return {
          accepted: false,
          delivered: false,
          error: `[${error.name}] ${error.message}`,
          retryable: isRetryable,
          uncertain: isUncertain
        };
      }
      return {
        accepted: true,
        resendId: data?.id,
        // The send API confirms acceptance, not a delivery event.
        delivered: false
      };
    } catch (err) {
      return {
        accepted: false,
        delivered: false,
        error: err?.message || "Network error communicating with Resend",
        retryable: true,
        uncertain: true
      };
    }
  }
};

// backend/src/email/outboxStore.ts
import { randomUUID as randomUUID4 } from "node:crypto";

// shared/navigation/pageRoutes.ts
var pagePaths = {
  dashboard: "/dashboard",
  "forms-library": "/forms",
  archive: "/archive",
  "user-profile": "/settings/profile",
  "workflow-settings": "/settings/signing-routes",
  "user-directory": "/settings/users",
  "company-branding": "/settings/branding"
};
var formPaths = {
  "Administrative & Payment Request": "administrative-payment",
  "IT Request": "it-request",
  "Cash Voucher": "cash-voucher",
  "Expense Claim": "expense-claim",
  "R&D Initiative": "rnd",
  "Admin Work Request": "admin-work"
};
function pageRouteHref(route) {
  if (route.view === "review-sign") return `/requests/${encodeURIComponent(route.requestId || "")}`;
  if (route.view === "create-request") return `/forms/${formPaths[route.formType] || "admin-work"}/new`;
  if (route.view === "requests") return `/requests?filter=${route.filter || "all"}`;
  return route.view === "not-found" ? "/not-found" : pagePaths[route.view];
}

// backend/src/email/requestSequence.ts
function formTypeToPrefix(formType) {
  switch (formType) {
    case "Administrative & Payment Request":
      return "AP";
    case "Admin Work Request":
      return "AW";
    case "IT Request":
      return "IT";
    case "R&D Initiative":
      return "RD";
    case "Cash Voucher":
      return "CV";
    case "Expense Claim":
      return "EC";
    default:
      return "AW";
  }
}
function formatSequenceReference(companyId, formCode, year, seq) {
  const padded = String(seq).padStart(4, "0");
  return `${companyId}-${formCode}-${year}-${padded}`;
}
var ALLOCATE_SEQUENCE_SQL = `
INSERT INTO request_counters (company_id, form_code, year, last_seq)
VALUES (?, ?, ?, 1)
ON CONFLICT(company_id, form_code, year)
DO UPDATE SET last_seq = last_seq + 1;
`;
var GET_SEQUENCE_SQL = `
SELECT last_seq FROM request_counters
WHERE company_id = ? AND form_code = ? AND year = ?;
`;
function allocateSequenceSync(db2, companyId, formCode, year = (/* @__PURE__ */ new Date()).getFullYear()) {
  db2.prepare(ALLOCATE_SEQUENCE_SQL).run(companyId, formCode, year);
  const row = db2.prepare(GET_SEQUENCE_SQL).get(companyId, formCode, year);
  const seq = row?.last_seq ?? 1;
  return formatSequenceReference(companyId, formCode, year, seq);
}
async function allocateSequenceAsync(connection, companyId, formCode, year = (/* @__PURE__ */ new Date()).getFullYear()) {
  await connection.execute(ALLOCATE_SEQUENCE_SQL, [companyId, formCode, year]);
  const res = await connection.execute(GET_SEQUENCE_SQL, [companyId, formCode, year]);
  const seq = Number(res.rows[0]?.last_seq ?? 1);
  return formatSequenceReference(companyId, formCode, year, seq);
}
function getRequestDisplayReference(request) {
  if (request.displayId && request.displayId.trim()) {
    return request.displayId.trim();
  }
  return request.id;
}

// backend/src/email/outboxStore.ts
function getAppPortalUrl(requestId) {
  const emailUrl = process.env.PRECISIGN_EMAIL_APP_URL?.trim();
  const appUrl = process.env.PRECISIGN_APP_URL?.trim();
  const appOrigin = process.env.APP_ORIGIN?.trim();
  const isProduction = process.env.NODE_ENV === "production";
  const base = emailUrl || appUrl || appOrigin;
  if (isProduction) {
    if (!base) {
      throw new Error("In production, PRECISIGN_EMAIL_APP_URL, PRECISIGN_APP_URL, or APP_ORIGIN must be set.");
    }
    if (base.includes("localhost") || base.includes("127.0.0.1")) {
      throw new Error(`In production, hosted emails cannot link to local origin: "${base}". Set a public HTTPS application origin.`);
    }
    if (!base.startsWith("https://")) {
      throw new Error(`In production, hosted emails must link to HTTPS origin: "${base}".`);
    }
  }
  const effectiveBase = base || "http://127.0.0.1:3000";
  const cleanBase = effectiveBase.replace(/\/+$/, "");
  const relativePath = pageRouteHref({ view: "review-sign", requestId });
  return `${cleanBase}${relativePath}`;
}
function buildIdempotencyKey(eventType, requestId, docVersion, revision2, recipientUserId) {
  return `precisign/${eventType}/${requestId}-v${docVersion}-r${revision2}-${recipientUserId}`;
}
function formatEmailDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return dateStr;
  }
}
function buildDynamicSummary(request, displayId) {
  const fd = request.formData || {};
  const ap = fd.administrativePayment;
  const payment = ap?.payment;
  const rows = [];
  const companyVal = fd.companyName || request.companyName || request.companyId;
  rows.push({ label: "Company", value: companyVal });
  rows.push({ label: "Form", value: request.formType });
  rows.push({ label: "Reference", value: displayId, isMonospace: true });
  const formLower = (request.formType || "").toLowerCase();
  const isExpense = formLower.includes("expense") || formLower.includes("claim");
  const requesterVal = fd.requesterName || request.requesterName || fd.claimant || "\u2014";
  rows.push({ label: isExpense ? "Claimant" : "Requester", value: requesterVal });
  const subDate = formatEmailDate(request.createdAt || fd.dateOfRequest);
  if (subDate) {
    rows.push({ label: "Submission Date", value: subDate });
  }
  if (formLower.includes("administrative & payment") || formLower.includes("payment")) {
    if (fd.department) rows.push({ label: "Department", value: fd.department });
    if (fd.priority) rows.push({ label: "Priority", value: fd.priority, isPriorityPill: true });
    if (fd.workDescription) rows.push({ label: "Work", value: fd.workDescription });
    if (payment?.amount) rows.push({ label: "Amount", value: `${payment.amount} SAR`, isAmount: true });
    if (payment?.purpose) {
      const p = payment.purpose === "Other" ? payment.otherPurpose || "Other" : payment.purpose;
      if (p) rows.push({ label: "Purpose", value: p });
    }
  } else if (formLower.includes("it request") || formLower.includes("it")) {
    if (fd.department) rows.push({ label: "Department", value: fd.department });
    const reqType = fd.itRequest?.requestType || fd.requestType;
    if (reqType) rows.push({ label: "Request Type", value: reqType });
    if (fd.priority) rows.push({ label: "Priority", value: fd.priority, isPriorityPill: true });
    const desc = fd.workDescription || fd.description;
    if (desc) rows.push({ label: "Description", value: desc });
  } else if (formLower.includes("cash voucher") || formLower.includes("voucher")) {
    const payee = fd.cashVoucher?.payee || fd.payee || fd.payeeName;
    if (payee) rows.push({ label: "Payee", value: payee });
    const amountVal = fd.cashVoucher?.amount || fd.amount;
    if (amountVal) rows.push({ label: "Amount", value: `${amountVal} SAR`, isAmount: true });
    const purpose = fd.workDescription || fd.purpose || fd.cashVoucher?.purpose;
    if (purpose) rows.push({ label: "Purpose", value: purpose });
  } else if (isExpense) {
    const project = fd.expenseClaim?.project || fd.project || fd.projectName;
    if (project) rows.push({ label: "Project", value: project });
    const lines = fd.expenseClaim?.lines || fd.expenseItems;
    let totalClaimed = fd.totalAmount || fd.amount;
    if (!totalClaimed && Array.isArray(lines) && lines.length > 0) {
      const sumCents = lines.reduce((acc, line) => {
        const amt = parseFloat(line.amount) || 0;
        return acc + Math.round(amt * 100);
      }, 0);
      totalClaimed = (sumCents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    if (totalClaimed) rows.push({ label: "Total Claimed", value: `${totalClaimed} SAR`, isAmount: true });
    if (Array.isArray(lines) && lines.length > 0) {
      rows.push({ label: "Expense Lines", value: `${lines.length} line${lines.length === 1 ? "" : "s"}` });
    }
  } else {
    if (fd.department) rows.push({ label: "Department", value: fd.department });
    if (fd.priority) rows.push({ label: "Priority", value: fd.priority, isPriorityPill: true });
    if (fd.workDescription || fd.description) rows.push({ label: "Description", value: fd.workDescription || fd.description });
  }
  return rows;
}
function buildAmountHighlight(request) {
  const fd = request.formData || {};
  const ap = fd.administrativePayment;
  const payment = ap?.payment;
  if (payment?.amount) {
    return {
      label: "Payment Amount",
      amount: String(payment.amount),
      currency: "SAR"
    };
  }
  const voucherAmount = fd.cashVoucher?.amount || fd.amount;
  if (voucherAmount) {
    return {
      label: "Voucher Amount",
      amount: String(voucherAmount),
      currency: "SAR"
    };
  }
  const lines = fd.expenseClaim?.lines || fd.expenseItems;
  if (Array.isArray(lines) && lines.length > 0) {
    const sumCents = lines.reduce((acc, l) => {
      const amt = parseFloat(l.amount) || 0;
      return acc + Math.round(amt * 100);
    }, 0);
    const total = (sumCents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return {
      label: "Total Claimed",
      amount: total,
      currency: "SAR"
    };
  }
  if (fd.totalAmount) {
    return {
      label: "Total Claimed",
      amount: String(fd.totalAmount),
      currency: "SAR"
    };
  }
  return void 0;
}
function buildPreciRouteTrail(request, emailNote) {
  const trail = [];
  const note = emailNote || request.emailNote || request.formData?.emailNote;
  const reqName = request.requesterName || "Requester";
  trail.push({
    name: reqName,
    roleTag: "Requester",
    action: "Submitted",
    initial: reqName.trim()[0]?.toUpperCase() || "R",
    avatarBg: "#CCFBF1",
    avatarColor: "#0F766E",
    comment: note?.trim() ? note.trim() : void 0,
    timestamp: formatEmailDate(request.createdAt)
  });
  const history = request.approvalHistory || [];
  let signerIndex = 1;
  for (const h of history) {
    if (h.stepNumber === 0 || h.action === "Submitted" || h.action === "Evaluation Updated") {
      continue;
    }
    const action = h.action === "Approved" ? "Signed" : h.action;
    const name = h.actionByName || h.actionByRole || `Signer ${signerIndex}`;
    const initial = name.trim()[0]?.toUpperCase() || "S";
    const roleTag = h.stepNumber ? `Signer ${h.stepNumber}` : signerIndex === 1 ? "Signer 1" : `Signer ${signerIndex}`;
    const isBypassOrOverride = h.action === "Director Override" || h.action === "Route Completed" || h.action === "Bypassed" || Boolean(h.reason) || (h.comments || "").toLowerCase().includes("bypassed");
    const comment = isBypassOrOverride ? void 0 : (h.comments || "").trim();
    const dateVal = h.dateTime || h.timestamp;
    trail.push({
      name,
      roleTag,
      action,
      initial,
      avatarBg: "#E0E7FF",
      avatarColor: "#4338CA",
      comment: comment ? comment : void 0,
      timestamp: formatEmailDate(dateVal)
    });
    signerIndex++;
  }
  return trail;
}
function createOutboxItem(eventType, request, recipient, nowMs, extra) {
  const portalUrl = getAppPortalUrl(request.id);
  const displayId = getRequestDisplayReference(request);
  const emailNote = extra?.emailNote || request.emailNote || request.formData?.emailNote;
  const dynamicSummary = buildDynamicSummary(request, displayId);
  const amountHighlight = buildAmountHighlight(request);
  const precirouteTrail = buildPreciRouteTrail(request, emailNote);
  const totalStages = request.approvalSteps?.length || 0;
  const currentStageIndex = typeof request.currentStageIndex === "number" ? request.currentStageIndex : 0;
  let stageBadge = void 0;
  if (eventType === "ACTION_REQUIRED") {
    stageBadge = totalStages > 0 ? `STAGE ${currentStageIndex + 1} OF ${totalStages}` : "ACTION REQUIRED";
  } else if (eventType === "ROUTE_COMPLETED") {
    stageBadge = "COMPLETED";
  } else if (eventType === "REQUEST_SUBMITTED") {
    stageBadge = "SUBMITTED";
  }
  const formPreview = extra?.formPreview;
  const payload = {
    companyId: request.companyId,
    companyName: request.formData?.companyName || request.companyId,
    formType: request.formType,
    requestId: request.id,
    displayId,
    emailNote,
    amountHighlight,
    dynamicSummary,
    precirouteTrail,
    stageBadge,
    stageNumber: currentStageIndex + 1,
    totalStages,
    formPreview,
    requesterName: request.requesterName,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    portalUrl,
    ...extra
  };
  const subject = renderEmailSubject(eventType, payload);
  const revision2 = request.revision ?? 1;
  const idempotencyKey = buildIdempotencyKey(
    eventType,
    request.id,
    request.documentVersion,
    revision2,
    recipient.id
  );
  return {
    id: randomUUID4(),
    requestId: request.id,
    eventType,
    recipientUserId: recipient.id,
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    subject,
    payload,
    idempotencyKey,
    nowMs
  };
}
function buildSubmissionEmails(request, requester, allUsers, nowMs = Date.now(), emailNote) {
  const items = [];
  const note = emailNote || request.emailNote;
  const userMap = /* @__PURE__ */ new Map();
  for (const u of allUsers) {
    if (!u.isDisabled) userMap.set(u.id, u);
  }
  const reqEmail = requester.notificationEmail || requester.email;
  if (reqEmail && !requester.isDisabled) {
    items.push(
      createOutboxItem("REQUEST_SUBMITTED", request, {
        id: requester.id,
        name: requester.name,
        email: reqEmail
      }, nowMs, {
        emailNote: note
      })
    );
  }
  const firstStep = request.approvalSteps[0];
  if (firstStep && firstStep.assignedUserId && firstStep.status === "Pending") {
    const firstUser = userMap.get(firstStep.assignedUserId) ?? (firstStep.assignedUserId === requester.id ? requester : void 0);
    const firstEmail = firstUser?.notificationEmail || firstUser?.email;
    if (firstUser && firstEmail && !firstUser.isDisabled) {
      items.push(
        createOutboxItem("ACTION_REQUIRED", request, {
          id: firstUser.id,
          name: firstUser.name,
          email: firstEmail
        }, nowMs, {
          stageName: firstStep.stageName,
          emailNote: note
        })
      );
    }
  }
  const finalIdx = request.approvalSteps.length - 1;
  for (let i = 1; i < request.approvalSteps.length; i++) {
    const step = request.approvalSteps[i];
    if (!step.assignedUserId) continue;
    const user = userMap.get(step.assignedUserId);
    const userEmail = user?.notificationEmail || user?.email;
    if (!user || !userEmail || user.isDisabled) continue;
    const isFinal = step.isFinalApproval === true || i === finalIdx;
    const eventType = isFinal ? "UPCOMING_FINAL_APPROVER_NOTICE" : "UPCOMING_SIGNER_NOTICE";
    items.push(
      createOutboxItem(eventType, request, {
        id: user.id,
        name: user.name,
        email: userEmail
      }, nowMs, {
        stageName: step.stageName,
        isFinalApprover: isFinal,
        emailNote: note
      })
    );
  }
  return items;
}
function buildNextActionEmail(previousRecord, record, getUser, nowMs = Date.now()) {
  if (previousRecord && previousRecord.currentApproverId === record.currentApproverId) {
    return void 0;
  }
  const currentStep = record.approvalSteps.find((s) => s.status === "Pending") || record.approvalSteps[record.currentStageIndex];
  if (!currentStep || !currentStep.assignedUserId) return void 0;
  const user = getUser(currentStep.assignedUserId);
  if (!user || user.isDisabled) return void 0;
  const email = user.notificationEmail || user.email;
  if (!email) return void 0;
  return createOutboxItem("ACTION_REQUIRED", record, {
    id: user.id,
    name: user.name,
    email
  }, nowMs, {
    stageName: currentStep.stageName,
    stageNumber: currentStep.stageNumber
  });
}
function buildCompletionEmail(record, getUser, nowMs = Date.now()) {
  const requester = getUser(record.requesterId);
  if (!requester || requester.isDisabled) return void 0;
  const email = requester.notificationEmail || requester.email;
  if (!email) return void 0;
  const stepsSummary = record.approvalSteps.map((s) => ({
    stageName: s.stageName,
    assignedUserName: s.assignedUserName,
    status: s.status === "Approved" ? "Signed" : s.status,
    actionDate: s.actionDate
  }));
  return createOutboxItem("ROUTE_COMPLETED", record, {
    id: requester.id,
    name: requester.name,
    email
  }, nowMs, {
    processorHandoff: Boolean(record.processorHandoff?.length),
    completionSummary: {
      completedDate: formatEmailDate((/* @__PURE__ */ new Date()).toISOString()),
      steps: stepsSummary
    }
  });
}
function buildProcessorEmail(record, user, nowMs) {
  const email = user?.notificationEmail || user?.email;
  if (!user || !email || user.isDisabled) return void 0;
  return createOutboxItem("PROCESSOR_HANDOFF", { ...record, revision: 0 }, { id: user.id, name: user.name, email }, nowMs, {
    emailNote: void 0,
    amountHighlight: void 0,
    dynamicSummary: void 0,
    precirouteTrail: void 0,
    stageNumber: void 0,
    totalStages: void 0
  });
}
function buildReplacementActionEmail(record, targetUser, nowMs = Date.now()) {
  if (targetUser.isDisabled) return void 0;
  const email = targetUser.notificationEmail || targetUser.email;
  if (!email) return void 0;
  const activeStep = record.approvalSteps[record.currentStageIndex];
  return createOutboxItem("ACTION_REQUIRED", record, {
    id: targetUser.id,
    name: targetUser.name,
    email
  }, nowMs, {
    stageName: activeStep?.stageName
  });
}
function planTransitionNotification(action, record, previousRecord, actorId, body) {
  if (action === "approve" || action === "override") {
    if (record.status === "Approved") {
      return { kind: "completion", userId: record.requesterId };
    }
    if (record.status === "Pending Approval" && record.currentApproverId) {
      if (!previousRecord || previousRecord.currentApproverId !== record.currentApproverId) {
        return { kind: "nextAction", userId: record.currentApproverId };
      }
    }
  } else if (action === "replace" || action === "accept-replacement") {
    if (record.status === "Pending Approval" && record.currentApproverId) {
      const targetId = action === "replace" ? body.newUserId : actorId;
      if (body.accept !== false && targetId && record.currentApproverId === targetId) {
        return { kind: "replacement", userId: targetId };
      }
    }
  }
  return null;
}
function buildNotificationFromPlan(plan, user, record, previousRecord, nowMs = Date.now()) {
  if (!plan || !user) return void 0;
  if (plan.kind === "completion") {
    return buildCompletionEmail(record, () => user, nowMs);
  }
  if (plan.kind === "nextAction") {
    return buildNextActionEmail(previousRecord, record, () => user, nowMs);
  }
  if (plan.kind === "replacement") {
    return buildReplacementActionEmail(record, user, nowMs);
  }
  return void 0;
}
function enqueueOutboxSync(db2, items) {
  if (!items.length) return;
  const stmt = db2.prepare(`
    INSERT OR IGNORE INTO email_outbox (
      id, request_id, event_type, recipient_user_id, recipient_email, recipient_name,
      subject, payload_json, idempotency_key, status, attempts, max_attempts,
      created_at, next_attempt_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, ?, ?)
  `);
  for (const item of items) {
    stmt.run(
      item.id,
      item.requestId,
      item.eventType,
      item.recipientUserId,
      item.recipientEmail,
      item.recipientName,
      item.subject,
      JSON.stringify(item.payload),
      item.idempotencyKey,
      item.nowMs,
      item.nowMs
    );
  }
}
async function enqueueOutboxAsync(tx, items) {
  if (!items.length) return;
  const sql = `
    INSERT OR IGNORE INTO email_outbox (
      id, request_id, event_type, recipient_user_id, recipient_email, recipient_name,
      subject, payload_json, idempotency_key, status, attempts, max_attempts,
      created_at, next_attempt_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, ?, ?)
  `;
  for (const item of items) {
    await tx.execute(sql, [
      item.id,
      item.requestId,
      item.eventType,
      item.recipientUserId,
      item.recipientEmail,
      item.recipientName,
      item.subject,
      JSON.stringify(item.payload),
      item.idempotencyKey,
      item.nowMs,
      item.nowMs
    ]);
  }
}

// backend/src/email/outboxProcessor.ts
import { randomUUID as randomUUID5 } from "node:crypto";
var OutboxProcessor = class {
  constructor(db2, transport, options = {}) {
    this.isProcessing = false;
    this.db = db2;
    this.transport = transport;
    this.workerToken = randomUUID5();
    this.batchSize = options.batchSize ?? 10;
    this.leaseDurationMs = options.leaseDurationMs ?? 12e4;
    this.backoffBaseMs = options.backoffBaseMs ?? 1e3;
    this.maxBackoffMs = options.maxBackoffMs ?? 6e4;
    this.now = options.now ?? Date.now;
    this.sendSpacingMs = options.sendSpacingMs ?? (transport instanceof ResendEmailTransport && transport.getMode() === "live" ? 3e3 : 0);
  }
  getWorkerToken() {
    return this.workerToken;
  }
  calculateBackoff(attempts) {
    return Math.min(this.backoffBaseMs * Math.pow(2, attempts), this.maxBackoffMs);
  }
  validateMessagePayload(record, payload) {
    const validEventTypes = [
      "REQUEST_SUBMITTED",
      "ACTION_REQUIRED",
      "UPCOMING_FINAL_APPROVER_NOTICE",
      "UPCOMING_SIGNER_NOTICE",
      "ROUTE_COMPLETED",
      "PROCESSOR_HANDOFF"
    ];
    if (!validEventTypes.includes(record.event_type)) {
      return { valid: false, reason: "Unsupported event type." };
    }
    if (!record.recipient_email || typeof record.recipient_email !== "string" || !record.recipient_email.includes("@")) {
      return { valid: false, reason: "Invalid recipient email." };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { valid: false, reason: "Payload must be an object." };
    }
    const p = payload;
    if (!p.requestId || typeof p.requestId !== "string") {
      return { valid: false, reason: "Missing requestId in payload." };
    }
    if (!p.formType || typeof p.formType !== "string") {
      return { valid: false, reason: "Missing formType in payload." };
    }
    return { valid: true };
  }
  async processBatch(customWorkerToken) {
    const token = customWorkerToken || this.workerToken;
    const nowMs = this.now();
    let processed = 0;
    let accepted = 0;
    let failed = 0;
    const findCandidatesSql = `
      SELECT id FROM email_outbox
      WHERE (status = 'pending' AND next_attempt_at <= ?)
         OR (status = 'processing' AND lease_expires_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?
    `;
    let candidateIds = [];
    if ("prepare" in this.db) {
      const rows = this.db.prepare(findCandidatesSql).all(nowMs, nowMs, this.batchSize);
      candidateIds = rows.map((r) => r.id);
    } else {
      const res = await this.db.execute(findCandidatesSql, [nowMs, nowMs, this.batchSize]);
      candidateIds = res.rows.map((r) => String(r.id));
    }
    if (!candidateIds.length) {
      return { processed: 0, accepted: 0, failed: 0 };
    }
    const leaseExpires = nowMs + this.leaseDurationMs;
    const claimSql = `
      UPDATE email_outbox
      SET status = 'processing',
          lease_token = ?,
          lease_expires_at = ?
      WHERE id = ?
        AND ((status = 'pending' AND next_attempt_at <= ?)
          OR (status = 'processing' AND lease_expires_at <= ?))
    `;
    const claimedRecords = [];
    const selectSql = "SELECT * FROM email_outbox WHERE id = ?";
    for (const id of candidateIds) {
      if ("prepare" in this.db) {
        const result = this.db.prepare(claimSql).run(token, leaseExpires, id, nowMs, nowMs);
        if (result.changes === 1) {
          const rec = this.db.prepare(selectSql).get(id);
          if (rec) claimedRecords.push(rec);
        }
      } else {
        const result = await this.db.execute(claimSql, [token, leaseExpires, id, nowMs, nowMs]);
        if (result.rowsAffected === 1) {
          const res = await this.db.execute(selectSql, [id]);
          if (res.rows.length) claimedRecords.push(res.rows[0]);
        }
      }
    }
    for (const record of claimedRecords) {
      processed++;
      const recordTime = this.now();
      const firstAttempt = record.first_attempt_at || record.created_at;
      const elapsedSinceFirst = recordTime - firstAttempt;
      if (record.attempts > 0 && elapsedSinceFirst > 24 * 60 * 60 * 1e3) {
        failed++;
        await this.updateRecordStatus(record.id, token, {
          status: "failed_unconfirmed",
          lastError: "Idempotency window (24 hours) expired with unconfirmed delivery outcome.",
          clearLease: true
        });
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(record.payload_json);
      } catch (err) {
        failed++;
        await this.updateRecordStatus(record.id, token, {
          status: "failed",
          lastError: "Invalid payload JSON.",
          clearLease: true
        });
        continue;
      }
      const validation = this.validateMessagePayload(record, payload);
      if (!validation.valid) {
        failed++;
        await this.updateRecordStatus(record.id, token, {
          status: "failed",
          lastError: `Invalid message payload: ${validation.reason}`,
          clearLease: true
        });
        continue;
      }
      let rendered;
      try {
        rendered = renderEmailContent(record.event_type, payload);
        if (!rendered.html || !rendered.text) {
          throw new Error("Email template generated empty content.");
        }
      } catch (err) {
        failed++;
        const safeError = err instanceof Error ? err.name : "RenderError";
        await this.updateRecordStatus(record.id, token, {
          status: "failed",
          lastError: `Email rendering failed (${safeError}).`,
          clearLease: true
        });
        continue;
      }
      const attemptTime = this.now();
      const pacingGuard = this.sendSpacingMs > 0 ? "AND NOT EXISTS (SELECT 1 FROM email_outbox WHERE last_attempt_at > ?)" : "";
      const recordAttemptSql = `
        UPDATE email_outbox
        SET attempts = attempts + 1,
            first_attempt_at = COALESCE(first_attempt_at, ?),
            last_attempt_at = ?
        WHERE id = ? AND lease_token = ? AND lease_expires_at > ?
        ${pacingGuard}
      `;
      const attemptArgs = [attemptTime, attemptTime, record.id, token, attemptTime];
      if (this.sendSpacingMs > 0) attemptArgs.push(attemptTime - this.sendSpacingMs);
      let attemptRecorded = false;
      if ("prepare" in this.db) {
        const attRes = this.db.prepare(recordAttemptSql).run(...attemptArgs);
        attemptRecorded = attRes.changes === 1;
      } else {
        const attRes = await this.db.execute(recordAttemptSql, attemptArgs);
        attemptRecorded = attRes.rowsAffected === 1;
      }
      if (!attemptRecorded) {
        if (this.sendSpacingMs > 0) {
          await this.updateRecordStatus(record.id, token, { status: "pending", clearLease: true });
          processed--;
        } else {
          console.warn(`[OutboxProcessor] Lease lost for record ${record.id} before calling Resend; skipped.`);
        }
        continue;
      }
      const currentAttempts = record.attempts + 1;
      let sendResult;
      try {
        sendResult = await this.transport.send({
          to: record.recipient_email,
          toName: record.recipient_name,
          subject: record.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: record.idempotency_key
        });
      } catch (err) {
        sendResult = {
          accepted: false,
          delivered: false,
          error: err?.message || "Network error communicating with email transport",
          retryable: true,
          uncertain: true
        };
      }
      if (sendResult.accepted) {
        const isDelivered = sendResult.delivered ?? false;
        const updated = await this.updateRecordStatus(record.id, token, {
          status: isDelivered ? "delivered" : "accepted",
          resendId: sendResult.resendId,
          acceptedAt: this.now(),
          deliveredAt: isDelivered ? this.now() : void 0,
          clearLease: true
        });
        if (updated) {
          accepted++;
        }
      } else {
        const isRetryable = sendResult.retryable ?? false;
        const maxAttemptsReached = currentAttempts >= record.max_attempts;
        const hadPriorUncertainAttempt = this.isUncertainAttempt(void 0, record.last_error);
        const currentAttemptUncertain = this.isUncertainAttempt(sendResult);
        const hasUncertainOutcome = hadPriorUncertainAttempt || currentAttemptUncertain;
        const is24HoursExpired = elapsedSinceFirst > 24 * 60 * 60 * 1e3;
        if (!isRetryable || maxAttemptsReached) {
          const finalStatus = hasUncertainOutcome || is24HoursExpired ? "failed_unconfirmed" : "failed";
          const baseError = sendResult.error || (maxAttemptsReached ? "Max delivery attempts exceeded." : "Delivery rejected.");
          const formattedLastError = hasUncertainOutcome && !baseError.includes("[UNCERTAIN]") ? `[UNCERTAIN] ${baseError}` : baseError;
          const updated = await this.updateRecordStatus(record.id, token, {
            status: finalStatus,
            lastError: formattedLastError,
            clearLease: true
          });
          if (updated) failed++;
        } else {
          const backoff = this.calculateBackoff(currentAttempts);
          const baseError = sendResult.error || "Transient delivery error.";
          const formattedLastError = hasUncertainOutcome && !baseError.includes("[UNCERTAIN]") ? `[UNCERTAIN] ${baseError}` : baseError;
          const updated = await this.updateRecordStatus(record.id, token, {
            status: "pending",
            nextAttemptAt: this.now() + backoff,
            lastError: formattedLastError,
            clearLease: true
          });
          if (updated) failed++;
        }
      }
    }
    return { processed, accepted, failed };
  }
  /**
   * Determines whether an attempt's failure represents an uncertain outcome
   * where Resend may have received and accepted the email, but PreciSign cannot confirm it.
   *
   * Definitive rejections (e.g. 400 validation, 401 auth, 403 domain, 409 conflict, 422 unprocessable, 429 rate limit)
   * explicitly indicate the email was NOT accepted.
   *
   * Uncertain outcomes (e.g. timeouts, network drops, socket hangups, 5xx server errors, crash during send)
   * mean the send might have succeeded on Resend's side while the client received no confirmation.
   */
  isUncertainAttempt(result, errorText) {
    if (result?.uncertain === true) return true;
    if (result?.uncertain === false) return false;
    const text2 = (errorText || result?.error || "").toLowerCase();
    if (!text2) return false;
    if (text2.includes("[uncertain]")) return true;
    if (text2.includes("timeout") || text2.includes("timed out") || text2.includes("etimedout") || text2.includes("esockettimedout")) {
      return true;
    }
    if (text2.includes("socket hang up") || text2.includes("econnreset") || text2.includes("network error") || text2.includes("fetch failed") || text2.includes("connection reset") || text2.includes("broken pipe")) {
      return true;
    }
    if (text2.includes("internal_server_error") || text2.includes("application_error") || text2.includes("500") || text2.includes("502") || text2.includes("503") || text2.includes("504") || text2.includes("bad gateway") || text2.includes("gateway timeout") || text2.includes("service unavailable")) {
      return true;
    }
    return false;
  }
  /**
   * Updates an outbox record requiring the exact current lease token.
   * If another worker claimed the record after lease expiration, changes will be 0
   * and the stale outcome is safely discarded without overwriting newer state.
   */
  async updateRecordStatus(id, leaseToken, updates) {
    const parts = ["status = ?"];
    const args = [updates.status];
    if (updates.resendId !== void 0) {
      parts.push("resend_id = ?");
      args.push(updates.resendId);
    }
    if (updates.acceptedAt !== void 0) {
      parts.push("accepted_at = ?");
      args.push(updates.acceptedAt);
    }
    if (updates.deliveredAt !== void 0) {
      parts.push("delivered_at = ?");
      args.push(updates.deliveredAt);
    }
    if (updates.nextAttemptAt !== void 0) {
      parts.push("next_attempt_at = ?");
      args.push(updates.nextAttemptAt);
    }
    if (updates.lastError !== void 0) {
      parts.push("last_error = ?");
      args.push(updates.lastError);
    }
    if (updates.clearLease) {
      parts.push("lease_token = NULL");
      parts.push("lease_expires_at = NULL");
    }
    args.push(id);
    args.push(leaseToken);
    const sql = `UPDATE email_outbox SET ${parts.join(", ")} WHERE id = ? AND lease_token = ?`;
    if ("prepare" in this.db) {
      const res = this.db.prepare(sql).run(...args);
      if (res.changes === 0) {
        console.warn(`[OutboxProcessor] Lease lost for record ${id}; outcome was not overwritten.`);
        return false;
      }
      return true;
    } else {
      const res = await this.db.execute(sql, args);
      if (res.rowsAffected === 0) {
        console.warn(`[OutboxProcessor] Lease lost for record ${id}; outcome was not overwritten.`);
        return false;
      }
      return true;
    }
  }
  /**
   * Non-blocking trigger invoked after database transactions commit.
   * Catches all errors internally so caller request flow is never interrupted.
   */
  async trigger() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.processBatch();
    } catch (err) {
      console.error("[PreciSign Outbox Processor] Background dispatch error:", err);
    } finally {
      this.isProcessing = false;
    }
  }
  /**
   * Starts the worker: immediately runs a batch to recover any pending/expired leases,
   * then schedules the background interval.
   */
  start(intervalMs = this.sendSpacingMs > 0 ? 1e3 : 1e4) {
    this.trigger().catch(() => {
    });
    this.startInterval(intervalMs);
  }
  startInterval(intervalMs = this.sendSpacingMs > 0 ? 1e3 : 1e4) {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => {
      this.trigger().catch(() => {
      });
    }, intervalMs);
    if (this.intervalTimer.unref) {
      this.intervalTimer.unref();
    }
  }
  stop() {
    this.stopInterval();
  }
  stopInterval() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = void 0;
    }
  }
};

// backend/src/processorHandoffRoutes.ts
function processorHandoffRoutes(db2, now, outbox) {
  const router = Router7();
  router.post(["/requests/:id/processor-read", "/requests/:id/processor-reassignment"], async (req, res, next) => {
    try {
      const reassign = req.path.endsWith("/processor-reassignment");
      fields(req.body, reassign ? ["version", "taskId", "from", "to", "reason"] : ["version"]);
      const { version } = req.body;
      if (!Number.isSafeInteger(version) || version < 1) fail("Choose an approved document version.");
      const intent = reassign ? {
        taskId: text(req.body.taskId, 150),
        from: text(req.body.from, 150),
        to: text(req.body.to, 150),
        reason: text(req.body.reason, 2e3).trim()
      } : void 0;
      if (intent && (!intent.reason || intent.from === intent.to)) fail("Choose a different processor and enter a reason.");
      const lookup = "SELECT record,revision FROM requests WHERE id=?";
      const people = "SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0";
      const update = "UPDATE requests SET record=? WHERE id=? AND revision=?";
      const apply = (actor, row, targetRow) => {
        if (!row) throw new RequestError(404, "Request not found.");
        const record = { ...JSON.parse(String(row.record)), revision: Number(row.revision) };
        if (!canUserAccessCompany(actor, record.companyId) || (intent ? !canConfigureSigningRoutes(actor, record.companyId) : !assignedProcessorIds(record).includes(actor.id))) throw new RequestError(404, "Request not found.");
        if (record.status !== "Approved" || version !== record.documentVersion) {
          throw new RequestError(409, "The approved document changed. Reload it before continuing.", "REQUEST_CONFLICT");
        }
        const at = new Date(now()).toISOString();
        if (!intent) {
          if (hasReadHandoff(record, actor.id)) return { record, changed: false };
          record.processorReads = [...record.processorReads ?? [], {
            userId: actor.id,
            name: actor.name,
            department: actor.department,
            version,
            at
          }];
          return { record, changed: true };
        }
        const target = targetRow && safeProfile(targetRow);
        const task = record.processorHandoff?.find((candidate) => candidate.taskId === intent.taskId);
        if (!task || !task.userIds.includes(intent.from) || hasReadHandoff(record, intent.from)) {
          throw new RequestError(409, "Only an unread assignment can be reassigned.", "PROCESSOR_REASSIGNMENT");
        }
        if (!target || task.userIds.includes(target.id) || !canAppearAsProcessor(target, record.companyId, record.formType, task.taskId)) {
          throw new RequestError(400, "Choose an eligible replacement processor.", "PROCESSOR_REASSIGNMENT");
        }
        const addedRecipient = !assignedProcessorIds(record).includes(intent.to);
        task.userIds = task.userIds.map((id) => id === intent.from ? intent.to : id);
        record.processorReassignments = [...record.processorReassignments ?? [], { ...intent, actorId: actor.id, at, version }];
        const email = addedRecipient && intent.to !== record.requesterId ? buildProcessorEmail(record, target, now()) : void 0;
        return { record, changed: true, email };
      };
      const result = "prepare" in db2 ? transaction(db2, () => {
        const result2 = apply(
          res.locals.requireCurrentUser(),
          db2.prepare(lookup).get(req.params.id),
          intent ? db2.prepare(people).get(intent.to) : void 0
        );
        if (result2.changed) db2.prepare(update).run(JSON.stringify(result2.record), result2.record.id, result2.record.revision);
        if (result2.email) enqueueOutboxSync(db2, [result2.email]);
        return result2.record;
      }) : await db2.transaction(async (tx) => {
        const result2 = apply(
          await res.locals.requireCurrentUserAsync(tx),
          (await tx.execute(lookup, [req.params.id])).rows[0],
          intent ? (await tx.execute(people, [intent.to])).rows[0] : void 0
        );
        if (result2.changed) await tx.execute(update, [JSON.stringify(result2.record), result2.record.id, result2.record.revision]);
        if (result2.email) await enqueueOutboxAsync(tx, [result2.email]);
        return result2.record;
      });
      if (intent) outbox?.trigger().catch(() => {
      });
      res.json(intent ? { processorHandoff: result.processorHandoff, processorReads: result.processorReads, processorReassignments: result.processorReassignments } : {
        processorReads: result.processorReads
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

// shared/utils/workflowEngine.ts
function createNewRequestRecord(params) {
  const { id, formType, formData, requester, workflowConfig, users, attachments: attachments2 = [], comment, signatureDataUrl } = params;
  if (!workflowConfig) throw new Error("No workflow is configured for this company and form.");
  if (!["PEW", "ICCL", "FSG"].includes(formData.companyId) || workflowConfig.companyId !== formData.companyId) {
    throw new Error("The request company does not match the workflow company.");
  }
  if (!canUserAccessCompany(requester, formData.companyId)) throw new Error("You do not have access to this company.");
  if (workflowConfig.formType !== formType) throw new Error("The workflow does not match the requested form.");
  if (!workflowConfig.stages?.length) throw new Error("The workflow must have at least one approval stage.");
  if (workflowConfig.stages.some((stage, index) => stage.isFinalApproval !== (index === workflowConfig.stages.length - 1))) {
    throw new Error("The workflow must designate only its last stage as final approver.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const approvalSteps = workflowConfig.stages.map((stage, index) => {
    const candidates = users.filter((u) => stage.assignedRole && u.role === stage.assignedRole && canUserAccessCompany(u, workflowConfig.companyId));
    if (!stage.assignedUserId && candidates.length > 1) {
      throw new Error(`Ambiguous approver for stage ${stage.name}; assign a specific user.`);
    }
    const assignedUser = stage.assignedUserId ? users.find((u) => u.id === stage.assignedUserId) : candidates[0];
    if (!assignedUser || !canUserAccessCompany(assignedUser, workflowConfig.companyId)) {
      throw new Error(`No eligible approver is configured for stage ${stage.name}.`);
    }
    if (assignedUser.id === requester.id) {
      throw new Error("The requester signs on submission and cannot also be an approver (self-approval).");
    }
    return {
      stageId: stage.id,
      stageNumber: stage.stageNumber,
      stageName: stage.name,
      assignedUserId: assignedUser?.id || stage.assignedUserId || "",
      assignedUserName: assignedUser?.name || stage.name,
      assignedRole: stage.assignedRole || assignedUser?.role || "Approver",
      status: index === 0 ? "Pending" : "Waiting"
    };
  });
  const firstStep = approvalSteps[0];
  const finalStep = approvalSteps[approvalSteps.length - 1];
  const enrichedFormData = {
    ...formData,
    requesterSignatureName: requester.name,
    requesterSignatureDate: now,
    requesterSignatureDataUrl: signatureDataUrl || requester.signatureDataUrl
  };
  const initialHistory = {
    id: `hist-${Date.now()}-1`,
    stepNumber: 0,
    actionByUserId: requester.id,
    actionByName: requester.name,
    actionByRole: requester.role,
    action: "Submitted",
    dateTime: now,
    comments: comment || "Request submitted.",
    version: 1
  };
  return {
    id,
    formType,
    companyId: formData.companyId,
    title: formData.workDescription.slice(0, 50) || `${formType} - ${requester.name}`,
    requesterId: requester.id,
    requesterName: requester.name,
    requesterRole: requester.role,
    department: formData.department || requester.department,
    createdAt: now,
    updatedAt: now,
    status: "Pending Approval",
    currentStageIndex: 0,
    currentApproverId: firstStep?.assignedUserId,
    currentApproverName: firstStep?.assignedUserName,
    firstApproverName: firstStep?.assignedUserName,
    finalApproverName: finalStep?.assignedUserName,
    workflowVersion: workflowConfig.version,
    documentVersion: 1,
    workflowConfig: structuredClone(workflowConfig),
    approvalSteps,
    approvalHistory: [initialHistory],
    attachments: attachments2,
    formData: enrichedFormData,
    versionSnapshots: [
      {
        version: 1,
        updatedAt: now,
        updatedBy: requester.name,
        formData: enrichedFormData,
        changeNote: "Initial Submission"
      }
    ]
  };
}
function approveRequestStage(params) {
  const { request, actingUser, comment, signatureDataUrl } = params;
  if (request.status !== "Pending Approval") {
    return { success: false, error: `Request cannot be approved in '${request.status}' state.` };
  }
  const finalIndex = request.approvalSteps.length - 1;
  const signingIndex = request.approvalSteps[finalIndex]?.assignedUserId === actingUser.id ? finalIndex : request.currentStageIndex;
  const currentStep = request.approvalSteps[signingIndex];
  if (!currentStep) {
    return { success: false, error: "No active approval stage found." };
  }
  if (currentStep.status === "Approved" || currentStep.status === "Bypassed") return { success: false, error: "This stage has already been signed or bypassed." };
  const isAssigned = currentStep.assignedUserId === actingUser.id;
  if (!isAssigned) {
    return {
      success: false,
      error: `Unauthorized: This stage is assigned to ${currentStep.assignedUserName}.`
    };
  }
  if (!canUserAccessCompany(actingUser, request.companyId)) {
    return { success: false, error: "Unauthorized: User does not have access to this company entity." };
  }
  if ((request.workflowConfig?.preventSelfApproval || actingUser.role === "Director") && request.requesterId === actingUser.id) {
    return {
      success: false,
      error: "Self-approval is prohibited by organization policy."
    };
  }
  const effectiveSignerName = actingUser.name?.trim();
  if (!effectiveSignerName) {
    return { success: false, error: "Signer identity is required for approval." };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const nextStageIndex = request.approvalSteps.findIndex((step, index) => index !== signingIndex && step.status !== "Approved" && step.status !== "Bypassed");
  const isFinalStage = nextStageIndex === -1;
  const updatedSteps = request.approvalSteps.map((step, idx) => {
    if (idx === signingIndex) {
      return {
        ...step,
        status: "Approved",
        actionDate: now,
        comments: comment?.trim() || void 0,
        signatureDataUrl: signatureDataUrl || actingUser.signatureDataUrl
      };
    }
    if (idx === nextStageIndex && !isFinalStage) {
      return {
        ...step,
        status: "Pending"
      };
    }
    return step;
  });
  const newHistoryItem = {
    id: `hist-${Date.now()}-${request.approvalHistory.length + 1}`,
    stepNumber: signingIndex + 1,
    actionByUserId: actingUser.id,
    actionByName: actingUser.name,
    actionByRole: actingUser.role,
    action: "Approved",
    dateTime: now,
    comments: comment?.trim() || "Checked and approved.",
    version: request.documentVersion
  };
  const updatedFormData = { ...request.formData };
  const currentStageConfig = request.workflowConfig?.stages?.[signingIndex];
  if (signingIndex === finalIndex || currentStageConfig?.mapsToDocumentSignature) {
    updatedFormData.approvalAuthoritySignatureName = actingUser.name;
    updatedFormData.approvalAuthoritySignatureDate = now;
    updatedFormData.approvalAuthoritySignatureDataUrl = signatureDataUrl || actingUser.signatureDataUrl;
  } else if (request.formType === "Administrative & Payment Request" && (request.workflowConfig.signerSelection === "company-directory" ? currentStageConfig?.documentSlot === "department-head" : signingIndex === 0 && finalIndex === 1) && updatedFormData.administrativePayment) {
    const dataUrl = signatureDataUrl || actingUser.signatureDataUrl;
    if (dataUrl) updatedFormData.administrativePayment = {
      ...updatedFormData.administrativePayment,
      departmentHeadSignature: { name: actingUser.name, dataUrl }
    };
  } else if (request.formType === "Expense Claim" && (request.workflowConfig.signerSelection === "company-directory" ? currentStageConfig?.documentSlot === "department-head" : signingIndex === 0 && finalIndex === 1) && updatedFormData.expenseClaim) {
    const dataUrl = signatureDataUrl || actingUser.signatureDataUrl;
    if (dataUrl) updatedFormData.expenseClaim = {
      ...updatedFormData.expenseClaim,
      departmentHeadSignature: { name: actingUser.name, dataUrl }
    };
  }
  const evaluationNeeded = request.formType === "R&D Initiative" && !rndEvaluationComplete(updatedFormData.rnd);
  const nextApprover = !isFinalStage ? updatedSteps[nextStageIndex] : evaluationNeeded ? updatedSteps.at(-1) : void 0;
  const updatedRequest = {
    ...request,
    updatedAt: now,
    status: isFinalStage && !evaluationNeeded ? "Approved" : "Pending Approval",
    currentStageIndex: isFinalStage ? evaluationNeeded ? finalIndex : request.currentStageIndex : nextStageIndex,
    currentApproverId: nextApprover?.assignedUserId,
    currentApproverName: nextApprover?.assignedUserName,
    approvalSteps: updatedSteps,
    approvalHistory: [...request.approvalHistory, newHistoryItem],
    formData: updatedFormData,
    ...request.formType === "R&D Initiative" ? { rndSignedStates: [...request.rndSignedStates ?? [], {
      version: request.documentVersion,
      stageId: currentStep.stageId,
      actorId: actingUser.id,
      at: now,
      signatureDataUrl: signatureDataUrl || actingUser.signatureDataUrl,
      formData: structuredClone(updatedFormData)
    }] } : {}
  };
  const evidenced = captureApproval(request, updatedRequest, actingUser, currentStep, signatureDataUrl || actingUser.signatureDataUrl || "", now);
  return { success: true, updatedRequest: isFinalStage ? freezeVersion(evidenced, "completed") : evidenced };
}
function returnRequestForCorrection(params) {
  const { request, actingUser, reason } = params;
  if (!reason || !reason.trim()) {
    return { success: false, error: "A clear reason is required to return for correction." };
  }
  if (request.status !== "Pending Approval") {
    return { success: false, error: `Cannot return request in '${request.status}' state.` };
  }
  const currentStep = request.approvalSteps[request.currentStageIndex];
  const isFinalApprover = request.approvalSteps.at(-1)?.assignedUserId === actingUser.id;
  if (currentStep?.assignedUserId !== actingUser.id && !isFinalApprover) {
    return { success: false, error: "Only the current or final approver can return for correction." };
  }
  if (!isFinalApprover && request.workflowConfig.stages[request.currentStageIndex]?.canReturnForCorrection === false) {
    return { success: false, error: "Return for correction is disabled for this stage." };
  }
  if (!canUserAccessCompany(actingUser, request.companyId)) {
    return { success: false, error: "Unauthorized: User does not have access to this company entity." };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const newHistoryItem = {
    id: `hist-${Date.now()}-${request.approvalHistory.length + 1}`,
    stepNumber: request.currentStageIndex + 1,
    actionByUserId: actingUser.id,
    actionByName: actingUser.name,
    actionByRole: actingUser.role,
    action: "Returned for Correction",
    dateTime: now,
    comments: reason.trim(),
    version: request.documentVersion
  };
  const updatedRequest = {
    ...request,
    updatedAt: now,
    status: "Returned for Correction",
    approvalHistory: [...request.approvalHistory, newHistoryItem]
  };
  return { success: true, updatedRequest: freezeVersion(updatedRequest, "returned") };
}
function resubmitCorrectedRequest(params) {
  const { request, actingUser, updatedFormData, changeNote, signatureDataUrl, attachments: attachments2 } = params;
  if (request.status !== "Returned for Correction") {
    return { success: false, error: "Only returned requests can be resubmitted." };
  }
  if (request.requesterId !== actingUser.id) {
    return { success: false, error: "Only the original requester can resubmit this request." };
  }
  if (updatedFormData.companyId !== request.companyId || updatedFormData.requesterId !== request.requesterId) {
    return { success: false, error: "The requester and company cannot be changed during correction." };
  }
  const outgoing = freezeVersion(request, "returned");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const nextVersion = request.documentVersion + 1;
  const resetSteps = request.approvalSteps.map((step, idx) => ({
    ...step,
    status: idx === 0 ? "Pending" : "Waiting",
    actionDate: void 0,
    comments: void 0,
    signatureDataUrl: void 0
  }));
  const enrichedFormData = {
    ...updatedFormData,
    ...request.formType === "R&D Initiative" ? { rndEvaluationUpdatedAfterSigning: void 0 } : {},
    ...request.formType === "R&D Initiative" && updatedFormData.rnd ? { rnd: {
      ...updatedFormData.rnd,
      fields: Object.fromEntries(Object.entries(updatedFormData.rnd.fields).filter(([id]) => !isEvaluationField(id))),
      choices: Object.fromEntries(Object.entries(updatedFormData.rnd.choices).filter(([id]) => !isEvaluationField(id)))
    } } : {},
    ...updatedFormData.administrativePayment && {
      administrativePayment: { ...updatedFormData.administrativePayment, departmentHeadSignature: void 0 }
    },
    ...updatedFormData.expenseClaim && {
      expenseClaim: { ...updatedFormData.expenseClaim, departmentHeadSignature: void 0 }
    },
    requesterSignatureName: actingUser.name,
    requesterSignatureDate: now,
    requesterSignatureDataUrl: signatureDataUrl || actingUser.signatureDataUrl,
    approvalAuthoritySignatureName: void 0,
    approvalAuthoritySignatureDate: void 0,
    approvalAuthoritySignatureDataUrl: void 0
  };
  const revisionNote = changeNote?.trim();
  const newHistoryItem = {
    id: `hist-${Date.now()}-${request.approvalHistory.length + 1}`,
    stepNumber: 0,
    actionByUserId: actingUser.id,
    actionByName: actingUser.name,
    actionByRole: actingUser.role,
    action: "Submitted",
    dateTime: now,
    comments: revisionNote ? `Resubmitted: ${revisionNote}` : `Resubmitted Version ${nextVersion}`,
    version: nextVersion
  };
  const firstStep = resetSteps[0];
  const updatedRequest = {
    ...outgoing,
    documentVersion: nextVersion,
    updatedAt: now,
    status: "Pending Approval",
    currentStageIndex: 0,
    currentApproverId: firstStep?.assignedUserId,
    currentApproverName: firstStep?.assignedUserName,
    approvalSteps: resetSteps,
    approvalHistory: [...request.approvalHistory, newHistoryItem],
    formData: enrichedFormData,
    attachments: attachments2 ?? request.attachments,
    versionSnapshots: [
      ...outgoing.versionSnapshots,
      {
        version: nextVersion,
        updatedAt: now,
        updatedBy: actingUser.name,
        formData: enrichedFormData,
        changeNote: revisionNote || `Version ${nextVersion} corrections`
      }
    ]
  };
  return { success: true, updatedRequest };
}
function rejectRequest(params) {
  const { request, actingUser, reason } = params;
  if (!reason || !reason.trim()) {
    return { success: false, error: "A clear reason is required to reject a request." };
  }
  if (request.status !== "Pending Approval") {
    return { success: false, error: `Cannot reject request in '${request.status}' state.` };
  }
  const currentStep = request.approvalSteps[request.currentStageIndex];
  const isFinalApprover = request.approvalSteps.at(-1)?.assignedUserId === actingUser.id;
  if (currentStep?.assignedUserId !== actingUser.id && !isFinalApprover) {
    return { success: false, error: "Only the current or final approver can reject." };
  }
  if (!isFinalApprover && currentStep?.assignedUserId === actingUser.id && request.workflowConfig.stages[request.currentStageIndex]?.canReject === false) {
    return { success: false, error: "Rejection is disabled for this stage." };
  }
  if (!canUserAccessCompany(actingUser, request.companyId)) {
    return { success: false, error: "Unauthorized: User does not have access to this company entity." };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const rejectingIndex = isFinalApprover ? request.approvalSteps.length - 1 : request.currentStageIndex;
  const updatedSteps = request.approvalSteps.map((step, idx) => {
    if (idx === rejectingIndex) {
      return {
        ...step,
        status: "Rejected",
        actionDate: now,
        comments: reason.trim()
      };
    }
    return step;
  });
  const newHistoryItem = {
    id: `hist-${Date.now()}-${request.approvalHistory.length + 1}`,
    stepNumber: rejectingIndex + 1,
    actionByUserId: actingUser.id,
    actionByName: actingUser.name,
    actionByRole: actingUser.role,
    action: "Rejected",
    dateTime: now,
    comments: reason.trim(),
    version: request.documentVersion
  };
  const updatedRequest = {
    ...request,
    updatedAt: now,
    status: "Rejected",
    currentApproverId: void 0,
    currentApproverName: void 0,
    approvalSteps: updatedSteps,
    approvalHistory: [...request.approvalHistory, newHistoryItem]
  };
  return { success: true, updatedRequest: freezeVersion(updatedRequest, "rejected") };
}
function cancelPreciRoute(params) {
  const { request, actingUser, reason } = params;
  if (request.requesterId !== actingUser.id || !canUserAccessCompany(actingUser, request.companyId) || !["Pending Approval", "Returned for Correction"].includes(request.status) || !reason?.trim()) return { success: false, error: "Only the requester can cancel an unfinished route, with a reason." };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updatedRequest = { ...request, status: "Cancelled", updatedAt: now, currentApproverId: void 0, currentApproverName: void 0, approvalHistory: [...request.approvalHistory, { id: crypto.randomUUID(), stepNumber: 0, actionByUserId: actingUser.id, actionByName: actingUser.name, actionByRole: actingUser.role, action: "Cancelled", dateTime: now, comments: reason.trim(), version: request.documentVersion }] };
  return { success: true, updatedRequest };
}
function completePreciRoute(params) {
  const { request, actingUser, reason, signatureDataUrl } = params;
  if (request.status !== "Pending Approval" || request.requesterId === actingUser.id || !canUserAccessCompany(actingUser, request.companyId) || request.approvalSteps.at(-1)?.assignedUserId !== actingUser.id) {
    return { success: false, error: "Only the assigned final approver can complete an open PreciRoute." };
  }
  if (request.formType === "R&D Initiative" && !rndEvaluationComplete(request.formData.rnd)) return { success: false, error: "Save an evaluation decision and recommended next action before completing." };
  if (!reason?.trim()) return { success: false, error: "A completion reason is required." };
  if (request.approvalSteps.slice(0, -1).some((step) => step.status !== "Approved" && request.workflowConfig.stages.find((stage) => stage.id === step.stageId)?.mustSign)) {
    return { success: false, error: "A required signature is still outstanding." };
  }
  if (request.approvalSteps.slice(0, -1).some((step) => step.status !== "Approved" && step.status !== "Bypassed") && !canCompleteWithOutstandingSteps(request, actingUser.id)) {
    return { success: false, error: "This signer can sign but cannot complete the route with outstanding signatures." };
  }
  const final = request.approvalSteps.at(-1);
  const signed = final.status === "Approved" ? { success: true, updatedRequest: request } : approveRequestStage({ request, actingUser, signatureDataUrl });
  if (!signed.success || !signed.updatedRequest) return signed;
  if (!signed.updatedRequest.approvalSteps.at(-1)?.signatureDataUrl) return { success: false, error: "The final approver must sign before completing." };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const bypassed = request.approvalSteps.slice(0, -1).filter((step) => step.status !== "Approved" && step.status !== "Bypassed");
  const updatedRequest = {
    ...signed.updatedRequest,
    status: "Approved",
    updatedAt: now,
    currentApproverId: void 0,
    currentApproverName: void 0,
    approvalSteps: signed.updatedRequest.approvalSteps.map((step) => step.status === "Approved" || step.status === "Bypassed" ? step : { ...step, status: "Bypassed", actionDate: now, comments: `Bypassed by final approver: ${reason.trim()}`, signatureDataUrl: void 0 }),
    approvalHistory: [...signed.updatedRequest.approvalHistory, { id: crypto.randomUUID(), stepNumber: request.approvalSteps.length, actionByUserId: actingUser.id, actionByName: actingUser.name, actionByRole: actingUser.role, action: "Route Completed", dateTime: now, version: request.documentVersion, comments: `${reason.trim()}. Bypassed: ${bypassed.map((step) => step.assignedUserName).join(", ") || "None"}` }]
  };
  return { success: true, updatedRequest: freezeVersion(updatedRequest, "completed") };
}

// shared/types/apiTypes.ts
var SUBMITTABLE_FORMS = ["Admin Work Request", "Administrative & Payment Request", "IT Request", "Cash Voucher", "Expense Claim", "R&D Initiative"];

// shared/utils/routeProcessing.ts
var financeHoldActions = ["hold", "evidence", "resume", "correction"];
var processingLabels = {
  itWork: "IT work completed",
  payment: "Payment recorded",
  adminWork: "Admin work completed",
  expenseSettlement: "Expense settled",
  cashPayout: "Cash paid out",
  cashReceipt: "Receipt acknowledged",
  cashReceiptWaiver: "Receiver acknowledgment waived"
};
function pendingProcessing(request) {
  if (request.status !== "Approved") return;
  if (request.formType === "Cash Voucher" && request.formData.cashVoucher) {
    if (!request.processing?.cashPayout) return "cashPayout";
    if (request.formData.cashVoucher.recipientUserId && !request.processing?.cashReceipt && !request.processing?.cashReceiptWaiver) return "cashReceipt";
  }
  if (request.formType === "IT Request" && request.formData.itRequest && !request.processing?.itWork) return "itWork";
  if (request.formType === "Expense Claim" && request.formData.expenseClaim && !request.processing?.expenseSettlement) return "expenseSettlement";
  if (request.formType === "Administrative & Payment Request" && request.formData.administrativePayment) {
    if (request.formData.administrativePayment.payment && !request.processing?.payment) return "payment";
    if (!request.processing?.adminWork) return "adminWork";
  }
}
function canJoinProcessingTeam(formType, role) {
  switch (formType) {
    case "IT Request":
      return role === "IT";
    case "Expense Claim":
      return role === "Finance";
    case "Cash Voucher":
    case "Administrative & Payment Request":
      return role === "Admin" || role === "Finance";
    default:
      return false;
  }
}
function canJoinCompanyProcessingTeam(formType, user, companyId) {
  const legacy = canJoinProcessingTeam(formType, user.role);
  if (formType === "Cash Voucher") return hasCompanyPermission(user, companyId, "cashier", legacy);
  if (formType === "Expense Claim") return hasCompanyPermission(user, companyId, "finance", legacy);
  if (formType === "Administrative & Payment Request") {
    return hasCompanyPermission(user, companyId, "finance", legacy) || canUserAccessCompany(user, companyId) && user.role === "Admin";
  }
  return canUserAccessCompany(user, companyId) && legacy;
}
function canRecordProcessing(request, actor, action) {
  if (!canUserAccessCompany(actor, request.companyId)) return false;
  const pending = pendingProcessing(request);
  if (action === "cashReceiptWaiver") {
    const approver = request.approvalSteps.at(-1);
    return pending === "cashReceipt" && request.workflowConfig.allowCashReceiptWaiver === true && approver?.status === "Approved" && approver.assignedUserId === actor.id;
  }
  if (pending !== action) return false;
  if ((action === "payment" || action === "expenseSettlement") && isFinanceHeld(request)) return false;
  if (action === "cashReceipt") return request.formData.cashVoucher?.recipientUserId === actor.id;
  const isAdmin = action === "adminWork" || action === "cashPayout" && request.formData.cashVoucher?.source === "Admin petty cash";
  const role = action === "itWork" ? "IT" : isAdmin ? "Admin" : "Finance";
  const eligible = action === "cashPayout" ? hasCompanyPermission(actor, request.companyId, "cashier", actor.role === role) : action === "payment" || action === "expenseSettlement" ? hasCompanyPermission(actor, request.companyId, "finance", actor.role === role) : actor.role === role;
  return eligible && request.workflowConfig.processingUserIds?.includes(actor.id) === true;
}
function isFinanceHeld(request) {
  return [...request.financeHoldHistory ?? []].reverse().find((event2) => event2.documentVersion === request.documentVersion && event2.action !== "evidence")?.action === "hold";
}
function canRecordFinanceHold(request, actor, action) {
  const pending = pendingProcessing(request);
  if (pending !== "payment" && pending !== "expenseSettlement" || !canUserAccessCompany(actor, request.companyId)) return false;
  const held = isFinanceHeld(request);
  if (action === "evidence") return held && actor.id === request.requesterId;
  const assignedFinance = hasCompanyPermission(actor, request.companyId, "finance", actor.role === "Finance") && request.workflowConfig.processingUserIds?.includes(actor.id) === true;
  return assignedFinance && (action === "hold" ? !held : held);
}
function processingRequiresSignature(action) {
  return action === "cashPayout" || action === "cashReceipt" || action === "cashReceiptWaiver" || action === "expenseSettlement";
}
function recordProcessing(request, actor, action, note, signatureDataUrl, attachment) {
  if (typeof note !== "string" || !note.trim() || note.length > 2e3) return { success: false, error: "Enter a note of up to 2,000 characters." };
  const at = (/* @__PURE__ */ new Date()).toISOString();
  if (action === "hold" || action === "evidence" || action === "resume" || action === "correction") {
    if (!canRecordFinanceHold(request, actor, action)) return { success: false, error: "This finance action is unavailable to you." };
    if (action === "evidence" && !attachment) return { success: false, error: "Attach the requested evidence." };
    if (action !== "evidence" && attachment) return { success: false, error: "Attachments are only accepted as follow-up evidence." };
    const history = request.financeHoldHistory ?? [];
    const total = history.reduce((size, entry) => size + (entry.attachment?.sizeBytes ?? 0), attachment?.sizeBytes ?? 0);
    if (total > 10 * 1024 * 1024) return { success: false, error: "Follow-up evidence exceeds 10 MiB." };
    return { success: true, updatedRequest: {
      ...action === "correction" ? freezeVersion({ ...request, updatedAt: at }, "returned") : request,
      updatedAt: at,
      ...action === "correction" && {
        status: "Returned for Correction",
        currentApproverId: void 0,
        currentApproverName: void 0,
        versionSnapshots: request.versionSnapshots.map((snapshot) => snapshot.version === request.documentVersion ? { ...snapshot, formData: structuredClone(request.formData) } : snapshot),
        approvalHistory: [...request.approvalHistory, {
          id: crypto.randomUUID(),
          stepNumber: 0,
          actionByUserId: actor.id,
          actionByName: actor.name,
          actionByRole: actor.role,
          action: "Returned for Correction",
          dateTime: at,
          comments: note.trim(),
          version: request.documentVersion
        }]
      },
      financeHoldHistory: [...history, { action, documentVersion: request.documentVersion, byUserId: actor.id, byName: actor.name, at, note: note.trim(), attachment }]
    } };
  }
  if (!canRecordProcessing(request, actor, action) || attachment) return { success: false, error: "This processing step is unavailable to you." };
  if (processingRequiresSignature(action) && !signatureDataUrl?.trim()) return { success: false, error: "Confirm a signature before continuing." };
  return { success: true, updatedRequest: {
    ...request,
    updatedAt: at,
    processing: {
      ...request.processing,
      [action]: { byUserId: actor.id, byName: actor.name, at, note: note.trim(), signatureDataUrl: processingRequiresSignature(action) ? signatureDataUrl : void 0 }
    }
  } };
}

// shared/utils/expenseEvidence.ts
function expenseEvidenceError(claim, attachments2) {
  for (const [index, line] of claim.lines.entries()) {
    const hasReason = !!line.noBillReason?.trim();
    if (line.receiptIndex === void 0 && hasReason) continue;
    if (!hasReason && Number.isSafeInteger(line.receiptIndex) && attachments2[line.receiptIndex]) continue;
    return `Expense ${index + 1}: select a receipt or give a no-bill reason.`;
  }
}
function preservesExpenseReceipts(claim, before, after) {
  return claim.lines.every(({ receiptIndex }) => receiptIndex === void 0 || !!before[receiptIndex] && before[receiptIndex].dataUrl === after[receiptIndex]?.dataUrl && before[receiptIndex].name === after[receiptIndex]?.name);
}

// shared/utils/signingSelection.ts
var noEligibleSigners = "No eligible signers available. Ask a workflow administrator to update this signing route.";
function isOptionalSigner(workflow, stage) {
  if (workflow.signerSelection === "company-directory") return !stage.isFinalApproval;
  return (workflow.formType === "Administrative & Payment Request" || workflow.formType === "Expense Claim") && !stage.isFinalApproval && stage.requiredOnSubmit !== true;
}
function signerOptions(workflow, stage, users, requesterId) {
  if (workflow.signerSelection === "company-directory") {
    return users.filter((person) => person.id !== requesterId && canAppearAsSigner(person, workflow.companyId, workflow.formType, stage.id));
  }
  const primary = resolveConfiguredSigner(stage, users, workflow.companyId);
  const ids = /* @__PURE__ */ new Set([primary?.id, ...stage.eligibleSignerIds ?? []]);
  return users.filter((person) => person.id !== requesterId && ids.has(person.id) && canAppearAsSigner(person, workflow.companyId, workflow.formType, stage.id));
}
function secondarySignerOptions(workflow, stage, users, excludedIds) {
  return users.filter((person) => !excludedIds.has(person.id) && (workflow.signerSelection === "company-directory" || stage.backupSignerIds?.includes(person.id)) && canAppearAsSigner(person, workflow.companyId, workflow.formType, stage.id));
}
function suggestedSignerChoices(workflow, users, requesterId, choices) {
  if (workflow.signerSelection !== "company-directory") return choices;
  return Object.fromEntries(workflow.stages.map((stage) => {
    if (Object.hasOwn(choices, stage.id)) return [stage.id, choices[stage.id]];
    const person = stage.isFinalApproval && signerOptions(workflow, stage, users, requesterId).find((user) => user.id === stage.assignedUserId);
    return [stage.id, person ? { primaryId: person.id, secondaryIds: [] } : null];
  }));
}
function applySignerChoices(workflow, users, requesterId, choices) {
  if (choices === void 0) {
    if (workflow.formType === "Admin Work Request") return { workflow, omittedSigningSteps: [] };
    choices = {};
  }
  if (!choices || typeof choices !== "object" || Array.isArray(choices) || Object.keys(choices).some((id) => !workflow.stages.some((stage) => stage.id === id))) {
    return { error: "Review the signing steps before sending." };
  }
  choices = suggestedSignerChoices(workflow, users, requesterId, choices);
  const directory = workflow.signerSelection === "company-directory";
  const chosen = [];
  const omittedSigningSteps = [];
  const backups = /* @__PURE__ */ new Map();
  for (const stage of workflow.stages) {
    let selection = Object.hasOwn(choices, stage.id) ? choices[stage.id] : void 0;
    if (selection !== null && typeof selection === "object") {
      if (!stage.isFinalApproval && !directory || Array.isArray(selection) || Object.keys(selection).some((key) => key !== "primaryId" && key !== "secondaryIds") || selection.primaryId !== null && typeof selection.primaryId !== "string" || !Array.isArray(selection.secondaryIds) || selection.secondaryIds.length > 20 || selection.secondaryIds.some((id2) => typeof id2 !== "string") || new Set(selection.secondaryIds).size !== selection.secondaryIds.length) {
        return { error: "Review the secondary final approvers before sending." };
      }
      if (directory && selection.primaryId === null && !stage.isFinalApproval) {
        return { error: `Choose a signer for ${stage.name}, or remove that optional step.` };
      }
      backups.set(stage.id, selection.secondaryIds);
      selection = selection.primaryId;
    }
    const options = signerOptions(workflow, stage, users, requesterId);
    if (selection === null || selection === void 0 && isOptionalSigner(workflow, stage)) {
      if (!isOptionalSigner(workflow, stage)) return { error: options.length ? `Choose an eligible signer for ${stage.name}.` : noEligibleSigners };
      omittedSigningSteps.push(stage.name);
      continue;
    }
    const id = selection;
    const person = options.find((candidate) => candidate.id === id);
    if (!person) return { error: options.length ? `Choose an eligible signer for ${stage.name}.` : noEligibleSigners };
    chosen.push({ ...stage, assignedUserId: person.id, assignedRole: person.role });
  }
  const final = chosen.at(-1);
  const stages = chosen.filter((stage) => {
    if (directory || stage === final || stage.assignedUserId !== final?.assignedUserId) return true;
    if (!isOptionalSigner(workflow, stage)) return true;
    omittedSigningSteps.push(stage.name);
    return false;
  }).map((stage, index) => ({ ...stage, stageNumber: index + 1 }));
  if (new Set(stages.map((stage) => stage.assignedUserId)).size !== stages.length) {
    return { error: "Choose a different person for each required signing step." };
  }
  for (const stage of stages) {
    const selected = backups.get(stage.id) ?? (directory ? [] : stage.backupSignerIds);
    if (selected === void 0) continue;
    const excluded = /* @__PURE__ */ new Set([requesterId, ...stages.map((item) => item.assignedUserId)]);
    const eligible = secondarySignerOptions(workflow, stage, users, excluded);
    if (selected.some((id) => !eligible.some((person) => person.id === id))) {
      return { error: "Choose backups who can access this company and are not already signing this request." };
    }
    stage.backupSignerIds = selected;
    stage.backupCompletionUserIds = stage.backupCompletionUserIds?.filter((id) => selected.includes(id));
  }
  return { workflow: { ...workflow, stages }, omittedSigningSteps };
}

// backend/src/posthogLogs.ts
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
var noopLogger = {
  emit: () => {
  },
  shutdown: async () => {
  }
};
var activeLogger = noopLogger;
function createPostHogLogger() {
  const token = process.env.VITE_POSTHOG_KEY?.trim();
  const host = process.env.VITE_POSTHOG_HOST?.trim().replace(/\/$/, "");
  if (!token || !host) {
    if (process.env.NODE_ENV !== "production") {
      if (!token) console.warn("VITE_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_KEY is configured");
      if (!host) console.warn("VITE_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_HOST is configured");
    }
    return noopLogger;
  }
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({ "service.name": "precisign-api" })
  });
  provider.addLogRecordProcessor(new BatchLogRecordProcessor(new OTLPLogExporter({
    url: `${host}/i/v1/logs`,
    headers: { Authorization: `Bearer ${token}` }
  })));
  const logger = provider.getLogger("precisign-posthog");
  return {
    emit(body, attributes) {
      logger.emit({ severityText: "info", body, attributes });
    },
    async shutdown() {
      await Promise.race([
        provider.shutdown(),
        new Promise((resolve2) => setTimeout(resolve2, 2e3))
      ]).catch(() => console.warn("PostHog log exporter shutdown did not complete."));
    }
  };
}
function initializePostHogLogger() {
  activeLogger = createPostHogLogger();
  return activeLogger;
}
function emitPostHogLog(body, attributes) {
  activeLogger.emit(body, attributes);
}

// backend/src/requestRoutes.ts
function computeSubmissionHash(companyId, formType, formData, comment, signatureDataUrl, signerChoices, emailNote, attachmentsList, processorChoices) {
  const normalized = {
    companyId,
    formType,
    formData,
    comment: comment || "",
    signatureDataUrl: signatureDataUrl || "",
    signerChoices: signerChoices || null,
    emailNote: emailNote || "",
    ...processorChoices === void 0 ? {} : { processorChoices },
    attachments: (attachmentsList || []).map((a) => ({ name: a.name, size: a.sizeBytes, mimeType: a.mimeType }))
  };
  return createHash3("sha256").update(JSON.stringify(normalized)).digest("hex");
}
function requestRoutes(db2, outboxProcessor, now = Date.now, storage) {
  const router = Router8();
  router.use(processorHandoffRoutes(db2, now, outboxProcessor));
  router.post("/requests", async (req, res, next) => {
    try {
      let buildRecord = function(actor2, row, company, users, displayId) {
        if (!company) fail("Company not found.");
        if (!canUserStartForm(actor2, companyId, body.formType)) throw new RequestError(403, "Company or form access denied.");
        if (!row) fail("No workflow is configured for this company.");
        let workflow = JSON.parse(String(row.config));
        if (!legacy && workflow.version !== body.expectedWorkflowVersion) throw new RequestError(409, "The signing route changed. Review the updated route before sending.", "WORKFLOW_CONFLICT");
        if (legacy && body.signerChoices !== void 0) fail("Signer selection is unavailable on the legacy form.");
        const selection = applySignerChoices(workflow, users, actor2.id, body.signerChoices);
        if (!selection.workflow) throw new RequestError(400, selection.error);
        workflow = selection.workflow;
        if (workflow.stages.some((stage) => stage.assignedUserId && !users.some((user) => user.id === stage.assignedUserId && canAppearAsSigner(user, companyId, body.formType, stage.id)))) fail("A configured signer is unavailable.");
        if (data.cashVoucher) {
          const recipient = users.find((user) => user.id === data.cashVoucher?.recipientUserId);
          if (!recipient || !canUserAccessCompany(recipient, companyId) || recipient.name !== data.cashVoucher.payee) fail("Choose an eligible voucher recipient.");
        }
        if (workflow.stages.some((stage) => stage.assignedUserId === actor2.id || !stage.assignedUserId && users.some((user) => user.id === actor2.id && user.role === stage.assignedRole))) {
          fail("The requester cannot also be an approver.");
        }
        if (!workflow.stages.length || workflow.stages.some((stage, index) => stage.isFinalApproval !== (index === workflow.stages.length - 1))) fail("Invalid final approver designation.");
        let processorHandoff;
        try {
          processorHandoff = resolveProcessorChoices(workflow, users, body.processorChoices);
        } catch (error) {
          throw new RequestError(400, error.message, "PROCESSOR_SELECTION");
        }
        const result = {
          ...createNewRequestRecord({
            id: `${companyId}-${prefix2}-${year}-${randomUUID6()}`,
            formType: body.formType,
            formData: { ...data, companyId, companyName: `${companyId} - ${company.name}`, companyLogoDataUrl: legacy ? void 0 : company.logo_data_url ?? void 0, requesterId: actor2.id, requesterName: actor2.name, emailNote: body.emailNote },
            requester: actor2,
            workflowConfig: workflow,
            users,
            attachments: files,
            comment: body.comment,
            signatureDataUrl: body.signatureDataUrl
          }),
          displayId,
          processorHandoff,
          emailNote: body.emailNote,
          omittedSigningSteps: selection.omittedSigningSteps,
          revision: 1
        };
        return result;
      };
      const body = req.body;
      fields(body, ["companyId", "formType", "formData", "attachments", "comment", "signatureDataUrl", "expectedDraftRevision", "expectedWorkflowVersion", "signerChoices", "processorChoices", "emailNote", "submissionKey"]);
      const rawKey = req.headers["idempotency-key"] ?? body.submissionKey;
      const submissionKey = typeof rawKey === "string" ? text(rawKey, 128, false).trim() || void 0 : void 0;
      const expectedDraft = body.expectedDraftRevision === void 0 ? void 0 : draftRevision(body.expectedDraftRevision);
      const combined = body.formType === "Administrative & Payment Request";
      const it = body.formType === "IT Request";
      const financial = body.formType === "Cash Voucher" ? "cashVoucher" : body.formType === "Expense Claim" ? "expenseClaim" : void 0;
      const legacy = body.formType === "Admin Work Request";
      if (!["PEW", "ICCL", "FSG"].includes(body.companyId) || !SUBMITTABLE_FORMS.includes(body.formType)) fail("Choose a legal company and a supported form.");
      const companyId = body.companyId;
      if (!legacy && body.formType !== "IT Request" && expectedDraft !== void 0) fail("This draft revision belongs to another form.");
      const actor = res.locals.user;
      if (!canUserStartForm(actor, companyId, body.formType)) throw new RequestError(403, "Company or form access denied.");
      const data = form(body.formData, false, combined, it, financial, body.formType === "R&D Initiative");
      await bytes(body.signatureDataUrl, true);
      if (body.comment !== void 0) text(body.comment, 2e3, false);
      if (body.emailNote !== void 0) text(body.emailNote, 2e3, false);
      const files = await attachments(body.attachments, actor.name);
      if (data.expenseClaim) {
        const evidenceError = expenseEvidenceError(data.expenseClaim, files);
        if (evidenceError) fail(evidenceError);
      }
      const payloadHash = submissionKey ? computeSubmissionHash(companyId, body.formType, data, body.comment, body.signatureDataUrl, body.signerChoices, body.emailNote, files, body.processorChoices) : "";
      if (submissionKey) {
        const existingRow = "prepare" in db2 ? db2.prepare("SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?").get(actor.id, submissionKey) : (await db2.execute("SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?", [actor.id, submissionKey])).rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            throw new RequestError(409, "The submission key was already used for a different request.", "SUBMISSION_CONFLICT");
          }
          res.status(200).json(JSON.parse(existingRow.response_json));
          return;
        }
      }
      if (!legacy && body.expectedWorkflowVersion !== void 0) {
        const wfRow = "prepare" in db2 ? db2.prepare("SELECT config FROM workflows WHERE company_id=? AND form_type=?").get(companyId, body.formType) : (await db2.execute("SELECT config FROM workflows WHERE company_id=? AND form_type=?", [companyId, body.formType])).rows[0];
        if (!wfRow) fail("No workflow is configured for this company.");
        const wf = JSON.parse(String(wfRow.config));
        if (wf.version !== body.expectedWorkflowVersion) {
          throw new RequestError(409, "The signing route changed. Review the updated route before sending.", "WORKFLOW_CONFLICT");
        }
      }
      if (expectedDraft !== void 0) {
        const currentDraft = "prepare" in db2 ? readDraft(db2, actor.id, companyId, body.formType) : await readDraftAsync(db2, actor.id, companyId, body.formType);
        if (currentDraft.revision !== expectedDraft) {
          throw new RequestError(409, "Draft changed in another session.", "DRAFT_CONFLICT");
        }
      }
      const uploadedRefs = [];
      if (storage) {
        for (const file of files) {
          if (file.dataUrl && !file.dataUrl.startsWith("r2:")) {
            await storage.upload(file);
            if (file.dataUrl?.startsWith("r2:")) {
              uploadedRefs.push(file.dataUrl);
            }
          }
        }
      }
      const workflowSql = "SELECT config FROM workflows WHERE company_id=? AND form_type=?";
      const companySql = "SELECT name,logo_data_url FROM companies LEFT JOIN company_logos ON company_id=id WHERE id=?";
      const usersSql = "SELECT * FROM account_profiles WHERE COALESCE(is_disabled,0)=0";
      const insertSql = "INSERT INTO requests VALUES (?,?,?,?,?,?)";
      const prefix2 = formTypeToPrefix(body.formType);
      const year = (/* @__PURE__ */ new Date()).getFullYear();
      let record;
      try {
        record = "prepare" in db2 ? transaction(db2, () => {
          const actor2 = res.locals.requireCurrentUser();
          if (submissionKey) {
            const existingInTx = db2.prepare("SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?").get(actor2.id, submissionKey);
            if (existingInTx) {
              if (existingInTx.payload_hash !== payloadHash) {
                throw new RequestError(409, "The submission key was already used for a different request.", "SUBMISSION_CONFLICT");
              }
              return JSON.parse(existingInTx.response_json);
            }
          }
          const allUsers = db2.prepare(usersSql).all().map(safeProfile);
          const displayId = allocateSequenceSync(db2, companyId, prefix2, year);
          const result = buildRecord(
            actor2,
            db2.prepare(workflowSql).get(companyId, body.formType),
            db2.prepare(companySql).get(companyId),
            allUsers,
            displayId
          );
          db2.prepare(insertSql).run(result.id, result.companyId, actor2.id, result.status, 1, JSON.stringify(result));
          if (expectedDraft !== void 0) writeDraft(db2, actor2.id, result.companyId, expectedDraft, null, body.formType);
          const emails = buildSubmissionEmails(result, actor2, allUsers, now(), body.emailNote);
          enqueueOutboxSync(db2, emails);
          const responsePayload = attachmentMetadata(result);
          if (submissionKey) {
            try {
              db2.prepare("INSERT INTO submission_idempotency (key, user_id, company_id, form_type, payload_hash, request_id, response_json, created_at) VALUES (?,?,?,?,?,?,?,?)").run(submissionKey, actor2.id, companyId, body.formType, payloadHash, result.id, JSON.stringify(responsePayload), now());
            } catch (insertErr) {
              const checkRow = db2.prepare("SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?").get(actor2.id, submissionKey);
              if (checkRow && checkRow.payload_hash === payloadHash) {
                return JSON.parse(checkRow.response_json);
              }
              throw insertErr;
            }
          }
          return responsePayload;
        }) : await db2.transaction(async (tx) => {
          const actor2 = await res.locals.requireCurrentUserAsync(tx);
          if (submissionKey) {
            const existingInTx = (await tx.execute("SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?", [actor2.id, submissionKey])).rows[0];
            if (existingInTx) {
              if (existingInTx.payload_hash !== payloadHash) {
                throw new RequestError(409, "The submission key was already used for a different request.", "SUBMISSION_CONFLICT");
              }
              return JSON.parse(existingInTx.response_json);
            }
          }
          const workflow = (await tx.execute(workflowSql, [companyId, body.formType])).rows[0];
          const company = (await tx.execute(companySql, [companyId])).rows[0];
          const users = (await tx.execute(usersSql)).rows.map(safeProfile);
          const displayId = await allocateSequenceAsync(tx, companyId, prefix2, year);
          const result = buildRecord(actor2, workflow, company, users, displayId);
          await tx.execute(insertSql, [result.id, result.companyId, actor2.id, result.status, 1, JSON.stringify(result)]);
          if (expectedDraft !== void 0) await writeDraftAsync(tx, actor2.id, result.companyId, expectedDraft, null, body.formType);
          const emails = buildSubmissionEmails(result, actor2, users, now(), body.emailNote);
          await enqueueOutboxAsync(tx, emails);
          const responsePayload = attachmentMetadata(result);
          if (submissionKey) {
            try {
              await tx.execute(
                "INSERT INTO submission_idempotency (key, user_id, company_id, form_type, payload_hash, request_id, response_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
                [submissionKey, actor2.id, companyId, body.formType, payloadHash, result.id, JSON.stringify(responsePayload), now()]
              );
            } catch (insertErr) {
              const checkRow = (await tx.execute("SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?", [actor2.id, submissionKey])).rows[0];
              if (checkRow && checkRow.payload_hash === payloadHash) {
                return JSON.parse(checkRow.response_json);
              }
              throw insertErr;
            }
          }
          return responsePayload;
        });
      } catch (txError) {
        if (uploadedRefs.length > 0) {
          console.warn("Attachment reconciliation candidates after failed request write:", uploadedRefs);
        }
        throw txError;
      }
      outboxProcessor?.trigger().catch(() => {
      });
      emitPostHogLog("request_submitted", { form_type: String(record.formType), attachment_count: files.length });
      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  });
  router.post("/requests/:id/:action", async (req, res, next) => {
    try {
      let transitionRecord = function(actor2, row, request, targetRow) {
        if (!canReadPreciRoute(actor2, request)) throw new RequestError(404, "Request not found.");
        if (Number(row.revision) !== body.expectedRevision) throw new RequestError(409, "Request changed. Refresh and review again.", "REQUEST_CONFLICT");
        if (action === "resubmit" && request.formType === "Expense Claim" && files && request.formData.expenseClaim && !preservesExpenseReceipts(
          request.formData.expenseClaim,
          request.attachments.map((file) => ({ ...file, dataUrl: attachmentIdentity(file.dataUrl) })),
          files.map((file) => ({ ...file, dataUrl: attachmentIdentity(file.dataUrl) }))
        )) {
          fail("Receipt links must be preserved when resubmitting this claim.");
        }
        const revised = action === "resubmit" ? form(
          body.formData,
          false,
          request.formType === "Administrative & Payment Request" && body.formData?.administrativePayment !== void 0,
          request.formType === "IT Request",
          request.formType === "Expense Claim" && body.formData?.expenseClaim !== void 0 ? "expenseClaim" : void 0,
          request.formType === "R&D Initiative"
        ) : void 0;
        if (revised?.expenseClaim) {
          const error = expenseEvidenceError(revised.expenseClaim, files ?? request.attachments);
          if (error) fail(error);
        }
        if (action === "replace" && !targetRow) fail("Replacement user not found.");
        const result = action === "rnd-evaluation" ? saveRndEvaluation(request, actor2, body.evaluation) : action === "process" ? recordProcessing(request, actor2, body.action, body.note, body.signatureDataUrl, evidence) : action === "replace" ? proposeSignerReplacement(request, actor2, safeProfile(targetRow), body.stageId, body.reason) : action === "accept-replacement" ? acceptSignerReplacement(request, actor2, body.accept) : action === "cancel" ? cancelPreciRoute({ request, actingUser: actor2, reason: body.reason }) : action === "approve" ? approveRequestStage({ request, actingUser: actor2, comment: body.comment, signatureDataUrl: body.signatureDataUrl }) : action === "return" ? returnRequestForCorrection({ request, actingUser: actor2, reason: body.reason }) : action === "reject" ? rejectRequest({ request, actingUser: actor2, reason: body.reason }) : action === "override" ? completePreciRoute({ request, actingUser: actor2, signatureDataUrl: body.signatureDataUrl, reason: body.reason }) : resubmitCorrectedRequest({ request, actingUser: actor2, updatedFormData: { ...request.formData, ...revised }, attachments: files, changeNote: body.changeNote, signatureDataUrl: body.signatureDataUrl });
        if (!result.success || !result.updatedRequest) throw new RequestError(403, result.error || "Action rejected.");
        const record = {
          ...result.updatedRequest,
          revision: Number(row.revision) + 1,
          attachmentVersions: action === "resubmit" ? [...request.attachmentVersions || [], { version: request.documentVersion, attachments: request.attachments }] : request.attachmentVersions
        };
        if (record.pendingReplacement && (record.status !== "Pending Approval" || ["Approved", "Bypassed", "Rejected"].includes(record.approvalSteps.find((step) => step.stageId === record.pendingReplacement.stageId)?.status || ""))) record.pendingReplacement = void 0;
        return record;
      }, updateArgs = function(record) {
        return [record.status, record.revision, JSON.stringify(record), record.id, body.expectedRevision];
      };
      const action = req.params.action;
      const body = req.body;
      const actor = res.locals.user;
      const allowed = { replace: ["expectedRevision", "stageId", "newUserId", "reason"], "accept-replacement": ["expectedRevision", "accept"], cancel: ["expectedRevision", "reason"], approve: ["expectedRevision", "comment", "signatureDataUrl"], return: ["expectedRevision", "reason"], reject: ["expectedRevision", "reason"], resubmit: ["expectedRevision", "formData", "attachments", "changeNote", "signatureDataUrl"], override: ["expectedRevision", "reason", "signatureDataUrl"] };
      allowed["rnd-evaluation"] = ["expectedRevision", "evaluation"];
      allowed.process = ["expectedRevision", "action", "note", "signatureDataUrl", "attachment"];
      if (!Object.hasOwn(allowed, action)) throw new RequestError(404, "Action not found.");
      fields(body, allowed[action]);
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) fail("Invalid revision.");
      if (action === "process") {
        if (typeof body.action !== "string" || !Object.hasOwn(processingLabels, body.action) && !financeHoldActions.some((action2) => action2 === body.action)) fail("Invalid processing action.");
        text(body.note, 2e3);
        if (processingRequiresSignature(body.action)) await bytes(body.signatureDataUrl, true);
      }
      if (["approve", "resubmit"].includes(action) || action === "override" && body.signatureDataUrl) await bytes(body.signatureDataUrl, true);
      if (["return", "reject", "override", "cancel", "replace"].includes(action)) text(body.reason, 2e3);
      if (body.comment !== void 0) text(body.comment, 2e3, false);
      if (body.changeNote !== void 0) text(body.changeNote, 2e3, false);
      if (action === "replace") {
        text(body.stageId, 150);
        text(body.newUserId, 150);
      }
      if (action === "accept-replacement" && typeof body.accept !== "boolean") fail("Acceptance required.");
      const evidence = action === "process" && body.attachment !== void 0 ? (await attachments([body.attachment], actor.name))[0] : void 0;
      const lookup = "SELECT * FROM requests WHERE id=?";
      const replacement = "SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0";
      const update = "UPDATE requests SET status=?,revision=?,record=? WHERE id=? AND revision=?";
      let files;
      const resubmitUploadedRefs = [];
      if (action === "resubmit" && body.attachments !== void 0 || storage && evidence) {
        const row = "prepare" in db2 ? db2.prepare(lookup).get(req.params.id) : (await db2.execute(lookup, [req.params.id])).rows[0];
        if (!row || !canUserAccessCompany(actor, row.company_id)) throw new RequestError(404, "Request not found.");
        const previous = JSON.parse(String(row.record));
        if (!canReadPreciRoute(actor, previous)) throw new RequestError(404, "Request not found.");
        if (Number(row.revision) !== body.expectedRevision) throw new RequestError(409, "Request changed. Refresh and review again.", "REQUEST_CONFLICT");
        if (action === "resubmit") files = await attachments(body.attachments, actor.name, previous.attachments);
        transitionRecord(actor, row, previous);
        if (storage) {
          const existingIds = new Set(previous.attachments.map((file) => file.id));
          for (const file of files ?? []) {
            if (!existingIds.has(file.id)) {
              if (file.dataUrl && !file.dataUrl.startsWith("r2:")) {
                await storage.upload(file);
                if (file.dataUrl?.startsWith("r2:")) {
                  resubmitUploadedRefs.push(file.dataUrl);
                }
              }
            }
          }
          if (evidence && evidence.dataUrl && !evidence.dataUrl.startsWith("r2:")) {
            await storage.upload(evidence);
            if (evidence.dataUrl?.startsWith("r2:")) {
              resubmitUploadedRefs.push(evidence.dataUrl);
            }
          }
        }
      }
      let updated;
      try {
        updated = "prepare" in db2 ? transaction(db2, () => {
          const actor2 = res.locals.requireCurrentUser();
          const row = db2.prepare(lookup).get(req.params.id);
          if (!row || !canUserAccessCompany(actor2, row.company_id)) throw new RequestError(404, "Request not found.");
          const previousRecord = JSON.parse(String(row.record));
          const target = action === "replace" ? db2.prepare(replacement).get(body.newUserId) : void 0;
          const record = transitionRecord(actor2, row, previousRecord, target);
          const saved = db2.prepare(update).run(...updateArgs(record));
          if (saved.changes !== 1) throw new RequestError(409, "Request changed. Refresh and review again.", "REQUEST_CONFLICT");
          const getUser = (userId) => {
            const u = db2.prepare("SELECT id, name, email, notification_email, COALESCE(is_disabled,0) AS is_disabled FROM account_profiles WHERE id=?").get(userId);
            return u ? { id: String(u.id), name: String(u.name), email: String(u.notification_email || u.email), isDisabled: u.is_disabled === 1 } : void 0;
          };
          const plan = planTransitionNotification(action, record, previousRecord, actor2.id, body);
          if (record.status === "Approved" && previousRecord.status !== "Approved") {
            for (const id of assignedProcessorIds(record)) {
              if (id === record.requesterId) continue;
              const row2 = db2.prepare("SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0").get(id);
              const user = row2 && safeProfile(row2);
              const email = user && canUserAccessCompany(user, record.companyId) && buildProcessorEmail(record, user, now());
              if (email) enqueueOutboxSync(db2, [email]);
            }
          }
          if (plan) {
            const user = getUser(plan.userId);
            const item = buildNotificationFromPlan(plan, user, record, previousRecord, now());
            if (item) enqueueOutboxSync(db2, [item]);
          }
          return record;
        }) : await db2.transaction(async (tx) => {
          const actor2 = await res.locals.requireCurrentUserAsync(tx);
          const row = (await tx.execute(lookup, [req.params.id])).rows[0];
          if (!row || !canUserAccessCompany(actor2, row.company_id)) throw new RequestError(404, "Request not found.");
          const previousRecord = JSON.parse(String(row.record));
          const target = action === "replace" ? (await tx.execute(replacement, [body.newUserId])).rows[0] : void 0;
          const record = transitionRecord(actor2, row, previousRecord, target);
          const saved = await tx.execute(update, updateArgs(record));
          if (saved.rowsAffected !== 1) throw new RequestError(409, "Request changed. Refresh and review again.", "REQUEST_CONFLICT");
          const getUserAsync = async (userId) => {
            const res2 = await tx.execute("SELECT id, name, email, notification_email, COALESCE(is_disabled,0) AS is_disabled FROM account_profiles WHERE id=?", [userId]);
            const u = res2.rows[0];
            return u ? { id: String(u.id), name: String(u.name), email: String(u.notification_email || u.email), isDisabled: u.is_disabled === 1 } : void 0;
          };
          const plan = planTransitionNotification(action, record, previousRecord, actor2.id, body);
          if (record.status === "Approved" && previousRecord.status !== "Approved") {
            for (const id of assignedProcessorIds(record)) {
              if (id === record.requesterId) continue;
              const row2 = (await tx.execute("SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0", [id])).rows[0];
              const user = row2 && safeProfile(row2);
              const email = user && canUserAccessCompany(user, record.companyId) && buildProcessorEmail(record, user, now());
              if (email) await enqueueOutboxAsync(tx, [email]);
            }
          }
          if (plan) {
            const user = await getUserAsync(plan.userId);
            const item = buildNotificationFromPlan(plan, user, record, previousRecord, now());
            if (item) await enqueueOutboxAsync(tx, [item]);
          }
          return record;
        });
      } catch (actionError) {
        if (resubmitUploadedRefs.length > 0) {
          console.warn("Attachment reconciliation candidates after failed request write:", resubmitUploadedRefs);
        }
        throw actionError;
      }
      outboxProcessor?.trigger().catch(() => {
      });
      res.json(attachmentMetadata(updated));
    } catch (error) {
      next(error);
    }
  });
  return router;
}

// backend/src/workflows.ts
import { Router as Router9 } from "express";
var activeProfilesSql = "SELECT * FROM account_profiles WHERE COALESCE(is_disabled,0)=0";
var workflowVersionSql = "SELECT version FROM workflows WHERE company_id=? AND form_type=?";
var saveWorkflowSql = "INSERT INTO workflows VALUES (?,?,?,?) ON CONFLICT(company_id,form_type) DO UPDATE SET version=excluded.version,config=excluded.config";
function validateWorkflow(db2, value) {
  return validateWorkflowWithUsers(value, db2.prepare(activeProfilesSql).all().map(safeProfile));
}
function validateWorkflowWithUsers(value, users) {
  fields(value, ["signerSelection", "allowFinalBypass", "processingUserIds", "processorTasks", "id", "companyId", "formType", "version", "stages", "preventSelfApproval", "allowDirectorOverride", "reminderDays", "escalationDays", "rejectionBehavior", "returnBehavior", "allowCashReceiptWaiver"]);
  text(value.id, 150);
  if (!["PEW", "ICCL", "FSG"].includes(value.companyId) || !SUBMITTABLE_FORMS.includes(value.formType) || value.returnBehavior !== "restart_workflow" || !["archive", "notify_requester"].includes(value.rejectionBehavior)) throw new RequestError(400, "Unsupported workflow.");
  const directory = value.signerSelection === "company-directory";
  if (value.formType === "R&D Initiative" && !directory) throw new RequestError(400, "R&D uses company-directory signing routes.");
  if (directory && value.formType === "Admin Work Request") throw new RequestError(400, "Use the current forms for directory routes.");
  if (value.signerSelection !== void 0 && !directory) throw new RequestError(400, "Invalid signer selection.");
  if (value.allowFinalBypass !== void 0 && typeof value.allowFinalBypass !== "boolean") throw new RequestError(400, "Invalid completion policy.");
  const companyId = value.companyId;
  for (const key of ["preventSelfApproval", "allowDirectorOverride"]) if (typeof value[key] !== "boolean") throw new RequestError(400, "Invalid policy.");
  if (value.allowCashReceiptWaiver !== void 0 && (value.formType !== "Cash Voucher" || typeof value.allowCashReceiptWaiver !== "boolean")) {
    throw new RequestError(400, "Receipt waiver policy applies only to Cash Voucher.");
  }
  for (const key of ["reminderDays", "escalationDays"]) if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 365) throw new RequestError(400, "Invalid interval.");
  if (!Array.isArray(value.stages) || !value.stages.length || value.stages.length > 20) throw new RequestError(400, "Invalid stages.");
  if (!directory && value.formType === "Administrative & Payment Request" && value.stages.length > 2) throw new RequestError(400, "Use up to two approval steps: Department Head and Final Approver.");
  if (!directory && value.formType === "IT Request" && value.stages.length !== 1) throw new RequestError(400, "IT Request requires one approval authority.");
  if (!directory && value.formType === "Cash Voucher" && value.stages.length !== 1) throw new RequestError(400, "Cash Voucher requires one payout approver.");
  if (!directory && value.formType === "Expense Claim" && value.stages.length > 2) throw new RequestError(400, "Use up to two claim approval steps.");
  if (value.processingUserIds !== void 0 && (!Array.isArray(value.processingUserIds) || value.processingUserIds.length > 100 || value.processingUserIds.some((id) => typeof id !== "string" || !users.some((user) => user.id === id && canJoinCompanyProcessingTeam(value.formType, user, companyId))))) throw new RequestError(400, "Invalid processing team.");
  if (value.processorTasks !== void 0) {
    const labels = processorTaskLabels(value.formType);
    if (!Array.isArray(value.processorTasks) || value.processorTasks.length > Object.keys(labels).length) throw new RequestError(400, "Invalid processor tasks.");
    const taskIds = /* @__PURE__ */ new Set();
    for (const task of value.processorTasks) {
      fields(task, ["id", "suggestedUserIds"]);
      if (typeof task.id !== "string" || !Object.hasOwn(labels, task.id) || taskIds.has(task.id) || !Array.isArray(task.suggestedUserIds) || !task.suggestedUserIds.length || task.suggestedUserIds.length > 20 || new Set(task.suggestedUserIds).size !== task.suggestedUserIds.length || task.suggestedUserIds.some((id) => !users.some((user) => user.id === id && canAppearAsProcessor(user, companyId, value.formType, task.id)))) {
        throw new RequestError(400, "Choose eligible suggested processors for each task.", "PROCESSOR_SETUP");
      }
      taskIds.add(task.id);
    }
  }
  const ids = /* @__PURE__ */ new Set();
  const stages = value.stages.map((stage, index) => {
    fields(stage, ["id", "stageNumber", "name", "assignedRole", "assignedUserId", "isFinalApproval", "canReject", "canReturnForCorrection", "mapsToDocumentSignature", "backupSignerIds", "backupCompletionUserIds", "eligibleSignerIds", "documentSlot", "requiredOnSubmit", "mustSign"]);
    text(stage.id, 150);
    text(stage.name, 150);
    if (ids.has(stage.id) || stage.stageNumber !== index + 1) throw new RequestError(400, "Invalid stage order.");
    ids.add(stage.id);
    for (const key of ["isFinalApproval", "canReject", "canReturnForCorrection", "mapsToDocumentSignature"]) if (typeof stage[key] !== "boolean") throw new RequestError(400, "Invalid stage flag.");
    const final = index === value.stages.length - 1;
    if (stage.documentSlot !== void 0 && (!directory || stage.documentSlot !== "department-head" || final || !["Administrative & Payment Request", "Expense Claim"].includes(value.formType) || value.stages.some((other, i) => i < index && other.documentSlot === stage.documentSlot))) {
      throw new RequestError(400, "Invalid printed signature mapping.");
    }
    if (stage.isFinalApproval !== final || stage.mapsToDocumentSignature !== final) throw new RequestError(400, "Only final stage maps to paper signature.");
    const eligible = users.filter((user) => canAppearAsSigner(user, companyId, value.formType, stage.id) && (stage.assignedUserId ? user.id === stage.assignedUserId : user.role === stage.assignedRole));
    const noSuggestion = directory && !stage.assignedUserId && !stage.assignedRole;
    if (!noSuggestion && (eligible.length !== 1 || stage.assignedRole && eligible[0].role !== stage.assignedRole)) throw new RequestError(400, "Missing, ambiguous or mismatched approver.");
    const backups = stage.backupSignerIds ?? [];
    const eligibleSigners = stage.eligibleSignerIds ?? [];
    if (!Array.isArray(eligibleSigners) || eligibleSigners.length > 20 || new Set(eligibleSigners).size !== eligibleSigners.length || !Array.isArray(backups) || eligibleSigners.some((id) => backups.includes(id) || !users.some((user) => user.id === id && canAppearAsSigner(user, companyId, value.formType, stage.id)))) {
      throw new RequestError(400, "Choose eligible signers separately from backups.");
    }
    for (const key of ["requiredOnSubmit", "mustSign"]) if (stage[key] !== void 0 && typeof stage[key] !== "boolean") throw new RequestError(400, "Invalid signature policy.");
    const completion = stage.backupCompletionUserIds ?? [];
    if (!Array.isArray(backups) || backups.length > 20 || new Set(backups).size !== backups.length || backups.some((id) => id === eligible[0]?.id || !users.some((user) => user.id === id && canAppearAsSigner(user, companyId, value.formType, stage.id)))) {
      throw new RequestError(400, "Choose eligible backup signers other than the primary signer.");
    }
    if (!Array.isArray(completion) || new Set(completion).size !== completion.length || !final && completion.length || completion.some((id) => !backups.includes(id))) {
      throw new RequestError(400, "Early completion permission applies only to backups on the final step.");
    }
    return { ...stage, assignedUserId: noSuggestion ? void 0 : eligible[0].id, assignedRole: noSuggestion ? void 0 : eligible[0].role, ...directory ? { requiredOnSubmit: final, mustSign: false } : {} };
  });
  return { ...value, stages };
}
function saveWorkflowConfig(db2, config, expectedVersion) {
  return transaction(db2, () => {
    const validated = validateWorkflow(db2, config);
    const old = db2.prepare(workflowVersionSql).get(validated.companyId, validated.formType);
    if (expectedVersion !== void 0 && Number(old?.version ?? 0) !== expectedVersion) throw new RequestError(409, "Workflow changed. Reload before saving.", "WORKFLOW_CONFLICT");
    const saved = { ...validated, version: Number(old?.version ?? 0) + 1 };
    db2.prepare(saveWorkflowSql).run(saved.companyId, saved.formType, saved.version, JSON.stringify(saved));
    return saved;
  });
}
function workflowRoutes(db2) {
  const router = Router9();
  router.put("/workflows/:companyId/:formType", async (req, res, next) => {
    try {
      const actor = "prepare" in db2 ? res.locals.requireCurrentUser() : res.locals.user;
      if (!canConfigureSigningRoutes(actor)) throw new RequestError(403, "Workflow administrator required.");
      fields(req.body, ["expectedVersion", "workflow"]);
      const { expectedVersion, workflow } = req.body;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || workflow?.companyId !== req.params.companyId || workflow?.formType !== req.params.formType) throw new RequestError(400, "Invalid workflow intent.");
      if (!canUserAccessCompany(actor, workflow.companyId) || !canConfigureSigningRoutes(actor, workflow.companyId)) throw new RequestError(403, "Company access denied.");
      const saved = "prepare" in db2 ? saveWorkflowConfig(db2, workflow, expectedVersion) : await db2.transaction(async (tx) => {
        const current = await res.locals.requireCurrentUserAsync(tx);
        if (!canConfigureSigningRoutes(current, workflow.companyId) || !canUserAccessCompany(current, workflow.companyId)) throw new RequestError(403, "Workflow administrator required.");
        const validated = validateWorkflowWithUsers(workflow, (await tx.execute(activeProfilesSql)).rows.map(safeProfile));
        const old = (await tx.execute(workflowVersionSql, [validated.companyId, validated.formType])).rows[0];
        if (Number(old?.version ?? 0) !== expectedVersion) throw new RequestError(409, "Workflow changed. Reload before saving.", "WORKFLOW_CONFLICT");
        const updated = { ...validated, version: expectedVersion + 1 };
        await tx.execute(saveWorkflowSql, [updated.companyId, updated.formType, updated.version, JSON.stringify(updated)]);
        return updated;
      });
      res.json(saved);
    } catch (error) {
      next(error);
    }
  });
  return router;
}

// backend/src/app.ts
var requestErrorMessages = {
  400: "Invalid request data or missing workflow.",
  401: "Authentication required.",
  403: "Action not permitted.",
  404: "Request or action not found.",
  409: "Request changed. Refresh and review again.",
  413: "Request is too large.",
  415: "Unsupported request encoding.",
  503: "Storage is temporarily unavailable. Try again shortly."
};
async function createApp(db2, config, attachmentStorage) {
  const origin2 = new URL(config.origin).origin;
  const transport = config.emailTransport ?? (process.env.NODE_ENV === "test" || process.env.PRECISIGN_EMAIL_MODE === "mock" ? new MockEmailTransport() : new ResendEmailTransport());
  if (config.secureCookies && !origin2.startsWith("https://")) throw new Error("Secure mode requires an HTTPS origin.");
  const app2 = express3();
  if (config.trustProxy !== void 0) {
    app2.set("trust proxy", config.trustProxy);
  }
  app2.disable("x-powered-by");
  app2.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (config.secureCookies) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  const now = config.now ?? Date.now;
  const attempts = /* @__PURE__ */ new Map();
  const dummyHash = await hashPassword("non-account-placeholder-password");
  const cookie = (value, maxAge) => `precisign_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`;
  const token = (raw) => {
    const matches = raw?.split(";").map((item) => item.trim()).filter((item) => item.startsWith("precisign_session=")) ?? [];
    return matches.length === 1 ? matches[0].slice("precisign_session=".length) : void 0;
  };
  const isAllowedOrigin = (reqOrigin) => {
    if (!reqOrigin) return false;
    if (reqOrigin === origin2) return true;
    if (!config.secureCookies) {
      try {
        const parsedReq = new URL(reqOrigin);
        const parsedConfig = new URL(origin2);
        const isLoopbackReq = parsedReq.hostname === "localhost" || parsedReq.hostname === "127.0.0.1" || parsedReq.hostname === "[::1]";
        const isLoopbackConfig = parsedConfig.hostname === "localhost" || parsedConfig.hostname === "127.0.0.1" || parsedConfig.hostname === "[::1]";
        if (isLoopbackReq && isLoopbackConfig && parsedReq.port === parsedConfig.port && parsedReq.protocol === parsedConfig.protocol) {
          return true;
        }
      } catch {
      }
    }
    return false;
  };
  app2.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app2.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && (!isAllowedOrigin(req.get("Origin")) || req.get("Sec-Fetch-Site") === "cross-site")) {
      res.status(403).json({ error: "Cross-origin request rejected." });
      return;
    }
    next();
  });
  const limitAuthAttempts = (login) => (req, res, next) => {
    const time = now();
    for (const [key2, entry2] of attempts) if (entry2.until <= time) attempts.delete(key2);
    const key = `${req.path}:${req.ip || "unknown"}`;
    const entry = attempts.get(key) ?? { count: 0, until: time + 15 * 60 * 1e3 };
    if (!attempts.has(key) && attempts.size >= 1e4 || entry.count >= (config.loginLimit ?? 30)) {
      const minutes = Math.max(1, Math.ceil((entry.until - time) / 6e4));
      res.setHeader("Retry-After", String(minutes * 60));
      res.status(429).json({ error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` });
      return;
    }
    entry.count++;
    attempts.set(key, entry);
    if (login) {
      res.on("finish", () => {
        if (res.statusCode === 200 && attempts.get(key) === entry) entry.count = Math.max(0, entry.count - 1);
      });
    }
    next();
  };
  app2.post("/api/auth/signup", (_req, res) => {
    res.status(403).json({ error: "Account creation is managed by your administrator." });
  });
  app2.post("/api/auth/login", express3.json({ limit: "16kb" }), limitAuthAttempts(true), async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || email.length > 254 || typeof password !== "string" || password.length > 1024) {
        res.status(401).json({ error: "Invalid email or password." });
        return;
      }
      const session = await ("prepare" in db2 ? signIn(db2, email, password, dummyHash, token(req.get("Cookie")), now) : signInAsync(db2, email, password, dummyHash, token(req.get("Cookie")), now));
      if (!session) {
        res.status(401).json({ error: "Invalid email or password." });
        return;
      }
      res.setHeader("Set-Cookie", cookie(session.token, sessionLifetime / 1e3));
      res.json({ user: session.user });
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/auth/forgot-password", limitAuthAttempts(false), express3.json({ limit: "16kb" }), async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    res.status(202).json({ message: "If this email belongs to an active super admin, check your inbox for a reset link." });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    if (transport instanceof ResendEmailTransport && transport.getMode() !== "live") return;
    const resetToken = randomBytes3(32).toString("hex");
    const hash = tokenHash(resetToken);
    const issuedAt = now();
    const insert = `INSERT INTO password_resets (user_id, token_hash, expires_at)
      SELECT id, ?, ? FROM account_profiles
      WHERE lower(email)=? AND is_super_admin=1 AND coalesce(is_disabled,0)=0
      ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at
      WHERE password_resets.expires_at <= ?`;
    const args = [hash, issuedAt + 30 * 60 * 1e3, email, issuedAt];
    try {
      const changes = "prepare" in db2 ? db2.prepare(insert).run(...args).changes : (await db2.execute(insert, [...args])).rowsAffected;
      if (!changes) return;
      const link = `${origin2}/#reset=${resetToken}`;
      const result = await transport.send({
        to: email,
        subject: "Reset your PreciSign password",
        html: `<p><a href="${link}">Reset your PreciSign password</a> within 30 minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
        text: `To reset your PreciSign password, open this link within 30 minutes: ${link}

If you did not request this, you can ignore this email.`,
        idempotencyKey: `password-reset-${hash}`
      });
      if (!result.accepted && !result.uncertain) {
        const remove = "DELETE FROM password_resets WHERE token_hash=?";
        if ("prepare" in db2) db2.prepare(remove).run(hash);
        else await db2.execute(remove, [hash]);
      }
    } catch {
      console.error("Password reset delivery could not be completed.");
    }
  });
  app2.post("/api/auth/reset-password", limitAuthAttempts(false), express3.json({ limit: "16kb" }), async (req, res, next) => {
    try {
      fields(req.body, ["token", "newPassword"]);
      if ("prepare" in db2) await resetPassword(db2, text(req.body.token, 64, false), text(req.body.newPassword, 1024, false), now);
      else await resetPasswordAsync(db2, text(req.body.token, 64, false), text(req.body.newPassword, 1024, false), now);
      res.setHeader("Set-Cookie", cookie("", 0));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  app2.use("/api", async (req, res, next) => {
    try {
      const sessionToken = token(req.get("Cookie"));
      const user = "prepare" in db2 ? sessionUser(db2, sessionToken, now()) : await sessionUserAsync(db2, sessionToken, now());
      if (!user) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      if (req.get("X-PreciSign-User") && req.get("X-PreciSign-User") !== user.id) {
        res.status(401).json({ error: "Session identity changed." });
        return;
      }
      if (user.mustChangePassword && !(req.method === "GET" && req.path === "/auth/me" || req.method === "POST" && ["/auth/logout", "/auth/change-password"].includes(req.path))) {
        res.status(403).json({ error: "Change your password to continue." });
        return;
      }
      res.locals.user = user;
      if ("prepare" in db2) res.locals.requireCurrentUser = () => {
        const current = sessionUser(db2, sessionToken, now());
        if (!current || current.id !== user.id) throw new RequestError(401, "Authentication required.");
        return current;
      };
      else res.locals.requireCurrentUserAsync = async (tx) => {
        const current = await sessionUserAsync(tx, sessionToken, now());
        if (!current || current.id !== user.id) throw new RequestError(401, "Authentication required.");
        return current;
      };
      next();
    } catch (error) {
      next(error);
    }
  });
  app2.use("/api", express3.json({ limit: "18mb" }));
  app2.get("/api/auth/me", async (_req, res, next) => {
    try {
      const signature = "prepare" in db2 ? ownSignature(db2, res.locals.user.id) : await ownSignatureAsync(db2, res.locals.user.id);
      res.json({ user: { ...res.locals.user, ...signature }, sessionExpiresAt: await sessionExpiry(db2, token(_req.get("Cookie"))) });
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/auth/change-password", async (req, res, next) => {
    try {
      fields(req.body, ["currentPassword", "newPassword"]);
      const currentPassword = text(req.body.currentPassword, 1024, false);
      const newPassword = text(req.body.newPassword, 1024, false);
      if ("prepare" in db2) await changePassword(db2, res.locals.user.id, currentPassword, newPassword, res.locals.requireCurrentUser);
      else await changePasswordAsync(db2, res.locals.user.id, currentPassword, newPassword, res.locals.requireCurrentUserAsync);
      res.setHeader("Set-Cookie", cookie("", 0));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/auth/logout", async (req, res, next) => {
    try {
      if ("prepare" in db2) revokeSession(db2, token(req.get("Cookie")));
      else await db2.execute("DELETE FROM sessions WHERE token_hash=?", [tokenHash(token(req.get("Cookie")))]);
      res.setHeader("Set-Cookie", cookie("", 0));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  app2.use("/api", readRoutes(db2, origin2, (req) => token(req.get("Cookie")), attachmentStorage));
  app2.use("/api", profileRoutes(db2));
  app2.use("/api", accountAdminRoutes(db2, origin2, now));
  app2.use("/api", accessRoleRoutes(db2));
  app2.use("/api", workflowRoutes(db2));
  app2.use("/api", draftRoutes(db2));
  app2.use("/api", companyBrandingRoutes(db2));
  const outboxProcessor = config.outboxProcessor ?? new OutboxProcessor(db2, transport, { now });
  app2.outboxProcessor = outboxProcessor;
  if (config.autoStartWorker) {
    outboxProcessor.start();
  }
  app2.use("/api", requestRoutes(db2, outboxProcessor, now, attachmentStorage));
  app2.use((_req, res) => {
    res.status(404).json({ error: "Not found." });
  });
  app2.use((error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (isDatabaseBusy(error)) {
      res.setHeader("Retry-After", "1");
      res.status(503).json({ error: "Storage is temporarily busy. Try again shortly." });
      return;
    }
    const status = typeof error.status === "number" ? error.status : 500;
    if (status >= 500) {
      captureBackendError(error, { route: _req.path, status, code: error.code });
    }
    const message = requestErrorMessages[status];
    const processorError = error.status === 400 || error.status === 409;
    const expose = processorError && ["PROCESSOR_SETUP", "PROCESSOR_SELECTION", "PROCESSOR_REASSIGNMENT"].includes(error.code ?? "") || error.status === 400 && error.code === "PASSWORD_POLICY";
    const payload = { error: (expose ? error.message : message) ?? "Could not complete request." };
    if (typeof error.code === "string") {
      payload.code = error.code;
    }
    res.status(message ? status : 500).json(payload);
  });
  return app2;
}

// backend/src/index.ts
import express4 from "express";
import { existsSync as existsSync2 } from "node:fs";
dotenv.config();
initBackendSentry();
var production = process.env.NODE_ENV === "production";
var port = Number(process.env.PORT || process.env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid API_PORT.");
var origin = process.env.APP_ORIGIN || "http://127.0.0.1:3000";
if (production && !origin.startsWith("https://")) throw new Error("Set APP_ORIGIN to the HTTPS application origin.");
var databaseMode = process.env.PRECISIGN_DATABASE || "sqlite";
if (!["sqlite", "turso"].includes(databaseMode)) throw new Error("Invalid PRECISIGN_DATABASE.");
var db;
if (databaseMode === "turso") {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken || !url.startsWith("libsql://")) throw new Error("Turso requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  console.log(`Connecting to Turso database: ${url}`);
  db = openAsyncDatabase(url, authToken);
  try {
    await migrateAsyncDatabase(db);
  } catch (error) {
    db.close();
    throw error;
  }
  console.log(`Connected to Turso database: ${url}`);
} else {
  const path = resolve(process.env.DATABASE_PATH || process.env.PRECISIGN_DATABASE_PATH || "data/precisign.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  db = openDatabase(path);
}
var loginLimit = process.env.LOGIN_LIMIT ? Number(process.env.LOGIN_LIMIT) : production ? 10 : 100;
var trustProxyEnv = process.env.TRUST_PROXY || process.env.PRECISIGN_TRUST_PROXY;
var trustProxy = void 0;
if (trustProxyEnv !== void 0) {
  if (trustProxyEnv === "true") trustProxy = true;
  else if (trustProxyEnv === "false") trustProxy = false;
  else if (/^\d+$/.test(trustProxyEnv)) trustProxy = Number(trustProxyEnv);
  else trustProxy = trustProxyEnv;
}
var posthogLogs = initializePostHogLogger();
posthogLogs.emit("api_starting", { database_mode: databaseMode, deployment_environment: production ? "production" : "development" });
var app = await createApp(db, { origin, secureCookies: production, loginLimit, autoStartWorker: true, trustProxy }, createAttachmentStorage());
var shutdown = (server) => () => {
  posthogLogs.emit("api_stopping");
  app.outboxProcessor?.stop();
  server.close(async () => {
    db.close();
    await posthogLogs.shutdown();
    process.exit(0);
  });
};
if (production) {
  if (process.env.VITE_DATA_MODE !== "api") throw new Error("Production requires VITE_DATA_MODE=api at build and start.");
  const host = process.env.BIND_HOST || "0.0.0.0";
  const standaloneApi = process.env.STANDALONE_API === "true";
  const dist = resolve("dist");
  if (standaloneApi) {
    const server = app.listen(port, host, () => console.log(`PreciSign Standalone API listening on http://${host}:${port}`));
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown(server));
  } else {
    if (!existsSync2(resolve(dist, "index.html"))) throw new Error("Build the frontend first.");
    const site = express4();
    site.use("/api", (req, res, next) => {
      req.url = "/api" + req.url;
      app(req, res, next);
    });
    site.use(express4.static(dist));
    site.get("*", (_req, res) => res.sendFile(resolve(dist, "index.html")));
    const server = site.listen(port, host, () => console.log(`PreciSign listening on http://${host}:${port}`));
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown(server));
  }
} else {
  const server = app.listen(port, "127.0.0.1", () => console.log(`PreciSign API listening on http://127.0.0.1:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown(server));
}
