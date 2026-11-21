import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { openAsyncDatabase, migrateAsyncDatabase } from '../backend/src/asyncDatabase';
import { createApp } from '../backend/src/app';
import { createAttachmentStorage } from '../backend/src/attachmentStorage';
import { MockEmailTransport } from '../backend/src/email';

const port = Number(process.env.API_PORT || 4310);
const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
const dist = resolve('dist');

if (!existsSync(resolve(dist, 'index.html'))) {
  throw new Error('Build frontend first: npm run build');
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken || !url.includes('precisign-qa')) {
  throw new Error('SAFETY CHECK: Refusing to start without verified QA Turso database target (must contain "precisign-qa").');
}

console.log(`[QA Server] Connecting to Turso QA database: ${url}`);
const db = openAsyncDatabase(url, authToken);
await migrateAsyncDatabase(db);
console.log(`[QA Server] Connected & migrated Turso QA database.`);

const mockTransport = new MockEmailTransport();
const attachmentStorage = createAttachmentStorage();

const apiApp = await createApp(
  db,
  {
    origin,
    secureCookies: false,
    loginLimit: 100,
    autoStartWorker: true,
    emailTransport: mockTransport,
  },
  attachmentStorage
);

const site = express();
site.disable('x-powered-by');

// Mount API
site.use('/api', (req, res, next) => {
  req.url = '/api' + req.url;
  apiApp(req, res, next);
});

// Mount static frontend build
site.use(express.static(dist));
site.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));

const server = site.listen(port, '127.0.0.1', () => {
  console.log(`[QA Server] PreciSign connected QA app listening on ${origin}`);
  console.log(`[QA Server] Ready for rehearsal.`);
});

const shutdown = () => {
  console.log('[QA Server] Shutting down...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
