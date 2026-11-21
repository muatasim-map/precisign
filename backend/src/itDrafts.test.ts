import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INITIAL_WORKFLOWS } from '../../shared/data/seedData';
import { openDatabase } from './db';
import { provisionUser, createSession } from './auth';
import { createApp } from './app';

test('IT Request drafts: CRUD, optimistic concurrency, user/company isolation, permissions, and atomic submit cleanup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'precisign-it-draft-'));
  const dbPath = join(directory, 'test.sqlite');
  let db = openDatabase(dbPath);

  // Provision synthetic users
  const user1 = await provisionUser(db, {
    email: 'it-requester@example.test',
    name: 'IT Requester',
    department: 'IT',
    role: 'IT',
    companyId: 'PEW',
  }, 'Synthetic-test-password-123');

  const user2 = await provisionUser(db, {
    email: 'other-user@example.test',
    name: 'Other User',
    department: 'Operations',
    role: 'Admin',
    companyId: 'PEW',
  }, 'Synthetic-test-password-123');

  const approver = await provisionUser(db, {
    email: 'it-approver@example.test',
    name: 'IT Approver',
    department: 'Management',
    role: 'General Manager',
    companyId: 'PEW',
  }, 'Synthetic-test-password-123');

  // Insert workflow for PEW IT Request
  const itWorkflow = {
    ...INITIAL_WORKFLOWS[0],
    companyId: 'PEW',
    formType: 'IT Request',
    version: 1,
    stages: [
      {
        id: 'step-1',
        name: 'Manager Approval',
        assignedUserId: approver,
        assignedRole: 'General Manager',
        order: 1,
        canEdit: false,
        mustSign: true,
        isFinalApproval: true,
      },
    ],
  };
  db.prepare('INSERT INTO workflows VALUES (?,?,?,?)').run('PEW', 'IT Request', 1, JSON.stringify(itWorkflow));

  const cookieUser1 = `precisign_session=${createSession(db, user1)}`;
  const cookieUser2 = `precisign_session=${createSession(db, user2)}`;

  const app = await createApp(db, { origin: 'http://localhost:3000', secureCookies: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  const call = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Origin: 'http://localhost:3000',
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const itDraftPath = '/drafts/PEW/' + encodeURIComponent('IT Request');
  const itPayload = {
    fields: {
      department: 'IT',
      requester: 'IT Requester',
      date: '2026-11-16',
      requestType: 'Hardware',
      priority: 'Urgent',
      details: 'Developer laptop replacement',
      justification: 'Current machine battery failure',
    },
    choices: { 'step-1': approver },
  };

  try {
    // 1. Initial read should be revision 0, null data
    const initial = await (await call('GET', itDraftPath, cookieUser1)).json();
    assert.deepEqual(initial, { revision: 0, data: null });

    // 2. Save draft revision 0 -> 1
    const saveRes1 = await call('PUT', itDraftPath, cookieUser1, {
      expectedRevision: 0,
      data: itPayload,
    });
    assert.equal(saveRes1.status, 200);
    const saved1 = await saveRes1.json();
    assert.equal(saved1.revision, 1);
    assert.equal(saved1.data.fields.details, 'Developer laptop replacement');
    assert.equal(saved1.data.choices['step-1'], approver);

    // 3. User isolation: user2 must see revision 0, null data
    const user2Read = await (await call('GET', itDraftPath, cookieUser2)).json();
    assert.deepEqual(user2Read, { revision: 0, data: null });

    // 4. Company isolation: user1 querying ICCL should be 403 (no access)
    const icclRes = await call('GET', '/drafts/ICCL/' + encodeURIComponent('IT Request'), cookieUser1);
    assert.equal(icclRes.status, 403);

    // 5. Stale revision save: saving with expectedRevision 0 should fail with 409
    const staleSave = await call('PUT', itDraftPath, cookieUser1, {
      expectedRevision: 0,
      data: { ...itPayload, fields: { ...itPayload.fields, details: 'Stale overwrite' } },
    });
    assert.equal(staleSave.status, 409);

    // 6. Valid update: saving with expectedRevision 1 -> revision 2
    const saveRes2 = await call('PUT', itDraftPath, cookieUser1, {
      expectedRevision: 1,
      data: { ...itPayload, fields: { ...itPayload.fields, details: 'Updated laptop spec: 32GB RAM' } },
    });
    assert.equal(saveRes2.status, 200);
    const saved2 = await saveRes2.json();
    assert.equal(saved2.revision, 2);
    assert.equal(saved2.data.fields.details, 'Updated laptop spec: 32GB RAM');

    // 7. Atomic submit cleanup:
    const signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=';
    const submitInput = {
      companyId: 'PEW',
      formType: 'IT Request',
      expectedWorkflowVersion: 1,
      signerChoices: { 'step-1': approver },
      formData: {
        dateOfRequest: '2026-11-16',
        department: 'IT',
        priority: 'Urgent',
        workDescription: 'Updated laptop spec: 32GB RAM',
        documents: {
          onlineDocumentChamber: false, physicalDocumentChamber: false, companyDocumentAjeer: false,
          employeeSalaryCertificate: false, permanentEmploymentVisa: false, workVisitVisa: false,
          businessVisitVisa: false, agencyWakala: false, others: false, othersDescription: '',
        },
        itRequest: {
          requestType: 'Hardware',
          justification: 'Current machine battery failure',
        },
      },
      attachments: [],
      signatureDataUrl: signature,
      expectedDraftRevision: 2, // Matches current revision 2
    };

    // Stale submit with revision 1 should 409 and not create request
    const staleSubmit = await call('POST', '/requests', cookieUser1, {
      ...submitInput,
      expectedDraftRevision: 1,
    });
    assert.equal(staleSubmit.status, 409);
    assert.equal(db.prepare('SELECT count(*) as count FROM requests').get()!.count, 0);

    // Valid submit with revision 2 should succeed and clear draft
    const submitRes = await call('POST', '/requests', cookieUser1, submitInput);
    assert.equal(submitRes.status, 201);
    const createdRecord = await submitRes.json();
    assert.ok(createdRecord.id);
    assert.equal(db.prepare('SELECT count(*) as count FROM requests').get()!.count, 1);

    // Verify draft was cleaned up (revision bumped to 3, data is null)
    const draftAfterSubmit = await (await call('GET', itDraftPath, cookieUser1)).json();
    assert.equal(draftAfterSubmit.revision, 3);
    assert.equal(draftAfterSubmit.data, null);

    // Stale tab trying to write with revision 2 must get 409
    const staleTabSave = await call('PUT', itDraftPath, cookieUser1, {
      expectedRevision: 2,
      data: itPayload,
    });
    assert.equal(staleTabSave.status, 409);

    // Verify draft is STILL null
    const draftStillNull = await (await call('GET', itDraftPath, cookieUser1)).json();
    assert.equal(draftStillNull.data, null);

    // Restart server/db and verify persistence
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();

    db = openDatabase(dbPath);
    const reopenedServer = (await createApp(db, { origin: 'http://localhost:3000', secureCookies: false })).listen(0, '127.0.0.1');
    await once(reopenedServer, 'listening');
    const reopenedPort = (reopenedServer.address() as { port: number }).port;
    const reopenedBase = `http://127.0.0.1:${reopenedPort}/api`;

    const reopenedDraft = await (await fetch(`${reopenedBase}${itDraftPath}`, {
      headers: { Origin: 'http://localhost:3000', Cookie: cookieUser1 },
    })).json();
    assert.equal(reopenedDraft.revision, 3);
    assert.equal(reopenedDraft.data, null);

    reopenedServer.closeAllConnections();
    await new Promise<void>(resolve => reopenedServer.close(() => resolve()));
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
