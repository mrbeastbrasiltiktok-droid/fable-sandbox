#!/usr/bin/env bash
# Capture desktop and mobile screenshots of a running preview URL.
set -euo pipefail

: "${CAPTURE_URL:?Set CAPTURE_URL to the preview URL.}"
: "${CAPTURE_DIR:?Set CAPTURE_DIR to the screenshot output directory.}"

run() {
  printf '\n==> %s\n' "$*"
  /usr/bin/time -p "$@"
}

run mkdir -p "$CAPTURE_DIR"
run rm -f "$CAPTURE_DIR/final-desktop.png" "$CAPTURE_DIR/final-mobile.png"

status=0
run node --input-type=module - "$CAPTURE_URL" "$CAPTURE_DIR" <<'NODE' || status=$?
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [url, output] = process.argv.slice(2)
if (!url || !output) throw new Error('Usage: capture <url> <output-dir>')

const runtime = join(process.env.HOME, '.local/share/omgithub-playwright')
const require = createRequire(join(runtime, 'package.json'))
const { chromium } = require('playwright')
const config = JSON.parse(readFileSync(join(runtime, process.platform === 'darwin' ? 'metal.json' : 'linux.json'), 'utf8'))
if (process.platform === 'linux') process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim()

const views = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
]

const transient = (error) => Object.assign(error, { exitCode: 75 })
const step = async (label, fn) => {
  const start = Date.now()
  try {
    const value = await fn()
    console.log(`[capture] ${label}: ${Date.now() - start} ms`)
    return value
  } catch (error) {
    console.error(`[capture] ${label} failed after ${Date.now() - start} ms`)
    throw error
  }
}

let browser
let exitCode = 0
try {
  browser = await step('launch browser', () => chromium.launch({ ...config.browser.launchOptions, timeout: 30000 })).catch(transient)
  for (const view of views) {
    let context
    try {
      context = await step(`open ${view.name} context`, () => browser.newContext({
        viewport: { width: view.width, height: view.height },
        deviceScaleFactor: view.mobile ? 2 : 1,
        isMobile: view.mobile,
        hasTouch: view.mobile,
      })).catch(transient)
      const page = await step(`open ${view.name} page`, () => context.newPage()).catch(transient)
      page.setDefaultTimeout(30000)
      page.on('pageerror', (error) => console.error(`[capture] ${view.name} page error: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') console.error(`[capture] ${view.name} console: ${message.text()}`)
      })

      const response = await step(`navigate ${view.name}`, () => page.goto(url, { waitUntil: 'load', timeout: 45000 })).catch(transient)
      if (!response) throw transient(new Error(`No HTTP response loading ${url}`))
      const status = response.status()
      if (status >= 500 || status === 408 || status === 429) throw transient(new Error(`Temporary HTTP ${status} loading ${url}`))
      if (status >= 400) throw new Error(`HTTP ${status} loading ${url}`)

      await step(`wait for ${view.name} content`, async () => {
        try {
          await page.waitForFunction(() => {
            if (document.readyState !== 'complete') return false
            const body = document.body
            if (!body) return false
            if (body.dataset.appReady === 'true') return true
            const canvas = document.querySelector('canvas')
            if (canvas && canvas.width > 0 && canvas.height > 0) return true
            return (body.innerText || '').trim().length > 20
          }, null, { timeout: 30000 })
        } catch (error) {
          if (!browser.isConnected()) throw transient(error)
          throw error
        }
      })
      await step(`wait for ${view.name} fonts`, () => page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 10000 }))
      await step(`settle ${view.name}`, () => page.waitForTimeout(900))

      const file = join(output, `final-${view.name}.png`)
      await step(`capture ${view.name}`, () => page.screenshot({ path: file, timeout: 30000 })).catch((error) => {
        if (error.name === 'TimeoutError' || !browser.isConnected()) throw transient(error)
        throw error
      })
    } finally {
      if (context) await context.close().catch(() => {})
    }
  }

  for (const view of views) {
    const file = join(output, `final-${view.name}.png`)
    const bytes = readFileSync(file)
    if (bytes.length < 5000) throw new Error(`${file} is unexpectedly small (${bytes.length} bytes)`)
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${file} is not a PNG`)
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (width < 300 || height < 300) throw new Error(`${file} has invalid dimensions ${width}x${height}`)
    console.log(`[capture] ${view.name}: ${file} (${width}x${height}, ${bytes.length} bytes)`)
  }
} catch (error) {
  console.error(error)
  exitCode = error.exitCode || 1
} finally {
  await browser?.close().catch((error) => {
    console.error(error)
    exitCode ||= 75
  })
}
process.exit(exitCode)
NODE

if [ "$status" -eq 0 ]; then
  run test -s "$CAPTURE_DIR/final-desktop.png"
  run test -s "$CAPTURE_DIR/final-mobile.png"
  printf '\n==> capture complete in %s\n' "$CAPTURE_DIR"
fi

exit "$status"
