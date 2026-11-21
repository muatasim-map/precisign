import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AttachmentItem, RequestRecord } from '../../shared/types';
import { RequestError } from './requestValidation';
import type { AsyncDatabase, AsyncQueryConnection } from './asyncDatabase';

const prefix = 'r2:precisign-attachments/v1/';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function attachmentIdentity(value?: string) {
  if (!value || value.startsWith(prefix)) return value;
  return prefix + digest(value);
}

export function createAttachmentStorage(env: NodeJS.ProcessEnv = process.env) {
  const { PRECISIGN_R2_ENDPOINT: endpoint, PRECISIGN_R2_BUCKET: bucket,
    PRECISIGN_R2_ACCESS_KEY_ID: accessKeyId, PRECISIGN_R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint && !bucket && !accessKeyId && !secretAccessKey) return undefined;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error('Incomplete R2 attachment configuration.');

  const client = new S3Client({
    endpoint, region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  async function upload(file: AttachmentItem) {
    if (!file.dataUrl) throw new Error('Missing validated attachment data.');
    const reference = attachmentIdentity(file.dataUrl)!;
    const binary = Buffer.from(file.dataUrl.slice(file.dataUrl.indexOf(',') + 1), 'base64');
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: reference.slice(3), Body: binary, ContentType: file.mimeType,
      }), { abortSignal: AbortSignal.timeout(15000) });
      file.dataUrl = reference;
    } catch {
      throw new RequestError(503, 'Attachment storage is unavailable. Try again.');
    }
  }

  async function download(file: AttachmentItem) {
    if (!file.dataUrl?.startsWith(prefix)) return;
    const reference = file.dataUrl;
    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: bucket, Key: reference.slice(3),
      }), { abortSignal: AbortSignal.timeout(15000) });
      if (!response.Body || response.ContentLength !== file.sizeBytes) throw new Error('Unexpected attachment size.');
      const binary = Buffer.from(await response.Body.transformToByteArray());
      const dataUrl = 'data:' + file.mimeType + ';base64,' + binary.toString('base64');
      if (attachmentIdentity(dataUrl) !== reference) throw new Error('Attachment integrity check failed.');
      file.dataUrl = dataUrl;
    } catch {
      throw new RequestError(503, 'Attachment storage is unavailable. Try again.');
    }
  }

  async function deleteObject(reference: string) {
    if (!reference?.startsWith(prefix)) return;
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket, Key: reference.slice(3),
      }), { abortSignal: AbortSignal.timeout(15000) });
    } catch {
      // Best-effort cleanup, do not mask primary error
    }
  }

  return { upload, download, deleteObject };
}

export interface AttachmentStorageService {
  upload(file: AttachmentItem): Promise<void>;
  download(file: AttachmentItem): Promise<void>;
  deleteObject?(reference: string): Promise<void>;
}

export type AttachmentStorage = AttachmentStorageService | undefined;

export function isAttachmentReferencedSync(db: DatabaseSync, reference: string): boolean {
  const row = db.prepare('SELECT 1 FROM requests WHERE record LIKE ? LIMIT 1').get(`%${reference}%`);
  return Boolean(row);
}

export async function isAttachmentReferencedAsync(db: AsyncDatabase | AsyncQueryConnection, reference: string): Promise<boolean> {
  const res = await db.execute('SELECT 1 FROM requests WHERE record LIKE ? LIMIT 1', [`%${reference}%`]);
  return res.rows.length > 0;
}

export function attachmentMetadata<T extends RequestRecord>(record: T): T {
  function metadata(file: AttachmentItem, version: number): AttachmentItem {
    const { dataUrl, ...info } = file;
    return {
      ...info,
      downloadUrl: dataUrl ? `/api/requests/${encodeURIComponent(record.id)}/attachments/${version}/${encodeURIComponent(file.id)}` : undefined,
    };
  }
  return {
    ...record,
    attachments: (record.attachments || []).map(file => metadata(file, record.documentVersion)),
    attachmentVersions: record.attachmentVersions?.map(version => ({
      ...version, attachments: (version.attachments || []).map(file => metadata(file, version.version)),
    })),
    versionAttachmentSets: record.versionAttachmentSets?.map(set => ({
      ...set, attachments: (set.attachments || []).map(file => metadata(file, set.documentVersion)),
    })),
    financeHoldHistory: record.financeHoldHistory?.map(entry => ({
      ...entry, attachment: entry.attachment && metadata(entry.attachment, entry.documentVersion),
    })),
  };
}