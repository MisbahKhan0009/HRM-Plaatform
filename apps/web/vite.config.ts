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
  build: {
    sourcemap: true,
    target: 'es2022',
    // The manifest feeds scripts/check-bundle-size.mjs (PB-06).
    manifest: true,
    rolldownOptions: {
      // Building a zod schema has no side effects, so schemas a chunk never uses can be dropped from it.
      treeshake: { manualPureFunctions: ['z'] },
      output: {
        // Radix's small shared helpers get their own chunk; otherwise they land inside the dialog chunk and every
        // route that needs one helper downloads the whole dialog.
        codeSplitting: {
          groups: [
            {
              name: 'radix-core',
              test: /@radix-ui[\\/](primitive|react-(primitive|context|compose-refs|slot|id|direction|use-[a-z-]+))[\\/]/,
            },
          ],
        },
      },
    },
  },
});
