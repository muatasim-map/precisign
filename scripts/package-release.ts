import { mkdirSync, rmSync, cpSync, readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const projectRoot = resolve('.');
const releaseDir = resolve('releases/precisign-live');

console.log('=== PreciSign Live: Packaging Release for Hostinger ===');

// 1. Run fresh build of client and server
console.log('Step 1: Running production build...');
const buildResult = spawnSync(process.execPath, ['scripts/build.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', VITE_DATA_MODE: 'api' },
});
if (buildResult.status !== 0) {
  throw new Error(`Build failed with status ${buildResult.status}`);
}

// 2. Prepare clean release directory
console.log(`Step 2: Preparing clean release directory at ${releaseDir}...`);
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

// 3. Define files and directories to copy
const itemsToCopy = [
  'package.json',
  'package-lock.json',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'README.md',
  '.env.example',
  'server.js',
  'dist',
  'public',
  'backend',
  'frontend',
  'shared',
];

function shouldIncludeFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  // Exclude tests
  if (/\.test\.(ts|tsx|js|mjs)$/.test(normalized)) return false;
  // Exclude test fixtures, temporary files, rehearsal scripts
  if (normalized.includes('-temp') || normalized.includes('field-design-check') || normalized.includes('rehearsal-') || normalized.includes('verify-')) return false;
  // Exclude database files
  if (/\.(sqlite|db|sqlite-wal|sqlite-shm)$/.test(normalized)) return false;
  // Exclude env files with secrets
  if (/\.env($|\.(local|development|test|production))$/.test(normalized)) return false;
  // Exclude artifacts, screenshots, tasks, scratch
  if (normalized.includes('.artifacts') || normalized.includes('screenshots') || normalized.includes('scratch')) return false;
  return true;
}

function copyRecursive(src: string, dest: string) {
  const stat = statSync(src);
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const child of readdirSync(src)) {
      copyRecursive(join(src, child), join(dest, child));
    }
  } else {
    if (shouldIncludeFile(src)) {
      cpSync(src, dest);
    }
  }
}

for (const item of itemsToCopy) {
  const srcPath = join(projectRoot, item);
  if (existsSync(srcPath)) {
    copyRecursive(srcPath, join(releaseDir, item));
  }
}

// Only copy build scripts to scripts/
const scriptsDest = join(releaseDir, 'scripts');
mkdirSync(scriptsDest, { recursive: true });
cpSync(join(projectRoot, 'scripts/build.mjs'), join(scriptsDest, 'build.mjs'));
cpSync(join(projectRoot, 'scripts/build-server.mjs'), join(scriptsDest, 'build-server.mjs'));

// 4. Verify exclusions and security checks in releaseDir
console.log('Step 3: Verifying release directory exclusions and security...');
const allFiles: string[] = [];
function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else {
      allFiles.push(full);
    }
  }
}
walk(releaseDir);

const forbiddenPatterns = [
  /\.env$/,
  /\.env\.(local|production|development|test)$/,
  /\.(sqlite|db|sqlite-wal|sqlite-shm)$/,
  /\.test\.(ts|tsx|js)$/,
  /node_modules/,
  /\.artifacts/,
  /scratch/,
];

for (const file of allFiles) {
  const rel = relative(releaseDir, file).replace(/\\/g, '/');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(rel)) {
      throw new Error(`Security Violation: Found forbidden file in release package: ${rel}`);
    }
  }
}

// Check that no secret tokens are leaked in any text files inside release package
const tokenSnippets = ['eyJhIjo' + 'icnciLCJpYXQi', 're_WkAym' + 'Cc6_3ZhxFoQ', '3fbee1e557' + 'f0d1256e5c58'];
for (const file of allFiles) {
  if (/\.(json|js|ts|tsx|md|html|css|txt)$/.test(file)) {
    const content = readFileSync(file, 'utf8');
    for (const snippet of tokenSnippets) {
      if (content.includes(snippet)) {
        throw new Error(`Security Violation: Found leaked credential in ${file}`);
      }
    }
  }
}

console.log(`Step 4: Package verified successfully! Total files: ${allFiles.length}`);
console.log(`Release directory: ${releaseDir}`);
