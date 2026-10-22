import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const runtime = process.env.PLAYWRIGHT_RUNTIME || join(process.env.HOME, '.local/share/omgithub-playwright')
const require = createRequire(join(runtime, 'package.json'))
const { chromium } = require('playwright')
const runtimeScripts = process.env.RUNTIME_DIR || '/home/runner/work/_temp/omgithub-runtime'
try {
  const captures = require(join(runtimeScripts, 'scripts/wip-screenshots.cjs'))
  captures.instrument({ chromium })
} catch (error) {
  console.error('Capture instrumentation unavailable:', error.message)
}

const config = JSON.parse(readFileSync(join(runtime, process.platform === 'darwin' ? 'metal.json' : 'linux.json'), 'utf8'))
if (process.platform === 'linux') process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim()

const url = process.env.CAPTURE_URL
const output = process.env.CAPTURE_DIR
if (!url || !output) throw new Error('Set CAPTURE_URL and CAPTURE_DIR.')
mkdirSync(output, { recursive: true })

const transient = error => { throw Object.assign(error, { exitCode: 75 }) }
let browser

try {
  browser = await chromium.launch({ ...config.browser.launchOptions, timeout: 30000 }).catch(transient)

  for (const [name, width, height, mobile] of [['desktop', 1440, 900, false], ['mobile', 390, 844, true]]) {
    const page = await browser.newPage({
      viewport: { width, height },
      ...(mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : {})
    }).catch(transient)
    page.setDefaultTimeout(30000)
    page.on('pageerror', error => console.error(error.message))

    const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(transient)
    if (!response?.ok()) {
      const status = response?.status()
      throw Object.assign(new Error(`HTTP ${status} loading preview`), {
        exitCode: !status || [408, 429, 500, 502, 503, 504].includes(status) ? 75 : 1
      })
    }

    await page.locator('body').waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.fonts.status === 'loaded').catch(() => {})
    await page.waitForTimeout(500)

    const selector = process.env.CAPTURE_START_SELECTOR || '#overlay-sub'
    let started = false
    try {
      await page.locator(selector).first().click({ force: true, timeout: 5000 })
      started = true
    } catch {
      started = await page.evaluate(value => {
        const element = document.querySelector(value)
        if (!element) return false
        element.click()
        return true
      }, selector)
    }
    console.log(`Capture ${name}: ${started ? 'started' : 'start control not found'}`)

    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(output, `final-${name}.png`), timeout: 30000 }).catch(error => {
      if (error.name === 'TimeoutError' || !browser.isConnected()) transient(error)
      throw error
    })
    await page.close()
  }
} catch (error) {
  console.error(error)
  process.exitCode = error.exitCode || 1
} finally {
  await browser?.close().catch(error => {
    console.error(error)
    process.exitCode ||= 75
  })
}
