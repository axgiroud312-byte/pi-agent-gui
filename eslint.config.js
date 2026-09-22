import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config(
  { ignores: ['node_modules/**', 'dist/**', 'out/**', 'release/**', 'test-results/**', 'playwright-report/**', 'src/renderer/components/ui/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
