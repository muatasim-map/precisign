import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openDatabase } from './db';
import { openAsyncDatabase, migrateAsyncDatabase } from './asyncDatabase';
import { createApp } from './app';
import { provisionUser, createSession, hashPassword, sessionUser } from './auth';
import { MockEmailTransport, OutboxProcessor } from './email';
import { INITIAL_WORKFLOWS, INITIAL_REQUESTS } from '../../shared/data/seedData';
import { ApiPreciSignRepository } from '../../frontend/src/services/apiRepository';

test('AREA 1: Authentication and Sessions - Admin-only signup, first-sign-in policy, session revocation, and permission separation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'precisign-area1-'));
  const dbPath = join(dir, 'test.sqlite');
  const db = openDatabase(dbPath);

  try {
    // 1. Provision super admin
    const adminId = await provisionUser(db, {
      email: 'admin@company.test',
      name: 'Super Admin',
      department: 'IT',
      companyId: 'PEW',
      allowedCompanyIds: ['PEW', 'ICCL', 'FSG'],
      role: 'Admin',
    }, 'AdminPassword123!');
    db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants, is_super_admin, is_disabled, must_change_password) VALUES (?, '[\"PEW\",\"ICCL\",\"FSG\"]', '{}', 1, 0, 0)").run(adminId);

    // 2. Setup Express app
    const emailTransport = new MockEmailTransport();
    const app = await createApp(db, {
      origin: 'http://localhost:3000',
      secureCookies: false,
      emailTransport,
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}/api`;

    const adminCookie = `precisign_session=${createSession(db, adminId)}`;

    // A. Public signup route is strictly 403
    const publicSignupRes = await fetch(`${base}/auth/signup`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacker', email: 'hacker@test.com', password: 'Password123!' }),
    });
    assert.equal(publicSignupRes.status, 403, 'Public signup is forbidden');
    const publicSignupData = await publicSignupRes.json();
    assert.equal(publicSignupData.error, 'Account creation is managed by your administrator.');

    // B. Super admin creates an employee account -> mustChangePassword is required
    const tempPassword = 'TempEmployeePass123!';
    const createRes = await fetch(`${base}/admin/accounts`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Synthetic Requester',
        email: 'requester@company.test',
        department: 'Operations',
        password: tempPassword,
        role: 'Employee',
      }),
    });
    assert.equal(createRes.status, 201, 'Admin can create account');
    const createdEmployee = await createRes.json();

    // Verify database record has must_change_password = 1
    const accessRow = db.prepare('SELECT must_change_password FROM account_access WHERE user_id=?').get(createdEmployee.id) as any;
    assert.equal(accessRow.must_change_password, 1, 'must_change_password is initialized to 1');

    // C. First sign-in enforcement: user can log in, but cannot access normal app routes until password is changed
    const loginRes = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'requester@company.test', password: tempPassword }),
    });
    assert.equal(loginRes.status, 200, 'Login succeeds');
    const setCookie = loginRes.headers.get('set-cookie')!;
    assert.ok(setCookie.includes('precisign_session='), 'Session cookie issued');
    const empCookieMatch = setCookie.match(/precisign_session=([a-f0-9]+)/);
    const initialSessionToken = empCookieMatch![1];
    const empCookie = `precisign_session=${initialSessionToken}`;

    // Verify /api/auth/me is allowed
    const meRes = await fetch(`${base}/auth/me`, {
      headers: { Origin: 'http://localhost:3000', Cookie: empCookie },
    });
    assert.equal(meRes.status, 200, '/auth/me allowed');
    const meData = await meRes.json();
    assert.equal(meData.user.mustChangePassword, true);

    // Verify protected app routes (/bootstrap, /requests) are blocked with 403
    const bootstrapBlocked = await fetch(`${base}/bootstrap`, {
      headers: { Origin: 'http://localhost:3000', Cookie: empCookie },
    });
    assert.equal(bootstrapBlocked.status, 403, 'Bootstrap blocked when mustChangePassword is true');
    const bootstrapData = await bootstrapBlocked.json();
    assert.equal(bootstrapData.error, 'Change your password to continue.');

    const requestsBlocked = await fetch(`${base}/requests`, {
      headers: { Origin: 'http://localhost:3000', Cookie: empCookie },
    });
    assert.equal(requestsBlocked.status, 403, 'Requests blocked when mustChangePassword is true');

    // D. User changes password -> clears mustChangePassword, revokes ALL sessions, clears cookie
    const newPassword = 'NewSecretPassword2026!';
    const changePassRes = await fetch(`${base}/auth/change-password`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Cookie: empCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: tempPassword, newPassword }),
    });
    assert.equal(changePassRes.status, 204, 'Password change succeeds');
    const changePassCookie = changePassRes.headers.get('set-cookie')!;
    assert.ok(changePassCookie.includes('Max-Age=0'), 'Session cookie cleared on password change');

    // Verify that the initial session token is now completely invalid in database
    const sessionInDb = sessionUser(db, initialSessionToken);
    assert.equal(sessionInDb, null, 'Old session token revoked in database');

    // Using the old session token returns 401
    const oldSessionAttempt = await fetch(`${base}/auth/me`, {
      headers: { Origin: 'http://localhost:3000', Cookie: empCookie },
    });
    assert.equal(oldSessionAttempt.status, 401, 'Old session token rejected after password change');

    // E. Sign in with new password -> normal access granted
    const loginAfterRes = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'requester@company.test', password: newPassword }),
    });
    assert.equal(loginAfterRes.status, 200, 'Sign in with new password succeeds');
    const newCookie = `precisign_session=${loginAfterRes.headers.get('set-cookie')!.match(/precisign_session=([a-f0-9]+)/)![1]}`;

    // Give user company grants
    await fetch(`${base}/admin/accounts/${createdEmployee.id}/grants`, {
      method: 'PUT',
      headers: { Origin: 'http://localhost:3000', Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyIds: ['PEW'],
        formsByCompany: { PEW: ['IT Request'] },
      }),
    });

    const bootstrapAllowed = await fetch(`${base}/bootstrap`, {
      headers: { Origin: 'http://localhost:3000', Cookie: newCookie },
    });
    assert.equal(bootstrapAllowed.status, 200, 'Bootstrap now allowed');

    // F. Account disabling: Admin disables employee account -> revokes sessions and blocks sign-in
    const disableRes = await fetch(`${base}/admin/accounts/${createdEmployee.id}`, {
      method: 'PATCH',
      headers: { Origin: 'http://localhost:3000', Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDisabled: true }),
    });
    assert.equal(disableRes.status, 204, 'Admin disables account');

    // Active session immediately rejected with 401
    const disabledSessionAttempt = await fetch(`${base}/auth/me`, {
      headers: { Origin: 'http://localhost:3000', Cookie: newCookie },
    });
    assert.equal(disabledSessionAttempt.status, 401, 'Disabled user session rejected');

    // Sign-in fails for disabled account
    const disabledLogin = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'requester@company.test', password: newPassword }),
    });
    assert.equal(disabledLogin.status, 401, 'Disabled user cannot sign in');

    // G. Separate enforcement of company access, permission to start form, request visibility, and signing authority
    // Re-enable account and assign PEW-only access
    await fetch(`${base}/admin/accounts/${createdEmployee.id}`, {
      method: 'PATCH',
      headers: { Origin: 'http://localhost:3000', Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDisabled: false }),
    });
    await fetch(`${base}/admin/accounts/${createdEmployee.id}/grants`, {
      method: 'PUT',
      headers: { Origin: 'http://localhost:3000', Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyIds: ['PEW'],
        formsByCompany: { PEW: ['IT Request'] },
      }),
    });

    const empLogin2 = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'requester@company.test', password: newPassword }),
    });
    const activeEmpCookie = `precisign_session=${empLogin2.headers.get('set-cookie')!.match(/precisign_session=([a-f0-9]+)/)![1]}`;

    // 1. Employee tries to start form in ICCL (unauthorized company) -> 403
    const crossCompanyStart = await fetch(`${base}/requests`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Cookie: activeEmpCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'ICCL',
        formType: 'IT Request',
        formData: { dateOfRequest: '2026-11-16', department: 'IT', priority: 'Medium', workDescription: 'Cross company attempt', documents: {} },
        signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=',
      }),
    });
    assert.equal(crossCompanyStart.status, 403, 'Employee cannot submit form for company they lack grants for');

    // 2. Employee tries to start Cash Voucher in PEW (unauthorized form) -> 403
    const ungrantedFormStart = await fetch(`${base}/requests`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Cookie: activeEmpCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'PEW',
        formType: 'Cash Voucher',
        formData: { dateOfRequest: '2026-11-16', department: 'IT', priority: 'Medium', workDescription: 'Cash voucher attempt', documents: {} },
        signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=',
      }),
    });
    assert.equal(ungrantedFormStart.status, 403, 'Employee cannot submit form they lack grants for');

    // 3. Employee cannot access admin account directory -> 403
    const adminDirectoryAccess = await fetch(`${base}/admin/accounts`, {
      headers: { Origin: 'http://localhost:3000', Cookie: activeEmpCookie },
    });
    assert.equal(adminDirectoryAccess.status, 403, 'Non-admin employee cannot access account admin directory');

    // H. Verify ApiPreciSignRepository clears actorId on logout
    let capturedHeaders: Record<string, string> = {};
    const mockTransport = async (url: string, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const repo = new ApiPreciSignRepository(mockTransport);
    (repo as any).actorId = 'user-123';
    await repo.logout();
    assert.equal((repo as any).actorId, undefined, 'repo.actorId is cleared after logout');

    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AREA 2: Transactions and Concurrency - Conflicting actions, revision check, and atomic rollback without partial writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'precisign-area2-'));
  const dbPath = join(dir, 'test.sqlite');
  const db = openDatabase(dbPath);

  try {
    // 1. Provision Requester, Approver 1, Approver 2
    const mark = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=';
    const requesterId = await provisionUser(db, { email: 'requester@test.com', name: 'Requester', department: 'IT', companyId: 'PEW', role: 'Admin' }, 'Password123!');
    const approver1Id = await provisionUser(db, { email: 'approver1@test.com', name: 'Approver One', department: 'IT', companyId: 'PEW', role: 'General Manager' }, 'Password123!');
    const approver2Id = await provisionUser(db, { email: 'approver2@test.com', name: 'Approver Two', department: 'Executive', companyId: 'PEW', role: 'Director' }, 'Password123!');

    for (const uid of [requesterId, approver1Id, approver2Id]) {
      db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants, must_change_password) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"Admin Work Request\"]}', 0)").run(uid);
    }

    const workflow = {
      ...INITIAL_WORKFLOWS[0],
      stages: [
        { ...INITIAL_WORKFLOWS[0].stages[0], assignedUserId: approver1Id, assignedUserName: 'Approver One', isFinalApproval: false, canReturnForCorrection: true },
        { ...INITIAL_WORKFLOWS[0].stages[1], assignedUserId: approver2Id, assignedUserName: 'Approver Two', isFinalApproval: true, canReturnForCorrection: true },
      ],
    };
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'Admin Work Request', 1, JSON.stringify(workflow));

    const reqCookie = `precisign_session=${createSession(db, requesterId)}`;
    const app1Cookie = `precisign_session=${createSession(db, approver1Id)}`;
    const app2Cookie = `precisign_session=${createSession(db, approver2Id)}`;

    const emailTransport = new MockEmailTransport();
    const app = await createApp(db, { origin: 'http://localhost:3000', secureCookies: false, emailTransport });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}/api`;
    const f = INITIAL_REQUESTS[0].formData;

    // 2. Submit initial request (Revision 1)
    const submitRes = await fetch(`${base}/requests`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Cookie: reqCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'PEW',
        formType: 'Admin Work Request',
        formData: { dateOfRequest: '2026-11-16', department: 'IT', priority: 'Medium', workDescription: 'Test concurrency', documents: f.documents },
        signatureDataUrl: mark,
      }),
    });
    assert.equal(submitRes.status, 201, 'Request created');
    const createdReq = await submitRes.json();
    const requestId = createdReq.id;
    assert.equal(createdReq.revision, 1);

    // Initial email notifications recorded in outbox
    const initialOutboxCount = (db.prepare('SELECT count(*) AS c FROM email_outbox WHERE request_id=?').get(requestId) as any).c;
    assert.ok(initialOutboxCount >= 1, 'Initial notification outbox queued');

    // 3. Concurrency simulation: Two actions against expectedRevision: 1
    // Action A: Approver 1 approves (expectedRevision: 1)
    // Action B: Approver 1 also submits return (expectedRevision: 1) or Director override
    const promiseA = fetch(`${base}/requests/${requestId}/approve`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Cookie: app1Cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, comment: 'Approval commit A', signatureDataUrl: mark }),
    });

    const promiseB = fetch(`${base}/requests/${requestId}/return`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Cookie: app1Cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, reason: 'Return conflicting with A' }),
    });

    const [resA, resB] = await Promise.all([promiseA, promiseB]);
    const statuses = [resA.status, resB.status].sort();

    // Exactly one commits (200), the other receives 409
    assert.deepEqual(statuses, [200, 409], 'Exactly one action commits (200) and conflicting action receives 409');

    const conflictRes = resA.status === 409 ? resA : resB;
    const conflictData = await conflictRes.json();
    assert.equal(conflictData.error, 'Request changed. Refresh and review again.');

    // 4. Verify database state: revision is exactly 2, single transition recorded
    const row = db.prepare('SELECT revision, record FROM requests WHERE id=?').get(requestId) as any;
    assert.equal(row.revision, 2, 'Revision incremented exactly once');
    const record = JSON.parse(row.record);
    assert.equal(record.revision, 2);

    // Verify outbox has exactly the notification for the committed action, none for the rejected action
    const committedAction = resA.status === 200 ? 'approve' : 'return';
    const expectedOutboxCount = committedAction === 'approve' ? initialOutboxCount + 1 : initialOutboxCount;
    const currentOutboxCount = (db.prepare('SELECT count(*) AS c FROM email_outbox WHERE request_id=?').get(requestId) as any).c;
    assert.equal(currentOutboxCount, expectedOutboxCount, 'Outbox matches committed action without duplicate or partial records');

    // 5. Verify atomic rollback on database failure (trigger injection on a fresh request)
    const req2Res = await fetch(`${base}/requests`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Cookie: reqCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'PEW',
        formType: 'Admin Work Request',
        formData: { dateOfRequest: '2026-11-16', department: 'IT', priority: 'Medium', workDescription: 'Test rollback', documents: f.documents },
        signatureDataUrl: mark,
      }),
    });
    assert.equal(req2Res.status, 201);
    const req2 = await req2Res.json();
    const req2InitialOutbox = (db.prepare('SELECT count(*) AS c FROM email_outbox WHERE request_id=?').get(req2.id) as any).c;

    db.exec("CREATE TRIGGER synthetic_fail_update BEFORE UPDATE ON requests BEGIN SELECT RAISE(ABORT, 'synthetic crash'); END");

    // Approver 1 submits a completely valid approval against req2
    const failedActionRes = await fetch(`${base}/requests/${req2.id}/approve`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Cookie: app1Cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, comment: 'Valid approval that hits DB trigger', signatureDataUrl: mark }),
    });
    const failedText = await failedActionRes.text();
    if (failedActionRes.status !== 500) console.error('failedActionRes:', failedActionRes.status, failedText);
    assert.equal(failedActionRes.status, 500, `Expected 500 on database write crash, got ${failedActionRes.status}: ${failedText}`);

    // Verify no partial status change, revision increment, or email outbox enqueue was committed
    const afterCrashRow = db.prepare('SELECT revision, record FROM requests WHERE id=?').get(req2.id) as any;
    assert.equal(afterCrashRow.revision, 1, 'Revision unchanged after transaction rollback');
    const afterCrashRecord = JSON.parse(afterCrashRow.record);
    assert.equal(afterCrashRecord.approvalSteps[0].status, 'Pending', 'Stage status remained Pending');
    assert.equal(afterCrashRecord.approvalSteps[0].signatureDataUrl, undefined, 'No partial signature written');

    const afterCrashOutboxCount = (db.prepare('SELECT count(*) AS c FROM email_outbox WHERE request_id=?').get(req2.id) as any).c;
    assert.equal(afterCrashOutboxCount, req2InitialOutbox, 'No outbox rows enqueued during rolled-back transaction');

    db.exec('DROP TRIGGER synthetic_fail_update');

    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AREA 2 (Async adapter): LibSQL/AsyncDatabase transactions roll back atomically on failure', async () => {
  const db = openAsyncDatabase('file::memory:');
  try {
    await migrateAsyncDatabase(db);
    const mark = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=';

    // Insert user & request directly
    const passHash = await hashPassword('TestPass123!');
    await db.execute("INSERT INTO users (id,email,name,role,department,company_id,password_hash) VALUES ('u1','u1@test.com','User 1','Admin','IT','PEW',?)", [passHash]);
    await db.execute("INSERT INTO account_access (user_id, company_grants, must_change_password) VALUES ('u1','[\"PEW\"]',0)");

    const dummyRequest = {
      id: 'PEW-ASYNC-001',
      companyId: 'PEW',
      formType: 'IT Request',
      status: 'Pending Approval',
      revision: 1,
      documentVersion: 1,
      requesterId: 'u1',
      approvalSteps: [],
      approvalHistory: [],
    };
    await db.execute('INSERT INTO requests VALUES (?,?,?,?,?,?)', [
      dummyRequest.id, dummyRequest.companyId, dummyRequest.requesterId, dummyRequest.status, 1, JSON.stringify(dummyRequest),
    ]);

    // Demonstrate atomic transaction rollback on async connection
    let threw = false;
    try {
      await db.transaction(async tx => {
        await tx.execute("UPDATE requests SET revision=2, status='Approved' WHERE id='PEW-ASYNC-001'");
        throw new Error('Simulated failure inside transaction');
      });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'Transaction threw expected error');

    // Confirm DB state was rolled back
    const checkRow = (await db.execute("SELECT revision, status FROM requests WHERE id='PEW-ASYNC-001'")).rows[0] as any;
    assert.equal(checkRow.revision, 1, 'Async revision rolled back to 1');
    assert.equal(checkRow.status, 'Pending Approval', 'Async status rolled back to Pending Approval');
  } finally {
    db.close();
  }
});

test('AREA 3: Environment Configuration - Trust proxy, rate limiting, and origin validation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'precisign-area3-'));
  const dbPath = join(dir, 'test.sqlite');
  const db = openDatabase(dbPath);

  try {
    const adminId = await provisionUser(db, {
      email: 'env.test@company.test',
      name: 'Env Tester',
      department: 'IT',
      companyId: 'PEW',
      role: 'Admin',
    }, 'Password123!');
    db.prepare("INSERT INTO account_access (user_id, company_grants, must_change_password) VALUES (?, '[\"PEW\"]', 0)").run(adminId);

    // 1. App configured with trustProxy: 1 and loginLimit: 3
    const app = await createApp(db, {
      origin: 'https://precisign.example.com',
      secureCookies: true,
      loginLimit: 3,
      trustProxy: 1,
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}/api`;

    // A. Health check succeeds
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);

    // B. Rate limit with proxy: individual client IPs in X-Forwarded-For are respected
    // Client IP 203.0.113.195 makes 3 bad attempts -> hits 429
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: {
          Origin: 'https://precisign.example.com',
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.195',
        },
        body: JSON.stringify({ email: 'env.test@company.test', password: 'WrongPassword' }),
      });
      assert.equal(res.status, 401, `Attempt ${i + 1} fails with 401`);
    }
    const rateLimitedRes = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: {
        Origin: 'https://precisign.example.com',
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.195',
      },
      body: JSON.stringify({ email: 'env.test@company.test', password: 'WrongPassword' }),
    });
    assert.equal(rateLimitedRes.status, 429, 'Client 203.0.113.195 is rate limited');

    // Another client IP (198.51.100.42) through the same proxy is NOT blocked!
    const otherClientRes = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: {
        Origin: 'https://precisign.example.com',
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.42',
      },
      body: JSON.stringify({ email: 'env.test@company.test', password: 'Password123!' }),
    });
    assert.equal(otherClientRes.status, 200, 'Other client IP is not blocked by proxy IP clustering');

    // C. Origin checks:
    // Cross-origin request rejected
    const crossOriginRes = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil-site.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'env.test@company.test', password: 'Password123!' }),
    });
    assert.equal(crossOriginRes.status, 403, 'Cross-origin request rejected');

    // Sec-Fetch-Site: cross-site rejected
    const crossSiteRes = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: {
        Origin: 'https://precisign.example.com',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'env.test@company.test', password: 'Password123!' }),
    });
    assert.equal(crossSiteRes.status, 403, 'Sec-Fetch-Site cross-site rejected');

    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
