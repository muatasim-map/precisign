import { attachmentsForVersion } from '../../shared/utils/historicalEvidence';
import { attachmentMetadata, type AttachmentStorage } from './attachmentStorage';
import { Router, type Request } from 'express';
import type { AsyncDatabase } from './asyncDatabase';
import type { DatabaseSync } from 'node:sqlite';
import type { Company, CompanyId, RequestRecord, UserProfile } from '../../shared/types';
import { canUserAccessCompany } from '../../shared/utils/companyAccess';
import { canReadPreciRoute } from '../../shared/utils/routeAccess';
import { currentCompanyDisplay } from '../../shared/utils/companyDisplay';
import { safeProfile, sessionUser, sessionUserAsync } from './auth';
import { renderDocumentPdf } from './documentPdf';
import { ownSignature, ownSignatureAsync } from './profile';

const companies: CompanyId[] = ['PEW', 'ICCL', 'FSG'];

export function readRoutes(db: DatabaseSync | AsyncDatabase, origin: string, sessionToken: (request: Request) => string | undefined, storage?: AttachmentStorage) {
  const router = Router();
  const query = async (sql: string, args: string[] = []) => 'prepare' in db
    ? db.prepare(sql).all(...args) : (await db.execute(sql, args)).rows;
  router.get('/bootstrap', async (_req, res, next) => {
    try {
      const user = res.locals.user as UserProfile;
      const allowed = companies.filter(id => canUserAccessCompany(user, id));
      const placeholders = allowed.map(() => '?').join(',');
      const companyRows = allowed.length ? (await query(`SELECT id,name,logo_data_url FROM companies LEFT JOIN company_logos ON company_id=id WHERE id IN (${placeholders})`, allowed)) : [];
      const companyList: Company[] = companyRows.map(row => currentCompanyDisplay({
        id: row.id as CompanyId, code: String(row.id), name: String(row.name),
        logoDataUrl: (row.logo_data_url as string | null) ?? undefined,
        fullName: `${row.id} - ${row.name}`, groupName: 'PRECISION ENGINEERING GROUP',
      }));
      const users = allowed.length ? (await query('SELECT id,email,name,role,department,company_id,allowed_companies,group_admin,company_grants,role_override,is_super_admin,company_permissions,route_rights,job_title FROM account_profiles WHERE COALESCE(is_disabled,0)=0'))
        .map(safeProfile)
        .filter(candidate => allowed.some(id => canUserAccessCompany(candidate, id)))
        .map(candidate => ({
          ...candidate,
          routeRights: candidate.routeRights && Object.fromEntries(Object.entries(candidate.routeRights).filter(([id]) => allowed.includes(id as CompanyId))),
        })) : [];
      const workflows = allowed.length ? (await query(`SELECT config FROM workflows WHERE company_id IN (${placeholders})`, allowed)).map(row => JSON.parse(String(row.config))) : [];
      res.json({ user: { ...user, ...('prepare' in db ? ownSignature(db, user.id) : await ownSignatureAsync(db, user.id)) }, companies: companyList, users, workflows });
    } catch (error) { next(error); }
  });
  router.get('/requests', async (req, res, next) => {
    try {
      const scope = req.query.scope;
      if (scope !== undefined && (typeof scope !== 'string' || !['PEG', ...companies].includes(scope))) {
        res.status(400).json({ error: 'Invalid viewing scope.' }); return;
      }
      const user = res.locals.user as UserProfile;
      const allowed = companies.filter(id => canUserAccessCompany(user, id) && (!scope || scope === 'PEG' || scope === id));
      if (!allowed.length) { res.json([]); return; }
      const rows = (await query(`SELECT record,revision FROM requests WHERE company_id IN (${allowed.map(() => '?').join(',')}) ORDER BY id`, allowed));
      const records = rows.map(row => ({ ...JSON.parse(String(row.record)), revision: Number(row.revision) })).filter(record => canReadPreciRoute(user, record));
      res.json(records.map(attachmentMetadata));
    } catch (error) { next(error); }
  });
  async function readableRequest(id: string, user: UserProfile) {
    const row = (await query('SELECT record,revision FROM requests WHERE id=?', [id]))[0];
    if (!row) return undefined;
    const record = JSON.parse(String(row.record)) as RequestRecord;
    if (!canUserAccessCompany(user, record.companyId) || !canReadPreciRoute(user, record)) return undefined;
    return { ...record, revision: Number(row.revision) };
  }
  router.get('/requests/:id', async (req, res, next) => {
    try {
      const record = await readableRequest(req.params.id, res.locals.user);
      if (!record) { res.status(404).json({ error: 'Request not found.' }); return; }
      res.json(attachmentMetadata(record));
    } catch (error) { next(error); }
  });
  router.get('/requests/:id/attachments/:version/:fileId', async (req, res, next) => {
    try {
      const record = await readableRequest(req.params.id, res.locals.user);
      const version = Number(req.params.version);
      if (!/^[1-9]\d*$/.test(req.params.version) || !Number.isSafeInteger(version)) {
        res.status(404).json({ error: 'Attachment unavailable.' }); return;
      }
      const files = record && attachmentsForVersion(record, version);
      const file = files?.find(item => item.id === req.params.fileId)
        ?? record?.financeHoldHistory?.find(entry => entry.documentVersion === version && entry.attachment?.id === req.params.fileId)?.attachment;
      if (!file?.dataUrl) { res.status(404).json({ error: 'Attachment unavailable.' }); return; }
      if (file.dataUrl.startsWith('r2:')) {
        if (!storage) { res.status(503).json({ error: 'Attachment storage is unavailable.' }); return; }
        await storage.download(file);
      }
      const match = file.dataUrl.match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) { res.status(404).json({ error: 'Attachment unavailable.' }); return; }
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.attachment(file.name).type(match[1]).send(Buffer.from(match[2], 'base64'));
    } catch (error) { next(error); }
  });
  attachDocumentPdfRoute(router, origin, sessionToken, readableRequest, token => 'prepare' in db ? sessionUser(db, token) : sessionUserAsync(db, token));
  return router;
}

function attachDocumentPdfRoute(
  router: ReturnType<typeof Router>,
  origin: string,
  sessionToken: (request: Request) => string | undefined,
  readableRequest: (id: string, user: UserProfile) => (RequestRecord & { revision: unknown }) | undefined | Promise<(RequestRecord & { revision: unknown }) | undefined>,
  lookupSession: (token: string) => UserProfile | null | Promise<UserProfile | null>,
) {
  let renderingPdf = false;
  router.post('/requests/:id/document-pdf', async (req, res, next) => {
    let record;
    try { record = await readableRequest(req.params.id, res.locals.user); } catch (error) { next(error); return; }
    const token = sessionToken(req);
    if (!record || !token) { res.status(404).json({ error: 'Request not found.' }); return; }
    const { version, updatedAt } = req.body ?? {};
    if (!['Admin Work Request', 'Administrative & Payment Request', 'IT Request', 'Cash Voucher', 'Expense Claim', 'R&D Initiative'].includes(record.formType)
      || !Number.isSafeInteger(version) || (version !== record.documentVersion && !(record.versionSnapshots ?? []).some(item => item.version === version))) {
      res.status(404).json({ error: 'Document version unavailable.' }); return;
    }
    if (record.updatedAt !== updatedAt) { res.status(409).json({ error: 'Request changed. Refresh before downloading.', code: 'REQUEST_CONFLICT' }); return; }
    if (renderingPdf) { res.status(503).json({ error: 'Another PDF is being generated. Try again shortly.' }); return; }
    renderingPdf = true;
    try {
      const pdf = await renderDocumentPdf(origin, record.id, version, updatedAt, token);
      const currentUser = await lookupSession(token);
      const current = currentUser && await readableRequest(record.id, currentUser);
      if (!current || currentUser.id !== res.locals.user.id) { res.status(404).json({ error: 'Request not found.' }); return; }
      if (current.revision !== record.revision) { res.status(409).json({ error: 'Request changed. Refresh before downloading.', code: 'REQUEST_CONFLICT' }); return; }
      res.type('application/pdf').send(pdf);
    } catch (error) {
      next(error);
    } finally {
      renderingPdf = false;
    }
  });
}
