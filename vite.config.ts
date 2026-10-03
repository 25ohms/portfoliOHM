import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.fbx'],
  build: {
    rollupOptions: {
      output: { onlyExplicitManualChunks: true, manualChunks: { three: ['three'] } },
    },
  },
})
