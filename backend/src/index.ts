import dotenv from 'dotenv';
dotenv.config();
import { initBackendSentry } from './sentry';
initBackendSentry();
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { openDatabase } from './db';
import { migrateAsyncDatabase, openAsyncDatabase } from './asyncDatabase';
import { createAttachmentStorage } from './attachmentStorage';
import { createApp } from './app';
import express from 'express';
import { existsSync } from 'node:fs';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || process.env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT.');
const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3000';
if (production && !origin.startsWith('https://')) throw new Error('Set APP_ORIGIN to the HTTPS application origin.');
const databaseMode = process.env.PRECISIGN_DATABASE || 'sqlite';
if (!['sqlite', 'turso'].includes(databaseMode)) throw new Error('Invalid PRECISIGN_DATABASE.');
let db;
if (databaseMode === 'turso') {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken || !url.startsWith('libsql://')) throw new Error('Turso requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
  console.log(`Connecting to Turso database: ${url}`);
  db = openAsyncDatabase(url, authToken);
  try { await migrateAsyncDatabase(db); } catch (error) { db.close(); throw error; }
  console.log(`Connected to Turso database: ${url}`);
} else {
  const path = resolve(process.env.DATABASE_PATH || process.env.PRECISIGN_DATABASE_PATH || 'data/precisign.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  db = openDatabase(path);
}
const loginLimit = process.env.LOGIN_LIMIT ? Number(process.env.LOGIN_LIMIT) : (production ? 10 : 100);
const trustProxyEnv = process.env.TRUST_PROXY || process.env.PRECISIGN_TRUST_PROXY;
let trustProxy: boolean | number | string | undefined = undefined;
if (trustProxyEnv !== undefined) {
  if (trustProxyEnv === 'true') trustProxy = true;
  else if (trustProxyEnv === 'false') trustProxy = false;
  else if (/^\d+$/.test(trustProxyEnv)) trustProxy = Number(trustProxyEnv);
  else trustProxy = trustProxyEnv;
}
const app = await createApp(db, { origin, secureCookies: production, loginLimit, autoStartWorker: true, trustProxy }, createAttachmentStorage());
const shutdown = (server: any) => () => {
  (app as any).outboxProcessor?.stop();
  server.close(() => { db.close(); process.exit(0); });
};
if (production) {
  if (process.env.VITE_DATA_MODE !== 'api') throw new Error('Production requires VITE_DATA_MODE=api at build and start.');
  const host = process.env.BIND_HOST || '0.0.0.0';
  const standaloneApi = process.env.STANDALONE_API === 'true';
  const dist = resolve('dist');

  if (standaloneApi) {
    const server = app.listen(port, host, () => console.log(`PreciSign Standalone API listening on http://${host}:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown(server));
  } else {
    if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Build the frontend first.');
    // API factory installs a terminal 404; serve the frontend before its routes.
    const site = express();
    site.use('/api', (req, res, next) => { req.url = '/api' + req.url; app(req, res, next); });
    site.use(express.static(dist));
    site.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
    const server = site.listen(port, host, () => console.log(`PreciSign listening on http://${host}:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown(server));
  }
} else {
  const server = app.listen(port, '127.0.0.1', () => console.log(`PreciSign API listening on http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown(server));
}
