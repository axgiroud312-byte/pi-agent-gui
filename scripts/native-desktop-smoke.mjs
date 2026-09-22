import { run } from './native-smoke/runner.mjs';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/native-desktop-smoke.mjs [--app-root <built repo>] [--baseline original|product] [--output <directory>]');
  console.log('Defaults: this repository, product branding assertions, test-results/native-parity/product. Windows + prepared native production build required. No install or rebuild.');
} else {
  await run();
}
