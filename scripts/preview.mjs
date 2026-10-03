import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const capturePreviews = process.argv.includes('--previews')
const writeStill = process.argv.includes('--write-still')
const previewDirectory = '.artifacts/previews'

if (!capturePreviews && !writeStill) {
  throw new Error(
    'Choose --write-still to update fallback images or --previews to capture screenshots.',
  )
}
if (capturePreviews) await mkdir(previewDirectory, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
})
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (error) => console.error('Browser error:', error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  await page.goto(process.env.PREVIEW_URL || 'http://localhost:5173')
  await page
    .getByText('Sculpture loaded.', { exact: true })
    .waitFor({ state: 'attached', timeout: 30_000 })
    .catch(async (error) => {
      console.error(await page.locator('body').innerText())
      throw error
    })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(800)
  if (writeStill) {
    await page.locator('canvas').screenshot({ path: 'public/ohmega-still.png' })
  }
  if (capturePreviews) {
    await page.screenshot({ path: `${previewDirectory}/desktop.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)
  if (writeStill) {
    await page.locator('canvas').screenshot({ path: 'public/ohmega-still-mobile.png' })
  }
  if (capturePreviews) {
    await page.screenshot({ path: `${previewDirectory}/mobile.png`, fullPage: true })
    await page.getByRole('button', { name: 'Tune scene +' }).click()
    await page.getByRole('complementary', { name: 'Scene development controls' }).waitFor()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: `${previewDirectory}/tuning.png`, fullPage: true })
    console.log(`Saved desktop, mobile, and tuning previews to ${previewDirectory}/.`)
  }
  if (writeStill) console.log('Updated the desktop and mobile fallback images in public/.')
} finally {
  await browser.close()
}
