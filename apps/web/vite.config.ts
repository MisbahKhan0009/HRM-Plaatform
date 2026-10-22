import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    // `pnpm --filter @hrm/api dev` serves the API on 8787; the SPA calls it same-origin through this proxy.
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { sourcemap: true, target: 'es2022' },
});
