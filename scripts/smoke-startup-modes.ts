import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function testCombinedMode() {
  console.log('--- Testing Combined Mode (Production) ---');
  const dir = mkdtempSync(join(tmpdir(), 'precisign-combined-smoke-'));
  const port = 3101;
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'backend/src/index.ts'],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        VITE_DATA_MODE: 'api',
        APP_ORIGIN: 'https://precisign.example.test',
        PORT: String(port),
        BIND_HOST: '127.0.0.1',
        DATABASE_PATH: join(dir, 'test.sqlite'),
        PRECISIGN_EMAIL_MODE: 'mock',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', chunk => {
    output += chunk;
    process.stderr.write(chunk);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Combined mode startup timed out: ' + output)), 15000);
      child.stdout.on('data', () => {
        if (output.includes('PreciSign listening')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on('exit', code => {
        clearTimeout(timeout);
        reject(new Error(`Combined mode exited ${code}: ${output}`));
      });
    });

    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const healthJson = await health.json();
    assert.equal(healthJson.status, 'ok');
    console.log('✔ Combined mode: /api/health returns 200 and { status: "ok" }');

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const pageHtml = await page.text();
    assert.match(pageHtml, /PreciSign/);
    console.log('✔ Combined mode: / serves frontend SPA (PreciSign)');
  } finally {
    child.kill();
    await new Promise<void>(resolve => child.once('exit', () => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

async function testStandaloneMode() {
  console.log('--- Testing Standalone Mode (Production STANDALONE_API=true) ---');
  const dir = mkdtempSync(join(tmpdir(), 'precisign-standalone-smoke-'));
  const port = 3102;
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'backend/src/index.ts'],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        STANDALONE_API: 'true',
        VITE_DATA_MODE: 'api',
        APP_ORIGIN: 'https://precisign.example.test',
        PORT: String(port),
        BIND_HOST: '127.0.0.1',
        DATABASE_PATH: join(dir, 'test.sqlite'),
        PRECISIGN_EMAIL_MODE: 'mock',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', chunk => {
    output += chunk;
    process.stderr.write(chunk);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Standalone API startup timed out: ' + output)), 15000);
      child.stdout.on('data', () => {
        if (output.includes('PreciSign Standalone API listening')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on('exit', code => {
        clearTimeout(timeout);
        reject(new Error(`Standalone API exited ${code}: ${output}`));
      });
    });

    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const healthJson = await health.json();
    assert.equal(healthJson.status, 'ok');
    console.log('✔ Standalone API mode: /api/health returns 200 and { status: "ok" }');

    const me = await fetch(`${base}/api/auth/me`);
    assert.equal(me.status, 401);
    console.log('✔ Standalone API mode: /api/auth/me returns 401 without cookie');
  } finally {
    child.kill();
    await new Promise<void>(resolve => child.once('exit', () => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

async function run() {
  await testCombinedMode();
  await testStandaloneMode();
  console.log('\nAll startup smoke tests passed successfully!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
