import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from './db';
import { hashPassword, verifyPassword, provisionUser, createSession, sessionUser, sessionUserAsync, signIn, signInAsync, tokenHash, changePasswordAsync } from './auth';
import { openAsyncDatabase, migrateAsyncDatabase } from './asyncDatabase';
import { createApp } from './app';

const originalNodeEnv = process.env.NODE_ENV;

test('synchronous sign-in path: strict password verification in development and production', async () => {
  const db = openDatabase(':memory:');
  const accountPassword = 'Strict-Synthetic-Secret-987';
  const account = { email: 'strict.user@example.test', name: 'Strict User', department: 'QA', role: 'Admin' as const, companyId: 'PEW' as const };
  const userId = await provisionUser(db, account, accountPassword);
  db.prepare("INSERT INTO account_access (user_id, company_grants, must_change_password) VALUES (?, '[\"PEW\"]', 0)").run(userId);
  const dummyHash = await hashPassword('dummy-placeholder-pass');

  const previouslyAcceptedCommonPasswords = [
    'password',
    '12345678',
    'admin123',
    'password123',
    'PreciSign-Test123!',
  ];

  try {
    for (const env of ['development', 'production']) {
      process.env.NODE_ENV = env;

      // 1. Correct account password must succeed
      const successfulSignIn = await signIn(db, account.email, accountPassword, dummyHash, undefined, () => Date.now());
      assert.ok(successfulSignIn, `Correct password must succeed under NODE_ENV=${env}`);
      assert.equal(successfulSignIn.user.id, userId);

      // 2. Each common password (and random wrong password) must fail
      for (const wrongPass of [...previouslyAcceptedCommonPasswords, 'random-incorrect-password']) {
        const failedSignIn = await signIn(db, account.email, wrongPass, dummyHash, undefined, () => Date.now());
        assert.equal(failedSignIn, null, `Wrong password "${wrongPass}" must fail under NODE_ENV=${env}`);
      }

      // 2b. Password variants with added or removed trailing/leading spaces must fail strictly
      const withTrailingSpace = accountPassword + ' ';
      assert.equal(await signIn(db, account.email, withTrailingSpace, dummyHash, undefined, () => Date.now()), null, 'Password with added trailing space must fail synchronously');
      const withLeadingSpace = ' ' + accountPassword;
      assert.equal(await signIn(db, account.email, withLeadingSpace, dummyHash, undefined, () => Date.now()), null, 'Password with leading space must fail synchronously');
    }

    // 3. Disabled account cannot sign in even with correct password
    db.prepare('UPDATE account_access SET is_disabled = 1 WHERE user_id = ?').run(userId);
    const disabledSignIn = await signIn(db, account.email, accountPassword, dummyHash, undefined, () => Date.now());
    assert.equal(disabledSignIn, null, 'Disabled account must not be able to sign in');

    // Re-enable for subsequent checks
    db.prepare('UPDATE account_access SET is_disabled = 0 WHERE user_id = ?').run(userId);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    db.close();
  }
});

test('asynchronous sign-in path: strict password verification in development and production', async () => {
  const db = openAsyncDatabase('file::memory:');
  const accountPassword = 'Async-Synthetic-Secret-654';
  const dummyHash = await hashPassword('dummy-placeholder-pass');

  const previouslyAcceptedCommonPasswords = [
    'password',
    '12345678',
    'admin123',
    'password123',
    'PreciSign-Test123!',
  ];

  try {
    await migrateAsyncDatabase(db);
    const hash = await hashPassword(accountPassword);
    await db.execute("INSERT INTO users (id,email,name,role,department,company_id,password_hash) VALUES ('async-user','async@example.test','Async User','Admin','QA','PEW',?)", [hash]);
    await db.execute("INSERT INTO account_access (user_id, company_grants, must_change_password) VALUES ('async-user', '[\"PEW\"]', 0)");

    for (const env of ['development', 'production']) {
      process.env.NODE_ENV = env;

      // 1. Correct password must succeed
      const successfulSignIn = await signInAsync(db, 'async@example.test', accountPassword, dummyHash, undefined, () => Date.now());
      assert.ok(successfulSignIn, `Correct password must succeed asynchronously under NODE_ENV=${env}`);
      assert.equal(successfulSignIn.user.id, 'async-user');

      // 2. Common wrong passwords must fail
      for (const wrongPass of [...previouslyAcceptedCommonPasswords, 'wrong-async-pass']) {
        const failedSignIn = await signInAsync(db, 'async@example.test', wrongPass, dummyHash, undefined, () => Date.now());
        assert.equal(failedSignIn, null, `Wrong password "${wrongPass}" must fail asynchronously under NODE_ENV=${env}`);
      }

      // 2b. Password variants with added or removed trailing/leading spaces must fail strictly
      const withTrailingSpace = accountPassword + ' ';
      assert.equal(await signInAsync(db, 'async@example.test', withTrailingSpace, dummyHash, undefined, () => Date.now()), null, 'Password with added trailing space must fail asynchronously');
      const withLeadingSpace = ' ' + accountPassword;
      assert.equal(await signInAsync(db, 'async@example.test', withLeadingSpace, dummyHash, undefined, () => Date.now()), null, 'Password with leading space must fail asynchronously');
    }

    // 3. Disabled account check
    await db.execute('UPDATE account_access SET is_disabled = 1 WHERE user_id = ?', ['async-user']);
    const disabledSignIn = await signInAsync(db, 'async@example.test', accountPassword, dummyHash, undefined, () => Date.now());
    assert.equal(disabledSignIn, null, 'Disabled account must not be able to sign in asynchronously');
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    db.close();
  }
});

test('first-sign-in password-change behavior and session revocation', async () => {
  const db = openDatabase(':memory:');
  const tempPassword = 'Initial-Temporary-Password-123';
  const chosenPassword = 'My-New-Private-Password-789';
  const account = { email: 'first.time@example.test', name: 'First Timer', department: 'Finance', role: 'Admin' as const, companyId: 'PEW' as const };
  const userId = await provisionUser(db, account, tempPassword);
  db.prepare("INSERT INTO account_access (user_id, company_grants, must_change_password) VALUES (?, '[\"PEW\"]', 1)").run(userId);

  const origin = 'http://localhost:3000';
  const app = await createApp(db, { origin, secureCookies: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });

  try {
    // 1. Initial sign-in with temporary password succeeds, but indicates mustChangePassword === true
    const loginRes = await post('/auth/login', { email: account.email, password: tempPassword });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.equal(loginData.user.mustChangePassword, true);

    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // 2. Access to regular application endpoints is blocked
    const bootstrapRes = await fetch(base + '/bootstrap', { headers: { Cookie: sessionCookie } });
    assert.equal(bootstrapRes.status, 403);
    const err = await bootstrapRes.json();
    assert.match(err.error, /Change your password to continue/i);

    const requestsRes = await fetch(base + '/requests', { headers: { Cookie: sessionCookie } });
    assert.equal(requestsRes.status, 403);

    // 3. Changing password with incorrect current password fails
    const badChangeRes = await post('/auth/change-password', { currentPassword: 'wrong-current-pass', newPassword: chosenPassword }, sessionCookie);
    assert.equal(badChangeRes.status, 403);

    // 4. Changing password with correct current password succeeds
    const changeRes = await post('/auth/change-password', { currentPassword: tempPassword, newPassword: chosenPassword }, sessionCookie);
    assert.equal(changeRes.status, 204);

    // 5. Old session cookie is now invalid / expired
    const meRes = await fetch(base + '/auth/me', { headers: { Cookie: sessionCookie } });
    assert.equal(meRes.status, 401);

    // 6. Old temporary password no longer works
    const oldLoginRes = await post('/auth/login', { email: account.email, password: tempPassword });
    assert.equal(oldLoginRes.status, 401);

    // 7. Login with newly chosen password succeeds, and mustChangePassword is false
    const newLoginRes = await post('/auth/login', { email: account.email, password: chosenPassword });
    assert.equal(newLoginRes.status, 200);
    const newLoginData = await newLoginRes.json();
    assert.equal(newLoginData.user.mustChangePassword, false);

    const newCookie = newLoginRes.headers.get('set-cookie')!.split(';')[0];
    const newBootstrapRes = await fetch(base + '/bootstrap', { headers: { Cookie: newCookie } });
    assert.equal(newBootstrapRes.status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test('employee-creation authorization, initial grants, and effective access verification', async () => {
  const db = openDatabase(':memory:');
  const adminPassword = 'Admin-Secret-Key-1234';
  const employeePassword = 'Employee-Secret-Key-5678';
  const newEmployeePassword = 'New-Hire-Secret-Key-9012';

  // Provision SuperAdmin
  const adminId = await provisionUser(db, { name: 'Super Admin', email: 'admin@company.test', department: 'Executive', role: 'Admin', companyId: 'PEW' }, adminPassword);
  db.prepare("INSERT INTO account_access (user_id, company_grants, is_super_admin) VALUES (?, '[\"PEW\",\"ICCL\",\"FSG\"]', 1)").run(adminId);

  // Provision normal non-admin Employee
  const employeeId = await provisionUser(db, { name: 'Regular Employee', email: 'worker@company.test', department: 'Engineering', role: 'Admin', companyId: 'PEW' }, employeePassword);
  db.prepare("INSERT INTO account_access (user_id, company_grants, form_grants, is_super_admin) VALUES (?, '[\"PEW\"]', '{\"PEW\":[\"IT Request\"]}', 0)").run(employeeId);

  const adminToken = createSession(db, adminId);
  const employeeToken = createSession(db, employeeId);
  const adminCookie = `precisign_session=${adminToken}`;
  const employeeCookie = `precisign_session=${employeeToken}`;

  const origin = 'http://localhost:3000';
  const app = await createApp(db, { origin, secureCookies: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });

  const newHireDetails = {
    name: 'New Hire',
    email: 'new.hire@company.test',
    department: 'Operations',
    password: newEmployeePassword,
  };

  try {
    const publicSignup = await post('/auth/signup', newHireDetails);
    assert.equal(publicSignup.status, 403, 'Public signup must be disabled');
    assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get(newHireDetails.email), undefined);
    // 1. Unauthenticated request to /admin/accounts fails
    const unauthRes = await post('/admin/accounts', newHireDetails);
    assert.equal(unauthRes.status, 401, 'Unauthenticated user must receive 401');

    // 2. Unauthorized (non-SuperAdmin) user request to /admin/accounts fails with 403
    const forbiddenRes = await post('/admin/accounts', newHireDetails, employeeCookie);
    assert.equal(forbiddenRes.status, 403, 'Non-admin user must receive 403');
    const forbiddenErr = await forbiddenRes.json();
    assert.match(forbiddenErr.error, /Action not permitted|Administrator required/i);

    // 3. Authorized SuperAdmin request to /admin/accounts succeeds with 201
    const createRes = await post('/admin/accounts', newHireDetails, adminCookie);
    assert.equal(createRes.status, 201, 'SuperAdmin must be able to create an employee');
    const createdAccount = await createRes.json();
    assert.equal(createdAccount.email, newHireDetails.email);

    // 4. Verify initial database state and grants
    const row = db.prepare('SELECT users.id, users.email, account_access.company_grants, account_access.form_grants, account_access.is_super_admin, account_access.is_disabled, account_access.role_override, account_access.must_change_password FROM users JOIN account_access ON account_access.user_id = users.id WHERE users.email = ?').get(newHireDetails.email) as any;
    assert.ok(row, 'User row must exist in DB');
    assert.equal(row.company_grants, '[]', 'Initial company grants must be empty array');
    assert.equal(row.form_grants, '{}', 'Initial form grants must be empty object');
    assert.equal(row.is_super_admin, 0, 'New employee must not be super admin');
    assert.equal(row.is_disabled, 0, 'New employee must not be disabled');
    assert.equal(row.role_override, 'Employee', 'Role override must be Employee');
    assert.equal(row.must_change_password, 1);

    // 5. Sign in as the newly created employee
    const newLoginRes = await post('/auth/login', { email: newHireDetails.email, password: newEmployeePassword });
    assert.equal(newLoginRes.status, 200, 'New employee can sign in with their password');
    const temporaryCookie = newLoginRes.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await newLoginRes.clone().json()).user.mustChangePassword, true);
    assert.equal((await fetch(base + '/bootstrap', { headers: { Cookie: temporaryCookie } })).status, 403);
    assert.equal((await post('/auth/change-password', { currentPassword: newEmployeePassword, newPassword: 'Replacement-Hire-Password-9876' }, temporaryCookie)).status, 204);
    const relogin = await post('/auth/login', { email: newHireDetails.email, password: 'Replacement-Hire-Password-9876' });
    assert.equal(relogin.status, 200);
    const newHireCookie = relogin.headers.get('set-cookie')!.split(';')[0];

    // 6. Verify effective access: zero company access, zero forms startable
    const hireBootstrapRes = await fetch(base + '/bootstrap', { headers: { Cookie: newHireCookie } });
    assert.equal(hireBootstrapRes.status, 200);
    const hireBootstrap = await hireBootstrapRes.json();
    assert.deepEqual(hireBootstrap.user.companyGrants, [], 'Effective company grants must be empty');
    assert.deepEqual(hireBootstrap.companies, [], 'Accessible companies must be empty');
    assert.deepEqual(hireBootstrap.workflows, [], 'Available workflows must be empty');

    // 7. Verify creating a request or viewing drafts is forbidden
    const createReqRes = await post('/requests', { companyId: 'PEW', formType: 'IT Request' }, newHireCookie);
    assert.equal(createReqRes.status, 403, 'Must not be able to submit requests without company/form grants');

    const draftRes = await fetch(base + '/drafts/PEW/Admin%20Work%20Request', { headers: { Cookie: newHireCookie } });
    assert.equal(draftRes.status, 403, 'Must not be able to read drafts without company grants');

    // 8. SuperAdmin grants PEW and 'IT Request'
    const grantsRes = await fetch(base + `/admin/accounts/${row.id}/grants`, {
      method: 'PUT',
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ companyIds: ['PEW'], formsByCompany: { PEW: ['IT Request'] } }),
    });
    assert.equal(grantsRes.status, 204);

    // 9. Employee now has effective access to PEW and IT Request
    const updatedBootstrapRes = await fetch(base + '/bootstrap', { headers: { Cookie: newHireCookie } });
    assert.equal(updatedBootstrapRes.status, 200);
    const updatedBootstrap = await updatedBootstrapRes.json();
    assert.deepEqual(updatedBootstrap.user.companyGrants, ['PEW']);
    assert.deepEqual(updatedBootstrap.user.formGrants, { PEW: ['IT Request'] });
    assert.equal(updatedBootstrap.companies.length, 1);
    assert.equal(updatedBootstrap.companies[0].id, 'PEW');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
