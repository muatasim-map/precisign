import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

function testGitIgnoreRules() {
  console.log('=== Verifying .gitignore rules against temporary git harness ===');
  const tempDir = mkdtempSync(join(tmpdir(), 'precisign-gitignore-verify-'));

  try {
    // Initialize temporary repository in tmpdir (leaves new-precisign an ordinary folder)
    execFileSync('git', ['init'], { cwd: tempDir, stdio: 'pipe' });

    // Copy .gitignore to the temporary repo
    const sourceGitIgnore = join(process.cwd(), '.gitignore');
    const targetGitIgnore = join(tempDir, '.gitignore');
    copyFileSync(sourceGitIgnore, targetGitIgnore);

    const testCases: { path: string; isDir?: boolean; shouldIgnore: boolean; category: string }[] = [
      // Dependencies
      { path: 'node_modules', isDir: true, shouldIgnore: true, category: 'Dependencies' },
      { path: 'node_modules/package.json', shouldIgnore: true, category: 'Dependencies' },
      { path: 'frontend/node_modules/pkg/index.js', shouldIgnore: true, category: 'Dependencies' },

      // Build output
      { path: 'dist', isDir: true, shouldIgnore: true, category: 'Build output' },
      { path: 'dist/index.html', shouldIgnore: true, category: 'Build output' },
      { path: 'build/output.js', shouldIgnore: true, category: 'Build output' },
      { path: 'coverage/lcov.info', shouldIgnore: true, category: 'Build output' },

      // Logs & OS files
      { path: 'app.log', shouldIgnore: true, category: 'Logs' },
      { path: 'backend/debug.log', shouldIgnore: true, category: 'Logs' },
      { path: '.DS_Store', shouldIgnore: true, category: 'OS files' },

      // Private .env files (must be ignored)
      { path: '.env', shouldIgnore: true, category: 'Private .env' },
      { path: '.env.local', shouldIgnore: true, category: 'Private .env' },
      { path: '.env.production', shouldIgnore: true, category: 'Private .env' },
      { path: '.env.development', shouldIgnore: true, category: 'Private .env' },

      // Public / example .env files (must NOT be ignored)
      { path: '.env.example', shouldIgnore: false, category: 'Tracked public .env' },
      { path: '.env.showcase', shouldIgnore: false, category: 'Tracked public .env' },

      // Local SQLite & sidecars (must be ignored)
      { path: 'data/precisign.sqlite', shouldIgnore: true, category: 'SQLite database' },
      { path: 'data/precisign.sqlite-wal', shouldIgnore: true, category: 'SQLite WAL sidecar' },
      { path: 'data/precisign.sqlite-shm', shouldIgnore: true, category: 'SQLite SHM sidecar' },
      { path: 'test.sqlite', shouldIgnore: true, category: 'SQLite database' },
      { path: 'test.sqlite-wal', shouldIgnore: true, category: 'SQLite WAL sidecar' },
      { path: 'test.sqlite-shm', shouldIgnore: true, category: 'SQLite SHM sidecar' },
      { path: 'backend/local.sqlite', shouldIgnore: true, category: 'SQLite database' },

      // Backups and partial files (must be ignored)
      { path: 'backups/backup.sqlite', shouldIgnore: true, category: 'Backups' },
      { path: 'backups/2026-11-13.sqlite', shouldIgnore: true, category: 'Backups' },
      { path: 'copy.partial', shouldIgnore: true, category: 'Partial files' },

      // Tracked source files (must NOT be ignored)
      { path: 'package.json', shouldIgnore: false, category: 'Source files' },
      { path: 'frontend/src/App.tsx', shouldIgnore: false, category: 'Source files' },
      { path: 'backend/src/index.ts', shouldIgnore: false, category: 'Source files' },
      { path: 'shared/types/index.ts', shouldIgnore: false, category: 'Source files' },
      { path: 'README.md', shouldIgnore: false, category: 'Source files' },
      { path: 'docs/navigation/feature-index.md', shouldIgnore: false, category: 'Source files' },
    ];

    let passed = 0;
    for (const { path, isDir, shouldIgnore, category } of testCases) {
      const fullPath = join(tempDir, path);
      if (isDir) {
        mkdirSync(fullPath, { recursive: true });
      } else {
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, 'synthetic');
      }

      let isIgnored = false;
      try {
        const out = execFileSync('git', ['check-ignore', path], { cwd: tempDir, stdio: 'pipe', encoding: 'utf8' });
        if (out.trim().length > 0) {
          isIgnored = true;
        }
      } catch (err: any) {
        // Exit code 1 from git check-ignore indicates NOT ignored
        if (err.status === 1) {
          isIgnored = false;
        } else {
          throw err;
        }
      }

      assert.equal(
        isIgnored,
        shouldIgnore,
        `Expected path '${path}' (${category}) to be ${shouldIgnore ? 'ignored' : 'NOT ignored'}, but got isIgnored=${isIgnored}`
      );
      passed++;
      console.log(`✔ [${category}] ${path} -> ${isIgnored ? 'IGNORED' : 'TRACKED'}`);
    }

    console.log(`\nAll ${passed} .gitignore verification checks passed successfully.`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

testGitIgnoreRules();
