import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          thirdweb: ['thirdweb'],
          recharts: ['recharts']
        }
      }
    }
  },
  resolve: {
    dedupe: ['react', 'react-dom']
  }
});
