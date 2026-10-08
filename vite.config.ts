import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'BUCKET_URL')

  return {
    define: {
      'import.meta.env.BUCKET_URL': JSON.stringify(env.BUCKET_URL ?? ''),
    },
    plugins: [react()],
    assetsInclude: ['**/*.fbx'],
    build: {
      rollupOptions: {
        output: { onlyExplicitManualChunks: true, manualChunks: { three: ['three'] } },
      },
    },
  }
})
