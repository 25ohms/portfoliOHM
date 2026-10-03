import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const assets = await readdir('dist/assets')
assert(!assets.some((name) => /SceneDevPanel|leva/i.test(name)), 'Development panel chunk shipped')
for (const name of assets.filter((name) => name.endsWith('.js'))) {
  const source = await readFile(`dist/assets/${name}`, 'utf8')
  assert(!/DEVELOPMENT ONLY|Export JSON|SCENE LAB/.test(source), 'Development controls shipped')
}
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader'] })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  const requests = []
  const errors = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() =>
    localStorage.setItem('25ohms.scene.v1', 'production-must-ignore-this'),
  )
  await page.goto('http://localhost:4173/audio')
  await page.getByRole('heading', { name: 'Audio.', exact: true }).waitFor()
  assert(
    !requests.some((url) => /three-|\.fbx/.test(url)),
    '3D assets loaded on a content-only page',
  )
  await page.getByRole('link', { name: '25ohms home' }).click()
  await page.getByText('Sculpture loaded.', { exact: true }).waitFor({ state: 'attached' })
  assert.equal(await page.getByRole('button', { name: 'Tune scene +' }).count(), 0)
  assert.equal(
    await page.evaluate(() => localStorage.getItem('25ohms.scene.v1')),
    'production-must-ignore-this',
  )
  await page.waitForTimeout(400)
  const still = await page.locator('canvas').screenshot()
  await page.waitForTimeout(400)
  assert(
    still.equals(await page.locator('canvas').screenshot()),
    'Reduced-motion sculpture is not still',
  )
  assert.deepEqual(errors, [])
  await page
    .locator('canvas')
    .evaluate((canvas) =>
      canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext(),
    )
  await page
    .getByText('Interactive scene unavailable. Showing a still image.', { exact: true })
    .waitFor({ state: 'attached' })
  const image = page.getByAltText('A cyan wireframe fetus floating in a dark star field')
  await image.waitFor()
  assert(await image.evaluate((img) => img.complete && img.naturalWidth > 0))
  console.log(
    'Production checks passed: lazy 3D loading, no tuning code, isolated presets, still reduced-motion render, and context-loss fallback.',
  )
} finally {
  await browser.close()
}
