import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), {
    name: 'development-react-refresh-csp',
    transformIndexHtml(html, context) {
      return context.server ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : html;
    },
  }],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer', import.meta.url)) } },
  server: { host: '127.0.0.1' },
  build: { outDir: 'dist', sourcemap: true },
});
