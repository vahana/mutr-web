import puppeteer from 'puppeteer-core'

const APP = process.env.MUTR_APP_URL ?? 'http://localhost:8001/'
const CHROME = process.env.MUTR_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text())
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

try {
  await page.goto(APP, { waitUntil: 'networkidle2' })
  const btns = await page.$$('.welcome-btn')
  let clicked = false
  for (const b of btns) {
    const text = await b.evaluate((el) => el.textContent ?? '')
    if (text.includes('Sync Test')) {
      await b.click()
      clicked = true
      break
    }
  }
  if (!clicked) throw new Error('Sync Test project not found on welcome screen')

  await page.waitForFunction(() => window.__engine && window.__engine.getDurationMs() > 0, { timeout: 20000 })
  const before = await page.evaluate(() => ({
    dur: window.__engine.getDurationMs(),
    pos: window.__engine.getPositionMs(),
  }))
  console.log('loaded:', before)

  const box = await page.$eval('.waveform', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  console.log('canvas:', box)
  await page.mouse.click(box.x + box.w * 0.3, box.y + box.h / 2)

  await new Promise((r) => setTimeout(r, 500))
  const after = await page.evaluate(() => ({
    dur: window.__engine.getDurationMs(),
    pos: window.__engine.getPositionMs(),
  }))
  console.log('after click at 30%:', after)

  const expected = before.dur * 0.3
  const ok = Math.abs(after.pos - expected) < 1000
  console.log(ok ? 'SEEK OK' : `SEEK FAILED (expected ~${expected}, got ${after.pos})`)
  process.exitCode = ok ? 0 : 1
} finally {
  await browser.close()
}
