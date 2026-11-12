/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The build lands directly in ../server so the release is just that folder:
// server/index.html + server/assets/ next to api.php. Relative base lets
// people install it in any subfolder (e.g. example.com/tools/phpmyflow/).
export default defineConfig({
  plugins: [svelte()],
  base: './',
  build: {
    outDir: '../server',
    emptyOutDir: false,
    assetsDir: 'assets',
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    // tests/security: regression tests for security fixes (also the PHP ones there).
    include: ['src/**/*.test.ts', '../tests/security/**/*.test.ts'],
    // theme.test.ts reads the theme CSS as text (?raw) to check contrast.
    css: { include: [/styles[\\/]themes[\\/]/] },
  },
  server: {
    port: 5173,
    proxy: {
      '/api.php': 'http://127.0.0.1:8080',
    },
    // Vitest loads ../tests/security; the dev server keeps serving web/ only.
    ...(process.env.VITEST ? { fs: { allow: ['..'] } } : {}),
  },
});
