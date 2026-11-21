import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { join } from 'node:path';

const args = process.argv.slice(2);
const viteBin = 'node_modules/vite/bin/vite.js';
const viteResult = spawnSync(process.execPath, [viteBin, 'build', ...args], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DATA_MODE: process.env.VITE_DATA_MODE || 'api' }
});

if (viteResult.error) throw viteResult.error;
if (viteResult.status !== 0) process.exit(viteResult.status ?? 1);

let outfile = 'server.js';
const outDirIdx = args.indexOf('--outDir');
if (outDirIdx !== -1 && args[outDirIdx + 1]) {
  outfile = join(args[outDirIdx + 1], 'server.js');
}

await build({
  entryPoints: ['backend/src/index.ts'],
  platform: 'node',
  packages: 'external',
  format: 'esm',
  target: 'node24',
  bundle: true,
  outfile,
});

console.log(`Successfully compiled ${outfile}`);
