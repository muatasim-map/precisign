import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db';
import { hashPassword, provisionUser, signIn, signInAsync, createSession, sessionUser, sessionUserAsync } from './auth';
import { openAsyncDatabase, migrateAsyncDatabase } from './asyncDatabase';
import { approveRequestStage, completePreciRoute } from '../../shared/utils/workflowEngine';
import { canUserAccessCompany } from '../../shared/utils/companyAccess';
import type { RequestRecord, UserProfile } from '../../shared/types/index';

test('strict password verification: exact stored password succeeds; trailing/leading space variations fail', async () => {
  const db = openDatabase(':memory:');
  const dummyHash = await hashPassword('dummy-placeholder-pass');
  const exactPassword = 'Correct-Password-2026!';
  const spacePassword = 'Password-With-Space ';

  try {
    const user1Id = await provisionUser(db, {
      email: 'exact.user@test.com',
      name: 'Exact User',
      role: 'Admin',
      department: 'QA',
      companyId: 'PEW',
    }, exactPassword);
    db.prepare("INSERT INTO account_access (user_id, company_grants, must_change_password) VALUES (?, '[\"PEW\"]', 0)").run(user1Id);

    const user2Id = await provisionUser(db, {
      email: 'space.user@test.com',
      name: 'Space User',
      role: 'Admin',
      department: 'QA',
      companyId: 'PEW',
    }, spacePassword);
    db.prepare("INSERT INTO account_access (user_id, company_grants, must_change_password) VALUES (?, '[\"PEW\"]', 0)").run(user2Id);

    // 1. Synchronous path - exact user
    assert.ok(await signIn(db, 'exact.user@test.com', exactPassword, dummyHash, undefined, () => Date.now()), 'Exact password succeeds');
    assert.equal(await signIn(db, 'exact.user@test.com', exactPassword + ' ', dummyHash, undefined, () => Date.now()), null, 'Added trailing space fails');
    assert.equal(await signIn(db, 'exact.user@test.com', ' ' + exactPassword, dummyHash, undefined, () => Date.now()), null, 'Added leading space fails');
    assert.equal(await signIn(db, 'exact.user@test.com', exactPassword.toLowerCase(), dummyHash, undefined, () => Date.now()), null, 'Different casing fails');

    // 2. Synchronous path - user with password ending in space
    assert.ok(await signIn(db, 'space.user@test.com', spacePassword, dummyHash, undefined, () => Date.now()), 'Exact password with space succeeds');
    assert.equal(await signIn(db, 'space.user@test.com', spacePassword.trimEnd(), dummyHash, undefined, () => Date.now()), null, 'Password with trimmed trailing space fails');
  } finally {
    db.close();
  }
});

test('asynchronous strict password verification: exact stored password succeeds; variations fail', async () => {
  const db = openAsyncDatabase('file::memory:');
  const dummyHash = await hashPassword('dummy-placeholder-pass');
  const exactPassword = 'Async-Exact-Password-789';

  try {
    await migrateAsyncDatabase(db);
    const hash = await hashPassword(exactPassword);
    await db.execute("INSERT INTO users (id,email,name,role,department,company_id,password_hash) VALUES ('async-u1','async1@test.com','Async One','Admin','QA','PEW',?)", [hash]);
    await db.execute("INSERT INTO account_access (user_id, company_grants, must_change_password) VALUES ('async-u1', '[\"PEW\"]', 0)");

    // 1. Exact succeeds
    assert.ok(await signInAsync(db, 'async1@test.com', exactPassword, dummyHash, undefined, () => Date.now()), 'Exact async succeeds');
    // 2. Added trailing space fails
    assert.equal(await signInAsync(db, 'async1@test.com', exactPassword + ' ', dummyHash, undefined, () => Date.now()), null, 'Added trailing space fails async');
    // 3. Added leading space fails
    assert.equal(await signInAsync(db, 'async1@test.com', ' ' + exactPassword, dummyHash, undefined, () => Date.now()), null, 'Added leading space fails async');
  } finally {
    db.close();
  }
});

test('disabling synthetic account: revokes existing sessions, blocks subsequent sign-in, and clears access', async () => {
  const db = openDatabase(':memory:');
  const dummyHash = await hashPassword('dummy-placeholder-pass');
  const password = 'Active-User-Password-456!';

  try {
    const userId = await provisionUser(db, {
      email: 'disable.test@test.com',
      name: 'Disable Test',
      role: 'Admin',
      department: 'Operations',
      companyId: 'PEW',
    }, password);
    db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants, is_disabled) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"IT Request\"]}', 0)").run(userId);

    // Create active session
    const sessionToken = createSession(db, userId);
    assert.ok(sessionUser(db, sessionToken), 'Active user session is valid');

    // Sign in succeeds while enabled
    assert.ok(await signIn(db, 'disable.test@test.com', password, dummyHash, undefined, () => Date.now()), 'Sign in succeeds when enabled');

    // Disable the user and revoke sessions
    db.prepare("UPDATE account_access SET is_disabled = 1, company_grants = '[]', form_grants = '{}' WHERE user_id = ?").run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

    // 1. Existing session is immediately invalidated
    assert.equal(sessionUser(db, sessionToken), null, 'Existing session token fails after user is disabled');

    // 2. Subsequent sign-in with correct credentials fails
    assert.equal(await signIn(db, 'disable.test@test.com', password, dummyHash, undefined, () => Date.now()), null, 'Sign in returns null for disabled user');

    // 3. User cannot access companies
    const updatedRow = db.prepare('SELECT company_grants FROM account_access WHERE user_id = ?').get(userId) as any;
    assert.equal(updatedRow.company_grants, '[]', 'Company grants are cleared');
  } finally {
    db.close();
  }
});

test('account administration alone does not grant signing authority on active requests', () => {
  const superAdminUser: UserProfile = {
    id: 'super-admin-id',
    name: 'Muatasim Admin',
    email: 'muatasim@test.com',
    role: 'Admin',
    department: 'Executive',
    initials: 'MA',
    avatarColor: '#123456',
    companyId: 'PEW',
    allowedCompanyIds: ['PEW', 'ICCL', 'FSG'],
    companyGrants: ['PEW', 'ICCL', 'FSG'],
    isSuperAdmin: true,
    isGroupAdmin: true,
  };

  const assignedApprover: UserProfile = {
    id: 'assigned-approver-id',
    name: 'Afzal Kazi',
    email: 'afzal@test.com',
    role: 'Director',
    department: 'Executive',
    initials: 'AK',
    avatarColor: '#654321',
    companyId: 'PEW',
    allowedCompanyIds: ['PEW'],
    companyGrants: ['PEW'],
  };

  const sampleRequest: RequestRecord = {
    id: 'PEW-REQ-2026-0001',
    companyId: 'PEW',
    formType: 'Administrative & Payment Request',
    title: 'Sample Payment Request',
    department: 'Admin',
    workflowVersion: 1,
    attachments: [],
    requesterId: 'requester-id',
    requesterName: 'Anzar Requester',
    requesterRole: 'Admin',
    status: 'Pending Approval',
    currentStageIndex: 0,
    currentApproverId: 'assigned-approver-id',
    currentApproverName: 'Afzal Kazi',
    documentVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvalSteps: [
      {
        stageId: 'stage-1',
        stageNumber: 1,
        stageName: 'Approver Signature',
        assignedUserId: 'assigned-approver-id',
        assignedUserName: 'Afzal Kazi',
        assignedRole: 'Director',
        status: 'Pending',
      },
    ],
    workflowConfig: {
      id: 'wf-1',
      companyId: 'PEW',
      formType: 'Administrative & Payment Request',
      version: 1,
      stages: [
        {
          id: 'stage-1',
          stageNumber: 1,
          name: 'Approver Signature',
          assignedRole: 'Director',
          assignedUserId: 'assigned-approver-id',
          isFinalApproval: true,
          canReject: true,
          canReturnForCorrection: true,
          mapsToDocumentSignature: true,
        },
      ],
      preventSelfApproval: true,
      allowDirectorOverride: false,
      reminderDays: 2,
      escalationDays: 5,
      rejectionBehavior: 'archive',
      returnBehavior: 'restart_workflow',
    },
    approvalHistory: [],
    versionSnapshots: [],
    formData: {
      dateOfRequest: '2026-03-01',
      companyId: 'PEW',
      companyName: 'Precision Engineering Works',
      requesterId: 'requester-id',
      requesterName: 'Anzar Requester',
      department: 'Admin',
      priority: 'Medium',
      workDescription: 'Sample Request',
      documents: {
        onlineDocumentChamber: false,
        physicalDocumentChamber: false,
        companyDocumentAjeer: false,
        employeeSalaryCertificate: false,
        permanentEmploymentVisa: false,
        workVisitVisa: false,
        businessVisitVisa: false,
        agencyWakala: false,
        others: false,
        othersDescription: '',
      },
    },
  };

  // 1. SuperAdmin (unassigned) CANNOT approve the stage
  const adminApprovalResult = approveRequestStage({
    request: sampleRequest,
    actingUser: superAdminUser,
    comment: 'Admin attempting approval',
  });
  assert.equal(adminApprovalResult.success, false, 'SuperAdmin without assignment cannot approve stage');
  assert.match(adminApprovalResult.error || '', /Unauthorized: This stage is assigned to/i);

  // 2. Assigned approver CAN approve the stage
  const validApprovalResult = approveRequestStage({
    request: sampleRequest,
    actingUser: assignedApprover,
    comment: 'Legitimate approval',
    signatureDataUrl: 'data:image/png;base64,validsig',
  });
  assert.equal(validApprovalResult.success, true, 'Assigned approver can approve stage');

  // 3. SuperAdmin (unassigned) CANNOT execute final completion
  const adminCompletionResult = completePreciRoute({
    request: sampleRequest,
    actingUser: superAdminUser,
    reason: 'Admin bypass reason',
    signatureDataUrl: 'data:image/png;base64,signature',
  });
  assert.equal(adminCompletionResult.success, false, 'SuperAdmin without assignment cannot complete route');
});
