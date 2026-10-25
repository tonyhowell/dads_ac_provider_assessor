import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { apiPlugin } from './server/vitePlugin.ts';

export default defineConfig(({ mode }) => {
  // Secrets are read server-side only (never prefixed VITE_, so never bundled).
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), apiPlugin({ anthropicApiKey: env.ANTHROPIC_API_KEY })],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
