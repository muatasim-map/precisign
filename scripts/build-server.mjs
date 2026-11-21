import { build } from 'esbuild';

await build({
  entryPoints: ['backend/src/index.ts'],
  platform: 'node',
  packages: 'external',
  format: 'esm',
  target: 'node24',
  bundle: true,
  outfile: 'server.js',
});

console.log('Successfully compiled server.js');
