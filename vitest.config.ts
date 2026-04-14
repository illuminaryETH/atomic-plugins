import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
  resolve: {
    alias: {
      '@tauri-apps/api/core': path.resolve(__dirname, 'src/lib/stubs/tauri-core.ts'),
      '@tauri-apps/api/event': path.resolve(__dirname, 'src/lib/stubs/tauri-event.ts'),
      '@tauri-apps/plugin-dialog': path.resolve(__dirname, 'src/lib/stubs/tauri-dialog.ts'),
      '@tauri-apps/plugin-opener': path.resolve(__dirname, 'src/lib/stubs/tauri-opener.ts'),
      '@tauri-apps/plugin-fs': path.resolve(__dirname, 'src/lib/stubs/tauri-fs.ts'),
    },
  },
});
