import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase, schemaVersion } from './db';
import { provisionUser, createSession, sessionLifetime } from './auth';
import { createApp } from './app';
import { ownSignature } from './profile';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { MockEmailTransport } from './email';

test('verified email changes revoke sessions and retarget pending fallback notifications', async () => {
  const db = openDatabase(':memory:');
  const mail = new MockEmailTransport();
  const email = 'old-employee@example.test';
  const password = 'Synthetic-test-password-123';
  const id = await provisionUser(db, { email, name: 'Employee', role: 'Admin', companyId: 'PEW', department: 'Test' }, password);
  const cookie = 'precisign_session=' + createSession(db, id);
  const app = await createApp(db, { origin: 'http://localhost:3000', secureCookies: false, emailTransport: mail });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api';
  const call = (path: string, body?: unknown, session = cookie, method = 'POST') => fetch(base + path, {
    method: body ? method : 'GET',
    headers: { Origin: 'http://localhost:3000', Cookie: session, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    const adminId = await provisionUser(db, {email:'admin-email-edit@example.test',name:'Directory Admin',role:'Admin',companyId:'PEW',department:'Test'}, password);
    db.prepare('INSERT INTO account_access (user_id,is_super_admin) VALUES (?,1)').run(adminId);
    db.prepare('INSERT INTO account_access (user_id) VALUES (?)').run(id);
    const adminCookie = 'precisign_session=' + createSession(db, adminId);
    const newEmail = 'new-employee@example.test';
    db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?)').run('rename-route','PEW',id,'Pending Approval',1,'{}');
    const enqueue = db.prepare(`INSERT INTO email_outbox
      (id,request_id,event_type,recipient_user_id,recipient_email,recipient_name,subject,payload_json,idempotency_key,status,created_at)
      VALUES (?,'rename-route','ACTION_REQUIRED',?,?,'Employee','Test',?,?,'pending',0)`);
    enqueue.run('fallback',id,email,'{"usesSignInEmail":1}','fallback');
    enqueue.run('override',id,email,'{"usesSignInEmail":0}','override');
    db.prepare('INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,?)').run(id,'unused-reset',Date.now()+100000);

    assert.equal((await call('/me/email', { email: newEmail, currentPassword:'wrong-password' })).status,403);
    assert.equal((await call('/me/email', { email:'admin-email-edit@example.test', currentPassword:password })).status,409);
    assert.equal((await call('/me/email', { email: 'mistyped@example.test', currentPassword:password })).status,204);
    const first = mail.sent.at(-1)?.text?.match(/confirm-email=([a-f0-9]{64})/)?.[1];
    assert(first);
    assert.equal((await call('/me/email', { email: newEmail, currentPassword:password })).status,204);
    assert.equal((await (await call('/auth/me')).json()).user.email,email);
    const token = mail.sent.at(-1)?.text?.match(/confirm-email=([a-f0-9]{64})/)?.[1];
    assert(token);
    assert.equal((await call('/auth/confirm-email',{token:first},'')).status,400);
    assert.equal((await call('/auth/confirm-email',{token},'')).status,204);
    assert.equal((await call('/auth/confirm-email',{token},'')).status,400);
    assert.equal((await call('/auth/me')).status,401);
    assert.equal((await call('/auth/login',{email,password},'')).status,401);
    assert.equal((await call('/auth/login',{email:newEmail,password},'')).status,200);
    assert.equal(db.prepare('SELECT 1 FROM password_resets WHERE user_id=?').get(id),undefined);
    assert.equal(mail.sent.at(-1)?.to,email);
    assert.equal(db.prepare("SELECT recipient_email FROM email_outbox WHERE id='fallback'").get()?.recipient_email,newEmail);
    assert.equal(db.prepare("SELECT recipient_email FROM email_outbox WHERE id='override'").get()?.recipient_email,email);
    assert.equal((await call('/admin/accounts/'+id,{name:'Directory Rename',email:'directory@example.test'},adminCookie,'PATCH')).status,204);
    const accounts = await (await call('/admin/accounts',undefined,adminCookie)).json();
    const changed = accounts.find((account: {id:string}) => account.id === id);
    assert.equal(changed.name,'Directory Rename');
    assert.equal(changed.email,'directory@example.test');
    assert.deepEqual(changed.identityHistory.map((entry: {field:string;actorId:string}) => [entry.field,entry.actorId]),[
      ['name',adminId],['email',adminId],['email',id],
    ]);
    assert.equal(mail.sent.at(-1)?.to,newEmail);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test('signature profile is owner-only, private, validated and independent of request snapshots', async()=>{
 const db=openDatabase(':memory:'); const ids: string[]=[];
 for(let i=0;i<2;i++) ids.push(await provisionUser(db,{email:`sig${i}@example.test`,name:`Signer ${i}`,role:'Admin',companyId:'PEW',department:'Test'},'Synthetic-test-password-123'));
 const issuedAt = Date.now();
 const cookies=ids.map(id=>`precisign_session=${createSession(db,id,issuedAt)}`);
 let checksBeforeExpiry = Infinity;
 const now = () => checksBeforeExpiry-- > 0 ? issuedAt : issuedAt + sessionLifetime;
 const app=await createApp(db,{origin:'http://localhost:3000',secureCookies:false,now});const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 const call=(path:string,actor=0,body?:unknown)=>fetch(base+path,{method:body?'PATCH':'GET',headers:{Origin:'http://localhost:3000',Cookie:cookies[actor]||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const signatureDataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=';
 const input={signatureDataUrl,signatureStyleText:'Signer 0'};
 try{
  db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?)').run('snapshot','PEW',ids[0],'Approved',1,JSON.stringify({signatureDataUrl:'original mark'}));
  assert.equal((await call('/me/signature',3,input)).status,401);
  assert.equal((await call('/me/signature',0,{...input,userId:ids[1]})).status,400);
  assert.equal((await call('/me/signature',0,{...input,signatureDataUrl:'data:image/png;base64,AAAA'})).status,400);
  assert.equal((await call('/me/signature',1,input)).status,400);
  assert.equal((await call('/me/signature',0,input)).status,200);
  assert.equal((await (await call('/auth/me')).json()).user.signatureDataUrl,signatureDataUrl);
  const bootstrap=await (await call('/bootstrap',1)).json();
  assert.equal(bootstrap.user.signatureDataUrl,undefined);assert.equal(bootstrap.users.some((u:any)=>u.signatureDataUrl),false);
  assert.equal(JSON.parse(String(db.prepare("SELECT record FROM requests WHERE id='snapshot'").get()!.record)).signatureDataUrl,'original mark');
  db.exec("CREATE TRIGGER sig_fail BEFORE UPDATE ON user_signatures BEGIN SELECT RAISE(ABORT,'failed'); END");
  assert.equal((await call('/me/signature',0,input)).status,500);
  assert.equal((await (await call('/auth/me')).json()).user.signatureDataUrl,signatureDataUrl);
  db.exec('DROP TRIGGER sig_fail');
  assert.equal((await call('/me/signature',3,{signatureDataUrl:null})).status,401);
  assert.equal((await call('/me/signature',1,{signatureDataUrl:null})).status,200);
  assert.equal(ownSignature(db, ids[0]).signatureDataUrl,signatureDataUrl);
  assert.equal((await call('/me/signature',0,{signatureDataUrl:null})).status,200);
  assert.equal((await (await call('/auth/me')).json()).user.signatureDataUrl,undefined);
  assert.equal(JSON.parse(String(db.prepare("SELECT record FROM requests WHERE id='snapshot'").get()!.record)).signatureDataUrl,'original mark');
  assert.equal((await call('/me/signature',0,input)).status,200);
  checksBeforeExpiry = 1;
  assert.equal((await call('/me/signature',0,input)).status,401);
  assert.equal(ownSignature(db, ids[0]).signatureDataUrl, signatureDataUrl);
  checksBeforeExpiry = Infinity;
  db.prepare('INSERT INTO account_access (user_id, is_super_admin) VALUES (?, 1)').run(ids[1]);
  assert.equal((await call('/me/name',3,{name:'New Name'})).status,401);
  assert.equal((await call('/me/name',0,{name:'New Name',userId:ids[1]})).status,400);
  assert.equal((await call('/me/name',0,{name:'   '})).status,400);
  assert.deepEqual(await (await call('/me/name',0,{name:'  New Name  '})).json(), {name:'New Name',initials:'NN'});
  assert.equal((await call('/me/name',0,{name:'New Name'})).status,200);
  const self = (await (await call('/auth/me')).json()).user;
  assert.equal(self.name,'New Name');
  assert.equal(self.signatureDataUrl,signatureDataUrl);
  assert.equal(self.signatureStyleText,'Signer 0');
  assert.equal((await call('/admin/accounts')).status,403);
  const accounts = await (await call('/admin/accounts',1)).json();
  assert.equal(accounts.find((account: any) => account.id === ids[0]).name,'New Name');
  assert.deepEqual(accounts.find((account: any) => account.id === ids[0]).nameHistory, [
    {id:1,oldName:'Signer 0',newName:'New Name',changedAt:new Date(issuedAt).toISOString()},
  ]);
  assert.equal(JSON.parse(String(db.prepare("SELECT record FROM requests WHERE id='snapshot'").get()!.record)).signatureDataUrl,'original mark');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
});

test('disabling an account after authentication prevents an in-flight signature write', async () => {
  const db = openDatabase(':memory:');
  const id = await provisionUser(db, { email: 'revoked@example.test', name: 'Revoked User', role: 'Admin', companyId: 'PEW', department: 'Test' }, 'Synthetic-test-password-123');
  db.prepare('INSERT INTO account_access (user_id) VALUES (?)').run(id);
  const token = createSession(db, id);
  const origin = 'http://localhost:3000';
  let armed = true;
  let revokeDone!: () => void;
  const revoked = new Promise<void>(resolve => { revokeDone = resolve; });
  const now = () => {
    if (armed) {
      armed = false;
      setImmediate(() => {
        db.prepare('UPDATE account_access SET is_disabled=1 WHERE user_id=?').run(id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
        revokeDone();
      });
    }
    return Date.now();
  };
  const app = await createApp(db, { origin, secureCookies: false, now });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const image = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: '#112233' } }).png().toBuffer();
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/me/signature`, {
      method: 'PATCH',
      headers: { Origin: origin, Cookie: `precisign_session=${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureDataUrl: `data:image/png;base64,${image.toString('base64')}`, signatureStyleText: 'Revoked User' }),
    });
    await revoked;
    assert.equal(response.status, 401);
    assert.deepEqual(ownSignature(db, id), {});
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close();
  }
});


test('version-one database migration preserves users and saved signature survives reopen', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'precisign-profile-'));const path=join(dir,'test.sqlite');let db=openDatabase(path);
 try {
  const id=await provisionUser(db,{email:'migration@example.test',name:'Migration',role:'Admin',companyId:'PEW',department:'Test'},'Synthetic-test-password-123');
  db.exec('DROP TABLE password_resets; DROP VIEW account_profiles; DROP TABLE account_access; DROP TABLE user_signatures; ALTER TABLE users DROP COLUMN job_title; ALTER TABLE users DROP COLUMN route_rights; PRAGMA user_version=1'); db.close();db=openDatabase(path);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, schemaVersion);
  assert.equal(db.prepare('SELECT id FROM users').get()!.id,id);
  db.prepare('INSERT INTO user_signatures VALUES (?,?,?)').run(id,'stored-test-mark','Migration');db.close();db=openDatabase(path);
  assert.equal(ownSignature(db,id).signatureDataUrl,'stored-test-mark');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
