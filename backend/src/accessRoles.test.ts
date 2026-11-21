import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app';
import { createSession, provisionUser, sessionUser } from './auth';
import { openDatabase } from './db';
import { canBeAssignedApproval, canUserStartForm } from '../../shared/utils/companyAccess';

test('super admin assigns roles by company and edits take effect without changing department', async () => {
  const db = openDatabase(':memory:');
  const add = (name: string) => provisionUser(db, {
    name, email: name.toLowerCase() + '@example.test', department: 'Engineering', role: 'Admin', companyId: 'PEW',
  }, 'Synthetic-password-123');
  const [admin, employee] = await Promise.all([add('Owner'), add('Employee')]);
  db.prepare("INSERT INTO account_access (user_id, is_super_admin) VALUES (?,1)").run(admin);
  db.prepare(`INSERT INTO account_access (user_id, company_grants, form_grants)
    VALUES (?, '["PEW","ICCL"]', '{"PEW":["IT Request"],"ICCL":["IT Request"]}')`).run(employee);
  const adminToken = createSession(db, admin);
  const employeeToken = createSession(db, employee);
  const origin = 'http://localhost:3000';
  const app = await createApp(db, { origin, secureCookies: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/admin/access-roles`;
  const call = (body?: object, suffix = '', token = adminToken) => fetch(root + suffix, {
    method: body ? 'PUT' : 'GET',
    headers: { Origin: origin, Cookie: `precisign_session=${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  try {
    const role = { name: 'Engineering reviewer', permissions: ['approver'] };
    assert.equal((await call(role, '', employeeToken)).status, 403);
    assert.equal((await call(role)).status, 204);
    const { roles } = await (await call()).json();
    const id = roles.find((item: { name: string }) => item.name === role.name).id;
    assert.equal((await call({ userId: employee, companyId: 'FSG', roleIds: [id] }, '/assignments')).status, 400);
    assert.equal((await call({ userId: employee, companyId: 'PEW', roleIds: [id] }, '/assignments')).status, 204);
    let profile = sessionUser(db, employeeToken)!;
    assert.equal(canBeAssignedApproval(profile, 'PEW'), true);
    assert.equal(canUserStartForm(profile, 'PEW', 'IT Request'), false);
    assert.equal(canUserStartForm(profile, 'ICCL', 'IT Request'), true);
    assert.equal((await call({ ...role, id, permissions: ['requester'] })).status, 204);
    profile = sessionUser(db, employeeToken)!;
    assert.equal(profile.department, 'Engineering');
    assert.equal(canBeAssignedApproval(profile, 'PEW'), false);
    assert.equal(canUserStartForm(profile, 'PEW', 'IT Request'), true);
    assert.equal(canUserStartForm(profile, 'PEW', 'Cash Voucher'), false);
    assert.equal(canBeAssignedApproval(profile, 'ICCL'), true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
