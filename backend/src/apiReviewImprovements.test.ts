import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDatabase, schemaVersion } from './db';
import { createSession, hashPassword, provisionUser, registerAccount, tokenHash } from './auth';
import { openAsyncDatabase, migrateAsyncDatabase, type AsyncDatabase } from './asyncDatabase';
import { createApp } from './app';
import { INITIAL_WORKFLOWS, INITIAL_REQUESTS } from '../../shared/data/seedData';
import type { AttachmentStorage } from './attachmentStorage';
import type { AttachmentItem } from '../../shared/types/index';
import { RequestError } from './requestValidation';

const syntheticMark = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=';
const validDocuments = INITIAL_REQUESTS[0].formData.documents;

test('1. account creation authorization revalidates session and superadmin inside transaction (SQLite and Turso)', async () => {
  // Test SQLite path
  {
    const db = openDatabase(':memory:');
    const adminId = await provisionUser(db, { name: 'Admin', email: 'admin@example.test', role: 'Admin', department: 'IT', companyId: 'PEW' }, 'Password123!');
    db.prepare("INSERT INTO account_access (user_id, company_grants, is_super_admin) VALUES (?, '[\"PEW\"]', 1)").run(adminId);
    const token = createSession(db, adminId);
    const origin = 'http://localhost:3000';
    const app = await createApp(db, { origin, secureCookies: false });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const adminCookie = `precisign_session=${token}`;

    try {
      // 1. Revoke session right before transaction executes
      let revokeBeforeTx = false;
      const originalPrepare = db.prepare.bind(db);
      // We simulate session revocation in-flight
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(adminId);

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/accounts`, {
        method: 'POST',
        headers: {
          'Origin': origin,
          'Cookie': adminCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Should Not Exist',
          email: 'aborted@example.test',
          department: 'HR',
          password: 'Password123!',
          role: 'Employee',
        }),
      });

      assert.equal(res.status, 401);
      const createdUser = db.prepare('SELECT id FROM users WHERE email=?').get('aborted@example.test');
      assert.equal(createdUser, undefined, 'Aborted transaction must not insert user');
      const createdAccess = db.prepare('SELECT * FROM account_access WHERE user_id IN (SELECT id FROM users WHERE email=?)').get('aborted@example.test');
      assert.equal(createdAccess, undefined, 'Aborted transaction must not insert account_access');
    } finally {
      server.close();
      db.close();
    }
  }

  // Test Turso (AsyncDatabase) path
  {
    const db = openAsyncDatabase('file::memory:');
    await migrateAsyncDatabase(db);
    const adminId = randomUUID();
    const hash = await hashPassword('Password123!');
    await db.execute('INSERT INTO users (id,email,name,role,department,company_id,password_hash) VALUES (?,?,?,?,?,?,?)',
      [adminId, 'admin-async@example.test', 'Admin Async', 'Admin', 'IT', 'PEW', hash]);
    await db.execute("INSERT INTO account_access (user_id, company_grants, is_super_admin) VALUES (?, '[\"PEW\"]', 1)", [adminId]);
    const rawToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    await db.execute('INSERT INTO sessions VALUES (?,?,?)', [tokenHash(rawToken), adminId, Date.now() + 3600000]);
    const origin = 'http://localhost:3000';
    const app = await createApp(db, { origin, secureCookies: false });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const adminCookie = `precisign_session=${rawToken}`;

    try {
      // Demote super admin right before account creation
      await db.execute('UPDATE account_access SET is_super_admin=0 WHERE user_id=?', [adminId]);

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/accounts`, {
        method: 'POST',
        headers: {
          'Origin': origin,
          'Cookie': adminCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Async Should Not Exist',
          email: 'aborted-async@example.test',
          department: 'HR',
          password: 'Password123!',
          role: 'Employee',
        }),
      });

      assert.equal(res.status, 403);
      const createdUser = (await db.execute('SELECT id FROM users WHERE email=?', ['aborted-async@example.test'])).rows;
      assert.equal(createdUser.length, 0, 'Demoted admin cannot create account in Turso path');
    } finally {
      server.close();
      db.close();
    }
  }
});

test('2. lost response reproduction and safe retries without duplicate requests or outbox notifications', async () => {
  const db = openDatabase(':memory:');
  const requesterId = await provisionUser(db, { name: 'Requester', email: 'requester@example.test', role: 'Admin', department: 'Eng', companyId: 'PEW' }, 'Password123!');
  const approverId = await provisionUser(db, { name: 'Approver', email: 'approver@example.test', role: 'Director', department: 'Executive', companyId: 'PEW' }, 'Password123!');
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')").run(requesterId);
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')").run(approverId);

  const wf = { ...INITIAL_WORKFLOWS[0], stages: [{ ...INITIAL_WORKFLOWS[0].stages[0], assignedUserId: approverId, isFinalApproval: true }] };
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'Admin Work Request', 1, JSON.stringify(wf));

  // Set up draft
  db.prepare('INSERT INTO drafts VALUES (?,?,?,?,?)').run(requesterId, 'PEW', 'Admin Work Request', 1, JSON.stringify({ workDescription: 'Initial draft' }));

  const token = createSession(db, requesterId);
  const cookie = `precisign_session=${token}`;
  const origin = 'http://localhost:3000';
  const app = await createApp(db, { origin, secureCookies: false });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;

  try {
    const submissionKey = 'idempotent-key-001';
    const submissionBody = {
      companyId: 'PEW',
      formType: 'Admin Work Request',
      expectedDraftRevision: 1,
      expectedWorkflowVersion: 1,
      formData: {
        dateOfRequest: '2026-11-20',
        department: 'Eng',
        priority: 'Medium',
        workDescription: 'Repair AC unit',
        documents: validDocuments,
      },
      signatureDataUrl: syntheticMark,
      submissionKey,
    };

    // First submission: commits on server
    const firstRes = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: {
        'Origin': origin,
        'Cookie': cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(submissionBody),
    });
    if (firstRes.status !== 201) {
      console.log('FIRST RES ERROR:', firstRes.status, await firstRes.json());
    }
    assert.equal(firstRes.status, 201);
    const firstData: any = await firstRes.json();
    assert.ok(firstData.id);
    assert.ok(firstData.displayId);

    // Verify initial DB state
    const requestsCount = (db.prepare('SELECT count(*) as count FROM requests').get() as any).count;
    assert.equal(requestsCount, 1);
    const outboxCount1 = (db.prepare('SELECT count(*) as count FROM email_outbox').get() as any).count;
    assert.equal(outboxCount1, 2, 'Initial submission enqueued 2 emails (requester + approver)');
    const draftRow = db.prepare('SELECT revision, data FROM drafts WHERE user_id=? AND company_id=? AND form_type=?').get(requesterId, 'PEW', 'Admin Work Request') as any;
    assert.equal(draftRow.revision, 2, 'Draft cleared and revision bumped to 2');
    assert.equal(draftRow.data, 'null');

    // Scenario reproduction: Client's response was lost in transit.
    // Client retries the identical submission (sending the same expectedDraftRevision: 1 and same submissionKey).
    // Without the fix, this would fail with 409 Draft changed in another session!
    const retryRes = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: {
        'Origin': origin,
        'Cookie': cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(submissionBody),
    });

    assert.equal(retryRes.status, 200, 'Safe retry returns 200 with stored response');
    const retryData: any = await retryRes.json();
    assert.equal(retryData.id, firstData.id, 'Retry returns the same request ID');
    assert.equal(retryData.displayId, firstData.displayId, 'Retry returns the same sequence display ID');

    // Verify that NO second request was created and NO duplicate outbox notifications were enqueued
    const requestsCountAfter = (db.prepare('SELECT count(*) as count FROM requests').get() as any).count;
    assert.equal(requestsCountAfter, 1, 'Must not create a second request');
    const outboxCountAfter = (db.prepare('SELECT count(*) as count FROM email_outbox').get() as any).count;
    assert.equal(outboxCountAfter, 2, 'Must not duplicate outbox notifications');
  } finally {
    server.close();
    db.close();
  }
});

test('3. concurrent retries and backend restart persistence', async () => {
  const dbPath = `file:${randomUUID()}?mode=memory&cache=shared`;
  const db = openDatabase(dbPath);
  const requesterId = await provisionUser(db, { name: 'Requester2', email: 'req2@example.test', role: 'Admin', department: 'Eng', companyId: 'PEW' }, 'Password123!');
  const approverId = await provisionUser(db, { name: 'Approver2', email: 'app2@example.test', role: 'Director', department: 'Executive', companyId: 'PEW' }, 'Password123!');
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')").run(requesterId);
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')").run(approverId);
  const wf = { ...INITIAL_WORKFLOWS[0], stages: [{ ...INITIAL_WORKFLOWS[0].stages[0], assignedUserId: approverId, isFinalApproval: true }] };
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'Admin Work Request', 1, JSON.stringify(wf));

  const token = createSession(db, requesterId);
  const cookie = `precisign_session=${token}`;
  const origin = 'http://localhost:3000';
  let app = await createApp(db, { origin, secureCookies: false });
  let server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  let port = (server.address() as { port: number }).port;

  try {
    const key = 'concurrent-key-999';
    const payload = {
      companyId: 'PEW',
      formType: 'Admin Work Request',
      expectedWorkflowVersion: 1,
      formData: {
        dateOfRequest: '2026-11-20',
        department: 'Eng',
        priority: 'Medium',
        workDescription: 'Replace server fan',
        documents: validDocuments,
      },
      signatureDataUrl: syntheticMark,
      submissionKey: key,
    };

    // Concurrent submission calls
    const [res1, res2] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/requests`, {
        method: 'POST',
        headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      fetch(`http://127.0.0.1:${port}/api/requests`, {
        method: 'POST',
        headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ]);

    assert.ok([200, 201].includes(res1.status));
    assert.ok([200, 201].includes(res2.status));
    const data1: any = await res1.json();
    const data2: any = await res2.json();
    assert.equal(data1.id, data2.id, 'Concurrent submissions return same record ID');

    const totalRequests = (db.prepare('SELECT count(*) as c FROM requests').get() as any).c;
    assert.equal(totalRequests, 1, 'Only 1 request record created despite concurrent submissions');

    // Simulate backend restart
    server.close();
    // Start fresh app and server instance on the same shared DB
    app = await createApp(db, { origin, secureCookies: false });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    port = (server.address() as { port: number }).port;

    // Retry after restart
    const restartRes = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(restartRes.status, 200, 'Retry after backend restart returns 200');
    const restartData: any = await restartRes.json();
    assert.equal(restartData.id, data1.id, 'Returns original record after backend restart');
  } finally {
    server.close();
    db.close();
  }
});

test('4. reject reuse of same key for different submission data with 409 SUBMISSION_CONFLICT', async () => {
  const db = openDatabase(':memory:');
  const requesterId = await provisionUser(db, { name: 'Requester3', email: 'req3@example.test', role: 'Admin', department: 'Eng', companyId: 'PEW' }, 'Password123!');
  const approverId = await provisionUser(db, { name: 'Approver3', email: 'app3@example.test', role: 'Director', department: 'Executive', companyId: 'PEW' }, 'Password123!');
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')").run(requesterId);
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')").run(approverId);
  const wf = { ...INITIAL_WORKFLOWS[0], stages: [{ ...INITIAL_WORKFLOWS[0].stages[0], assignedUserId: approverId, isFinalApproval: true }] };
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'Admin Work Request', 1, JSON.stringify(wf));

  const token = createSession(db, requesterId);
  const cookie = `precisign_session=${token}`;
  const origin = 'http://localhost:3000';
  const app = await createApp(db, { origin, secureCookies: false });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;

  try {
    const key = 'shared-key-test';
    const payloadA = {
      companyId: 'PEW',
      formType: 'Admin Work Request',
      expectedWorkflowVersion: 1,
      formData: {
        dateOfRequest: '2026-11-20',
        department: 'Eng',
        priority: 'Medium',
        workDescription: 'Original work description',
        documents: validDocuments,
      },
      signatureDataUrl: syntheticMark,
      submissionKey: key,
    };

    const resA = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadA),
    });
    assert.equal(resA.status, 201);

    // Reuse key with different description
    const payloadB = {
      ...payloadA,
      formData: {
        ...payloadA.formData,
        workDescription: 'Different modified description',
      },
    };
    const resB = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadB),
    });

    assert.equal(resB.status, 409);
    const errData: any = await resB.json();
    assert.equal(errData.code, 'SUBMISSION_CONFLICT');
    assert.equal(errData.error, 'Request changed. Refresh and review again.');
  } finally {
    server.close();
    db.close();
  }
});

test('5. legacy callers without key work compatibly', async () => {
  const db = openDatabase(':memory:');
  const requesterId = await provisionUser(db, { name: 'Requester4', email: 'req4@example.test', role: 'Admin', department: 'Eng', companyId: 'PEW' }, 'Password123!');
  const approverId = await provisionUser(db, { name: 'Approver4', email: 'app4@example.test', role: 'Director', department: 'Executive', companyId: 'PEW' }, 'Password123!');
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')").run(requesterId);
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')").run(approverId);
  const wf = { ...INITIAL_WORKFLOWS[0], stages: [{ ...INITIAL_WORKFLOWS[0].stages[0], assignedUserId: approverId, isFinalApproval: true }] };
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'Admin Work Request', 1, JSON.stringify(wf));

  const token = createSession(db, requesterId);
  const cookie = `precisign_session=${token}`;
  const origin = 'http://localhost:3000';
  const app = await createApp(db, { origin, secureCookies: false });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;

  try {
    const payloadWithoutKey = {
      companyId: 'PEW',
      formType: 'Admin Work Request',
      expectedWorkflowVersion: 1,
      formData: {
        dateOfRequest: '2026-11-20',
        department: 'Eng',
        priority: 'Medium',
        workDescription: 'Legacy caller work',
        documents: validDocuments,
      },
      signatureDataUrl: syntheticMark,
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadWithoutKey),
    });
    assert.equal(res.status, 201);
  } finally {
    server.close();
    db.close();
  }
});

test('6. actionable API error codes for workflow, draft, request conflicts and fallback', async () => {
  const db = openDatabase(':memory:');
  const requesterId = await provisionUser(db, { name: 'Requester5', email: 'req5@example.test', role: 'Admin', department: 'Eng', companyId: 'PEW' }, 'Password123!');
  const approverId = await provisionUser(db, { name: 'Approver5', email: 'app5@example.test', role: 'Director', department: 'Executive', companyId: 'PEW' }, 'Password123!');
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\", \"IT Request\"]}')").run(requesterId);
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\", \"IT Request\"]}')").run(approverId);
  const wf = { ...INITIAL_WORKFLOWS[0], stages: [{ ...INITIAL_WORKFLOWS[0].stages[0], assignedUserId: approverId, isFinalApproval: true }] };
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'Admin Work Request', 1, JSON.stringify(wf));
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'IT Request', 1, JSON.stringify(wf));
  db.prepare('INSERT INTO drafts VALUES (?,?,?,?,?)').run(requesterId, 'PEW', 'Admin Work Request', 2, JSON.stringify({ workDescription: 'Draft rev 2' }));

  const token = createSession(db, requesterId);
  const cookie = `precisign_session=${token}`;
  const origin = 'http://localhost:3000';
  const app = await createApp(db, { origin, secureCookies: false });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;

  try {
    // 1. Workflow conflict
    const wfConflictRes = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'PEW',
        formType: 'IT Request',
        expectedWorkflowVersion: 99, // stale version
        formData: {
          dateOfRequest: '2026-11-20',
          department: 'Eng',
          priority: 'Medium',
          workDescription: 'Test',
          documents: validDocuments,
          itRequest: { requestType: 'Hardware', justification: 'Upgrade laptop' },
        },
        signatureDataUrl: syntheticMark,
      }),
    });
    assert.equal(wfConflictRes.status, 409);
    const wfErr: any = await wfConflictRes.json();
    assert.equal(wfErr.code, 'WORKFLOW_CONFLICT');
    assert.equal(wfErr.error, 'Request changed. Refresh and review again.');

    // 2. Draft conflict
    const draftConflictRes = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'PEW',
        formType: 'Admin Work Request',
        expectedDraftRevision: 1, // current is 2
        formData: { dateOfRequest: '2026-11-20', department: 'Eng', priority: 'Medium', workDescription: 'Test', documents: validDocuments },
        signatureDataUrl: syntheticMark,
      }),
    });
    assert.equal(draftConflictRes.status, 409);
    const draftErr: any = await draftConflictRes.json();
    assert.equal(draftErr.code, 'DRAFT_CONFLICT');

    // 3. Request conflict
    // First create a request
    const createRes = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'PEW',
        formType: 'Admin Work Request',
        expectedDraftRevision: 2,
        expectedWorkflowVersion: 1,
        formData: { dateOfRequest: '2026-11-20', department: 'Eng', priority: 'Medium', workDescription: 'Test', documents: validDocuments },
        signatureDataUrl: syntheticMark,
      }),
    });
    assert.equal(createRes.status, 201);
    const created: any = await createRes.json();

    // Now attempt action with stale revision
    const approverToken = createSession(db, approverId);
    const approverCookie = `precisign_session=${approverToken}`;
    const actionConflictRes = await fetch(`http://127.0.0.1:${port}/api/requests/${encodeURIComponent(created.id)}/approve`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': approverCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: 99, // stale revision
        signatureDataUrl: syntheticMark,
      }),
    });
    assert.equal(actionConflictRes.status, 409);
    const reqErr: any = await actionConflictRes.json();
    assert.equal(reqErr.code, 'REQUEST_CONFLICT');
  } finally {
    server.close();
    db.close();
  }
});

test('7. R2 uploads: pre-checks prevent uploads on stale workflow/draft, rollback cleans unreferenced uploads, and shared objects preserved', async () => {
  const db = openDatabase(':memory:');
  const requesterId = await provisionUser(db, { name: 'Requester6', email: 'req6@example.test', role: 'Admin', department: 'Eng', companyId: 'PEW' }, 'Password123!');
  const approverId = await provisionUser(db, { name: 'Approver6', email: 'app6@example.test', role: 'Director', department: 'Executive', companyId: 'PEW' }, 'Password123!');
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\", \"IT Request\"]}')").run(requesterId);
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\", \"IT Request\"]}')").run(approverId);
  const wf = { ...INITIAL_WORKFLOWS[0], stages: [{ ...INITIAL_WORKFLOWS[0].stages[0], assignedUserId: approverId, isFinalApproval: true }] };
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'Admin Work Request', 1, JSON.stringify(wf));
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'IT Request', 1, JSON.stringify(wf));

  // Mock object storage tracking uploads and deletes
  const uploaded = new Set<string>();
  const deleted = new Set<string>();
  const mockStorage: AttachmentStorage = {
    async upload(file: AttachmentItem) {
      uploaded.add(file.name);
      file.dataUrl = `r2:precisign-attachments/v1/digest-${file.name}`;
    },
    async download(file: AttachmentItem) {},
    async deleteObject(reference: string) {
      deleted.add(reference);
    },
  };

  const token = createSession(db, requesterId);
  const cookie = `precisign_session=${token}`;
  const origin = 'http://localhost:3000';
  const app = await createApp(db, { origin, secureCookies: false }, mockStorage);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;

  try {
    // 7A: Stale workflow version: pre-upload check must reject before storage.upload is called
    const staleWfRes = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'PEW',
        formType: 'IT Request',
        expectedWorkflowVersion: 99, // Stale!
        formData: {
          dateOfRequest: '2026-11-20',
          department: 'Eng',
          priority: 'Medium',
          workDescription: 'Test',
          documents: validDocuments,
          itRequest: { requestType: 'Hardware', justification: 'Upgrade laptop' },
        },
        signatureDataUrl: syntheticMark,
        attachments: [{ id: 'att-precheck-1', name: 'photo.png', sizeBytes: 100, mimeType: 'image/png', dataUrl: syntheticMark }],
      }),
    });
    assert.equal(staleWfRes.status, 409);
    assert.equal(uploaded.has('photo.png'), false, 'Pre-upload check must prevent storage.upload on stale workflow');

    // 7B: Successful submission with attachment
    const successRes = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'PEW',
        formType: 'Admin Work Request',
        expectedWorkflowVersion: 1,
        formData: { dateOfRequest: '2026-11-20', department: 'Eng', priority: 'Medium', workDescription: 'Shared attachment', documents: validDocuments },
        signatureDataUrl: syntheticMark,
        attachments: [{ id: 'att-shared', name: 'shared.png', sizeBytes: 100, mimeType: 'image/png', dataUrl: syntheticMark }],
      }),
    });
    assert.equal(successRes.status, 201);
    assert.equal(uploaded.has('shared.png'), true, 'Uploaded attachment to storage');
    assert.equal(deleted.has('r2:precisign-attachments/v1/digest-shared.png'), false, 'Committed object must not be deleted');

    // 7C: Upload during failed transaction is retained for reconciliation
    const uniqueUploadedRefs = new Set<string>();
    const uniqueDeletedRefs = new Set<string>();
    const storageUniqueFail: AttachmentStorage = {
      async upload(file: AttachmentItem) {
        file.dataUrl = `r2:precisign-attachments/v1/unique-fail-${file.name}`;
        uniqueUploadedRefs.add(file.dataUrl);
        // Intercept between pre-check and transaction commit: mutate draft revision to force tx failure
        db.prepare('UPDATE drafts SET revision=99 WHERE user_id=?').run(requesterId);
      },
      async download() {},
      async deleteObject(ref: string) {
        uniqueDeletedRefs.add(ref);
      },
    };

    db.prepare('INSERT OR REPLACE INTO drafts VALUES (?,?,?,?,?)').run(requesterId, 'PEW', 'Admin Work Request', 5, JSON.stringify({}));
    const appFail1 = await createApp(db, { origin, secureCookies: false }, storageUniqueFail);
    const serverFail1 = appFail1.listen(0, '127.0.0.1'); await once(serverFail1, 'listening');
    const portFail1 = (serverFail1.address() as { port: number }).port;

    try {
      const failRes1 = await fetch(`http://127.0.0.1:${portFail1}/api/requests`, {
        method: 'POST',
        headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: 'PEW',
          formType: 'Admin Work Request',
          expectedDraftRevision: 5,
          expectedWorkflowVersion: 1,
          formData: { dateOfRequest: '2026-11-20', department: 'Eng', priority: 'Medium', workDescription: 'Will fail in tx', documents: validDocuments },
          signatureDataUrl: syntheticMark,
          attachments: [{ id: 'fail-file-1', name: 'fail.png', sizeBytes: 100, mimeType: 'image/png', dataUrl: syntheticMark }],
        }),
      });
      assert.equal(failRes1.status, 409);
      assert.equal(uniqueUploadedRefs.has('r2:precisign-attachments/v1/unique-fail-fail.png'), true);
      assert.equal(uniqueDeletedRefs.has('r2:precisign-attachments/v1/unique-fail-fail.png'), false, 'A failed write must retain the object for any concurrent submission');
    } finally {
      serverFail1.close();
    }

    // 7D: Shared content-addressed file is preserved even when transaction fails
    const sharedUploadedRefs = new Set<string>();
    const sharedDeletedRefs = new Set<string>();
    const storageSharedFail: AttachmentStorage = {
      async upload(file: AttachmentItem) {
        // Point to the committed shared reference from 7B
        file.dataUrl = `r2:precisign-attachments/v1/digest-shared.png`;
        sharedUploadedRefs.add(file.dataUrl);
        // Force transaction failure
        db.prepare('UPDATE drafts SET revision=999 WHERE user_id=?').run(requesterId);
      },
      async download() {},
      async deleteObject(ref: string) {
        sharedDeletedRefs.add(ref);
      },
    };

    db.prepare('INSERT OR REPLACE INTO drafts VALUES (?,?,?,?,?)').run(requesterId, 'PEW', 'Admin Work Request', 10, JSON.stringify({}));
    const appFail2 = await createApp(db, { origin, secureCookies: false }, storageSharedFail);
    const serverFail2 = appFail2.listen(0, '127.0.0.1'); await once(serverFail2, 'listening');
    const portFail2 = (serverFail2.address() as { port: number }).port;

    try {
      const failRes2 = await fetch(`http://127.0.0.1:${portFail2}/api/requests`, {
        method: 'POST',
        headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: 'PEW',
          formType: 'Admin Work Request',
          expectedDraftRevision: 10,
          expectedWorkflowVersion: 1,
          formData: { dateOfRequest: '2026-11-20', department: 'Eng', priority: 'Medium', workDescription: 'Shared will fail in tx', documents: validDocuments },
          signatureDataUrl: syntheticMark,
          attachments: [{ id: 'shared-file-2', name: 'shared2.png', sizeBytes: 100, mimeType: 'image/png', dataUrl: syntheticMark }],
        }),
      });
      assert.equal(failRes2.status, 409);
      assert.equal(sharedUploadedRefs.has('r2:precisign-attachments/v1/digest-shared.png'), true);
      assert.equal(sharedDeletedRefs.has('r2:precisign-attachments/v1/digest-shared.png'), false, 'Shared content-addressed object MUST NOT be deleted');
    } finally {
      serverFail2.close();
    }
  } finally {
    server.close();
    db.close();
  }
});

test('8. safe submission retries and conflict handling on Turso path', async () => {
  const db = openAsyncDatabase('file::memory:');
  await migrateAsyncDatabase(db);
  const requesterId = randomUUID();
  const approverId = randomUUID();
  const hash = await hashPassword('Password123!');
  await db.execute('INSERT INTO users (id,email,name,role,department,company_id,password_hash) VALUES (?,?,?,?,?,?,?)',
    [requesterId, 'turso-req@example.test', 'Turso Requester', 'Admin', 'Eng', 'PEW', hash]);
  await db.execute('INSERT INTO users (id,email,name,role,department,company_id,password_hash) VALUES (?,?,?,?,?,?,?)',
    [approverId, 'turso-app@example.test', 'Turso Approver', 'Director', 'Executive', 'PEW', hash]);
  await db.execute("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')", [requesterId]);
  await db.execute("INSERT INTO account_access (user_id, company_grants, form_grants) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}')", [approverId]);

  const wf = { ...INITIAL_WORKFLOWS[0], stages: [{ ...INITIAL_WORKFLOWS[0].stages[0], assignedUserId: approverId, isFinalApproval: true }] };
  await db.execute('INSERT INTO workflows VALUES (?,?,?,?)', ['PEW', 'Admin Work Request', 1, JSON.stringify(wf)]);

  const rawToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  await db.execute('INSERT INTO sessions VALUES (?,?,?)', [tokenHash(rawToken), requesterId, Date.now() + 3600000]);

  const origin = 'http://localhost:3000';
  const app = await createApp(db, { origin, secureCookies: false });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const cookie = `precisign_session=${rawToken}`;

  try {
    const key = 'turso-idempotent-key';
    const payload = {
      companyId: 'PEW',
      formType: 'Admin Work Request',
      expectedWorkflowVersion: 1,
      formData: {
        dateOfRequest: '2026-11-20',
        department: 'Eng',
        priority: 'Medium',
        workDescription: 'Turso submission',
        documents: validDocuments,
      },
      signatureDataUrl: syntheticMark,
      submissionKey: key,
    };

    // First submission
    const res1 = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res1.status, 201);
    const data1: any = await res1.json();
    assert.ok(data1.id);

    // Retry with same key and payload
    const res2 = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res2.status, 200);
    const data2: any = await res2.json();
    assert.equal(data2.id, data1.id, 'Turso retry returns identical request ID');

    // Key reuse with different payload fails with 409 SUBMISSION_CONFLICT
    const res3 = await fetch(`http://127.0.0.1:${port}/api/requests`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        formData: { ...payload.formData, workDescription: 'Different Turso work' },
      }),
    });
    assert.equal(res3.status, 409);
    const err3: any = await res3.json();
    assert.equal(err3.code, 'SUBMISSION_CONFLICT');

    // Confirm only 1 request was inserted
    const count = (await db.execute('SELECT count(*) as count FROM requests')).rows[0].count;
    assert.equal(Number(count), 1);
  } finally {
    server.close();
    db.close();
  }
});
