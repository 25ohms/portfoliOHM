import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'BUCKET_URL')
  const bucket = env.BUCKET_URL ? new URL(env.BUCKET_URL) : null
  const bucketPath = bucket?.pathname.replace(/\/$/, '') ?? ''

  return {
    define: {
      'import.meta.env.BUCKET_URL': JSON.stringify(env.BUCKET_URL ?? ''),
    },
    plugins: [react()],
    server: {
      proxy: {
        ...(bucket
          ? {
              '/api/r2': {
                target: bucket.origin,
                changeOrigin: true,
                rewrite: (path: string) => `${bucketPath}${path.replace(/^\/api\/r2/, '')}`,
              },
            }
          : {}),
        '/api/ra': {
          target: 'https://ra.co',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ra/, ''),
          headers: { referer: 'https://ra.co/events' },
        },
        '/api/ra-cdn': {
          target: 'https://images.ra.co',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ra-cdn/, ''),
          headers: { referer: 'https://ra.co/events' },
        },
        '/api/ra-static-cdn': {
          target: 'https://static.ra.co',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ra-static-cdn/, ''),
          headers: { referer: 'https://ra.co/events' },
        },
      },
    },
    assetsInclude: ['**/*.fbx'],
    build: {
      rollupOptions: {
        output: { onlyExplicitManualChunks: true, manualChunks: { three: ['three'] } },
      },
    },
  }
})
