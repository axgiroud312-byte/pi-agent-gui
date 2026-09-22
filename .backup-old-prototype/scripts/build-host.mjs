import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/host/main.ts', preload: 'src/host/preload.ts' },
  bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  outdir: 'out', outExtension: { '.js': '.cjs' }, external: ['electron'], sourcemap: true,
});
