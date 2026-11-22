import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { bytes, fields, text } from './requestValidation';
import { transaction } from './db';
import type { AsyncDatabase, AsyncQueryConnection } from './asyncDatabase';
import sharp from 'sharp';

export async function ownSignatureAsync(db: AsyncQueryConnection, userId: string) {
  const result = await db.execute('SELECT signature_data_url,signature_style_text FROM user_signatures WHERE user_id=?', [userId]);
  const row = result.rows[0];
  return row ? { signatureDataUrl: String(row.signature_data_url), signatureStyleText: String(row.signature_style_text) } : {};
}

/** The caller must revalidate the session inside the supplied transaction. */
export async function saveOwnSignatureAsync(db: AsyncDatabase, requireCurrentUser: (tx: AsyncQueryConnection) => Promise<{ id: string; name: string }>, signature: string, style: string) {
  return db.transaction(async tx => {
    const actor = await requireCurrentUser(tx);
    if (style !== actor.name) return null;
    await tx.execute('INSERT INTO user_signatures VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET signature_data_url=excluded.signature_data_url, signature_style_text=excluded.signature_style_text', [actor.id, signature, style]);
    return { ...actor, ...await ownSignatureAsync(tx, actor.id) };
  });
}

export function ownSignature(db: DatabaseSync, userId: string) {
  const row = db.prepare('SELECT signature_data_url,signature_style_text FROM user_signatures WHERE user_id=?').get(userId);
  return row ? { signatureDataUrl: String(row.signature_data_url), signatureStyleText: String(row.signature_style_text) } : {};
}

export function profileRoutes(db: DatabaseSync | AsyncDatabase) {
  const router = Router();
  router.get('/me/display-profile', async (_req, res, next) => {
    try {
      const sql = 'SELECT display_department, photo_data_url FROM user_display_profiles WHERE user_id=?';
      const id = res.locals.user.id;
      const row = 'prepare' in db ? db.prepare(sql).get(id) : (await db.execute(sql, [id])).rows[0];
      res.json({ department: row?.display_department ?? res.locals.user.department ?? '', photo: row?.photo_data_url ?? null });
    } catch (error) { next(error); }
  });
  router.put('/me/display-profile', async (req, res, next) => {
    try {
      fields(req.body, ['department', 'photo']);
      const department = text(req.body.department, 100, false).trim();
      const image = req.body.photo === null ? null : await bytes(req.body.photo, true);
      const photo = image ? `data:image/jpeg;base64,${(await sharp(image).rotate().resize(320, 320, { fit: 'cover' }).jpeg({ quality: 86 }).toBuffer()).toString('base64')}` : null;
      const sql = `INSERT INTO user_display_profiles (user_id,display_department,photo_data_url) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET display_department=excluded.display_department,photo_data_url=excluded.photo_data_url`;
      if ('prepare' in db) transaction(db, () => db.prepare(sql).run(res.locals.requireCurrentUser().id, department, photo));
      else await db.transaction(async tx => tx.execute(sql, [(await res.locals.requireCurrentUserAsync(tx)).id, department, photo]));
      res.json({ department, photo });
    } catch (error) { next(error); }
  });
  router.patch('/me/name', (_req, res) => {
    res.status(403).json({ error: 'Saved names are managed by super admins in User directory.' });
  });
  router.patch('/me/signature', async (req, res, next) => {
    try {
      fields(req.body, ['signatureDataUrl', 'signatureStyleText']);
      if (req.body.signatureDataUrl === null && req.body.signatureStyleText === undefined) {
        const actor = 'prepare' in db ? transaction(db, () => {
          const current = res.locals.requireCurrentUser();
          db.prepare('DELETE FROM user_signatures WHERE user_id=?').run(current.id);
          return current;
        }) : await db.transaction(async tx => {
          const current = await res.locals.requireCurrentUserAsync(tx);
          await tx.execute('DELETE FROM user_signatures WHERE user_id=?', [current.id]);
          return current;
        });
        const { signatureDataUrl: _image, signatureStyleText: _style, ...profile } = actor;
        res.json(profile);
        return;
      }
      await bytes(req.body.signatureDataUrl, true);
      const style = text(req.body.signatureStyleText, 150);
      const profile = 'prepare' in db ? transaction(db, () => {
        const actor = res.locals.requireCurrentUser();
        if (style !== actor.name) return null;
        db.prepare('INSERT INTO user_signatures VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET signature_data_url=excluded.signature_data_url, signature_style_text=excluded.signature_style_text')
          .run(actor.id, req.body.signatureDataUrl, style);
        return { ...actor, ...ownSignature(db, actor.id) };
      }) : await saveOwnSignatureAsync(db, async tx => {
        // Async authentication must re-read the session using this transaction.
        if (typeof res.locals.requireCurrentUserAsync !== 'function') throw new Error('Async session validation unavailable.');
        return res.locals.requireCurrentUserAsync(tx);
      }, req.body.signatureDataUrl, style);
      if (!profile) { res.status(400).json({error:'Signature name must match your account.'}); return; }
      res.json(profile);
    } catch (error) { next(error); }
  });
  return router;
}
