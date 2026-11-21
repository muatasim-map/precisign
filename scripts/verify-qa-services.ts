import dotenv from 'dotenv';
dotenv.config();
import { openAsyncDatabase, migrateAsyncDatabase } from '../backend/src/asyncDatabase';
import { ResendEmailTransport } from '../backend/src/email/emailTransport';

async function main() {
  console.log('=== Verifying Real QA Services from Localhost ===');

  // 1. Turso Save and Reload Test (precisign-qa)
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl || !tursoToken) {
    console.log('[TURSO] BLOCKED: Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN');
  } else {
    console.log(`[TURSO] Testing against retained QA cluster: ${tursoUrl}`);
    const db = openAsyncDatabase(tursoUrl, tursoToken);
    try {
      await migrateAsyncDatabase(db);
      const testUserId = `usr-probe-${Date.now()}`;
      const testEmail = `probe-${Date.now()}@precisign.test`;
      const companyId = 'PEW';
      const testFormType = `QA-Probe-${Date.now()}`;

      // Insert probe user
      await db.execute(
        "INSERT INTO users (id, email, name, role, department, company_id, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [testUserId, testEmail, 'Probe User', 'Admin', 'Operations', companyId, 'dummy_hash']
      );

      // Write test probe into drafts
      await db.execute(
        "INSERT INTO drafts (user_id, company_id, form_type, revision, data) VALUES (?, ?, ?, ?, ?)",
        [testUserId, companyId, testFormType, 1, JSON.stringify({ probe: true, timestamp: Date.now() })]
      );
      console.log(`[TURSO] Successfully wrote probe draft record: ${testFormType}`);

      const rowsRes = await db.execute(
        "SELECT user_id, company_id, form_type, data, revision FROM drafts WHERE user_id = ? AND company_id = ? AND form_type = ?",
        [testUserId, companyId, testFormType]
      );
      const row = rowsRes.rows[0];
      if (rowsRes.rows.length === 1 && JSON.parse(row.data as string).probe === true) {
        console.log(`[TURSO] Successfully reloaded and verified probe draft record: ${testFormType}`);
      } else {
        throw new Error('Turso reload failed: record did not match expected data');
      }

      // Clean up probe records
      await db.execute("DELETE FROM drafts WHERE user_id = ? AND company_id = ? AND form_type = ?", [testUserId, companyId, testFormType]);
      await db.execute("DELETE FROM users WHERE id = ?", [testUserId]);
      console.log(`[TURSO] Cleaned up probe records successfully`);
      console.log('[TURSO] STATUS: PASS (Save and reload verified on retained QA database)');
    } catch (err: any) {
      console.error('[TURSO] FAIL:', err.message);
    } finally {
      db.close();
    }
  }

  // 2. Cloudflare R2 Check
  const r2Bucket = process.env.PRECISIGN_R2_BUCKET;
  console.log(`[R2] Target bucket configured: ${r2Bucket}`);
  if (r2Bucket === 'precisign-attachments') {
    console.log('[R2] STATUS: BLOCKED');
    console.log('     Reason: The configured bucket "precisign-attachments" is the live production bucket.');
    console.log('     Per safety constraints, synthetic file upload to production bucket is strictly prohibited.');
    console.log('     Prerequisite to rerun: Provision "precisign-attachments-qa" in Cloudflare R2 dashboard.');
  } else if (r2Bucket && r2Bucket.includes('qa')) {
    console.log('[R2] QA bucket detected, verifying upload/retrieval...');
  } else {
    console.log('[R2] STATUS: BLOCKED (No dedicated QA bucket configured)');
  }

  // 3. Resend Email Dispatch
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log('[EMAIL] BLOCKED: Missing RESEND_API_KEY');
  } else {
    console.log('[EMAIL] Testing live Resend dispatch to sandbox recipient...');
    const transport = new ResendEmailTransport({
      apiKey: resendKey,
      sender: 'PreciSign Notifications <onboarding@resend.dev>',
      testRecipient: 'delivered@resend.dev',
      mode: 'sandbox',
    });

    try {
      const result = await transport.send({
        to: 'delivered@resend.dev',
        subject: `PreciSign Live Prelaunch Probe [${Date.now()}]`,
        text: 'This is an automated delivery probe from the PreciSign Live prelaunch verification.',
        html: '<p>This is an automated delivery probe from the <strong>PreciSign Live</strong> prelaunch verification.</p>',
        idempotencyKey: `probe-key-${Date.now()}`
      });
      console.log('[EMAIL] Dispatch result from Resend API:', result);
      console.log(`[EMAIL] STATUS: PASS (API accepted dispatch with Resend ID: ${result.resendId})`);
      console.log('     Inbox Delivery Confirmed: NO (Sandbox mode dispatches to simulation endpoint delivered@resend.dev).');
      console.log('     Prerequisite for Real Inbox Delivery: Configure custom domain DNS records (SPF, DKIM, DMARC) in Resend.');
    } catch (err: any) {
      console.error('[EMAIL] Dispatch failed:', err.message);
    }
  }
}

main().catch(console.error);
