import { rm } from 'node:fs/promises'

// Generated output only. Source files, assets, and installed dependencies stay intact.
const generatedPaths = [
  'dist',
  '.artifacts',
  'test-results',
  'playwright-report',
  'tsconfig.tsbuildinfo',
]

for (const path of generatedPaths) {
  await rm(new URL(`../${path}`, import.meta.url), { recursive: true, force: true })
}

console.log('Removed generated build, preview, and test output.')
