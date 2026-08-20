import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Build stamp: Render exposes the commit as RENDER_GIT_COMMIT; shown in the
  // app so 'did the deploy land yet' is a glance, not bundle archaeology.
  define: {
    __BUILD_SHA__: JSON.stringify((process.env.RENDER_GIT_COMMIT ?? 'dev').slice(0, 7)),
  },
  // host: true lets a phone on the same wifi reach the dev server for testing.
  server: { host: true },
});
