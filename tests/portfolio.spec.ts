import { expect, test } from '@playwright/test'
import { DEFAULT_SCENE } from '../src/config/scene'

test('loads the actual sculpture and supports navigation and motion controls', async ({
  page,
  isMobile,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByText('Sculpture loaded.', { exact: true })).toBeAttached()
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Pause rotation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume rotation', exact: true })).toBeVisible()
  const scene = page.getByRole('region', { name: 'Interactive OHMEGA wireframe sculpture' })
  await scene.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Home')
  await page.getByRole('button', { name: 'Reset sculpture pose' }).click()
  if (isMobile) await page.getByRole('button', { name: 'Menu +' }).click()
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'About' })
    .click()
  await expect(page.getByRole('heading', { name: '25ohms.' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.getByRole('link', { name: '25ohms home' }).click()
  await expect(page.getByText('Sculpture loaded.', { exact: true })).toBeAttached()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  expect(errors).toEqual([])
})

test('starts still for reduced motion and exports the actual dragged pose', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByText('Sculpture loaded.', { exact: true })).toBeAttached()
  await expect(page.getByRole('button', { name: 'Resume rotation', exact: true })).toBeVisible()
  const region = page.getByRole('region', { name: 'Interactive OHMEGA wireframe sculpture' })
  const box = (await region.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Tune scene +' }).click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const download = await downloadEvent
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream!) chunks.push(chunk)
  const preset = JSON.parse(Buffer.concat(chunks).toString())
  expect(preset.model.rotation[1]).not.toBe(-0.45)
  await page.reload()
  await expect(page.getByText('Sculpture loaded.', { exact: true })).toBeAttached()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('25ohms.scene.v1')!))
  expect(saved.model.rotation).toEqual(preset.model.rotation)
})

test('falls back gracefully when the asset cannot load', async ({ page }) => {
  await page.route('**/*.fbx', (route) => route.abort())
  await page.goto('/')
  await expect(
    page.getByText('Interactive scene unavailable. Showing a still image.', { exact: true }),
  ).toBeAttached()
  await expect(
    page.getByAltText('A cyan wireframe fetus floating in a dark star field'),
  ).toBeVisible()
  expect(
    await page
      .getByAltText('A cyan wireframe fetus floating in a dark star field')
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
  ).toBe(true)
  await expect(page.getByRole('link', { name: /Sound \/ Frequency/ })).toBeVisible()
})

test('all section URLs load directly and the menu is keyboard accessible', async ({
  page,
  isMobile,
}) => {
  for (const [path, title] of [
    ['audio', 'Audio.'],
    ['visual', 'Visual.'],
    ['live', 'Live.'],
    ['contact', 'Let’s connect.'],
  ]) {
    await page.goto(`/${path}`)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  if (isMobile) {
    await page.getByRole('button', { name: 'Menu +' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  }
})

test('imports palettes, rejects malformed presets, and closes the tuning panel', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByText('Sculpture loaded.', { exact: true })).toBeAttached()
  const before = await page.locator('canvas').screenshot()
  await page.getByRole('button', { name: 'Tune scene +' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version": 1}'),
  })
  await expect(page.getByText(/Invalid scene preset/)).toBeVisible()
  const recolored = {
    ...DEFAULT_SCENE,
    palette: [
      { position: 0, color: '#050909' },
      { position: 1, color: '#ff3377' },
    ],
  }
  await page.locator('input[type=file]').setInputFiles({
    name: 'pink.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(recolored)),
  })
  await page.getByRole('button', { name: 'Close scene tuning' }).click()
  await expect(page.getByRole('complementary', { name: 'Scene development controls' })).toHaveCount(
    0,
  )
  await expect
    .poll(async () => (await page.locator('canvas').screenshot()).equals(before))
    .toBe(false)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('25ohms.scene.v1')!))
  expect(stored.palette).toEqual(recolored.palette)
})

test('shows the fallback when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    // Keep 2D canvas available for the browser; only simulate unavailable WebGL.
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null
      return Reflect.apply(original, this, [type, ...args])
    } as typeof original
  })
  await page.goto('/')
  await expect(
    page.getByText('Interactive scene unavailable. Showing a still image.', { exact: true }),
  ).toBeAttached()
  await expect(
    page.getByAltText('A cyan wireframe fetus floating in a dark star field'),
  ).toBeVisible()
})
